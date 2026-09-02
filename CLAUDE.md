# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read before writing code

| Doc | Why |
|---|---|
| [MASTERCONTEXT.md](MASTERCONTEXT.md) | Binding product direction, build order, forbidden patterns |
| [ARCHITECTUREDesign.md](ARCHITECTUREDesign.md) | Architecture intent, Layer 0–6 sequence (§11), non-negotiables (§13) |
| [HANDOFF.md](HANDOFF.md) | Rolling state of play: what's verified, what's broken, what's next |
| [frontend/DESIGN.md](frontend/DESIGN.md) | **Mandatory before any visual change.** §9 invariants are bugs already paid for |

**Conflict resolution order:** actual code and migrations > `MASTERCONTEXT.md` > `ARCHITECTUREDesign.md` > service LLDs in `docs/`. Never silently reconcile a contradiction — name it, identify which source wins, propose the smallest safe action.

### Docs that are actively wrong

- `docs/backend-services/*_LLD.md` — stale in both directions; several claim missing features that now exist, some claim endpoints that don't.
- `docs/LOCAL_APP_RUNBOOK.md` — Windows/PowerShell, and its port list is stale: `docker-compose.yml` maps **only** `80:80`. There is no `localhost:3000` and no Traefik dashboard (`api.dashboard: false`). Use `http://localhost/`.

## The two-frontends trap

Two separate frontend apps exist. Traefik routes them by path prefix:

- **`frontend/`** → `PathPrefix('/')` — **this is the product.** A single-file PWA: [frontend/index.html](frontend/index.html) is ~8,400 lines holding all CSS, markup, and JS in three `<style>`/`<script>` blocks. Mobile-first, iOS-targeted, bottom tab bar. Served by a hand-rolled static server + `/api/*` proxy ([frontend/server.js](frontend/server.js)) — **no build step**.
- **`web/`** → `PathPrefix('/classroom')` — a secondary React 18 + Vite (plain `.jsx`) Google-Classroom-parity sub-app. Untracked in git.

They talk to **different backends**: `frontend/` uses `/api/{ai,analytics,auth,quiz,rag,practice,discover}` and never touches `/api/lms`. `web/` is the LMS client. The product's domain is therefore subjects → chapters → lessons → quizzes → learning events — **not** classrooms/coursework/gradebook.

When asked to change a frontend or portal, first confirm whether the target is the legacy `frontend/`, the classroom `web/`, or the `frontend-next/` rewrite. Keep teacher intelligence grounded in validated data, with ownership explicitly documented between Analytics and LMS.

## Commands

Everything runs through Docker Compose from the repo root. Requires `.env` (copy `.env.example`) with at minimum `DB_PASSWORD`, `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN`, `DEMO_SCHOOL_ID`.

```bash
docker compose up --build -d
```

```bash
docker compose logs -f textbook-seed
```


App at `http://localhost/`. Demo users: `teacher@demo.com` / `arjun@demo.com` / `parent1@demo.com`, all `demo1234`.

### The demo stack

A pitch-ready environment on its own database (`roognis_demo`), with seeded chat history, quiz attempts, events and Discover personalisation. The **whole stack** repoints at that database, so it exercises identical code — a populated dashboard is evidence the product works, not that the seeder works. `-p` is required: it is what isolates the postgres volume.

```bash
docker compose -p roognis-demo -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

Served on `http://localhost:8080/` (override with `DEMO_HTTP_PORT`), so it can run beside a real stack on `:80`. Tear down with `down -v`; re-running the seeders reproduces byte-identical ids (see the caveat on derived content below).

Seeding is `seed-data/demo-history/plan.json` expanded by three one-shot jobs, one per owning schema. Four independent locks stop it touching real data: `SEED_DEMO_HISTORY` must be `"true"`, `DEMO_SCHOOL_ID` must be set, production compose hardcodes the flag `"false"` so `.env` cannot enable it, and **every target account must still authenticate with the demo password** — so synthetic history structurally cannot land on a real child's account.

**The fixture names no chapters.** Personas declare intent only (`chapterIntent`: preferred subjects and how many chapters); the concrete chapters are read from `GET /api/rag/internal/chapters` at seed time. So the demo studies whatever the school actually uploaded — NCERT or not — and cannot rot when editions change. All three seeders need `RAG_SERVICE_URL` and `INTERNAL_SERVICE_TOKEN`, and gate on `textbook-seed`. With nothing ingested they skip cleanly; with RAG unreachable they exit 1, because a silently empty demo is worse than a loud failure.

**Conversation text is LLM-written, from the chapter's own retrieved chunks** (`seed-data/demo-history/lib/chapter-qa-llm.js`, provider chain OpenRouter → Groq, `LLM_PROVIDER` nominates first). This is a *rendering* step and touches no decision path, so it does not breach the §7 rule. It is optional: with no key, or on any failure, it falls back to deterministic templating over extracted entities (`chapter-qa.js`), which is grounded but reads noticeably flatter. Two filters earn their place — answers that admit a gap ("not specified in the text") or narrate the source ("the chapter gives the example of…") are discarded, because in a seeded transcript both read as the tutor failing.

Don't try to build conversations from `Concept` entities. The corpus has 2680 of them against 58 definitions and 87 questions, but their titles are `first_phrase()` of arbitrary blocks — in practice `"Reprint 2026-27"` and `"Their formidable navy resisted European naval supremacy"`. Volume is not usefulness.

**Chapter selection must depend only on `/chapters`.** Whether text rendering used the LLM or the fallback cannot be allowed to change which chapters were picked, or a seeder with an API key and one without would disagree about what the student studied. Each seeder writes a `chapterSetFingerprint`; if two disagree, the corpus shifted mid-run.

Ids stay a pure function of the fixture (`demoId(email, kind, dayOffset)` encodes no chapter), so a re-seed updates rows in place. *Content* is a function of the fixture, the ingested corpus, **and** the LLM — so message text is no longer byte-reproducible, though ids and counts are. Selection is rendezvous-hashed precisely so one new upload does not reshuffle everyone.

The seeders never fabricate `Quiz`/`QuizQuestion` rows. If no approved quiz exists the quiz job skips cleanly and the weak-area cards stay empty — upload a chapter PDF and let generation run first.

Local AI fallbacks (Ollama embeddings, ChromaDB, ComfyUI) are behind a profile — the default demo path uses `RAG_TEST_MODE=true` with deterministic embeddings and needs neither:

```bash
LLM_PROVIDER=ollama IMAGE_PROVIDER=comfyui docker compose --profile local-ai up --build -d
```

### Iterating on the frontend

`frontend/server.js` reads from disk per request, so hot-patch the running container:

```bash
docker cp frontend/index.html roognisaiteamwork2-frontend-1:/app/index.html
```

That is **not persistent** — the Dockerfile `COPY`s at build time. To make it stick:

```bash
docker compose up -d --build frontend
```

### Tests

Node services use the built-in test runner. The pure-logic suites run with **no `npm install`** — only `services/analytics/tests/app.test.js` needs deps (it requires `express`).

```bash
npm test --prefix services/ai && npm test --prefix services/quiz && npm test --prefix services/auth && npm test --prefix services/discover
```

The demo-history fixture logic has its own suite, outside any service (note the glob — `node --test <dir>` does not recurse into a plain directory here):

```bash
node --test seed-data/demo-history/lib/*.test.js
```

A single file:

```bash
node --test services/ai/test/safety.test.js
```

RAG (Python; needs `services/rag/requirements.txt` installed):

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest services/rag/tests
```

LMS (Python/FastAPI; needs `services/lms/requirements.txt` installed — tests run against an in-memory SQLite via `conftest.py`, not the shared Postgres):

```bash
python -m pytest services/lms/tests
```

Frontend has no test runner. Parse-check the inline scripts and balance the CSS braces before shipping:

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('frontend/index.html','utf8');[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].forEach((m,i)=>{new Function(m[1]);console.log('script_'+(i+1)+'=ok')})"
```

Then verify at 375×812 **and** desktop, in **both themes**, and confirm `document.body.scrollWidth === window.innerWidth`. Invariants 9–11 in `DESIGN.md` only reproduce on a real touch keyboard — verify in the iOS Simulator, not a narrow desktop window.

## Architecture

Traefik on `:80` is the only exposed port; it routes by path prefix to seven services. One PostgreSQL database (`roognis`) with **schema-per-service**.

| Service | Stack | Port | Prefix | DB schema |
|---|---|---|---|---|
| `services/auth` | Express + Prisma | 3001 | `/api/auth` | `auth_db` |
| `services/ai` | Express + Prisma | 3002 | `/api/ai` | `ai_db` |
| `services/rag` | FastAPI + SQLAlchemy | 3003 | `/api/rag` | (shared) |
| `services/analytics` | Express + Prisma | 3004 | `/api/analytics` | `analytics_db` |
| `services/quiz` | Express + Prisma | 3005 | `/api/quiz` | `quiz_db` |
| `services/lms` | FastAPI + SQLAlchemy | 3006 | `/api/lms` | `lms_db` |
| `services/practice` | Express + Prisma | 3007 | `/api/practice` | `practice_db` |
| `services/discover` | Express + Prisma | 3008 | `/api/discover` | `discover_db` |
| `frontend` | vanilla single-file PWA | 3000 | `/` | — |
| `web` | React 18 + Vite | 3000 | `/classroom` | — |

Each Node service has its own `package.json` — no monorepo tooling.

**`services/practice` and `services/discover` are deliberate exceptions to `MASTERCONTEXT.md` §6**, which sanctions only four new services beyond the original six (`kg`, `psv`, `decisions`, `privacy`). Both exist by explicit product-owner decision: `practice` to keep instant/ungated content generation structurally separate from `services/quiz`'s teacher-approval-gated pipeline, and `discover` so the Discover feed can be upgraded on its own cadence rather than inside an already-crowded `services/ai`. See "Instant practice content" and "Agentic Discover" below, `MASTERCONTEXT.md` §6's override note, and `HANDOFF.md` for the full rationale. Do not point to these as precedent for adding further unsanctioned services without the same explicit conversation.

### Auth

JWT in an httpOnly cookie named `jwt`, verified with the shared `JWT_SECRET`. Every Node service carries an identical `middleware/auth.js`: `requireAuth` plus `requireAuth.requireRole(...roles)`. Roles are `student | teacher | parent`. Service-to-service calls authenticate with `INTERNAL_SERVICE_TOKEN` on `/api/*/internal/*` routes. These routes may be gateway-reachable, so the token remains mandatory and must not be exposed to clients.

### Cross-service flows

**Ingestion → quiz generation:** teacher uploads a PDF to `POST /api/rag/upload` → `eke_pipeline.py` chunks and extracts educational entities → RAG calls `POST /api/quiz/internal/chapter-ready` → quiz pulls chapter context from `GET /api/rag/internal/chapter-context` and asks `POST /api/ai/quiz/draft` (OpenRouter) to draft questions.

**Tutor chat:** `POST /api/ai/chat` streams SSE. `buildTutorPrompt` (`services/ai/server.js`) concatenates a profile string + RAG chunks + history + question — string concatenation, not a prompt compiler. The `answer_context` SSE event carries `excerpts[]`, which the client renders as `.message-source` provenance.

**Chat history and extraction.** Sessions are created server-side by `POST /api/ai/chat/session`; `GET /api/ai/chat/sessions` lists them (optional `limit`, default 20, max 100) and `GET /api/ai/chat/:sessionId/history` replays one. Note the list endpoint turns `board`/`curriculum`/`chapterNumber`/`chapterName` query params into **hard equality filters** — a session row missing any of them is dropped in SQL, which is invisible from the client. The frontend surfaces history in three places: the chapter-scoped side rail, an in-chat `<details>` disclosure (the rail collapses below the fold under 1100px), and an all-chats bottom sheet that queries unfiltered. `GET /api/ai/internal/chat-insights?studentId=` returns deterministic topic/entity/chapter rollups over a student's questions (`services/ai/chat-insights.js`, reusing `interest-graph.js`'s matchers, no LLM). It is guarded by `requireInternalService` — **token only, no teacher fallback**, because a teacher-reachable view over a named student's conversations is the thing blocked until `services/privacy` exists.

**Generated visuals.** `services/ai/visuals/` builds educational visuals in two tiers, and the tier is the thing to check first — `INERT_KINDS` vs `EXECUTABLE_KINDS` in `visuals/kinds.js`, with `isExecutable` as the gate. The **inert tier** (`concept_map`) is SVG and is governed by one rule: **the LLM never authors SVG and never authors geometry.** It emits a bounded JSON spec; `graph-layout.js` lays it out and `render-svg.js` is the only module that emits markup. A model asked for `<path d="…">` produces confidently wrong geometry, and the deterministic pipeline also makes the output byte-identical per spec — which the cache depends on. `buildInterestGraph` in `frontend/index.html` (renamed from `interestGraphMarkup` in the 2026-08-22 Obsidian-style graph redesign) is the same pattern and predates it — deterministic force layout (`igForceLayout`) computes coordinates, a colorless renderer emits markup, and node color is now CSS-class-driven off the reserved `--c-*` spectrum instead of the inline hex it used to hardcode.

- Routes (all `studentOnly`): `POST /api/ai/visuals` → 202 `{artifactId}` or 200 on a cache hit; `GET /api/ai/visuals?limit=` lists; `GET /api/ai/visuals/:artifactId` renders on read.
- Kind routing is **deterministic** (`visuals/intent.js`), modelled on `isVideoRequest` and deliberately under-eager: a visual noun must be paired with a request. "What is the relationship between force and friction" is a tutor question, not a diagram request, and must not be hijacked.
- Grounding uses `GET /api/rag/internal/chapter-context`, **not** `retrieveRagChunks` — the latter projects away `chunkId`/`chunkType`/metadata, which are what make a visual citable. `Concept`/`CanonicalConcept` entities are excluded (2680 of them, titles are `first_phrase()` garbage) for the same reason the demo seeder excludes them.
- **No approval gate, by decision.** Consistent with tutor chat, which can be wrong and ships ungated; a visual writes no learner state, so the quiz gate's rationale (a bad answer key corrupts measurement) does not transfer. What keeps it safe is that **nothing fans out**: the cache is keyed on `studentId`, so one student's artifact is never served to another. *If school-wide sharing is ever added it needs a human gate in the same change — sharing and review are one decision.*
- Bounds live in `spec-validate.js`, never in the JSON Schema: OpenAI strict mode ignores `minItems`/`maxItems`/`minimum`/`pattern`. The thrown message **is** the retry prompt (`structured-llm.js` feeds it back as the model's correction turn), so validators must name the field, the problem and the bound.
- `escapeSvgText` is the only defence against a model-authored label reaching `innerHTML`; every text emission goes through it. Every SVG id is prefixed `rv-{artifactId}-` because SVG ids are document-global and two visuals on one page would otherwise collide.

**The executable tier — interactive explainers (`explainer`).** The one kind where **the model authors markup and code**, inverting the rule above. Deliberate and scoped by explicit product-owner decision; the inert tier's rule is unchanged. An explainer is a thing you *operate*, and a JSON spec general enough to describe every such thing would be a programming language with extra steps.

- The model emits `{title, summary, html, css, js, height, citations}` as bounded strings. `render-html.js` is the only module that assembles a document — the model never writes the doctype, the `<head>`, the CSP or the theme block, because a document that authored its own CSP could weaken it. Rendered on read, so a hardening fix reaches every stored artifact (verified: two fixes landed retroactively without regenerating).
- **Three layers, and only two of them are the boundary.** (1) `sandbox="allow-scripts"` with **no** `allow-same-origin` → opaque origin. (2) `default-src 'none'` CSP inside the document → no network at all. (3) `explainer-scan.js`, a deny-list over the model's source. **1 and 2 are the boundary; 3 is quality control that fails closed.** A regex pass over JS is not a sound security control — `window['fe'+'tch']` beats it — and treating it as one is how a scan becomes load-bearing by accident. Proven live: a frame running exactly that obfuscation still reported `origin = "null"`, `cookie THREW SecurityError`, `parent.document BLOCKED`, `fetch BLOCKED`.
- **Never add `allow-same-origin` alongside `allow-scripts`.** Together they let the frame remove its own sandbox, which collapses layer 1.
- The scan runs **twice** — inside the validator at generation time (so its message becomes the model's correction turn) and again in `render-html.js` on every read. The second call is what makes rules retroactive: a spec planted straight into the table renders 500 with a logged cause and a generic student message.
- **An explainer renders; it must never measure.** No scoring, no grading, no persistence, no reporting — those are decisions, and decisions are not the LLM's (`MASTERCONTEXT` §7.1-2). Enforced by the prompt, by the scan's storage/network rules, and structurally by the sandbox.
- **Theme tokens are literal**, in `visuals/theme-tokens.js`. An opaque-origin frame inherits no CSS custom properties, so the values must exist somewhere; one file keeps `DESIGN.md` §9 invariant 5's intent (a palette change is still one edit). Both palettes always ship, because the parent cannot restyle the frame after mount — `applyTheme` re-fetches instead.
- `clearVisualOutput()` **removes** the iframe node rather than hiding it. `display:none` does not stop a document's timers or listeners.
- Reuses the `visual_generated` event with `visualKind: 'explainer'` — no allowlist change. Its metadata is per-kind: `spec.nodes.length` unconditionally would throw on an explainer spec *after* the row was saved `done`, marking a good artifact failed.

**Instant practice content (`services/practice`).** A standalone service (port 3007, `/api/practice`, schema `practice_db`) generating a summary + flashcard deck + MCQ quiz together per lesson, from the same chapter-grounding pattern as visuals. Two deliberate, explicit product-owner decisions, both overriding a documented rule — see "Known live risks" below for the full record:

- **No teacher-approval gate, ever, by design.** Separate from `services/quiz`'s gated `Quiz`/`QuizQuestion`/`QuizAttempt` pipeline — never share a status enum or a table with it. `PracticeSet`/`PracticeAttempt` live only in `practice_db`.
- **It is a 7th service**, exceeding `MASTERCONTEXT.md` §6's 4 sanctioned additions (`kg`/`psv`/`decisions`/`privacy`). Because it cannot import from `services/ai` (no monorepo tooling, no cross-service imports anywhere in this repo), it carries its own duplicated copies of `structured-llm.js` (**copy #5** of provider selection), a trimmed RAG-`grounding.js`, and a trimmed `safety.js` — all three are named debt, not oversights.
- Routes mirror the visuals shape: `POST /api/practice` (kick/cache-hit), `GET /api/practice?documentId=` (gate-status check, used by the frontend on every lesson open so gate state survives a reload), `GET /api/practice/:setId` (renders on read, withholds `correctAnswer`/`explanation` until an attempt is submitted), `POST /api/practice/:setId/attempt` (MCQ-only exact-match grading — no fuzzy short-answer matching, that logic stays in `services/quiz/lib/scoring.js` only), `GET /api/practice/internal/student-learning-context` (internal-token-gated, consumed cross-service by `services/ai/practice-learning-context.js`, merged into `buildTutorPrompt`'s `academicPersonalizationContext` alongside the existing quiz-derived context — same "data, never instructions" framing, never touches difficulty/routing).
- Frontend: a real ribbon button (`data-pane="practice"`, labelled "Quiz") in `#tutor-module-bar`, unlike the hidden-only `quizzes` pane. The mandatory gate reuses the *existing* non-LLM turn-count heuristic (`PRACTICE_GATE_TURN_THRESHOLD = 3`, replacing the old dismissable `maybeShowQuizNudge` banner, which was deleted) — `applyPracticeGate()`/`clearPracticeGate()` grey out (`.module-tab.disabled`) and pulse (`.module-tab.pulse`) sibling tabs, scoped to `#tutor-module-bar` only. **The bottom app nav is never touched** — that scoping is deliberate, not an oversight, and should not be "fixed" into a whole-app lock.

**Agentic Discover (`services/discover`).** Port 3008, `/api/discover`, schema `discover_db`. Owns the whole Discover surface: article store, web-search hunt, interest graph, feed ranking, signals. `services/ai` keeps exactly one relationship to it — an outbound internal read for the tutor prompt (`services/ai/discover-interest-context.js`, modelled on `practice-learning-context.js`).

It replaces two things that were structural limits, not bugs:

- **The feed was not agentic.** `services/ai/student-news.js` is a regex reader over 10 hardcoded BBC RSS URLs; the repo had no web-search capability at all. `search/provider.js` is now a narrow seam (`search({query, maxResults, freshnessDays})`), with `search/tavily.js` behind it and `search/rss.js` as the **zero-key fallback** — with no `TAVILY_API_KEY` the stack still boots and the curated genres still populate; only the hunt lane is missing.
- **The interest vocabulary was closed.** `interest-graph.js` held 41 frozen topics, so "rock climbing", "drones" and "3d printing" were unrepresentable. `interest_topics` is now a table seeded with those 41 and grown at runtime.

**What keeps this inside `MASTERCONTEXT.md` §7.** The LLM does exactly two things: it writes search queries (`hunt/queries.js`), and it *proposes* interest labels (`interest/propose.js`). It never sets a weight, ranks an article, or names a key — `canonicalKey()` in `interest/vocab.js` is a pure function of the label plus a static alias table, so the same label yields the same key everywhere, with or without an API key. Proposals land in `InterestCandidate` and **stop there**; `interest/promote.js`'s `candidateDecision()` is the only path to an `InterestNode`, and it is a pure function admitting exactly two routes: a student's answer, or `evidenceCount >= 3` from *distinct* sessions. Do not add "…or if the model is confident enough". Ranking stays `0.62*cosine + 0.38*recency` plus a fixed exploration lane, in plain code.

- **Search results are untrusted data.** Nothing fetched off the open web is ever concatenated into a system prompt; where a model must see it, it sits inside a delimited block the prompt names as untrusted. A proposal must cite a URL we actually supplied, and labels are capped at 4 words — which is what makes prose injection ("ignore previous instructions…") fail validation rather than rely on the model behaving. Covered by `test/untrusted-content.test.js`.
- **Hunting is per topic, not per student.** One search for "drones" serves everyone holding that node. Topic choice is aggregate node weight in SQL.
- **The scheduler only enqueues; workers claim.** The predecessor refreshed from an in-process `setInterval`, so at `replicas: 2` both pods hit the feeds and raced the same upserts. A `HuntRun` row is claimed with `updateMany({where:{id, status:'queued'}})` — the same pattern quiz/practice/visuals use — so exactly one pod runs a given hunt.
- **Cold start** (`interest/bootstrap.js`) runs once per student: it imports their pre-existing `ai_db` graph over `GET /api/ai/internal/interest-graph`, and seeds their onboarding answers — which previously never reached the graph at all, leaving a new student's "For You" tab with nothing to personalise from. It stamps `importedLegacyGraphAt` **only when `services/ai` actually answered**; stamping on failure would lose that student's history permanently.
- **`GET /api/discover/internal/interest-context`** is internal-token only — **no teacher fallback**, same reasoning as `/api/ai/internal/chat-insights`. This is learner-derived data about a named student and stays blocked until `services/privacy` exists.
- It carries **copy #6** of provider selection (`structured-llm.js`) and a trimmed `safety.js` fork — named debt, for the same no-cross-service-imports reason as `services/practice`.
- The `/api/ai/news*` and `/api/ai/interest-graph` routes survive one release as deprecated shims; the frontend has already moved. Set `NEWS_REFRESH_ENABLED=false` so both services do not poll the same feeds.

**`services/ai/structured-llm.js` is the generic structured-output seam** (OpenRouter strict `json_schema` → Groq `json_object` + schema-in-prompt, with a self-correcting retry). It is currently the **fourth** copy of provider selection — see the comment at the top naming the other three. Migrating them onto it is its own unit of work.

**Analytics is the only aggregate surface.** `GET /api/analytics/teacher/dashboard` returns `studentCount`, `usageStats`, `activeQuiz`, `weakAreas`, `lessonEngagement`, `recentEvents`, `nextActions`; `GET /api/analytics/teacher/interventions` returns per-student flags (`lib/interventions.js`); `GET /api/analytics/student/:id` returns attendance/score/usage summaries. Before declaring a capability missing, check analytics/ai/quiz/rag — not just the LMS.

### Prisma

Dev (`docker-compose.yml`) runs `prisma db push`; production (`docker-compose.production.yml`) runs `prisma migrate deploy`. **A schema change without a generated migration works locally and breaks production.**

## Hard architectural rules

From `MASTERCONTEXT.md` §7/§12 and `ARCHITECTUREDesign.md` §13. Litmus test: *if an LLM can change what, when, how, or how hard the system teaches, it is in the wrong part of the architecture.*

- **No LLM calls** in scoring, item selection, routing, difficulty, intervention, or learner-state mutation paths. LLMs render, extract, and paraphrase only.
- **No server-side timestamps** as response-latency measures. Client timing via `performance.now()`; server wall clock is for ordering only.
- **No learner-state write** without `event_ids[]`, `gate_version`, `model_version`.
- **No `localStorage`/`sessionStorage`** for event-pipeline data — use the typed offline queue. (`localStorage['roognis-theme']` is UI preference, not pipeline data, and is fine.)
- **No engagement signal** (likes, tone preference, session length) feeding a psychometric write. Enforced at the write layer to prevent a sycophancy loop.
- **No teacher/parent view over learner-derived data** before `services/privacy` exists.
- **No clinical or mental-health constructs** in code, tables, columns, or comments. DPDP Act 2023: all learners are presumed minors; academic constructs only. Welfare concerns become human-review flags, never automated inference or automated parent notification.
- **No stack migration as a side effect** of an unrelated task. Editing an existing service means staying on its actual stack; new Layer 2+ services (`kg`, `psv`, `decisions`, `privacy`) use the target stack.
- **No Kafka, event bus, Kubernetes, or OLAP separation** without a demonstrated scaling trigger — despite the manifests in `kubernetes/`.
- **No placeholders, TODO-only work, dead code, or untested measurement logic.**

Build order is strict (Layers 0–6). Layer 0 — freezing the event/PSV/KG/evidence contracts — is not complete, so `services/psv` and `services/decisions` are explicitly not to be written yet.

## Gotchas

- **Every service's Dockerfile does `RUN [ -f package.json ] && npm ci || true` — the `|| true` swallows an `npm ci` failure silently.** `npm ci` refuses to run at all without a `package-lock.json`. A freshly-scaffolded service with no lockfile committed yet will boot with an empty `node_modules` and fail with a confusing `Cannot find module 'express'` — and worse, `npx prisma` then falls back to fetching whatever the latest global Prisma version is instead of the pinned one, which can reject the schema format every other service uses (Prisma 7 vs the 5.x pinned everywhere here). Always run `npm install` inside a new service locally (to generate its lockfile) before the first `docker compose up --build`. This bit `services/practice` on its first real run — see `HANDOFF.md`.
- **`frontend/index.html`, `docker-compose.yml`, `docker-compose.production.yml`, `services/analytics/lib/validation.js` and `kubernetes/secrets/README.md` use CRLF.** (`.env` was listed here too and is **LF** — measured 2026-08-12. Check, don't trust the list.) Multi-line find/replace with `\n` patterns silently matches nothing — the edit reports success and changes the file not at all. Patch line-wise and re-join with the detected EOL. (`services/ai/server.js` was CRLF and is now pure LF — check with `tr -cd '\r' < file | wc -c` rather than trusting this list.)
- **`services/analytics/lib/validation.js` has a `KNOWN_EVENT_TYPES` allowlist.** Any event type not in it gets a 400 that is swallowed by fire-and-forget emitters. `schoolId` is also **required and must be a UUID**, so a cross-school or system-level event has no honest way to be recorded here — log it instead of inventing one. Note the failure mode is invisible from the emitting service: a stale analytics container will 400 every new type while the emitter logs nothing, so **rebuild `analytics` after touching the allowlist**, not just the service that emits. Grep `type:` across the services before adding to an event map — several were once written from imagination.
- **`services/analytics/tests/event-types.test.js` constrains *where* an emitter may live.** It scans **five** sources — `ai/server.js`, `quiz/server.js`, `analytics/routes/analytics.routes.js`, `practice/server.js`, `discover/server.js` — for `type: 'name'` or `fire*AnalyticsEvent('name'` — **single quotes only** (a template literal or a variable is invisible to it). An allowlisted type whose emitter sits in any other module fails the suite as an orphan, so fire new events from one of those five files rather than widening `EMITTER_SOURCES`. It also asserts the reverse: an allowlisted type with no producer fails, so a new type needs a dashboard consumer in the same change. (Verified 2026-08-12; this entry previously said three files and lived at the repo root.)
- **`services/ai` is mixed line endings.** `server.js`, `chat-insights.js`, `interest-graph.js`, `interest-store.js` and the newer tests are LF; `quiz-draft.js`, `safety.js`, `video-search.js`, `onboarding.js`, `student-news.js` are CRLF. `services/analytics/lib/*.js` is CRLF. Check per file; do not assume per directory.
- **Contrast is measured, not eyeballed.** White on `--c-vermilion` is 3.9:1 and white on marigold is ~1.9:1 — both fail. Light hues take dark ink.
- **`apiJson` stringifies `body` itself.** Passing `JSON.stringify(...)` double-encodes and the server rejects with `entity.parse.failed`.
- **`/api/*/internal/*` routes are reachable through Traefik**, contrary to the "never expose one" instruction above — Traefik routes on the service prefix, not the full path, so `INTERNAL_SERVICE_TOKEN` is the only thing standing in front of them. Verified: `GET /api/ai/internal/chat-insights` answers 403 from the public port. Treat the token as the boundary, and never add an internal route that would be safe only because it is unreachable.
- **Safari in the Simulator serves a cached page** on re-opening the same URL. Bust with `?v=n` before concluding a fix didn't work.
- **`[hidden]` loses to any author `display`.** If you set `display` on an element you also toggle with `[hidden]`, add the `[hidden] { display: none }` rule.

## Known live risks

Verify against code before acting — these are as of the latest handoff:

1. ~~**Interest tables have no migration.**~~ **Resolved** (verified 2026-08-04). `services/ai/prisma/migrations/20260730120000_interest_graph/` creates `student_interest_nodes`, `student_interest_edges`, `student_news_signals` and `student_interest_profiles`, and adds `topics`/`entities` to `student_news_articles`. Production `migrate deploy` builds them.
2. ~~**LLM-generated quizzes reach students with no human approval.**~~ **Resolved** (verified 2026-08-04). `Quiz.status` now defaults to `pending_review` (`services/quiz/prisma/schema.prisma`), `20260730130000_quiz_approval_gate` demotes pre-existing `ready` rows, and `POST /api/quiz/quizzes/:quizId/approve` is the teacher gate. `isStudentVisible` admits `ready` only. The transition decision is `approvalDecision` in `services/quiz/lib/quiz-status.js`, covered by `tests/quiz-approval.test.js`.
3. **`services/practice` deliberately reverses two rules above it, both on explicit product-owner instruction (not an oversight — do not silently "fix" either):** (a) it has no teacher-approval gate, ever — a second, honestly-ungated content pipeline now exists alongside `services/quiz`'s still-fully-gated one; (b) it is a 7th service, exceeding `MASTERCONTEXT.md` §6's cap of 4 sanctioned additions. See the "Instant practice content" writeup above for what is and isn't shared with the gated quiz pipeline. **Verified against a live stack** (2026-08-10): 37/37 unit tests pass, and a full API-level pass against a real running `docker compose` stack proved every hop end-to-end (grounding → generation via a real Groq call → validation → persistence → answer-key-withheld-until-submit → grading → cross-service learning-context → analytics dashboard), including a real induced provider failure (OpenRouter out of credits) handled with a clean, non-leaking student-facing message. **Not yet verified**: the frontend UI (ribbon pulsing, gate greying, flashcard flip) has never been rendered in a browser — see `HANDOFF.md` for why (a browser-tooling sandbox limitation in that session, not a known app defect) and pick this up next.
4. **`/classroom` is not served over HTTPS.** `docker-compose.production.yml` defines no `web` service; it is inherited from `docker-compose.yml` when the two are layered (`-f docker-compose.yml -f docker-compose.production.yml`, as `docs/ORACLE_DEPLOYMENT.md` does). But that definition carries only `entrypoints=web` with no `tls`/`certresolver` labels, unlike every production service — so the route exists on `:80` and not on `:443`. `web/` is also untracked in git, so a fresh clone cannot build it at all.
5. **`services/discover` is an 8th service and carries a 6th copy of provider selection**, both explicit product-owner decisions — see "Agentic Discover" above and `MASTERCONTEXT.md` §6's override note. **Verified against a live stack** (2026-08-12): 67/67 unit tests, a full API pass (feed → signal → graph → candidate accept/reject → internal context), the `ai → discover` tutor hop through the real client module, analytics events landing with correct metadata, the multi-replica `HuntRun` claim lease refusing a second claim, and the frontend rendered at 375×812 **and** 1280×720 in **both** themes with `scrollWidth === innerWidth` throughout. A real induced provider failure (OpenRouter 402, out of credits) degraded to deterministic template queries and the hunt still completed.
   **Not verified**: the Tavily client has never made a real HTTP call, and the RSS fallback has never actually fetched — the verification environment had no outbound DNS from containers, so `search/tavily.js` and the live BBC path were exercised only through a stubbed provider and unit tests. Set `TAVILY_API_KEY` on a networked host and confirm a real hunt before trusting the hunt lane in production.
7. **`structured-llm.js` ignores `LLM_PROVIDER`, and has no failover.** `resolveStructuredProvider` picks OpenRouter whenever `OPENROUTER_API_KEY` is *non-empty*, and never consults `LLM_PROVIDER`. Its docblock says "preferring OpenRouter and falling back to Groq", but that fallback is **key-absence selection, not failure failover** — once OpenRouter is chosen, an HTTP error is final. Observed live (2026-08-12): `.env` sets `LLM_PROVIDER=groq` and a valid `GROQ_API_KEY`, yet every visuals generation died on `openrouter … 402 Insufficient credits`. The operator's explicit configuration is silently overridden. This governs **every** `generateStructured` caller, and the file is duplicated as copy #5 (`services/practice`) and #6 (`services/discover`), so a fix has to land in all three or they diverge. Workaround until then: blank `OPENROUTER_API_KEY`. Note `services/ai/server.js`'s own `LLM_PROVIDER` (tutor chat) is a *different* switch that does honour it — the two disagree.

8. **The `ai`↔`discover` topic matcher inherits a left-boundary-only regex.** `(^|[^a-z])term` has no right boundary, so `ai` matches inside "aircraft" — observed live, tagging a drone-regulation article with topic `AI`. This is ported verbatim from `services/ai/interest-graph.js` (where it still exists) and is pinned by the port-equivalence tests, so fixing it means fixing both copies and updating `test/graph.test.js` together.
9. **`GROQ_MODEL` is likely broken right now.** `.env` and `docker-compose.yml` (all three occurrences) still pin `GROQ_MODEL=llama-3.3-70b-versatile` (verified 2026-08-17), which the 2026-08-14 session flagged as scheduled for Groq shutdown on **2026-08-16** — a date that has now passed. This is the default model behind tutor chat, quiz drafting, practice, and discover query generation (everything that doesn't set a task-specific override). `GROQ_VISUALS_MODEL` and `GROQ_EXPLAINER_MODEL` were separately migrated to `openai/gpt-oss-120b` in that same session and are unaffected. Confirm whether Groq actually pulled the model before assuming chat is down, then migrate `GROQ_MODEL` (candidates named in `HANDOFF.md`: `openai/gpt-oss-120b` or `qwen/qwen3.6-27b`).
10. **A provider HTTP error skips the self-correcting retry loop in `structured-llm.js`.** Verified still present 2026-08-17 at `services/ai/structured-llm.js:357` — `const generated = await requestCompletion(messages);` sits inside the `for` attempt loop but **outside** the `try` block that starts two lines later (`:359`), so a non-2xx response or timeout thrown by `requestCompletion` propagates straight out of `generateStructured` on attempt 1, never reaching the `rejectionReason`/retry path built for exactly this. Observed live: a Groq `json_validate_failed` on a correctable formatting error surfaced to a student as "Practice content could not be generated." Two subsequent identical requests succeeded, confirming it's intermittent, not deterministic — retrying would very likely have worked. Fix must land in all three copies (`services/ai`, `services/practice`, `services/discover`) or they diverge; distinguish a retryable status (429/`json_validate_failed`) from a terminal one (401/402) rather than retrying everything blindly.
11. **Explainer content can render its only controls off-screen.** `spec-validate.js` bounds the model-declared `height` (240–720) but nothing cross-checks it against the CSS the same model authors for its own top-level elements, and `render-html.js` sets no `overflow` affordance. Observed live: a declared `height: 400` paired with an authored `#scene { height: 400px }` pushed the sole interactive control (a labelled `<input type="range">`) entirely below the visible frame at both 375px and 1280px — scrollable, but with nothing telling a student to scroll. Not yet fixed.
12. **Concept-map edge labels have no collision check.** `services/ai/visuals/graph-layout.js:338-339` places every edge label at the plain midpoint between the two node centres, with no check against node boxes or other labels. Confirmed live on a real artifact: a vertical edge between x-aligned nodes put its label directly over the target node's own text, rendering as an unreadable overlap. Viewport-independent (it's a layout bug, not a scaling one). Not yet fixed.
13. **`services/rag/main.py`'s upload validation is `OR`, not `AND`.** `validate_pdf_upload` (`main.py:604-611`) only rejects when *both* the filename fails `.pdf` and the `Content-Type` header fails `application/pdf` — so either one alone (a renamed non-PDF file, or a spoofed `Content-Type` header) satisfies it and reaches `fitz.open()` on arbitrary bytes. Verified in code 2026-08-17; flagged by a review agent 2026-08-13, not yet fixed.
14. **Internal-service-token comparisons are not constant-time.** `requireInternalService` in `services/ai/server.js:392` (and presumed the same pattern in the other services' copies — check before assuming one is fixed without the others) uses `internalToken !== INTERNAL_SERVICE_TOKEN`, a timing side-channel on the one secret gating every publicly-reachable `/internal/*` route (see the Traefik gotcha above). Flagged by a review agent 2026-08-13, not yet fixed.

## Session workflow

Treat these as part of "done", like tests:

1. Update the affected `.md` files so docs don't drift from code. Prefer amending an existing doc over creating a new one.
2. Refresh [HANDOFF.md](HANDOFF.md) with what changed, what is verified, what is broken, and what the next session should pick up. It must be honest — unverified claims and known-broken things belong there as much as accomplishments.

This repo has already lost real engineering time to doc drift; handoffs are the mitigation.
