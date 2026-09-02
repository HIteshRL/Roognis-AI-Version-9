from config import Settings
from gnn_client import score_knowledge


class Response:
    def raise_for_status(self):
        return None

    def json(self):
        return {"nodes": [], "edges": []}


def test_unknown_concept_never_reaches_the_gnn(monkeypatch):
    calls = []

    def post(url, **_kwargs):
        calls.append(url)
        return Response()

    monkeypatch.setattr("gnn_client.httpx.post", post)
    result = score_knowledge(
        Settings(internal_service_token="test"),
        student_id="student-1",
        concept_id="concept:unknown",
        baseline={"mastery": 0.4, "recall_stability": 0.4, "difficulty_readiness": 0.3, "confidence": 0.5},
        evidence=[object()],
    )
    assert result["eligible"] is False
    assert result["reason"] == "unknown_or_inactive_concept"
    assert len(calls) == 1
