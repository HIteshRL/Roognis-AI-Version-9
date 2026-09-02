# ─────────────────────────────────────────────────────────────────────────────
# Roognis AI — RAG / Educational Knowledge Engine Service
# See: roognis-ai-design-complete.pdf → LLD v3 → RAG Service :3003
#
# Responsibilities:
#   - POST /api/rag/upload              → upload PDF + embed into ChromaDB
#   - GET  /api/rag/upload/:docId/status
#   - GET  /api/rag/internal/retrieve   → top-5 chunks for AI service
#                                         (service token, not a user JWT)
#   - GET  /api/rag/documents           → list uploaded docs for this school
#
# Tech stack: FastAPI + LangChain + PyMuPDF + chromadb SDK + PyJWT + SQLAlchemy
# JWT middleware: see services/auth/middleware/auth.js for the Node.js pattern;
#                 replicate in Python using PyJWT (see LLD for Python snippet)
# DB schema: rag_db — documents table (SQLAlchemy, not Prisma)
# ─────────────────────────────────────────────────────────────────────────────

import hashlib
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from urllib import request as urlrequest
from urllib.error import URLError

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import AuthUser, get_current_user, require_internal_token, require_teacher
from chunking import generate_chunks_and_embeddings
from config import Settings, get_settings
from database import get_db, init_db
from eke_pipeline import TEXTBOOK_SOURCE_TYPE, run_entity_extraction
from models import (
    Document,
    DocumentIngestionJob,
    DocumentStatus,
    EducationalEntity,
    IngestionJobStatus,
    RetrievalChunk,
)
from retrieval import RetrievalFilters, retrieve_chunks

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Roognis RAG Service", lifespan=lifespan)
app.state.settings = get_settings()


@app.get("/health")
def health():
    return {"status": "ok", "service": "rag"}


@app.get("/api/rag/internal/retrieve")
def retrieve(
    q: str = "",
    schoolId: str = "",
    subject: str | None = None,
    grade: Annotated[int | None, Query(ge=1, le=12)] = None,
    board: str | None = None,
    curriculum: str | None = None,
    chapterNumber: Annotated[int | None, Query(ge=1)] = None,
    top: Annotated[int, Query(ge=1, le=20)] = 5,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _internal: None = Depends(require_internal_token),
):
    """Top chunks for the AI service.

    This is a service-to-service call and always was — the AI service derives
    `schoolId` from the caller's JWT and passes it here. It previously carried
    no authentication of any kind while every sibling route did, and `schoolId`
    is the only tenancy filter, so anyone who knew (or guessed) a school id
    could read that school's entire ingested textbook corpus unauthenticated.

    Now it sits under `/internal/` behind the shared service token, matching
    `internal/chapters` and `internal/chapter-context`. The path moved so the
    security posture is legible from the URL rather than having to be
    remembered.
    """
    chunks = retrieve_chunks(
        db,
        RetrievalFilters(
            q=q,
            school_id=schoolId,
            subject=subject,
            grade=grade,
            board=board,
            curriculum=curriculum,
            chapter_number=chapterNumber,
            top=top,
        ),
        settings=settings,
    )
    return {"chunks": chunks}


@app.post("/api/rag/upload")
def upload_document(
    file: UploadFile = File(...),
    board: str = Form(...),
    curriculum: str = Form(...),
    grade: int = Form(...),
    subject: str = Form(...),
    book: str = Form(...),
    chapterNumber: int = Form(...),
    chapterName: str = Form(...),
    language: str = Form(...),
    edition: str = Form(...),
    difficulty: str | None = Form(None),
    tags: str | None = Form(None),
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    metadata = normalize_upload_metadata(
        user=user,
        board=board,
        curriculum=curriculum,
        grade=grade,
        subject=subject,
        book=book,
        chapter_number=chapterNumber,
        chapter_name=chapterName,
        language=language,
        edition=edition,
        difficulty=difficulty,
        tags=tags,
    )
    validate_pdf_upload(file)

    document = Document(
        school_id=user.school_id,
        filename=safe_filename(file.filename or "document.pdf"),
        content_type=file.content_type,
        board=metadata["board"],
        curriculum=metadata["curriculum"],
        grade=metadata["grade"],
        subject=metadata["subject"],
        book=metadata["book"],
        chapter_number=metadata["chapterNumber"],
        chapter_name=metadata["chapterName"],
        language=metadata["language"],
        edition=metadata["edition"],
        difficulty=metadata.get("difficulty"),
        status=DocumentStatus.QUEUED.value,
        created_by=user.user_id,
        metadata_json=metadata,
    )
    db.add(document)
    db.flush()

    stored_path, file_size = save_upload_file(file, document.id, settings)
    document.file_path = stored_path
    document.file_size_bytes = file_size

    job = DocumentIngestionJob(
        document_id=document.id,
        school_id=user.school_id,
        status=IngestionJobStatus.QUEUED.value,
        stage=DocumentStatus.QUEUED.value,
        progress_percent=0,
        metadata_json={"documentStatus": DocumentStatus.QUEUED.value},
    )
    db.add(job)
    db.flush()

    try:
        extraction_result = run_entity_extraction(db, document, job)
        chunking_result = generate_chunks_and_embeddings(db, document, job, settings)
    except Exception as exc:
        document.status = DocumentStatus.FAILED.value
        document.error_message = f"Ingestion failed: {exc}"
        job.status = IngestionJobStatus.FAILED.value
        job.stage = DocumentStatus.FAILED.value
        job.error_message = document.error_message
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document ingestion failed.",
        ) from exc

    db.commit()
    db.refresh(document)
    notify_quiz_service_chapter_ready(db, document, settings)

    return {
        "documentId": document.id,
        "status": document.status,
        "metadata": public_metadata(document),
        "entitiesCreated": extraction_result.entities_created,
        "chunksCreated": chunking_result.chunks_created,
        "chunksEmbedded": chunking_result.chunks_embedded,
        "collection": chunking_result.collection_name,
    }


@app.get("/api/rag/upload/{doc_id}/status")
def upload_status(
    doc_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    document = get_school_document(db, doc_id, user.school_id)
    job = latest_job_for_document(db, document.id)

    return {
        "documentId": document.id,
        "status": document.status,
        "progress": job_progress(job),
        "errorMessage": document_error_message(document, job),
        "updatedAt": isoformat_or_none(document.updated_at),
    }


@app.get("/api/rag/documents")
def list_documents(
    subject: Annotated[str | None, Query()] = None,
    grade: Annotated[int | None, Query(ge=1, le=12)] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Document).where(Document.school_id == user.school_id)
    if subject:
        query = query.where(func.lower(Document.subject) == subject.strip().lower())
    if grade is not None:
        query = query.where(Document.grade == grade)
    if status_filter:
        query = query.where(Document.status == normalize_status_filter(status_filter))

    documents = db.scalars(query.order_by(Document.created_at.desc())).all()
    return {
        "documents": [document_summary(db, document) for document in documents]
    }


@app.get("/api/rag/documents/{doc_id}/file")
def get_document_file(
    doc_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Serves the original uploaded PDF back — presentation only, no
    learner-state write, so any authenticated role may read it (same access
    pattern as `list_documents` above). Restricted to `ready` documents so a
    student can never fetch a file mid-ingestion or one that failed."""
    document = get_school_document(db, doc_id, user.school_id)
    if document.status != DocumentStatus.READY.value or not document.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    storage_root = Path(settings.file_storage_path).resolve()
    file_path = Path(document.file_path).resolve()
    if storage_root != file_path and storage_root not in file_path.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    download_name = safe_filename(f"{document.chapter_name or document.filename or 'chapter'}.pdf")
    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        filename=download_name,
        content_disposition_type="inline",
    )


@app.get("/api/rag/internal/chapters")
def list_internal_chapters(
    schoolId: Annotated[str | None, Query()] = None,
    subject: Annotated[str | None, Query()] = None,
    grade: Annotated[int | None, Query(ge=1, le=12)] = None,
    _internal: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    query = select(Document).where(Document.status == DocumentStatus.READY.value)
    if schoolId:
        query = query.where(Document.school_id == schoolId.strip())
    if subject:
        query = query.where(func.lower(Document.subject) == subject.strip().lower())
    if grade is not None:
        query = query.where(Document.grade == grade)

    documents = db.scalars(
        query.order_by(
            Document.school_id.asc(),
            Document.subject.asc(),
            Document.grade.asc(),
            Document.chapter_number.asc(),
            Document.created_at.asc(),
        )
    ).all()

    grouped: dict[tuple, list[Document]] = {}
    for document in documents:
        grouped.setdefault(chapter_identity_key(document), []).append(document)

    chapters = [
        chapter_group_summary(db, group_documents)
        for group_documents in grouped.values()
        if group_documents
    ]
    chapters.sort(
        key=lambda item: (
            item["schoolId"],
            item["subject"].lower(),
            item["grade"],
            item["chapterNumber"],
            item["chapterName"].lower(),
        )
    )
    return {"chapters": chapters}


@app.get("/api/rag/internal/chapter-context")
def internal_chapter_context(
    documentIds: Annotated[str | None, Query()] = None,
    schoolId: Annotated[str | None, Query()] = None,
    board: Annotated[str | None, Query()] = None,
    curriculum: Annotated[str | None, Query()] = None,
    grade: Annotated[int | None, Query(ge=1, le=12)] = None,
    subject: Annotated[str | None, Query()] = None,
    book: Annotated[str | None, Query()] = None,
    chapterNumber: Annotated[int | None, Query(ge=1)] = None,
    language: Annotated[str | None, Query()] = None,
    edition: Annotated[str | None, Query()] = None,
    maxChunks: Annotated[int, Query(ge=1, le=120)] = 80,
    _internal: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    documents = find_context_documents(
        db,
        document_ids=parse_document_ids(documentIds),
        school_id=schoolId,
        board=board,
        curriculum=curriculum,
        grade=grade,
        subject=subject,
        book=book,
        chapter_number=chapterNumber,
        language=language,
        edition=edition,
    )
    if not documents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ready chapter context not found.")

    document_ids = [document.id for document in documents]
    all_chunks = db.scalars(
        select(RetrievalChunk)
        .where(RetrievalChunk.document_id.in_(document_ids))
        .order_by(
            RetrievalChunk.pedagogical_order.asc().nullslast(),
            RetrievalChunk.document_id.asc(),
            RetrievalChunk.chunk_index.asc(),
        )
    ).all()
    chunks = evenly_sample_items(all_chunks, maxChunks)
    entities = db.scalars(
        select(EducationalEntity)
        .where(EducationalEntity.document_id.in_(document_ids))
        .order_by(EducationalEntity.created_at.asc(), EducationalEntity.id.asc())
        .limit(160)
    ).all()

    return {
        "chapter": chapter_group_summary(db, documents),
        "chunks": [chunk_context_item(chunk) for chunk in chunks],
        "entities": [entity_context_item(entity) for entity in entities],
    }


def evenly_sample_items(items: list, limit: int) -> list:
    """Keep pedagogical order while representing the beginning, middle, and end."""
    if limit <= 0 or not items:
        return []
    if len(items) <= limit:
        return items
    if limit == 1:
        return [items[0]]

    last_index = len(items) - 1
    indices = [round(position * last_index / (limit - 1)) for position in range(limit)]
    return [items[index] for index in indices]


def chapter_identity_key(document: Document) -> tuple:
    return (
        document.school_id,
        document.board.casefold(),
        document.curriculum.casefold(),
        document.grade,
        document.subject.casefold(),
        document.book.casefold(),
        document.chapter_number,
        document.language.casefold(),
        document.edition.casefold(),
    )


def chapter_group_summary(db: Session, documents: list[Document]) -> dict:
    representative = documents[0]
    document_ids = [document.id for document in documents]
    entity_count = db.scalar(
        select(func.count())
        .select_from(EducationalEntity)
        .where(EducationalEntity.document_id.in_(document_ids))
    ) or 0
    chunk_count = db.scalar(
        select(func.count())
        .select_from(RetrievalChunk)
        .where(RetrievalChunk.document_id.in_(document_ids))
    ) or 0

    return {
        "schoolId": representative.school_id,
        "board": representative.board,
        "curriculum": representative.curriculum,
        "grade": representative.grade,
        "subject": representative.subject,
        "book": representative.book,
        "chapterNumber": representative.chapter_number,
        "chapterName": representative.chapter_name,
        "language": representative.language,
        "edition": representative.edition,
        "documentIds": document_ids,
        "documentCount": len(documents),
        "entityCount": entity_count,
        "chunkCount": chunk_count,
        "status": DocumentStatus.READY.value,
        "contentFingerprint": chapter_content_fingerprint(db, document_ids),
        "updatedAt": isoformat_or_none(max((document.updated_at for document in documents if document.updated_at), default=None)),
    }


def chapter_content_fingerprint(db: Session, document_ids: list[str]) -> str:
    chunks = db.scalars(
        select(RetrievalChunk)
        .where(RetrievalChunk.document_id.in_(document_ids))
        .order_by(RetrievalChunk.document_id.asc(), RetrievalChunk.chunk_index.asc())
    ).all()
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(chunk.document_id.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(chunk.chunk_index).encode("utf-8"))
        digest.update(b"\0")
        digest.update((chunk.text or "").encode("utf-8"))
        digest.update(b"\0")
        digest.update((chunk.source or "").encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def parse_document_ids(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def find_context_documents(
    db: Session,
    *,
    document_ids: list[str],
    school_id: str | None,
    board: str | None,
    curriculum: str | None,
    grade: int | None,
    subject: str | None,
    book: str | None,
    chapter_number: int | None,
    language: str | None,
    edition: str | None,
) -> list[Document]:
    query = select(Document).where(Document.status == DocumentStatus.READY.value)
    if document_ids:
        query = query.where(Document.id.in_(document_ids))
    else:
        if not (school_id and subject and grade and chapter_number):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="documentIds or schoolId, subject, grade, and chapterNumber are required.",
            )
        query = query.where(
            Document.school_id == school_id.strip(),
            func.lower(Document.subject) == subject.strip().lower(),
            Document.grade == grade,
            Document.chapter_number == chapter_number,
        )
        if board:
            query = query.where(func.lower(Document.board) == board.strip().lower())
        if curriculum:
            query = query.where(func.lower(Document.curriculum) == curriculum.strip().lower())
        if book:
            query = query.where(func.lower(Document.book) == book.strip().lower())
        if language:
            query = query.where(func.lower(Document.language) == language.strip().lower())
        if edition:
            query = query.where(func.lower(Document.edition) == edition.strip().lower())

    return db.scalars(query.order_by(Document.created_at.asc())).all()


def chunk_context_item(chunk: RetrievalChunk) -> dict:
    metadata = chunk.metadata_json or {}
    return {
        "chunkId": chunk.id,
        "documentId": chunk.document_id,
        "entityId": chunk.entity_id,
        "canonicalConceptId": chunk.canonical_concept_id,
        "chunkIndex": chunk.chunk_index,
        "chunkType": chunk.chunk_type,
        "text": chunk.text,
        "source": chunk.source,
        "sourcePage": chunk.source_page,
        "pageStart": chunk.page_start,
        "pageEnd": chunk.page_end,
        "pedagogicalOrder": chunk.pedagogical_order,
        "tokenCount": chunk.token_count,
        "metadata": {
            "entityType": metadata.get("entityType"),
            "section": metadata.get("section"),
            "chapterName": chunk.chapter_name,
            "chapterNumber": chunk.chapter_number,
            "subject": chunk.subject,
            "grade": chunk.grade,
        },
    }


def entity_context_item(entity: EducationalEntity) -> dict:
    metadata = entity.metadata_json or {}
    return {
        "entityId": entity.id,
        "entityType": entity.entity_type,
        "canonicalConceptId": entity.canonical_concept_id,
        "title": entity.title,
        "summary": entity.summary,
        "section": metadata.get("section"),
        "pageStart": metadata.get("pageStart"),
        "pageEnd": metadata.get("pageEnd"),
        "objectKind": metadata.get("objectKind"),
    }


def notify_quiz_service_chapter_ready(db: Session, document: Document, settings: Settings) -> None:
    if not settings.quiz_service_url or not settings.internal_service_token:
        return
    try:
        payload = {
            "chapter": chapter_group_summary(
                db,
                [group_document for group_document in sibling_ready_chapter_documents(db, document)],
            ),
            "trigger": "rag_upload_ready",
        }
        request_body = json.dumps(payload).encode("utf-8")
        endpoint = f"{settings.quiz_service_url.rstrip('/')}/api/quiz/internal/chapter-ready"
        req = urlrequest.Request(
            endpoint,
            data=request_body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Internal-Service-Token": settings.internal_service_token,
            },
        )
        with urlrequest.urlopen(req, timeout=3) as response:
            if response.status >= 300:
                logger.warning("Quiz chapter-ready notification returned status %s", response.status)
    except (OSError, URLError, ValueError) as exc:
        logger.warning("Quiz chapter-ready notification failed: %s", exc)


def sibling_ready_chapter_documents(db: Session, document: Document) -> list[Document]:
    return db.scalars(
        select(Document).where(
            Document.status == DocumentStatus.READY.value,
            Document.school_id == document.school_id,
            func.lower(Document.board) == document.board.lower(),
            func.lower(Document.curriculum) == document.curriculum.lower(),
            Document.grade == document.grade,
            func.lower(Document.subject) == document.subject.lower(),
            func.lower(Document.book) == document.book.lower(),
            Document.chapter_number == document.chapter_number,
            func.lower(Document.language) == document.language.lower(),
            func.lower(Document.edition) == document.edition.lower(),
        )
    ).all()


def validate_pdf_upload(file: UploadFile) -> None:
    filename = file.filename or ""
    content_type = file.content_type or ""
    if not filename.lower().endswith(".pdf") or content_type != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF uploads are supported.",
        )


def normalize_upload_metadata(
    *,
    user: AuthUser,
    board: str,
    curriculum: str,
    grade: int,
    subject: str,
    book: str,
    chapter_number: int,
    chapter_name: str,
    language: str,
    edition: str,
    difficulty: str | None,
    tags: str | None,
) -> dict:
    if not 1 <= grade <= 12:
        raise HTTPException(status_code=400, detail="grade must be between 1 and 12.")
    if chapter_number < 1:
        raise HTTPException(status_code=400, detail="chapterNumber must be positive.")

    values = {
        "board": normalize_required_text(board, "board").upper(),
        "curriculum": normalize_required_text(curriculum, "curriculum").upper(),
        "grade": grade,
        "subject": normalize_required_text(subject, "subject"),
        "book": normalize_required_text(book, "book"),
        "chapterNumber": chapter_number,
        "chapterName": normalize_required_text(chapter_name, "chapterName"),
        "language": normalize_required_text(language, "language"),
        "edition": normalize_required_text(edition, "edition"),
        "schoolId": user.school_id,
    }
    if difficulty and difficulty.strip():
        values["difficulty"] = difficulty.strip()
    values["sourceType"] = TEXTBOOK_SOURCE_TYPE
    parsed_tags = parse_tags(tags)
    if parsed_tags:
        values["tags"] = parsed_tags
    return values


def normalize_required_text(value: str, field_name: str) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    return normalized


def parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [
        item.strip()
        for item in value.split(",")
        if item.strip()
    ]


def safe_filename(filename: str) -> str:
    candidate = Path(filename).name
    candidate = re.sub(r"[^A-Za-z0-9._-]+", "_", candidate).strip("._")
    return candidate or "document.pdf"


def save_upload_file(file: UploadFile, document_id: str, settings: Settings) -> tuple[str, int]:
    upload_dir = Path(settings.file_storage_path) / "rag" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    destination = upload_dir / f"{document_id}.pdf"
    max_bytes = settings.rag_max_upload_mb * 1024 * 1024
    total_bytes = 0

    file.file.seek(0)
    with destination.open("wb") as output:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                output.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"PDF upload exceeds {settings.rag_max_upload_mb} MB.",
                )
            output.write(chunk)

    if total_bytes == 0:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    return str(destination), total_bytes


def public_metadata(document: Document) -> dict:
    metadata = dict(document.metadata_json or {})
    metadata.update(
        {
            "schoolId": document.school_id,
            "board": document.board,
            "curriculum": document.curriculum,
            "grade": document.grade,
            "subject": document.subject,
            "book": document.book,
            "chapterNumber": document.chapter_number,
            "chapterName": document.chapter_name,
            "language": document.language,
            "edition": document.edition,
        }
    )
    if document.difficulty:
        metadata["difficulty"] = document.difficulty
    return metadata


def get_school_document(db: Session, doc_id: str, school_id: str) -> Document:
    document = db.scalar(
        select(Document).where(
            Document.id == doc_id,
            Document.school_id == school_id,
        )
    )
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def latest_job_for_document(db: Session, document_id: str) -> DocumentIngestionJob | None:
    return db.scalar(
        select(DocumentIngestionJob)
        .where(DocumentIngestionJob.document_id == document_id)
        .order_by(DocumentIngestionJob.created_at.desc())
        .limit(1)
    )


def job_progress(job: DocumentIngestionJob | None) -> dict:
    if not job:
        return {
            "stage": None,
            "percent": 0,
            "pagesParsed": 0,
            "entitiesCreated": 0,
            "chunksCreated": 0,
            "chunksEmbedded": 0,
        }
    return {
        "stage": job.stage,
        "percent": job.progress_percent,
        "pagesParsed": job.pages_parsed,
        "entitiesCreated": job.entities_created,
        "chunksCreated": job.chunks_created,
        "chunksEmbedded": job.chunks_embedded,
    }


def document_summary(db: Session, document: Document) -> dict:
    entity_count = db.scalar(
        select(func.count())
        .select_from(EducationalEntity)
        .where(EducationalEntity.document_id == document.id)
    )
    chunk_count = db.scalar(
        select(func.count())
        .select_from(RetrievalChunk)
        .where(RetrievalChunk.document_id == document.id)
    )
    return {
        "documentId": document.id,
        "filename": document.filename,
        "status": document.status,
        "metadata": {
            "board": document.board,
            "curriculum": document.curriculum,
            "grade": document.grade,
            "subject": document.subject,
            "chapterNumber": document.chapter_number,
            "chapterName": document.chapter_name,
        },
        "entityCount": entity_count or 0,
        "chunkCount": chunk_count or 0,
        "createdAt": isoformat_or_none(document.created_at),
        "updatedAt": isoformat_or_none(document.updated_at),
    }


def normalize_status_filter(status_value: str) -> str:
    normalized = status_value.strip().lower()
    valid_statuses = {item.value for item in DocumentStatus}
    if normalized not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid document status filter.")
    return normalized


def document_error_message(document: Document, job: DocumentIngestionJob | None) -> str | None:
    if document.error_message:
        return document.error_message
    return job.error_message if job else None


def isoformat_or_none(value) -> str | None:
    return value.isoformat() if value else None


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 3003)))
