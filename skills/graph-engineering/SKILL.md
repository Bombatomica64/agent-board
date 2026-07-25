---
name: graph-engineering
description: >-
  Design and run multi-agent work as a GRAPH instead of a linear chain — fan-out,
  diamonds, conditional routing, verifier gates, converging cycles, and model
  tiering — with grounding anchors so the graph stays honest. Use when a task is
  multi-step and parts are independent (research, code review, bug/security
  sweeps, porting, eval building), when the user says "graph engineering",
  "parallelize agents", "fan out", "verify findings", "loop until done", or asks
  to turn a slow sequential agent into a faster parallel one. Provides runnable
  JS primitives (lib/) and example workflows (workflows/).
---

# Graph Engineering

Turn a straight-line agent ("step 1 waits for step 2 waits for step 3…") into a
graph that fans out across a fleet, verifies its own findings, and converges on a
result a lone agent could never hold. Orchestration is plain JavaScript, so
coordination costs **zero model tokens** — only the nodes call the model.

Synthesized from Codez (@0xCodez), Machina (@EXM7777), Viv (@Vtrivedy10), and
Carlos Perez (@IntuitMachine).

## When to use this
Reach for a graph when the work is multi-step AND some steps are independent:
research over many angles, reviewing/auditing many files, bug or security sweeps,
porting file-by-file, building evals. If the steps are genuinely sequential (each
truly needs the last one's output), a plain loop is fine — don't force a graph.

## How to use it

1. **Redraw the chain.** For every "and then" in the task, ask: *does the next
   step read the last step's output?* If not, the edge is fake and the wait is
   wasted. Cut it — those steps become parallel nodes. (See `references/01-principles.md`.)
2. **Pick the topology.** Most tasks are a **diamond**: split → work (fan out) →
   reduce (code) → synthesize. Add a **router** for conditional paths, a
   **verifier** before any result is trusted, a **cycle** for unknown-size work.
   Cookbook: `references/02-patterns.md`.
3. **Tier the models.** Cheap model for bounded/repetitive nodes; top model for
   the judgment node. `lib/agent.mjs` → `MODELS`, `cheapAgent`, `topAgent`.
4. **Ground it (don't skip).** Give the graph an anchor: at least one node that
   checks **ground truth** (source text, tests, golden answer), frozen scoring
   rules, and — for optimizing loops — a paired counter-metric. Run report-only
   until it earns authority. `references/03-grounding-anchors.md`.
5. **Run or adapt a workflow.** The files in `workflows/` are working graphs;
   copy the nearest one and swap the node prompts.

## Primitives (`lib/graph.mjs`)
`parallel` (barrier fan-out) · `pipeline` (no-barrier, the default) · `diamond`
(split→work→reduce→synthesize) · `route` (conditional edge) · `verify` /
`verifyAll` (skeptic gates) · `loopUntilDry` (converging cycle) ·
`withConcurrency` · `compact`. Every function takes plain async thunks; only
`lib/agent.mjs` spends tokens.

## Workflows (`workflows/`, all runnable)
- `deep-research.mjs` — the canonical diamond + verifier gate + top-tier synthesis.
- `router-review.mjs` — conditional edge: route a diff by risk to quick pass or parallel audit + judge panel.
- `discovery-loop.mjs` — converging cycle for unknown-size bug/issue finding, grounded against the source.
- `eval-harness.mjs` — Viv's eval-engineering loop: propose → run → grade (anti-reward-hacking).
- `optimize-loop.mjs` — optimization done right: a **frozen calculator** node + a
  separate **optimizer** node + a **counter-metric** gate (never let one agent
  both measure and optimize — that's Goodhart). Report-only by default.

## Optimization rule (read before building any optimizing loop)
An optimization graph needs at least **two separate nodes that are not the same
agent**: a calculator/measurer that computes the metric from **ground truth**
(prefer code; if an agent, frozen and blind to the goal — this is the anchor) and
a distinct optimizer that proposes changes. Add a **counter-metric** watcher and
accept a change only when the metric improves AND the counter-metric doesn't
regress. See `references/05-orchestration-backends.md`.

## Two orchestration backends
Nodes can run in-process (`lib/agent.mjs`, code edges, zero-token coordination,
deterministic) OR be delegated to **AgentBoard** (`lib/board.mjs`) — a Slack+Jira
board where other agents claim and complete tasks (dynamic, negotiated, human-
visible). They compose: deterministic hot path in-process, open-ended nodes on the
board. AgentBoard is one Docker service on `:4111`; run `bin/ensure-board.sh` to
start it (it runs the prebuilt `ghcr.io/bombatomica64/agent-board` image, building
from source only as a fallback) and register it with Claude Code. Details:
`references/05-orchestration-backends.md`.

## Setup
```bash
cd graph-engineering
npm install                 # @anthropic-ai/sdk
export ANTHROPIC_API_KEY=…  # or: ant auth login
npm run smoke               # GRAPH_ENGINE_MOCK=1, spends no tokens
node workflows/deep-research.mjs "your question"
```
`GRAPH_ENGINE_MOCK=1` stubs the model so you can exercise a graph's *shape*
without spending tokens. `GRAPH_DEBUG=1` prints the run's structure.

## The one caveat (Perez)
A graph of loops where every node reads another node's output and nothing touches
the ground becomes "mutual confirmation where everything is consistent and
nothing is verified." Anchors are not optional — they're the difference between a
graph that improves things and one that fails later, more expensively, with more
green lights on the way down.
