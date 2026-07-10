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
from fastapi import FastAPI

from config import get_settings

app = FastAPI(title="Roognis RAG Service")
app.state.settings = get_settings()


@app.get("/health")
def health():
    return {"status": "stub", "service": "rag"}


@app.get("/api/rag/retrieve")
def retrieve_stub(q: str = "", schoolId: str = "", subject: str = "", top: int = 5):
    # Returns empty chunks so AI service doesn't crash before RAG is implemented
    return []


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 3003)))
