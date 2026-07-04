# Roognis AI Service MVP Context

Last updated: 2026-07-04

This file is the working context for building the Roognis AI Service in small, safe parts. Use it before coding so we do not forget the current scope, accidentally overbuild production features, or mix old design documents with the latest MVP plan.

## Current Goal

Build the AI Service MVP for Roognis.

The MVP should support the investor/user journey:

1. Student logs in through Auth Service.
2. Student creates a chat session.
3. Student asks the AI tutor a question.
4. AI answers through SSE streaming.
5. Chat history is saved.
6. Student can access demo video topics.
7. Student can submit feedback.
8. Student can create an image job and poll status.
9. AI Service fires analytics events without blocking the user flow.

## Progress

Completed:

- Part 1: AI Service foundation.
  - Added AI service `package.json`.
  - Added AI Prisma schema for `chat_sessions`, `messages`, `image_jobs`, and `feedback`.
  - Added AI JWT middleware.
  - Replaced AI stub server with a real Express foundation.
  - Aligned AI Dockerfile with the Auth service install/generate pattern.
  - Verified Prisma generation, Prisma schema validation, and `/health`.

Next:

- Part 2: Chat session, chat history, and SSE chat MVP.

## Source Of Truth

Use the latest design documents from:

- `/Users/chirag.sathish_int/Downloads/roognis-design/parts`
- `/Users/chirag.sathish_int/Downloads/roognis-design/roognis-design-with-quiz.pdf`

Important note: `roognis-design-with-quiz.pdf` is a reordered bundle of the same 32 pages from `parts`.

Older repo-root PDFs are useful background, but they are not fully current because they mention 8 fixes and do not include the final quiz-aware design. The latest plan mentions 9 fixes and adds Quiz Service.

## Local Repo

Repository path:

```text
/Users/chirag.sathish_int/Documents/roognis
```

Git remote:

```text
git@github.com:chiru0631/roognis
```

Current branch:

```text
main
```

## Current Repo State

Implemented:

- `services/auth` is implemented.
- Auth has login, register, logout, `/me`, parent-child linking, seed users, JWT cookie auth, and Prisma schema.
- `docker-compose.yml` has service wiring for frontend, auth, ai, rag, analytics, postgres, chromadb, ollama, comfyui, and traefik.
- `services/rag` has a stub `/api/rag/retrieve` that returns empty chunks.
- `services/analytics` has a stub `/api/analytics/event` that accepts events.

Not implemented yet:

- `services/ai/server.js` is only a stub.
- `services/ai` has no `package.json`.
- `services/ai` has no Prisma schema.
- `services/ai` has no auth middleware copy.
- `services/ai` has no real routes.
- `frontend` is still a stub.
- `seed-data` does not yet contain PDFs, videos, or image assets.

Known design/repo mismatch:

- Latest design expects `grade_level` in student JWT for quiz scoping.
- Current Auth schema and seed do not include `grade_level`.
- This is not required for the first AI chat MVP.
- Patch Auth before quiz-related work.

## MVP Boundary

Build now:

- AI service foundation.
- AI database schema.
- JWT-protected student APIs.
- Chat session creation.
- Chat history.
- SSE chat with Ollama.
- RAG call with safe fallback when RAG is empty or unavailable.
- Analytics fire-and-forget calls.
- Video topics and video serving route.
- Feedback endpoint.
- Basic async image job endpoints.

Skip for now:

- Quiz endpoints.
- Redis/BullMQ.
- S3/object storage.
- Kubernetes hardening.
- Full metrics dashboard.
- Full production observability stack.
- Full RAG implementation.
- Full Analytics implementation.
- Full frontend.
- Enterprise service-to-service auth.

Principle: build a production-shaped MVP, not a full production system.

## AI Service Endpoints For MVP

Health:

- `GET /health`

Chat:

- `POST /api/ai/chat/session`
- `POST /api/ai/chat`
- `GET /api/ai/chat/:sessionId/history`

Video:

- `GET /api/ai/video/topics`
- `GET /api/ai/video/:topic`

Feedback:

- `POST /api/ai/feedback`

Image:

- `POST /api/ai/image`
- `GET /api/ai/image/:jobId/status`
- `GET /api/ai/images/:filename`

Defer:

- `POST /api/ai/quiz/generate`
- `POST /api/ai/quiz/grade`

## AI DB Schema Needed

Use Prisma with schema `ai_db`.

Tables:

- `chat_sessions`
  - `id`
  - `student_id`
  - `school_id`
  - `subject`
  - `created_at`

- `messages`
  - `id`
  - `session_id`
  - `role` as `user` or `assistant`
  - `content`
  - `created_at`

- `image_jobs`
  - `id`
  - `student_id`
  - `school_id`
  - `prompt`
  - `status` as `queued`, `processing`, `done`, or `failed`
  - `image_url`
  - `failure_reason`
  - `created_at`
  - `updated_at`

- `feedback`
  - `id`
  - `message_id`
  - `student_id`
  - `school_id`
  - `rating`
  - `comment`
  - `created_at`

MVP rule: every student-owned row should include `student_id` and `school_id` where applicable.

## Build Plan

### Part 1: AI Service Foundation

Files:

- Add `services/ai/package.json`.
- Add `services/ai/prisma/schema.prisma`.
- Add `services/ai/middleware/auth.js`.
- Replace `services/ai/server.js`.

Build:

- Express app.
- JSON parser.
- Cookie parser.
- Prisma client.
- JWT middleware copied from `services/auth/middleware/auth.js`.
- `GET /health`.
- Basic centralized helpers for env, async errors, and role checks if needed.

Done when:

- `services/ai` can install dependencies.
- Prisma client can generate.
- `GET /health` returns `{ status: "ok", service: "ai" }`.
- Protected routes reject missing/invalid cookies.

### Part 2: Chat Core

Build:

- `POST /api/ai/chat/session`
- `GET /api/ai/chat/:sessionId/history`
- `POST /api/ai/chat` with SSE

Rules:

- Only `student` role can create sessions and chat.
- Subject is required.
- Message is required and max 500 characters.
- Session must belong to `req.user.userId`.
- Load last 10 messages.
- Call RAG:

```text
GET {RAG_SERVICE_URL}/api/rag/retrieve?q={message}&schoolId={schoolId}&subject={subject}&top=5
```

- If RAG returns empty chunks, use a safe fallback context.
- Call Ollama:

```text
POST {OLLAMA_URL}/api/generate
```

- Stream tokens to browser through SSE.
- Save user message and full assistant message.
- Fire analytics event without awaiting success.

Done when:

- Student can create a session.
- Student can send a chat message and receive SSE.
- Chat history returns saved messages.
- RAG stub returning empty chunks does not break chat.

### Part 3: Video And Feedback

Build:

- `GET /api/ai/video/topics`
- `GET /api/ai/video/:topic`
- `POST /api/ai/feedback`

Video topics:

- `photosynthesis`
- `fractions`
- `water-cycle`
- `parts-of-speech`
- `solar-system`

Feedback rules:

- Only students can submit feedback.
- Rating must be 1 to 5.
- Message must belong to the student's session.
- Save feedback.
- Fire `feedback_submitted` analytics event.

Done when:

- Topics endpoint returns the hardcoded demo list.
- Video route returns video URL or a clear 404 if the file is missing.
- Feedback is stored and analytics failure does not break the response.

### Part 4: Image MVP

Build:

- `POST /api/ai/image`
- `GET /api/ai/image/:jobId/status`
- `GET /api/ai/images/:filename`

MVP behavior:

- Create image job with `queued` status.
- Return `jobId` immediately.
- Process in background in the Node process for now.
- If ComfyUI is not ready, mark job as `failed` with a clear reason or use a later demo-safe fallback.
- Polling endpoint returns status and image URL when done.
- Add a timeout cleanup for stuck jobs if simple enough.

Done when:

- Student can create an image job.
- Student can poll job status.
- Failure is explicit and does not leave spinner forever.

### Part 5: Verification

Minimum local checks:

1. AI service dependency install succeeds.
2. Prisma generate succeeds.
3. AI service boots.
4. `/health` works.
5. Unauthenticated protected endpoint returns 401.
6. Auth login gives cookie.
7. Student can create chat session with cookie.
8. Student can call SSE chat route.
9. History contains saved messages.
10. Feedback endpoint works.

Docker checks:

```sh
docker compose up --build ai
docker compose logs -f ai
```

Full stack check later:

```sh
docker compose up --build
```

## Important Implementation Notes

Use existing repo style:

- Node.js 20.
- Express.
- Prisma.
- CommonJS `require`, not ESM.
- `cookie-parser`.
- `jsonwebtoken`.
- `@prisma/client`.

Do not introduce heavy abstractions yet.

Use simple helpers only when they reduce repeated code:

- `fireAnalyticsEvent`
- `fetchWithTimeout`
- `buildTutorPrompt`
- `sendSseEvent`

## Prompt Rules

System behavior from design:

```text
You are Roognis, an AI tutor for school students.
Rules:
- Answer ONLY based on the provided context below.
- If the answer is not in the context, say:
  "I don't have information on that yet."
- Be concise, friendly, and use simple language suitable for school students.
- Never make up facts.
- Format answers with bullet points when listing.
```

MVP adjustment:

- Because RAG is currently stubbed, if no chunks are returned, the prompt can say that textbook context is not available yet and answer only in a limited, clearly educational way, or return the configured fallback phrase.
- Do not pretend NCERT context exists when RAG returned none.

## Analytics Event Types

Fire-and-forget to:

```text
POST {ANALYTICS_URL}/api/analytics/event
```

Events needed now:

- `chat_message`
- `feedback_submitted`
- `image_generated`

Failure to send analytics must never fail the user request.

## Risks To Remember

- RAG is a stub, so real curriculum-grounded answers are not possible yet.
- Ollama model startup can be slow.
- SSE must handle client disconnects.
- The current Auth JWT does not include `grade_level`.
- Seed data videos are missing.
- ComfyUI model download is large and may not be available on every machine.
- Local Docker volume storage is fine for MVP, not final production.

## Next Coding Step

Start with Part 2 only.

Do not implement image, feedback, video, and quiz at the same time as chat.

Next coding checkpoint:

1. Implement `POST /api/ai/chat/session`.
2. Implement `GET /api/ai/chat/:sessionId/history`.
3. Implement `POST /api/ai/chat` with SSE.
4. Call RAG with timeout and safe fallback.
5. Stream Ollama response and save both messages.
6. Fire analytics event without blocking the chat response.
