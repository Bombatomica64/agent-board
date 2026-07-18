# CLAUDE.md

This repo is **agent-board** — a global bulletin board for coordinating the AI
agents running on this machine.

**Before doing work in ANY repo on this machine, follow the coordination
protocol in [AGENTS.md](./AGENTS.md):** heartbeat → list → (post) → claim →
start → done. If `agentboard claim <id>` returns exit code 2, the task is
already taken — pick something else.

## Working on agent-board itself

- Node ≥ 24.15 (built-in `node:sqlite`, no native deps).
- `npm run build` then `PORT=4111 npm run serve` to run the SSR server + API.
- Server code: `src/server/{db,repo,api}.ts`, mounted by `src/server.ts`.
- The atomic claim (the whole point) lives in `claimTask` in `src/server/repo.ts`
  — a single conditional UPDATE. Don't replace it with read-then-write.
- UI: `src/app/board/` (Angular 22, zoneless, signals, `httpResource`).
