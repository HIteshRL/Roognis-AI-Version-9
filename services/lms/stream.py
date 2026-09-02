"""Stream — classroom announcements (Google Classroom parity).

Teachers always post; students may post only when the class's
``settings["stream_permission"] == "post_and_comment"``. Students see published
posts only; teachers additionally see their own drafts and scheduled posts.
Comments on a post live in discussions.py (``Comment.announcement_id``).

Ported from v2 ``services/learner/stream_service.py`` into the foundation's sync
direct-SQLAlchemy style; publishing a post notifies every enrolled student.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import notifications as notify
from auth import AuthUser, get_current_user
from classrooms import list_enrollments
from database import get_db
from membership import require_member
from models import Announcement, Comment

router = APIRouter(prefix="/api/lms", tags=["stream"])

_DEFAULT_PERMISSION = "comment_only"
_STATUSES = ("draft", "scheduled", "published")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Request bodies ───────────────────────────────────────────────────────────

class Attachment(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    type: str = Field(default="link")
    url: str | None = None
    title: str | None = None


class CreateAnnouncementRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)
    body: str = Field(min_length=1)
    title: str | None = Field(default=None, max_length=240)
    attachments: list[Attachment] = Field(default_factory=list)
    status: str = Field(default="published")
    scheduled_for: datetime | None = Field(default=None, alias="scheduledFor")
    is_pinned: bool = Field(default=False, alias="isPinned")


class UpdateAnnouncementRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)
    body: str | None = None
    title: str | None = Field(default=None, max_length=240)
    attachments: list[Attachment] | None = None
    scheduled_for: datetime | None = Field(default=None, alias="scheduledFor")
    is_pinned: bool | None = Field(default=None, alias="isPinned")


class PinRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    pinned: bool = True


# ── Serializer ───────────────────────────────────────────────────────────────

def _comment_count(db: Session, announcement_id: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Comment)
        .where(Comment.announcement_id == announcement_id, Comment.is_deleted.is_(False))
    ) or 0


def serialize_announcement(db: Session, a: Announcement) -> dict:
    return {
        "id": a.id,
        "classroomId": a.classroom_id,
        "authorId": a.author_id,
        "authorName": a.author_name or "Teacher",
        "title": a.title,
        "body": a.body,
        "attachments": a.attachments or [],
        "status": a.status,
        "scheduledFor": a.scheduled_for.isoformat() if a.scheduled_for else None,
        "isPinned": a.is_pinned,
        "publishedAt": a.published_at.isoformat() if a.published_at else None,
        "commentCount": _comment_count(db, a.id),
        "createdAt": a.created_at.isoformat() if a.created_at else None,
        "updatedAt": a.updated_at.isoformat() if a.updated_at else None,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_editable(db: Session, user: AuthUser, announcement_id: str) -> Announcement:
    announcement = db.scalar(
        select(Announcement).where(
            Announcement.id == announcement_id,
            Announcement.is_deleted.is_(False),
        )
    )
    if not announcement or announcement.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")
    classroom, is_teacher = require_member(db, user, announcement.classroom_id)
    if announcement.author_id != user.user_id and not is_teacher:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or a teacher can modify this post.",
        )
    return announcement


def _notify_students(db: Session, classroom, announcement: Announcement) -> None:
    student_ids = [
        e.student_id
        for e in list_enrollments(db, classroom.id, status_filter="active")
        if e.student_id != announcement.author_id
    ]
    notify.emit_many(
        db,
        user_ids=student_ids,
        school_id=classroom.school_id,
        type="new_announcement",
        title=f"New post in {classroom.name}",
        body=(announcement.title or announcement.body)[:200],
        data={"classroomId": classroom.id, "announcementId": announcement.id},
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/classrooms/{classroom_id}/announcements", status_code=status.HTTP_201_CREATED)
def create_announcement(
    classroom_id: str,
    body: CreateAnnouncementRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    classroom, is_teacher = require_member(db, user, classroom_id)
    permission = (classroom.settings or {}).get("stream_permission", _DEFAULT_PERMISSION)
    if not is_teacher and permission != "post_and_comment":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can post to the stream in this class.",
        )

    post_status = body.status if body.status in _STATUSES else "published"
    scheduled_for = None
    published_at = None
    if post_status == "scheduled":
        if not body.scheduled_for:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A scheduled post needs a scheduledFor time.",
            )
        scheduled_for = body.scheduled_for
    elif post_status == "published":
        published_at = _now()

    announcement = Announcement(
        classroom_id=classroom_id,
        school_id=user.school_id,
        author_id=user.user_id,
        author_name=user.name or None,
        title=body.title,
        body=body.body,
        attachments=[a.model_dump() for a in body.attachments],
        status=post_status,
        scheduled_for=scheduled_for,
        is_pinned=body.is_pinned if is_teacher else False,
        published_at=published_at,
    )
    db.add(announcement)
    db.flush()
    if post_status == "published":
        _notify_students(db, classroom, announcement)
    db.commit()
    db.refresh(announcement)
    return serialize_announcement(db, announcement)


@router.get("/classrooms/{classroom_id}/announcements")
def list_announcements(
    classroom_id: str,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _classroom, is_teacher = require_member(db, user, classroom_id)
    query = select(Announcement).where(
        Announcement.classroom_id == classroom_id,
        Announcement.is_deleted.is_(False),
    )
    if not is_teacher:
        query = query.where(Announcement.status == "published")
    query = query.order_by(
        Announcement.is_pinned.desc(),
        Announcement.published_at.desc().nullslast(),
        Announcement.created_at.desc(),
    ).limit(limit)
    items = list(db.scalars(query).all())
    return {"announcements": [serialize_announcement(db, a) for a in items]}


@router.patch("/announcements/{announcement_id}")
def update_announcement(
    announcement_id: str,
    body: UpdateAnnouncementRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    announcement = _get_editable(db, user, announcement_id)
    if body.body is not None:
        announcement.body = body.body
    if body.title is not None:
        announcement.title = body.title
    if body.attachments is not None:
        announcement.attachments = [a.model_dump() for a in body.attachments]
    if body.scheduled_for is not None:
        announcement.scheduled_for = body.scheduled_for
    if body.is_pinned is not None:
        announcement.is_pinned = body.is_pinned
    db.commit()
    db.refresh(announcement)
    return serialize_announcement(db, announcement)


@router.post("/announcements/{announcement_id}/publish")
def publish_announcement(
    announcement_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    announcement = _get_editable(db, user, announcement_id)
    if announcement.status != "published":
        classroom, _ = require_member(db, user, announcement.classroom_id)
        announcement.status = "published"
        announcement.scheduled_for = None
        announcement.published_at = _now()
        db.flush()
        _notify_students(db, classroom, announcement)
        db.commit()
        db.refresh(announcement)
    return serialize_announcement(db, announcement)


@router.post("/announcements/{announcement_id}/pin")
def pin_announcement(
    announcement_id: str,
    body: PinRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    announcement = db.scalar(
        select(Announcement).where(
            Announcement.id == announcement_id,
            Announcement.is_deleted.is_(False),
        )
    )
    if not announcement or announcement.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found.")
    # Pinning is a teacher-only moderation action.
    _classroom, is_teacher = require_member(db, user, announcement.classroom_id)
    if not is_teacher:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a teacher can pin posts.")
    announcement.is_pinned = body.pinned
    db.commit()
    db.refresh(announcement)
    return serialize_announcement(db, announcement)


@router.delete("/announcements/{announcement_id}")
def delete_announcement(
    announcement_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    announcement = _get_editable(db, user, announcement_id)
    announcement.is_deleted = True
    db.commit()
    return {"ok": True, "announcementId": announcement_id}
