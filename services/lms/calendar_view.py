"""Calendar — coursework due-date aggregation across a user's classes.

Read-only; reuses coursework ``due_at``. Daily/weekly/monthly views are just the
[start, end] range the caller passes. Ported from v2
``services/learner/calendar_service.py``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

import classrooms as cr
from auth import AuthUser, get_current_user
from database import get_db
from models import Coursework, CourseworkStatus

router = APIRouter(prefix="/api/lms", tags=["calendar"])

_NON_GRADEABLE = {"material"}


def _accessible_classroom_ids(db: Session, user: AuthUser) -> dict[str, str]:
    """Map of classroom_id -> name for classes the user teaches or is enrolled in."""
    if user.role == "teacher":
        classrooms = cr.list_teacher_classrooms(db, user, only_archived=False)
    elif user.role == "student":
        classrooms = cr.list_student_classrooms(db, user)
    else:
        classrooms = []
    return {c.id: c.name for c in classrooms}


@router.get("/calendar")
def calendar(
    start: Annotated[datetime | None, Query()] = None,
    end: Annotated[datetime | None, Query()] = None,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    start = start or now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = end or (start + timedelta(days=30))

    names = _accessible_classroom_ids(db, user)
    by_date: dict[str, list[dict]] = {}
    if names:
        items = db.scalars(
            select(Coursework).where(
                Coursework.classroom_id.in_(list(names.keys())),
                Coursework.status == CourseworkStatus.PUBLISHED.value,
                Coursework.due_at.is_not(None),
                Coursework.due_at >= start,
                Coursework.due_at <= end,
            )
        ).all()
        for cw in items:
            if cw.type in _NON_GRADEABLE:
                continue
            day = cw.due_at.date().isoformat()
            by_date.setdefault(day, []).append(
                {
                    "courseworkId": cw.id,
                    "classroomId": cw.classroom_id,
                    "classroomName": names.get(cw.classroom_id),
                    "title": cw.title,
                    "type": cw.type,
                    "dueAt": cw.due_at.isoformat(),
                    "maxPoints": float(cw.max_points) if cw.max_points is not None else None,
                }
            )

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": [
            {"date": day, "events": sorted(evs, key=lambda e: e["dueAt"])}
            for day, evs in sorted(by_date.items())
        ],
        "total": sum(len(v) for v in by_date.values()),
    }
