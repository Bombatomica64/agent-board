# Board Hardening and UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce task lifecycle ownership, restore executable tests, and improve the board's usability and visual clarity.

**Architecture:** Keep SQLite lifecycle rules in the repository layer and translate typed outcomes into precise HTTP responses. Keep Angular reads resource-driven, expose mutation failures explicitly, and polish the existing single-page board without adding dependencies.

**Tech Stack:** Node 24, Express 5, SQLite, Angular 22, SCSS, Vitest

## Global Constraints

- Preserve atomic claiming and the machine-global board model.
- Do not add authentication; identities remain cooperative, but ownership invariants are enforced.
- Use Angular signals, `httpResource`, native typed events, standalone components, and OnPush change detection.
- Meet WCAG-oriented keyboard focus, contrast, labeling, and reduced-motion expectations.

---

### Task 1: Lifecycle integrity

**Files:**
- Modify: `src/server/repo.ts`
- Modify: `src/server/api.ts`
- Test: `src/server/repo.spec.ts`

**Interfaces:**
- Produces: typed `ReleaseResult` and `StatusResult` outcomes consumed by the API router.

- [ ] Add failing repository tests for cross-owner release, invalid transitions, stale ownership, and missing-task comments.
- [ ] Run `npm test` and confirm the lifecycle cases fail.
- [ ] Make release conditional on ownership, validate status transitions, clear stale ownership, and reject comments for missing tasks.
- [ ] Map conflicts to HTTP 409, invalid transitions to 422, and missing records to 404.
- [ ] Run `npm test` and confirm the lifecycle tests pass.

### Task 2: Test harness and client errors

**Files:**
- Modify: `src/app/app.spec.ts`
- Modify: `src/app/board/board.service.ts`
- Modify: `src/app/board/board.ts`
- Test: `src/app/app.spec.ts`

**Interfaces:**
- Produces: `BoardService.errorMessage` for visible mutation feedback.

- [ ] Correct the stale application smoke test and use explicit Vitest imports.
- [ ] Preserve 409 as a normal claim conflict while surfacing other HTTP failures.
- [ ] Add visible dismissible mutation feedback and ensure component actions await failures safely.
- [ ] Run `npm test` and confirm the suite passes.

### Task 3: Focused product UI polish

**Files:**
- Modify: `src/app/board/board.html`
- Modify: `src/app/board/board.scss`
- Modify: `src/app/board/board.ts`

**Interfaces:**
- Consumes: current board resources and `BoardService.errorMessage`.

- [ ] Replace `$any()` template escapes with typed input and select handlers.
- [ ] Improve hierarchy, task creation, empty states, responsive layout, status cues, and action labels.
- [ ] Add focus-visible, disabled, loading, and reduced-motion states without new dependencies.
- [ ] Inspect the rendered board at desktop and narrow viewport sizes.

### Task 4: Verification

**Files:**
- Modify: `README.md` only if endpoint semantics require clarification.

**Interfaces:**
- Consumes: all changes above.

- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Review `git diff --check` and the final diff for unrelated changes.
- [ ] Mark the shared board task done only after every verification succeeds.
