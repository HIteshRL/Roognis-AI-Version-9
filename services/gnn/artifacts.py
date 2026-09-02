from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class ModelArtifact:
    model_version: str
    promoted: bool
    seed: int
    metrics: dict
    promoted_at: datetime | None = None


BOOTSTRAP_ARTIFACT = ModelArtifact(
    model_version="bootstrap-unpromoted-v1",
    promoted=False,
    seed=1729,
    metrics={},
)


def load_artifact(path: str) -> ModelArtifact:
    if not path:
        return BOOTSTRAP_ARTIFACT
    file_path = Path(path)
    if not file_path.is_file():
        return BOOTSTRAP_ARTIFACT
    value = json.loads(file_path.read_text(encoding="utf-8"))
    return ModelArtifact(
        model_version=str(value["modelVersion"]),
        promoted=bool(value.get("promoted", False)),
        seed=int(value.get("seed", 1729)),
        metrics=dict(value.get("metrics") or {}),
        promoted_at=datetime.fromisoformat(value["promotedAt"].replace("Z", "+00:00")) if value.get("promotedAt") else None,
    )


def can_promote(metrics: dict) -> bool:
    candidate = float(metrics.get("candidateMetric", 0))
    baseline = float(metrics.get("baselineMetric", 0))
    candidate_calibration = float(metrics.get("candidateCalibration", 1))
    baseline_calibration = float(metrics.get("baselineCalibration", 1))
    held_out = int(metrics.get("heldOutEvents", 0))
    # A random-looking improvement on a handful of events is not evidence that
    # a model should control a student's experience. Until the daily corpus has
    # a minimally useful held-out set, inference remains on the deterministic
    # baseline even if the candidate happens to score better.
    return held_out >= 20 and candidate > baseline and candidate_calibration <= baseline_calibration
