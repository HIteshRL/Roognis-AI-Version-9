def test_health_returns_rag_stub_status(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "stub", "service": "rag"}
