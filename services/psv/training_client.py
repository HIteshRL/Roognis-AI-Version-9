from __future__ import annotations

from collections import defaultdict
from typing import Callable, Iterable

import httpx

from config import Settings
from gnn_client import load_concept_subgraph
from scoring import compute_baseline, evidence_from_event


def build_knowledge_training_samples(
    events: Iterable,
    *,
    graph_loader: Callable[[str], dict | None],
    max_samples: int = 5000,
) -> list[dict]:
    grouped: dict[tuple[str, str], list] = defaultdict(list)
    for event in events:
        evidence = evidence_from_event(event)
        if evidence and getattr(event, "student_id", None):
            grouped[(event.student_id, evidence.concept_id)].append(evidence)

    samples: list[dict] = []
    graph_cache: dict[str, dict | None] = {}
    for (_, concept_id), evidence_rows in sorted(grouped.items()):
        ordered = sorted(evidence_rows, key=lambda item: item.observed_at)
        if len(ordered) < 2:
            continue
        history, target = ordered[:-1], ordered[-1]
        baseline = compute_baseline(history)
        if concept_id not in graph_cache:
            graph_cache[concept_id] = graph_loader(concept_id)
        graph = graph_cache[concept_id]
        graph_nodes = list((graph or {}).get("nodes", []))
        if not any(node.get("nodeId") == concept_id and node.get("kind") == "Concept" for node in graph_nodes):
            continue

        concepts = [{
            "conceptId": concept_id,
            "features": [
                baseline["mastery"],
                baseline["recall_stability"],
                baseline["difficulty_readiness"],
                baseline["confidence"],
            ],
            "baselineMastery": baseline["mastery"],
        }]
        seen = {concept_id}
        for node in graph_nodes:
            node_id = node.get("nodeId")
            if node.get("kind") != "Concept" or not node_id or node_id in seen:
                continue
            seen.add(node_id)
            concepts.append({
                "conceptId": node_id,
                "features": [0.25, 0.25, 0.2, 0.0],
                "baselineMastery": 0.25,
            })

        normalised_edges = []
        for edge in (graph or {}).get("edges", []):
            from_id = edge.get("fromId") or edge.get("fromNodeId")
            to_id = edge.get("toId") or edge.get("toNodeId")
            if from_id in seen and to_id in seen:
                normalised_edges.append({"fromId": from_id, "toId": to_id})

        samples.append({
            "concepts": concepts,
            "events": [{
                "conceptId": row.concept_id,
                "outcome": row.outcome,
                "weight": row.weight,
                "difficulty": row.difficulty,
            } for row in history],
            "edges": normalised_edges,
            "targetConceptId": concept_id,
            "targetOutcome": target.outcome,
            "targetEventId": target.event_id,
        })
        if len(samples) >= max_samples:
            break
    return samples


def train_knowledge_model(settings: Settings, events: Iterable, *, model_version: str) -> dict:
    if not settings.gnn_trainer_url or not settings.internal_service_token:
        return {"attempted": False, "reason": "not_configured"}

    try:
        samples = build_knowledge_training_samples(
            events,
            graph_loader=lambda concept_id: load_concept_subgraph(settings, concept_id),
        )
        if not samples:
            return {"attempted": False, "reason": "no_training_samples"}
        response = httpx.post(
            f"{settings.gnn_trainer_url.rstrip('/')}/internal/gnn/v1/train",
            json={"lane": "knowledge", "modelVersion": model_version[:80], "samples": samples},
            headers={"X-Internal-Service-Token": settings.internal_service_token},
            timeout=120.0,
        )
        response.raise_for_status()
        return {"attempted": True, **response.json()}
    except Exception:
        # Snapshot recomputation must remain available when the optional model
        # optimisation path is down or fails its held-out promotion gate.
        return {"attempted": True, "promoted": False, "reason": "trainer_unavailable"}
