import pytest
from pydantic import ValidationError

from schemas import LearningEventInput


def valid_event(**overrides):
    value = {
        "schemaVersion": 1,
        "eventId": "12345678-abcd-4000-8000-123456789012",
        "eventType": "answer_submitted",
        "source": "quiz",
        "clientTsMono": 10,
        "clientTsWall": "2026-08-31T10:00:00Z",
        "conceptId": "fractions.addition",
        "payload": {"correct": True},
    }
    value.update(overrides)
    return value


def test_rejects_preference_events_from_academic_lane():
    with pytest.raises(ValidationError):
        LearningEventInput.model_validate(valid_event(source="discover"))


def test_rejects_raw_written_answer_content():
    with pytest.raises(ValidationError):
        LearningEventInput.model_validate(valid_event(payload={"rawAnswer": "student text"}))


def test_rejects_nested_raw_written_answer_content():
    with pytest.raises(ValidationError):
        LearningEventInput.model_validate(valid_event(payload={"response": {"answerText": "student text"}}))
