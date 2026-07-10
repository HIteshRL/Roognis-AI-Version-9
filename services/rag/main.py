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
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status

from auth import AuthUser, require_teacher
from config import get_settings
from database import init_db
import models  # noqa: F401


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
def upload_stub(_user: AuthUser = Depends(require_teacher)):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="PDF ingestion upload is not implemented yet.",
    )


@app.get("/api/rag/upload/{doc_id}/status")
def upload_status_stub(doc_id: str, _user: AuthUser = Depends(require_teacher)):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"Document status is not implemented yet for {doc_id}.",
    )


@app.get("/api/rag/documents")
def documents_stub(_user: AuthUser = Depends(require_teacher)):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Document listing is not implemented yet.",
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 3003)))
