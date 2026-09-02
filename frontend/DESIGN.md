# Roognis Frontend — Design System

Governs [`frontend/index.html`](index.html), which holds the entire client: CSS, markup, and JS in one file. Read this before changing anything visual.

## Academic Premium (current system)

**Academic Premium supersedes Chroma Bloom + Liquid Glass + Premium Evolved**, replaced in a full aesthetic rehaul rather than an incremental refinement. The prior system's translucency-as-material philosophy (§3 below, historically) is gone entirely: no `backdrop-filter`, no diffraction edges, no ambient body bloom, no spring-overshoot motion. In its place: flat opaque surfaces, a Navy/Copper/Warm-grey/Off-white palette, a serif display face reserved for hero moments, and plain decelerate easing. The rationale: credibility with parents/teachers and older exam-prep students (14–18) outweighs the glassmorphism trend, and Academic Premium reads as prestigious/trustworthy rather than playful — see `HANDOFF.md` for the full redesign-exploration record (5 candidate directions were generated and compared before this one was chosen).

The legacy CSS custom property **names** (`--lg-tint`, `--lg-line`, `--lg-hi`, `--lg-foot`, `--lg-amb`, `--lg-bar`, `--lg-bar-rgb`, `--lg-ease`, `--lg-spring`, `--lg-blur`, `--lg-sat`) were **kept and redefined** rather than deleted and hunted down at every call site — ~86 call sites existed across the file, too many to audit individually in one pass. They now alias flat Academic Premium values (`--lg-tint` → `var(--ap-surface)`, `--lg-ease` → `cubic-bezier(0,0,.2,1)`, `--lg-blur` → `0px`, etc.), so any remaining un-migrated call site degrades safely to the new flat system instead of silently keeping old glass values. Prefer the `--ap-*` names in new code; treat `--lg-*` as a compatibility shim, not the canonical system.

---

## 1. Cascade architecture

The stylesheet is organised into four layers inside a single `<style>`. Preserve the intended cascade, but refactor the owning layer when that is the maintainable fix.

| Order | Layer | Purpose |
|---|---|---|
| 1 | Base sheet | Structure, grid, component skeletons. Its `:root` is **legacy** and fully overridden below. |
| 2 | Academic Premium palette (`:root`, formerly `CHROMA BLOOM`) | Palette, radii, typography, flat shadows |
| 3 | Academic Premium dark (`:root[data-theme="dark"]`, formerly `CHROMA BLOOM — night`) | Dark tokens |
| 4 | `LIQUID GLASS` block (compatibility shim, + `TOUCH`) | `--lg-*` aliases, motion, sheet, mobile tab bar |

> **Media queries carry no specificity.** A later unconditional rule beats an earlier `@media` rule of equal specificity. This has broken layout twice — see §9.

**Theme switching** is a single `data-theme` attribute on `<html>`, resolved in a `<head>` script *before first paint* to avoid a light flash. It follows the OS until the user picks explicitly, then persists to `localStorage['roognis-theme']`. There is no `prefers-color-scheme` block — JS resolves it, so dark tokens are declared once.

---

## 2. Colour & Palette Hierarchy

**Copper is the unmistakable primary** for all interactive/active states (active tabs, focus indicators, primary buttons, progress fills). Navy is ink — body text, headings, and the readable-on-copper foreground. A handful of muted semantic tokens (`--green`, `--blue`, `--amber`, `--red`) cover status/severity roles.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ap-bg` | `#f9f7f3` | `#0f1826` | page background |
| `--ap-surface` | `#ffffff` | `#16233a` | card/panel/topbar fill |
| `--ap-surface-2` | `#f2ece1` | `#1c2c47` | nested/tinted fill |
| `--ap-ink` | `#1a2d47` | `#f2ede4` | body text, headings |
| `--ap-ink-muted` | `#5f5248` | `#b9ac9d` | secondary text |
| `--ap-line` | `#e4dbcc` | `#2b3a56` | hairline borders |
| `--ap-line-strong` | `#d8ccb8` | `#3a4c6c` | emphasized borders |
| `--ap-accent` | `#c4965f` | `#d3a874` | primary/copper |
| `--ap-accent-hover` / `-active` | `#d1a672` / `#a97e4a` | `#ddb98c` / `#c0955f` | button states |
| `--ap-accent-ink` | `#1a2d47` (navy) | `#14213a` | text **on** solid accent fill |
| `--ap-accent-soft` | `#f3e4d0` | `#2b2419` | tinted accent background (active tabs/chips) |

**Rule of thumb:** solid accent fill (`.btn.primary`) pairs with `--ap-accent-ink` for text; a *tinted* accent background (active tab/chip/pill) pairs with plain `--ap-ink` instead, since `--ap-accent-soft` is already light/dark enough for the theme's normal ink color to read cleanly on it in both themes.

The full 12-hue spectrum (`--c-magenta` … `--c-teal`) survives, muted to the same academic register, for **data visualization and the interest graph only** — never for interactive elements. No interactive element uses a hue outside `--ap-accent` plus the four semantic tokens.

---

## 2a. Tokens

Never hard-code a colour. If a value isn't here, add a token.

### Shadow, radius, motion, type

| Token | Value |
|---|---|
| `--ap-shadow-sm/-md/-lg` | soft directional shadows, no blur-glass ambient (see full values in `index.html` `:root`) |
| `--ap-radius-xs/-sm/-md/-lg/-pill` | `4px / 8px / 12px / 16px / 999px` |
| `--ap-ease-fast` | `300ms cubic-bezier(0,0,.2,1)` — buttons, interactive controls |
| `--ap-ease-slow` | `600ms cubic-bezier(0,0,.2,1)` — cards, panels, sheets |
| `--font-serif` | `"Fraunces", Georgia, "Times New Roman", serif` |
| `--font-sans` | `"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` |
| `--fw-regular` / `--fw-medium` / `--fw-display` | `400 / 600 / 700` |

**Radius bucket mapping:** chips/badges → `xs`; buttons/inputs/mini-cards → `sm`; subject/chapter/question/news/session/profile cards → `md`; panels/sheets/auth-card/sidebar → `lg`; pills/segmented-control/chips/module-tab → `pill`.

### Typography canon

**Fraunces** (serif, weight 700, `opsz,wght@9..144,300..900`) is reserved for **`h1` only** — the one selector in the file that reaches the 36pt+ hero floor (`clamp(48px, 4vw + 32px, 64px)`). Every other heading-like selector (page-head titles, card titles, panel titles) sits well under that floor and stays in **Source Sans 3**, distinguished by weight alone.

**Weight retirement.** The old fractional variable-font scale (620/650/680/700/720/730/740/760/780/800/820/840/850) is retired — Source Sans 3 and Fraunces aren't delivered as arbitrary-weight variable fonts over the web the way the old Roboto load was. Three weights cover everything:

| Weight | Role |
|---|---|
| `var(--fw-regular)` (400) | Body text, resting-state interactive elements (inactive tab/chip/segment), captions |
| `var(--fw-medium)` (600) | Active/selected states, card and panel titles, emphasis, `h2`-level heads |
| `var(--fw-display)` (700) | `h1` only, via `--font-serif` |

**Rule:** resting-state interactive elements (tabs, chips, segmented controls) are `--fw-regular`; the moment one becomes `.active`/`.checked`/`.current`, it steps up to `--fw-medium`. This is the affordance signal now, replacing the old "everything interactive is 730" rule — color/background already carries the active state, so weight only needs to move once, not for every interactive element regardless of state.

The legacy base-sheet `:root` (§1, layer 1) carried its own `font-family` too; it has been deleted outright (§1 table) rather than left to be overridden, since it was fully dead code.

---

## 3. The material

**Flat, opaque, bordered.** No `backdrop-filter`, no translucency-driven color, no diffraction. Apply the whole recipe — a partial application (e.g. border without shadow) reads as unfinished, not intentionally minimal:

```css
background: var(--ap-surface);
border: 1px solid var(--ap-line);
border-radius: var(--ap-radius-md);  /* pick from the bucket table in §2a */
box-shadow: var(--ap-shadow-sm);     /* -md or -lg for larger/more elevated surfaces */
backdrop-filter: none;
```

Nested surfaces (inside a card/panel) step one shade darker instead of adding a shadow: `background: var(--ap-surface-2)`, `border: 1px solid var(--ap-line)`, `box-shadow: none`.

**What's gone, deliberately:** the conic-gradient "diffraction" edge on card borders, the four-bloom ambient `body::before` gradient field, the scroll-reactive topbar blur/opacity interpolation, and the tap-position radial shimmer on buttons (`--tap`/`--px`/`--py` custom properties remain declared for the `.is-pressed` scale-down feedback only, not for a glow overlay).

### Navigation surfaces

`.topbar`, `.module-bar`, `.genre-bar`, `.sidebar` are all flat `var(--ap-surface)` with a 1px `var(--ap-line)` border on the relevant edge — no separate "navigation tint" recipe. The old distinction (navigation needed a darker base than content glass because saturated tiles bled through) doesn't apply once nothing is translucent.

---

## 4. Colour application — dashboard summary cards

Use semantic card variants and data-driven layouts. Card count and content may vary by role and product state; do not couple colour meaning to DOM position.

| Position | Gradient |
|---|---|
| 1 | `linear-gradient(168deg, #9c4a32, #7a3a26)` (rust) |
| 2 | `linear-gradient(168deg, #8a6428, #6b4d1e)` (amber-brown) |
| 3 | `linear-gradient(168deg, #3f6b4c, #2c4d37)` (sage) |
| 4 | `linear-gradient(168deg, #74405c, #573046)` (plum) |

> **Contrast rule stands regardless of palette.** Verify white-on-fill contrast whenever a card gradient changes — don't assume a "dark enough by eye" color clears 4.5:1. Nothing here has been instrument-measured; treat it as unverified until it is (see `HANDOFF.md`).

---

## 5. Geometry

Radius now comes from the `--ap-radius-*` bucket table in §2a, not fixed per-element pixel values. Historical per-element values (`12px` buttons, `20px`/`26px` cards, `30px` sheets) have been replaced by the bucket system; consult §2a rather than this section for a new component's radius.

**Breakpoints:** `1100px` (grid collapse) · `760px` (**the touch boundary** — sidebar becomes a bottom tab bar) · `620px` (onboarding). Unchanged by the redesign.

**Touch targets:** ≥`48px` under `@media (pointer: coarse)`; tab items `54px`; carousel controls `52px`. Never below 44px. Unchanged.

---

## 6. Motion

**Two durations, one curve.** `var(--ap-ease-fast)` (300ms) for buttons and interactive controls; `var(--ap-ease-slow)` (600ms) for cards, panels, and sheets. Both use `cubic-bezier(0,0,.2,1)` — a plain decelerate curve, deliberately **not** `ease-out`'s browser-default curve (that reads as slightly plush; this reads crisper) and deliberately **no spring/overshoot**.

`--lg-ease` and `--lg-spring` are both redefined to this same curve (see intro) so old call sites inherit correct, non-bouncy motion without per-site edits. New code should reference `--ap-ease-fast`/`--ap-ease-slow` directly rather than the `--lg-*` names.

**One exception:** `.evidence > summary::after`'s chevron rotation stays at a literal `.2s var(--lg-ease)` — a micro-affordance too small to need bucketing.

**Rules.** Elements still morph, expand, and crossfade rather than hard-switching — that behavior is unchanged, only the curve/duration and the removal of overshoot changed. Tap still sets `--px`/`--py` from pointer coordinates for the `.is-pressed` scale feedback (no more glow bloom at the contact point). Modals still grow from the originating control's measured rect.

---

## 7. Accessibility

- **Reduce Motion** keeps hierarchy and feedback, drops travel: `--tap` still fires on contact; transforms do not.
- Body text ≥4.5:1, large text ≥3:1. Labels and helper text are the usual failures — verify, don't assume.
- Sheets: `role="dialog"`, `aria-modal`, focus moves to the primary action, Escape closes, focus returns to origin.
- Toggles carry `aria-pressed` and a label that states the *next* state.
- Every interactive element keeps a visible focus ring.

---

## 8. Performance

Surfaces should remain opaque by default. Any translucent surface must be a documented, scoped design decision with an accessibility and performance check.

Scroll handlers: resolve the scroll port **once**; probing `scrollHeight` per frame forces layout. Coalesce to one style write per frame, and skip writes under a 0.004 delta. This guidance predates and is independent of the glass removal — it still applies to any scroll-driven layout read.

The old `@supports not (backdrop-filter)` opaque-fallback block has been deleted — every surface is unconditionally opaque now, so the fallback was dead code.

---

## 9. Invariants — traps already paid for

Each of these was a real bug. Don't re-introduce them.

1. **Media queries add no specificity.** Setting `position` in a shared material rule overrode `position: fixed` on the mobile tab bar and threw it to the top of the page. **Keep `position` out of shared material rules.**
2. **Don't blanket `z-index` onto children.** `.app-shell > * { z-index: 1 }` flattened the tab bar's `60`, letting cards paint over it. Scope to the content element.
3. **`1fr` means `minmax(auto, 1fr)`.** That `auto` floors the track at the child's min-content — a 463px track inside a 349px card. Use **`minmax(0, 1fr)` + `min-width: 0`** on any grid/flex child holding long text or a file input.
4. **`flex: 0 0 auto` exposes `width: 100%`.** The base sheet sets `.nav-btn { width: 100% }`; a non-growing basis resolved it against the whole bar, so one tab filled it. Pair with explicit `width: auto`.
5. **Hard-coded hex survives token swaps.** `#fbfcfb`/`#ffffff` backgrounds and a bare `label { color: #39443e }` (~1.5:1 on dark) stayed put through the theme change. **Grep for literal hex before shipping a theme.**
6. **Blurring a tight array squares off the glow.** Edge-clamp turns a blurred disc into a rectangle — pad first, or use a true radial falloff.
7. **Never latch on a pending rAF id.** One dropped frame leaves the flag stuck and scroll updates die permanently. Include a timeout self-heal.
8. `:has()` is used for tab-count layout. Unsupported browsers drop the rule — ensure the default still degrades sanely.
9. **`viewport-fit=cover` is mandatory.** Without it `env(safe-area-inset-*)` resolves to `0` and every safe-area rule silently does nothing. This shipped broken once — the tab bar sat under the home indicator on notched iPhones while looking correct on desktop.
10. **iOS Safari paints `<button>` text in system blue** unless an explicit `color` is set. Card surfaces are buttons, so headings inside them turned blue on iPhone and were fine everywhere else. Set `color` on any button-based surface.
11. **Text inputs need `type` + `autocapitalize`.** An untyped email field is a plain text field on iOS: it auto-capitalises and auto-corrects, and login fails with a valid address. Always set `type`, `inputmode`, `autocapitalize`, `autocorrect`, `spellcheck`.

12. **An ID selector beats `.view { display: none }`.** `#profile { display: grid }` is 1-0-0 against 0-1-0, so the profile card rendered underneath *every* page. Any per-view rule that sets `display` must be written as `#id.view.active`.
13. **Never bind a click handler that a delegated handler already covers.** `renderNav()` bound each nav button *and* a delegated `[data-route]` listener existed — so `showRoute` ran twice per tap, fetching each route's data twice and pushing a bogus history entry. Symptoms are subtle until something counts invocations.
14. **A JS cleanup timeout must match its CSS transition-duration, not approximate it.** `closeGlassSheet()`'s `setTimeout(done, …)` fired at 420ms while `.glass-sheet`'s own transform transition (the documented "sheet 560ms" token) ran for a full 560ms — so the sheet's content was wiped and `hidden`/`display:none` applied 140ms before the slide-down animation actually finished, cutting it off mid-flight. Whenever a duration appears in both a `transition`/`animation` declaration and a paired `setTimeout`, they are the same number by construction, not by coincidence — changing one without the other is how this drifts back in.

**Superseded (Chroma Bloom / Liquid Glass / Premium Evolved era — kept here as history, not current rules):** invariants 15–16 and 19 from the prior version of this doc governed which surfaces got `backdrop-filter` and a z-index map for glass overlays. They no longer apply: nothing in Academic Premium uses `backdrop-filter`, so there is no full-glass-vs-tint-only distinction to maintain, and overlay z-indexing is a plain stacking concern (scrim below sheet, both above content) with no blur-budget dimension.

**Academic Premium invariants:**

15. **Do not reintroduce the retired glass treatment without an explicit design decision.**
    - **One deliberate, scoped exception (2026-08-22, product-owner decision; retuned 2026-08-23): the mobile (`≤760px`) bottom tab bar.** `.sidebar` at that breakpoint is `color-mix(in srgb, var(--ap-surface) 62%, transparent)` with `backdrop-filter: saturate(160%) blur(24px)` — see the "Panoramic layout" note in §9 and the comment above `.sidebar` in `frontend/index.html` (~line 3484). **As of 2026-08-23 the bar is permanently visible** — the earlier hidden-by-default/reveal-on-scroll/5s-auto-hide mechanism (`.bar-visible`, `revealBar()`) was removed outright per product-owner instruction; there is no hidden state to toggle. This does not license translucency anywhere else; treat it as a named, single-element carve-out, not a precedent. Desktop's `.sidebar` (the persistent 248px rail) is unaffected and stays flat/opaque per §3.
16. **Resting-state interactive elements are `--fw-regular`; `.active`/`.checked`/`.current` steps to `--fw-medium`.** Do not hardcode a numeric `font-weight` — every weight in the file should resolve through `--fw-regular`/`--fw-medium`/`--fw-display`.
17. **Motion durations are never approximate.** Two buckets only: `--ap-ease-fast` (300ms, buttons/controls) and `--ap-ease-slow` (600ms, cards/panels/sheets). The one named exception is `.evidence > summary::after`'s chevron (`.2s var(--lg-ease)`, a micro-affordance). Do not invent a third duration.
18. **`h1` is the only Fraunces selector.** Any other heading that wants emphasis uses `--fw-medium` in `--font-sans`, not the serif face — Fraunces at small sizes reads as a typo, not a design choice.
19. **A solid accent fill pairs with `--ap-accent-ink`; a tinted accent background pairs with plain `--ap-ink`.** Don't reach for `--ap-accent-ink` on a `--ap-accent-soft` background — it was tuned for legibility on the solid fill, not the tint (see §2 table).
20. **Palette constraint unchanged in spirit:** no interactive element uses a hue outside `--ap-accent` plus the four muted semantic tokens (`--green`/`--blue`/`--amber`/`--red`). The full 12-hue spectrum is reserved for data viz and the interest graph only.
    - **The interest graph canvas (`.ig-wrap` in `frontend/index.html`) is a deliberate, scoped exception to theme-flipping tokens entirely**, not just to the hue constraint: it declares its own fixed `--ig-bg`/`--ig-ink`/`--ig-muted`/`--ig-line`/`--ig-accent` set and stays dark regardless of the app's light/dark theme toggle (product-owner decision, 2026-08-22 redesign) — an Obsidian-style graph reads as a fixed explorable space, not a themed panel. Nothing outside `.ig-wrap`/`.ig-svg`/`#ig-detail` may read `--ig-*`; node color still resolves through the reserved 12-hue `--c-*` spectrum via CSS classes keyed on `data-cluster`, never inline hex.

> Invariants 9–11 only reproduce on a real touch keyboard. Verify in the iOS Simulator, not just a narrow desktop window.
>
> **Safari caches aggressively.** Re-opening the same URL in the Simulator can serve the old page and make a fixed bug look unfixed. Bust it with a query string (`?v=2`) before concluding anything.

---

## 8a. Back navigation

Back navigation must provide an accessible control or browser-history path. A swipe gesture may supplement it on touch devices, but must not be the only mechanism.

If a gesture is implemented, keep it scoped to the navigation surface, prevent accidental activation during scrolling, and test it alongside the accessible back path.

**Tap-to-navigate is unaffected and remains the only way to switch tabs** — ordinary short taps on `.nav-btn` (displacement under the 60px threshold) are untouched by the gesture above; this was verified explicitly, not just assumed, since the two live on the same element.

The app has real depth that no URL expresses:

```
tab → tutor pane → subject → chapter → chat
```

so `state.navStack` snapshots `{route, pane, subject, lessonKey, chatOpen}` on every navigation and `goBack()` restores it. Each push also calls `history.pushState`, so the **iOS edge-swipe goes back inside the app** instead of leaving it; `popstate` only consumes the event while the stack is non-empty.

**Every entry point that changes depth must call `pushNav()`.** There are five: `showRoute`, `showTutorPane`, `showTutorLibrary`, `showTutorChatWorkspace`, `selectTutorSubject`. Missing one produces a back-swipe that skips a level.

`navDepth` suppresses pushes from cascades — `showRoute()` calls `showTutorPane()` internally and that must not record a second entry. `navRestoring` does the same while unwinding. `resetNavStack()` runs on login and logout so the first screen is always a root. There is no more `updateBackButton()` — the stack model has no UI-visibility side effect to drive now that nothing renders based on `navStack.length` except the swipe gesture's own no-op guard.

## 9. Navigation shape

Four destinations, Profile last so it lands **bottom-right** on mobile:

```
Home · Tutor · Discover · Profile      (student)
Class Overview · Ingestion · Quizzes · Profile   (teacher)
Progress · Profile                     (parent)
```

**Desktop: notifications float as an independent chip** (`#notif-btn`), `position: fixed; right: 14px; top: calc(14px + safe-area-inset-top)` — not inside a topbar, which no longer reserves layout space (see "Panoramic layout" below). Deliberately uncrowded since agent-initiated nudges are the planned centre of gravity. Theme and sign-out were moved out of it into Profile. (`#back-btn`, which used to sit at the same top offset on the opposite corner, is gone as of 2026-08-23 — see §8a; `#notif-btn`'s own rule was split out from the old shared `#back-btn, #notif-btn` selector and is otherwise unchanged.)

**Mobile (≤760px): notifications live only on the 5th bottom-bar tab** (`#notif-nav-btn`, rendered by `renderNav()` alongside the role's routed items). `#notif-btn`'s floating chip is explicitly `display: none` under `max-width: 760px` — the bottom-bar tab already covers notifications there, and a second floating entry point in the same top-right corner would be a redundant, unreachable-past-the-thumb duplicate (2026-08-22 decision; previously both surfaces coexisted). Because `#notif-nav-btn` carries no `data-route`, it's wired through a dedicated `[data-open-notifications]` delegated handler rather than `showRoute` — same reasoning as `[data-route]` itself: `renderNav()` rebuilds this markup on every role switch, so a direct listener bound once would silently stop firing after the first rebuild.

### Panoramic layout (2026-08-22, product-owner decision; back-button removed 2026-08-23)

The global `.topbar` band is gone on **both mobile and desktop** — collapsed to `height: 0`, transparent, `pointer-events: none`, so it reserves no layout space and content runs edge to edge top to bottom. `.workspace` keeps `padding-top: calc(64px + safe-area-inset-top)` — not topbar clearance, but breathing room so page content doesn't sit directly under the floating `#notif-btn` chip (§9, above). **Notifications survive as the one remaining floating chip; back navigation no longer has a chip at all** — as of 2026-08-23 it is the swipe-on-`.sidebar` gesture described in §8a, not a UI element that occupies space near the top. See `frontend/index.html`'s "Panoramic layout" comment block (~line 2799) for the exact cascade mechanics (this is a deliberate final override of every earlier `.topbar` rule in the sheet, relying on source-order-wins at equal specificity per Invariant 1).

This is a scoped exception to §3's opaque-surfaces rule only insofar as the topbar no longer paints a surface at all (not a translucency exception — it is fully transparent and non-interactive). The mobile bottom bar's translucency is the separate, explicitly named exception in Invariant 15 — as of 2026-08-23 that bar is also permanently visible (no auto-hide) and doubles as the back-navigation surface via the swipe gesture in §8a.

`#profile` is a **single shared view** across roles — `renderProfile()` fills identity from `state.user`, and `[data-role-only]` blocks hide for other roles. Anything role-specific in Profile must use that attribute, not a duplicate view.

`.notif-dot` is the unread indicator on the bell — duplicated on both buttons since nothing currently toggles it (the feature is a real-but-empty stub); when unread state is wired up, both copies must be updated together. Keep it `hidden` until there is something real to show.

### Appearance control

Three options — **System / Light / Dark** — not a toggle. "System" is stored as *absence* of the `roognis-theme` key, so the OS keeps driving the theme after the user has visited the setting. `applyTheme(choice, persist)` resolves `system` through `matchMedia` at call time; the OS `change` listener only acts while the choice is `system`.

## 9a. Tutor module

Tutor, Quizzes, Diagrams and Videos are **one destination with four panes**, not four tabs — the bottom bar itself carries the role's routed destinations (see §9: four for student/teacher, two for parent, plus the mobile-only notifications tab).

| Class | Role |
|---|---|
| `.module-bar` | sticky rail under the topbar, `role="tablist"`, flat `--ap-surface` |
| `.module-tab` | pill; `.active` takes `--ap-accent-soft` + `--ap-accent` border |
| `.tutor-pane` | one per section; `.is-active` reveals it |

Routing: `showTutorPane(key)` is the sub-router; `state.tutorPane` persists the choice across visits; `openTutorPane(key)` deep-links from anywhere (the Home shortcuts use `data-pane-link`). Panes load lazily on first reveal so opening the module doesn't fire four sets of requests.

**Diagrams and Videos stay out of the rail until a subject is chosen.** Tutor and Quizzes are useful immediately; the other two only make sense once the student is inside a subject. `syncTutorModuleTabs()` toggles `[hidden]` on those two tabs based on `state.selectedTutorSubject`, and is called from every place that changes it — `selectTutorSubject`, `showTutorLibrary`, `openTutorLesson`, `applyLessonFromSession`, the `restoreNav` chat-open branch, and `showTutorPane` itself (so a fresh module entry is never stale). `showTutorPane` also redirects `diagrams`/`videos` back to `learn` outright when no subject is selected, so a Home-shortcut deep link (`data-pane-link="videos"` etc.) can't land on a pane whose tab is hidden. `.module-tab[hidden]` needs its own `display: none` — the base rule sets `display: inline-flex`, and `[hidden]` alone loses to that.

The panes' own `<h1>`s are hidden — the rail already names the section — but the rest of each `page-head` stays, because it carries live pills and actions.

### Generated visuals in the Diagrams pane

Three kinds behind one `.seg` selector (`#visual-kind`): **Concept map** (inert SVG), **Interactive** (a sandboxed explainer), **Picture** (the older diffusion path). The base `.seg` is already `repeat(3, 1fr)`, so the third button needed no new rule — only dropping `.seg-2`. A **fourth** kind would need a new modifier.

| Class | Role |
|---|---|
| `.rv-wrap` / `.rv-svg` | concept-map SVG; every colour a token, so a stored artifact re-themes with no re-render |
| `.rv-frame-wrap` / `.rv-frame` | the hole a sandboxed explainer sits in |
| `.rv-alt` | the `<details>` text alternative, shown for both |

**The explainer frame is the one surface this stylesheet does not reach.** It is an `<iframe sandbox="allow-scripts">` with an opaque origin, so CSS custom properties do not cross into it — `var(--ink)` inside resolves to nothing. Its palette is emitted server-side from `services/ai/visuals/theme-tokens.js`, which is the **one documented exception to §9 invariant 5**: the values are literal there because they cannot be anything else. The exception is one file, not scattered call sites, so a palette change is still a single edit — but if this sheet's tokens change, that file does not follow automatically.

Two consequences that look like bugs and are not:

- **Switching theme re-fetches the explainer.** Nothing here can restyle an opaque-origin document, so `applyTheme` calls `refreshMountedVisualFrame()` and the server re-renders with the other palette. It is a no-op unless a frame is actually mounted.
- **The frame paints `--surface` rather than being transparent.** Transparent looks tidier, but `color-scheme` makes the UA paint its own canvas behind the body — which renders as a black rectangle in dark mode. Observed, then fixed by painting the surface explicitly.

`clearVisualOutput()` **removes** the iframe node rather than hiding it: a hidden pane is `display: none`, which does not stop a document's timers, listeners or animation frames, so hiding would leave the previous explainer running under the next one.

### Answer provenance

Every RAG-backed tutor answer renders `.message-source`: a collapsed `<details>` holding the textbook passages the answer was built from, with chapter provenance and per-passage citations. The server sends them on the `answer_context` SSE event as `excerpts[]`.

This is a design rule, not a feature: **a curriculum-grounded claim is only checkable if the student can see the source.** Quoted material carries a left rule and muted type so it never reads as generated text.

> `ARCHITECTUREDesign.md` §8 demotes RAG to a retrieval subroutine. Showing the retrieved passages is what makes that boundary visible in the product.

## 9b. Discover feed

Google News/Discover's interaction model, not a dashboard: a sticky topic rail, then a calm vertical stream of self-contained card surfaces. No hero/landing panel above the feed — content starts immediately after the topic chips. Redesigned in full from the original lead-story-plus-list layout; see `HANDOFF.md` for the before/after.

| Class | Role |
|---|---|
| `.genre-bar` | sticky rail under the topbar, `overflow-x: auto`, snap, flat `--ap-surface` |
| `.genre-chip` | pill; resting state is transparent-on-surface, `.active` takes `--ap-accent-soft` + `--ap-accent` border |
| `.feed-card` | one card component for every story — kicker, meta row, headline, image, summary, topics, all inside `.feed-card-open` |
| `.feed-card--compact` | modifier applied only when `article.imageUrl` is genuinely absent — drops the media block for a denser text row. Never a fabricated placeholder thumbnail standing in for a missing image. |
| `.feed-card-kicker` | small accent-colored label above the meta row — `For you` on the personalised tab, or `Trending in {topic}` when `article.origin === 'hunt'`. Both are derived from real response fields, never a manufactured relevance score. |
| `.feed-card-menu` | the per-card ⋮ control — the *only* inline action. Opens a two-row `.card-menu` in the shared glass-sheet: Share, Not interested. Deliberately no Save/Follow row — neither has a signal kind or endpoint on `services/discover`, and inventing one would diverge the interest-graph module from `services/ai`'s (`test/graph.test.js` asserts they stay byte-identical). |
| `.feed-topic` | extracted topic chip, also reused by the interest graph's "Names you follow" row |

**HTML structure matters for click safety.** `data-article-id` lives *only* on `.feed-card-open` (the "open story" button), never on the outer `<article class="feed-card">`. `.feed-card-menu` is a **sibling** of `.feed-card-open`, not nested inside it — nesting two `<button>`s is invalid HTML and would make every kebab tap also fire the article-open handler, since `event.target.closest('[data-article-id]')` would match the ancestor.

Chips deliberately overflow the viewport; that rail scrolls, so an overflow check must measure `document.body.scrollWidth`, not element rects.

**Infinite scroll**, not click-to-load-more. An `IntersectionObserver` on the `#discover-more` sentinel (`rootMargin: '600px 0px'`) fires `loadDiscoverFeed(false)` before the user reaches the true bottom; a single skeleton card is appended below existing content during the fetch rather than replacing the page. Desktop gets a centered `680px` reading column (`@media (min-width: 900px) { #student-discover { max-width: 680px; margin-inline: auto } }`) rather than stretching cards across the full viewport.

Images fade in via a delegated capture-phase `'load'` listener adding `.is-loaded` to `.feed-card-media img` — not an inline `onload` attribute, matching the rest of the file's preference for delegation over per-element binding (`'load'` does not bubble, hence capture phase).

**Image resolution is a backend concern, not a frontend one.** A card's cover image can render up to 680px CSS width on a 2–3x retina display; BBC's RSS `<media:thumbnail>` (the only live image source today — all ten feeds in `services/discover/search/rss.js` are BBC) points at a 240px rendition sized for the old RSS-reader thumbnail. `search/rss.js`'s `upsizeIchefImage()` substitutes ichef's URL-encoded width segment for a larger step (`976px`) of the same asset before the URL is ever stored — nothing in `frontend/index.html` needs to know about this.

**Interest graph** (`.ig-*`) renders as a radial SVG: `YOU` at centre, genres on the inner ring, topics on the outer, radius ∝ weight, fill by cluster. Cluster colours live in `IG_CLUSTER_COLOR` in the script and mirror the spectrum tokens.

**Signals.** Impressions fire from one shared `IntersectionObserver` at `threshold: 0.6`, once per article. Dwell is flushed on sheet close. All signal posts are fire-and-forget — a failed signal must never interrupt reading.

> `apiJson` stringifies `body` itself. Passing `JSON.stringify(...)` double-encodes and the server rejects with `entity.parse.failed`.

## 10. Adding a component

1. Is it a **top-level card/panel** or **nested inside one**? Top-level → `var(--ap-surface)` + border + shadow (§3). Nested → `var(--ap-surface-2)` + border, `box-shadow: none`. Neither ever gets `backdrop-filter`.
2. Use tokens. No literal hex, no literal numeric `font-weight`.
3. Give it `position: relative` **only if** it's statically positioned and needs `::before`/`::after`.
4. Radius from the §2a bucket table. Touch target ≥48px.
5. Transitions use `var(--ap-ease-fast)` or `var(--ap-ease-slow)` (§6), and are neutralised under Reduce Motion.
6. Check both themes.

### Before shipping

Use the actual frontend parser/build and targeted browser checks; brace counting is not syntax validation.

- Verify at **375×812** and desktop, in **both themes**
- Confirm `document.body.scrollWidth === window.innerWidth` (no horizontal overflow)
- Check contrast on any new coloured surface
- Confirm no element overlaps the fixed tab bar

### Deploying

```bash
docker compose up -d --build frontend
```

---

## Related
