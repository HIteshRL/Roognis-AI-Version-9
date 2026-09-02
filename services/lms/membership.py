"""Shared membership / authorization helpers for the stream, discussion,
calendar and guardian modules.

A *member* of a classroom is the owning teacher or an actively-enrolled student.
These mirror the ownership guards in classrooms.py but allow either role, which
the social features (stream, comments) need. Everything stays school-scoped and
never reaches across the microservice boundary into auth_db.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import AuthUser
from classrooms import is_enrolled
from models import Classroom


def get_visible_classroom(db: Session, user: AuthUser, classroom_id: str) -> Classroom:
    """Fetch a live classroom in the user's school or raise 404."""
    classroom = db.scalar(
        select(Classroom).where(
            Classroom.id == classroom_id,
            Classroom.is_deleted.is_(False),
        )
    )
    if not classroom or classroom.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found.")
    return classroom


def is_teacher_of(user: AuthUser, classroom: Classroom) -> bool:
    return user.role == "teacher" and classroom.teacher_id == user.user_id


def require_member(db: Session, user: AuthUser, classroom_id: str) -> tuple[Classroom, bool]:
    """Return ``(classroom, is_teacher)`` for a member, else raise 403.

    A member is the owning teacher or an active student of the class.
    """
    classroom = get_visible_classroom(db, user, classroom_id)
    if is_teacher_of(user, classroom):
        return classroom, True
    if user.role == "student" and is_enrolled(db, classroom_id, user.user_id):
        return classroom, False
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not a member of this class.",
    )


def require_teacher_of(db: Session, user: AuthUser, classroom_id: str) -> Classroom:
    """Return the classroom if ``user`` is its owning teacher, else raise."""
    classroom = get_visible_classroom(db, user, classroom_id)
    if not is_teacher_of(user, classroom):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not teach this classroom.",
        )
    return classroom
