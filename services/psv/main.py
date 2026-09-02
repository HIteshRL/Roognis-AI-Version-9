from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import AuthUser, require_internal_token, require_student
from config import Settings, get_settings
from database import SessionLocal, get_db, init_db
from models import KnowledgeGapSnapshot, LearningEvent, RefreshRun
from schemas import AggregateRequest, EventBatchInput, InternalEventBatchInput
from service import erase_student_state, persist_events, recompute_student, run_daily_refresh


async def daily_refresh_loop(settings: Settings) -> None:
    # The database run-key lease makes this safe across replicas. Polling is
    # intentionally coarse; evidence is captured immediately but model state
    # changes on the documented daily cadence.
    await asyncio.sleep(30)
    while True:
        now = datetime.now(timezone.utc)
        if now.hour >= settings.daily_refresh_hour_utc:
            run_key = f"academic:{now.date().isoformat()}"
            def run() -> None:
                with SessionLocal() as db:
                    run_daily_refresh(db, settings, run_key)
            try:
                await asyncio.to_thread(run)
            except Exception as exc:
                print(f"[psv] daily refresh failed: {exc}", flush=True)
        await asyncio.sleep(max(300, settings.daily_refresh_poll_seconds))


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    settings = get_settings()
    task = asyncio.create_task(daily_refresh_loop(settings)) if settings.daily_refresh_enabled else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


app = FastAPI(title="Roognis PSV Service", lifespan=lifespan)


@app.get("/health")
@app.get("/api/psv/health")
def health(db: Session = Depends(get_db)):
    latest = db.scalar(select(RefreshRun).where(RefreshRun.status == "done").order_by(RefreshRun.completed_at.desc()))
    return {
        "status": "ok",
        "service": "psv",
        "lastSuccessfulRefreshAt": latest.completed_at if latest else None,
        "academicTrainingStatus": latest.training_status if latest else None,
        "academicTrainingReason": latest.training_reason if latest else None,
    }


@app.post("/api/psv/v1/events/batch", status_code=status.HTTP_202_ACCEPTED)
def ingest_student_events(
    body: EventBatchInput,
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    for event in body.events:
        if event.student_id and event.student_id != user.user_id:
            raise HTTPException(status_code=403, detail="Event studentId does not match the authenticated student.")
        if event.school_id and event.school_id != user.school_id:
            raise HTTPException(status_code=403, detail="Event schoolId does not match the authenticated school.")
    return persist_events(db, body.events, student_id=user.user_id, school_id=user.school_id)


@app.post("/api/psv/internal/events/batch", status_code=status.HTTP_202_ACCEPTED)
def ingest_internal_events(
    body: InternalEventBatchInput,
    _: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    try:
        return persist_events(db, body.events)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def serialize_gap(row: KnowledgeGapSnapshot) -> dict:
    return {
        "conceptId": row.concept_id,
        "mastery": row.mastery,
        "recallStability": row.recall_stability,
        "difficultyReadiness": row.difficulty_readiness,
        "nextDifficulty": row.next_difficulty,
        "scaffold": row.scaffold,
        "gapScore": row.gap_score,
        "confidence": row.confidence,
        "uncertainty": row.uncertainty,
        "evidenceCount": row.evidence_count,
        "decisionSource": row.decision_source,
        "ruleVersion": row.rule_version,
        "modelVersion": row.model_version,
        "lastEvidenceAt": row.last_evidence_at,
        "computedAt": row.computed_at,
    }


@app.get("/api/psv/v1/me/knowledge-gaps")
def my_knowledge_gaps(
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(KnowledgeGapSnapshot).where(
        KnowledgeGapSnapshot.student_id == user.user_id,
        KnowledgeGapSnapshot.school_id == user.school_id,
    ).order_by(KnowledgeGapSnapshot.gap_score.desc())).all()
    return {"studentId": user.user_id, "knowledgeGaps": [serialize_gap(row) for row in rows]}


@app.delete("/api/psv/v1/me")
def delete_my_academic_state(
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    erase_student_state(db, student_id=user.user_id)
    return {"deleted": True}


@app.get("/api/psv/internal/student-snapshot")
def internal_student_snapshot(
    student_id: str = Query(alias="studentId"),
    school_id: str = Query(alias="schoolId"),
    _: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(KnowledgeGapSnapshot).where(
        KnowledgeGapSnapshot.student_id == student_id,
        KnowledgeGapSnapshot.school_id == school_id,
    ).order_by(KnowledgeGapSnapshot.gap_score.desc()).limit(12)).all()
    return {"studentId": student_id, "knowledgeGaps": [serialize_gap(row) for row in rows]}


@app.post("/api/psv/internal/knowledge-gaps/aggregate")
def internal_aggregate(
    body: AggregateRequest,
    _: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(
            KnowledgeGapSnapshot.concept_id,
            func.count(func.distinct(KnowledgeGapSnapshot.student_id)),
            func.avg(KnowledgeGapSnapshot.mastery),
            func.avg(KnowledgeGapSnapshot.gap_score),
            func.avg(KnowledgeGapSnapshot.confidence),
        ).where(
            KnowledgeGapSnapshot.school_id == body.school_id,
            KnowledgeGapSnapshot.student_id.in_(body.student_ids),
        ).group_by(KnowledgeGapSnapshot.concept_id)
    ).all()
    return {
        "cohortSize": len(set(body.student_ids)),
        "concepts": [
            {
                "conceptId": concept_id,
                "studentCount": int(student_count),
                "averageMastery": float(average_mastery or 0),
                "averageGapScore": float(average_gap or 0),
                "averageConfidence": float(average_confidence or 0),
            }
            for concept_id, student_count, average_mastery, average_gap, average_confidence in rows
        ],
    }


@app.post("/api/psv/internal/recompute")
def recompute(
    student_id: str | None = Query(default=None, alias="studentId"),
    school_id: str | None = Query(default=None, alias="schoolId"),
    run_key: str | None = Query(default=None, alias="runKey"),
    _: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    if student_id or school_id:
        if not student_id or not school_id:
            raise HTTPException(status_code=400, detail="studentId and schoolId must be provided together.")
        return {
            "studentId": student_id,
            "conceptsUpdated": recompute_student(db, settings, student_id=student_id, school_id=school_id),
        }
    key = run_key or f"academic:{datetime.now(timezone.utc).date().isoformat()}"
    return run_daily_refresh(db, settings, key)


@app.get("/api/psv/internal/events/count")
def event_count(
    _: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    return {"count": db.scalar(select(func.count()).select_from(LearningEvent)) or 0}
