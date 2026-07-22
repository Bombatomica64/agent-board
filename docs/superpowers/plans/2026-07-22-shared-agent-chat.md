# Shared Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact Slack-like transcript where a human can inspect every durable agent message and send a direct message to any known agent.

**Architecture:** Keep `messages` as the single durable source of truth. Add a read-only global transcript query and HTTP endpoints, then render a standalone Angular chat component using the existing `BoardService` polling loop and visual tokens. Native controls remain preferable because neither Spartan nor Angular Aria offers a chat primitive, and Spartan would require introducing Tailwind solely for this surface.

**Tech Stack:** Node SQLite repository, Express JSON API, Angular 22 standalone components, signals and `httpResource`, Vitest, semantic HTML/ARIA.

## Global Constraints

- Preserve direct mailbox delivery and acknowledgement semantics for agents.
- Human users may inspect the global transcript and send direct messages.
- Keep the interface compact, keyboard accessible, SSR-safe, and consistent with the existing developer-tool styling.
- Do not add Spartan/Tailwind or Angular Aria when native HTML supplies the required semantics.

---

### Task 1: Public transcript data access

**Files:**

- Modify: `src/server/repo.ts`
- Modify: `src/server/api.ts`
- Test: `src/server/repo.spec.ts`

**Interfaces:**

- Produces: `listMessages({ after_id?, limit? }): MailMessage[]`
- Produces: `GET /api/messages` and `POST /api/messages`

- [ ] **Step 1: Write failing repository tests**

Assert that messages to different recipients appear together in chronological order and that pagination accepts `after_id`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test`

Expected: FAIL because `listMessages` is absent.

- [ ] **Step 3: Implement repository query and validated API routes**

Return at most 200 messages ordered oldest-first. Require non-empty `from`, `to`, and `message` fields when posting.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

### Task 2: Angular chat data and component

**Files:**

- Modify: `src/app/board/models.ts`
- Modify: `src/app/board/board.service.ts`
- Create: `src/app/chat/chat.ts`
- Create: `src/app/chat/chat.html`
- Create: `src/app/chat/chat.scss`
- Modify: `src/app/board/board.ts`
- Modify: `src/app/board/board.html`

**Interfaces:**

- Consumes: `GET /api/messages`, `POST /api/messages`, and `GET /api/agents`
- Produces: `<app-chat [identity]="identity()" />`

- [ ] **Step 1: Add typed `MailMessage` model and service resource**

Poll the transcript with existing board resources and expose `sendMessage(from, to, message)` as an imperative mutation.

- [ ] **Step 2: Build semantic transcript and composer**

Use a labelled native recipient `<select>`, timestamped `<ol>` transcript, textarea, explicit empty/loading/error states, and Enter-to-send with Shift+Enter for a newline.

- [ ] **Step 3: Add the Board/Chat view switch**

Keep identity global, replace the board workspace with chat when selected, and preserve existing task/archive behavior.

- [ ] **Step 4: Add compact responsive styling**

Use the existing surface, line, text, and accent tokens. Collapse the agent rail on narrow screens and keep the composer reachable without page-level horizontal scrolling.

### Task 3: Verification and documentation

**Files:**

- Modify: `README.md`
- Test: `src/app/chat/chat.spec.ts`

**Interfaces:**

- Consumes: completed API and UI.
- Produces: documented shared transcript behavior.

- [ ] **Step 1: Add component interaction tests**

Assert recipient selection, disabled empty submission, and successful send behavior with a stubbed service.

- [ ] **Step 2: Run all tests and production build**

Run: `npm test && npm run build && git diff --check`

Expected: all tests pass, build exits 0, and diff check is clean.

- [ ] **Step 3: Inspect the live interface**

Verify desktop and narrow layouts, keyboard focus, readable transcript grouping, composer behavior, and visible mutation failures in the shared browser preview.
