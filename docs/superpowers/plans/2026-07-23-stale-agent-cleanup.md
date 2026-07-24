# Stale Agent Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove expired agent identities and prevent direct messages from being sent to them.

**Architecture:** Keep the `agents` table as the presence source of truth. A repository-level configurable TTL prunes expired rows before agents are listed or chosen as message recipients; the API and MCP layers translate an unknown-recipient result into a clear client error.

**Tech Stack:** Angular 22, Express 5, TypeScript, SQLite (`node:sqlite`), Vitest.

## Global Constraints

- Default agent retention is 24 hours; `AGENT_BOARD_AGENT_TTL_MS` may override it with a positive integer duration.
- Historical messages remain durable even when their sender or recipient identity expires.
- Only an active recipient is required for sending; humans may still use an arbitrary sender identity.

---

### Task 1: Expire agents and guard direct delivery

**Files:**
- Modify: `src/server/repo.ts`
- Modify: `src/server/repo.spec.ts`
- Modify: `src/server/api.ts`
- Modify: `src/server/mcp.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `AGENT_TTL_MS: number`, `listAgents(): Agent[]`, and `sendMessage(...): SendMessageResult`.
- Consumes: `heartbeat()` writes `last_seen`; REST and MCP call `sendMessage()`.

- [x] **Step 1: Write failing repository tests**

```ts
it('removes expired agents before listing or addressing them', () => {
  repo.heartbeat({ name: 'current' });
  repo.heartbeat({ name: 'expired' });
  database.prepare('UPDATE agents SET last_seen = ? WHERE id = ?')
    .run(Date.now() - repo.AGENT_TTL_MS - 1, 'expired');

  expect(repo.listAgents().map(({ id }) => id)).toEqual(['current']);
  expect(repo.sendMessage({ sender: 'human', recipient: 'expired', body: 'hello' }))
    .toEqual({ ok: false, reason: 'recipient_not_found' });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/server/repo.spec.ts`

Expected: FAIL because stale agents remain listed and `sendMessage` always inserts a message.

- [x] **Step 3: Implement the minimal cleanup and result handling**

```ts
export const AGENT_TTL_MS = readPositiveDuration('AGENT_BOARD_AGENT_TTL_MS', 24 * 60 * 60 * 1000);

function pruneExpiredAgents(): void {
  db().prepare('DELETE FROM agents WHERE last_seen < ?').run(now() - AGENT_TTL_MS);
}

export function sendMessage(input: MessageInput): SendMessageResult {
  pruneExpiredAgents();
  if (!db().prepare('SELECT 1 FROM agents WHERE id = ?').get(input.recipient)) {
    return { ok: false, reason: 'recipient_not_found' };
  }
  // insert and return { ok: true, message }
}
```

Map `recipient_not_found` to HTTP 404 and an MCP tool error. Document the 24-hour retention and configuration variable.

- [x] **Step 4: Run focused and full verification**

Run: `npm test -- --run src/server/repo.spec.ts && npm run build`

Expected: tests pass and Angular SSR build exits 0.
