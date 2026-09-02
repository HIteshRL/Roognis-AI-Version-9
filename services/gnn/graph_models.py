from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from artifacts import ModelArtifact

FEATURE_DIM = 4
HIDDEN_DIM = 8


def _pad(values: list[float], size: int = FEATURE_DIM) -> np.ndarray:
    array = np.asarray(values[:size], dtype=np.float64)
    if array.size < size:
        array = np.pad(array, (0, size - array.size))
    return array


def _sigmoid(value):
    return 1.0 / (1.0 + np.exp(-np.clip(value, -30, 30)))


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exponents = np.exp(shifted)
    return exponents / max(float(np.sum(exponents)), 1e-9)


class PreferenceGraphSAGE:
    """Two-layer signed GraphSAGE inference with versioned artifact weights."""

    def __init__(self, artifact: ModelArtifact):
        self.artifact = artifact
        rng = np.random.default_rng(artifact.seed)
        self.w_self_1 = rng.normal(0, 0.25, (FEATURE_DIM, HIDDEN_DIM))
        self.w_neigh_1 = rng.normal(0, 0.25, (FEATURE_DIM, HIDDEN_DIM))
        self.w_self_2 = rng.normal(0, 0.2, (HIDDEN_DIM, HIDDEN_DIM))
        self.w_neigh_2 = rng.normal(0, 0.2, (HIDDEN_DIM, HIDDEN_DIM))

    def _layer(self, hidden: dict[str, np.ndarray], neighbours: dict[str, set[str]], w_self, w_neigh) -> dict[str, np.ndarray]:
        updated = {}
        for node_id, value in hidden.items():
            linked = [hidden[key] for key in neighbours.get(node_id, set()) if key in hidden]
            mean = np.mean(linked, axis=0) if linked else np.zeros_like(value)
            updated[node_id] = np.maximum(0, value @ w_self + mean @ w_neigh)
        return updated

    def score(self, topics, interactions, edges) -> list[dict]:
        hidden = {topic.topic_id: _pad(topic.features) for topic in topics}
        neighbours: dict[str, set[str]] = defaultdict(set)
        for edge in edges:
            neighbours[edge.from_id].add(edge.to_id)
            neighbours[edge.to_id].add(edge.from_id)
        hidden = self._layer(hidden, neighbours, self.w_self_1, self.w_neigh_1)
        hidden = self._layer(hidden, neighbours, self.w_self_2, self.w_neigh_2)

        signed = defaultdict(float)
        for item in interactions:
            signed[item.topic_id] += item.weight * (1 if item.stance == "LIKE" else -1)
        student_parts = [hidden[key] * value for key, value in signed.items() if key in hidden]
        student_vector = np.mean(student_parts, axis=0) if student_parts else np.zeros(HIDDEN_DIM)
        norm = max(float(np.linalg.norm(student_vector)), 1e-9)

        results = []
        for topic in topics:
            topic_vector = hidden[topic.topic_id]
            cosine = float(np.dot(student_vector, topic_vector) / (norm * max(float(np.linalg.norm(topic_vector)), 1e-9))) if student_parts else 0.0
            affinity = float(np.tanh(0.65 * cosine + 0.35 * topic.baseline_score))
            results.append({"topicId": topic.topic_id, "affinity": affinity})
        return results


class KnowledgeGraphTemporalNetwork:
    """Graph-attention concept encoder plus a GRU-style temporal evidence head."""

    def __init__(self, artifact: ModelArtifact):
        self.artifact = artifact
        rng = np.random.default_rng(artifact.seed + 101)
        self.w_graph = rng.normal(0, 0.25, (FEATURE_DIM, HIDDEN_DIM))
        self.attention = rng.normal(0, 0.2, HIDDEN_DIM * 2)
        self.wz = rng.normal(0, 0.2, (FEATURE_DIM + HIDDEN_DIM, HIDDEN_DIM))
        self.wr = rng.normal(0, 0.2, (FEATURE_DIM + HIDDEN_DIM, HIDDEN_DIM))
        self.wh = rng.normal(0, 0.2, (FEATURE_DIM + HIDDEN_DIM, HIDDEN_DIM))
        self.output = rng.normal(0, 0.2, (HIDDEN_DIM * 2, 3))

    def _graph_attention(self, concepts, edges) -> dict[str, np.ndarray]:
        projected = {item.concept_id: _pad(item.features) @ self.w_graph for item in concepts}
        neighbours: dict[str, set[str]] = defaultdict(set)
        for edge in edges:
            neighbours[edge.from_id].add(edge.to_id)
            neighbours[edge.to_id].add(edge.from_id)
        result = {}
        for node_id, value in projected.items():
            peers = [key for key in neighbours.get(node_id, set()) if key in projected]
            if not peers:
                result[node_id] = np.tanh(value)
                continue
            logits = []
            peer_values = []
            for peer in peers:
                peer_value = projected[peer]
                raw = float(np.dot(np.concatenate([value, peer_value]), self.attention))
                logits.append(raw if raw >= 0 else 0.2 * raw)
                peer_values.append(peer_value)
            weights = _softmax(np.asarray(logits))
            result[node_id] = np.tanh(value + sum(weight * peer for weight, peer in zip(weights, peer_values)))
        return result

    def _temporal(self, events) -> dict[str, np.ndarray]:
        states: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(HIDDEN_DIM))
        for event in events:
            x = _pad([event.outcome, event.weight, event.difficulty, 1.0])
            previous = states[event.concept_id]
            combined = np.concatenate([x, previous])
            z = _sigmoid(combined @ self.wz)
            r = _sigmoid(combined @ self.wr)
            candidate = np.tanh(np.concatenate([x, r * previous]) @ self.wh)
            states[event.concept_id] = (1 - z) * previous + z * candidate
        return states

    def score(self, concepts, events, edges) -> list[dict]:
        graph = self._graph_attention(concepts, edges)
        temporal = self._temporal(events)
        results = []
        for item in concepts:
            combined = np.concatenate([graph[item.concept_id], temporal[item.concept_id]])
            raw = _sigmoid(combined @ self.output)
            # Cold-start prior remains visible instead of allowing random
            # bootstrap weights to overwrite a deterministic mastery estimate.
            mastery = float(0.7 * item.baseline_mastery + 0.3 * raw[0])
            results.append({
                "conceptId": item.concept_id,
                "mastery": mastery,
                "recallStability": float(raw[1]),
                "difficultyReadiness": float(0.65 * mastery + 0.35 * raw[2]),
            })
        return results
