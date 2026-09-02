from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

RULE_VERSION = "academic-evidence-v1"
TRAITS = ("mastery", "recall_stability", "difficulty_readiness")


@dataclass(frozen=True)
class Evidence:
    event_id: str
    concept_id: str
    outcome: float
    weight: float
    observed_at: datetime
    difficulty: float


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, float(value)))


def difficulty_value(value: object) -> float:
    return {"simple": 0.25, "medium": 0.55, "hard": 0.85}.get(str(value or "").lower(), 0.5)


def evidence_from_event(event) -> Evidence | None:
    if not event.concept_id:
        return None
    payload = event.payload or {}
    outcome: float | None = None
    weight = 0.0

    if event.event_type == "answer_submitted":
        if isinstance(payload.get("correct"), bool):
            outcome = 1.0 if payload["correct"] else 0.0
        elif isinstance(payload.get("scoreNormalized"), (int, float)):
            outcome = clamp(payload["scoreNormalized"])
        weight = 1.0
    elif event.event_type == "written_answer_scored":
        if isinstance(payload.get("scoreNormalized"), (int, float)):
            outcome = clamp(payload["scoreNormalized"])
            weight = 1.15
    elif event.event_type == "flashcard_review_completed":
        outcome = {"again": 0.0, "good": 0.7, "easy": 1.0}.get(payload.get("grade"))
        weight = 0.35

    if outcome is None or weight <= 0:
        return None
    return Evidence(
        event_id=event.event_id,
        concept_id=event.concept_id,
        outcome=outcome,
        weight=weight,
        observed_at=event.client_ts_wall,
        difficulty=difficulty_value(payload.get("difficulty")),
    )


def _bayesian_update(prior: float, outcome: float, weight: float) -> float:
    prior = clamp(prior, 0.01, 0.99)
    likelihood_correct = 0.85
    likelihood_guess = 0.2
    if outcome >= 0.5:
        posterior = (prior * likelihood_correct) / (
            prior * likelihood_correct + (1 - prior) * likelihood_guess
        )
    else:
        posterior = (prior * (1 - likelihood_correct)) / (
            prior * (1 - likelihood_correct) + (1 - prior) * (1 - likelihood_guess)
        )
    blended = prior + clamp(weight) * (posterior - prior)
    return clamp(blended + 0.08 * weight * (1 - blended))


def compute_baseline(evidence: Iterable[Evidence]) -> dict:
    rows = sorted(evidence, key=lambda item: item.observed_at)
    if not rows:
        raise ValueError("compute_baseline requires evidence")

    mastery = 0.25
    recall = 0.25
    readiness = 0.2
    history: list[float] = []
    flashcard_weight = 0.0
    flashcard_score = 0.0

    for row in rows:
        previous = mastery
        mastery = _bayesian_update(mastery, row.outcome, row.weight)
        history.append(mastery - previous)
        readiness = clamp(0.72 * mastery + 0.28 * row.outcome * row.difficulty)
        if row.weight < 0.5:
            flashcard_weight += row.weight
            flashcard_score += row.outcome * row.weight

    if flashcard_weight:
        recall = clamp(flashcard_score / flashcard_weight)
    else:
        recall = clamp(0.7 * mastery + 0.15)

    confidence = clamp(1 - math.exp(-len(rows) / 6))
    trend = sum(history[-3:]) / min(3, len(history))
    gap_score = clamp(1 - (0.65 * mastery + 0.2 * recall + 0.15 * readiness))
    return {
        "mastery": mastery,
        "recall_stability": recall,
        "difficulty_readiness": readiness,
        "confidence": confidence,
        "trend": trend,
        "gap_score": gap_score,
        "evidence_count": len(rows),
        "last_evidence_at": rows[-1].observed_at,
        "evidence_ids": [row.event_id for row in rows],
        "rule_version": RULE_VERSION,
    }
