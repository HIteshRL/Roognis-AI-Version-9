from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ACADEMIC_EVENT_TYPES = frozenset({
    "item_rendered",
    "first_interaction",
    "answer_changed",
    "answer_submitted",
    "item_skipped",
    "hint_requested",
    "confidence_reported",
    "focus_lost",
    "focus_gained",
    "written_answer_scored",
    "flashcard_revealed",
    "flashcard_review_completed",
})
ACADEMIC_SOURCES = frozenset({"quiz", "written_answer", "flashcard", "practice"})
FORBIDDEN_RAW_TEXT_KEYS = frozenset({"answer", "answertext", "rawanswer", "prompt", "content", "text"})


class LearningEventInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: Literal[1] = Field(alias="schemaVersion")
    event_id: str = Field(alias="eventId", min_length=8, max_length=64)
    event_type: str = Field(alias="eventType", max_length=48)
    source: str = Field(max_length=32)
    session_id: str | None = Field(default=None, alias="sessionId", max_length=128)
    item_id: str | None = Field(default=None, alias="itemId", max_length=160)
    concept_id: str | None = Field(default=None, alias="conceptId", max_length=160)
    client_ts_mono: float = Field(alias="clientTsMono", ge=0)
    client_ts_wall: datetime = Field(alias="clientTsWall")
    payload: dict[str, Any] = Field(default_factory=dict)
    student_id: str | None = Field(default=None, alias="studentId", max_length=36)
    school_id: str | None = Field(default=None, alias="schoolId", max_length=36)

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, value: str) -> str:
        if value not in ACADEMIC_EVENT_TYPES:
            raise ValueError("eventType is not an academic measurement event")
        return value

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        if value not in ACADEMIC_SOURCES:
            raise ValueError("source is not an academic measurement source")
        return value

    @field_validator("payload")
    @classmethod
    def reject_raw_student_text(cls, value: dict[str, Any]) -> dict[str, Any]:
        forbidden: set[str] = set()

        def scan(candidate: Any) -> None:
            if isinstance(candidate, dict):
                for key, nested in candidate.items():
                    normalized = str(key).lower().replace("_", "").replace("-", "").replace(" ", "")
                    if normalized in FORBIDDEN_RAW_TEXT_KEYS:
                        forbidden.add(str(key))
                    scan(nested)
            elif isinstance(candidate, list):
                for nested in candidate:
                    scan(nested)

        scan(value)
        if forbidden:
            raise ValueError(f"raw student text is not accepted in the PSV event stream: {sorted(forbidden)}")
        return value


class EventBatchInput(BaseModel):
    events: list[LearningEventInput] = Field(min_length=1, max_length=100)


class InternalEventBatchInput(BaseModel):
    events: list[LearningEventInput] = Field(min_length=1, max_length=500)


class AggregateRequest(BaseModel):
    student_ids: list[str] = Field(alias="studentIds", min_length=1, max_length=500)
    school_id: str = Field(alias="schoolId", min_length=8, max_length=36)

    model_config = ConfigDict(populate_by_name=True)
