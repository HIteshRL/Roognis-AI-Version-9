from __future__ import annotations

import httpx

from config import Settings


def load_concept_subgraph(settings: Settings, concept_id: str) -> dict | None:
    if not settings.kg_service_url or not settings.internal_service_token:
        return None
    try:
        graph_response = httpx.post(
            f"{settings.kg_service_url.rstrip('/')}/api/kg/internal/subgraph",
            json={"nodeIds": [concept_id], "activeOnly": True},
            headers={"X-Internal-Service-Token": settings.internal_service_token},
            timeout=settings.gnn_timeout_seconds,
        )
        graph_response.raise_for_status()
        graph = graph_response.json()
        graph_nodes = [node for node in graph.get("nodes", []) if node.get("kind") == "Concept"]
        graph_edges = [
            {"fromId": edge.get("fromNodeId"), "toId": edge.get("toNodeId")}
            for edge in graph.get("edges", [])
            if edge.get("fromNodeId") and edge.get("toNodeId")
        ]
        return {"nodes": graph_nodes, "edges": graph_edges}
    except (httpx.HTTPError, ValueError):
        return None


def score_knowledge(settings: Settings, *, student_id: str, concept_id: str, baseline: dict, evidence: list) -> dict | None:
    if not settings.gnn_service_url or not settings.internal_service_token:
        return None
    graph = load_concept_subgraph(settings, concept_id)
    if graph is None:
        return None
    graph_nodes = graph["nodes"]
    graph_edges = graph["edges"]

    if not any(node.get("nodeId") == concept_id for node in graph_nodes):
        return {
            "eligible": False,
            "reason": "unknown_or_inactive_concept",
            "coverage": len(evidence),
            "confidence": 0,
            "modelVersion": None,
            "scores": [],
        }

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
        if not node_id or node_id in seen:
            continue
        seen.add(node_id)
        concepts.append({
            "conceptId": node_id,
            "features": [0.25, 0.25, 0.2, 0.0],
            "baselineMastery": 0.25,
        })

    payload = {
        "studentId": student_id,
        "concepts": concepts,
        "edges": graph_edges,
        "events": [
            {
                "conceptId": row.concept_id,
                "outcome": row.outcome,
                "weight": row.weight,
                "difficulty": row.difficulty,
            }
            for row in evidence
        ],
    }
    try:
        response = httpx.post(
            f"{settings.gnn_service_url.rstrip('/')}/internal/gnn/v1/knowledge/score",
            json=payload,
            headers={"X-Internal-Service-Token": settings.internal_service_token},
            timeout=settings.gnn_timeout_seconds,
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        return None
