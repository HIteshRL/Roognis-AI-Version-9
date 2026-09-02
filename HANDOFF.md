# Session Handoff

> Rolling handoff for the next session. Newest session at the top.
> **Rule:** this file is refreshed at the end of every working session. It must be honest — unverified claims and known-broken things belong here as much as accomplishments.

---

## Session — 2026-08-23 (latest): Swipe-to-go-back — removed the floating back button and the bottom bar's auto-hide

### Why

Direct product-owner follow-up on the 2026-08-22 panoramic-layout session below: remove the back button from the top entirely (not just the topbar band — the floating `#back-btn` chip that session introduced), make scrolling/interaction feel fully panoramic/full-screen, and replace tap-to-go-back with a left-to-right swipe on the bottom global band. Also: remove the 5-second auto-hide timeout on the mobile bottom bar (it should be permanently visible), make the bar more translucent, and keep tab navigation to plain tapping. Implemented by a single dispatched `Agent` (general-purpose) per explicit instruction to "run subagents for this"; I reviewed its diff and report rather than re-doing the work.

### What changed

All in `frontend/index.html` (10737 → 10706 lines, net −31; CRLF preserved and verified):
- **`#back-btn` removed outright** — markup, its CSS (was split out of a shared `#back-btn, #notif-btn` block; `#notif-btn`'s rule preserved standalone), and all JS wiring (`updateBackButton()` and its three call sites in `pushNav`/`goBack`/`resetNavStack`, the click listener). `goBack()` and the rest of the `navStack` machinery are untouched — only the UI trigger changed.
- **5-second auto-hide IIFE removed entirely** (`revealBar()`, `hideTimer`, the `scroll`/`pointerdown` listeners, `.bar-visible`) and **replaced in the same spot (~line 5968) with a swipe-to-go-back gesture**: `pointerdown`/`pointermove`/`pointerup` scoped to `.sidebar` (not `document`, so it can't fight normal content scrolling), firing `goBack()` only when horizontal displacement clears 60px, `|dy| < dx * 0.5` (rejects diagonal drags), direction is left-to-right, and `state.navStack.length` is non-zero. A capture-phase `click` listener on `.sidebar` suppresses the trailing tap on whatever `.nav-btn` the gesture passed over, so a swipe never also fires a tab switch. Wired at all viewport widths (not mobile-only) since `.sidebar` exists at both breakpoints and it costs nothing extra.
- **Mobile `.sidebar` pill is now permanently visible** — the hidden-by-default state (`opacity:0`, `translateY`, `pointer-events:none`, the `.bar-visible` override) is deleted, along with a now-dead `prefers-reduced-motion` rule that only supported that mechanism.
- **More translucent**: `color-mix(in srgb, var(--ap-surface) 62%, transparent)` (was 78%) with `backdrop-filter: saturate(160%) blur(24px)` (was `blur(20px)`).
- **New interactive polish**: `.sidebar:has(.nav-btn.is-pressed)` brightens the pill's border/shadow while any tab is mid-press.
- **Untouched, confirmed by grep/diff**: `#notif-btn` and its behavior, `#onboarding-back-btn` (a distinct wizard element), the desktop persistent 248px `.sidebar` rail, `renderNav()`'s delegated tap-navigation handlers.
- **`frontend/DESIGN.md` updated in the same session** (by me, not the agent): Invariant 15 retuned to 62%/`blur(24px)` and documents the bar is now permanently visible; §8a rewritten around the swipe gesture (replacing the floating-chip description); the §9 desktop-notifications paragraph's stale `#back-btn` cross-reference removed; the "Panoramic layout" subsection updated to describe a chip-less top (notifications remain the one floating chip; back nav has no chip at all now).

### Verified live (Docker stack, `docker cp` hot-patch, Browser-pane tool, `arjun@demo.com`)

Per the dispatched agent's report: inline-script syntax check passes on both `<script>` blocks; CSS braces balanced (798/798); no `#back-btn` present in the DOM; bar visible on load and **still** visible (`opacity:1`, `pointer-events:auto`, `transform:none`) after 6+ seconds idle, confirming the auto-hide is gone; normal taps on nav buttons still navigate; a simulated `pointerdown`→`pointermove`(dx≈80,dy≈2)→`pointerup` sequence successfully called `goBack()` and changed the visible route; no horizontal overflow (`document.body.scrollWidth === window.innerWidth`) at 375×812 and 1280×800; translucency/contrast read correctly in both themes (measured `background: color(srgb … / 0.62)`, `backdrop-filter: saturate(1.6) blur(24px)` in dark theme); desktop layout unaffected.

### Not yet verified

- **The swipe gesture has only been exercised via simulated `pointerdown`/`pointermove`/`pointerup` events in the Browser-pane tool — never on a real touch device or in the iOS Simulator.** This repo's own DESIGN.md flags exactly this category (invariants 9–11: safe-area-inset behavior, touch-target sizing, real-keyboard interaction) as reproducing only on real touch hardware, not desktop/emulated environments. A synthetic pointer sequence proves the JS logic is reachable and correct in isolation, but not that a real finger's velocity/jitter/multi-touch behavior triggers it reliably, doesn't fight iOS's own edge-swipe-back gesture, or doesn't accidentally fire during normal vertical scrolling on the pill itself. **This is the single highest-priority item for the next session** before calling the redesign shipped.
- **No stopwatch/long-idle timing check beyond ~6 seconds** — the removal of the auto-hide was confirmed structurally (code path deleted, class never re-added) and by a 6+ second idle observation, not by, e.g., leaving the app idle for several minutes.
- **Change is hot-patched only (`docker cp`), not rebuilt into the image** — `docker compose up -d --build frontend` has not been run in this session or any prior session of this multi-session effort. The file on disk is current, so a rebuild should pick it up, but that has not actually been executed or verified.
- **No check that the swipe gesture coexists cleanly with the interest-graph's own pan/drag gestures** (the Obsidian-style graph sheet below, 2026-08-22 session) if that sheet is ever open over `.sidebar`'s hit area — the two features were built in separate sessions and never tested together.

---

## Session — 2026-08-22: Panoramic layout — removed the global topbar, auto-hiding translucent mobile bottom bar

### Why

Product ask: remove the global top band (notification bell + back button) so the main content view runs edge to edge top to bottom on both mobile and desktop ("panoramic"), and make the mobile bottom tab bar translucent, hidden by default, appearing only while scrolling and auto-collapsing 5s after the last interaction. This directly conflicts with `frontend/DESIGN.md`'s "flat, opaque, no `backdrop-filter`" rule (§3/§8/Invariant 15) and with the topbar owning back/notifications (old §8a/§9), so three conflicts were surfaced via `AskUserQuestion` before writing code and the user's answers are binding: (1) apply to **both** mobile and desktop, not mobile-only; (2) float a minimal `#back-btn` chip over content instead of relocating it into the bottom bar, and consolidate notifications onto the existing mobile bottom-bar tab only (desktop keeps a floating `#notif-btn` chip); (3) the backdrop-filter override is a **scoped, documented exception** for this one element, not a system-wide reopening of translucency — DESIGN.md updated accordingly (see below).

### What changed

All in `frontend/index.html`:
- **`.topbar`** collapsed to `height: 0`, `background: transparent`, `pointer-events: none` (cascade-final override — the element stays in the DOM because unguarded `document.querySelector('#topbar-title').textContent = …` calls elsewhere in the file would throw if it were removed, but it reserves no layout space and paints nothing).
- **`#back-btn`/`#notif-btn`** became independent `position: fixed` circular chips at the top corners (`top: calc(14px + safe-area-inset-top)`), instead of living inside `.topbar`. `#notif-btn` is `display: none` under `max-width: 760px` since the mobile bottom bar's Alerts tab already covers notifications there.
- **`.workspace { padding-top: calc(64px + safe-area-inset-top) }`** kept (not removed) — this isn't topbar clearance, it's breathing room so page content doesn't render directly under the floating chips.
- **`.sidebar` (mobile, ≤760px)** — the bottom tab bar — became a floating pill: `color-mix(in srgb, var(--ap-surface) 78%, transparent)` + `backdrop-filter: saturate(160%) blur(20px))`, starting hidden (`opacity:0`, translated below the viewport, `pointer-events:none`) with a `.bar-visible` class flipping it to shown. A small IIFE (~line 6020) listens for `scroll` (capture, passive) and `pointerdown` on `document`, calling `revealBar()` which adds `.bar-visible` and resets a 5000ms hide timer.
- **Bug found and fixed live**: `#back-btn`'s `left: 14px` collided with the persistent desktop `.sidebar` rail's brand logo, because the chip is `position:fixed` against the viewport and doesn't know about the 248px grid column. Fixed with `@media (min-width: 761px) { #back-btn { left: calc(248px + 14px); } }`.
- **`frontend/DESIGN.md` updated** in the same session: Invariant 15 now documents the mobile-bottom-bar backdrop-filter exception by name (not a precedent for translucency elsewhere); §8a rewritten to describe the floating chip and the desktop offset fix; §9 rewritten to describe the floating `#notif-btn`/mobile-tab-only notification split and adds a "Panoramic layout" subsection explaining the `.topbar`/`.workspace` mechanics.

### Verified live (Docker stack, `docker cp` hot-patch)

- Inline-script syntax check passes (`new Function` over both `<script>` blocks); CSS brace count balanced (806/806, up from 804/804 pre-change).
- Desktop (1280×800) **and** mobile (375×812), **both** light and dark themes: no topbar band, floating back/notif chips render with correct contrast, no horizontal overflow (`document.body.scrollWidth === window.innerWidth` holds at both widths).
- Desktop back-button/sidebar-logo overlap: confirmed via `getBoundingClientRect()` before the fix (`#back-btn` right edge 56px vs `.sidebar .brand` right edge 233px — direct overlap) and after (`#back-btn` left edge moves to 262px, clear of the 233px brand boundary by 29px). Confirmed visually in both themes.
- Mobile bottom-bar auto-hide/reveal mechanics confirmed via direct `classList`/`getComputedStyle` inspection in **both** themes: `.bar-visible` toggles correctly on scroll/tap, `pointer-events` flips in sync with the class (instant, non-transitioning), and `opacity`/`transform` visibly animate across the `bar-visible` toggle. Translucent background and `backdrop-filter` both confirmed present and theme-correct (`color(srgb 1 1 1 / 0.78)` + `saturate(1.6) blur(20px)` in light theme; equivalent dark value in dark theme).

### Not yet verified

- **The exact 5-second auto-hide timing was not stopwatch-verified.** Behavior (reveal-on-scroll, class removed sometime after the last interaction) was confirmed correct, but this session's Browser-pane tooling had enough call-to-call latency variance that a precise "still visible at 4.9s, gone by 5.1s" measurement wasn't attempted. Worth a clean timed pass next session if the exact duration matters.
- **No iOS Simulator pass.** DESIGN.md is explicit that invariants 9–11 (safe-area-inset behavior, touch-target sizing) only reproduce on a real touch keyboard/device — this session verified only in the Browser pane at emulated mobile width. Should be done before calling this fully shipped, especially since the auto-hide bar sits inside `env(safe-area-inset-bottom)`.
- **Change is hot-patched only (`docker cp`), not rebuilt into the image.** `docker compose up -d --build frontend` has not been run; a container rebuild from the current Dockerfile would currently pick up this change since the file on disk is already updated, but no rebuild has actually been executed/verified this session.
- **No overlap check was done between the floating chips and in-content sticky headers** (e.g. the Tutor pane's search pill) beyond the sidebar-logo case above — worth a pass if a pane's own sticky header sits near the top-corner chips.

---

## Session — 2026-08-22: Fixed a practice-gate dead end in `frontend/index.html`

### Why

Product ask: confirm the practice/tutor gate ("Once the quiz and flashcards are done, unlock the other parts of the tutoring band") only unlocks on real completion, and find a reported glitch. The backend rule (`services/practice/server.js:262`, `complete = flashcardsReviewed && allAnswered`) was already correct and untouched. The bug was in the frontend's handling of an *incomplete* submission.

### What was broken

`renderPracticeResult()` (`frontend/index.html:8587`, pre-fix) unconditionally hid `#practice-quiz-form` after any submit — including one where `flashcardsReviewed` was false. Nothing in the UI required flipping through every flashcard before the quiz's native `required` validation let a student submit, so this was easy to hit: answer all questions, submit without ever opening the flashcards, and the gate stays active (other `#tutor-module-bar` tabs disabled via `pointer-events: none`) while the only form that could resubmit is now gone. `loadPracticeSet()` — the one thing that re-shows the form — only runs on pane load/navigation, and the gate itself blocks navigating anywhere else. Dead end with no recovery short of a page reload (which re-derives the gate from the server and re-renders the pane fresh, so a reload happened to work, but nothing in the UI told a stuck student to try that).

### Fix

`frontend/index.html:8587` — only hide the form when `payload.complete` is true; on an incomplete submission the form (with prior answers still filled in) and the result panel now stay visible together, so the student can flip the remaining flashcards and resubmit without leaving the pane. Status copy updated to say to submit again. Verified: inline-script parse check passes (`new Function` over both `<script>` blocks).

### Not yet verified

Not re-tested against a live Docker stack in this session — no browser click-through of the actual stuck-then-recovered flow. Next session (or before trusting this fully) should reproduce: open a lesson, answer the practice quiz without touching flashcards, submit, confirm the form and result both stay visible, flip all flashcards, resubmit, confirm `clearPracticeGate()` fires and the other tabs re-enable.

---

## Session — 2026-08-22: Obsidian-inspired redesign of the interest graph (`frontend/index.html`)

### Why

Product ask: redesign the "Your interests" graph (opened from Discover) to feel like Obsidian's Graph View — dark, spatial, real node-to-node edges, hover/select neighborhood highlighting, pan/zoom, a details panel — while reusing the existing hand-rolled-SVG architecture (single-file PWA, no build step, no new libraries) and respecting `frontend/DESIGN.md`'s invariants. Full plan at `/Users/hitesh/.claude/plans/you-are-modifying-the-tender-ullman.md`. Two decisions confirmed with the product owner up front: the canvas stays dark regardless of the app's own light/dark theme toggle (a deliberate, scoped exception), and the redesign — including cluster-filter chips — shipped as one combined change rather than phased.

### What changed

All in `frontend/index.html`, no backend changes (the API already returned everything needed):
- **Real edges, finally rendered.** The old `interestGraphMarkup` drew a fixed radial layout (genres/topics in two rings) with synthetic spokes from a center "YOU" node to every other node — `graph.edges` from `GET /api/discover/interests` was fetched and silently discarded. Replaced with `igForceLayout()`, a dependency-free Fruchterman-Reingold-style simulation (pairwise repulsion + edge-weighted spring attraction + mild centering gravity, 300 fixed iterations, seeded from a stable hash of each node's `id` rather than `Math.random()` so the same graph always lays out the same way — same determinism spirit as `services/ai/visuals/graph-layout.js`). Verified live: all rendered edges connect two real nodes, none originate from a synthetic center point.
- **`IG_CLUSTER_COLOR`'s hardcoded hex map deleted** — this was a known, explicitly-flagged DESIGN.md §20 violation (`services/ai/visuals/render-svg.js`'s own comment called it out as "deliberately not copied"). Node color now comes entirely from CSS classes keyed on `data-cluster`, bound to the reserved 12-hue `--c-*` data-viz spectrum.
- **New dark-only token set, scoped to `.ig-wrap`** (`--ig-bg`, `--ig-ink`, `--ig-muted`, `--ig-line`, `--ig-accent`, etc.) — a deliberate exception to the app's theme-flipping `--ap-*` tokens, since the graph must read as a fixed dark space rather than a themed panel. Verified live: canvas stays `rgb(11,13,16)` even with `data-theme="light"` forced.
- **Interactions, all new** (no pan/zoom/pinch code existed anywhere in the file before this): drag-to-pan and wheel-zoom-to-cursor and pinch-zoom, all writing only the `#ig-viewport` group's `transform` attribute per frame via `requestAnimationFrame` — the SVG markup itself is built once per sheet-open and never rebuilt mid-gesture. Hover (delegated `pointerover`/`pointerout`, skipped for touch) and click-select drive neighborhood highlighting through a precomputed adjacency map, toggling classes/attributes on the existing ≤30-node/≤~100-edge DOM rather than re-rendering. Double-click smoothly recenters and zooms-focuses a node (`--ap-ease-fast` snap). Escape clears selection; Enter/Space selects a focused node.
- **Node details panel** — no new overlay component. Reuses the app's only disclosure primitive (`openGlassSheet`/`closeGlassSheet`) by swapping a `#ig-detail` region in-place inside the already-open sheet (label, kind, cluster, origin badge reusing the existing confirmed/inferred-ring convention, affinity %, clickable neighbor chips) rather than closing/reopening the sheet or building a side-rail (confirmed by grep: no side-rail pattern exists anywhere in the codebase despite a stale doc comment claiming a Profile-page entry point — code wins per this repo's own conflict-resolution rule).
- **Cluster filter chips**, reusing the existing `.genre-chip` CSS class rather than inventing new visual language.
- **Node cap raised from 14 to 30, `kind:'entity'` no longer filtered out** — confirmed by product owner, so hover/select highlighting has enough real structure to be worth having.
- **44px touch targets**: an invisible larger hit-target circle (`fill: transparent`, not `fill: none`, so it still receives pointer events) sits under each visible dot, satisfying DESIGN.md §5/§9 without inflating the visible dot size. `.ig-svg { touch-action: none; }` scoped locally so custom pan/pinch doesn't fight the sheet's own scroll or the browser's page-zoom.
- Added `.ig-node` to the existing global press-feedback `SEL` list (line ~5717) for free tap feedback, no new JS.

### Verified live (Docker stack, `docker cp` hot-patch, real student login via the in-app browser)

- Inline-script syntax check passes (`new Function` over both `<script>` blocks); CSS brace count balanced (794/794).
- Grepped the diff: no stray literal hex outside the declared `--ig-*` token block, no `backdrop-filter` or numeric `font-weight` introduced.
- Real edges confirmed programmatically: 11/11 rendered edges connect two actual nodes (none within 5 units of the center "YOU" point), 30 nodes rendered.
- Click-select opens the detail panel with correct content (label, kind, origin, affinity %, neighbor chip) and the neighbor chip is itself clickable (`focusOn`).
- Cluster-filter chip toggle correctly mutes non-matching nodes while exempting genre-kind nodes.
- Hover on a node correctly mutes all but itself + its real neighbor(s) and activates only the connecting edge(s) — verified via dispatched `pointerover`.
- Zoom-in button changes the viewport's `scale()` term as expected.
- Canvas confirmed to stay dark (`rgb(11,13,16)`) with the app's theme forced to light.
- Mobile viewport (375×812): "Your interests" sheet opens, dark bars/entities panels render legibly, zoom controls visible and tappable; `document.documentElement.scrollWidth === window.innerWidth` holds at both 900px desktop and mobile widths (no new horizontal overflow).

### Not yet verified

- **No iOS Simulator pass was done this session** — this repo's workflow calls it mandatory for exactly this class of change (touch-keyboard/button-color invariants that only reproduce on real touch input, DESIGN.md invariants 9–11). The in-app browser's touch/pinch emulation was exercised via synthetic `PointerEvent`s and a resized viewport, not a real device — pinch-zoom and drag-pan should be hand-verified on a real simulator before calling the touch interaction complete.
- **No automated regression test exists for this feature** (frontend has no test runner per this repo's setup — parse-check only) — all verification above was manual/scripted against a live Docker stack in one session.
- The force layout's constants (300 iterations, spring/repulsion coefficients) were tuned by eye against the current demo data's node/edge counts (~30 nodes, ~11 edges observed live); they have not been stress-tested against the documented cap of up to 30 nodes / ~100 surviving edges, so a denser real graph could look more crowded than what was checked here.
- Keyboard navigation (Tab through nodes, Enter/Space to select, Escape to clear) was implemented per the plan but not manually keyboard-tested this session.


## Session — 2026-08-22: YouTube video recommendations in Discover (backend, Phases 0–5 of the plan)

### Why

Product ask, worked through as a brainstorm first: Discover's feed should recommend YouTube videos grounded in a student's interest graph, but specifically biased toward niche/independent creator channels over generic mainstream-newsroom coverage of the same topic (the geopolitics example: a single-person analyst over a mainstream channel's filler coverage) — because YouTube's own search relevance order optimizes for watch-time-at-scale, which structurally favours large channels and would reproduce the exact problem if used naively. Full design reasoning and the phased plan (schema → provider → hunt pipeline → scoring → feed integration → signals → frontend) at `/Users/hitesh/.claude/plans/we-have-to-imporvise-optimized-gizmo.md`. **Phases 0–5 (all backend) are built and unit-tested this session. Phase 6 (frontend) is not started, and nothing has been verified against a real Docker stack or a real `YOUTUBE_API_KEY` — see "Not yet verified" below.**

### What changed

- **Schema (`services/discover/prisma/schema.prisma` + migration `20260822090000_video_recommendations`):** four new models — `VideoHuntRun` (mirrors `HuntRun`, plus `channelsEnriched`), `DiscoverVideo` (mirrors `DiscoverArticle`, plus channel/duration/view-count and cached scoring fields), `TrustedChannel` (the channel-quality table — see below), `VideoSignal` (a parallel table to `NewsSignal`, not a widened FK on it, since `NewsSignal.articleId` is a hard non-nullable cascade FK). `npx prisma validate` and `npx prisma format` both pass against the pinned local binary (not bare `npx prisma`, which fetches v7 and rejects this repo's schema syntax — the usual gotcha).
- **`services/discover/search/youtube.js` (new):** a documented *superset* of the `search/provider.js` interface (adds `videoId`/`channelId`/`channelName`, which the scoring formula needs as first-class fields). Deliberately does **not** set `videoCategoryId:'27'` (Education) the way `services/ai/server.js`'s tutor-chat video search does — a niche analyst channel isn't filed under YouTube's Education category, and that filter alone would defeat the feature. Four functions matching four distinct API costs: `search` (100 units), `loadVideoDetails`/`loadChannelDetails` (1 unit, batched 50), `loadRecentUploadTitles` (1 unit, **not** batchable across channels — the real per-channel enrichment cost). Near-duplicates `services/ai/server.js`'s existing YouTube REST calls; accepted explicitly, same posture as this repo's existing 6x `structured-llm.js` duplication (no cross-service imports exist anywhere in this codebase).
- **`services/discover/hunt/video-queries.js` + `hunt/video-run.js` (new):** structural mirrors of `hunt/queries.js`/`hunt/run.js` — same bounds-in-code (not schema) pattern, same `<<<ALREADY_SEEN>>>` untrusted-delimiter convention for prior video titles, same always-settles claim/execute contract. `selectVideoHuntTopics` is a deliberate ~30-line copy of `selectHuntTopics` against `VideoHuntRun` instead of a parameterized shared function, to leave the article hunt's shared/tested code untouched. One new pipeline stage — **channel enrichment**, quota-bounded per run (`DISCOVER_VIDEO_HUNT_MAX_CHANNEL_ENRICH_PER_RUN`, default 5), skipped for already-fresh or seeded-trusted channels. Candidates are **sorted by score before capping** to the selection limit (`hunt/run.js` caps in encounter order for articles) — capping in encounter order would just re-store YouTube's own relevance order under a different name.
- **`services/discover/video/scoring.js` (new):** the deterministic formula — `score = 55*topicRelevance + nicheBoost + recencyTerm + durationFit`, with a hard `topicRelevance < 0.3` floor (drop, not down-rank). **Subscriber count is deliberately excluded** from the formula entirely — even capped, a size-based bonus would quietly reintroduce the exact mainstream-over-niche bias this feature exists to remove.
- **`services/discover/video/trust.js` (new) — the design decision that mattered most:** `TrustedChannel`'s promotion gate **reuses `interest/promote.js`'s `candidateDecision()`/`mergeEvidence()` directly** (imported, not reimplemented) — both functions only ever touch generic `status`/`evidenceCount`/`evidence` fields, so a channel earns trust through the *same* evidence-from-3-distinct-sessions gate an interest topic uses to earn a graph node. `computeTopicNarrowness()` is the actual niche signal: of a channel's ~20 sampled recent upload titles, what share matches the channel's own single most common topic cluster (via `interest/graph.js`'s `extractTopics`, zero new topic-detection logic, no LLM). Cold-start seeding via `DISCOVER_VIDEO_TRUSTED_CHANNELS` (channel IDs, not display names — a name is spoofable/ambiguous) bypasses the gate entirely, deliberately.
  - **Bug caught by its own test, fixed this session:** `recordChannelEvidence`'s candidate object omitted a `key` field; `candidateDecision` silently short-circuits to `noop('no_candidate')` without one, so channels were accumulating evidence correctly but never actually promoting to `trusted` even past the threshold. `trusted-channel-promotion.test.js` caught this immediately (`three distinct sessions are what it takes to auto-promote` failed with `status: 'pending'` instead of `'trusted'`). Fixed by setting `candidate.key = channelId`.
- **`services/discover/video/interleave.js` (new, revised mid-session):** `interleaveVideos()` — a structural mirror of `cards/interleave.js`'s `interleaveMicroArticles`, not a density heuristic. Per explicit product-owner correction ("the YT video must be inbetween the articles"), this replaced an earlier pre-rank pool-mixing + density-cap design: a video is only ever inserted before an `'article'`-kind entry in the already-ranked, already-paginated page, counting only articles toward the cadence (a micro-article card already threaded in does not count), and **never before the very first article** — so a video is always genuinely sandwiched between two articles, never leading the feed. Pure, no DB, no clock.
- **`services/discover/server.js` wiring:** the article pool is ranked exactly as before this feature (`rankArticles`, unchanged — videos are **not** mixed into it). The video queue is ranked **separately**, via the same `rankArticles` call against the same student vector (it falls back to pure recency with no profile, so no separate un-personalised branch was needed), then interleaved into the already-built `article`/`micro_article` page via `interleaveVideos`. Feed response items gained a third `kind:'video'` branch. Pagination (`offset`/`nextOffset`/`total`) is computed from the article-only `ordered` list, unchanged — a video is a bonus insertion downstream of ranking, exactly like a micro-article card, not a page-consuming item. `POST /api/discover/signal` now accepts `videoId` as an alternative to `articleId`; a qualifying `dwell` (≥60s) or `share` signal calls `recordChannelEvidence` from the same write path. A new independent `videoHuntTick()` timer (own `setInterval`, never merged into the article hunt's `huntTick()` — a slow/quota-exhausted video hunt must not starve the article hunt or vice versa), with an in-process daily `search.list` quota counter (`DISCOVER_VIDEO_HUNT_DAILY_SEARCH_BUDGET`, default 3000 units) as a backstop beyond the per-tick topic cap.
- **`services/discover/interest/store.js`:** `rebuildProfile`'s `signalCount` now sums both `newsSignal` and `videoSignal` counts — the one small, explicit change to an otherwise-unmodified, shared/tested module.
- **`services/analytics/lib/validation.js`/`dashboard.js`:** added `discover_video_opened`/`discover_video_dwell` to `KNOWN_EVENT_TYPES` (both physically single-quoted in `discover/server.js`, satisfying `tests/event-types.test.js`'s literal scan) and `discover_video_dwell` to `LEARNING_EVENT_TYPES` for the time-spent rollup. **`analytics` needs a rebuild before this lands on a running stack** — a stale container 400s the new types silently (standard gotcha, see CLAUDE.md).
- **`docker-compose.yml`, `docker-compose.production.yml`, `.env.example`:** new env vars for the discover service — `YOUTUBE_API_KEY` (shared with `services/ai`'s existing tutor-chat video search; **the two services' quota usage is not currently coordinated, worth watching if both see real traffic**), `DISCOVER_VIDEO_HUNT_*` (enabled/interval/topics-per-run/cooldown/channel-enrich-cap/daily-budget), `DISCOVER_VIDEO_TRUSTED_CHANNELS`, `OPENROUTER_VIDEO_HUNT_MODEL`. All CRLF files edited line-wise; `\r\n` presence verified on every new line, not assumed.

### Tests

Five new files, 46 new tests, **all passing**: `test/video-scoring.test.js`, `test/video-interleave.test.js` (rewritten mid-session for `interleaveVideos`), `test/video-queries.test.js`, `test/video-untrusted-content.test.js`, `test/trusted-channel-promotion.test.js`. Full `services/discover` suite: **187/187 passing** (no regressions in the 141 pre-existing tests). `services/analytics`: **38/38 passing**, confirming both new event types are allowlisted *and* have producers. `node -e "require('./server.js')"` confirms the whole module graph loads with no syntax/require errors.

One real bug was caught by its own test before being fixed (see `video/trust.js` above): the `candidateDecision` missing-`key` bug.

### Not yet verified

- **No live YouTube Data API call has ever been made.** Everything above is verified via unit tests with fake/stubbed data. The plan's own Phase 1 acceptance test — hand-verifying `topicNarrowness` against one real niche channel and one real mainstream channel — has not been run. Do this before trusting the niche-scoring formula in production.
- **No Docker rebuild, no `prisma db push`/`migrate deploy` against a real database.** The migration SQL was hand-written to match the schema (not generated by `prisma migrate dev` against a live DB, since none was available in this session) — validate it applies cleanly on the next session that has Docker available.
- **Frontend (Phase 6) is entirely unstarted.** No video card renderer, no ribbon wiring. The one frontend decision already made and confirmed with the product owner: **thumbnail + external link, never an inline iframe embed** — embedding would import YouTube's own autoplay/recommended-next-video rail into Discover, defeating the point of curating what a student sees next.
- **The video hunt has never actually run**, seeded or otherwise — `videoHuntTick()`, `claimVideoHuntRun`, and the channel-enrichment budget logic are exercised only by hand-tracing and the unit tests above, not by a real timer firing against a real queue.
- Whether `services/ai`'s tutor-chat video search and this new hunt meaningfully compete for the same `YOUTUBE_API_KEY`'s daily quota under real traffic is unknown — worth a dashboard/log check once both are live.


## Session — 2026-08-22 (latest): KG correctness bug sweep across all three pipelines + first pass of production-scalability concurrency fixes

### Why

Two linked pieces of work, both plan-mode-approved by the product owner. First: a deep correctness reinspection (beyond the earlier error-handling pass) of all three knowledge-graph pipelines — Interest Graph, Concept Map Visuals, Educational KG — using independent Explore agents that verified each claim by tracing code and, for several, actually executing the logic against adversarial inputs (stress tests, hand-built repro cases), not just reading it. That surfaced real, confirmed bugs (not hypothetical) which the product owner asked to fix in full ("fix everything confirmed"). Second: a system-design pass on production traffic handling for the actual school-hours load shape (near-zero 9am–3pm, full load 3pm–9pm, ~5–10% overnight), which concluded the three KG systems must **not** be merged (settled, documented in the plan file) and produced a prioritized concurrency/caching fix list — this session implemented the Tier 1 (cheap, highest peak-impact) and part of Tier 2 items from that list. Full plan with all findings, repro cases, and the unimplemented remainder at `/Users/hitesh/.claude/plans/the-discover-feed-has-fuzzy-mist.md`.

### What changed — Educational KG (`services/rag`)

- **`eke_pipeline.py`: paragraph-fragmentation cascade fixed.** `normalize_block_text` was deleting blank lines before `split_block_segments` could ever see them, so its blank-line split could never fire and every multi-line PDF block — a real paragraph or a mid-sentence line-wrap alike — was shredded one fragment per physical line. Rewrote both: blank lines are now preserved as paragraph markers, and a block with no blank line (a wrapped single sentence) is rejoined with spaces into one segment instead of fragmenting. This was the root cause behind three other confirmed bugs and fixing it resolves all of them at once:
  - False heading detection: short line-wrap fragments with no terminal punctuation no longer exist as standalone blocks, so `detect_heading()`'s "≤7 words, no colon, no copula" heuristic stops misfiring on them.
  - `classify_educational_object()` reordered: `DEFINITION_RE`/`looks_like_definition` now checked right after `SAFETY_RE` instead of 14th of 15 branches, so a definition that happens to also mention "law", "table", "for example", or "used in daily life" no longer gets shadowed into the wrong category. `FIGURE_RE` tightened to exclude the verb phrase "figure out"; `FORMULA_RE`'s `letter = value` alternative now requires the pattern to span the whole segment, not just appear inside a longer sentence, so a casual "for example x = y" aside no longer classifies as a standalone formula.
  - Heading hierarchy: `persist_entities()` now tracks a section stack keyed by `heading_level` (already computed, previously never read) so H2/H3 headings parent to the nearest shallower section instead of every heading flattening to a direct child of the chapter.
- **Duplicate inverse relationship edges removed**: `create_parent_relationships()` was creating `BELONGS_TO` and `HAS_PARENT` as two identical edges (same source/target); now just `HAS_CHILD` + `BELONGS_TO`.
- **CanonicalConcept dedup**: new `dedup_key_for_title()` (NFKC-normalizes, unifies curly/straight apostrophes, strips punctuation) used as the matching key instead of a bare `casefold()`, so `"Newton's Laws"` / `"Newtons Laws"` / curly-quote variants (common from PyMuPDF extraction) now merge into one canonical concept instead of fragmenting.
- **`chunking.py`: passage-chunk truncation no longer cuts mid-word.** New `truncate_at_boundary()` finds a sentence or word boundary within the last half of the character budget instead of hard-slicing at an arbitrary offset.
- **Multi-column reading order**: new `order_blocks_reading_order()` reads a genuinely two-column page's full left column top-to-bottom before the right column (with full-width blocks like headings interleaved at their correct vertical position), instead of a plain y-then-x sort that interleaved columns by raw vertical proximity. Single-column pages (the majority) fall back to the original sort untouched.
- **`main.py`: PDF upload validation fixed from OR to AND** (known-risk #13) — a spoofed `Content-Type: application/pdf` header on a non-PDF file (or vice versa) no longer bypasses validation.
- All fixes verified with standalone pure-logic tests reproducing the exact repro cases from the correctness investigation (fragmentation, classification reorder, dedup keys, column ordering, truncation) — see the plan file for the test transcripts. No RAG test suite could be run end-to-end (`pytest` deps not installed and no network in this sandbox to install them); syntax-checked with `py_compile` only.

### What changed — Concept Map Visuals (`services/ai/visuals`)

- **`grounding.js`: `conceptSlug` collision fixed.** `tokenize()`'s `length > 2` filter was dropping short-but-meaningful science terms (element symbols, units — "Na", "K", "pH"), so two different topics ("role of Na in nerve conduction" vs "role of K in nerve conduction") hashed to the identical cache key and one student's cached diagram was silently served for the other topic. New `tokenizeForCacheKey()` (used only for `conceptSlugFor`, not for ranking) keeps short tokens.
- **`spec-validate.js` and `explainer-validate.js`: citation-validation bypass fixed.** Both had `if (known.size && !known.has(citation))`, so an empty `knownChunkIds` (no grounding chunks supplied) silently accepted *every* citation instead of rejecting all of them — directly contradicting the module's own "hallucinated citations are rejected" invariant. Dropped the `known.size &&` short-circuit in both. Found and fixed the identical bug in `services/practice/validate.js` (a third copy of the same pattern) while in this area.
- **`graph-layout.js`: three fixes.**
  - Edge routing no longer cuts through an unrelated node: a cycle-reversed edge that spans more than one layer in the same x-column (the common shape after `removeCycles` reverses an edge) now jogs sideways around intermediate-layer nodes instead of drawing a straight line through their box; the canvas widens to fit the jog rather than clamping it back inside the node's own footprint (the first version of this fix was wrong for exactly that reason — verified by reproducing the original `Glucose→Photosynthesis→Energy→Glucose` repro before and after).
  - Edge labels now try a few alternate positions within their channel when the default midpoint placement would overlap a node's box, instead of always rendering at the midpoint regardless of what's underneath.
  - `orderLayers()`'s `orderingSweeps` config was silently dead — `layoutGraph` built a `config` object but never passed it through, so a caller override had no effect. Now threaded through correctly.
- Regenerated/extended the `structured-llm.js` test suite (below) also covers the visuals path since it's the primary consumer. `services/ai` full suite: **218/218 passing** (up from 212 — 6 new regression tests for the citation-bypass and provider fixes).

### What changed — Interest Graph (`services/discover`, `services/ai` legacy copy)

- **Topic regex right-boundary fixed (known-risk #8)**, both copies (`services/ai/interest-graph.js`, `services/discover/interest/vocab.js`): `(^|[^a-z])term` had no right boundary, so "ai" matched inside "aircraft". Added `(?![a-z])`. New regression test in `vocab.test.js` using a synthetic term (the real seed "ai" term already worked around this by padding with spaces, which would have masked the bug in a test).
- **`store.js`: weight lost-update under concurrency fixed.** `applySignal` read a node's weight, computed the aged+delta value in JS, then wrote it back — under the default READ COMMITTED isolation two concurrent signals for the same `(studentId, kind, key)` could silently drop one contribution. Switched the transaction to `Serializable` isolation with retry-on-conflict (`runSerializable`, retries Prisma's `P2034` write-conflict error up to 3 times) rather than introducing raw SQL, since no raw-SQL pattern exists anywhere else in this codebase.
- **`promote.js`: `mergeEvidence` sessionless dedup fixed.** `evidenceCount` incremented unconditionally whenever `sessionId` was falsy (`isNewSession || !sessionId` always took the `!sessionId` branch), so a client that omits `sessionId` — or double-fires `/session/end` — inflated the count on every call instead of counting once. Now dedupes a sessionless observation the same way a sessioned one is deduped (against whether one has already landed).
- **`server.js` — `POST /api/discover/signal`: idempotency + genuinely async, both fixed together.** Added a short (5s) window dedup check (`isDuplicateSignal`, matching `studentId`+`articleId`+`kind`+`sessionId`+`dwellMs`) against a retried POST re-applying the same signal twice — no schema migration needed, uses the existing `[studentId, articleId]` index. Backgrounded the DB-write/`applySignal`/`rebuildProfile` chain via the file's existing `track()` fire-and-forget helper instead of fully awaiting it before responding — confirmed the one consumer (`frontend/index.html`'s `sendNewsSignal`) never reads the response body, only whether the request failed, so nothing depends on synchronous completion. This was the highest-frequency route in the service (fires on every scroll/impression).
- **`server.js` / `bootstrap.js` — Discover feed cold-start backgrounded.** `ensureStudentBootstrapped` (up to 8s + up to ~400 sequential DB round-trips for a first-time-Discover student) was awaited inline on every `GET /api/discover/feed`, coupling a batch of first-time students at peak load directly onto `services/ai`'s load at the exact moment it's busiest with chat traffic. Now backgrounded via `track()`; the feed renders with whatever ranking is available now (same "honest degradation" pattern already used for the micro-article pre-warm case) and the next request picks up the import once it lands. While in this code, batched `importLegacyNodes`'s sequential `seedNode` calls into concurrent chunks of 20 (different `(kind, key)` pairs never conflict, unlike `applySignal`'s same-key race above).
- `services/discover` full suite: **139/139 passing** (up from 137 — 2 new regression tests for the boundary and sessionless-dedup fixes).

### What changed — cross-cutting (`structured-llm.js`, all 3 copies; concurrency Tier 1/2)

- **Provider selection now honors `LLM_PROVIDER` (known-risk #7), all 3 copies** (`services/ai`, `services/practice`, `services/discover`): `resolveStructuredProvider` picked OpenRouter whenever its key was merely non-empty, ignoring `LLM_PROVIDER` entirely — the exact observed-live failure (`.env` set `LLM_PROVIDER=groq` with a valid Groq key, but every visuals call died on a stale OpenRouter key's 402). Now checks `LLM_PROVIDER`/`config.llmProvider` first and only falls back to key-presence selection when the preferred provider's key is missing.
- **HTTP/network errors now retry (known-risk #10), all 3 copies**: `requestCompletion`'s own errors sat outside the try/catch driving the retry loop, so a 429/5xx/timeout propagated straight out on attempt 1, skipping the self-correcting retry that exists for exactly this. New `ProviderRequestError` carries a `retryable` flag — 429/408/409/425/500/502/503/504 and network/timeout failures retry (up to `maxAttempts`, without fabricating a misleading "your previous response was rejected" correction message since there was no response to correct); a terminal status like 401/402 fails immediately rather than burning every attempt on a result that cannot change.
- Added 6 new tests in `services/ai/test/structured-llm.test.js` covering both fixes directly (LLM_PROVIDER honored even with both keys set, falls back when the preferred provider has no key, a 429 retries and succeeds, a 402 fails fast without retrying, a network failure retries the same as a retryable status).
- **`services/discover/server.js` — `POST /api/discover/signal` async fix**: see Interest Graph section above (same PR, listed there since it's Interest Graph's own hot path).
- **Tier 2 concurrency**: added `uncaughtException`/`unhandledRejection` handlers (log + `process.exit(1)`, letting Docker's `restart: unless-stopped` recover) to all 6 Node services (`ai`, `auth`, `analytics`, `discover`, `practice`, `quiz`) — previously a stray throw outside the request path had no backstop and would silently crash the whole process, taking every concurrently in-flight request with it. Capped the two previously-uncapped analytics endpoints (`teacher/interventions`, `queries/trends`) at `take: 500`, matching the other three dashboard endpoints. Added `@@index([schoolId, role])` to `auth_db.User` (new migration `20260822090000_user_school_role_index`) matching `GET /api/auth/users`'s actual query shape. Set explicit connection-pool sizing on all 8 services sharing the one Postgres instance (`connection_limit=10&pool_timeout=10` on all 6 Node/Prisma `DATABASE_URL`s in both compose files; `pool_size=5, max_overflow=5` via new `db_pool_size`/`db_max_overflow` settings on the 2 Python/SQLAlchemy services, `rag` and `lms`) — previously every service ran on an undocumented, uncoordinated default heuristic, which is unsafe headroom-wise the moment any service scales beyond 1 replica.

### Verified

- `npm test` across all 6 Node services: **ai 218/218, discover 139/139, practice 37/37, quiz 36/36, analytics 38/38, auth 6/6** — 474 total, all green, run after every batch of edits in this session (not just once at the end).
- `python3 -m py_compile` on every touched RAG/LMS file — all clean. RAG's own pytest suite could **not** be run (`pip install -r services/rag/requirements.txt` failed — no network in this sandbox); the algorithmic fixes (fragmentation, reading-order, dedup key, classification reorder) were instead verified with standalone pure-Python scripts reproducing the exact repro cases from the correctness investigation, output included in the plan file.
- `docker compose -f docker-compose.yml config` and the combined dev+production config both parse cleanly after the `DATABASE_URL` edits (production's missing-env-var errors are expected in this sandbox — no `.env.production` secrets set here — and are unrelated to the edits: they're the same required-var checks that would fire before any edit in this session).
- CRLF line endings on `docker-compose.yml`/`docker-compose.production.yml` spot-checked before and after (`tr -cd '\r' | wc -c`, unchanged counts) — the known gotcha for those two files.
- Manually traced the concept-map edge-routing fix against the exact 3-cycle repro (`Glucose→Photosynthesis→Energy→Glucose`) from the correctness report, both before (path passes through the intermediate node's box) and after (canvas widens, path jogs around it).

### Not verified / not done

- **No live-stack verification.** Nothing in this session was curl-tested against a running `docker compose` stack or exercised through the actual frontend — Docker was not used in this environment. In particular the RAG pipeline fixes (the highest-stakes change this session — they touch entity extraction, hierarchy, and chunking together) have only been verified at the pure-function level, never against a real PDF through the real `eke_pipeline.py`/`chunking.py` flow end to end.
- **The rest of the Phase 2 concurrency/scalability plan is not implemented**, and most of what remains needs either a design decision from the product owner or actual cloud/infra access this session doesn't have:
  - Redis introduction (cache + distributed rate-limit store + scheduler lock — explicitly scoped to never become a job queue, per the plan) — no code written yet.
  - Chapter-context caching and chat-fan-out-context caching (the two highest-leverage Redis wins identified) — depend on Redis existing first.
  - CDN for static assets (content-hashing the `frontend/assets/learning/*.jpg` files, picking a CDN vendor) — needs a vendor decision and DNS/account access outside this session's capability.
  - The core scaling decision itself (VM resize + cron-scheduled `docker compose --scale` for `ai`/`discover`/`quiz`/`practice`) — needs actual cloud console access to the Oracle VM.
  - Traefik rate-limiter IP-bucketing fix (campus-NAT stampede risk) — needs the CDN decision resolved first, or a decision to key authenticated routes off JWT `studentId` instead of raw IP at the application layer.
  - Real token-level LLM streaming (currently cosmetic — full completion generated, then chopped into pieces over SSE) and native `bcrypt` — both explicitly named Tier 3 in the plan, correctly sequenced after everything above, not started.
  - The two unfixed in-process schedulers (discover's `rssTimer`, ai's `newsRefreshTimer`) still only dedupe within one process — this is a **hard prerequisite** before either service is ever scaled beyond 1 replica, not yet done.
- The RAG fixes did not add any new automated test coverage to the actual `services/rag/tests/` suite (no pytest available to write against) — the standalone verification scripts live only in this session's scratchpad, not committed anywhere.

### Next session should

1. **Get a live stack up and actually exercise the RAG pipeline fixes against a real PDF** — this is the highest-risk unverified change (three interacting fixes: fragmentation, hierarchy, classification). Ingest a real chapter, inspect the resulting entity tree and chunk boundaries directly.
2. Decide on Redis introduction and CDN vendor, then implement the caching layer — full design (cache keys, TTLs, invalidation) is in the plan file's §2.3, ready to implement once those decisions are made.
3. Fix the two unfixed schedulers (discover's `rssTimer`, ai's `newsRefreshTimer`) before enabling any replica scaling — plan file §2.2 names this as a hard prerequisite.
4. Once Redis exists, revisit the Traefik rate-limiter bucketing fix — the plan's preferred approach (trust a CDN-injected client identifier) depends on the CDN decision in (2).
5. Re-read `/Users/hitesh/.claude/plans/the-discover-feed-has-fuzzy-mist.md` in full before continuing — it has the complete bug inventory (including lower-priority items not touched this session: CanonicalConcept per-document scoping, passage-chunk entity linkage, the cache race condition on `VisualArtifact`), the full Phase 2 design, and the "what NOT to do" list (don't adopt the dormant `kubernetes/` manifests, don't let Redis become a job queue, don't fix the rate-limiter by just raising the numbers).

---

## Session — 2026-08-21 (IN PROGRESS): Discover feed overhaul — Phases B and C done (dwell analytics + reading stats, academic micro-articles interleaved into the feed), Phase D not started

### Why

Continuation of the same product-owner ask as the Phase A entry directly below. Phases B and C were built **concurrently by two parallel agents** in the same working tree (explicit user request — "Execute Phase B and Phase C parallely. Run Agents"), since the plan's global sequencing treats them as independent. Full plan still at `/Users/hitesh/.claude/plans/we-have-to-imporvise-optimized-gizmo.md` — read it before starting Phase D (Stories band), the only remaining phase.

Because both agents needed to touch `services/discover/server.js` and `frontend/index.html` at the same time, each was briefed with an explicit file/function ownership split (Phase B: the signal route + a new stats route; Phase C: the feed/cards routes) and told to leave new hooks undefined rather than editing the other's territory. Both landed cleanly with **zero real edit conflicts** — confirmed by running the full `services/discover` suite (137/137) after both merged. Two things did need a orchestrating-session reconciliation pass after both finished, documented below.

### What changed — Phase B (Workstream 2: dwell-timing fix, headline-dwell tracking, analytics events, reading-stats view)

- **Dwell-timing bug fixed**: the two `discoverDwell` timing sites in `frontend/index.html` (`closeGlassSheet()` and the card-open click handler) now use `performance.now()` instead of `Date.now()` — monotonic, matches this file's house style everywhere else elapsed time is measured.
- **Headline-only dwell tracking** (new, `frontend/index.html`): a second, non-one-shot `IntersectionObserver` (`headlineDwellObserver`) tracks how long a news card sits in view before opening or scrolling past, backed by a plain `Map<articleId, entryTimestamp>` (`headlineDwellEntries`) and a `flushHeadlineDwell(articleId)` helper, sending `sendNewsSignal(id, 'headline_dwell', ms)` when `ms >= 400`. Flushed on `visibilitychange` (tab backgrounding) and on card-open (pre-click dwell) — the card-open flush call was the one piece the orchestrating session had to wire in after both agents finished, since it sits inside the exact click handler Phase C was concurrently rewriting for an unrelated reason (see "Reconciliation" below).
- **Backend**: `SIGNAL_WEIGHTS.headline_dwell: 0` in `services/discover/interest/graph.js` (recorded, never ranked — `signalWeight()` already falls through to 0 for it, no other code change needed). `POST /api/discover/signal` skips the profile rebuild for `headline_dwell` (same as `impression`) and fires two new analytics events, `discover_article_dwell` and `discover_headline_dwell`, both carrying `metadata.durationSeconds` (rounds `dwellMs/1000`).
- **Analytics wiring**: both new types added to `KNOWN_EVENT_TYPES` (`services/analytics/lib/validation.js`) and `LEARNING_EVENT_TYPES` (`services/analytics/lib/dashboard.js`) — the latter means `durationSeconds` rolls into `timeSpentSecondsThisWeek` automatically via the existing generic `eventActiveSeconds()` reader, no new logic needed. `buildLessonEngagement()` gained a 5th bucket (`{key:'discover', label:'Discover reading', count: counts.discover_article_opened}`) — confirmed safe against the "exactly 4 summary cards" CLAUDE.md gotcha, which refers to a *different* component (`.dashboard-grid > .summary-card`'s `nth-of-type` hue mapping); `lessonEngagement` itself renders as a plain unbounded `.status-row` list.
- **Reading-stats view** (new): `GET /api/discover/stats?days=30` + pure `services/discover/stats.js#buildReadingStats(signals, {now, days})` (articles opened, total reading/headline seconds, avg seconds/article, reading streak, top 3 categories — own copy of the streak-walk pattern, not imported from `services/analytics`, since no cross-service imports exist anywhere in this repo). Frontend: new `#discover-stats-btn` next to `#discover-graph-btn`, opens via `openGlassSheet` mirroring `openInterestGraphSheet`'s skeleton→fetch→replace shape, new `.reading-stats` CSS reusing `.ig-row` tokens.
- New `services/discover/test/stats.test.js` (17 tests). `services/discover/test/graph.test.js` updated: pinned `SIGNAL_WEIGHTS` snapshot now includes `headline_dwell: 0`, excluded from the `services/ai`-predecessor port-equivalence comparison (discover-only signal, no legacy equivalent). `services/analytics/tests/dashboard.test.js` gained 3 tests for the new rollups.

### What changed — Phase C (Workstream 4: academic micro-articles interleaved into the feed)

- **Schema**: `AcademicCard` gains `kind` (`AcademicCardKind` enum: `mcq_card` default / `micro_article`), `viewedAt`, `deliveredAt`. The cache-lookup index now includes `kind` (an MCQ card and a micro-article for the same chapter+weak-area no longer collide in the dedupe lookup). Migration: `services/discover/prisma/migrations/20260821100000_academic_card_kind/migration.sql`. **Not yet applied to any database** — same open item as Phase A's tone-rewrite migration; both need `docker compose up --build -d` (dev) or `migrate deploy` (production) before this code path can run for real.
- **Generation**: `cards/schema.js`/`cards/validate.js` gained a micro-article shape (headline 10-100 chars, **body bounded by word count** 90-170 words — not character count, deliberately different from every other bound in this file — `ctaType` restricted to `'tutor'|'practice'`, citations 1-4 real chunk ids). `cards/generate.js#generateMicroArticle` reuses the existing `'cards'` structured-llm task (same cost/latency profile as the MCQ shape), same grounding/citation discipline.
- **Feed interleaving**: new pure `services/discover/cards/interleave.js#interleaveMicroArticles(newsPage, queue, {everyN, startIndex})` — a post-ranking insertion pass, called in `GET /api/discover/feed` strictly after `page = ordered.slice(...)`, never touching `rankArticles`/`balanceNewsCategories`. Cards land every 4th article by **absolute** feed position (`startIndex`-aware), so insertion position stays consistent across pagination rather than restarting the counter per page. Generation is pre-warmed, not on-demand: the feed route only ever reads already-`done` cards and fires a background `maybeQueueMicroArticle(...)` (via the existing `track()` fire-and-forget pattern) when fewer than 2 undelivered cards remain — an early feed load may show zero micro-articles while the first one warms, an accepted honest degradation.
- **Response shape** (deliberate breaking change): `GET /api/discover/feed` now returns `items: [{kind:'article', article} | {kind:'micro_article', card}]` instead of `articles: [...]`. `offset`/`nextOffset`/`total` stay computed from the news-only ranked list — a card is a bonus insertion, never a page-consuming item.
- **New route** `POST /api/discover/cards/:cardId/viewed` — idempotent read-ack for a micro-article, distinct from the existing MCQ-only `.../attempt` route (no scoring/grading semantics).
- **Frontend**: `state.discover.feedItems` (the full mixed render list) added alongside the existing `state.discover.articles` (kept as a flat article-only array, so the pre-existing card-open/menu/share/skip click handlers needed **no changes at all** — a deliberate design choice to minimize the blast radius of the response-shape cutover). New `feedMicroArticleMarkup(card)` / `.feed-card--micro-article` CSS, its own `[data-micro-card-id]` open control (never `data-article-id`, so the existing impression/headline-dwell observer wiring never has to know micro-articles exist) and its own click listener routing the card's CTA into Tutor/Practice via the existing pane-link mechanism.
- New `services/discover/test/cards-interleave.test.js` (7 tests) and `services/discover/test/cards-validate.test.js` (18 tests — also the **first** direct unit coverage of the pre-existing MCQ `validateAcademicCardSpec`, which had none before this session).

### Reconciliation (done by the orchestrating session after both agents finished)

Both agents were deliberately briefed to avoid touching a small number of shared spots and leave them for a follow-up pass instead of risking a live-edit collision:

1. **`item.type`/`entry.type` renamed to `item.kind`/`entry.kind`** everywhere the feed-item discriminator is used (`cards/interleave.js`, `server.js`, `frontend/index.html`, `cards-interleave.test.js`). Reason: `services/analytics/tests/event-types.test.js` naively scans `services/discover/server.js` (one of its 5 hardcoded emitter sources) for any `type: '...'` literal containing an underscore and treats it as an analytics event type — Phase C's `{ type: 'micro_article', ... }` literal tripped this, failing the suite with "these types are emitted but would be 400'd and silently dropped: micro_article" even though it's not an analytics event at all. Renaming the discriminator to `kind` (which also now matches `AcademicCard.kind`'s own naming) fixed it at the source rather than special-casing the test — `services/analytics` is back to 38/38.
2. **Wired `flushHeadlineDwell(article.id)` into the card-open click handler**, immediately after `discoverDwell = { id: article.id, at: performance.now() }` — Phase B defined the function but deliberately didn't call it from inside that handler (Phase C was concurrently rewriting the surrounding function for the response-shape change). The `headlineDwellObserver.observe(el)` wiring into `renderDiscoverFeed` itself was **not** left outstanding — Phase C's agent added the defensive `typeof headlineDwellObserver !== 'undefined'` guard itself once the observer already existed by the time it got there.
3. Re-validated the Prisma schema with the **locally pinned** `./node_modules/.bin/prisma` (5.x) rather than a bare `npx prisma`, which fetches latest (7.x) and false-flags the schema's `url = env(...)` datasource line as invalid — same documented gotcha as the `npm ci`/lockfile one in CLAUDE.md, just triggered by the CLI resolution path instead.

### Verified

- `npm test --prefix services/discover` — **137/137 passing** (up from 95 after Phase A; both agents' new suites plus the pre-existing ones, run together after the reconciliation pass above).
- `npm test --prefix services/analytics` — **38/38 passing** (after the `kind` rename fix; was 37/38 immediately after Phase C landed, for the reason in Reconciliation item 1).
- Frontend parse-check (`node -e ... new Function(...)` per CLAUDE.md) — both script blocks `ok`, both before and after the reconciliation edits.
- `frontend/index.html` CRLF integrity spot-checked (`tr -cd '\r' | wc -c`) before and after every edit pass — stayed CRLF throughout, no line-ending corruption from either agent's or the orchestrating session's edits.
- `DATABASE_URL=... ./node_modules/.bin/prisma validate` (services/discover, pinned 5.x binary) — schema is syntactically valid.

### Not verified / not done

- **Neither new migration has been applied to any database** — this session's (`20260821100000_academic_card_kind`) or Phase A's (`20260821090000_tone_rewrite`). Both are needed before any of this code path can run against real data.
- **No live-stack verification at all** — Docker was not reachable in this environment for either agent or the orchestrating session (`docker ps` failed to connect). Nothing here has been curl-tested against running routes, and the frontend has never been rendered in an actual browser — no visual check of the reading-stats sheet, the micro-article card variant, or the headline-dwell instrumentation actually firing. This is the biggest open risk carried into the next session, larger than usual because two full frontend features (Phase B's stats view, Phase C's card variant) are unverified beyond static parse-checking.
- **Phase D (Stories band) is entirely unstarted** — no `Story`/`StoryView` schema, no `services/ai` internal visuals routes, no frontend rail/viewer. Full design in the plan file.
- Docs beyond this HANDOFF entry not yet refreshed for Phases B/C.

### Next session should

1. **Get a live stack up and actually look at this.** Apply both outstanding migrations, run a real feed load, and visually verify (375×812 and desktop, both themes) the reading-stats sheet, the micro-article card, and that headline-dwell signals actually fire — none of that has been seen rendered yet.
2. Then decide: continue to Phase D (Stories band, the last phase), or treat B/C as a checkpoint to pause on given how much of this session's verification was static-only.
3. Re-read the plan file before starting Phase D — it has exact schema/route/file-level detail not repeated here.

---

## Session — 2026-08-21: Discover feed overhaul — Phase A done (Gen-Z tone rewrite + interest-KG near-duplicate fix), Phases B–D not started

### Why

Product-owner ask: make the Discover feed meaningfully more engaging — Gen-Z-relevant news, reading/headline-dwell analytics, a smarter interest KG, tiny LLM-written curriculum "articles" woven into the feed, a Stories band (diagram slides included), overall Google Feed look/feel. Full plan (5 workstreams, 4 phases, sequenced for independent verification) is at `/Users/hitesh/.claude/plans/we-have-to-imporvise-optimized-gizmo.md` on this machine — read it before continuing this work, it has the file-level design for every remaining workstream. This entry covers only **Phase A**, the first of four; Phases B (analytics + reading-stats view), C (academic micro-articles interleaved into the feed), and D (Stories band) are designed but **not started**.

### What changed (Phase A only — Workstream 1: Gen-Z tone rewrite, Workstream 3: interest-KG scoped improvements)

- **New `services/discover/hunt/tone.js`** — batched LLM tone-rewrite pass for **hunted articles only** (never RSS/BBC — `refreshRssArticles()` has no call site for it, and that omission is the enforcement). One `generateStructured({task:'tone', ...})` call per hunt for the whole candidate batch, bounds enforced in code (title 10-140 chars, summary 20-420 chars). Each rewrite independently re-passes both `validateGeneratedTextSafety` and `isStudentSafeNews` on the *new* text before being accepted — one unsafe item falls back to its own original text without sinking the batch. A whole-batch LLM failure (no provider configured, timeout, retries exhausted) degrades every item to its original text, `toneRewritten:false` — never blocks storage. Wired into `services/discover/hunt/run.js#executeHuntRun`, between the existing dedup/safety-filtered `kept` array and `storeArticles()`.
  - Caching: `lookupExistingToneCache`/`applyToneRewrite` skip the LLM call entirely for a re-hunted URL whose freshly-fetched raw title/summary match what's already stored — only genuinely new/changed text pays for a rewrite.
  - Batch-assembly and the safety fallback are factored into pure, directly-testable functions (`isRewriteSafe`, `applyRewrites`) separate from the `generateStructured` call itself, following the same pattern `hunt/queries.js` already uses to keep its own test suite off the live network path.
- **Schema**: `DiscoverArticle` gains `rawTitle`, `rawSummary`, `toneRewritten` (default false), `toneModel`, `toneProvider` — all nullable. RSS rows keep `rawTitle`/`rawSummary` permanently null; that null **is** the durable record that RSS was never touched, not a missing backfill. Migration: `services/discover/prisma/migrations/20260821090000_tone_rewrite/migration.sql`. **Not yet applied to any running database** — next session (or whoever picks this up) needs `docker compose up --build -d` (dev, `prisma db push`) or `migrate deploy` (production) before this code path can run against a real DB.
- **Interest KG — near-duplicate topic fix** (`services/discover/interest/vocab.js`): new `resolveTopicKey(label, vocab)` — tries `canonicalKey()` first (byte-identical for the common case); only on the "about to mint a brand-new key" path, additionally tests the label against the vocab's existing compiled matchers, merging onto the one existing topic whose terms already match (e.g. a proposed "Quadcopter racing" now resolves onto the existing `drones` topic instead of minting `quadcopter-racing`). Ambiguous (2+ matches) or zero matches still mint a fresh key, unchanged from before.
  - `services/discover/interest/propose.js` threads `vocab` through (`proposeInterests`/`makeValidateProposals` previously had no vocab parameter at all) and uses `resolveTopicKey` for the stored candidate key. When a proposal merges onto an existing topic, `registerTopic` is correctly *not* called with a mismatched fresh-canonicalKey topic record (would have orphaned a new row under the wrong key) — see the `topic.key === p.key` guard in `propose.js`.
  - `services/discover/interest/registry.js`: `registerTopic` now logs (never gates) when a genuinely new topic's key is a close edit-distance match to an existing one — purely an observational nudge for a human to hand-add an `ALIASES` entry, deliberately not automatic (MASTERCONTEXT §7 keeps taxonomy decisions out of model/heuristic hands).
  - `services/discover/interest/graph.js`: new exported pure `explorationRateFor(vectorSize)` (thin profiles <5 signals get a wider 0.35 exploration lane, tapering to today's 0.18 default at 12+ signals) — **deliberately not wired into `rankArticles`'s own default**, to avoid disturbing the port-equivalence test that pins ranking output byte-identical to the `services/ai` predecessor. Instead `services/discover/server.js`'s `GET /api/discover/feed` computes it explicitly and passes it as `options.explore`.
  - Concluded a full embeddings/vector-DB rewrite of the KG is **not warranted** this cycle — live embeddings would put an LLM in the ranking path (forbidden by MASTERCONTEXT §7); the real gap was near-duplicate topic minting, not the similarity math.

### Verified

- `npm test --prefix services/discover` — **95/95 passing** (was 67 before this session; +13 in new `test/tone.test.js`, +8 in extended `test/vocab.test.js`, +2 in extended `test/graph.test.js`, +4 in new `test/propose.test.js` — `interest/propose.js` had **zero** direct unit coverage before this session, now does — +2 in extended `test/untrusted-content.test.js` for the tone-rewrite prompt's injection framing).
- The predecessor-parity test (`rankArticles` output byte-identical to `services/ai/interest-graph.js` for the same inputs) still passes unchanged — confirms `explorationRateFor` not touching `rankArticles`'s default was the right call.
- `node --check services/discover/server.js` and a plain `require()` smoke test of every touched module (`hunt/run.js`, `hunt/tone.js`, `interest/vocab.js`, `interest/propose.js`, `interest/registry.js`, `interest/graph.js`) — all load cleanly.
- `DATABASE_URL=... npx prisma validate` — schema is syntactically valid.

### Not verified / not done

- **The migration has not been applied to any database**, dev or otherwise — `applyToneRewrite`/`lookupExistingToneCache` will error against a live Postgres until `discover_articles` actually has the five new columns.
- **No live-stack test of the tone rewrite** — never called against a real Groq/OpenRouter key, so the actual rewritten output quality, the batched-schema request/response shape against a real provider, and the safety-re-check firing on real model output are all unverified beyond the offline unit tests (which deliberately avoid the network path, matching `hunt/queries.js`'s own test-suite precedent).
- **Phases B, C, D of the plan are entirely unstarted**: no dwell-timing fix (`Date.now()`→`performance.now()`, still outstanding — this session did not touch `frontend/index.html` at all), no headline-dwell instrumentation, no new analytics events, no reading-stats view, no `AcademicCard.kind`/micro-article pipeline, no feed interleaving, no Stories band, no new `services/ai` internal visuals routes. Full design for all of these is in the plan file referenced above.
- Docs not yet refreshed for this work beyond this HANDOFF entry — no service LLD mentions the tone-rewrite fields or the KG changes yet.

### Next session should

1. Apply the new migration to a real database (`docker compose up --build -d` for dev) and run a real hunt against a configured provider to see actual rewritten output for the first time.
2. Continue with Phase B of the plan (dwell-bug fix, headline-dwell instrumentation, new analytics events, reading-stats view) — smallest remaining phase, frontend-touching but low-risk.
3. Re-read the plan file before starting anything — it has exact schema/route/file-level detail for Phases B–D that isn't fully repeated here.

---

## Session — 2026-08-14: Interactives generation moved to a 400B+ MoE model (`openai/gpt-oss-120b`), demoed live end-to-end

### Why

User asked for a demo of the interactives (explainer) system, and asked that it run on "a 400B+ coding model, MoE, free and available for MVPs." Llama 4 Maverick and Kimi K2 — the two genuine 400B+ MoE models that were free on Groq — were **both deprecated by Groq in Feb/Mar 2026** in favor of `openai/gpt-oss-120b` (117B total / 5.1B active, MoE, still free tier). That's the largest free MoE coding-capable model Groq currently serves, so it's what got wired in. Went with Groq, not OpenRouter: `OPENROUTER_API_KEY` is intentionally blanked in `.env` from the prior session's workaround for known-risk #7 (OpenRouter is picked the instant the key is non-empty, no failover), and re-enabling it would affect quiz/practice/discover too, not just visuals.

### What changed

- `services/ai/structured-llm.js`: Groq's `buildRequestBody` now sends `reasoning_effort: 'low'` when the resolved model starts with `openai/gpt-oss` — gated by model name, not task, so `llama-3.3-70b-versatile` (which doesn't support the field) on quiz/practice/discover is unaffected. **This was a real bug, not a precaution**: a raw test call to `gpt-oss-120b` with an unconstrained request burned its entire `max_tokens` budget on a hidden reasoning trace and returned empty `content` (`finish_reason: "length"`). Without this fix, gpt-oss-120b explainer generations would have failed validation (empty/truncated JSON) on every attempt.
- `docker-compose.yml` (`ai` service): added `GROQ_VISUALS_MODEL` and `GROQ_EXPLAINER_MODEL`, both defaulting to `openai/gpt-oss-120b`.
- `.env`: same two vars, with the deprecation context in a comment.

### A real bug found while wiring this in

`services/ai/visuals/index.js` — `generateConceptMapSpec` calls `generateStructured({task: 'visuals', ...})` but `generateExplainerSpec` calls it with `task: 'explainer'` (line 209). They are **not the same task key**, so `GROQ_VISUALS_MODEL` alone only covered `concept_map`; the explainer tier — the actual "interactives system" the user meant — silently stayed on the old default until `GROQ_EXPLAINER_MODEL` was added too. Caught by checking `visual_artifacts.model` in the DB after a generation and seeing `llama-3.3-70b-versatile` instead of the new model.

### Verified against the live stack

- `concept_map` generation: `model=openai/gpt-oss-120b, provider=groq, status=done` (`aa6f579b-…`).
- `explainer` generation, twice — once via direct API call, once **through the real frontend UI** (typed into the Diagrams → Interactive tab, clicked Generate): both landed `model=openai/gpt-oss-120b, provider=groq, status=done` (`6e69dbf7-…`, `d928f80d-…`).
- The UI-generated explainer — "cube volume vs. side length" for NCERT Grade 8 Ch.1 "A Square and a Cube" — rendered live in the Browser pane: a labelled slider ("Side length: 5") and a computed cube drawing, both requiring the model's JS to have actually executed. `sandbox="allow-scripts"` with no `allow-same-origin` confirmed on the live iframe — isolation boundary intact.
- Citations are real: 4 excerpts from NCERT Mathematics Grade 8, Ganita Prakash, Ch.1, pp.5/9/13/16.

### Not verified

- **Dragging the live slider inside the sandboxed iframe** — synthetic click/drag from the Browser pane's `computer` tool did not move the thumb, on 3 attempts (drag, click-to-thumb, click-on-track). This is almost certainly the same Browser-pane tooling limitation the 2026-08-13 session documented ("synthetic `left_click`/`scroll` time out … Browser pane is currently hidden") rather than a product defect — the initial render already proves the model-authored JS executed (the slider's label and the cube geometry are both JS-computed, not static markup) — but genuine touch/drag interaction on gpt-oss-120b-authored explainer JS specifically has **not** been proven, only implied by the pre-fix generation confirmed working in the 2026-08-13 session under the old model.

### Operational findings, not code bugs

- **Groq's free tier caps `openai/gpt-oss-120b` at 8000 TPM.** A single explainer request needs ~3200–3900 tokens (schema-in-prompt + a large html/css/js payload), so back-to-back explainer generations 429 quickly and the *bucket recovers slowly* — confirmed via `x-ratelimit-*` response headers. This is tight enough that **concurrent students generating explainers will 429 each other** on the free tier. Combined with known Defect 1 below (`services/ai/structured-llm.js:349` — a provider HTTP error skips the retry loop entirely), a 429 currently surfaces to the student as an outright failure, not a retried request. Worth prioritizing Defect 1's fix now that gpt-oss-120b's tighter budget makes it more likely to bite.
- **`llama-3.3-70b-versatile` (the default Groq model for tutor chat, quiz, practice, discover) is scheduled for Groq shutdown on 2026-08-16** — two days from this session. Not touched in this session (out of scope — the user's ask was specifically the interactives system), but the next session should either migrate `GROQ_MODEL` to `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` (Groq's own recommended replacements) or confirm Groq extended the deadline, before it breaks tutor chat in production.
- **Hit the same Docker Desktop VM-disk-full issue as a prior session**, independently of anything above: `postgres` was stuck restart-looping on `could not write lock file "postmaster.pid": No space left on device` (host disk had 274GB free — this is Docker Desktop's internal VM disk, not the host). Fixed with `docker builder prune -f` (reclaimed the build-cache-only 3.265GB, no volumes touched); postgres recovered its WAL cleanly and came back healthy. If this recurs, `docker builder prune` first before reaching for `docker system prune -af --volumes` — the latter is not needed for a cache-driven space issue and carries volume-deletion risk.
- **Demo account (`arjun@demo.com`) had incomplete onboarding** (`status: in_progress, answeredCount: 0`) despite being a seeded demo user — blocked all app access behind the one-time-setup screen. Answered via the same `PATCH /api/ai/onboarding/answers` + `POST /api/ai/onboarding/complete` the frontend itself calls, then it stayed completed. Not investigated further whether the demo seeder is supposed to pre-complete onboarding for seeded accounts — worth a look if this recurs for other demo users.

### Next session

- Fix Defect 1 (`services/ai/structured-llm.js:349` and its two copies) — now higher priority given gpt-oss-120b's tighter TPM budget makes 429s more likely than they were under llama-3.3.
- Decide `GROQ_MODEL`'s replacement before 2026-08-16 (`llama-3.3-70b-versatile` shutdown).
- Verify the interactive explainer's on-device slider/drag interaction actually responds under gpt-oss-120b, ideally via the iOS Simulator (real touch) once available, or a Browser-pane approach that can reach into the sandboxed iframe.

---

## Session — 2026-08-13 (DONE): Live browser verification of visuals + practice + tutor chat — 3 real defects found

### Why

The user asked to run the demo and debug the app in the iOS Simulator or the browser. **The iOS Simulator is unavailable on this machine** — `Xcode-beta.app` was extracted from a truncated 1.98GB `.xip` (a genuine Xcode beta is 8–12GB+), so `Simulator.app` and a loadable `SimulatorKit.framework` are simply absent; `spctl` reports "a sealed resource is missing or invalid". `xcrun simctl list runtimes` does show iOS 26.5 and 27.0 installed, but runtimes are not the host app. **Fix is a full re-download of Xcode; nothing in this repo is at fault.** Verification therefore ran in the Browser pane at 375×812 and 1280×800.

**Browser-pane caveat:** synthetic `left_click` / `scroll` time out in this environment ("Browser pane is currently hidden") — the same tooling limitation noted in the `services/practice` entry below. Screenshots and `javascript_tool` work, so the app was driven by dispatching real `.click()` on real elements (genuine handler execution) and verified visually. Touch-specific `DESIGN.md` invariants 9–11 remain **unverified** — they only reproduce on a real touch keyboard.

### Verified working (first visual confirmation for several)

- **Tutor chat** end-to-end: SSE `status`/`token`/`answer_context`/`done`, "Response saved", `.message-source` provenance citing 4 real textbook passages with chapter + page.
- **`concept_map`** renders on-device — closes the "never actually seen rendered" gap from the prior session.
- **`explainer`** mounts with `sandbox="allow-scripts"` and **no** `allow-same-origin`; in-frame CSP is `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'`. Isolation boundary intact. Theme toggle re-fetches and re-themes the frame correctly (light **and** dark).
- **`services/practice` frontend UI — now visually verified**, closing the explicit gap in CLAUDE.md known-risk #3: summary card, flashcards 1/4 with Prev/Flip/Next + dot indicators, Flip reveals the back, 4 MCQs with shuffled option order.
- **Answer key withheld before submit** — `GET /api/practice/:setId` returns question keys `['id','options','prompt']` only; `correctAnswer`/`explanation` absent from the whole payload. Grading after submit returns the key and scored 1/4 = 25% correctly.
- Analytics events landed: `chat_message` ×7, `lesson_started` ×2, `visual_generated` ×2, `practice_generated` ×1. (`practice_completed` correctly did **not** fire — it gates on `flashcardsReviewed && allAnswered`.)
- Question sweep: "explain like I'm 12" (personalised with a rock-climbing analogy from the interest graph), cross-chapter (ch.9 friction ↔ ch.8), nonsense input (graceful "I do not have information on that yet"), prompt-injection attempt (refused), academic-distress message (supportive, redirected to the chapter, **no clinical constructs** — consistent with the DPDP rule).
- `document.body.scrollWidth === window.innerWidth` at both 375 and 1280.

### 🔴 Defect 1 — a provider HTTP error kills generation before the self-correcting retry can run

`services/practice/structured-llm.js:338` (and identically `services/ai/structured-llm.js:349`, `services/discover/structured-llm.js:348`) calls `await requestCompletion(messages)` **outside** the `try` block that drives the retry loop. Only `parseJsonPayload`/`validate` failures are caught, so any non-2xx from the provider throws straight out of the loop on attempt 1.

Observed live: Groq returned `400 json_validate_failed` because the model emitted malformed JSON — `"options>` instead of `"options":`, and JSON *objects* `{'a','b'}` with single-quoted strings where arrays were required. The student saw **"Practice content could not be generated. Please try again later."**

This is exactly the correctable formatting error the retry loop exists for, and it is **intermittent, not deterministic** — two subsequent identical requests succeeded. Groq's `json_validate_failed` should be retried; a 401/402/429 should not. Fix must land in **all three copies** or they diverge. Related to, but distinct from, known-risk #7 (which is about provider *selection* ignoring `LLM_PROVIDER`).

### 🟠 Defect 2 — explainer content overflows its own declared frame height

The model declares `height` (bounded 240–720 in `spec-validate.js`) and separately authors the markup, and **nothing cross-checks the two**. Live example declared `height: 400` and then authored `#scene` at `height: 400px`, so the scene alone consumed the entire frame and the only interactive control — a `<input type="range">` slider plus its label — rendered **entirely below the visible area**, at both 375px and 1280px. `render-html.js` sets no `overflow` rule, so the frame body scrolls, but there is zero affordance telling a student to scroll inside the box; what they see is an interactive explainer with no controls.

No deterministic fix is possible from the height alone (the "no `postMessage` height channel" decision is deliberate and shouldn't be reversed for this). Options worth weighing: require in the prompt that controls precede the scene, cap author-set fixed pixel heights on top-level children relative to the declared frame height in `render-html.js`, or give the frame a visible scroll affordance.

### 🟡 Defect 3 — concept-map edge labels collide with node boxes

`services/ai/visuals/graph-layout.js:338-339` places every edge label at the plain horizontal midpoint of the two node centres (`labelX = (from.centreX + to.centreX) / 2`, `labelY = channelY - 4`) with **no collision check** against node boxes or other edge labels. For a vertical edge between x-aligned nodes the midpoint lands in the node's own centre column. Measured live on a real artifact: the `changes` edge label (y 96.3–105.3) overlaps the `Object` node label (y 104.6–115.1), rendering as an unreadable glyph pile. Viewport-independent — it is in the layout, not the scaling.

### Minor

`services/practice/server.js:196` guards `answers` with `typeof req.body.answers === 'object'`, which an **array** also satisfies. An array payload silently grades every question wrong (`studentAnswer: null`) instead of returning 400. The frontend sends the correct object map (`frontend/index.html:5489,8313`), so this is a validation gap, not a live bug.

### Next session

Fix Defect 1 first — it is the one that shows a student a dead end, and it is three near-identical edits. Nothing was changed in this session; it was verification-only and every defect above is still live.

---

## Session — 2026-08-13 (DONE): Multi-agent codebase review, frontend perf, and a motion/interaction QoL pass

### Why

A user-requested four-agent codebase review (security, caching, dead-code, performance), followed by implementing the performance findings, then a separate four-agent audit + fix pass on `frontend/index.html`'s motion, panel, and interaction consistency against `frontend/DESIGN.md`'s Academic Premium system.

### Codebase review (research only, not all acted on)

Four parallel agents reviewed the full repo. Acted on: the two performance findings (below). **Not yet fixed, still open:**
- `services/rag/main.py:605-612` — PDF upload validation is `OR` not `AND` (extension-only or content-type-only satisfies it); arbitrary bytes reach `fitz.open()`. 🔴 High.
- Non-constant-time internal-token comparison (`token !== configured`) across `analytics`/`discover`/`practice`/`quiz`/`ai` — the one secret gating public-reachable `/internal/*` routes.
- `kubernetes/` manifests: only 3 of 8 services tracked, rest untracked/stale, contradicts CLAUDE.md's own "no k8s without a scaling trigger" rule.
- Chapter-context re-fetched from RAG on every lesson-open/visual request before checking cache; RAG's candidate-chunk query re-runs every tutor turn; teacher dashboard recomputes from raw events on every load — all safe TTL-cache candidates, none implemented.
- Unused `uuid` dep in `services/auth`; no `package-lock.json` committed for `services/discover`.

### Performance fixes (implemented, verified live)

- **`frontend/server.js`** — added gzip/brotli compression + ETag/`Cache-Control: no-cache` conditional caching for static file serving. The 428KB `index.html` now transfers as 85KB (brotli) or 92KB (gzip). Verified live: `304` on a matching `If-None-Match`, fresh ETag + `200` the instant the file is touched — the `docker cp` hot-patch workflow (CLAUDE.md's own iteration loop) still works, confirmed by touching the file mid-run and observing the very next request pick it up.
- **`frontend/index.html`** — three `await a(); await b();` pairs (all after ingestion/upload events, hitting unrelated services) collapsed to `Promise.all([a(), b()])`.

### Motion / interaction QoL pass (implemented, verified live in both themes, mobile + desktop)

Scoped deliberately: DESIGN.md invariant 15 bans spring/overshoot easing and invariant 17 bans a third motion duration, so "Apple-style" here means enforcing the existing crisp `cubic-bezier(0,0,.2,1)` decelerate curve consistently, not adding bounce. Flagged this constraint before implementing rather than silently reinterpreting the ask.

- **Found and fixed a real invariant-14 bug**: `closeGlassSheet()`'s cleanup `setTimeout` was `560`, but `.glass-sheet`'s actual transition is `var(--ap-ease-slow)` = `600ms` — a stale value left over from an earlier partial fix (the code comment still claimed "560ms... documented duration," which was itself wrong). Fixed to `600` and corrected the comment.
- **Found and fixed dead code before "fixing" it**: `.subject-card`/`.chapter-card`'s own `180ms ease`/`160ms ease` transitions (the audit agent's first-pass finding) are fully overridden by a later same-specificity rule at the shared `.panel, .summary-card, .subject-card, ...` block — fixing the dead declarations would have been a no-op. Fixed the actually-winning rule instead (`320ms var(--ease)` → `var(--ap-ease-slow)`), confirmed live via `getComputedStyle` (`transitionDuration` now reads `0.6s`).
- Migrated `.chat-history-inline`'s three transitions and `.tutor-chat-sidebar`'s drawer transition off hardcoded durations/curves onto `var(--ap-ease-fast)`/`var(--ap-ease-slow)`.
- **Fixed a real invariant-15 violation**: `.chat-history-inline` was missing from the Liquid-Glass-flatten `!important` selector list (present in both the light and dark legacy gradient blocks, absent from the flatten override) — it was the one surviving translucent-gradient-plus-inset-lit-lip-shadow relic in an otherwise fully-migrated component group. Added it to the flatten list; verified live (`getComputedStyle` on the actual element: `background-image: none`, flat `--ap-surface`).
- **Fixed a real invariant-5 violation**: `.quiz-result-score` had hardcoded `#c8e2d1`/`#edf7f0` (light) and `#1c1814` (dark, not even matching `--ap-surface-2`'s dark value) instead of tokens. Moved it into the existing nested-surface `!important` list (`var(--ap-surface-2)`, `box-shadow: none`) and deleted the now-redundant hardcoded rule and the dark-mode override line. Verified live via `getComputedStyle` (rule now reads three properties, no color literals).
- **Fixed a real §8 violation**: `.topbar`/`.sidebar`/`.glass-sheet`'s `backdrop-filter` resolved to `blur(0px) saturate(100%)`, not the literal `none` §8 requires ("a non-`none` value is a bug, not an exception"). Changed to literal `none` — zero visual change, verified via `getComputedStyle`.
- Added missing `:hover`/`:focus-visible` states to `.seg-btn` and `.genre-chip` (matching `.module-tab`'s existing pattern) and `:focus-visible` to `.module-tab` itself, which had none. Wired `.feed-card-open` into the shared tap-feedback selector — it already declared `.is-pressed { opacity: .8 }` but nothing ever added that class to it (dead CSS); also gave it its own `:hover`/`:focus-visible`.
- Every change verified via `getComputedStyle`/live CSSOM inspection in the actual running app (not just visual screenshots) — confirmed rule text, resolved values, and `document.body.scrollWidth === window.innerWidth` at 375×812 and 1280×800, both themes.

### Deliberately not touched (higher blast radius, out of scope for a "subtle" pass)

- `showTutorPane()`/`showTeacherPane()` animate in via `animation: lg-view .6s ...` but snap out instantly (`display:none`, no exit transition) — a real asymmetry, but fixing it means either keeping outgoing panes in the layout during an exit transition or JS-choreographing a matching `is-leaving` class + timeout, on the app's primary navigation surface. Left as a known gap rather than risk it under time pressure.
- Several hard-cut state swaps (`showPracticeState`, subject-grid ↔ chapter-browser, library ↔ chat-workspace, the interest-suggestion accept/reject flow) have no crossfade at all — good candidates for a future pass, not done here.
- Ambiguous/possibly-intentional gradients left alone: the dashboard summary-card box-shadows (colour-matched per card, arguably deliberate), `.student-news-panel .panel-header`'s light-only gradient, `.chapter-card-media::after`'s image scrim, `.onboarding-screen`'s background — none matched a documented invariant violation clearly enough to touch without design authority.
- `.list-item`/`.news-story` still lack an explicit `:hover` — skipped because they already resolve to `--ap-surface-2` via the nested-surface rule, and a naive hover rule using the same token would be invisible; doing this properly needs a lighter/darker step or a border-color change, a real design call not a mechanical fix.

### Not done / known

- None of the four "codebase review" security/caching/lean-down findings above are fixed yet — only surfaced and triaged. The PDF upload validation bug is the highest-severity item outstanding in the whole repo right now.
- `structured-llm.js`'s `LLM_PROVIDER`-ignoring bug (risk #7, prior session) is still unfixed and still live in all 3 copies.
- This session's frontend edits were hot-patched into the running container via `docker cp` (`docker compose build` still can't run on this host — no outbound DNS to `auth.docker.io`, unchanged from prior sessions). Not yet baked into a real image.

---

## Session — 2026-08-12 (latest, DONE): SVG visuals proven live, and the executable explainer tier (step 6)

### Why

Two separate gaps, and the first had to close before the second was worth building.

1. **The concept-map SVG path had never run.** Every prior claim about it was static verification — `generateConceptMapSpec` had never made a real provider call. Confirmed independently at the start of this session: `ai_db.visual_artifacts` held **0 rows**.
2. **The executable tier did not exist.** `kinds.js` had reserved `EXECUTABLE_KINDS = []` with the acceptance bar written into its comment, and `isExecutable` was exported and imported nowhere.

Product-owner decisions taken up front: verify SVG live *first*; build the explainer as **LLM-authored code** behind sandbox + CSP + scan rather than deterministic templates; **no teacher gate**, consistent with the rest of the visuals feature.

### Phase A — the SVG tier now has a live provenance

Ran end-to-end against the running stack. **Passed**, with one blocker found on the way (below).

| Step | Result |
|---|---|
| `POST /api/ai/visuals` → 202, poll → `done` | Real Groq call, `llama-3.3-70b-versatile`, first attempt |
| SVG invariants on real output | No hex/`rgb()`, no `<script>`/`foreignObject`/`use`/`image`, no `on*=`, no external host, all three ids prefixed `rv-{artifactId}-` |
| `altText` + `provenance.excerpts` | Present; 4 excerpts, chapter 9 Friction |
| Re-POST identical request | **200** with the same `artifactId` — cache hit works |
| `visual_generated` analytics | Landed with `visualKind`, `nodeCount`, `edgeCount`, `provider: groq` |
| Teacher dashboard | "Diagrams" counter moved 0 → 1 |
| Browser | Rendered in the real app at 375×812 **and** 1280×800, **both themes**, `scrollWidth === innerWidth` throughout |

The "no literal colour" invariant paid off visibly: toggling the theme re-styled a **stored** artifact with no re-render.

### The blocker Phase A found — and it is not a visuals bug

`services/ai/structured-llm.js`'s `resolveStructuredProvider` selects OpenRouter whenever `OPENROUTER_API_KEY` is non-empty and **never reads `LLM_PROVIDER`**. `.env` sets `LLM_PROVIDER=groq` with a working `GROQ_API_KEY`, and every generation still died on `openrouter … 402 Insufficient credits`. Its own docblock says "preferring OpenRouter and falling back to Groq" — that fallback is **key-absence selection, not failure failover**; once OpenRouter is chosen an HTTP error is terminal.

This governs every `generateStructured` caller and the file is duplicated as copy #5 (`services/practice`) and #6 (`services/discover`), so a fix must land in all three or they diverge. **Deliberately not fixed here** — it is a behavioural change to a shared seam touching demo-critical paths, and it is not this session's scope. Logged as risk 7 in `CLAUDE.md`.

**Verification workaround used:** `OPENROUTER_API_KEY` was blanked in `.env` to force the Groq branch, and **`.env` has been restored byte-identically** (verified by md5). **So the running stack is back to the broken configuration** — visuals and explainers will 402 until either OpenRouter is topped up or the seam is fixed.

### Phase B — the explainer tier

The model authors `{title, summary, html, css, js, height, citations}`; `render-html.js` is the only module that assembles a document. The model never writes the doctype, `<head>`, the CSP or the theme block. Rendered on read, like the SVG tier.

**The three layers, and which ones are load-bearing.** This is the part not to lose:

1. `sandbox="allow-scripts"` with **no** `allow-same-origin` → opaque origin.
2. `default-src 'none'` CSP inside the document → no network at all.
3. `explainer-scan.js` — a deny-list over the model's source.

**1 and 2 are the boundary. 3 is quality control that fails closed.** A regex pass over JavaScript is not a sound security control, and the code says so rather than implying otherwise. What 3 earns its place with: it fails closed, its message becomes the model's correction turn, and it catches the *honest* mistakes (a model reaching for `localStorage` to remember a slider is the common case, not an attack).

**Proven live, from inside a frame running `window['fe'+'tch']` — the exact obfuscation that defeats the scan:**

```
cookie THREW SecurityError
localStorage BLOCKED (SecurityError)
parent.document BLOCKED (SecurityError)
origin = "null"
fetch BLOCKED (TypeError)
```

That is the boundary holding with layer 3 fully bypassed, which is the only test that actually means anything.

**Fail-closed on read, proven live.** A hostile spec was inserted straight into `visual_artifacts`, bypassing generation entirely. `GET` returned **500** with a generic student-facing message and logged the cause (`ExplainerScanError: js contains a network call`). The scan runs twice by design — in the validator and again in `render-html.js` — so a spec stored by an older build cannot be served.

| | What | Verification |
|---|---|---|
| 1 | `kinds.js` — `EXPLAINER` in `VISUAL_KINDS` and `EXECUTABLE_KINDS`; `isExecutable` live for the first time | Landed with its renderer in the same change, per the file's own no-placeholder rule |
| 2 | `explainer-scan.js` — 6 script rules, 3 markup, 1 style, plus any-external-reference | 18 tests, each asserting the message names the construct **and** the remedy |
| 3 | `explainer-validate.js` + `collectExplainerText` | 19 tests. The collector deliberately excludes js/css — prose safety rules over source code are a false-positive generator (`kill`, `abort`, `dead`) |
| 4 | `render-html.js` — sole assembler, CSP, script-close neutralisation | 13 tests incl. the planted-hostile-spec case and `</script>` breakout |
| 5 | `theme-tokens.js` — literal palette, both themes always emitted | Documented exception to `DESIGN.md` §9 invariant 5, with the reason |
| 6 | `index.js` — `RENDERERS`/`GENERATORS` registries replacing the `if (kind !== …)` chains | Two payload shapes made the branching the bug |
| 7 | `intent.js` — explainer patterns checked **before** concept-map | 6 new tests incl. must-**not**-route ("is friction interactive with surface area") and mention-veto |
| 8 | `server.js` — dispatch, per-kind safety collector, per-kind metadata, `html` payload, scan failure reason | 212/212 `services/ai` (was 155) |
| 9 | Frontend — 3-kind `.seg`, `#visual-frame-wrap`, theme re-fetch, both choke points made kind-aware | CRLF 10031/10031, both scripts parse, 736/736 braces, every `#id` selector resolves |

**Zero schema changes and zero new dependencies.** `kind` is `varchar(24)`, `spec` is `jsonb`, and the scan is regex — no HTML parser was added to a 4-dependency service. Analytics reuses `visual_generated` with `visualKind: 'explainer'`, so no allowlist change and `event-types.test.js` stays 4/4.

**Two real bugs caught only by rendering it.** The frame painted **black** in dark mode — `color-scheme` makes the UA paint its own canvas behind a transparent body — fixed by painting `--surface` explicitly. And the first generation drew `<svg width="100" height="100">` with a label wider than the box, clipped on a phone. Both fixes landed **retroactively on the already-stored artifact** with no regeneration, which is the render-on-read property doing exactly what it was built for.

### Corrections to earlier claims

- **`HANDOFF.md:299`'s "the 27 seeded NCERT documents have no backing PDF" is stale.** All 27 chapters are `ready` with real documents and thousands of chunks each. The corpus was re-ingested at some point after that entry.
- **`CLAUDE.md` said `event-types.test.js` scans three files at the repo root.** It scans **five** (`ai`, `quiz`, `analytics.routes`, `practice`, `discover`) and lives at `services/analytics/tests/`. Corrected.
- **`CLAUDE.md` listed `.env*` as CRLF.** `.env` is LF (measured). Corrected.

### Not done / known

- **The provider seam is still broken for the restored `.env`** — see above. This is the first thing to deal with next session; nothing in the visuals subsystem can generate until it is.
- **Content quality is the real open question, not safety.** Two live generations: one good (two sliders driving a pressure calculation, responsive flexbox), one weak (a fixed-size SVG with clipped text, and a rectangle filled `var(--surface)` against a `--surface` background, i.e. invisible). The prompt now asks for `viewBox` + `width="100%"` and the stylesheet scales an un-sized `<svg>`, but **that fix has not been proven across a sample** — n=1 after the change. This is the same lesson the SVG tier already recorded: handing a model coordinates produces geometrically legal, visually nonsense output.
- **No adversarial *prompt* testing.** The scan and sandbox were tested against hostile code; nobody has tried to talk the model into emitting hostile code via the chapter text or the prompt.
- **Only Groq was exercised.** The OpenRouter branch of the explainer path has never run (no credits), so its strict-`json_schema` behaviour with this schema is unverified.
- **`docker compose build` cannot run on this host** — no outbound DNS to `auth.docker.io`. The `ai` service was updated by `docker cp` + `restart`, which works because there are no volume mounts. **A real `--build` deploy has therefore not been exercised for this change.**
- Outbound DNS from the host dropped mid-session for ~60s and one generation failed `fetch failed`; it was handled cleanly (`status: failed`, generic message, no leak). Worth knowing the environment is flaky rather than the code.
- **Steps 2–5 still unbuilt**: flowcharts, chat attachment (`visual_pending` SSE), plots, template diagrams.
- **A narrow concept map stretches oddly on desktop** — `.rv-svg { width: 100% }` with no `max-width` blows a 172-unit-wide viewBox up to ~950px. Pre-existing, cosmetic, not touched.

### Test suites

`services/ai` **212/212** (was 155) · `services/analytics` `event-types` 4/4 · frontend: CRLF preserved 10031/10031, both inline scripts parse, 736/736 CSS braces balanced, no unresolved `#id` selector.

---

## Session — 2026-08-12: Discover feed visual/behavioral redesign — Google News/Discover card system

### Why

Explicit product-owner ask: the Discover feed should visually and behaviorally read as Google News/Discover — a student already familiar with that app should recognize the interaction model instantly. The prior layout (`.feed-lead` hero + `.feed-item` compact list, plus a bulky static "Your interests" dashboard panel sitting above the feed on every load) read more like a dashboard widget than a content stream, per DESIGN.md's own pre-redesign framing in §9b.

### What changed

`frontend/index.html` only — no backend changes. Same palette throughout (`--ap-*` tokens exclusively, per the explicit "keep the same colours and palette" instruction); no new colors introduced.

- **One unified card component** (`.feed-card`) replaces the old two-shape system. Every story gets the same treatment — kicker, publisher-avatar meta row, headline, image, summary, topic chips — with a `.feed-card--compact` modifier that drops the media block *only* when `article.imageUrl` is genuinely null (never a fabricated placeholder thumbnail standing in for missing data).
- **Kickers are real, not decorative.** `For you` on the personalised tab, `Trending in {topic}` when `article.origin === 'hunt'` — both derived from fields the feed response actually carries, matching the CLAUDE.md rule against LLM/UI-fabricated relevance signals.
- **Removed the bulky "Your interests" panel** (~30 lines of static HTML + its own button + its own click listener) that sat above the feed on every load — content now starts immediately after the topic chips, per the explicit "no dashboard landing section" requirement. `#discover-graph-btn` in the header remains the sole entry to the interest-graph sheet (it was already redundant with the panel's own button before this change).
- **Infinite scroll**, replacing the old click-triggered "Load more stories" button: an `IntersectionObserver` on a sentinel (`rootMargin: 600px`) prefetches the next page before the user reaches the true bottom, appending one skeleton card rather than a full-page loading state.
- **Desktop centered reading column** (`max-width: 680px` at `≥900px`) — cards no longer stretch across the full viewport on wide screens.
- **Per-card ⋮ menu**, reusing the existing shared glass-sheet component. **Scoped down from the request on purpose**: only Share and Not interested are wired, both to signal kinds/endpoints that already exist (`data-news-share`/`data-news-skip`, unchanged). Save and Follow topic/source were requested but deliberately **not built** — `services/discover` has no `save` signal kind and no follow-topic endpoint, and adding one only to discover's copy of the interest-graph module would silently diverge it from `services/ai`'s, which `test/graph.test.js` asserts stay byte-identical (the load-bearing port-equivalence invariant recorded in the 2026-08-12 Discover-service session above). Building a Save button with nothing behind it would be exactly the "no placeholders / dead UI" pattern CLAUDE.md forbids. **If Save is wanted, it needs its own small coordinated change**: a new signal kind added to *both* `services/ai/interest-graph.js` and `services/discover/interest/graph.js` in the same commit, with `test/graph.test.js` updated to assert the new kind's weight matches across both copies.
- **Multi-source and Video card types from the original spec were also dropped**, same reasoning: `DiscoverArticle` carries no video/duration field and no multi-source clustering, so those variants would render against data that never arrives.
- Fixed two latent issues surfaced while touching this code: `.feed-meta`/`.feed-lead`/`.feed-item`/`.feed-genre` CSS rules were being deleted wholesale by the rewrite even though `.feed-meta` is also used by the (unrelated) visuals "Recent visuals" label and the interest graph's "Names you follow" row — restored as a small shared utility class. The invariant-10 shared "button surfaces need an explicit `color`" selector list (DESIGN.md §9 item 10) referenced the now-deleted `.feed-lead`/`.feed-item` class names — updated to `.feed-card-open`/`.feed-card-menu`.

**Follow-up correction, same session: article cover images were low-resolution.** All ten live RSS feeds are BBC (`search/rss.js`'s `DEFAULT_NEWS_FEEDS`), and every BBC `<media:thumbnail>` points at ichef's 240px-wide rendition — sized for the old RSS-reader thumbnail, visibly blurry stretched to fill a card's cover image at up to 680px CSS width on a 2–3x retina display. `search/rss.js` gained `upsizeIchefImage()`: BBC's ichef proxy encodes the requested width as a literal URL path segment (`…/ace/standard/240/…`), so substituting `976` (one of ichef's standard width steps) requests a larger rendition of the *same* asset from the *same* already-trusted domain — not a new fetch target, and not a new image source to safety-review. Applied in `extractOriginalImageUrl` before the URL is ever stored. Deliberately **not** mirrored into the deprecated `services/ai/student-news.js` shim (no live UI calls it any more) — `test/curation.test.js`'s new case for this says so explicitly, since that file's existing port-equivalence check (`legacy.parseRssFeed`) would otherwise need updating for a codepath about to be deleted. Tavily-sourced (hunt-lane) images are untouched — there is no reliable per-publisher CDN size parameter to substitute generically, and Tavily's own `include_images` extraction is typically already reasonably sized. `services/discover` rebuilt and restarted; a manual `refreshRssArticles()` run against the live container re-ingested 127 real BBC articles and confirmed every stored `imageUrl` now reads `/standard/976/`. Verified in the browser: the exact upsized URL loads as a real 976×549 JPEG (screenshotted directly), and the live feed now renders sharp, detailed cover images in both themes — a visible, immediate improvement over the previous blurry thumbnails. Covered by a new test in `services/discover/test/curation.test.js`.

### Verified

- `node -e` script/brace parse-check: both pass (733/733 braces balanced, both inline `<script>` blocks parse).
- CRLF preserved (`frontend/index.html` is still pure CRLF end to end).
- No stale class references anywhere in the file (grepped for `feed-lead`/`feed-item`/`feed-genre`/`discover-interests-view-btn`/`discover-interests-container` post-edit — zero hits).
- Hot-patched into the running `frontend` container and exercised in a real browser against the live `docker compose` stack (real `services/discover` API, real BBC-sourced article images):
  - Desktop 1280px: cards render correctly, images fade in (`is-loaded` class applied via the delegated `'load'` listener — confirmed 5/5 above-the-fold images loaded with correct `naturalWidth`), no horizontal overflow (`scrollWidth === innerWidth`).
  - Mobile 375×812: floating pill nav, chip rail, and cards all render correctly at native mobile width; `scrollWidth === innerWidth` confirmed (379/379).
  - Both themes: dark mode confirmed correct contrast throughout (no hardcoded hex found — everything resolves through `--ap-*` tokens).
  - Kebab menu confirmed functionally live end to end: tap opens the glass-sheet growing from the button's own rect, shows the real article title and the two real action rows, `Share`/`Not interested` map onto the pre-existing, unchanged `data-news-share`/`data-news-skip` handlers.
  - Impression signals confirmed still firing correctly against the new markup (`POST /api/discover/signal` × 3 with `kind: 'impression'` observed in the network log on page load).
  - Image upsize: `services/discover` unit suite 68/68 (67 + the new ichef-upsize case). Rebuilt and restarted the live container; a manual RSS refresh re-ingested 127 real BBC articles, all with `/standard/976/` image URLs; the exact upsized URL loads as a genuine 976×549 photo (screenshotted); the redesigned feed now renders visibly sharp cover images in both themes.

### Not verified / known gaps

- **The Browser-pane tool itself was intermittently flaky this session** during scroll-driven screenshot capture (blank frames, a stale composited frame showing a `teacher-mvp` view's own separate `.genre-bar` instance overlaid) — cross-checked against direct DOM queries (`getBoundingClientRect`, `getComputedStyle`, `elementFromPoint`) every time, which consistently showed correct layout. Logged here so a future session doesn't mistake tooling flakiness for a real rendering bug if it recurs, but treat as not app-side.
- **Not verified in the iOS Simulator** (DESIGN.md's own guidance: invariants 9–11 only reproduce on a real touch keyboard/notched-device simulator, not a resized desktop browser). The iOS Simulator panel was stuck in a crash loop earlier this session on this host (see the mid-session note); the Discover redesign itself was only checked in the in-app Browser pane at emulated mobile width, not on-device. Worth a follow-up pass once the simulator panel is healthy again.
- **Save/Follow topic/Follow source remain unbuilt** (see above) — flagged, not forgotten.

---

## Session — 2026-08-12: `services/discover` — agentic Discover feed + open-vocabulary interest graph

### Why

Product framing from the user: Discover is not a news reader. It is meant to be a set of agents that keep a student current on the things they actually care about — school subjects, a specialised interest, a hobby, the communities around it — and then feed that back into the tutor so explanations resonate. The analogy given was wanting "multiple versions of myself" tracking drones, defence tech, 3D printing and EdTech in parallel.

Three things blocked that, all structural rather than bugs:

1. **The feed was not agentic at all.** `services/ai/student-news.js` is a regex reader over 10 hardcoded BBC RSS URLs. A repo-wide grep for `tavily|serper|brave|exa|searxng|newsapi|gnews` returned **zero hits** — there was no web-search capability anywhere.
2. **The interest vocabulary was closed.** `services/ai/interest-graph.js` held 41 frozen topics matched by keyword regexes. "Rock climbing", "drones" and "3d printing" — the exact long tail motivating the request — were structurally unrepresentable, so a student reading about them produced *zero* topic nodes.
3. **Discover could not be upgraded independently**, being three modules inside a `services/ai` that already carries tutor streaming, visuals, image jobs, onboarding, chat insights and quiz drafting.

Also found and fixed in passing: onboarding interests never reached the interest graph at all (they landed in `StudentLearningProfile` and were rendered into a *separate* prompt block), so a brand-new student's "For You" tab was pure recency despite them having just answered the question.

### Decisions taken with the user, before building

Presented as four explicit choices; all four answered:

- **New `services/discover`** (over extending `services/ai`, or a full cross-schema data migration).
- **Tavily** as the search provider (over Brave/Exa/deferring), because it returns extracted page content in the same call — no second scrape hop.
- **LLM extraction with a deterministic write gate** (over a bigger keyword table, or embeddings-based clustering).
- **Full vertical slice** for phase 1 (over backend-only, or interest-graph-first).

### What was built

**`services/discover`** — Express + Prisma, port 3008, `/api/discover`, schema `discover_db`, 8 tables, generated init migration. Scaffolded from `services/practice` (Dockerfile, `load-env.js`, `lib/prisma.js`, both middlewares, two health routes, background-task Set, DB-claim job pattern).

- `search/provider.js` — narrow seam: `search({query, maxResults, freshnessDays}) -> [{url,title,snippet,content,publishedAt,imageUrl,sourceName}]`. `search/tavily.js` behind it; `search/rss.js` is the **zero-key fallback** (the ported BBC reader), so a stack with no `TAVILY_API_KEY` still boots with a populated feed and only loses the hunt lane.
- `hunt/queries.js` — the only generative step in hunting. Deterministic template fallback covers no-key and every failure path.
- `hunt/run.js` — per-**topic** hunting (one search for "drones" serves everyone holding that node), with a `HuntRun` claim lease. This replaces the predecessor's per-pod `setInterval`, which at `replicas: 2` had both pods hitting the feeds and racing the same upserts.
- `interest/vocab.js` — `canonicalKey()`, a pure function of label + static alias table. `Drones/drone/FPV drones/UAV/quadcopter` → `drones`; `3D printing/3D printer/additive manufacturing/FDM/resin printing` → `3d-printing`; `Rock climbing/bouldering/climbing` → `rock-climbing`. All 41 seed keys are pinned so the legacy import cannot orphan.
- `interest/graph.js` + `interest/store.js` — ports of the predecessor's maths and persistence, vocabulary injected instead of frozen. Weights, 21-day half-life, lazy decay-at-write, 400-node cap, `0.62*cosine + 0.38*recency` and the exploration lane are all unchanged.
- `interest/propose.js` → `InterestCandidate` **only**. `interest/promote.js`'s `candidateDecision()` is the sole path to an `InterestNode`, and admits exactly two routes: a student's answer, or `evidenceCount >= 3` from *distinct* sessions.
- `interest/bootstrap.js` — one-time per-student cold start: imports the legacy `ai_db` graph over a new internal route, and seeds onboarding answers.

**`services/ai`** — new `discover-interest-context.js` (modelled on `practice-learning-context.js`); the `loadInterestPromptContext` entry in the chat-stream `Promise.all` **swapped, not added**; two new internal export routes (`/internal/interest-graph`, `/internal/learning-profile`); fixed `chat-insights.js:101`, which property-accessed a `Map` so every topic label had been silently degrading to its raw key.

**Frontend** — four API calls repointed, topics now `{key,label}` objects, the "You've been reading about X — follow it?" card, `share`/`skip` finally emitted (both had server-side weights since the graph shipped and **no UI ever emitted them**), confirmed/onboarding nodes ringed in the radial map, and a "Hobbies and interests" affinity bar for the out-of-cluster share the closed taxonomy used to lose entirely.

**Wiring** — dev + production compose, `.env.example` + `.env.production.example`, `kubernetes/discover/{deployment,service}.yaml`, kustomization, ingress, and `kubernetes/secrets/README.md` (which was **also missing `practice-secrets`** — added, since a deploy following that file would have failed).

### How this stays inside MASTERCONTEXT §7

The LLM does two things: writes search queries, and *proposes* interest labels. It never sets a weight, ranks an article, or names a key. Proposals stop at `InterestCandidate`; a human answer or a plain integer count is the only way anything becomes learner-facing state. Ranking is plain code. Recorded as an override in `MASTERCONTEXT.md` §6 alongside `services/practice`, so the service count stays truthful.

### What is verified

**299 unit tests green** across ai (155), quiz (36), auth (6), analytics (35), discover (67). `services/analytics` needed `npm install` first — documented, pre-existing.

- **Port equivalence.** `test/graph.test.js` and `test/curation.test.js` load **both** the new modules and the live `services/ai` originals and assert they agree on topic extraction, entity extraction, ranking order, decay, signal weights, the safety verdict for every genre, near-duplicate detection and category balancing. The port is behaviour-preserving, not "looks right".
- **Prompt injection.** `test/untrusted-content.test.js`: a hostile page cannot invent an interest (citations must be URLs we supplied), an injected instruction cannot survive as a label (4-word cap), a forged block terminator inside a title is flattened, and a correct proposal *still* only reaches `pending`.
- **Live stack, hop by hop** (`docker compose`, demo student `arjun@demo.com`): feed → signal → weights moving → interests graph → candidate accept (node with `origin:'confirmed'`, weight 3.2) → reject (tombstoned) → re-decide returns **409** → internal context 401 without token, 401 with only a student cookie, 200 with the token → `ai → discover` hop through the real client module returning the full prompt block → analytics events landing with correct metadata.
- **The claim lease.** A second `claimHuntRun` against a queued row returned `NONE`. Multi-replica safe.
- **A real induced provider failure.** OpenRouter returned **402 (out of credits)** during a live hunt; query generation degraded to deterministic templates and the hunt completed and stored articles. Not simulated.
- **Curation on live data.** 15 stubbed results → 2 stored: the blocklist rejected a violent headline, `areSimilarNewsStories` dropped a near-duplicate, and `canonicalArticleUrl` collapsed a `utm_source` twin.
- **Cold start.** Reset and re-ran against the real stack: 30 legacy `ai_db` nodes imported and both onboarding interests seeded (`writing`, and `stories`→`story`), each with its `origin` recorded.
- **Frontend, in a real browser** — 375×812 **and** 1280×720, **both** themes, `document.body.scrollWidth === window.innerWidth` in every configuration, both card buttons at 44px. Scripts parse, CSS braces 720/720 balanced, `index.html` still pure CRLF. (This is the browser verification `services/practice` still owes; this one does not repeat that.)

### What is NOT verified — read this before trusting the hunt in production

- **`search/tavily.js` has never made a real HTTP call, and the RSS fallback has never actually fetched.** Containers in this environment had no outbound DNS (`getent hosts feeds.bbci.co.uk` → failed), so the hunt was proven end-to-end with a **stubbed provider** and the Tavily client only by unit-level reasoning. Set `TAVILY_API_KEY` on a networked host and confirm one real hunt. This is the single largest open item.
- **`interest/propose.js` has never run against a live model** — the OpenRouter key on this machine is out of credits, so no real interest proposal was ever generated. The gate around it is fully tested; the proposal step itself is not.
- **No load or cost measurement.** `DISCOVER_HUNT_MAX_TOPICS_PER_RUN=12` every 3h is a guess, not a measured budget.

### Known issues carried, not introduced

- **Left-boundary-only topic matcher.** `(^|[^a-z])term` has no right boundary, so `ai` matches inside "aircraft" — observed live, tagging a drone-regulation article with topic `AI`. Ported verbatim from `services/ai/interest-graph.js` and pinned by the equivalence tests, so fixing it means fixing both copies and updating `test/graph.test.js` in the same change.
- **`decodeXml` is order-dependent** (`&amp;lt;` → `<`, but `&amp;amp;` → `&amp;`). Safe only because every article field reaches the DOM through `escapeHtml()`/`safeUrl()`. Pinned with a comment naming the condition under which it becomes an XSS vector.
- **Copy #6 of provider selection** and a trimmed `safety.js` fork, for the same no-cross-service-imports reason as `services/practice`.

### Two real defects found *by* the live run, and fixed

1. **Vocabulary staleness across processes.** A topic created by one replica rendered as its raw key (`drones`, not `Drones`) in every other replica until restart. Fixed with `ensureTopicsLoaded()` — one indexed query, only on a miss — called before the feed and graph routes render labels.
2. **Cold start could permanently lose a student's history.** The original stamped `importedLegacyGraphAt` unconditionally, so a student who opened Discover while `services/ai` was down never imported again. Now it stamps only when ai actually answered, with a 60s per-process backoff so an outage cannot put a timing-out call in the feed hot path. Covered by `test/bootstrap.test.js`.

A third was diagnosed and was **not** a code fault: new analytics event types 400'd because the running `analytics` container predated the allowlist edit. This is the swallowed-400 trap from `CLAUDE.md` in its natural habitat — the emitting service logs nothing. Gotcha updated to say rebuild `analytics`, not just the emitter.

### Next session should pick up

1. **Set `TAVILY_API_KEY` on a networked host and run one real hunt.** Confirm Tavily's response shape matches `search/tavily.js`'s field mapping (`published_date`/`publishedDate`, and the positional `images[]` pairing, which is approximate by design). This is the one hop no test covers.
2. **Get an OpenRouter/Groq key with credit and exercise `interest/propose.js` for real** — including confirming that a genuinely hostile article body produces no candidate.
3. **Delete the deprecated shims.** `/api/ai/news*` and `/api/ai/interest-graph` in `services/ai/server.js`, then `student-news.js`, `interest-graph.js`, `interest-store.js` and their `ai_db` tables (which needs a migration). Note `test/graph.test.js` and `test/curation.test.js` compare against those files and skip cleanly once they are gone — that is intentional, but re-read them first.
4. The dev database holds a handful of `example.test` fixture articles from verification. They expire in 10 days; `delete from discover_db.discover_articles where url like '%example.test%';` clears them now.
5. `services/practice`'s frontend is **still** unrendered in a browser — unchanged by this session, still owed.

---

## Session — 2026-08-11 (mostly DONE): Complete frontend aesthetic rehaul — "Academic Premium" replaces Chroma Bloom + Liquid Glass

### Why

User asked for "a complete rehaul of the frontend aesthetics" using subagents — explicitly **not** an incremental refinement of the existing Chroma Bloom + Liquid Glass system. An earlier misread of the same request, earlier in this same session, produced exactly that incremental refinement first — a set of tighter internal rules for the existing system, called "Premium Evolved" (palette hierarchy, five named motion patterns, a weight-hierarchy table, six new invariants, plus five small CSS tweaks actually applied to `index.html`). The user corrected this directly ("i asked for a complete rehaul... run subagents"), and everything in this entry is the corrected, from-scratch work that followed — it fully supersedes the Premium Evolved layer (its DESIGN.md sections and CSS values have been overwritten by this session's edits, described below). A `Workflow` run generated 5 fully independent aesthetic directions from scratch (Minimal Geometric, Warm Organic, Dark Futuristic, Duolingo-Style Playful, Academic Premium), each with real palettes/type/motion specs and a self-critical risk assessment, plus a cross-persona (6yo / 18yo JEE aspirant / teacher-parent) fit analysis. Key finding: Duolingo-Style is a "5/5 → 1/5 cliff" across that age range and Academic Premium is close to the inverse. **Academic Premium was chosen** as the flagship direction — it optimizes for credibility with teachers/parents (who control adoption) and older exam-prep students, at some cost to warmth for younger children — over Minimal Geometric (safer but undifferentiated) and a two-track age-gated option (more correct but doubles the design/build surface).

A second `Workflow` run (5 agents: one file/token audit, four parallel CSS-spec writers for tokens/typography/surfaces/motion, one reconciliation pass resolving spec conflicts) produced a fully-ordered, unambiguous implementation checklist. That checklist under-audited the file in one respect — it found the `--lg-*` token definitions and ~86 `var(--lg-*)`/`backdrop-filter` call sites, but its line-by-line component specs only covered a subset of the actual hardcoded Chroma-Bloom-era literals (raw emerald-green hex/rgba like `#17c489`, `rgba(23,196,137,...)`, `#6fe6bd` appear ~40+ times outside the token layer, e.g. `.btn.primary`, `.seg-btn.active`, `.pill`, `.tile-icon`, dark-theme overrides, and two inline-SVG JS string literals). All of those were found and converted by hand during implementation, in addition to the checklist's items.

### What changed

**Palette:** Navy (`--ap-ink #1a2d47` light / `#f2ede4` dark) + Copper (`--ap-accent #c4965f` light / `#d3a874` dark) + Warm-grey + Off-white/deep-navy backgrounds. Full spec and token table in `frontend/DESIGN.md` §2/§2a (rewritten this session).

**Material:** Every `backdrop-filter`, the conic-gradient card-edge diffraction effect, and the four-bloom ambient `body::before` gradient field are removed. Surfaces are flat and opaque (`var(--ap-surface)` + 1px border + soft directional shadow). The `--lg-*` custom property **names** were kept and redefined (not deleted and hunted down at every call site) as a deliberate compatibility-shim strategy — see `frontend/DESIGN.md`'s "Academic Premium (current system)" intro for the reasoning.

**Typography:** Fraunces (serif, 700) loaded via Google Fonts, used on `h1` only (the sole selector reaching the 36pt+ hero floor — confirmed by grep before promoting it, so this isn't a guess). Source Sans 3 (not "Source Sans Pro" — that family is delisted from Google Fonts; caught by the spec-writing agent) for everything else. The old fractional variable-font weight scale (620–850, ~13 distinct values) is retired to three tokens: `--fw-regular`(400)/`--fw-medium`(600)/`--fw-display`(700). ~35 individual selectors had their literal `font-weight: NNN` mechanically remapped (script-verified line-by-line, not by hand-editing each one) — full mapping was in the workflow's checklist output, not reproduced here.

**Motion:** `--lg-spring`'s sampled overshoot curve and `--lg-ease`'s original curve are both redefined to a single plain decelerate `cubic-bezier(0,0,.2,1)`. Two duration buckets only: 300ms (buttons/controls) and 600ms (cards/panels/sheets), via `--ap-ease-fast`/`--ap-ease-slow`. One named exception kept: `.evidence > summary::after`'s chevron stays at its original `.2s`.

**Dashboard summary-card gradients** (the "exactly 4 cards, one nth-of-type hue map" invariant from `CLAUDE.md`/`DESIGN.md`) were reskinned to 4 new dark, muted gradients (rust/amber-brown/sage/plum) — **contrast against white text has not been instrument-measured**, only chosen to be visually dark enough; flagged in `DESIGN.md` §4 as unverified, same honesty standard the old system's contrast table held itself to.

### What's verified

- **CSS brace balance**: 719/719 (checked after every edit batch, not just once at the end).
- **JS syntax**: both inline `<script>` blocks parse via `new Function(...)`.
- **CRLF integrity**: CR count === line count (9620/9620) — confirmed intact after every edit; all edits used the Edit tool or a `newline=''`-safe Python pass for the bulk font-weight remap, never a plain `sed -i`.
- **Rendered and visually inspected** (static file server, no backend) at desktop and 375×812, both themes, on the **auth/sign-in screen only**: Fraunces headline, Source Sans 3 body, flat navy/copper/off-white surfaces, copper primary button with navy text all render correctly and legibly in both themes; no horizontal overflow (`document.body.scrollWidth === window.innerWidth` confirmed at 375px).

### What's NOT verified — do not claim otherwise

- **Only the auth screen was visually rendered.** The dashboard summary cards, tutor module tabs/gate-pulse, Discover feed, and every other authenticated screen were **not** rendered in a browser this session — the real backend wasn't running (no `docker compose up`), and an attempt to fake-inject dashboard/module-tab markup via JS into the live SPA was silently wiped by the app's own render loop rather than displaying. The CSS for those components was converted using the same token system already visually confirmed on the auth screen, which is reasonable evidence but **not the same as having seen them**.
- **No instrument-measured contrast check** on the new dashboard-card gradients, the copper-on-navy button text, or any other new color pairing — chosen by eye/reasoning, not measured. `DESIGN.md` §4 flags this explicitly.
- **Not tested in the iOS Simulator.** `DESIGN.md` invariants 9–11 (safe-area, iOS button-text-color, input zoom) only reproduce on a real touch keyboard/notched device — this session's verification was Browser-pane only.
- **`docker compose up` was never run this session.** The live multi-service stack, the demo stack, and the frontend's own `server.js` proxy were never exercised — only the static `index.html` file was served directly and inspected.
- **No functional/interaction testing** — no click-through of theme toggle, module tab switching, practice gate, quiz flow, or any JS-driven behavior. Only static rendering was checked.

### Next session should

1. Bring up the real stack (`docker compose up --build -d`) and click through: dashboard (all 4 roles' summary cards), tutor module rail + gate-pulse animation, Discover feed + interest graph, practice/quiz flow — in both themes, both viewport classes.
2. Run an actual contrast checker against the 4 new dashboard gradients and the copper/navy pairings, not eyeball them.
3. Verify in the iOS Simulator per `DESIGN.md`'s own testing protocol (invariants 9–11 don't reproduce in a desktop browser).
4. `frontend/DESIGN.md` has been fully rewritten for Academic Premium (§1–§10, invariants renumbered/rewritten). `design/CHROMA_BLOOM.md` and `design/LUCENT_STRATA.md` were **not** deleted — they're marked historical/superseded in `DESIGN.md`'s "Related" section, since they document a system that no longer matches the code but may still have value as design-philosophy history.

---

## Session — 2026-08-10 (superseded by the 2026-08-11 entry above for the aesthetic-system parts; the `services/practice` work below is unaffected and still current): Instant practice content — new `services/practice` microservice, now verified end-to-end against a real running stack

**Continuation of the 2026-08-08 session** (that entry's content is folded into this one). All 20 tasks are now complete, including a real `docker compose up` run and a full API-level end-to-end proof against real Groq/OpenRouter calls. Browser-UI visual verification (ribbon pulsing, CSS gate greying, flashcard flip) is the one thing still **not** done — see "What's not done" at the bottom.

### Why

User shared a demo video of GPAI's "AI Note" feature (multi-source upload → batch Summary/Quiz/Flashcard generation → workspace with a whole-project chat). Scoped down for Roognis to: content generation grounded in teacher-managed chapters only (no student uploads, no multi-source workspace, no agentic file tools), generating Summary+Quiz+Flashcard together, instantly, with results feeding the tutor's personalization prompt.

### Two deliberate rule reversals — both explicitly requested twice by the product owner, both already recorded in `CLAUDE.md`

1. **No teacher-approval gate, ever**, for this content. This reopens `CLAUDE.md`'s "Known Live Risks" #2 ("LLM-generated quizzes reach students with no human approval"), previously marked Resolved. I raised the exact mechanism of harm (`gradeQuizAttempt` mints a `weakAreaLabel` from every wrong answer; an unreviewed question can mark a correct student wrong *and* manufacture a fake weakness that then shapes automation) and the DPDP/minors coercive-UX concern about a "cannot be dismissed" popup. The user confirmed the gate bypass twice after hearing this, and on the UX point specifically softened "won't recede" to "grey out the tutor ribbon only, bottom app nav stays usable" — that's what got built.
2. **Shipped as a standalone 7th service** (`services/practice`), exceeding `MASTERCONTEXT.md` §6's cap of 4 sanctioned new services (`kg`/`psv`/`decisions`/`privacy`). The user explicitly chose this over colocating in `services/ai` (which is what the visuals feature did) after being told it breaches §6, accepting the cost: `services/practice` cannot import from `services/ai` (no monorepo tooling anywhere in this repo), so it carries its own duplicated `structured-llm.js` (**copy #5** of provider selection, on top of the four already named in that file's own header comment), a trimmed `grounding.js`, and a trimmed `safety.js`.

Full architectural writeup is in `CLAUDE.md`'s "Instant practice content" paragraph (under Cross-service flows) and "Known live risks" #3.

### What's built (all 20 tasks — table below has each module's original static-check evidence; see "Full API-level end-to-end proof" further down for what's now verified against the real running stack)

| # | What | Verified how |
|---|---|---|
| Scaffold | `services/practice/{package.json,Dockerfile,load-env.js,middleware/{auth,internal-token}.js,lib/prisma.js}` | Copied verbatim from `services/quiz`'s equivalents; `node --check` on every file |
| Schema+migration | `PracticeSet`/`PracticeAttempt`/`PracticeSetStatus` in `services/practice/prisma/schema.prisma`, schema `practice_db`; migration `20260808090000_init` | Hand-written SQL verified byte-identical against `npx prisma@5.14.0 migrate diff --from-empty --to-schema-datamodel` output |
| Duplicated modules | `structured-llm.js`, `grounding.js` (renamed `PRACTICE_CHUNK_PREFERENCE`, dropped `conceptSlugFor` — no per-topic slugging needed, caching is per-chapter only), `safety.js` (trimmed to `validateGeneratedTextSafety` + the chat rule set only — no image/student-prompt/Gemini paths needed) | `node --check`; not yet exercised against a real provider call |
| Generation | `schema.js` (shape-only JSON Schema for `{summary, flashcards[], quiz[]}`), `validate.js` (`PRACTICE_LIMITS`, MCQ-only bounds incl. weak-option rejection, citation-membership rejection not repair, server-assigns `f1/f2…`/`q1/q2…` ids — never LLM-supplied), `generate.js` (prompts + `generatePracticeSet`), `scoring.js` (MCQ exact-match only, explicitly **not** duplicating `services/quiz/lib/scoring.js`'s fuzzy short-answer matcher), `student-learning.js` (aggregation, simplified vs quiz's version: no subject/chapter scoping since `PracticeSet` only stores a hashed `chapterKey`, not raw identity columns) | `node --check` only — **no unit tests written yet** (task 19) |
| Routes | `POST/GET /api/practice`, `GET /api/practice/:setId`, `POST /api/practice/:setId/attempt`, `GET /api/practice/internal/student-learning-context`, `runPracticeJobInBackground`/`processPracticeJob` mirroring the visuals job pattern exactly | `node --check` only — **never run**, no DB, no real LLM call made |
| Cross-service wiring | `services/ai/practice-learning-context.js` (mirrors `quiz-learning-context.js`); `services/ai/server.js` wired: `PRACTICE_SERVICE_URL`, `loadStudentPracticeLearningContext`, added to the chat handler's `Promise.all`, `buildTutorPrompt` now concatenates quiz-derived + practice-derived context into `academicPersonalizationContext` | `node --check`; confirmed `services/ai/server.js` stayed pure LF (0 CR) |
| Analytics | `practice_generated`/`practice_completed` added to `KNOWN_EVENT_TYPES` (`services/analytics/lib/validation.js`) and `LEARNING_EVENT_TYPES` (`dashboard.js`); `event-types.test.js`'s `EMITTER_SOURCES` extended with `practice/server.js`; new dashboard test "rolls up weak areas from instant-practice completions alongside gated-quiz grading" | **`npm test --prefix services/analytics` run: 10/10 passing**, including both new/extended tests — this is the one piece with real automated proof |
| Deployment | `docker-compose.yml`/`.production.yml`/`.demo.yml` all get a `practice` service block; `kubernetes/practice/{deployment,service}.yaml` + `kustomization.yaml` + `ingress.yaml`; `.env.example`/`.env.production.example` get `OPENROUTER_PRACTICE_MODEL`; `CLAUDE.md` services table gets a `practice` row | `docker compose config` validated clean for all three compose combinations (base, +production, +demo); k8s YAML parsed clean with `python3 -c "import yaml"` |
| Frontend | New `data-pane="practice"` ribbon button (labelled "Quiz") in `#tutor-module-bar`; `#pane-practice` markup (summary + flashcard flip UI + MCQ quiz form); `.pp-*` CSS (token colours only) + `.module-tab.disabled`/`.pulse` + `@keyframes lg-tab-pulse` (respects `prefers-reduced-motion`); `state.practiceGateActive`/`practiceSetId`/`practiceSetLessonKey`/`practiceFlashcards*`/`practiceQuizQuestions`; `applyPracticeGate()`/`clearPracticeGate()` (scoped to `#tutor-module-bar` only, bottom app nav untouched — deliberate); `maybeApplyPracticeGate()` (pre-warms at turn 1, hard-gates at `PRACTICE_GATE_TURN_THRESHOLD=3`, replacing the deleted `maybeShowQuizNudge` dismissable-banner mechanism and its `#quiz-nudge` markup, since a hard gate and a dismissable suggestion on the same trigger would contradict each other); `refreshPracticeGateForLesson()` (re-derives gate state from the server on every lesson open, so a page refresh mid-gate doesn't lose the lock); `loadPracticeSet`/`renderPracticeSet`/flashcard nav/`renderPracticeQuizForm`/`submitPracticeAttempt`/`renderPracticeResult` | CRLF preserved (CR count === line count, checked after every single edit, ended at 9662/9662); both inline `<script>` blocks parse via `new Function`; CSS braces balanced 731/731; every new `#practice-*` id referenced in JS confirmed present exactly once in markup. **Never opened in a browser. Never run against a live stack.** |

### Corrections to earlier framing

- The Explore agent that researched the quiz pipeline this session made an incorrect aside claiming `web/` (not `frontend/`) is "the real SPA" — this is exactly the "two-frontends trap" `CLAUDE.md` already documents and is wrong; disregarded, `frontend/index.html` is confirmed correct and is what got edited.

### Unit tests written and passing

`test/validate.test.js` (18 tests), `test/scoring.test.js` (10 tests), `test/student-learning.test.js` (9 tests) — **37/37 passing**. Full-suite re-run confirmed no regressions: `services/ai` 155/155, `services/quiz` 36/36, `services/analytics` 29/30 (the one failure is the pre-existing, already-documented `Cannot find module 'express'` gap in `app.test.js` — needs `npm install`, unrelated to this work).

### A real bug found and fixed by actually running the stack

`docker compose up --build -d` initially left `practice` **crash-looping**. Root cause: **I never generated a `services/practice/package-lock.json`.** The Dockerfile's `RUN [ -f package.json ] && npm ci || true` silently swallowed the resulting `npm ci` failure (no lockfile → `npm ci` refuses to run), so the container booted with no `node_modules` at all (`Cannot find module 'express'`), which in turn made `npx prisma` fall back to whatever latest Prisma version npx could fetch (7.9.1) instead of the pinned 5.14.0 — and Prisma 7 rejects the inline `datasource.url` schema format every other service in this repo still uses, throwing a second, unrelated-looking error. **Fixed** by running `npm install` inside `services/practice` to generate a proper lockfile (resolved `prisma@5.22.0`, within the `^5.14.0` range and schema-compatible). Rebuilt; `practice` came up healthy, migrated its schema (`db push`), and started listening on :3007. **Lesson for future new-service scaffolding: always run `npm install` locally before the first `docker compose up --build`, or the `|| true` in every service's Dockerfile will hide a missing lockfile as a much more confusing downstream error.**

### Full API-level end-to-end proof (real stack, real LLM calls, no mocks)

Browser-based UI verification was blocked by a **sandbox networking limitation**: the Browser-pane tool could not reach `http://localhost/` in this environment at all (confirmed — zero requests arrived in `auth`/`traefik` container logs despite the browser showing pending/504 network entries), while `curl` from the Bash tool (sharing the host's real network) worked instantly. This is a tooling/environment limitation, not an application bug — `127.0.0.1` was tried too and behaved identically. Given that, verification was done via `curl` against the live stack instead, which is actually a *stronger* proof of the backend pipeline than a browser click would have been:

1. Logged in as `arjun@demo.com` via `POST /api/auth/login`, got a real session cookie.
2. Listed real ingested chapters via `GET /api/rag/documents?status=ready` (27 chapters present from a persisted volume).
3. `POST /api/practice` with a real `documentId` → `202 {practiceSetId, status:'queued'}`.
4. First attempt hit **OpenRouter with a real "402 Insufficient credits" account error** (a billing issue on the configured key, not a code defect) — confirmed the failure path works exactly as designed: `status` → `failed`, student-facing `failureReason` is the safe generic message ("Practice content could not be generated. Please try again later.") with **zero leakage** of the provider name, the 402, or the credits URL; the raw error was correctly confined to the server-side `console.warn` log.
5. Temporarily forced the Groq fallback (`OPENROUTER_API_KEY="" docker compose up -d --force-recreate practice`, since `GROQ_API_KEY` is also configured) and retried against a different chapter ("Microorganisms: Friend and Foe") — **this time generation succeeded for real**: a valid schema-conforming summary + 4 flashcards + 4 MCQ questions, all within `PRACTICE_LIMITS`, persisted correctly, with real chapter-grounded provenance excerpts.
6. `GET /api/practice/:setId` correctly **withheld `correctAnswer`/`explanation`** from the quiz payload (only `id`/`prompt`/`options` reached the client) — the answer-key-hiding design works.
7. `POST /api/practice/:setId/attempt` with a full set of answers → **exact-match MCQ grading worked correctly** (4/4, 100%, `weakAreas: []`, `complete: true`), and the post-submission response correctly revealed `correctAnswer`/`explanation`/`conceptTag` per question.
8. `GET /api/practice/internal/student-learning-context` (the cross-service route `services/ai` calls) returned the correct aggregate (`attemptCount:1, averageScorePercent:100, weakAreas:[]`) for the internal-token-authenticated caller.
9. `GET /api/analytics/student/dashboard` showed **both `practice_generated` and `practice_completed` in `recentActivity` and `usageSummary.byType`**, correctly attributed to the right subject — the analytics pipeline works end-to-end against a real running stack, not just the unit-test event-list assertions.
10. Restored `practice` to its normal `.env`-driven config afterward (plain `docker compose up -d practice`, no override) — confirmed healthy again.

This is about as complete a proof as this feature can get without a working browser: every hop (route → auth → grounding → cache → background job → provider resolution → real LLM call → validation → persistence → answer-key timing → grading → cross-service read → analytics dashboard) has now actually executed successfully at least once, against real infrastructure, with one real induced failure (OpenRouter billing) handled correctly.

### What's not done

- **Browser/visual verification of the frontend** (Quiz tab appearing and pulsing, sibling tabs greying out, flashcard flip UI, both themes, 375×812 vs desktop) — blocked by the sandbox networking issue above, not attempted via any other means. The backend contract the frontend relies on (`GET/POST /api/practice*` shapes) is now proven correct for real, which meaningfully de-risks this, but the actual DOM/CSS/JS wiring in `frontend/index.html` has only ever been statically checked (parses, ids exist, CRLF intact), never rendered.
- If the next session has working browser access (or the user can check manually), that visual pass is the only remaining item before this feature is fully closed out.

---

## Session — 2026-08-07: Generated educational visuals — concept maps as inert SVG

### Why

The Diagrams pane was the weakest surface in the product. `POST /api/ai/image` drives Gemini image generation or a hardcoded 7-node **Stable Diffusion 1.5** ComfyUI workflow at 512×512, and diffusion models cannot render legible text. The input's own default value — "photosynthesis process diagram for grade 6" — produces garbled pseudo-labels. For anything *diagrammatic* (labelled parts, flow, axes) raster generation is simply the wrong tool, and no prompt tuning fixes it.

Asked for four kinds of generated visual (diagrams, flowcharts, graphs, interactive HTML explainers) inspired by GPAi-style STEM apps. This session shipped **step 1 of 6: concept maps**, which generalise to every subject including History.

### The governing decision

**The LLM never authors SVG and never authors geometry.** It emits a bounded JSON spec; a deterministic pipeline lays it out and renders it. Consequences: no model coordinate arithmetic (a hand-written path for `y = x²` is wrong); no XML sanitizer or parser dependency in a service carrying four deps; theming is free via CSS-class-bound tokens; and output is byte-identical per spec, which the cache assumes. `interestGraphMarkup` in `frontend/index.html` is the same pattern and predates this.

A finding worth carrying forward: **a free-coordinate scene spec does not fix labelled pictorial diagrams.** The model still places the coordinates — the spec only makes the output *safe*, not *correct*. Overlapping organelles and connectors ending in whitespace survive, and no deterministic validator catches "geometrically legal but visually nonsense". Hence the planned approach for step 5: hand-authored templates where the renderer owns the picture and the model supplies only label text, with an honest concept-map fallback when no template matches.

### Approval gate: deliberately none

Requested explicitly: "remove the teacher approval, keep it plain — ask and you shall receive." That is defensible and consistent — tutor chat text can be flatly wrong and ships ungated, and a visual writes no learner state, so the quiz gate's rationale (a bad answer key corrupts measurement via `weakAreaLabel`) does not transfer.

Two structural choices are what make it safe, and they are load-bearing rather than incidental:

- **Nothing fans out.** The cache is keyed on `studentId`, so it is a same-student dedupe and one student's artifact is never served to a classmate. Fan-out is what a reviewer would have controlled; with no reviewer, there is no fan-out.
- **The future executable tier fails closed.** When interactive explainers land (step 6), the sandbox + CSP + static scan are the *only* control, not a layer beside a human — so a scan failure must mark the artifact `failed` and render nothing.

**If school-wide sharing is ever added, it needs a human gate in the same change.** Sharing and review are one decision, not two.

### Built and verified

| | What | Verification |
|---|---|---|
| 1 | **`services/ai/structured-llm.js`** — generic structured-output seam. OpenRouter strict `json_schema` → Groq `json_object` + schema-in-prompt, per-provider env prefix, and the self-correcting retry that feeds the validator's own message back as the correction turn. | 17 tests. Asserts on captured request bodies that attempt 2 carries the validator message verbatim as a third message. |
| 2 | **`visuals/intent.js`** — deterministic kind routing, no LLM. | 9 tests. Deliberately under-eager: "what is the relationship between force and friction" and "I saw a concept map in class" must **not** route — the `isVideoRequest` lesson with a new noun. |
| 3 | **`visuals/graph-layout.js`** — cycle removal (DFS, input order), Kahn longest-path layering, two median-ordering sweeps, orthogonal 3-segment edges, greedy word wrap. | 20 tests: exact layer assignments, deterministic choice of which cycle edge reverses, zero box overlaps, every edge endpoint on a node boundary, every channel inside its gap, byte-identical re-render. |
| 4 | **`visuals/render-svg.js`** — the only markup emitter. | 16 tests: a `</svg><script>alert(1)</script>` label survives escaped with no live tag; **`/#[0-9a-f]{3,6}/` never matches** (a test for DESIGN §2); ids namespaced `rv-{artifactId}-`; two artifacts share no id; no external reference, no `on*` handler. |
| 5 | **`visuals/spec-validate.js`** — every bound, because OpenAI strict mode ignores `minItems`/`maxItems`/`minimum`/`pattern`. | 18 tests, each asserting the *message text* — it is the retry prompt, so "nodes must contain 3 to 20 entries, got 41" is the product, not "invalid nodes". |
| 6 | **`VisualArtifact` + migration.** Stores the **spec, not the SVG**: small, diffable, and a renderer fix applies retroactively. No `file_storage` write, no bytes, no static route. | `prisma validate` clean; hand-written migration diffed against `prisma migrate diff --from-empty` output — **identical** (column types, order, defaults, constraint and all three index names). |
| 7 | **Three routes**, plus `processVisualJob` mirroring the image job's atomic claim. Safety uses `validateStudentMessageSafety`, **not** the image rules — those block `person\|child\|face\|realistic` to stop diffusion rendering a child, and would reject "diagram of blood circulation in a person". | 155/155 `services/ai` tests (was 75). |
| 8 | **`visual_generated`** event + three dashboard consumers. | `event-types.test.js` 4/4 including "every allowlisted type has a producer" — proving the scanner found the single-quoted literal in `server.js`. New dashboard test asserts both counters move. |
| 9 | **Frontend**: `.seg-2` kind selector (Concept map / Picture), `#visual-canvas`, text-alternative `<details>`, recent-visuals list, 20×1500ms poller, `.rv-*` CSS bound to tokens, `diagrams` load hook. | CRLF intact 9306/9306; both inline scripts parse; 715/715 braces; every `querySelector('#id')` resolves. **Rendered in a browser in both themes** — see below. |
| 10 | **`state.tutorPane` added** to the state literal. It was absent (only `teacherPane`), so every read was `state.tutorPane \|\| 'learn'`. | One line; it is the router this whole feature depends on. |

**Rendered and inspected, not just asserted.** Built an 8-node Class-8 photosynthesis map (including a cycle and a wrapping label) and viewed it in a browser against the real Chroma Bloom tokens in both themes. Layering, wrapping and arrow direction were all correct. One real defect only visible this way: **edge labels sat directly on the channel lines with no knockout**, muddying "makes"/"with"/"fuels". Fixed with a `paint-order: stroke fill` halo in `var(--surface)` — no extra elements, token-only.

### Corrections to earlier claims

- **`#tutor-module-bar` is not missing.** It exists at `frontend/index.html:~3771` with `data-pane` tabs, `syncTutorModuleTabs` is implemented and the delegated handler is live. An exploration agent reported it absent; that was wrong and was caught before anything was built on it.
- **`StudentNewsArticle.topics`/`entities` do have a migration** (`20260730120000_interest_graph`). No drift there.
- **`frontend/index.html` line numbers drift fast** — three reads during one session reported 8900 / 8915 / 9123. Locate by symbol, never by line.

### Not done / known

- **Never run against a live stack.** No `node_modules` in this working copy and Docker was not brought up, so the routes, the migration and the RAG round-trip are statically verified only. `generateConceptMapSpec` has **not** made a real provider call. First run: bring up the demo stack, open a chapter in Learn, then generate from the Diagrams pane.
- **`structured-llm.js` is copy #4 of provider selection**, worsening the debt already logged below. The file carries a comment naming `resolveQuizProvider` (`quiz-draft.js`), `streamLlmResponse` (`server.js`) and the ternary at the quiz-draft route. Migrating them is its own unit — deliberately not done inside a feature change touching demo-critical quiz generation.
- **Steps 2–6 not built**: flowcharts, chat attachment (`visual_pending` SSE), plots (`dataPoints[]` first, then a tokenizer/shunting-yard evaluator — never `eval` on model output), template diagrams, interactive explainers.
- **A concept map needs a chapter with a real uploaded document.** Lesson keys fall back to a synthetic `subject-grade-chapter` composite when there is no `documentId`; the client now says so plainly rather than letting the server answer 400. The 27 originally-seeded NCERT documents still have no backing PDF, so those chapters cannot ground a visual.
- **Output quality is capped by ingestion.** Chapters whose PDFs extracted badly ("The Rise of the Marathas") will ground thinly. That is an ingestion problem, not a visuals one.
- `parseSseChunk` will reach six positional callbacks when the chat attachment lands (step 3); converting it to a handlers object is its own unit.

### Test suites

`services/ai` 155/155 (was 75) · `services/quiz` 36/36 · `services/auth` 6/6 · `services/analytics` 28/29 · `seed-data/demo-history` 69/69 — **294 passing, up from 213**. The single analytics failure is `tests/app.test.js` needing `express`; it fails identically on a clean tree. Frontend: CRLF preserved, both inline scripts parse, CSS braces balanced.

---

## Session — 2026-08-05: Chat history made visible, durable and extractable

### Why

Opening the demo as `arjun@demo.com` showed **no chat history at all**, despite 23 sessions and 114 messages sitting in the database. There was also no way for anything else in the system to use that conversation data.

### The gap was three separate problems

1. **The history was invisible for two stacked reasons.** `services/ai/scripts/seed-demo-history.js` wrote `ChatSession` rows with `board` and `curriculum` **NULL**. `GET /api/ai/chat/sessions` turns those query params into hard Prisma equality filters and the frontend always sends them, so **every seeded session was dropped in SQL** before any client-side matching ran. Underneath that, `plan.json` hardcoded chapter names (`"Synthetic Fibres and Plastics"`) that no longer exist in the ingested corpus (`"Coal and Petroleum"`), so `chatSessionMatchesLesson` discarded whatever survived.
2. **The UI was unreachable** — one right-rail panel, scoped to a single chapter, only after drilling subject → chapter, and it collapses below the fold under 1100px.
3. **No extraction surface** — nothing outside a student's own request could read `chat_sessions`/`messages`.

### Built and verified live

| | What | Verification |
|---|---|---|
| 1 | **`board`/`curriculum` now written**, and the upsert's `update` branch widened to rewrite the whole lesson context. Session ids encode no chapter, so a narrowed update left stale chapter names on ids that still resolved. | 0 rows with a null context. The exact chapter-scoped query that returned **0** now returns **11**. |
| 2 | **The fixture no longer names chapters.** Personas declare `chapterIntent` (preferred subjects, how many chapters); real chapters come from `GET /api/rag/internal/chapters` at seed time. Selection is **rendezvous-hashed**, so uploading one more PDF does not reshuffle every student. | Bound to all 27 ingested chapters. Test asserts one new upload displaces at most one pick. |
| 3 | **Conversation text is LLM-written from each chapter's own retrieved chunks** (`chapter-qa-llm.js`; OpenRouter → Groq chain, `LLM_PROVIDER` picks first). A rendering step only — no decision path, no learner-state write. Falls back to deterministic templating with no key. | Groq rendered all four bound chapters. Verified the fallback fires correctly when OpenRouter answered 402. |
| 4 | **Global "All chats" bottom sheet** (reusing `openGlassSheet`) plus an **in-chat `<details>` disclosure** above the thread, because the rail drops below the fold on mobile. | 23 sessions in the sheet across 2 chapter groups at 375×812; opening one replays the thread and re-attaches the lesson. |
| 5 | **`GET /api/ai/internal/chat-insights`** — deterministic topic/entity/chapter rollups over a student's questions, reusing `interest-graph.js`'s matchers. Guarded by a **new strict `requireInternalService`** (token only). | 200 with the token; **403 without it and 403 with a teacher JWT** — the `services/privacy` gate holds. |
| 6 | `GET /api/ai/chat/sessions` gained a `limit` (default 20, max 100). Arjun has 23; the old hard `.slice(0, 20)` silently truncated. | 23 returned. |

**Bugs found while verifying, both real:**

- The assistant-message upsert's `update` branch omitted `createdAt`, so a re-seed moved user messages to new timestamps while their answers kept old ones — **every thread interleaved wrongly**, replies before questions. Fixed and re-verified.
- Opening a session from the sheet re-attached the lesson but never loaded that chapter's list, leaving the rail and disclosure empty beside a populated thread. Fixed.
- The disclosure rendered **white-on-white in dark theme** (hardcoded `#ffffff`). Now joins the existing shared dark-surface and light-glass selector lists instead of inventing a background.

### Cross-seeder agreement still holds

Chapter *selection* depends only on `/chapters` — never on whether text rendering used the LLM — so a seeder with an API key and one without cannot disagree. Each writes a `chapterSetFingerprint`; all three logged `9b370e8cc0058d38`, and **167 `chat_message` events == 167 user messages** exactly.

### Not done / known

- **Demo conversation quality is uneven, and it is a source-data limit.** The EKE extractor produced **2680 `Concept` entities against 58 definitions and 87 questions** across the 27 chapters, and `Concept` titles are `first_phrase()` of arbitrary blocks (`"Reprint 2026-27"`, `"Their formidable navy resisted European naval supremacy"`). `Concept` is now excluded outright. Chapters whose PDF extracted badly — "The Rise of the Marathas" especially — still read thin even LLM-rendered, because the chunks themselves are OCR-mangled. Improving this means improving ingestion, not the seeder.
- **`--purge` on the AI/analytics seeders was reworked** to run off the fixture's personas alone so it still works when RAG is down. Not exercised this session.
- **The quiz seeder still skips**: no approved quiz exists for the demo school, so weak-area cards stay empty. Unchanged, pre-existing. `resolveQuizForChapter` was added so attempts will bind to the right chapter's quiz once one exists — **untested**, since nothing exercised it.
- **`/api/*/internal/*` is reachable through Traefik.** Traefik routes on the service prefix, not the full path, so `INTERNAL_SERVICE_TOKEN` is the only thing in front of these routes — contrary to CLAUDE.md's "never expose one through Traefik". Verified `chat-insights` answers 403 from the public port, so it is safe, but the assumption in that doc was wrong and is now corrected.
- **Pre-existing mobile overflow, not from this change**: `#tutor-module-bar` is a full-bleed `margin: 0 -16px` scroll rail that overhangs by 4px at 375px, so `document.documentElement.scrollWidth !== clientWidth` on the tutor screen. Proved pre-existing by removing this session's elements (overhang stays 4px) versus removing the bar (drops to 0). Zero at desktop widths. Left alone — `DESIGN.md` governs that rail.
- **Message text is no longer byte-reproducible.** Ids and counts still are; the LLM makes prose vary run to run. CLAUDE.md updated to say so.

### Test suites

`seed-data/demo-history` 69/69 · `services/ai` 75/75 · `services/quiz` 36/36 · `services/auth` 6/6 · `services/analytics` 27/28 — **213 passing**. The one analytics failure is `tests/app.test.js` needing `express` installed; it fails identically on a clean tree. Frontend inline scripts parse, CSS braces balance, CRLF preserved.

---

## Session — 2026-08-04: Demo data engine, and a 20-service proposal cut down to size

### Why

Two asks: demo student accounts had no history, so every dashboard read zero and Discover was generic; and a 20-service "intelligence engine" architecture was proposed for build.

### The 20 services, checked against the governing docs

The proposal collapses. Verified against `MASTERCONTEXT.md` §6/§7/§12 and `ARCHITECTUREDesign.md` §10/§11/§13:

| Proposed | Reality |
|---|---|
| `rag_service`, `analytics_engine`, `embedding_service`, `event_store` | **Already exist** — `services/rag` (8 endpoints), `services/analytics` (11), embeddings inside RAG, `analytics_db.events` |
| `model_router`, `llm_gateway`, `context_builder` | **Consolidations of existing `services/ai` code**, not new services |
| `curriculum_graph`, `concept_graph`, `prerequisite_engine`, `graph_api` | → one service, `services/kg`. **Gated** |
| `student_state`, `state_schema`, `checkpoint`, `state_extractor` | → one service, `services/psv`. **Gated** |
| `learning_planner`, `socratic_planner` | → `services/decisions`. **Gated** |
| `teacher_agent`, `parent_agent`, `student_agent` | Layer 5, behind `services/privacy` |
| *(not proposed)* | **`services/privacy`** — the thing that gates three of the above |

The docs sanction exactly four new services and no others, and CLAUDE.md:146 says `psv`/`decisions` are "explicitly not to be written yet" because Layer 0 contracts are unfrozen. **Nothing in the 20 was buildable as named.** Agreed sequencing: ship the ungated demo work first, then freeze the four Layer 0 contracts, which unblocks nine of the twenty properly.

### Overrides on record

1. **LLM-driven decisions** in `learning_planner`, `socratic_planner` and the three agents, and **`state_extractor` writing learner state from LLM output**. The user accepted this explicitly. It breaks `MASTERCONTEXT.md` §7.1, §7.2 and §12 bullet 1, and the CLAUDE.md litmus test. Agreed containment when built: an LLM proposes, a deterministic ratifier records `event_ids[]`/`gate_version`/`model_version` plus the raw proposal and owns the write, so decisions stay auditable and reversible. **Not yet built** — these are all gated behind Layer 0 anyway.
2. **Held, not overridden:** `services/privacy` still precedes `teacher_agent`/`parent_agent`. That gate is DPDP Act 2023 exposure of minors' data — legal, not architectural.

### Built and verified

| | What | Verification |
|---|---|---|
| 1 | **Event allowlist corrected.** `student_onboarding_completed` was emitted at a real committed transaction but absent from `KNOWN_EVENT_TYPES`, so every one was 400'd and silently dropped. Added. Added emitters for `lesson_started` (chapter session creation) and `video_opened` (new telemetry route). **Removed** `video_completed` and `lesson_completed` — neither is observable (videos link to search pages with no player; there is no lesson-completion state), yet both were consumed by the dashboard, so those counters could never move. | New `services/analytics/tests/event-types.test.js` asserts both directions. It immediately earned its place by catching a gap in its own scanner: the safety events emit via a positional-arg helper, not a `type:` literal. |
| 2 | **Demo environment on a separate database.** `docker-compose.demo.yml` repoints the whole stack at `roognis_demo`. Traefik moves to `:8080` via `!override` (compose *appends* to `ports`, so a plain override would still bind `:80` and collide). | `docker compose -p roognis-demo -f ... config` resolves; base and production stacks confirmed unchanged. |
| 3 | **Deterministic id derivation** (UUIDv5 over a fixed demo namespace, `seed-data/demo-history/lib/`). This is what lets three seeders in three services agree on ids with no coordination channel, makes every write an idempotent upsert, and makes teardown exact. | 17 tests, including the **RFC 4122 test vector** so the implementation is provably correct rather than merely self-consistent. |
| 4 | **Three one-shot seeders**, one per owning schema — `services/{ai,quiz,analytics}/scripts/seed-demo-history.js`. Chat/onboarding/Discover, quiz attempts, and events respectively. | Fixture expands to 437 events, under the 450 budget, asserted at build time. |
| 5 | **Cross-service coherence.** Attempts are graded by the real `gradeQuizAttempt`, so an attempt's `weakAreas` and the `quiz_submitted` event's `weakAreas` are one computation. Events re-derive `sessionId` rather than being handed it. Analytics pulls real weak areas from the quiz service's existing internal endpoint. | Verified score targeting: 88/55/43% targets land at 80/50/40% on a 10-question quiz (correct — that is the real mark granularity) with weak areas from genuinely wrong answers. |
| 6 | **Four production locks.** Flag must be `"true"`; `DEMO_SCHOOL_ID` required and every write scoped to it; production compose hardcodes `"false"` as a literal; and **every target account must still authenticate with the demo password**, so this cannot write onto a real child's account even if the other three were misconfigured. | Confirmed the lock survives `SEED_DEMO_HISTORY=true` in the environment, and that no seeder job exists in production compose at all. |

**Constraints the fixture was written against, all read out of the consuming code** rather than guessed: the `take: 500` cap (over it, the *oldest* events vanish from 30-day aggregates); UTC-day bucketing for the streak (every event pinned to 12:00Z); `study_time_tracked` being the only source of time-spent (`chat_message` contributes none); `practiceProgressPercent` reading the 7-day slice only; and the 3-session floor below which the intervention rule flags every student. Personas differentiate deliberately — Rahul seeds at 1.88 avg rating and 43-56% so the intervention queue is selective rather than uniformly red or green.

### Test suites

`services/ai` 66/66 · `services/quiz` 36/36 · `services/auth` 6/6 · `services/analytics` 27/27 · `seed-data/demo-history` 17/17 — **152 passing**. Frontend inline scripts parse; no bare LF introduced into any CRLF file.

**Note:** `services/ai/server.js` is **LF**, not CRLF — CLAUDE.md's gotcha list is stale on that specific file. `frontend/index.html`, `docker-compose.yml` and `docker-compose.production.yml` are still CRLF and were patched line-wise.

### Not done — picked up next

- **Not run end to end.** No `node_modules` in this working copy and the stack was not brought up, so the seeders are statically verified (syntax, imports resolve, schema fields checked against `schema.prisma`, pure logic unit-tested) but have **not** executed against a live database. First run should be `docker compose -p roognis-demo -f docker-compose.yml -f docker-compose.demo.yml up -d --build`, then check the teacher dashboard, `GET /api/ai/news` for `personalised: true`, and that a weak area drills down to a real attempt.
- **Quiz slice needs real PDFs.** The 27 seeded NCERT documents still have no backing files, so no quiz can generate against them and the quiz seeder will skip (cleanly) until 2-3 chapters are re-uploaded. Weak-area and active-quiz cards stay empty until then.
- **LLM provider consolidation not done.** Provider selection is still written three times — `resolveQuizProvider` (`services/ai/quiz-draft.js:245`, has fallback), `streamLlmResponse` (`services/ai/server.js`, plain if/else, **no fallback**), and a duplicate ternary before the quiz-draft call. Live consequence: if the chat provider rate-limits mid-demo, quiz drafting survives and **tutor chat dies**. Deliberately deferred rather than rushed into a demo-critical path at the end of a long session.
- **`buildTutorPrompt` extraction not done** — low direct value, creates the Layer 4 seam.
- **Layer 0 contracts not started** — the four documents in `docs/contracts/`. This is the item that unblocks nine of the twenty proposals.

---

## Session — 2026-08-04: Tech-debt audit — and three of its own findings retracted

### Why

A `/code-review max` pass followed by a tech-debt audit (three parallel Explore agents: code, architecture, test/docs). Full plan: `~/.claude/plans/identify-all-the-shortcomings-sunny-swan.md`. The agents produced 16 findings; **verifying them against the code before acting retracted several**, which is the main lesson of this session — the audit output was less trustworthy than the codebase.

### Findings that were wrong, and are now retracted

| Claim | Reality |
|---|---|
| "Interest tables have no migration; production `migrate deploy` will fail." | **False.** `services/ai/prisma/migrations/20260730120000_interest_graph/` exists and creates all four tables. This was stale text in CLAUDE.md's own "Known live risks", repeated back by the agents and by the code review. CLAUDE.md risk #1 now corrected. |
| "`docker-compose.production.yml` is missing healthchecks for auth and rag." | **False.** Production compose is an *override*, applied as `-f docker-compose.yml -f docker-compose.production.yml`. Both services inherit healthchecks from the base file. A speculative `start_period` edit was made and then **reverted**. |
| "Approve button flickers / leaves stale state / misreports failures." | **Overstated.** `loadTeacherQuizzes` and `loadTeacherQuizPreview` both catch internally and never re-throw, and `disabled` already blocks double-clicks. No correctness bug. Only the sequential-await latency was real. |
| "`docker-compose.production.yml` has no `web` service, so `/classroom` is unreachable." | **Half true, restated.** `web` *is* inherited from the base file when layered. The real defect is that its labels carry only `entrypoints=web` with no `tls`/`certresolver`, so it is served on `:80` and never `:443`. `web/` is also untracked in git. CLAUDE.md risk #3 rewritten. |

### Fixed and verified

| | Defect | Fix | Verification |
|---|---|---|---|
| 1 | `kubernetes/auth/deployment.yaml` ran `scripts/seed.js` as the container command and `server.js` as a `postStart` hook. Seed exits → PID 1 exits → **CrashLoopBackOff**; the server was never the main process and `postStart` does not gate readiness. | Seed moved to an `initContainer`; `node server.js` is now the container command. `--accept-data-loss` also dropped from the migrate initContainer so schema drift fails loudly instead of dropping columns (matches the analytics convention). | `kubectl kustomize kubernetes/` builds; no `lifecycle`/`postStart` remains outside comments. |
| 2 | `apiJson` (`frontend/index.html`) used bare `fetch` with **no timeout** — a stalled request left the triggering button disabled indefinitely. | `AbortController` with a 30s default, overridable per call via `options.timeoutMs`. Aborts surface as `ApiError` with `status: 0`, preserving the existing `!error.status → show Offline` branch at every call site. | Executed against a deliberately hanging fetch: threw `ApiError` at 302ms with `status: 0` and the intended message. |
| 3 | `interestGraphMarkup` computed `Math.max(...nodes.map(n => n.weight), 1)`. One null weight makes `max` **NaN**, so `r="NaN"` on *every* circle — the whole interest graph blanks, not just the bad node. | `weightOf` coerces non-finite weights to 0 before both the `max` and the radius. | Reproduced the old behaviour (all four radii `NaN`) and confirmed the patched math yields `13.0, 4.0, 4.0, 7.6`, all finite. |
| 4 | `loadInterestPromptContext` (`services/ai/interest-store.js`) had a bare `catch {}` returning `''`, making a DB outage indistinguishable from "student has no profile yet". | Kept the `''` fallback — the tutor must still answer without personalisation — and added a `console.warn('[ai] ...')` matching the service's existing convention. | `services/ai`: 66/66 pass. |
| 5 | The approve endpoint's transition decision was inlined in the route, so the gate deciding what reaches a child could not be tested without a database. | Extracted to `approvalDecision(status)` in `services/quiz/lib/quiz-status.js`; the route now applies it. Response shape (`{ error, status }` + 409) unchanged. New `services/quiz/tests/quiz-approval.test.js`, 6 tests, including fail-closed on unknown/`null`/`undefined` status. | `services/quiz`: 36/36 pass (was 30). `node --check` on both changed files. |
| 6 | Quiz service had **no Kubernetes manifests at all** — `/api/quiz` was unroutable in-cluster. | `kubernetes/quiz/deployment.yaml` + `service.yaml`, registered in `kustomization.yaml`, plus an `/api/quiz` → `quiz:3005` rule in `ingress/ingress.yaml` and a `quiz-secrets` recipe in `secrets/README.md`. | `kubectl kustomize kubernetes/` emits the quiz Service, Deployment and the `/api/quiz` ingress path. |
| 7 | Two independent round-trips ran sequentially after approval. | `await Promise.all([loadTeacherQuizzes(), loadTeacherQuizPreview(quizId)])`. | Both inline scripts parse; 668/668 CSS braces balanced. |

### Deliberate deviations

- **CLAUDE.md's "no Kafka, event bus, Kubernetes… without a demonstrated scaling trigger" was overridden by the user**, explicitly, for the quiz K8s manifests (item 6). Recorded here because the rule still stands for everyone else — there is still no demonstrated scaling trigger; this was a routability gap in manifests that already existed.
- **The event-bus was dropped**, and the plan item retired. `services/shared/event-bus.js` is **not deployable**: every service builds from its own directory (`build: ./services/quiz`, `COPY . .`), so anything under `services/shared/` is outside the build context and `require()` would throw at container start. **The same blocker kills the plan's Phase 3 "consolidate duplicated middleware into `services/shared/`"** — it cannot work until build contexts move to the repo root. Analytics emission remains fire-and-forget (it does catch and log).

### Not done, still open

- Analytics events can still be lost while the analytics service is down (see above — needs a build-context decision first, not just a retry helper).
- `services/ai/interest-graph.js` (320 lines) and `interest-store.js` remain untested.
- `services/lms/` — 14 Python modules, still almost entirely untested.
- ~50 magic numbers across `analytics/lib/dashboard.js`, `ai/quiz-draft.js`, `ai/interest-store.js`, `quiz/lib/scoring.js` (e.g. the `0.72` similarity threshold) remain unnamed and unexplained.
- `/classroom` still has no TLS route (CLAUDE.md risk #3).
- The 27 seeded NCERT documents still have no backing PDFs on disk (carried over from 2026-08-03, unchanged).

### Test suites, end of session

`services/ai` 66/66 · `services/quiz` 36/36 · `services/auth` 6/6 · frontend: both inline scripts parse, CSS braces balanced, no bare LF introduced into the CRLF files.

**Not run:** `services/analytics` (`tests/app.test.js` requires `express`) and `services/rag` (pytest) — no `node_modules` or Python deps are installed in this working copy. Nothing in this session touched either service.

---

## Session — 2026-08-03: Investor-demo readiness — audit, then eight fixes

### Why

The user needs to demo, imminently, that (T1) a teacher can upload documents, (T2) a teacher can track student quiz scores, (S1) a student can view uploaded documents, (S2) a student can run inference, (S3) the system pushes tests (Socratic teaching), (S4) diagrams work, (S5) video works. Three Explore agents plus direct verification against the live stack and Postgres audited all six claims file:line before any code changed (full audit: `~/.claude/plans/wiggly-spinning-plum.md`). Two claims were solid (T1, S2's plumbing); the rest were broken, non-existent, or actively embarrassing (an env-var name shown to a student; a keyword bug that hijacked the tutor mid-conversation).

### Fixed and verified live (not just unit-tested)

| | Defect | Fix |
|---|---|---|
| 1 | `isVideoRequest` (`services/ai/server.js`) was a bare `/\b(video\|videos\|watch\|youtube\|playlist\|lecture)\b/i` match, checked **before** RAG/LLM dispatch — any message merely mentioning "video" ("I watched a video about X, can you explain it?") short-circuited the tutor into a video-search branch instead of answering. | Moved into `services/ai/video-search.js` as `isVideoRequest`, now requires a request verb/pattern near the keyword. "youtube"/"playlist" alone still trigger (unambiguous). 2 new tests. |
| 2 | `formatImageError` (`frontend/index.html`) fell through to `return text` for unrecognized errors — a missing `GEMINI_API_KEY` showed the literal string to a student. Teacher quiz-failure rows had the same problem (`OPENROUTER_API_KEY is required...` shown verbatim). | Both now pattern-match `api_key`/`is required for`-shaped errors and substitute a generic, actionable sentence. Verified live: the 26 still-`failed` chapters now read "Quiz generation is not configured yet. Ask an administrator to connect an AI provider." instead of the raw string. |
| 3 | Videos pane and chat video branch showed "not configured"/raw-failure text whenever `YOUTUBE_API_KEY` was empty **or present-but-broken**. | Added `CURATED_VIDEO_TOPICS` (11 topics matching the seeded NCERT catalogue) + `matchCuratedVideoTopic` in `video-search.js`; wired into the chat branch, `/api/ai/video/topics`, and `/api/ai/video/:topic`. Each links to a Khan Academy **search page**, not a specific video ID — a specific ID can't be verified as live/appropriate without browsing it, which this doesn't do. |
| 4 | Quiz generation was OpenRouter-only (`services/ai/quiz-draft.js:236` threw immediately if absent) — with `OPENROUTER_API_KEY` empty, all 27 chapters were stuck `failed`, so there was nothing for T2 (teacher score tracking) to show. | Added a provider seam (`resolveQuizProvider`): OpenRouter wins if configured, else falls back to Groq (already funded, since it's the tutor-chat provider). Groq path uses `json_object` mode + the schema spelled out in-prompt (Groq doesn't reliably support strict `json_schema`), and defaults to a smaller chunk sample (24 vs 40), 1 quality pass instead of 2, and a lower `max_tokens` — **Groq's free tier caps at 12,000 TPM and a single full-size call already used ~8,730**, so a second call in the same 60s window (the quality-review pass) reliably 429'd. Verified live twice: with only Groq configured, the first attempt correctly dispatched to Groq and hit Groq's real rate limit (proving genuine dispatch); after the user added a working `OPENROUTER_API_KEY`, the second attempt correctly preferred it and produced a real 10-question quiz, now `pending_review`. |
| 5 | Retrieval chunks averaged **38 characters** (chunk_type=`semantic`, one per regex-classified `EducationalEntity` fragment) — the tutor's "From the textbook" provenance panel would show a citation like `parliamentary system, and`. | Added `chunk_type='passage'` chunks built directly from the PDF's own paragraph blocks (`eke_pipeline.parse_pdf_blocks`, already extracted but previously discarded after entity classification), merged up to ~1,100 chars, heading-prefixed for self-containment, alongside (not replacing) entity chunks. Verified live on a fresh upload: 88 passage chunks, avg 320 chars, max 1,140, genuine NCERT prose. `entityId`/`canonicalConceptId` are now nullable in the `/api/rag/internal/retrieve` contract — documented in `docs/backend-services/RAG_EKE_INGESTION_CONTRACT.md`. |
| 6 | No per-student quiz score view existed anywhere. Analytics only ever aggregated to one class-wide `averageScorePercent`. | New `GET /api/quiz/quizzes/:quizId/attempts` (teacher-only, school-scoped). Names are **not** resolved server-side — `auth_db` and `quiz_db` are separate services/schemas, and `GET /api/auth/users?role=student` (teacher-only, already existed) already returns names for the teacher's school, so the frontend joins client-side instead of adding a new internal cross-service route. Verified live: "Arjun Sharma — 7/17 — 41%" rendered correctly in the teacher quiz preview. |
| 7 | No system-initiated nudge toward a quiz existed, and no Socratic-style tutoring existed (`grep -ri socratic` = zero hits repo-wide). | Two additions, both respecting §13 (no LLM in selection/routing paths): (a) a **deterministic** client-side rule — after 3 tutor turns on one chapter with a `ready` quiz for it, a nudge card appears client-side (turn-count is a fixed rule, not a model decision); "Take the quiz" opens the exact right quiz. A `quiz_nudge_shown` analytics event (new allowlist entry, `services/analytics/lib/validation.js`) distinguishes it from a student opening the quiz list unprompted. (b) An explicit opt-in "Tell me directly" / "Guide me" toggle per message — only in "Guide me" does `buildTutorPrompt` switch to a guiding-question style; this is legitimate prompt-level rendering (§13 permits LLMs to render/paraphrase), not a change to the default. Verified live end to end: 3 real turns in Guide-me mode produced genuine guiding questions ("What number comes to mind when you think of multiplying a number by itself to get 64?"), the nudge card appeared with the correct chapter name, clicking it opened the right quiz, and the analytics event landed in Postgres. |
| 8 | No document viewer existed — students got chapter-metadata cards, never the underlying PDF. | New `GET /api/rag/documents/{id}/file` (any authenticated role, same access pattern as the existing list route), restricted to `status=ready`, path-resolved against the storage root before serving. "View original document" link added to the student's Lesson source panel. Verified live: 200 + real PDF bytes for a fresh upload; safe 404 (not a crash) for a missing file, another school's document, and a non-ready document. |

### Known-broken, not fixed this session — flagged instead

**The 27 originally-seeded NCERT documents have no backing PDF file on disk.** `rag_db.documents` says `ready` for all 27, but `/app/storage/rag/uploads/` on the live `file_storage` volume only contains an `images/` directory — no `rag/uploads/` at all. This predates this session (found while attempting the passage-chunking backfill in item 5 above) and blocks two things for those specific 27 chapters: the passage-chunking backfill (can't re-parse a PDF that isn't there) and the new document-viewer route (safe 404, not a crash, but no file to serve). **Fix requires re-seeding**, which has cross-service ripple (new document IDs would orphan the one already-generated quiz's `chapter_quiz_sources.document_ids`/content fingerprint) — deliberately not done unilaterally. Any **newly uploaded** document (proven live, twice) is unaffected — it gets passage chunks and a working viewer link immediately, because ingestion always operates on the just-uploaded file. **Before the demo:** either accept T1/S1/S2/S3 will only be pristine for freshly-uploaded chapters, or have the teacher re-upload the 2-3 chapters intended for the demo.

### Environment, as of session end (values never printed)

| Key | State |
|---|---|
| `GROQ_API_KEY` | SET (rotated once already — was pasted in plaintext in an earlier session) |
| `OPENROUTER_API_KEY` | **SET** (added by the user this session — quiz generation now prefers this path) |
| `GEMINI_API_KEY` | **SET** (added by the user this session — diagram generation should work; not independently verified beyond the fixed error-message path) |
| `YOUTUBE_API_KEY` | **SET but not functional** — live requests to `youtube.googleapis.com` fail with `CREDENTIALS_MISSING`. The curated fallback (item 3 above) now covers this, so the demo experience is fine either way, but the key itself needs attention in Google Cloud Console before real-time YouTube search will work (verify the key is valid, YouTube Data API v3 is enabled on its project, and it carries no referrer/IP restriction incompatible with a server-side call). |

### Test suites

`ai` 66/66 pass · `quiz` 30/30 pass · `rag` 38/38 pass (run in a disposable `docker compose run --rm --no-deps` container with `DATABASE_URL`/`FILE_STORAGE_PATH`/`INTERNAL_SERVICE_TOKEN`/`JWT_SECRET` explicitly overridden — the live `rag` container's real env would otherwise let the test fixtures `Base.metadata.drop_all()` the production schema and `rmtree()` the real upload directory, since both fixtures use `os.environ.setdefault`). `analytics` 23/24 (the 24th, `app.test.js`, still needs `express` installed — pre-existing, unrelated to this session). Frontend inline scripts parse-check clean; CSS braces balanced (no CSS was added — all new UI reuses existing classes: `.seg`/`.seg-btn` for the tutor mode toggle, added one `.seg-2` two-column modifier; `.quiet-box`, `.list`/`.list-item`/`.tile-icon` for the nudge card and score rows). Verified at 402×874 (iPhone 17 Simulator) — the new toggle and nudge card fit cleanly with no overflow.

### Cosmetic gap not fixed

The chat's video-recommendation text always says "I found safe **real-time** video results," even when the curated fallback served the answer instead of a live YouTube search. Functionally fine (the video is genuinely relevant and safe), just imprecise wording — `buildVideoRecommendationContent` in `services/ai/server.js` doesn't currently know which path produced the result.

---

## Session — 2026-07-30: Layer 1–3 audit, and the P0 fixes it surfaced

Four inspectors audited the codebase against Layers 1–3 of `Roognis_AI_Native_Architecture_Missing_Layers.docx`. Findings triangulated: three independently found the same top defect without being told to look for it. Full audit: `~/.claude/plans/wiggly-spinning-plum.md`.

### The layer question, answered

**L1 Autonomous Teaching Engine ~25% · L2 Pedagogical Decision Engine ~20% · L3 Student Mental Model ~15%.**

One structural blocker explains all three: **there is no learner-state write path.** `QuizAttempt` and `Event` are append-only; `StudentLearningProfile` is written once at onboarding (`services/ai/server.js:303`) and never again. Nothing reacts to an assessment result, so "diagnose" can only re-scan raw attempts and the loop cannot close.

Related and cheaper to fix: **nothing aggregates correct answers.** `services/quiz/lib/scoring.js` populates `weakAreas` only from *incorrect* answers, so a student who gets a concept right nine times and wrong once is indistinguishable from one who has only ever failed it. No denominator, therefore no mastery estimate is derivable. That asymmetry is the cheapest unlock for L3.

### ⚠️ Two "Layer" numbering systems — resolved

The .docx numbers 1–30; `ARCHITECTUREDesign.md` §11 numbers 0–6. They collide and run in **opposite dependency order** (the .docx's L1, the autonomous loop, is the *last* thing buildable). **Decision: `ARCHITECTUREDesign.md` is canonical**; the .docx entries are named *capabilities*, not layers. Mapping: docx L3 ≈ repo L2, docx L2 ≈ repo L3, docx L1 = the loop over both.

### Fixed (Phase 0)

| | Defect | Fix |
|---|---|---|
| P0-1 | Quizzes were created `status: 'ready'` — the exact value student endpoints filter on — with **no approve route anywhere**. LLM answer keys reached children unreviewed, and a wrong key mints a `weakAreaLabel` that becomes the teacher's top insight. | `pending_review` default + `POST /api/quiz/quizzes/:id/approve` + teacher review UI. Emits `quiz_published`, allowlisted and consumed by the dashboard since forever **with no producer**. |
| P0-2 | `scoring.js` marked wrong answers **correct**: the length guard was vacuously true under 12 chars, so key `"acid"` accepted `"not acid"`, `"7"` accepted `"17"`, `"ice"` accepted `"nice"`. | Containment now needs ≥12 chars *and* token boundaries, plus a negation guard (bag-of-words cannot see polarity). 11 new tests. |
| P0-3 | `GET /api/rag/retrieve` had **no authentication at all** while every sibling route did, with `schoolId` as a query param serving as the only tenancy filter. | Moved to `/api/rag/internal/retrieve` behind the service token, matching the existing `/internal/` convention. AI service and docs updated. |
| P0-4 | 4 tables + 2 columns in `services/ai/schema.prisma` with **no migration** — item 1 of the "live risks" below, now closed. Prod `migrate deploy` never created them, so the default "For You" feed 500s; a client `.catch(() => {})` hid it. | Migration generated via `prisma migrate diff`. Client warns once per session instead of swallowing. |
| P0-5 | A self-harm disclosure produced a canned redirect and an anonymous +1 in a weekly counter — no named flag, contradicting `MASTERCONTEXT.md:214`. No grooming category existed at all; rules were English-ASCII only. | `SafetyReviewFlag` table with acknowledgement state; grooming category; Hindi/Hinglish self-harm patterns; `isLikelyUnassessable()` makes the remaining language gap explicit rather than invisible. |
| P0-6 | `services/lms/` (built by prod compose), `services/ai/interest-graph.js` and `interest-store.js` (required by `server.js`) were **untracked** — a clean clone could not build prod or start the AI service. | Staged. `*.db` added to `.gitignore` so the dev SQLite is not committed. |

### Verified

`ai` 54 pass · `quiz` 30 pass · `auth` 6 pass · `analytics` 23 pure-logic pass (`app.test.js` still needs `express`, as before). Frontend CSS braces balanced, JS parses. Every fix has a test that fails before and passes after.

### Not verified — needs a running stack

Docker was down, so **no migration was applied and no endpoint was exercised.** Before deploying:
- `prisma migrate deploy` on a clean volume for `services/ai` (2 new migrations) and `services/quiz` (1), then `GET /api/ai/news` must not 500.
- `services/rag` tests could not run (host Python is 3.9; the service needs 3.10+). The new auth test is written but **unexecuted**.
- End to end: generate a quiz → confirm invisible to students → approve → confirm visible.

### ⚠️ Read before deploying P0-1

The quiz migration **demotes every existing `ready` quiz to `pending_review`**, because none was ever human-approved. Students lose access to existing chapter quizzes until a teacher approves each, and any attempt in flight at deploy will fail its submit. Deliberate, and commented in the migration — delete the two `UPDATE` statements to approve forward instead. **Tell teachers before running it.**

### Known-broken, deliberately not fixed this session

- `progressPercent` (`services/analytics/lib/dashboard.js:364`) is **pure activity volume with no correctness term** — a tutor *recommending* a video the child never opened scores 8 points; 100% is reachable with zero questions answered. Shown to parents as a bare percentage under "Learning analytics".
- `ruleConfidence` (`frontend/index.html`) is three constants and a clamp with a hard floor of 0.45, rendered to teachers as "68% confident" with a progress bar. No variance, no interval, no calibration.
- Quiz citations are **synthesised** by token overlap when the model omits them (`quiz-draft.js:474`), falling back to `sourceChunks[0]` — an audit trail that can be a keyword accident.
- No closed quality loop anywhere: the `Feedback` table is written and **read by nothing**.

---

## Session — 2026-07-30: CLAUDE.md added

`CLAUDE.md` now exists at the root — the entry point Claude Code loads automatically each session. It carries the doc-precedence order, the two-frontends trap, the service/port/prefix/schema table, the §13 non-negotiables in condensed form, the CRLF and `KNOWN_EVENT_TYPES` traps, and the three live risks below.

Verified while writing it, not taken from these docs:

- **The runbook's port list is wrong.** `docker-compose.yml` maps only `80:80`, and `traefik/traefik.yml` sets `api.dashboard: false` — there is no `localhost:3000` and no dashboard on `:8080`. `docs/LOCAL_APP_RUNBOOK.md` §7 says otherwise. Use `http://localhost/`.
- **The interest-graph migration gap is still open** — `grep student_interest services/ai/prisma/migrations/` returns nothing, `schema.prisma` has three matches. Blocking item 1 below is unchanged.
- **`docker-compose.production.yml` still has no `web` service** (services: traefik, postgres, auth, ai, rag, textbook-seed, quiz, analytics, lms, frontend).
- **Test suites run without `npm install`** except `services/analytics/tests/app.test.js`, which requires `express` and is the single failure on a clean checkout (23/24 pass). ai 49/49, quiz 10/10, auth 6/6 all pass with no deps installed.
- `pytest` is not installed on this machine, so the RAG suite was **not** run.

No code changed this session.

---

## Session — 2026-07-29: Class module — Inbox, Students, Activity

### The expensive mistake first

A full session was spent building an "AI-Native Learning OS" into **`web/`** — the wrong app. `web/` is the Google-Classroom-parity sub-app that Traefik mounts at **`/classroom`** and which is **not tracked in git**. The product is `frontend/index.html`, mounted at **`/`**. The work also invented an indigo/emerald desktop-sidebar design language, discarding Chroma Bloom entirely, because `frontend/DESIGN.md` was never opened.

**If you take one thing from this file: "the frontend" means `frontend/`.** The two apps also talk to different backends — `frontend/` uses `/api/{ai,analytics,auth,quiz,rag}` and *never* `/api/lms`.

### Added

`teacher-mvp` is now a **module with four panes** on the shared `.module-bar` rail — Overview · Inbox · Students · Activity — because the bottom bar is full at four destinations (§9) and these are all views onto the same class. Same contract as the tutor rail: panes swap in place, load lazily on first reveal, and `state.teacherPane` is in the nav snapshot so back moves between panes.

- **Inbox** — seven deterministic rules over `/api/analytics/teacher/dashboard`: low quiz average, unsubmitted work, no quiz assigned, recurring weak area, low participation, safety blocks, unused learning surface. Each carries a severity, a confidence tied to sample size, an evidence disclosure, and the ruleset version. **No model participates in detecting, scoring or ranking any of it** (§13).
- **Students** — renders `/api/analytics/teacher/interventions`, which already exists in `lib/interventions.js`.
- **Activity** — the analytics event stream, day-grouped with filter chips.
- **Student Home** — a "What to do next" panel and an activity stream, from the student's own dashboard. Deliberately *no* severity, confidence or ranking: §12 keeps teacher-facing analysis off student surfaces. Still exactly 4 summary cards (§4).

### Bugs found while building it

1. **Two contrast failures, both caught by measuring rather than eyeballing.** White on `--c-vermilion` is **3.9:1** and `--green` on the warm ground is **3.3:1** — both miss AA at badge/label size. Added `--c-vermilion-deep` (5.5:1) and moved the disclosure label to `--ink`. §4 says "never assume white works — check". It was right.
2. **The count badge broke the rail twice.** In flow it collided with the next tab's icon at 375px; giving tabs `flex: 0 0 auto` then pushed the rail to 477px and scrolled the whole page. Fixed by taking the badge out of flow as a corner badge, which restores the shrinkable model the tutor rail already uses.
3. **`text-transform: capitalize` on a shared chip** rendered flag labels as "Barely Using The Tutor". Callers now pass their own casing.
4. **`EVENT_META` was written from imagination.** The services actually emit `study_time_tracked` (by far the highest volume), `quiz_draft_generation_failed`, and others. Grep `type:` across the services before adding to that map.
5. **`routeMeta` had `'profile'` declared twice** — pre-existing, harmless, removed.

### Verified

**On the iOS Simulator (iPhone 17), signed in against the live stack**, both themes, all four panes: sign-in, the module rail, corner badges, insight cards, the evidence disclosure expanding with real numbers and provenance, the follow-up queue, and the day-grouped activity stream with its scrolling filter rail. Also checked in a 375×812 browser viewport: no horizontal overflow on any pane, nothing overlapping the fixed tab bar, no tab collision.

Invariant §9.11 confirmed on a real touch keyboard — the email field did **not** auto-capitalise.

### A sixth bug, found only on the device

**The count badge rendered a phantom "0" on the Students tab.** `[hidden]` hides via the UA sheet's `display: none`, and *any* author `display` beats it — `.tab-count { display: inline-flex }` silently defeated the attribute, so the badge showed until its pane had been opened. Fixed with `.tab-count[hidden] { display: none }`. Same family as §9.12, and worth adding to the invariant list: **if you set `display` on something you also toggle with `[hidden]`, add the `[hidden]` rule.**

This is exactly why the Simulator pass matters — the browser check at 375px never showed it, because that run happened to open every pane.

---

## Session — 2026-07-29: Back navigation

### Added

Top-left back button (`#back-btn`) on every page, hidden at the root. Backed by a real in-app stack (`state.navStack`) because the app's depth — tab → tutor pane → subject → chapter → chat — is not expressed in any URL. Each push also writes `history.pushState`, so **the iOS edge-swipe now goes back inside the app** rather than leaving it.

Five call sites push depth: `showRoute`, `showTutorPane`, `showTutorLibrary`, `showTutorChatWorkspace`, `selectTutorSubject`. Verified by trace: Home→Tutor→Discover→Profile pushes 3 and unwinds to Home, and Tutor→subject→back returns to the subject grid.

### Three bugs found while building it

1. **`#profile { display: grid }` outranked `.view { display: none }`** (1-0-0 vs 0-1-0), so the profile card was rendering underneath *every other page*. Visible as an "AS / Student workspace" block below the subject grid. Now scoped to `#profile.view.active`.
2. **`showRoute` ran twice per tab tap** — `renderNav()` bound a per-button listener while a delegated `[data-route]` handler already existed. This pushed a bogus history entry *and* made every route fetch its data twice (Discover was double-fetching on every tap). Removed the redundant binding.
3. **`selectTutorSubject()` bypassed `showTutorLibrary()`**, so entering a subject never pushed and back skipped a level. This is why every depth-changing entry point needs its own push.

### Gotcha

**Safari in the Simulator serves a cached page** when re-opening the same URL — a fixed bug looked unfixed twice. Bust with `?v=n` before diagnosing.

---

## Session — 2026-07-28 (latest): Profile + notifications

### Navigation

Bottom bar is now **Home · Tutor · Discover · Profile**, with Profile last so it sits bottom-right. Teacher and parent get Profile as their last nav item too.

- **The topbar carries notifications only.** Theme and sign-out moved into Profile. This is deliberate headroom for the planned agentic nudges — the bell is a real surface with an empty state rather than a dead button, and `.notif-dot` is in place as the unread indicator.
- `#profile` is **one shared view** across all three roles. `renderProfile()` fills identity from `state.user`; `[data-role-only]` hides role-specific blocks. Don't duplicate the view per role.
- **Appearance is System / Light / Dark**, not a toggle. "System" is stored as *absence* of the `roognis-theme` key, so the OS keeps driving the theme after the user visits the setting.
- `openInterestGraphSheet()` extracted so Discover and Profile → Your learning share one implementation.

### Bugs found and fixed

1. **`setRole()` still wrote to `#user-name` and `#avatar`** after I removed them from the topbar — would have thrown on every login. Caught by asserting every `querySelector('#id')` in the JS resolves to real markup. Worth repeating that check after any DOM move.
2. **`.list-item` buttons rendered blue on iOS** — the same system-button-colour trap as DESIGN.md invariant 10. `.list-item`, `.seg-btn` and `.answer-option` added to the explicit-colour rule.

### Gotcha for the next session

**`frontend/index.html` uses CRLF.** Multi-line find/replace with `\n` patterns silently matches nothing — edits appear to succeed while changing the file not at all. Patch line-wise and re-join with the detected EOL.

---

## Session — 2026-07-28 (later): Tutor module + iOS

### Done and verified on iPhone 17 Pro simulator

**Navigation restructured.** Tutor, Quizzes, Diagrams and Videos merged into one **Tutor module** with a sticky segmented rail below the header. Bottom bar is now three items (Home · Tutor · Discover) instead of six.

- Sub-router `showTutorPane(key)`; `state.tutorPane` persists the choice; `openTutorPane()` deep-links.
- The five Home shortcuts ("Take quiz", "Open videos", …) now use `data-pane-link` and land on the right pane.
- Old routes `student-quizzes` / `student-diagrams` / `student-videos` **no longer exist** — anything referencing them must use the pane API.

**Answer provenance shipped.** Tutor answers now show the textbook passages they were built from: chapter line, numbered excerpts, per-passage citations. Server sends `excerpts[]` on the `answer_context` SSE event (`services/ai/server.js`), client renders `.message-source`.
Verified live: *"Explain what a rational number is"* → 4 passages cited from `NCERT MATHEMATICS GRADE 8, GANITA PRAKASH, CHAPTER 3, P.2`.

### Three iOS-only bugs found by running in the simulator

None of these reproduce in a desktop browser at narrow width.

1. **Login was broken on iOS.** The email input had no `type` at all → iOS auto-capitalised to `Arjun@demo.com` → auth rejected it. Fixed with `type/inputmode/autocapitalize/autocorrect/spellcheck`.
2. **Every `env(safe-area-inset-*)` was a no-op** — the viewport meta lacked `viewport-fit=cover`. All the tab-bar and sheet padding added during the touch work was silently doing nothing on notched iPhones. Fixed.
3. **Card headings rendered blue on iPhone.** Card surfaces are `<button>`s and iOS Safari paints button text in system blue unless `color` is set explicitly. Fixed.

Also added: `apple-mobile-web-app-capable`, `black-translucent` status bar, dual light/dark `theme-color`, and a generated 180×180 `frontend/assets/apple-touch-icon.png` (served, `200`). **Add to Home Screen now launches chrome-free** — that is the demo mode.

### Running it

```bash
open -a Docker && docker compose up -d
xcrun simctl boot "iPhone 17 Pro" && open -a Simulator
xcrun simctl openurl booted http://localhost/
```
There is **no Xcode project** — this is a web app in Mobile Safari. A WKWebView wrapper would be a real Xcode target if a true `.app` is ever needed.

### Still open from earlier today
The 🔴 blocking items below are unchanged: the **missing interest-graph migration** (breaks production), the **quiz approval gate**, and `student_onboarding_completed`. `Date.now()` → `performance.now()` for Discover dwell is also still outstanding.

---

## Session — 2026-07-28

### Governing document

`ARCHITECTUREDesign.md` (root, untracked) now governs architecture. Read §11 (Layer 0–6 build sequence) and §13 (non-negotiables) before any non-trivial change.

Its own conflict order: **actual code > `MASTERCONTEXT.md` > `ARCHITECTUREDesign.md` > service LLDs.** Do not silently reconcile a contradiction — surface it.

---

### 🔴 Blocking / must decide

**1. Interest tables have no migration — production will break.**
`student_interest_nodes`, `student_interest_edges`, `student_news_signals`, `student_interest_profiles` exist in `services/ai/prisma/schema.prisma` but appear in **zero** migration files (only `20260717120000_initial` exists).

- dev → `docker-compose.yml` runs `prisma db push` → tables exist locally ✅
- prod → `docker-compose.production.yml` runs `prisma migrate deploy` → **tables will not exist** ❌

Result on the Oracle VM: `/api/ai/news/signal`, `/api/ai/interest-graph` and the personalised Discover feed fail at runtime.
**Fix:** `npx prisma migrate dev --name interest_graph` in `services/ai`, then commit.

**2. LLM-generated quizzes reach students with no human approval.**
`services/quiz/prisma/schema.prisma:54` → `Quiz.status @default("ready")`, and the student endpoints (`services/quiz/server.js:186,215,246`) filter on exactly `status: 'ready'`. The review-then-publish gate described in `docs/backend-services/QUIZ_SERVICE_LLD.md` was **never built**.

Currently masked only because `OPENROUTER_API_KEY` is empty (`services/ai/quiz-draft.js:236` throws first). **Funding that key ships unreviewed AI questions to minors.** Decide the gate consciously before adding the key.

**3. `student_onboarding_completed` has never been recorded.**
Emitted at `services/ai/server.js:322`, but absent from `KNOWN_EVENT_TYPES` in `services/analytics/lib/validation.js` → 400, swallowed by fire-and-forget. Either allowlist it or delete the emitter.

---

### ✅ Done and verified this session

**Backend**
- Groq wired as tutor-chat provider (`services/ai/server.js`); `.env` normalised CRLF→LF (84 lines) which was breaking the API key.
- **News feed reengineered** — 10 BBC genre feeds (all verified live), replacing 5. Genre keys are now lowercase and are the index key for the whole interest graph.
- **Interest graph** — new `services/ai/interest-graph.js` (42-topic taxonomy, deterministic topic/entity extraction, cosine ranking + exploration term) and `interest-store.js` (decayed accumulation, 21-day half-life).
- Endpoints: `GET /api/ai/news/genres`, `GET /api/ai/news` (For You + genre + pagination), `POST /api/ai/news/signal`, `GET /api/ai/interest-graph`.
- Interest summary injected into `buildTutorPrompt` with an explicit guardrail: *never change academic content, difficulty, or correctness.*
- Verified end-to-end: feed flipped from balanced → science×4 + technology×3 after training on 8 tech/science opens.

**Frontend** (`frontend/index.html`, single file)
- Chroma Bloom palette + Liquid Glass material system; dark mode (`data-theme`, resolved pre-paint, follows OS until explicit choice).
- Touch layout: bottom tab bar ≤760px, 48px targets, safe-area insets.
- Discover rebuilt as a real news reader: sticky genre rail, lead story, thumbnail list, load-more, engagement signals, radial interest-graph visualisation.
- Design system documented in [`frontend/DESIGN.md`](frontend/DESIGN.md) — **read §9 (invariants) before touching CSS.**

**Tests:** all 49 AI-service tests pass (onboarding 8, quiz-draft 14, quiz-learning-context 3, safety 9, student-news 9, video-search 6).

---

### ⚠️ Known non-compliance with `ARCHITECTUREDesign.md`

The interest graph was built before the architecture doc was read. Where it stands:

| §  | Requirement | Status |
|----|-------------|--------|
| §13.1 | No LLM in scoring/selection paths | ✅ fully deterministic, zero network calls in `interest-graph.js` |
| §12 | Academic signals only, no clinical constructs | ✅ records civic *engagement* + viewpoint diversity, **not** political leaning |
| §6.2 | PSV writes carry `event_ids[]`, `gate_version`, `model_version` | ❌ none present |
| §6.2 | State reconstructable from event log | ❌ `interest-store.js:48-54` ages and overwrites destructively |
| §6.1 | `performance.now()` for elapsed time | ❌ uses `Date.now()` at `frontend/index.html:4297`, `:6548` |
| §6.3 | "Knowledge Graph" = domain concept DAG | ⚠️ misnamed — ours is a **per-student interest affinity graph**, a different object. Rename the comment at `schema.prisma:139` before someone builds `services/kg` on it. |
| §3.9 | Engagement and measurement physically separate | ⚠️ separate at write layer; merged at prompt-render layer. Acceptable now; must be a distinct component at Layer 4. |

---

### 📄 Documentation status

| Doc | State |
|---|---|
| `ARCHITECTUREDesign.md` | **Authoritative.** Untracked — commit it. |
| `MASTERCONTEXT.md` | Authoritative for stack reality (§3.2). Untracked. |
| `frontend/DESIGN.md` | Current and accurate. |
| `docs/ENGINEERING_CONTEXT_v1.0.md` | ⚠️ **§7 stack section is fiction** — see header added to the file. Claims a delivered "psychographic engine" that does not exist and that §13 forbids. |
| `docs/backend-services/QUIZ_SERVICE_LLD.md` | ⚠️ Describes a service never built. Superseded by `CHAPTER_QUIZ_GENERATION_PLAN.md`. |
| `docs/backend-services/*_LLD.md` | Stale in both directions — several claim missing features that now exist, `AUTH_SERVICE_LLD` claims endpoints that don't. |
| `docs/ORACLE_DEPLOYMENT.md` | Most accurate deployment doc. Two gaps: port list says 3000-3005 but `lms` uses 3006; `docker-compose.production.yml` has **no `web` service**, so `/classroom` looks unreachable over HTTPS. |

---

### 🔑 Environment

| Key | State | Blocks |
|---|---|---|
| `GROQ_API_KEY` | set | — (tutor chat works) |
| `OPENROUTER_API_KEY` | **empty** | all quiz generation (27 chapters `failed`) |
| `GEMINI_API_KEY` | empty | diagram image generation |
| `YOUTUBE_API_KEY` | empty | real video search |

⚠️ The Groq key currently in `.env` was pasted in plaintext in a chat session — **rotate it** at console.groq.com/keys.

---

### ▶️ Suggested next session

Items 1–3 precede Layer 0; 4–5 *are* Layer 0.

1. Commit untracked work + **generate the interest-graph migration** (only thing broken in prod).
2. Three small compliance fixes: `performance.now()` for dwell; rename the KG comment; fix `student_onboarding_completed`.
3. Decide the quiz publication gate **before** funding OpenRouter.
4. Freeze the §6.1 event envelope — 13 typed events + payload schemas + contract tests, shipped as a shared validator. The Discover signal endpoint is the natural first migration and a zero-risk rehearsal.
5. Layer 0.2–0.4: PSV schema, KG schema, ECD mappings. Two decisions to make explicitly: (a) `services/kg` on Neo4j or Postgres — MASTERCONTEXT says Neo4j, §10 says "PostgreSQL/Neo4j as warranted", and the no-premature-infrastructure rule argues against a new datastore; (b) does roster live in `auth_db` or `lms_db` — Layer 2 cannot scope anything until settled.

**Explicitly not now:** any `services/psv` / `services/decisions` code (contracts unfrozen), any teacher/parent view over learner-derived data (§13 forbids before `services/privacy`), further Kubernetes work (§10).

---

### Deploy notes

`server.js` reads from disk per request, so iterate with `docker cp`. That is **not** persistent — the Dockerfile `COPY`s at build time:

```bash
docker compose up -d --build frontend ai
```
