"""Coursework + submission + grading logic.

Ported from Roognis v2 `services/learner/{coursework,submission,gradebook}_service.py`
into main4's direct-SQLAlchemy style. Teachers author coursework against a
classroom they own; enrolled students submit; teachers grade and return.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import AuthUser
from classrooms import get_owned_classroom, require_enrolled
from models import (
    Coursework,
    CourseworkStatus,
    CourseworkType,
    Submission,
    SubmissionStatus,
)

_VALID_TYPES = {item.value for item in CourseworkType}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _num(value) -> float | None:
    return float(value) if value is not None else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Serializers ──────────────────────────────────────────────────────────────

def serialize_coursework(
    coursework: Coursework,
    *,
    stats: dict | None = None,
    my_submission: Submission | None = None,
    include_my_submission: bool = False,
) -> dict:
    payload = {
        "id": coursework.id,
        "classroomId": coursework.classroom_id,
        "chapterId": coursework.chapter_id,
        "schoolId": coursework.school_id,
        "teacherId": coursework.teacher_id,
        "type": coursework.type,
        "title": coursework.title,
        "description": coursework.description,
        "topic": coursework.topic,
        "topicId": coursework.topic_id,
        "maxPoints": _num(coursework.max_points),
        "dueAt": _iso(coursework.due_at),
        "status": coursework.status,
        "publishedAt": _iso(coursework.published_at),
        "attachments": coursework.attachments or {},
        "createdAt": _iso(coursework.created_at),
        "updatedAt": _iso(coursework.updated_at),
    }
    if stats is not None:
        payload["submissionStats"] = stats
    # Student views always carry the key (null when not yet submitted) so the
    # client can rely on it; teacher views omit it entirely.
    if include_my_submission or my_submission is not None:
        payload["mySubmission"] = serialize_submission(my_submission) if my_submission is not None else None
    return payload


def serialize_submission(submission: Submission) -> dict:
    return {
        "id": submission.id,
        "courseworkId": submission.coursework_id,
        "studentId": submission.student_id,
        "studentName": submission.student_name,
        "status": submission.status,
        "content": submission.content or {},
        "grade": _num(submission.grade),
        "feedback": submission.feedback,
        "turnedInAt": _iso(submission.turned_in_at),
        "gradedAt": _iso(submission.graded_at),
        "createdAt": _iso(submission.created_at),
        "updatedAt": _iso(submission.updated_at),
    }


# ── Coursework (teacher) ─────────────────────────────────────────────────────

def create_coursework(db: Session, user: AuthUser, classroom, dto) -> Coursework:
    work_type = dto.type if dto.type in _VALID_TYPES else CourseworkType.ASSIGNMENT.value

    chapter_id = None
    if dto.chapter_id:
        chapter_id = _validated_chapter_id(db, classroom.id, dto.chapter_id)

    coursework = Coursework(
        classroom_id=classroom.id,
        chapter_id=chapter_id,
        school_id=user.school_id,
        teacher_id=user.user_id,
        type=work_type,
        title=dto.title,
        description=dto.description,
        topic=dto.topic,
        max_points=dto.max_points,
        due_at=dto.due_at,
        attachments=dto.attachments or {},
        status=CourseworkStatus.DRAFT.value,
    )
    db.add(coursework)
    db.flush()
    return coursework


def _validated_chapter_id(db: Session, classroom_id: str, chapter_id: str) -> str:
    from models import Chapter

    exists = db.scalar(
        select(Chapter.id).where(Chapter.id == chapter_id, Chapter.classroom_id == classroom_id)
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chapter is not in this classroom.")
    return chapter_id


def get_owned_coursework(db: Session, user: AuthUser, coursework_id: str) -> Coursework:
    coursework = db.scalar(select(Coursework).where(Coursework.id == coursework_id))
    if not coursework or coursework.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coursework not found.")
    get_owned_classroom(db, user, coursework.classroom_id)
    return coursework


def update_coursework(db: Session, coursework: Coursework, dto) -> Coursework:
    if dto.title is not None:
        coursework.title = dto.title
    if dto.description is not None:
        coursework.description = dto.description
    if dto.topic is not None:
        coursework.topic = dto.topic
    if dto.max_points is not None:
        coursework.max_points = dto.max_points
    if dto.due_at is not None:
        coursework.due_at = dto.due_at
    if dto.attachments is not None:
        coursework.attachments = dto.attachments
    if dto.chapter_id is not None:
        coursework.chapter_id = _validated_chapter_id(db, coursework.classroom_id, dto.chapter_id) if dto.chapter_id else None
    db.flush()
    return coursework


def publish_coursework(db: Session, coursework: Coursework) -> Coursework:
    if coursework.status != CourseworkStatus.PUBLISHED.value:
        coursework.status = CourseworkStatus.PUBLISHED.value
        coursework.published_at = _now()
        db.flush()
    return coursework


def list_coursework(db: Session, classroom_id: str, *, status_filter: str | None = None) -> list[Coursework]:
    query = select(Coursework).where(Coursework.classroom_id == classroom_id)
    if status_filter:
        query = query.where(Coursework.status == status_filter)
    return list(db.scalars(query.order_by(Coursework.created_at.desc())).all())


def submission_stats(db: Session, coursework_id: str) -> dict:
    rows = db.execute(
        select(Submission.status, func.count())
        .where(Submission.coursework_id == coursework_id)
        .group_by(Submission.status)
    ).all()
    by_status = {row[0]: row[1] for row in rows}
    turned_in = by_status.get(SubmissionStatus.TURNED_IN.value, 0)
    returned = by_status.get(SubmissionStatus.RETURNED.value, 0)
    return {
        "total": turned_in + returned + by_status.get(SubmissionStatus.ASSIGNED.value, 0),
        "turnedIn": turned_in,
        "graded": returned,
    }


# ── Coursework (student) ─────────────────────────────────────────────────────

def list_published_coursework(db: Session, classroom_id: str) -> list[Coursework]:
    query = (
        select(Coursework)
        .where(
            Coursework.classroom_id == classroom_id,
            Coursework.status == CourseworkStatus.PUBLISHED.value,
        )
        .order_by(Coursework.published_at.desc().nullslast(), Coursework.created_at.desc())
    )
    return list(db.scalars(query).all())


def get_published_coursework_for_student(db: Session, user: AuthUser, coursework_id: str) -> Coursework:
    coursework = db.scalar(select(Coursework).where(Coursework.id == coursework_id))
    if (
        not coursework
        or coursework.school_id != user.school_id
        or coursework.status != CourseworkStatus.PUBLISHED.value
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coursework not found.")
    require_enrolled(db, user, coursework.classroom_id)
    return coursework


def get_student_submission(db: Session, coursework_id: str, student_id: str) -> Submission | None:
    return db.scalar(
        select(Submission).where(
            Submission.coursework_id == coursework_id,
            Submission.student_id == student_id,
        )
    )


def submit_coursework(db: Session, user: AuthUser, coursework: Coursework, content: dict) -> Submission:
    if coursework.type == CourseworkType.MATERIAL.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Material coursework cannot be submitted.")

    submission = get_student_submission(db, coursework.id, user.user_id)
    if submission and submission.status == SubmissionStatus.RETURNED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This submission has already been graded.")

    if submission:
        submission.content = content
        submission.status = SubmissionStatus.TURNED_IN.value
        submission.turned_in_at = _now()
        if user.name:
            submission.student_name = user.name
    else:
        submission = Submission(
            coursework_id=coursework.id,
            student_id=user.user_id,
            student_name=user.name or None,
            school_id=user.school_id,
            status=SubmissionStatus.TURNED_IN.value,
            content=content,
            turned_in_at=_now(),
        )
        db.add(submission)
    db.flush()
    return submission


def list_student_submissions(db: Session, user: AuthUser) -> list[Submission]:
    query = (
        select(Submission)
        .where(Submission.student_id == user.user_id, Submission.school_id == user.school_id)
        .order_by(Submission.updated_at.desc())
    )
    return list(db.scalars(query).all())


# ── Grading (teacher) ────────────────────────────────────────────────────────

def list_submissions(db: Session, coursework_id: str) -> list[Submission]:
    query = (
        select(Submission)
        .where(Submission.coursework_id == coursework_id)
        .order_by(Submission.turned_in_at.asc().nullslast(), Submission.created_at.asc())
    )
    return list(db.scalars(query).all())


def get_owned_submission(db: Session, user: AuthUser, submission_id: str) -> tuple[Submission, Coursework]:
    submission = db.scalar(select(Submission).where(Submission.id == submission_id))
    if not submission or submission.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found.")
    coursework = get_owned_coursework(db, user, submission.coursework_id)
    return submission, coursework


def grade_submission(db: Session, user: AuthUser, submission: Submission, coursework: Coursework, dto) -> Submission:
    if coursework.max_points is not None and dto.grade > float(coursework.max_points):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Grade cannot exceed maxPoints ({float(coursework.max_points)}).",
        )
    submission.grade = dto.grade
    submission.feedback = dto.feedback
    submission.graded_by = user.user_id
    submission.graded_at = _now()
    if dto.return_to_student:
        submission.status = SubmissionStatus.RETURNED.value
    db.flush()
    return submission
