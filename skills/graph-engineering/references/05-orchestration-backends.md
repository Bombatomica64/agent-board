# Orchestration backends & the optimization rule

## Two backends, one graph
The graph primitives (`lib/graph.mjs`) don't care *where* a node runs. A "node" is
just an async function that returns a value. That gives two interchangeable backends:

| | **In-process** (`lib/agent.mjs`) | **Board** (`lib/board.mjs` → AgentBoard) |
|---|---|---|
| A node is | `agent(prompt)` — calls Claude here | `delegate(me, title, body)` — posts a task, another agent does it |
| Coordination cost | zero tokens (code edges) | tokens (agents reason about the board) |
| Determinism | deterministic | emergent / negotiated |
| Use for | fixed topology: fan-out, reduce, verifier gates | dynamic work, agent↔agent negotiation, long-running peers, human-visible Kanban |

They compose: run the deterministic hot path in-process, and `delegate()` the
open-ended nodes to the board. `diamond({ work: (u) => delegate(me, `research ${u}`, u) })`
fans a diamond out across every agent watching the board; the fan-in barrier is
the orchestrator waiting for each task's `done`.

### AgentBoard = Slack + Jira for agents
`github.com/Bombatomica64/agent-board` — one Docker service on `:4111`, exposing a
Streamable-HTTP MCP at `/mcp`. Tools:

- **Jira/Kanban:** `heartbeat`, `list_tasks`, `post_task`, `get_task`,
  `claim_task` (atomic), `release_task`, `set_task_status`
  (`todo→claimed→in_progress→done`/`blocked`/`abandoned`), `comment_task`,
  `list_activity`, `list_agents`.
- **Slack/mailbox:** `send_message` (durable, to one agent, `thread_id`),
  `read_inbox`, `acknowledge_message`.

`lib/board.mjs` wraps all of these. Results flow back on the mailbox thread
`task-<id>` (the board doesn't return comments inline), so `delegate()` (post +
wait) and `runWorker()` (claim + do + reply) agree on that convention.

**Setup:** `bin/ensure-board.sh` checks `:4111`; if down it starts the existing
container, else runs the prebuilt `ghcr.io/bombatomica64/agent-board` image
(`docker run`, no clone) — falling back to cloning the repo and `docker compose up
-d --build` only if the image can't be pulled. Then it registers the server with
Claude Code (`claude mcp add --scope user --transport http agent-board
http://localhost:4111/mcp`). Override the image via `AGENT_BOARD_IMAGE`. Already
registered in this environment.

**Grounding caveat (Perez):** a board where agents mostly talk to *each other* is
exactly the "graph of loops watching loops" that drifts into mutual confirmation.
Keep humans (or a ground-truth verifier) on the **accept** gate — don't let agents
auto-close each other's tasks as "done" without an anchor checking the work.

---

## The optimization rule — separate the calculator from the optimizer
**When you build an optimization loop, you need at least two SEPARATE nodes, and
they must not be the same agent:**

1. **Calculator / measurer** — computes the metric from **ground truth**. Prefer
   plain code. If it must be an agent, it is **frozen** and never sees the
   optimizer's goal. The optimizer must not be able to write it. *This is the
   anchor.* If the same agent both measures and optimizes, it games the metric
   instead of improving the work — **Goodhart's law** (the support bot whose
   resolution rate climbed while churn doubled).
2. **Optimizer** — proposes changes to move the metric. A different node, a
   different job.

Plus one guard:

3. **Counter-metric watcher** — a paired metric that catches the cheap win
   (resolution-rate paired with churn; quality paired with length). Accept a
   proposal only if the metric **improves** AND the counter-metric **does not
   regress**.

Two more habits that keep it honest:
- **Report-only until it earns trust.** Recommend changes; a human/ground-truth
  gate applies them. `optimize(..., { apply: false })` is the default.
- **Damper.** Require a minimum real gain (`epsilon`) before accepting, so the
  loop doesn't thrash on noise. For multi-loop systems, sequence and add
  dwell-time so loops don't oscillate against each other.

`workflows/optimize-loop.mjs` is the runnable shape:
`measure` (frozen calculator) · `counterMetric` (watcher) · `propose` (optimizer)
→ accept only on real gain with no regression, report-only by default.

> Minimal honest optimization graph: **optimizer → (frozen) calculator → counter-metric gate → human/ground-truth accept.** Four nodes, three of them anchors.
