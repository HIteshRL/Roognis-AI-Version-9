"""Guardians — teacher-managed guardian roster + read-only guardian summaries.

Two sides, mapped onto TW2's identity model:

* **Teacher** records/removes a student's guardians (by email). A teacher may
  only manage guardians for a student enrolled in a class they own.
* **Guardian** (a ``parent`` role user) sees a read-only progress digest for each
  of their linked students. Parent↔student linking is owned by the Auth Service
  and arrives in the JWT as ``studentIds`` — the LMS authorizes summaries against
  that list rather than reaching across the microservice boundary.

Ported/adapted from v2 ``services/learner/guardian_service.py``. The email-token
accept flow is intentionally omitted: linkage already lives in auth_db.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import AuthUser, get_current_user
from database import get_db
from models import (
    Classroom,
    Coursework,
    CourseworkStatus,
    Enrollment,
    EnrollmentStatus,
    Guardian,
    Submission,
    SubmissionStatus,
)

router = APIRouter(prefix="/api/lms", tags=["guardians"])

_NON_GRADEABLE = {"material"}


def require_parent(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if user.role != "parent":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return user


def require_teacher(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if user.role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return user


class InviteGuardianRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)
    guardian_email: str = Field(alias="guardianEmail", min_length=3, max_length=255)


def serialize_guardian(g: Guardian) -> dict:
    return {
        "id": g.id,
        "studentId": g.student_id,
        "guardianEmail": g.guardian_email,
        "guardianUserId": g.guardian_user_id,
        "status": g.status,
        "createdAt": g.created_at.isoformat() if g.created_at else None,
    }


def _teacher_teaches_student(db: Session, teacher: AuthUser, student_id: str) -> Classroom | None:
    return db.scalar(
        select(Classroom)
        .join(Enrollment, Enrollment.classroom_id == Classroom.id)
        .where(
            Enrollment.student_id == student_id,
            Enrollment.status == EnrollmentStatus.ACTIVE.value,
            Classroom.teacher_id == teacher.user_id,
            Classroom.school_id == teacher.school_id,
            Classroom.is_deleted.is_(False),
        )
    )


# ── Teacher: guardian roster ─────────────────────────────────────────────────

@router.post("/students/{student_id}/guardians", status_code=status.HTTP_201_CREATED)
def invite_guardian(
    student_id: str,
    body: InviteGuardianRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = _teacher_teaches_student(db, user, student_id)
    if not classroom:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not teach this student.",
        )
    email = str(body.guardian_email).strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid guardian email is required.")
    existing = db.scalar(
        select(Guardian).where(
            Guardian.student_id == student_id,
            Guardian.guardian_email == email,
            Guardian.status != "removed",
        )
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That guardian is already invited.")

    # Denormalize the student's display name from an active enrollment.
    enrollment = db.scalar(
        select(Enrollment).where(
            Enrollment.student_id == student_id,
            Enrollment.status == EnrollmentStatus.ACTIVE.value,
        )
    )
    guardian = Guardian(
        student_id=student_id,
        school_id=user.school_id,
        student_name=enrollment.student_name if enrollment else None,
        guardian_email=email,
        status="pending",
        token=secrets.token_urlsafe(24),
        invited_by=user.user_id,
    )
    db.add(guardian)
    db.commit()
    db.refresh(guardian)
    return serialize_guardian(guardian)


@router.get("/students/{student_id}/guardians")
def list_student_guardians(
    student_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    if not _teacher_teaches_student(db, user, student_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not teach this student.")
    guardians = list(
        db.scalars(
            select(Guardian).where(
                Guardian.student_id == student_id,
                Guardian.status != "removed",
            )
        ).all()
    )
    return {"guardians": [serialize_guardian(g) for g in guardians]}


@router.delete("/guardians/{guardian_id}")
def remove_guardian(
    guardian_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    guardian = db.scalar(select(Guardian).where(Guardian.id == guardian_id))
    if not guardian or guardian.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guardian link not found.")
    if not _teacher_teaches_student(db, user, guardian.student_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not teach this student.")
    db.delete(guardian)
    db.commit()
    return {"ok": True, "guardianId": guardian_id}


# ── Guardian (parent role): read-only summaries ──────────────────────────────

@router.get("/guardian/students")
def guardian_students(
    user: AuthUser = Depends(require_parent),
    db: Session = Depends(get_db),
):
    """The parent's linked students (from the JWT), enriched with a display name
    from any active enrollment in this school."""
    out = []
    for student_id in user.student_ids:
        enrollment = db.scalar(
            select(Enrollment).where(
                Enrollment.student_id == student_id,
                Enrollment.school_id == user.school_id,
                Enrollment.status == EnrollmentStatus.ACTIVE.value,
            )
        )
        out.append(
            {
                "studentId": student_id,
                "studentName": enrollment.student_name if enrollment else None,
            }
        )
    return {"students": out}


@router.get("/guardian/students/{student_id}/summary")
def guardian_summary(
    student_id: str,
    user: AuthUser = Depends(require_parent),
    db: Session = Depends(get_db),
):
    if student_id not in user.student_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a guardian of this student.",
        )

    now = datetime.now(timezone.utc)
    upcoming: list[dict] = []
    missing: list[dict] = []
    recent_grades: list[dict] = []

    classrooms = list(
        db.scalars(
            select(Classroom)
            .join(Enrollment, Enrollment.classroom_id == Classroom.id)
            .where(
                Enrollment.student_id == student_id,
                Enrollment.status == EnrollmentStatus.ACTIVE.value,
                Classroom.school_id == user.school_id,
                Classroom.is_deleted.is_(False),
            )
        ).all()
    )
    for classroom in classrooms:
        items = db.scalars(
            select(Coursework).where(
                Coursework.classroom_id == classroom.id,
                Coursework.status == CourseworkStatus.PUBLISHED.value,
            )
        ).all()
        for cw in items:
            if cw.type in _NON_GRADEABLE:
                continue
            submission = db.scalar(
                select(Submission).where(
                    Submission.coursework_id == cw.id,
                    Submission.student_id == student_id,
                )
            )
            entry = {
                "courseworkId": cw.id,
                "classroomName": classroom.name,
                "title": cw.title,
                "dueAt": cw.due_at.isoformat() if cw.due_at else None,
            }
            submitted = bool(
                submission
                and submission.status in (SubmissionStatus.TURNED_IN.value, SubmissionStatus.RETURNED.value)
            )
            if submitted and submission.status == SubmissionStatus.RETURNED.value and submission.grade is not None:
                recent_grades.append(
                    {**entry, "score": float(submission.grade),
                     "maxPoints": float(cw.max_points) if cw.max_points is not None else None}
                )
            elif not submitted and cw.due_at and cw.due_at < now:
                missing.append(entry)
            elif not submitted and cw.due_at and cw.due_at >= now:
                upcoming.append(entry)

    return {
        "studentId": student_id,
        "upcoming": sorted(upcoming, key=lambda e: e["dueAt"] or ""),
        "missing": missing,
        "recentGrades": recent_grades[-10:],
        "generatedAt": now.isoformat(),
    }
