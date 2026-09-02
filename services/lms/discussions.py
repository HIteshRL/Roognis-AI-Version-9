"""Classroom discussions — comments on the stream or a coursework item, threaded
replies, emoji reactions and @mentions (with notifications).

Ported from v2 ``services/learner/discussion_service.py``. Both teachers and
enrolled students participate; membership is checked per call. A comment targets
a stream post (``announcementId``), a coursework item (``courseworkId``), or is a
reply to another comment (``parentId``).
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
from database import get_db
from membership import require_member
from models import Comment, CommentReaction

router = APIRouter(prefix="/api/lms", tags=["discussions"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Request bodies ───────────────────────────────────────────────────────────

class CreateCommentRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=5000)
    coursework_id: str | None = Field(default=None, alias="courseworkId")
    announcement_id: str | None = Field(default=None, alias="announcementId")
    parent_id: str | None = Field(default=None, alias="parentId")
    mentions: list[str] = Field(default_factory=list)


class UpdateCommentRequest(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=5000)


class ReactRequest(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    emoji: str = Field(min_length=1, max_length=16)


# ── Serializer ───────────────────────────────────────────────────────────────

def _reaction_summary(db: Session, comment_id: str) -> dict[str, int]:
    rows = db.execute(
        select(CommentReaction.emoji, func.count())
        .where(CommentReaction.comment_id == comment_id)
        .group_by(CommentReaction.emoji)
    ).all()
    return {row[0]: row[1] for row in rows}


def _reply_count(db: Session, comment_id: str) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Comment)
        .where(Comment.parent_id == comment_id, Comment.is_deleted.is_(False))
    ) or 0


def serialize_comment(db: Session, c: Comment) -> dict:
    return {
        "id": c.id,
        "classroomId": c.classroom_id,
        "courseworkId": c.coursework_id,
        "announcementId": c.announcement_id,
        "parentId": c.parent_id,
        "authorId": c.author_id,
        "authorName": c.author_name,
        "body": c.body,
        "mentions": c.mentions or [],
        "reactions": _reaction_summary(db, c.id),
        "replyCount": _reply_count(db, c.id),
        "createdAt": c.created_at.isoformat() if c.created_at else None,
        "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
    }


def _get_comment(db: Session, comment_id: str, user: AuthUser) -> Comment:
    comment = db.scalar(
        select(Comment).where(Comment.id == comment_id, Comment.is_deleted.is_(False))
    )
    if not comment or comment.school_id != user.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")
    return comment


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/classrooms/{classroom_id}/comments", status_code=status.HTTP_201_CREATED)
def create_comment(
    classroom_id: str,
    body: CreateCommentRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    classroom, is_teacher = require_member(db, user, classroom_id)

    # Stream-comment moderation: a "teachers_only" class blocks student comments
    # on announcements.
    if body.announcement_id and not is_teacher:
        permission = (classroom.settings or {}).get("stream_permission", "comment_only")
        if permission == "teachers_only":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only teachers can comment on the stream in this class.",
            )

    parent_id = None
    if body.parent_id:
        parent = db.scalar(
            select(Comment).where(Comment.id == body.parent_id, Comment.is_deleted.is_(False))
        )
        if not parent or parent.classroom_id != classroom_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent comment not found.")
        parent_id = parent.id

    comment = Comment(
        classroom_id=classroom_id,
        school_id=user.school_id,
        author_id=user.user_id,
        author_name=user.name or None,
        body=body.body,
        coursework_id=body.coursework_id,
        announcement_id=body.announcement_id,
        parent_id=parent_id,
        mentions=[m for m in body.mentions if isinstance(m, str)],
    )
    db.add(comment)
    db.flush()

    # @mention notifications.
    mention_targets = [m for m in comment.mentions if m and m != user.user_id]
    if mention_targets:
        notify.emit_many(
            db,
            user_ids=mention_targets,
            school_id=user.school_id,
            type="mention",
            title=f"{user.name or 'Someone'} mentioned you",
            body=comment.body[:200],
            data={"classroomId": classroom_id, "commentId": comment.id},
        )
    # Reply notification to the parent author.
    if parent_id:
        parent = db.scalar(select(Comment).where(Comment.id == parent_id))
        if parent and parent.author_id != user.user_id:
            notify.emit(
                db,
                user_id=parent.author_id,
                school_id=user.school_id,
                type="reply",
                title=f"{user.name or 'Someone'} replied to your comment",
                body=comment.body[:200],
                data={"classroomId": classroom_id, "commentId": comment.id},
            )
    db.commit()
    db.refresh(comment)
    return serialize_comment(db, comment)


@router.get("/classrooms/{classroom_id}/comments")
def list_comments(
    classroom_id: str,
    coursework_id: Annotated[str | None, Query(alias="courseworkId")] = None,
    announcement_id: Annotated[str | None, Query(alias="announcementId")] = None,
    parent_id: Annotated[str | None, Query(alias="parentId")] = None,
    search: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_member(db, user, classroom_id)
    query = select(Comment).where(
        Comment.classroom_id == classroom_id,
        Comment.is_deleted.is_(False),
    )
    # Top-level thread scoping: when no parent is requested, only return roots.
    if parent_id is not None:
        query = query.where(Comment.parent_id == parent_id)
    else:
        query = query.where(Comment.parent_id.is_(None))
    if coursework_id is not None:
        query = query.where(Comment.coursework_id == coursework_id)
    if announcement_id is not None:
        query = query.where(Comment.announcement_id == announcement_id)
    if search:
        query = query.where(Comment.body.ilike(f"%{search}%"))
    items = list(db.scalars(query.order_by(Comment.created_at.asc()).limit(limit)).all())
    return {"comments": [serialize_comment(db, c) for c in items]}


@router.patch("/comments/{comment_id}")
def update_comment(
    comment_id: str,
    body: UpdateCommentRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comment = _get_comment(db, comment_id, user)
    if comment.author_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own comments.")
    comment.body = body.body
    db.commit()
    db.refresh(comment)
    return serialize_comment(db, comment)


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comment = _get_comment(db, comment_id, user)
    _classroom, is_teacher = require_member(db, user, comment.classroom_id)
    if comment.author_id != user.user_id and not is_teacher:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the author or a teacher can delete a comment.",
        )
    comment.is_deleted = True
    comment.deleted_at = _now()
    db.commit()
    return {"ok": True, "commentId": comment_id}


@router.post("/comments/{comment_id}/reactions")
def react(
    comment_id: str,
    body: ReactRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comment = _get_comment(db, comment_id, user)
    require_member(db, user, comment.classroom_id)
    existing = db.scalar(
        select(CommentReaction).where(
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user.user_id,
            CommentReaction.emoji == body.emoji,
        )
    )
    if not existing:
        db.add(CommentReaction(comment_id=comment_id, user_id=user.user_id, emoji=body.emoji))
        db.commit()
    return {"commentId": comment_id, "reactions": _reaction_summary(db, comment_id)}


@router.delete("/comments/{comment_id}/reactions/{emoji}")
def unreact(
    comment_id: str,
    emoji: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    comment = _get_comment(db, comment_id, user)
    existing = db.scalar(
        select(CommentReaction).where(
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user.user_id,
            CommentReaction.emoji == emoji,
        )
    )
    if existing:
        db.delete(existing)
        db.commit()
    return {"commentId": comment_id, "reactions": _reaction_summary(db, comment_id)}
