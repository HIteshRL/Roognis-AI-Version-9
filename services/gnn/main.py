import math
import os
from threading import Lock
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException

from artifacts import load_artifact
from auth import require_internal_token
from config import Settings, get_settings
from graph_models import KnowledgeGraphTemporalNetwork, PreferenceGraphSAGE
from schemas import KnowledgeScoreRequest, PreferenceScoreRequest

settings = get_settings()
artifact = load_artifact(settings.gnn_model_artifact)
preference_model = PreferenceGraphSAGE(artifact)
knowledge_model = KnowledgeGraphTemporalNetwork(artifact)
artifact_mtime_ns = os.stat(settings.gnn_model_artifact).st_mtime_ns if settings.gnn_model_artifact and os.path.isfile(settings.gnn_model_artifact) else None
artifact_lock = Lock()

app = FastAPI(title="Roognis GNN Inference Service")


def current_models():
    """Reload an atomically promoted artifact without restarting inference."""
    global artifact, preference_model, knowledge_model, artifact_mtime_ns
    path = settings.gnn_model_artifact
    observed_mtime = os.stat(path).st_mtime_ns if path and os.path.isfile(path) else None
    if observed_mtime == artifact_mtime_ns:
        return artifact, preference_model, knowledge_model
    with artifact_lock:
        observed_mtime = os.stat(path).st_mtime_ns if path and os.path.isfile(path) else None
        if observed_mtime != artifact_mtime_ns:
            candidate = load_artifact(path)
            artifact = candidate
            preference_model = PreferenceGraphSAGE(candidate)
            knowledge_model = KnowledgeGraphTemporalNetwork(candidate)
            artifact_mtime_ns = observed_mtime
    return artifact, preference_model, knowledge_model


@app.get("/health")
@app.get("/internal/gnn/health")
def health():
    active_artifact, _, _ = current_models()
    return {
        "status": "ok",
        "service": "gnn",
        "lane": settings.gnn_lane,
        "modelVersion": active_artifact.model_version,
        "promoted": active_artifact.promoted,
    }


def artifact_is_stale(active_artifact, now: datetime | None = None) -> bool:
    if not active_artifact.promoted:
        return False
    if active_artifact.promoted_at is None:
        return True
    observed = now or datetime.now(timezone.utc)
    return (observed - active_artifact.promoted_at).total_seconds() > settings.gnn_max_model_age_hours * 3600


def eligibility(active_artifact, coverage: int, minimum: int, confidence: float) -> tuple[bool, str | None]:
    if not active_artifact.promoted:
        return False, "unpromoted_model"
    if artifact_is_stale(active_artifact):
        return False, "stale_model"
    if coverage < minimum:
        return False, "insufficient_coverage"
    if confidence < settings.gnn_min_confidence:
        return False, "low_confidence"
    return True, None


@app.post("/internal/gnn/v1/preference/score")
def score_preferences(body: PreferenceScoreRequest, _: None = Depends(require_internal_token)):
    if settings.gnn_lane not in {"preference", "both"}:
        raise HTTPException(status_code=409, detail="This GNN deployment is not configured for preference inference.")
    active_artifact, active_model, _ = current_models()
    scores = active_model.score(body.topics, body.interactions, body.edges)
    coverage = len(body.interactions)
    confidence = min(0.99, 1 - math.exp(-coverage / 6))
    eligible, reason = eligibility(active_artifact, coverage, settings.gnn_min_preference_coverage, confidence)
    return {
        "eligible": eligible,
        "reason": reason,
        "coverage": coverage,
        "confidence": confidence,
        "modelVersion": active_artifact.model_version,
        "scores": scores,
    }


@app.post("/internal/gnn/v1/knowledge/score")
def score_knowledge(body: KnowledgeScoreRequest, _: None = Depends(require_internal_token)):
    if settings.gnn_lane not in {"knowledge", "both"}:
        raise HTTPException(status_code=409, detail="This GNN deployment is not configured for knowledge inference.")
    active_artifact, _, active_model = current_models()
    scores = active_model.score(body.concepts, body.events, body.edges)
    coverage = len(body.events)
    confidence = min(0.99, 1 - math.exp(-coverage / 8))
    eligible, reason = eligibility(active_artifact, coverage, settings.gnn_min_knowledge_coverage, confidence)
    return {
        "eligible": eligible,
        "reason": reason,
        "coverage": coverage,
        "confidence": confidence,
        "modelVersion": active_artifact.model_version,
        "scores": scores,
    }
