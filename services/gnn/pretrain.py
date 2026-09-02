"""Small-data self-supervised pretraining and held-out promotion gates."""

from __future__ import annotations

from pathlib import Path

from artifacts import ModelArtifact
from graph_models import KnowledgeGraphTemporalNetwork, PreferenceGraphSAGE
from promote import promote_candidate
from schemas import GraphEdge, KnowledgeConcept, KnowledgeEvent, PreferenceInteraction, PreferenceTopic


def _brier(predictions: list[float], targets: list[float]) -> float:
    if not targets:
        return 1.0
    return sum((prediction - target) ** 2 for prediction, target in zip(predictions, targets)) / len(targets)


def _preference_metrics(samples: list[dict], seed: int) -> tuple[float, float, float, float, int]:
    artifact = ModelArtifact("candidate", False, seed, {})
    model = PreferenceGraphSAGE(artifact)
    candidate: list[float] = []
    baseline: list[float] = []
    targets: list[float] = []
    for sample in samples:
        topics = [PreferenceTopic.model_validate(item) for item in sample.get("topics", [])]
        interactions = [PreferenceInteraction.model_validate(item) for item in sample.get("interactions", [])]
        edges = [GraphEdge.model_validate(item) for item in sample.get("edges", [])]
        target_id = sample.get("targetTopicId")
        target = next((item for item in topics if item.topic_id == target_id), None)
        if target is None or sample.get("targetStance") not in {"LIKE", "DISLIKE"}:
            continue
        score = next((row for row in model.score(topics, interactions, edges) if row["topicId"] == target_id), None)
        if score is None:
            continue
        candidate.append((float(score["affinity"]) + 1) / 2)
        baseline.append((float(target.baseline_score) + 1) / 2)
        targets.append(1.0 if sample["targetStance"] == "LIKE" else 0.0)
    candidate_error = _brier(candidate, targets)
    baseline_error = _brier(baseline, targets)
    return 1 - candidate_error, 1 - baseline_error, candidate_error, baseline_error, len(targets)


def _knowledge_metrics(samples: list[dict], seed: int) -> tuple[float, float, float, float, int]:
    artifact = ModelArtifact("candidate", False, seed, {})
    model = KnowledgeGraphTemporalNetwork(artifact)
    candidate: list[float] = []
    baseline: list[float] = []
    targets: list[float] = []
    for sample in samples:
        concepts = [KnowledgeConcept.model_validate(item) for item in sample.get("concepts", [])]
        events = [KnowledgeEvent.model_validate(item) for item in sample.get("events", [])]
        edges = [GraphEdge.model_validate(item) for item in sample.get("edges", [])]
        target_id = sample.get("targetConceptId")
        target = next((item for item in concepts if item.concept_id == target_id), None)
        outcome = sample.get("targetOutcome")
        if target is None or not isinstance(outcome, (int, float)) or not 0 <= outcome <= 1:
            continue
        score = next((row for row in model.score(concepts, events, edges) if row["conceptId"] == target_id), None)
        if score is None:
            continue
        candidate.append(float(score["mastery"]))
        baseline.append(float(target.baseline_mastery))
        targets.append(float(outcome))
    candidate_error = _brier(candidate, targets)
    baseline_error = _brier(baseline, targets)
    return 1 - candidate_error, 1 - baseline_error, candidate_error, baseline_error, len(targets)


def pretrain_and_promote(
    *,
    lane: str,
    samples: list[dict],
    output: Path,
    model_version: str,
    initial_seed: int = 1729,
    candidate_count: int = 8,
) -> dict:
    evaluator = _preference_metrics if lane == "preference" else _knowledge_metrics
    evaluations = []
    for seed in range(initial_seed, initial_seed + max(1, candidate_count)):
        candidate_metric, baseline_metric, candidate_calibration, baseline_calibration, held_out_events = evaluator(samples, seed)
        evaluations.append((candidate_metric, -candidate_calibration, seed, {
            "candidateMetric": candidate_metric,
            "baselineMetric": baseline_metric,
            "candidateCalibration": candidate_calibration,
            "baselineCalibration": baseline_calibration,
            "heldOutEvents": held_out_events,
            "pretrainingTask": "signed-edge-reconstruction" if lane == "preference" else "next-outcome-prediction",
        }))
    _, _, best_seed, metrics = max(evaluations)
    promoted = promote_candidate(metrics, output, model_version=model_version, seed=best_seed)
    return {
        "promoted": promoted,
        "modelVersion": model_version if promoted else None,
        "reason": None if promoted else "promotion_gate_not_met",
        "seed": best_seed,
        "metrics": metrics,
    }
