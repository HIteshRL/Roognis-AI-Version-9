import fitz
from sqlalchemy import select

import retrieval
from config import get_settings
from database import SessionLocal
from main import app
from models import RetrievalChunk


def make_pdf(lines):
    document = fitz.open()
    page = document.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11)
        y += 24
    return document.tobytes()


def upload_pdf(client, token_factory, *, school_id=None, subject="Science", grade="8", lines=None):
    token_kwargs = {}
    if school_id:
        token_kwargs["schoolId"] = school_id
    client.cookies.set("jwt", token_factory(role="teacher", **token_kwargs))
    content = lines or [
        "10 Light: Mirrors and Lenses",
        "10.1 Reflection of Light",
        "Definition: Reflection is the bouncing back of light from a surface.",
        "Uses of Concave Mirror: Dentists use concave mirrors to see enlarged images.",
        "Why do dentists use mirrors?",
    ]
    response = client.post(
        "/api/rag/upload",
        data={
            "board": "CBSE",
            "curriculum": "NCERT",
            "grade": grade,
            "subject": subject,
            "book": "Curiosity",
            "chapterNumber": "10",
            "chapterName": "Light: Mirrors and Lenses",
            "language": "English",
            "edition": "2026-27",
        },
        files={"file": ("chapter.pdf", make_pdf(content), "application/pdf")},
    )
    assert response.status_code == 200
    return response.json()


def test_retrieve_returns_ai_compatible_chunks_without_auth(client, token_factory):
    school_id = "22222222-2222-2222-2222-222222222222"
    upload_pdf(client, token_factory, school_id=school_id)
    client.cookies.clear()

    response = client.get(
        "/api/rag/retrieve",
        params={
            "q": "Why do dentists use mirrors?",
            "schoolId": school_id,
            "subject": "Science",
            "grade": "8",
            "chapterNumber": "10",
            "top": "3",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["chunks"], list)
    assert payload["chunks"]
    assert len(payload["chunks"]) <= 3
    for chunk in payload["chunks"]:
        assert set(chunk) == {
            "chunkId",
            "entityId",
            "canonicalConceptId",
            "text",
            "source",
            "score",
            "metadata",
        }
        assert isinstance(chunk["chunkId"], str) and chunk["chunkId"]
        assert isinstance(chunk["entityId"], str) and chunk["entityId"]
        assert isinstance(chunk["canonicalConceptId"], str) and chunk["canonicalConceptId"]
        assert isinstance(chunk["text"], str) and chunk["text"]
        assert isinstance(chunk["source"], str) and chunk["source"]
        assert isinstance(chunk["score"], (int, float))
        metadata = chunk["metadata"]
        assert set(metadata) == {
            "schoolId",
            "grade",
            "subject",
            "chapterNumber",
            "chapterName",
            "entityType",
            "pageStart",
            "pageEnd",
        }
        assert metadata["schoolId"] == school_id
        assert metadata["grade"] == 8
        assert metadata["subject"] == "Science"
        assert metadata["chapterNumber"] == 10
        assert metadata["chapterName"] == "Light: Mirrors and Lenses"
        assert isinstance(metadata["entityType"], str)
        assert metadata["pageStart"] == 1
        assert metadata["pageEnd"] == 1


def test_retrieve_applies_school_and_subject_filters_before_scoring(client, token_factory):
    school_a = "22222222-2222-2222-2222-222222222222"
    school_b = "33333333-3333-3333-3333-333333333333"
    upload_pdf(client, token_factory, school_id=school_a, subject="Science")
    upload_pdf(
        client,
        token_factory,
        school_id=school_b,
        subject="Science",
        lines=[
            "10 Light",
            "Uses of Concave Mirror: Dentists use concave mirrors in another school.",
        ],
    )
    upload_pdf(
        client,
        token_factory,
        school_id=school_a,
        subject="Maths",
        lines=[
            "1 Fractions",
            "Example: A dentist mirror sentence should not leak across subject filters.",
        ],
    )

    response = client.get(
        "/api/rag/retrieve",
        params={
            "q": "dentist mirror",
            "schoolId": school_a,
            "subject": "Science",
            "top": "10",
        },
    )

    chunks = response.json()["chunks"]
    assert chunks
    assert {chunk["metadata"]["schoolId"] for chunk in chunks} == {school_a}
    assert {chunk["metadata"]["subject"] for chunk in chunks} == {"Science"}


def test_retrieve_uses_vector_index_when_available(client, token_factory, monkeypatch):
    school_id = "22222222-2222-2222-2222-222222222222"
    upload_pdf(client, token_factory, school_id=school_id)
    with SessionLocal() as db:
        chunk = db.scalars(
            select(RetrievalChunk)
            .where(
                RetrievalChunk.school_id == school_id,
                RetrievalChunk.subject == "Science",
                RetrievalChunk.text.ilike("%Dentists%"),
            )
            .order_by(RetrievalChunk.chunk_index.asc())
        ).first()

    calls = {}

    class FakeCollection:
        def query(self, *, query_embeddings, n_results, where):
            calls["embedding"] = query_embeddings[0]
            calls["n_results"] = n_results
            calls["where"] = where
            return {"ids": [[chunk.vector_id]], "distances": [[0.25]]}

    class FakeVectorRetrievalClient:
        def __init__(self, settings):
            calls["rag_test_mode"] = settings.rag_test_mode

        def embed_query(self, text):
            calls["query_text"] = text
            return [0.1, 0.2]

        def collection(self, collection_name):
            calls["collection_name"] = collection_name
            return FakeCollection()

    monkeypatch.setattr(retrieval, "VectorRetrievalClient", FakeVectorRetrievalClient)
    vector_settings = app.state.settings.model_copy(update={"rag_test_mode": False})
    app.dependency_overrides[get_settings] = lambda: vector_settings
    try:
        response = client.get(
            "/api/rag/retrieve",
            params={
                "q": "dentist mirror",
                "schoolId": school_id,
                "subject": "Science",
                "top": "1",
            },
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["chunks"][0]["chunkId"] == chunk.id
    assert payload["chunks"][0]["text"] == chunk.text
    assert payload["chunks"][0]["source"] == chunk.source
    assert payload["chunks"][0]["score"] == 0.8
    assert calls["query_text"] == "dentist mirror"
    assert calls["embedding"] == [0.1, 0.2]
    assert calls["collection_name"] == chunk.metadata_json["collection"]
    assert calls["where"] == {
        "$and": [
            {"schoolId": school_id},
            {"subject": "Science"},
        ]
    }
    assert calls["rag_test_mode"] is False


def test_retrieve_returns_empty_chunks_for_missing_school_or_no_matches(client, token_factory):
    upload_pdf(client, token_factory)

    missing_school = client.get("/api/rag/retrieve", params={"q": "dentist mirror"})
    no_match = client.get(
        "/api/rag/retrieve",
        params={
            "q": "photosynthesis stomata chlorophyll",
            "schoolId": "22222222-2222-2222-2222-222222222222",
            "subject": "Science",
        },
    )

    assert missing_school.status_code == 200
    assert missing_school.json() == {"chunks": []}
    assert no_match.status_code == 200
    assert no_match.json() == {"chunks": []}
