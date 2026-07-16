# Chapter Quiz Generation Commit Plan

Goal: every ready ingested chapter should receive one high-quality chapter quiz, and teachers should be able to backfill, monitor, and review generated quizzes from the frontend.

## Commit 1: `docs(quiz): define chapter quiz generation plan`

- Capture the service ownership split:
  - RAG owns ingested chapter metadata, entities, chunks, and grounded context.
  - AI owns GPT-5 structured quiz draft generation only.
  - Quiz owns lifecycle, persistence, idempotency, backfill, teacher review, and future publish/submit flows.
- Define the required difficulty distribution: 50% simple, 30% medium, 20% hard, rounded deterministically for the configured question count.
- Define quality gates:
  - Questions must be grounded in chapter chunks.
  - Coverage must span the major chapter sections/concepts.
  - Each question needs difficulty, Bloom level, concept tag, weak-area label, answer, explanation, and source chunk references.

## Commit 2: `feat(rag): expose chapter context for quiz generation`

- Add internal service-token endpoints for ready chapter discovery and deterministic chapter context.
- Return ready chapter groups with document IDs, entity/chunk counts, and a content fingerprint.
- Return ordered chunks/entities for a selected chapter so quiz generation does not depend on free-text retrieval.
- Notify Quiz Service after an upload reaches `ready` without blocking ingestion success.

## Commit 3: `feat(ai): add OpenRouter OpenAI-family quiz draft endpoint`

- Add `POST /api/ai/quiz/draft` for teacher or internal callers.
- Use OpenRouter chat completions with OpenAI-family model slugs only and strict JSON schema output.
- Prompt for age-appropriate questions, broad chapter coverage, exact difficulty counts, explanations, and weak-area tags.
- Validate the generated draft before returning it.

## Commit 4: `feat(quiz): add quiz service lifecycle persistence`

- Add `services/quiz` with Express, Prisma, JWT auth, internal-token auth, and Postgres schema `quiz_db`.
- Store chapter sources, generation jobs, quizzes, and quiz questions.
- Make generation idempotent by chapter identity and RAG content fingerprint.

## Commit 5: `feat(quiz): generate and backfill chapter quizzes`

- Add internal `POST /api/quiz/internal/chapter-ready`.
- Add teacher `POST /api/quiz/backfill` to generate quizzes for all already-ingested ready chapters.
- Add teacher `GET /api/quiz/chapters` and `GET /api/quiz/:quizId` for review.
- Add student-safe list/detail endpoints for ready quizzes without leaking answers.

## Commit 6: `feat(frontend): add teacher chapter quiz workspace`

- Add teacher navigation for Quizzes.
- Show generated/missing/failed quiz counts and chapter coverage.
- Add one-click backfill.
- Show chapter readiness, generation failures, difficulty counts, source counts, and a quiz preview grouped by difficulty.

## Commit 7: `chore(infra): wire quiz service and OpenRouter config`

- Add Quiz Service to Docker Compose and Traefik.
- Pass `OPENROUTER_API_KEY`, `OPENROUTER_QUIZ_MODEL`, `OPENROUTER_QUIZ_REASONING_EFFORT`, `QUIZ_QUESTION_COUNT`, `QUIZ_SERVICE_URL`, and `INTERNAL_SERVICE_TOKEN`.
- Keep the local default RAG path free of Ollama by using `RAG_TEST_MODE=true` unless vector infrastructure is explicitly enabled.

## Commit 8: `test(quiz): cover chapter quiz generation flows`

- Cover difficulty-count math, draft validation, auth boundaries, chapter-ready idempotency, backfill, and API response shapes.
- Cover RAG chapter context shape and upload notification behavior.
- Verify frontend/server syntax and service health paths.

## PR Readiness Checklist

- Uploading a PDF still reaches RAG `ready`.
- A ready upload notifies Quiz Service.
- Backfill creates one quiz per ready chapter.
- Teacher UI shows missing, generating, ready, and failed states.
- Generated quizzes have exact simple/medium/hard counts.
- Student endpoints hide correct answers.
- All new env vars are documented.
