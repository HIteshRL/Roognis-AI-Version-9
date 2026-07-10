from pathlib import Path

from main import app


def upload_pdf(client, token_factory, **overrides):
    client.cookies.set("jwt", token_factory(role="teacher", **overrides.pop("token_overrides", {})))
    data = {
        "board": "CBSE",
        "curriculum": "NCERT",
        "grade": "8",
        "subject": "Science",
        "book": "Curiosity",
        "chapterNumber": "10",
        "chapterName": "Light: Mirrors and Lenses",
        "language": "English",
        "edition": "2026-27",
        **overrides,
    }
    return client.post(
        "/api/rag/upload",
        data=data,
        files={"file": ("chapter 10.pdf", b"%PDF-1.4\n%%EOF\n", "application/pdf")},
    )


def test_upload_persists_document_and_returns_contract_response(client, token_factory):
    response = upload_pdf(client, token_factory)

    assert response.status_code == 200
    payload = response.json()
    assert payload["documentId"]
    assert payload["status"] == "queued"
    assert payload["metadata"]["schoolId"] == "22222222-2222-2222-2222-222222222222"
    assert payload["metadata"]["board"] == "CBSE"
    assert payload["metadata"]["curriculum"] == "NCERT"
    assert payload["metadata"]["grade"] == 8
    assert payload["metadata"]["chapterNumber"] == 10

    storage_root = Path(app.state.settings.file_storage_path)
    assert (storage_root / "rag" / "uploads" / f"{payload['documentId']}.pdf").exists()


def test_status_returns_latest_queued_job_progress(client, token_factory):
    upload = upload_pdf(client, token_factory).json()

    response = client.get(f"/api/rag/upload/{upload['documentId']}/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["documentId"] == upload["documentId"]
    assert payload["status"] == "queued"
    assert payload["progress"] == {
        "stage": "queued",
        "percent": 0,
        "pagesParsed": 0,
        "entitiesCreated": 0,
        "chunksCreated": 0,
        "chunksEmbedded": 0,
    }
    assert payload["errorMessage"] is None
    assert payload["updatedAt"]


def test_document_list_is_school_scoped_and_filterable(client, token_factory):
    science_doc = upload_pdf(client, token_factory).json()
    upload_pdf(client, token_factory, subject="Maths", chapterName="Fractions")

    response = client.get("/api/rag/documents?subject=Science&grade=8&status=queued")

    assert response.status_code == 200
    documents = response.json()["documents"]
    assert len(documents) == 1
    assert documents[0]["documentId"] == science_doc["documentId"]
    assert documents[0]["metadata"] == {
        "grade": 8,
        "subject": "Science",
        "chapterNumber": 10,
        "chapterName": "Light: Mirrors and Lenses",
    }
    assert documents[0]["entityCount"] == 0
    assert documents[0]["chunkCount"] == 0


def test_status_returns_404_for_another_school_document(client, token_factory):
    upload = upload_pdf(client, token_factory).json()
    client.cookies.set(
        "jwt",
        token_factory(
            role="teacher",
            schoolId="33333333-3333-3333-3333-333333333333",
        ),
    )

    response = client.get(f"/api/rag/upload/{upload['documentId']}/status")

    assert response.status_code == 404
    assert response.json()["detail"] == "Document not found."


def test_upload_rejects_non_pdf_file(client, token_factory):
    client.cookies.set("jwt", token_factory(role="teacher"))

    response = client.post(
        "/api/rag/upload",
        data={
            "board": "CBSE",
            "curriculum": "NCERT",
            "grade": "8",
            "subject": "Science",
            "book": "Curiosity",
            "chapterNumber": "10",
            "chapterName": "Light: Mirrors and Lenses",
            "language": "English",
            "edition": "2026-27",
        },
        files={"file": ("chapter.txt", b"not a pdf", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF uploads are supported."
