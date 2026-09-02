"""Gradebook — teacher grade matrix + CSV export (Google Classroom parity).

Read-only aggregation over published gradeable coursework and their submissions;
no schema of its own. Ported from v2 ``services/learner/gradebook_service.py``,
using the foundation's Submission.grade / status(returned) fields. Submissions
for the whole classroom are loaded in a single query (no N×M fan-out).
"""
from __future__ import annotations

import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import AuthUser, get_current_user
from classrooms import list_enrollments
from database import get_db
from membership import require_teacher_of
from models import Coursework, CourseworkStatus, Submission, SubmissionStatus

router = APIRouter(prefix="/api/lms", tags=["gradebook"])

# Everything except reference "material" is gradeable in the foundation's type set.
_NON_GRADEABLE = {"material"}


def _num(value) -> float | None:
    return float(value) if value is not None else None


def build_gradebook(db: Session, classroom_id: str, *, sort_by: str = "name", order: str = "asc") -> dict:
    published = list(
        db.scalars(
            select(Coursework)
            .where(
                Coursework.classroom_id == classroom_id,
                Coursework.status == CourseworkStatus.PUBLISHED.value,
            )
            .order_by(Coursework.published_at.asc().nullslast(), Coursework.created_at.asc())
        ).all()
    )
    gradeable = [cw for cw in published if cw.type not in _NON_GRADEABLE]
    columns = [
        {
            "courseworkId": cw.id,
            "title": cw.title,
            "type": cw.type,
            "maxPoints": _num(cw.max_points),
            "dueAt": cw.due_at.isoformat() if cw.due_at else None,
        }
        for cw in gradeable
    ]

    submissions: dict[tuple[str, str], Submission] = {}
    if gradeable:
        rows = db.scalars(
            select(Submission).where(
                Submission.coursework_id.in_([cw.id for cw in gradeable])
            )
        ).all()
        for sub in rows:
            submissions[(sub.coursework_id, sub.student_id)] = sub

    students = list_enrollments(db, classroom_id, status_filter="active")
    result_rows: list[dict] = []
    for enrollment in students:
        cells: dict[str, dict] = {}
        earned = possible = 0.0
        for cw in gradeable:
            sub = submissions.get((cw.id, enrollment.student_id))
            cell = {"status": "missing", "score": None, "returned": False}
            if sub:
                cell["status"] = sub.status
                if sub.grade is not None:
                    cell["score"] = _num(sub.grade)
                    returned = sub.status == SubmissionStatus.RETURNED.value
                    cell["returned"] = returned
                    if returned:
                        earned += float(sub.grade)
                        possible += float(cw.max_points) if cw.max_points is not None else 0.0
            cells[cw.id] = cell
        average = round((earned / possible) * 100, 1) if possible else None
        result_rows.append(
            {
                "studentId": enrollment.student_id,
                "studentName": enrollment.student_name or "Student",
                "cells": cells,
                "averagePercent": average,
            }
        )

    reverse = order == "desc"
    if sort_by == "average":
        result_rows.sort(
            key=lambda r: (r["averagePercent"] is None, r["averagePercent"] or 0), reverse=reverse
        )
    else:
        result_rows.sort(key=lambda r: (r["studentName"] or "").lower(), reverse=reverse)

    averages = [r["averagePercent"] for r in result_rows if r["averagePercent"] is not None]
    return {
        "classroomId": classroom_id,
        "columns": columns,
        "rows": result_rows,
        "classAveragePercent": round(sum(averages) / len(averages), 1) if averages else None,
        "studentCount": len(students),
    }


@router.get("/classrooms/{classroom_id}/gradebook")
def get_gradebook(
    classroom_id: str,
    sort_by: Annotated[str, Query(alias="sortBy")] = "name",
    order: Annotated[str, Query()] = "asc",
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_teacher_of(db, user, classroom_id)
    return build_gradebook(db, classroom_id, sort_by=sort_by, order=order)


@router.get("/classrooms/{classroom_id}/gradebook.csv")
def export_gradebook_csv(
    classroom_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_teacher_of(db, user, classroom_id)
    book = build_gradebook(db, classroom_id)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Student"] + [c["title"] for c in book["columns"]] + ["Average %"])
    for row in book["rows"]:
        line: list = [row["studentName"]]
        for col in book["columns"]:
            cell = row["cells"][col["courseworkId"]]
            line.append("" if cell["score"] is None else cell["score"])
        line.append("" if row["averagePercent"] is None else row["averagePercent"])
        writer.writerow(line)
    return PlainTextResponse(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="gradebook-{classroom_id}.csv"'},
    )
