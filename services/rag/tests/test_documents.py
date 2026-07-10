from pathlib import Path

import fitz
from sqlalchemy import select

from database import SessionLocal
from main import app
from models import EducationalEntity, EntityRelationship, EntityType


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
        files={"file": ("chapter 10.pdf", sample_pdf_bytes(), "application/pdf")},
    )


def sample_pdf_bytes(lines: list[str] | None = None) -> bytes:
    content = lines or [
        "10 Light: Mirrors and Lenses",
        "10.1 Reflection of Light",
        "Definition: Reflection is the bouncing back of light from a surface.",
        "Activity 10.1: Look at your face in a spoon.",
        "Observation: The image may look larger in a curved spoon.",
        "Uses of Concave Mirror: Dentists use concave mirrors to see enlarged images.",
        "Exercise",
        "Why do dentists use mirrors?",
    ]
    document = fitz.open()
    page = document.new_page()
    y = 72
    for line in content:
        page.insert_text((72, y), line, fontsize=11)
        y += 24
    return document.tobytes()


def test_upload_persists_document_and_returns_contract_response(client, token_factory):
    response = upload_pdf(client, token_factory)

    assert response.status_code == 200
    payload = response.json()
    assert payload["documentId"]
    assert payload["status"] == "chunking"
    assert payload["entitiesCreated"] > 0
    assert payload["metadata"]["schoolId"] == "22222222-2222-2222-2222-222222222222"
    assert payload["metadata"]["board"] == "CBSE"
    assert payload["metadata"]["curriculum"] == "NCERT"
    assert payload["metadata"]["grade"] == 8
    assert payload["metadata"]["chapterNumber"] == 10
    assert payload["metadata"]["sourceType"] == "ncert_textbook"

    storage_root = Path(app.state.settings.file_storage_path)
    assert (storage_root / "rag" / "uploads" / f"{payload['documentId']}.pdf").exists()


def test_status_returns_entity_extraction_progress(client, token_factory):
    upload = upload_pdf(client, token_factory).json()

    response = client.get(f"/api/rag/upload/{upload['documentId']}/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["documentId"] == upload["documentId"]
    assert payload["status"] == "chunking"
    assert payload["progress"]["stage"] == "chunking"
    assert payload["progress"]["percent"] == 55
    assert payload["progress"]["pagesParsed"] == 1
    assert payload["progress"]["entitiesCreated"] > 0
    assert {
        "chunksCreated": 0,
        "chunksEmbedded": 0,
    }.items() <= payload["progress"].items()
    assert payload["errorMessage"] is None
    assert payload["updatedAt"]


def test_document_list_is_school_scoped_and_filterable(client, token_factory):
    science_doc = upload_pdf(client, token_factory).json()
    upload_pdf(client, token_factory, subject="Maths", chapterName="Fractions")

    response = client.get("/api/rag/documents?subject=Science&grade=8&status=chunking")

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
    assert documents[0]["entityCount"] > 0
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


def test_upload_extracts_canonical_concepts_and_classified_entities(client, token_factory):
    payload = upload_pdf(client, token_factory).json()

    with SessionLocal() as db:
        entities = db.scalars(
            select(EducationalEntity).where(EducationalEntity.document_id == payload["documentId"])
        ).all()
        relationships = db.scalars(
            select(EntityRelationship).where(EntityRelationship.document_id == payload["documentId"])
        ).all()

    entity_types = {entity.entity_type for entity in entities}
    canonical_titles = {
        entity.title
        for entity in entities
        if entity.entity_type == EntityType.CANONICAL_CONCEPT.value
    }
    definition = next(
        entity for entity in entities if entity.entity_type == EntityType.DEFINITION.value
    )

    assert EntityType.CANONICAL_CONCEPT.value in entity_types
    assert EntityType.DEFINITION.value in entity_types
    assert EntityType.ACTIVITY.value in entity_types
    assert EntityType.APPLICATION.value in entity_types
    assert EntityType.QUESTION.value in entity_types
    assert "Reflection of Light" in canonical_titles
    assert "Concave Mirror" in canonical_titles
    assert definition.canonical_concept_id
    assert definition.metadata_json["sourceType"] == "ncert_textbook"
    assert relationships
