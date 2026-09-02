# MASTERCONTEXT.md — ROOGNIS AI

> This document records approved product and architecture direction. The current code, migrations, tests, and explicit product-owner instructions take precedence when they conflict.

---

## 0. HOW TO USE THIS FILE

- Use this document together with the current code and service contracts; it does not override explicit product-owner decisions.
- When documents disagree, identify the conflict and verify relevant behavior in code before changing it.

---

## 1. WHAT ROOGNIS IS

An AI-native Academic Performance Operating System (APOS) for private K-12 schools and NEET/JEE (National Eligibility cum Entrance Test / Joint Entrance Examination) coaching centers in India, Tier 2/3 cities first.

- Not a chatbot. Not an LMS (Learning Management System) skin. Not a RAG (Retrieval-Augmented Generation) assistant.
- The product's durable asset is the per-student, per-concept mastery timeline with full evidence provenance. Content exists to elicit measurement signals, not to deliver information.
- Moat, stated exactly: frontier labs (ChatGPT, Gemini) interpret what students *say*; APOS measures what students *do*, against verified ground truth, longitudinally.

Every engineering decision is judged by one question: **does this protect or improve measurement quality?** If it does neither, it is not a priority.

---

## 2. OPERATING TRAITS (ADOPT THESE WHEN PLANNING AND WRITING CODE)

These are behavioral requirements, not style preferences.

1. **Engineering thought partner, not autocomplete.** Before writing code, determine the actual problem, hidden assumptions, trade-offs, failure modes, and long-term consequences. Correctness outranks agreement. If the request is a worse engineering path than an available alternative, say so before implementing.

2. **Ground truth before generation.** Never describe or modify a module from memory or from a design document. Read the actual file first. The documents in this repo have drifted from the code (see §5); the code wins.

3. **Contracts before implementation.** No feature code is written against a schema that is not frozen (§6, Layer 0). If a needed contract does not exist, build the contract first or stop and flag it.

4. **Determinism is the default for high-impact learner decisions.** Any model-assisted proposal must be constrained, independently validated, deterministically ratified, versioned, and evidenced before it can affect learner state or delivery.

5. **State facts, assumptions, and unknowns separately.** Never fabricate certainty about APIs, library behavior, repo structure, or performance. When evidence is insufficient, say so and say why.

6. **Extend before you create.** Check for existing functionality before adding a file or service. Match existing conventions. Do not restructure without explicit approval and a stated reason.

7. **Every layer independently deployable, every module tested.** No placeholder implementations, no TODOs, no dead code. Unit tests for pure logic, integration tests at boundaries, structured logging, input validation, error handling — in the same change, not later.

8. **No premature infrastructure.** Kafka, Kubernetes, OLAP separation, event bus — all deferred until a concrete, demonstrated scaling requirement exists. Building them early is an active anti-pattern on this project.

9. **Terse, technically dense output.** No filler, no motivational framing, no soft asks, no restating the request back. Expand every abbreviation on first use in a response, then use the short form.

10. **Surface material drift and debt as you find it.**

---

## 3. TECHNOLOGY STACK

Two truths coexist: the **target** stack (where the system is going) and the **actual** stack (what the code is today). Do not silently switch a service between them. When a task requires resolving the gap, state which direction you are aligning and why.

### 3.1 Target stack (the spec)
| Layer | Target |
|---|---|
| Backend | FastAPI (Python), asyncpg, SQLAlchemy, Alembic, structlog |
| Frontend | Next.js 15, React 19, TypeScript strict, Tailwind, shadcn/ui, Zustand, TanStack Query |
| Monorepo | Turborepo + pnpm workspaces |
| Primary DB | PostgreSQL, schema-per-service |
| Graph DB | Neo4j (Knowledge Graph, Learner Graph) |
| Vector | Qdrant (content retrieval only) |
| Embeddings | FastEmbed + BAAI/bge-small |
| Cache / jobs | Redis / BullMQ |
| LLM primary | Groq llama-3.3-70b via provider abstraction |
| Cloud | OCI (Oracle Cloud Infrastructure): OCIR registry, Compute VM + Docker Compose |
| CI/CD | GitHub Actions → OCIR → Compute VM |

### 3.2 Actual stack (current code — verified from the repo)
- Services: `auth`, `ai`, `quiz`, `analytics` are **Node.js/Express + Prisma**; `lms`, `rag` are **FastAPI/SQLAlchemy**. Mixed, not uniform.
- Vector store is **Chroma**, not Qdrant. Embeddings via **Ollama `nomic-embed-text`**, not FastEmbed/BGE.
- Default LLM provider is **Gemini**, with Groq and Ollama as alternates behind a `LLM_PROVIDER` env switch.
- **No monorepo tooling.** Each service has its own `package.json`.
- **No Neo4j. No BullMQ. No Redis job queue.**
- **Kubernetes manifests exist** in `kubernetes/` despite the "no K8s" directive.

### 3.3 Rule for the gap
Do not migrate a service's stack as a side effect of an unrelated task. Stack alignment is its own explicit, approved unit of work. When starting a genuinely new service (§6 Layer 2+: `kg`, `psv`, `decisions`, `privacy`), build it on the **target** stack. When editing an existing service, stay on its **actual** stack unless the task is explicitly a migration.

---

## 4. AI-NATIVE — WHAT IT MEANS HERE (BINDING DEFINITION)

"AI-native" is not "has AI features." For this system it means all ten of the following. Every architectural choice is checked against them.

1. The runtime aggregate root is the **learner state (PSV — Psychographic State Vector)**, not the chat session or the quiz attempt. Interactions are events that mutate PSV; they are not standalone entities that happen to call AI.
2. Every interaction is a **typed measurement event** with client-side monotonic timing — not a UI action that gets logged loosely.
3. AI outputs are **structured decisions bound to evidence**, gated before persistence — not free text streamed to a user and forgotten.
4. The system runs **feedback loops at multiple cadences** (per-session, per-quiz, daily batch) — not single-shot request/response.
5. **Retrieval is a subordinate primitive** invoked by the rendering step *after* deterministic decisions are made — not the spine of the architecture.
6. **Determinism governs what LLMs are unsafe to decide** (selection, difficulty, intervention, routing). LLMs render, extract, paraphrase.
7. The **frontend is a scientific instrument** — primary data-capture apparatus, not a view layer.
8. **Graph-first for learning structure** (Neo4j: concept DAG (Directed Acyclic Graph), prerequisite/misconception/sibling edges), **event-first for behavior** (append-only log).
9. **Content is scaffolding; measurement is the artifact.** Content elicits signals; it is not the durable asset.
10. Business logic is **stateful over the learner**: `f(request, PSV_snapshot) → (response, PSV_delta, evidence_records)`, and PSV is reconstructable from the event log.


---

## 5. GROUND TRUTH — CURRENT STATE (VERIFIED, NOT ASPIRATIONAL)

The system today is a competent **AI-featured tutor at roughly 5% of the world-class measurement ambition.** Plan against this reality, not against the marketing documents.

### 5.1 What exists and works (keep)
- `services/auth` — Prisma `Role` enum already present: `student | teacher | parent`, plus `ParentStudent` links. **The "role enum missing" blocker is already closed.**
- `services/lms` (FastAPI) — Google-Classroom-parity CRUD (Create-Read-Update-Delete): classrooms, coursework, gradebook, guardians, rubrics, discussions. Sufficient.
- `services/rag` (FastAPI) — competent chunking + entity-extraction pipeline (`eke_pipeline.py`) and retrieval. Will be **demoted to a subroutine of the prompt compiler**, not deleted.
- `services/ai/safety.js` — input/output/image safety validation. Well-built. Keep.

### 5.2 What is missing entirely (this is the actual work)
- No per-item event stream. Analytics `KNOWN_EVENT_TYPES` is coarse (`quiz_submitted`, `chat_message`, `lesson_started`). Nothing per question.
- No client-side monotonic timing. `frontend/index.html` tracks `activeSeconds` with wall-clock `Date.now()` at session granularity — the opposite of an instrument.
- No IRT (Item Response Theory): `QuizQuestion.difficulty` is a `VARCHAR` string (`simple|medium|hard`). No discrimination, no ability estimate.
- No BKT (Bayesian Knowledge Tracing), no slip/guess. `services/quiz/lib/scoring.js` is binary: `awardedMarks = correct ? marks : 0`. Latency is never an input.
- No Knowledge Graph. "Weak areas" are LLM-emitted strings aggregated by `label.toLowerCase()` frequency.
- No misconception-indexed distractors. Distractors are freeform LLM output; a wrong answer yields no diagnostic signal.
- No PSV trait/state split. `StudentLearningProfile.profile` is a single mutable JSON blob written once at onboarding, `version` incremented, never updated from behavior. No decay, no state store.
- No evidence ledger. Profile writes carry no evidence IDs, no gate version, no model version.
- No deterministic decision gates, no ZPD (Zone of Proximal Development) selection, no SM-2 (SuperMemo-2) scheduler.
- No DPDP (Digital Personal Data Protection Act) anonymizer / Privacy Guard. Zero matches for `anonymiz|privacy_guard|dpdp|redact` across all services.
- `buildTutorPrompt` (`services/ai/server.js` ~line 1863) concatenates a profile string + RAG chunks + question into one prompt. This is string-concatenation, not a prompt compiler.

### 5.3 Interpretation rule
When a document (including an older MASTERCONTEXT) claims a capability exists, and §5.1/§5.2 says otherwise, §5 wins until you have read the file and confirmed. Treat the strategic thesis as the destination and §5 as the starting coordinates.

---

## 6. BUILD ORDER (STRICT — NO LAYER SKIPPED, NO REORDER)

Each layer gates the next. Do not build Layer N+1 against a Layer N contract that is not frozen. If a chat task belongs to a later layer than the current one, say so and propose the current-layer prerequisite instead.

### Layer 0 — Contracts (freeze before any implementation)
Freeze, in this order, as versioned artifacts:
1. **Event schema** — typed envelope + per-type payloads. Envelope carries `schema_version`, client-generated `event_id` (idempotency key), `event_type`, `student_id`, `session_id`, `item_id?`, `node_id?`, `client_ts_mono` (monotonic ms), `client_ts_wall` (ISO-8601), `payload`. Breaking changes require a `schema_version` bump + CHANGELOG migration note.
   Core event types (extend, never repurpose): `item_rendered`, `first_interaction`, `option_selected`, `answer_changed`, `answer_submitted`, `hint_requested` (payload: level), `confidence_reported` (sure|somewhat|guessing), `item_skipped`, `focus_lost`, `focus_gained`, `self_explanation_submitted`, `worked_example_step_viewed`, `review_item_completed`.
2. **PSV schema** — Core trait store (immutable, versioned, high evidence threshold) and Real-Time state store (session-scoped, decays to null). Per-field evidence-minimum thresholds declared here.
3. **KG schema** — concept nodes; prerequisite, misconception, sibling (interleaving), and taxonomy (subject/chapter/grade/board) edges.
4. **Evidence model (ECD — Evidence-Centered Design)** — explicit mapping: which event types are evidence for which PSV fields, with weights and confidence contributions. Construct model (academic traits only), evidence model, task model.

### Layer 1 — The Measurement Instrument
- Instrumented Quiz Player emitting the Layer 0 events; all timing via `performance.now()`.
- Local event queue (IndexedDB-backed), batched idempotent upload keyed on `event_id`, offline- and crash-tolerant.
- Ingestion endpoint: batched arrays, schema-validated, timestamp-reconciled (trust client mono deltas for durations; server wall clock only for ordering), raw events persisted before any scoring.
Nothing downstream that depends on learner measurement is correct until clean typed timed events stream from the instrument.

### Layer 2 — Learner State
- `services/kg` (Neo4j) — curriculum as concept DAG; misconception nodes edged to distractors. New service, target stack.
- `services/psv` — trait + state stores + evidence ledger. New service, target stack.
- Deterministic scoring gates — pure functions: slip/guess (latency + prior mastery), EWM (Exponentially Weighted Mean) mastery, gaming/wheel-spinning/disengagement detectors. Zero LLM calls. Full unit coverage.
- Evidence ledger — append-only; every PSV write records `event_ids[]`, `gate_version`, `model_version`, timestamp. Doubles as DPDP audit trail.

### Layer 3 — Decision Logic (all deterministic)
- Item selection API — next item where predicted P(correct) ∈ [0.6, 0.75] given ability estimate + KG prerequisites + SM-2 spacing.
- Scaffold-mode selector — mastery <0.3 → worked example; 0.3–0.7 → completion problem; ≥0.7 → bare problem (expertise-reversal effect).
- Intervention triggers — wheel-spinning → escalate to teacher; overconfidence → calibration intervention; disengagement → cool-down + easier item.
- SM-2 review scheduler — exposed as a query API feeding the frontend review queue.

### Layer 4 — Rendering
- Prompt compiler — consumes PSV snapshot + decision output + retrieved chunks + preference block → structured prompt. This replaces `buildTutorPrompt` string concatenation.
- Master LLM renders only. No authority over next-item, topic, difficulty, or intervention.
- RAG becomes a subroutine of the compiler.
- Warm rendering steered by Preference store + current affect state. Engagement-signal writes are **physically severed** from PSV-update writes at the code-path level.

### Layer 5 — Stakeholder Surfaces
- `services/privacy` — DPDP anonymizer + Privacy Guard. Blocks all teacher/parent reads of raw PSV; only aggregates and status flags pass. New service. **Mandatory before any teacher/parent view is enabled.**
- Teacher aggregation views — class mastery heatmaps, wheel-spinning alerts, intervention queue. Never raw PSV.
- Parent views — longitudinal trend + engagement summaries. Never affect states, never clinical framing.

### Layer 6 — Validation
- Predictive-validity dashboard — AUC (Area Under Curve) of PSV-conditioned next-quiz prediction vs profile-ablated baseline. If PSV does not beat baseline, PSV is decoration and is reworked before proceeding. This is also the coaching-center sales artifact.
- Calibration error, test-retest reliability, intervention lift — standing dashboards.

### Sanctioned new services — and the two recorded overrides

This layering sanctions **four** new services beyond the original six: `kg` and `psv` (Layer 2), `decisions` (Layer 3), and `privacy` (Layer 5).

Two services exist beyond that cap. Both were explicit product-owner decisions taken with the cap in view, not oversights, and both are recorded here so the count stays truthful rather than quietly drifting:

1. **`services/practice`** (7th) — instant, ungated practice content. Kept structurally separate from `services/quiz` so that an ungated pipeline can never share a status enum or a table with the teacher-approval-gated one.
2. **`services/discover`** (8th) — the agentic Discover feed and the open-vocabulary interest graph. Split out of `services/ai` so the feed can be upgraded on its own cadence, which was the stated product requirement.

Neither is precedent. A ninth service needs the same explicit conversation, in advance. Note that neither override touches §7: `services/discover`'s LLM writes search queries and *proposes* interest labels, and a deterministic gate (a human answer, or a plain count of independent evidence) is the only thing that turns a proposal into stored state.

---

## 7. NON-NEGOTIABLE PRINCIPLES

1. Deterministic, versioned gates govern high-impact decisions. Model-assisted proposals require independent validation and deterministic ratification.
2. LLM output cannot directly write learner state or bypass the decision gate.
3. Measurement channel and engagement channel are physically separate. Engagement signals (likes, tone preference, session length) never feed psychometric writes. This prevents a sycophancy loop. Enforced at the write layer.
4. Trait/state separation. States never mutate traits without repeated independent evidence.
5. Every profile write is evidenced and versioned (evidence ledger).
6. Explainability. Every recommendation traces to enumerated evidence. If a feature cannot explain itself, it does not ship.
7. Instrumentation before optimization. No new PSV dimension without a defined evidence model and validation KPI (Key Performance Indicator).
8. Frontend is the measuring instrument; timing is client-side (server timestamps are corrupted by Tier 2/3 network jitter).
9. DPDP Act 2023 is a hard boundary (§10).
10. Do not present placeholders or untested measurement logic as complete.

---

## 8. FRONTEND SPEC

Priority order: (1) Instrumented Quiz Player, (2) confidence tap (one-tap Sure/Somewhat/Guessing on a sampled subset), (3) misconception-aware MCQ (Multiple Choice Question) renderer, (4) scaffolding switcher (mode from backend mastery), (5) graduated hint system (nudge → method → partial solution; each click is evidence), (6) self-explanation prompt after worked examples, (7) difficulty-framing microcopy for interleaving/spacing, (8) warm rendering layer, (9) mastery map + SM-2 review queue.

Rules: all timing via `performance.now()`, never `Date.now()` deltas across network; telemetry is fire-and-forget into a local queue, UI never blocks on it; typed events only (§6 Layer 0); Zustand for interaction state, TanStack Query for server state, no raw fetch in components; **no localStorage/sessionStorage for pipeline-owned data** — use the typed local event queue with an explicit persistence strategy.

---

## 9. BACKEND SPEC (40% OF EFFORT)

Event ingestion (batched, validated, idempotent, raw-first) → deterministic scoring gates (pure, fully tested, no LLM) → two stores two speeds (trait high-threshold versioned / state session-scoped decaying, enforced at write layer) → evidence ledger → item selection API (ZPD, deterministic) → SM-2 scheduler → prompt assembly (PSV → steering block → Master LLM, rendering only) → validation dashboard.

---

## 10. DPDP ACT 2023 (HARD BOUNDARY)

- All learners presumed minors. Section 9: no processing likely to cause detrimental effects on a child's well-being; behavioral monitoring of minors is highest-risk.
- **Constructs are academic only** (mastery, engagement, calibration, persistence, cognitive-load tolerance). **Forbidden:** modeling, inferring, or labeling anxiety, depression, attention disorders, or any mental-health condition. Anything resembling a well-being concern routes to a human teacher via flag — never automated inference, never automated parent notification.
- Do not generate code, tables, columns, or comments using clinical naming. Any "Mental Health Processor" concept is renamed and rescoped to **Academic Engagement Processor**.
- Affect states: ephemeral, decay to null, never exported to third-party APIs, surfaced to parents only as aggregates.
- Data Anonymizer + Privacy Guard must exist before any teacher/parent persona reads student data.
- Evidence ledger doubles as the DPDP audit trail.

---

## 11. MIGRATION MAP (CURRENT CODE → TARGET)

- **Keep:** `services/auth`; `services/lms`; `services/rag` (demote to subroutine, do not delete); `services/ai/safety.js`.
- **Rewrite:** `services/quiz` scoring → deterministic gate layer with slip/guess/EWM, distractors KG-linked; quiz-generation LLM must emit distractors **tagged with misconception node IDs**. `services/analytics` → typed, per-item, latency-carrying events; expand `KNOWN_EVENT_TYPES` to the Layer 0 enum. `services/ai/server.js` `buildTutorPrompt` → Layer 4 prompt compiler.
- **Add:** `services/kg` (Neo4j); `services/psv` (stores + ledger); `services/decisions` (selection, scaffold, intervention); `services/privacy` (DPDP guard — blocks Layer 5).
- **Retire:** `frontend/index.html` → instrumented React in `web/`.
- **Reconcile drift:** vector store (Chroma vs Qdrant), embeddings (Ollama vs FastEmbed/BGE), LLM default (Gemini vs Groq), K8s manifests present vs "no K8s" — each is its own approved unit of work, never a side effect.

---

## 12. FORBIDDEN PATTERNS (REJECT EVEN IF CASUALLY REQUESTED)

- LLM calls inside decision gates, scoring, item selection, routing, or any measurement path.
- Engagement/sentiment signals feeding psychometric profile writes.
- State observations mutating trait stores directly.
- Server-side timing used for response-latency measurement.
- Clinical / mental-health constructs, tables, fields, or naming.
- RAG or vector similarity used for routing/decisions.
- Unversioned profile writes, or writes without evidence provenance.
- Building Layer N+1 against an unfrozen Layer N contract.
- Migrating a service's stack as a side effect of an unrelated task.
- Kubernetes/OKE work, Kafka, event bus, or OLAP separation absent a demonstrated scaling trigger.
- Placeholder implementations, TODOs, dead code.
- localStorage/sessionStorage for event-pipeline-owned data.

---

## 13. WORKING AGREEMENT PER TASK

For any non-trivial task, structure the response as: read the relevant files first → state the layer this task belongs to → assumptions / facts / unknowns separated → the change → tests → risks and any drift/debt observed. Skip the ceremony for trivial edits. Never skip reading the file first.

---

## 14. ONE-LINE COMPRESSION

Frontend captures truth with client-side timing. Backend refuses to be fooled by it through deterministic evidence-gated writes. LLM only decorates delivery. Current code is 5% of that; build it in strict layer order, contracts first, and never let an LLM into a decision path.
