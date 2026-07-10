# RAG Service LLD

Service path: `services/rag`

## Purpose

RAG owns curriculum context:

- document ingestion
- chunking
- embedding
- vector storage
- retrieval for chat
- retrieval for lesson-based quiz generation

Without RAG, chat and quizzes can run technically but will not be curriculum-grounded.

## Current Repo State

Implemented:

- `GET /health`
- `GET /api/rag/retrieve`

Current retrieve endpoint returns empty chunks.

## Gaps

Missing:

- PDF upload.
- Document status.
- Document table.
- Chunk table.
- Embedding generation.
- ChromaDB collection writes.
- Lesson mapping.
- Lesson-context retrieval for Quiz Service / AI.
- JWT middleware for teacher document management.

## APIs

```text
POST /api/rag/documents
GET  /api/rag/documents
GET  /api/rag/documents/:docId/status
GET  /api/rag/retrieve?q=...&schoolId=...&subject=...&top=...
GET  /api/rag/lessons/:lessonId/context?top=...
```

### `POST /api/rag/documents`

Role: teacher

Upload a PDF or register a seed document.

Response:

```json
{
  "documentId": "uuid",
  "status": "queued"
}
```

### `GET /api/rag/retrieve`

Caller:

- AI Service

Query:

```text
q=photosynthesis
schoolId=uuid
subject=Science
top=5
```

Response:

```json
{
  "chunks": [
    {
      "chunkId": "uuid",
      "text": "Plants make food by photosynthesis...",
      "source": "NCERT Science Grade 6",
      "score": 0.84
    }
  ]
}
```

### `GET /api/rag/lessons/:lessonId/context`

Caller:

- AI Service quiz generation path

Why:

- Teacher selects lesson first.
- Lesson context is more reliable than free-text search.

Response:

```json
{
  "lessonId": "uuid",
  "chunks": [
    {
      "chunkId": "uuid",
      "text": "...",
      "source": "NCERT Science Grade 6",
      "page": 42
    }
  ]
}
```

## Data Model

Use SQLAlchemy as planned in previous docs, or switch to Prisma only if the team wants all services on one DB tool. Do not mix both inside one service.

Tables:

```text
documents
  id
  school_id
  subject
  grade
  title
  file_path
  status
  error_message
  created_by
  created_at
  updated_at

document_chunks
  id
  document_id
  school_id
  subject
  grade
  lesson_id
  chunk_index
  text
  source_page
  vector_id
  created_at
```

## Chroma Collection Strategy

MVP:

```text
school_{schoolId}_{subject}
```

Metadata per vector:

```json
{
  "schoolId": "uuid",
  "subject": "Science",
  "grade": "6",
  "lessonId": "uuid",
  "documentId": "uuid",
  "page": 42
}
```

## MVP Shortcut

Before full PDF ingestion, seed one or two lesson contexts:

- Science / Class 6 / Plants and nutrition
- Maths / Class 6 / Fractions

This is enough to test:

- tutor chat grounding
- teacher quiz generation
- weak-area questions

## Done Criteria

- RAG returns non-empty chunks for seeded lessons.
- AI chat receives context for seeded topics.
- AI quiz generation receives lesson context.
- Missing context returns explicit empty result, not fake data.

## Tests

- retrieve returns chunks for seeded lesson.
- unknown lesson returns empty chunks.
- top parameter is respected.
- teacher document APIs require teacher role.
- school isolation works.

