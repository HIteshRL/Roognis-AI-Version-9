from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import Settings
from gnn_client import score_knowledge
from decision_client import decide_knowledge
from models import DecisionRecord, EvidenceRecord, KnowledgeGapSnapshot, LearningEvent, RefreshRun, TraitState
from schemas import LearningEventInput
from scoring import RULE_VERSION, TRAITS, compute_baseline, evidence_from_event
from training_client import train_knowledge_model


def _training_model_version(run_key: str) -> str:
    safe = "".join(char if char.isalnum() or char in "._-" else "-" for char in run_key).strip("-")
    return f"knowledge-{safe}"[:80]


def _is_reclaimable_refresh_lease(run: RefreshRun | None, observed_at: datetime) -> bool:
    if not run or run.status != "running" or not run.lease_expires_at:
        return False
    expires_at = run.lease_expires_at
    comparison_time = observed_at
    if expires_at.tzinfo is None:
        comparison_time = observed_at.replace(tzinfo=None)
    return expires_at <= comparison_time


def persist_events(db: Session, events: list[LearningEventInput], *, student_id: str | None = None, school_id: str | None = None) -> dict:
    accepted: list[str] = []
    deduplicated: list[str] = []
    for item in events:
        resolved_student = student_id or item.student_id
        resolved_school = school_id or item.school_id
        if not resolved_student or not resolved_school:
            raise ValueError("studentId and schoolId are required for internal events")
        existing = db.scalar(select(LearningEvent.id).where(LearningEvent.event_id == item.event_id))
        if existing:
            deduplicated.append(item.event_id)
            continue
        db.add(LearningEvent(
            event_id=item.event_id,
            schema_version=item.schema_version,
            event_type=item.event_type,
            source=item.source,
            student_id=resolved_student,
            school_id=resolved_school,
            session_id=item.session_id,
            item_id=item.item_id,
            concept_id=item.concept_id,
            client_ts_mono=item.client_ts_mono,
            client_ts_wall=item.client_ts_wall,
            payload=item.payload,
        ))
        accepted.append(item.event_id)
    db.commit()
    return {"acceptedEventIds": accepted + deduplicated, "accepted": len(accepted), "deduplicated": len(deduplicated)}


def _upsert_trait(db: Session, *, student_id: str, school_id: str, concept_id: str, trait: str, result: dict, value: float, source: str, model_version: str | None) -> None:
    row = db.scalar(select(TraitState).where(
        TraitState.student_id == student_id,
        TraitState.concept_id == concept_id,
        TraitState.trait_type == trait,
    ))
    if row:
        row.version += 1
        row.value = value
        row.confidence = result["confidence"]
        row.evidence_count = result["evidence_count"]
        row.trend = result["trend"]
        row.rule_version = RULE_VERSION
        row.model_version = model_version
        row.last_evidence_at = result["last_evidence_at"]
    else:
        db.add(TraitState(
            student_id=student_id,
            school_id=school_id,
            concept_id=concept_id,
            trait_type=trait,
            value=value,
            confidence=result["confidence"],
            evidence_count=result["evidence_count"],
            trend=result["trend"],
            rule_version=RULE_VERSION,
            model_version=model_version,
            last_evidence_at=result["last_evidence_at"],
        ))


def recompute_student(
    db: Session,
    settings: Settings,
    *,
    student_id: str,
    school_id: str,
    commit: bool = True,
) -> int:
    events = db.scalars(select(LearningEvent).where(
        LearningEvent.student_id == student_id,
        LearningEvent.school_id == school_id,
        LearningEvent.concept_id.is_not(None),
    ).order_by(LearningEvent.client_ts_wall.asc())).all()
    grouped: dict[str, list] = defaultdict(list)
    for event in events:
        evidence = evidence_from_event(event)
        if evidence:
            grouped[evidence.concept_id].append(evidence)

    for concept_id, evidence_rows in grouped.items():
        baseline = compute_baseline(evidence_rows)
        gnn = score_knowledge(
            settings,
            student_id=student_id,
            concept_id=concept_id,
            baseline=baseline,
            evidence=evidence_rows,
        )
        values = {
            "mastery": baseline["mastery"],
            "recall_stability": baseline["recall_stability"],
            "difficulty_readiness": baseline["difficulty_readiness"],
        }
        decision = decide_knowledge(settings, concept_id=concept_id, baseline=baseline, gnn=gnn)
        decision_source = decision["source"]
        model_version = decision.get("modelVersion")
        values.update({
            "mastery": float(decision["mastery"]),
            "difficulty_readiness": float(decision["difficultyReadiness"]),
        })
        # Recall is not a decision-service output; retain the auditable
        # evidence-weighted estimate rather than synthesizing one from mastery.
        db.add(DecisionRecord(
            student_id=student_id,
            school_id=school_id,
            concept_id=concept_id,
            decision_type="daily_knowledge_snapshot",
            decision={
                "mastery": decision["mastery"],
                "difficultyReadiness": decision["difficultyReadiness"],
                "nextDifficulty": decision["nextDifficulty"],
                "scaffold": decision["scaffold"],
            },
            source=decision_source,
            rule_version=decision["ruleVersion"],
            model_version=model_version,
            evidence_ids=decision.get("evidenceIds", []),
        ))

        for row in evidence_rows:
            for trait in TRAITS:
                existing = db.scalar(select(EvidenceRecord.id).where(
                    EvidenceRecord.event_id == row.event_id,
                    EvidenceRecord.trait_type == trait,
                ))
                if not existing:
                    db.add(EvidenceRecord(
                        event_id=row.event_id,
                        student_id=student_id,
                        school_id=school_id,
                        concept_id=concept_id,
                        trait_type=trait,
                        outcome=row.outcome,
                        evidence_weight=row.weight,
                        rule_version=RULE_VERSION,
                        model_version=model_version,
                        observed_at=row.observed_at,
                    ))

        for trait, value in values.items():
            _upsert_trait(
                db,
                student_id=student_id,
                school_id=school_id,
                concept_id=concept_id,
                trait=trait,
                result=baseline,
                value=value,
                source=decision_source,
                model_version=model_version,
            )

        snapshot = db.scalar(select(KnowledgeGapSnapshot).where(
            KnowledgeGapSnapshot.student_id == student_id,
            KnowledgeGapSnapshot.concept_id == concept_id,
        ))
        gap_score = max(0.0, min(1.0, 1 - (0.65 * values["mastery"] + 0.2 * values["recall_stability"] + 0.15 * values["difficulty_readiness"])))
        snapshot_values = dict(
            school_id=school_id,
            mastery=values["mastery"],
            recall_stability=values["recall_stability"],
            difficulty_readiness=values["difficulty_readiness"],
            next_difficulty=decision["nextDifficulty"],
            scaffold=decision["scaffold"],
            gap_score=gap_score,
            confidence=baseline["confidence"],
            uncertainty=1 - baseline["confidence"],
            evidence_count=baseline["evidence_count"],
            decision_source=decision_source,
            rule_version=decision["ruleVersion"],
            model_version=model_version,
            last_evidence_at=baseline["last_evidence_at"],
            computed_at=datetime.now(timezone.utc),
        )
        if snapshot:
            for key, value in snapshot_values.items():
                setattr(snapshot, key, value)
        else:
            db.add(KnowledgeGapSnapshot(student_id=student_id, concept_id=concept_id, **snapshot_values))

    if commit:
        db.commit()
    else:
        db.flush()
    return len(grouped)


def run_daily_refresh(db: Session, settings: Settings, run_key: str) -> dict:
    lease_started_at = datetime.now(timezone.utc)
    lease_expires_at = lease_started_at + timedelta(hours=2)
    run = RefreshRun(
        run_key=run_key,
        lane="academic",
        status="running",
        lease_expires_at=lease_expires_at,
    )
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(RefreshRun).where(RefreshRun.run_key == run_key))
        reclaimable = _is_reclaimable_refresh_lease(existing, lease_started_at)
        if not reclaimable:
            return {"started": False, "status": existing.status if existing else "unknown", "runKey": run_key}
        claimed = db.execute(update(RefreshRun).where(
            RefreshRun.id == existing.id,
            RefreshRun.status == "running",
            RefreshRun.lease_expires_at <= lease_started_at,
        ).values(
            started_at=lease_started_at,
            lease_expires_at=lease_expires_at,
            error=None,
            training_status="not_started",
            training_promoted=False,
            training_reason=None,
            processed_students=0,
            completed_at=None,
        ))
        db.commit()
        if claimed.rowcount != 1:
            return {"started": False, "status": "running", "runKey": run_key}
        run = db.scalar(select(RefreshRun).where(RefreshRun.id == existing.id))

    students = db.execute(select(LearningEvent.student_id, LearningEvent.school_id).distinct()).all()
    try:
        training_events = db.scalars(select(LearningEvent).where(
            LearningEvent.concept_id.is_not(None),
        ).order_by(LearningEvent.client_ts_wall.asc())).all()
        training = train_knowledge_model(
            settings,
            training_events,
            model_version=_training_model_version(run_key),
        )
        for student_id, school_id in students:
            recompute_student(
                db,
                settings,
                student_id=student_id,
                school_id=school_id,
                commit=False,
            )
        run.status = "done"
        run.processed_students = len(students)
        run.training_status = "promoted" if training.get("promoted") else (
            "not_promoted" if training.get("attempted") else "skipped"
        )
        run.training_promoted = bool(training.get("promoted"))
        run.training_reason = training.get("reason")
        run.lease_expires_at = None
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        return {
            "started": True,
            "status": "done",
            "runKey": run_key,
            "processedStudents": len(students),
            "training": training,
        }
    except Exception as exc:
        db.rollback()
        run = db.scalar(select(RefreshRun).where(RefreshRun.run_key == run_key))
        if run:
            run.status = "failed"
            run.error = str(exc)[:1000]
            run.lease_expires_at = None
            run.completed_at = datetime.now(timezone.utc)
            db.commit()
        raise


def erase_student_state(db: Session, *, student_id: str) -> None:
    for model in (DecisionRecord, KnowledgeGapSnapshot, TraitState, EvidenceRecord, LearningEvent):
        db.execute(delete(model).where(model.student_id == student_id))
    db.commit()
