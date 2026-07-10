def test_ingestion_endpoint_requires_jwt_cookie(client):
    response = client.get("/api/rag/documents")

    assert response.status_code == 401
    assert response.json()["detail"] == "Unauthorized"


def test_ingestion_endpoint_rejects_non_teacher_role(client, token_factory):
    token = token_factory(role="student")
    client.cookies.set("jwt", token)

    response = client.get("/api/rag/documents")

    assert response.status_code == 403
    assert response.json()["detail"] == "Forbidden"


def test_teacher_jwt_reaches_protected_documents_handler(client, token_factory):
    token = token_factory(role="teacher")
    client.cookies.set("jwt", token)

    response = client.get("/api/rag/documents")

    assert response.status_code == 501
    assert response.json()["detail"] == "Document listing is not implemented yet."
