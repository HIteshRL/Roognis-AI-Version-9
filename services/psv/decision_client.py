from __future__ import annotations

import httpx

from config import Settings


def decide_knowledge(settings: Settings, *, concept_id: str, baseline: dict, gnn: dict | None) -> dict:
    score = next((row for row in (gnn or {}).get("scores", []) if row.get("conceptId") == concept_id), None)
    payload = {
        "conceptId": concept_id,
        "baselineMastery": baseline["mastery"],
        "baselineReadiness": baseline["difficulty_readiness"],
        "gnnMastery": score.get("mastery") if score else None,
        "gnnReadiness": score.get("difficultyReadiness") if score else None,
        "gnnEligible": bool((gnn or {}).get("eligible") and score),
        "gnnConfidence": float((gnn or {}).get("confidence", 0)),
        "modelVersion": (gnn or {}).get("modelVersion"),
        "currentDifficulty": "medium",
        "evidenceIds": baseline["evidence_ids"],
    }
    if settings.decision_service_url and settings.internal_service_token:
        try:
            response = httpx.post(
                f"{settings.decision_service_url.rstrip('/')}/api/decisions/v1/knowledge",
                json=payload,
                headers={"X-Internal-Service-Token": settings.internal_service_token},
                timeout=settings.gnn_timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            pass
    return {
        "conceptId": concept_id,
        "mastery": baseline["mastery"],
        "difficultyReadiness": baseline["difficulty_readiness"],
        "nextDifficulty": "simple" if baseline["difficulty_readiness"] < 0.4 else "medium",
        "scaffold": "worked_example" if baseline["mastery"] < 0.3 else "completion_problem",
        "source": "baseline",
        "ruleVersion": baseline["rule_version"],
        "modelVersion": None,
        "evidenceIds": baseline["evidence_ids"],
    }
