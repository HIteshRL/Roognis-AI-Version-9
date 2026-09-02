from datetime import datetime, timedelta, timezone

from artifacts import BOOTSTRAP_ARTIFACT, ModelArtifact, can_promote
from graph_models import KnowledgeGraphTemporalNetwork, PreferenceGraphSAGE
from main import artifact_is_stale
from pretrain import pretrain_and_promote
from rollback import rollback
from schemas import KnowledgeConcept, KnowledgeEvent, PreferenceInteraction, PreferenceTopic


def test_preference_graphsage_preserves_signed_direction():
    model = PreferenceGraphSAGE(BOOTSTRAP_ARTIFACT)
    topics = [
        PreferenceTopic(topicId="space", features=[1, 0, 0, 0]),
        PreferenceTopic(topicId="sport", features=[0, 1, 0, 0]),
    ]
    rows = model.score(topics, [PreferenceInteraction(topicId="space", stance="LIKE", weight=2)], [])
    assert next(row for row in rows if row["topicId"] == "space")["affinity"] > 0


def test_temporal_knowledge_model_returns_bounded_trait_heads():
    model = KnowledgeGraphTemporalNetwork(BOOTSTRAP_ARTIFACT)
    scores = model.score(
        [KnowledgeConcept(conceptId="fractions", features=[0.4, 0.5, 0.3, 0.2], baselineMastery=0.4)],
        [KnowledgeEvent(conceptId="fractions", outcome=1, weight=1, difficulty=0.5)],
        [],
    )
    assert 0 <= scores[0]["mastery"] <= 1
    assert 0 <= scores[0]["recallStability"] <= 1


def test_promotion_requires_predictive_and_calibration_improvement():
    assert can_promote({
        "candidateMetric": 0.72,
        "baselineMetric": 0.68,
        "candidateCalibration": 0.08,
        "baselineCalibration": 0.1,
        "heldOutEvents": 100,
    })
    assert not can_promote({
        "candidateMetric": 0.65,
        "baselineMetric": 0.68,
        "candidateCalibration": 0.08,
        "baselineCalibration": 0.1,
        "heldOutEvents": 100,
    })
    assert not can_promote({
        "candidateMetric": 0.99,
        "baselineMetric": 0.50,
        "candidateCalibration": 0.01,
        "baselineCalibration": 0.50,
        "heldOutEvents": 3,
    })


def test_stale_promoted_model_becomes_ineligible():
    artifact = ModelArtifact(
        model_version="old-model",
        promoted=True,
        seed=1,
        metrics={},
        promoted_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    assert artifact_is_stale(artifact) is True


def test_atomic_rollback_restores_previous_manifest(tmp_path):
    current = tmp_path / "model.json"
    previous = tmp_path / "model.json.previous"
    current.write_text('{"modelVersion":"bad"}', encoding="utf-8")
    previous.write_text('{"modelVersion":"good"}', encoding="utf-8")
    rollback(current)
    assert current.read_text(encoding="utf-8") == '{"modelVersion":"good"}'


def test_pretraining_cannot_promote_when_baseline_is_better(tmp_path):
    output = tmp_path / "model.json"
    result = pretrain_and_promote(
        lane="preference",
        samples=[{
            "topics": [{"topicId": "space", "features": [1, 0, 0, 1], "baselineScore": 1}],
            "interactions": [],
            "edges": [],
            "targetTopicId": "space",
            "targetStance": "LIKE",
        }],
        output=output,
        model_version="candidate-v1",
        candidate_count=2,
    )
    assert result["promoted"] is False
    assert result["metrics"]["heldOutEvents"] == 1
    assert not output.exists()


def test_invalid_pretraining_rows_do_not_count_as_held_out_events(tmp_path):
    result = pretrain_and_promote(
        lane="knowledge",
        samples=[{"targetConceptId": "missing"}],
        output=tmp_path / "model.json",
        model_version="candidate-invalid",
        candidate_count=1,
    )
    assert result["metrics"]["heldOutEvents"] == 0
