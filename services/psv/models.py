from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(String(128))
    item_id: Mapped[str | None] = mapped_column(String(160))
    concept_id: Mapped[str | None] = mapped_column(String(160), index=True)
    client_ts_mono: Mapped[float] = mapped_column(Float, nullable=False)
    client_ts_wall: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_learning_events_student_concept_time", "student_id", "concept_id", "client_ts_wall"),
    )


class EvidenceRecord(Base):
    __tablename__ = "evidence_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    student_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    concept_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    trait_type: Mapped[str] = mapped_column(String(40), nullable=False)
    outcome: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_weight: Mapped[float] = mapped_column(Float, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(40), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(80))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("event_id", "trait_type", name="uq_evidence_event_trait"),
        Index("ix_evidence_student_concept_trait", "student_id", "concept_id", "trait_type"),
    )


class TraitState(Base):
    __tablename__ = "trait_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    student_id: Mapped[str] = mapped_column(String(36), nullable=False)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    concept_id: Mapped[str] = mapped_column(String(160), nullable=False)
    trait_type: Mapped[str] = mapped_column(String(40), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, nullable=False)
    trend: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(40), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(80))
    last_evidence_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "concept_id", "trait_type", name="uq_trait_thread"),
        Index("ix_trait_student_concept", "student_id", "concept_id"),
    )


class KnowledgeGapSnapshot(Base):
    __tablename__ = "knowledge_gap_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    student_id: Mapped[str] = mapped_column(String(36), nullable=False)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    concept_id: Mapped[str] = mapped_column(String(160), nullable=False)
    mastery: Mapped[float] = mapped_column(Float, nullable=False)
    recall_stability: Mapped[float] = mapped_column(Float, nullable=False)
    difficulty_readiness: Mapped[float] = mapped_column(Float, nullable=False)
    next_difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    scaffold: Mapped[str] = mapped_column(String(40), nullable=False, default="completion_problem")
    gap_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    uncertainty: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, nullable=False)
    decision_source: Mapped[str] = mapped_column(String(20), nullable=False)
    rule_version: Mapped[str] = mapped_column(String(40), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(80))
    last_evidence_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "concept_id", name="uq_gap_student_concept"),
        Index("ix_gap_school_concept", "school_id", "concept_id"),
    )


class RefreshRun(Base):
    __tablename__ = "refresh_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    run_key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    lane: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    processed_students: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    training_status: Mapped[str] = mapped_column(String(24), nullable=False, default="not_started")
    training_promoted: Mapped[bool] = mapped_column(default=False, nullable=False)
    training_reason: Mapped[str | None] = mapped_column(String(80))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(1000))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DecisionRecord(Base):
    __tablename__ = "decision_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    student_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    concept_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    decision_type: Mapped[str] = mapped_column(String(40), nullable=False)
    decision: Mapped[dict] = mapped_column(JSON, nullable=False)
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    rule_version: Mapped[str] = mapped_column(String(80), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(80))
    evidence_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_decision_student_concept_time", "student_id", "concept_id", "created_at"),
    )
