from datetime import datetime, timezone
from types import SimpleNamespace

from scoring import compute_baseline, evidence_from_event


def event(event_type: str, payload: dict, *, concept_id: str = "fractions.addition"):
    return SimpleNamespace(
        event_id=f"event-{event_type}-{payload}",
        event_type=event_type,
        concept_id=concept_id,
        payload=payload,
        client_ts_wall=datetime.now(timezone.utc),
    )


def test_assessed_answers_have_more_weight_than_flashcard_self_reports():
    answer = evidence_from_event(event("answer_submitted", {"correct": False, "difficulty": "medium"}))
    card = evidence_from_event(event("flashcard_review_completed", {"grade": "again"}))
    assert answer.weight > card.weight


def test_baseline_exposes_versioned_academic_traits():
    rows = [
        evidence_from_event(event("answer_submitted", {"correct": False, "difficulty": "medium"})),
        evidence_from_event(event("answer_submitted", {"correct": True, "difficulty": "hard"})),
    ]
    result = compute_baseline(rows)
    assert 0 <= result["mastery"] <= 1
    assert 0 <= result["gap_score"] <= 1
    assert result["rule_version"] == "academic-evidence-v1"
