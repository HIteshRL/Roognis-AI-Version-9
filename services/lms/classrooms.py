"""Classroom / chapter / enrollment domain logic.

Ported from Roognis v2 `services/learner/classroom_service.py`, rewritten in the
direct-SQLAlchemy style used by main4's RAG service: functions take a `Session`
and the authenticated `AuthUser`, enforce school-scoping + teacher ownership,
and raise `HTTPException` on violations. Serializers emit camelCase to match the
Node services' JSON contract.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import AuthUser
from models import (
    CLASSROOM_COLORS,
    Chapter,
    Classroom,
    Enrollment,
    EnrollmentStatus,
    generate_join_code,
)

_JOIN_CODE_MAX_ATTEMPTS = 6


# ── Serializers ──────────────────────────────────────────────────────────────

def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_classroom(classroom: Classroom, student_count: int, chapter_count: int) -> dict:
    return {
        "id": classroom.id,
        "schoolId": classroom.school_id,
        "teacherId": classroom.teacher_id,
        "name": classroom.name,
        "subject": classroom.subject,
        "section": classroom.section,
        "room": classroom.room,
        "grade": classroom.grade,
        "description": classroom.description,
        "color": classroom.color,
        "joinCode": classroom.join_code,
        "joinCodeEnabled": classroom.join_code_enabled,
        "isArchived": classroom.is_archived,
        "settings": classroom.settings or {},
        "studentCount": student_count,
        "chapterCount": chapter_count,
        "createdAt": _iso(classroom.created_at),
        "updatedAt": _iso(classroom.updated_at),
    }


def serialize_student_classroom(classroom: Classroom, chapter_count: int) -> dict:
    return {
        "id": classroom.id,
        "name": classroom.name,
        "subject": classroom.subject,
        "section": classroom.section,
        "grade": classroom.grade,
        "color": classroom.color,
        "teacherId": classroom.teacher_id,
        "chapterCount": chapter_count,
        "createdAt": _iso(classroom.created_at),
    }


def serialize_chapter(chapter: Chapter, document_count: int = 0) -> dict:
    return {
        "id": chapter.id,
        "classroomId": chapter.classroom_id,
        "knowledgeBaseId": chapter.knowledge_base_id,
        "title": chapter.title,
        "description": chapter.description,
        "orderIndex": chapter.order_index,
        "isPublished": chapter.is_published,
        "documentCount": document_count,
        "createdAt": _iso(chapter.created_at),
        "updatedAt": _iso(chapter.updated_at),
    }


def serialize_enrollment(enrollment: Enrollment) -> dict:
    return {
        "studentId": enrollment.student_id,
        "studentName": enrollment.student_name,
        "status": enrollment.status,
        "role": enrollment.role,
        "joinedAt": _iso(enrollment.joined_at),
    }


# ── Counts ───────────────────────────────────────────────────────────────────

def count_students(db: Session, classroom_id: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Enrollment)
        .where(
            Enrollment.classroom_id == classroom_id,
            Enrollment.status == EnrollmentStatus.ACTIVE.value,
        )
    ) or 0


def count_chapters(db: Session, classroom_id: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Chapter)
        .where(Chapter.classroom_id == classroom_id)
    ) or 0


# ── Classroom lifecycle (teacher) ────────────────────────────────────────────

def unique_join_code(db: Session) -> str:
    for _ in range(_JOIN_CODE_MAX_ATTEMPTS):
        code = generate_join_code()
        exists = db.scalar(select(Classroom.id).where(Classroom.join_code == code))
        if not exists:
            return code
    return generate_join_code()


def create_classroom(db: Session, user: AuthUser, dto) -> Classroom:
    existing = db.scalar(
        select(func.count())
        .select_from(Classroom)
        .where(Classroom.teacher_id == user.user_id, Classroom.is_deleted.is_(False))
    ) or 0
    color = dto.color or CLASSROOM_COLORS[existing % len(CLASSROOM_COLORS)]

    classroom = Classroom(
        school_id=user.school_id,
        teacher_id=user.user_id,
        name=dto.name,
        subject=dto.subject,
        section=dto.section,
        room=dto.room,
        grade=dto.grade,
        description=dto.description,
        color=color,
        join_code=unique_join_code(db),
        settings={"require_approval": bool(dto.require_approval)},
    )
    db.add(classroom)
    db.flush()
    return classroom


def list_teacher_classrooms(db: Session, user: AuthUser, *, only_archived: bool = False) -> list[Classroom]:
    query = select(Classroom).where(
        Classroom.teacher_id == user.user_id,
        Classroom.school_id == user.school_id,
        Classroom.is_deleted.is_(False),
        Classroom.is_archived.is_(only_archived),
    )
    return list(db.scalars(query.order_by(Classroom.created_at.desc())).all())


def get_owned_classroom(db: Session, user: AuthUser, classroom_id: str) -> Classroom:
    classroom = db.scalar(
        select(Classroom).where(
            Classroom.id == classroom_id,
            Classroom.is_deleted.is_(False),
        )
    )
    if not classroom or classroom.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found.")
    if classroom.teacher_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not teach this classroom.")
    return classroom


def update_classroom(db: Session, classroom: Classroom, dto) -> Classroom:
    for field_name in ("name", "subject", "section", "room", "grade", "description", "color"):
        value = getattr(dto, field_name)
        if value is not None:
            setattr(classroom, field_name, value)
    db.flush()
    return classroom


def soft_delete_classroom(db: Session, classroom: Classroom) -> None:
    classroom.is_deleted = True
    db.flush()


def set_archived(db: Session, classroom: Classroom, archived: bool) -> Classroom:
    classroom.is_archived = archived
    db.flush()
    return classroom


def set_join_code_enabled(db: Session, classroom: Classroom, enabled: bool) -> Classroom:
    classroom.join_code_enabled = enabled
    db.flush()
    return classroom


def regenerate_join_code(db: Session, classroom: Classroom) -> Classroom:
    classroom.join_code = unique_join_code(db)
    db.flush()
    return classroom


# ── Chapters (teacher) ───────────────────────────────────────────────────────

def next_order_index(db: Session, classroom_id: str) -> int:
    current = db.scalar(
        select(func.max(Chapter.order_index)).where(Chapter.classroom_id == classroom_id)
    )
    return (current + 1) if current is not None else 0


def add_chapter(db: Session, classroom: Classroom, dto) -> Chapter:
    chapter = Chapter(
        classroom_id=classroom.id,
        school_id=classroom.school_id,
        title=dto.title,
        description=dto.description,
        knowledge_base_id=dto.knowledge_base_id,
        order_index=dto.order_index if dto.order_index is not None else next_order_index(db, classroom.id),
    )
    db.add(chapter)
    db.flush()
    return chapter


def list_chapters(db: Session, classroom_id: str, *, published_only: bool = False) -> list[Chapter]:
    query = select(Chapter).where(Chapter.classroom_id == classroom_id)
    if published_only:
        query = query.where(Chapter.is_published.is_(True))
    return list(db.scalars(query.order_by(Chapter.order_index.asc(), Chapter.created_at.asc())).all())


def get_owned_chapter(db: Session, user: AuthUser, chapter_id: str) -> Chapter:
    chapter = db.scalar(select(Chapter).where(Chapter.id == chapter_id))
    if not chapter or chapter.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found.")
    # Confirms teacher ownership of the parent classroom.
    get_owned_classroom(db, user, chapter.classroom_id)
    return chapter


def update_chapter(db: Session, chapter: Chapter, dto) -> Chapter:
    if dto.title is not None:
        chapter.title = dto.title
    if dto.description is not None:
        chapter.description = dto.description
    if dto.order_index is not None:
        chapter.order_index = dto.order_index
    if dto.is_published is not None:
        chapter.is_published = dto.is_published
    if dto.knowledge_base_id is not None:
        chapter.knowledge_base_id = dto.knowledge_base_id
    db.flush()
    return chapter


def delete_chapter(db: Session, chapter: Chapter) -> None:
    db.delete(chapter)
    db.flush()


# ── Enrollment ───────────────────────────────────────────────────────────────

def get_enrollment(db: Session, classroom_id: str, student_id: str) -> Enrollment | None:
    return db.scalar(
        select(Enrollment).where(
            Enrollment.classroom_id == classroom_id,
            Enrollment.student_id == student_id,
        )
    )


def is_enrolled(db: Session, classroom_id: str, student_id: str) -> bool:
    enrollment = get_enrollment(db, classroom_id, student_id)
    return bool(enrollment and enrollment.status == EnrollmentStatus.ACTIVE.value)


def list_enrollments(db: Session, classroom_id: str, *, status_filter: str | None = None) -> list[Enrollment]:
    query = select(Enrollment).where(Enrollment.classroom_id == classroom_id)
    if status_filter:
        query = query.where(Enrollment.status == status_filter)
    return list(db.scalars(query.order_by(Enrollment.joined_at.asc())).all())


def join_by_code(db: Session, user: AuthUser, code: str) -> tuple[Classroom, str]:
    classroom = db.scalar(
        select(Classroom).where(Classroom.join_code == code.strip().upper())
    )
    if (
        not classroom
        or classroom.is_deleted
        or classroom.is_archived
        or not classroom.join_code_enabled
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No class found for that code.")

    existing = get_enrollment(db, classroom.id, user.user_id)
    if existing and existing.status == EnrollmentStatus.PENDING.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Your join request is awaiting approval.")
    if existing and existing.status == EnrollmentStatus.ACTIVE.value:
        return classroom, existing.status

    requires_approval = bool((classroom.settings or {}).get("require_approval"))
    new_status = EnrollmentStatus.PENDING.value if requires_approval else EnrollmentStatus.ACTIVE.value

    if existing:
        existing.status = new_status
        existing.school_id = user.school_id
        if user.name:
            existing.student_name = user.name
    else:
        db.add(
            Enrollment(
                classroom_id=classroom.id,
                student_id=user.user_id,
                student_name=user.name or None,
                school_id=user.school_id,
                status=new_status,
            )
        )
    db.flush()
    return classroom, new_status


def approve_enrollment(db: Session, classroom_id: str, student_id: str) -> None:
    enrollment = get_enrollment(db, classroom_id, student_id)
    if not enrollment or enrollment.status != EnrollmentStatus.PENDING.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pending request for that student.")
    enrollment.status = EnrollmentStatus.ACTIVE.value
    db.flush()


def reject_enrollment(db: Session, classroom_id: str, student_id: str) -> None:
    enrollment = get_enrollment(db, classroom_id, student_id)
    if not enrollment or enrollment.status != EnrollmentStatus.PENDING.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pending request for that student.")
    db.delete(enrollment)
    db.flush()


def remove_student(db: Session, classroom_id: str, student_id: str) -> None:
    enrollment = get_enrollment(db, classroom_id, student_id)
    if not enrollment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student is not enrolled.")
    db.delete(enrollment)
    db.flush()


def list_student_classrooms(db: Session, user: AuthUser) -> list[Classroom]:
    query = (
        select(Classroom)
        .join(Enrollment, Enrollment.classroom_id == Classroom.id)
        .where(
            Enrollment.student_id == user.user_id,
            Enrollment.status == EnrollmentStatus.ACTIVE.value,
            Classroom.is_deleted.is_(False),
            Classroom.is_archived.is_(False),
        )
        .order_by(Classroom.created_at.desc())
    )
    return list(db.scalars(query).all())


def require_enrolled(db: Session, user: AuthUser, classroom_id: str) -> Classroom:
    classroom = db.scalar(
        select(Classroom).where(Classroom.id == classroom_id, Classroom.is_deleted.is_(False))
    )
    if not classroom or classroom.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found.")
    if not is_enrolled(db, classroom_id, user.user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not enrolled in this class.")
    return classroom
