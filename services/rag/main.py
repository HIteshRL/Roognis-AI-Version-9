# ─────────────────────────────────────────────────────────────────────────────
# Roognis AI — RAG Service stub
# Replace this file with the full implementation.
# See: roognis-ai-design-complete.pdf → LLD v3 → RAG Service :3003
#
# Responsibilities:
#   - POST /api/rag/upload              → upload PDF + embed into ChromaDB
#   - GET  /api/rag/upload/:docId/status
#   - GET  /api/rag/retrieve            → top-5 chunks for AI service (no JWT)
#   - GET  /api/rag/documents           → list uploaded docs for this school
#
# Tech stack: FastAPI + LangChain + PyMuPDF + chromadb SDK + PyJWT + SQLAlchemy
# JWT middleware: see services/auth/middleware/auth.js for the Node.js pattern;
#                 replicate in Python using PyJWT (see LLD for Python snippet)
# DB schema: rag_db — documents table (SQLAlchemy, not Prisma)
# ─────────────────────────────────────────────────────────────────────────────

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import AuthUser, require_teacher
from config import Settings, get_settings
from database import get_db, init_db
from eke_pipeline import run_entity_extraction
from models import (
    Document,
    DocumentIngestionJob,
    DocumentStatus,
    EducationalEntity,
    IngestionJobStatus,
    RetrievalChunk,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Roognis RAG Service", lifespan=lifespan)
app.state.settings = get_settings()


@app.get("/health")
def health():
    return {"status": "stub", "service": "rag"}


@app.get("/api/rag/retrieve")
def retrieve_stub(q: str = "", schoolId: str = "", subject: str = "", top: int = 5):
    # Returns empty chunks so AI service doesn't crash before RAG is implemented
    return []


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
    except Exception as exc:
        document.status = DocumentStatus.FAILED.value
        document.error_message = f"PDF parsing failed: {exc}"
        job.status = IngestionJobStatus.FAILED.value
        job.stage = DocumentStatus.FAILED.value
        job.error_message = document.error_message
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PDF parsing failed.",
        ) from exc

    db.commit()
    db.refresh(document)

    return {
        "documentId": document.id,
        "status": document.status,
        "metadata": public_metadata(document),
        "entitiesCreated": extraction_result.entities_created,
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
    user: AuthUser = Depends(require_teacher),
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


def validate_pdf_upload(file: UploadFile) -> None:
    filename = file.filename or ""
    content_type = file.content_type or ""
    if not filename.lower().endswith(".pdf") and content_type != "application/pdf":
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
    if values["curriculum"] == "NCERT":
        values["sourceType"] = "ncert_textbook"
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
            "grade": document.grade,
            "subject": document.subject,
            "chapterNumber": document.chapter_number,
            "chapterName": document.chapter_name,
        },
        "entityCount": entity_count or 0,
        "chunkCount": chunk_count or 0,
        "uploadedBy": document.created_by,
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
