"""In-app notification center + emission helpers (ported from v2 learner
notification_service).

Emission is *fail-open*: a failed notification must never break the request that
triggered it (posting an announcement, replying to a comment, inviting a
guardian). Reading and marking are ordinary authenticated endpoints. Emission
helpers only ``flush`` — the calling route owns the ``commit``.
"""
from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from auth import AuthUser, get_current_user
from database import get_db
from models import Notification

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/lms", tags=["notifications"])


# ── Emission (fail-open, flush-only) ─────────────────────────────────────────

def emit(
    db: Session,
    *,
    user_id: str,
    school_id: str,
    type: str,
    title: str,
    body: str = "",
    data: dict | None = None,
) -> None:
    try:
        db.add(
            Notification(
                user_id=user_id,
                school_id=school_id,
                type=type,
                title=title,
                body=body,
                data=data or {},
            )
        )
        db.flush()
    except Exception as exc:  # noqa: BLE001 — notifications must never break the trigger
        logger.warning("notification emit failed (%s): %s", type, exc)


def emit_many(
    db: Session,
    *,
    user_ids: Iterable[str],
    school_id: str,
    type: str,
    title: str,
    body: str = "",
    data: dict | None = None,
) -> None:
    for uid in user_ids:
        emit(db, user_id=uid, school_id=school_id, type=type, title=title, body=body, data=data)


# ── Serializer ───────────────────────────────────────────────────────────────

def serialize_notification(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "data": n.data or {},
        "isRead": n.is_read,
        "createdAt": n.created_at.isoformat() if n.created_at else None,
    }


# ── Reading (fail-closed) ────────────────────────────────────────────────────

@router.get("/notifications")
def list_notifications(
    unread_only: Annotated[bool, Query(alias="unreadOnly")] = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Notification).where(Notification.user_id == user.user_id)
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    items = list(db.scalars(query.order_by(Notification.created_at.desc()).limit(limit)).all())
    unread = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
    ) or 0
    return {
        "notifications": [serialize_notification(n) for n in items],
        "unreadCount": unread,
    }


@router.get("/notifications/unread-count")
def unread_count(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
    ) or 0
    return {"unreadCount": count}


@router.post("/notifications/{notification_id}/read")
def mark_read(
    notification_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notification = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.user_id,
        )
    )
    if notification and not notification.is_read:
        notification.is_read = True
        db.commit()
    return {"ok": True, "notificationId": notification_id}


@router.post("/notifications/read-all")
def mark_all_read(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
    return {"ok": True}
