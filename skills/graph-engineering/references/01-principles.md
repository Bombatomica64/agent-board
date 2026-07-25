# The 14 principles of graph engineering

Distilled from Codez (@0xCodez) "Graph Engineering with Claude" and Machina (@EXM7777). The shift: a prompt is a sentence, a loop is a cycle, a harness is the floor — but the *shape of the work* (what runs before what, what runs at once, what waits for everything) is a **graph**. Nodes do the thinking; edges carry the results. Orchestration is code, so it costs zero model tokens.

Each principle maps to a primitive in `../lib/graph.mjs`.

1. **Nodes are jobs. Edges are what flows.** A node = one agent, one bounded job, one input, one output. An edge = a data dependency. "Summarize the file **and then** tell me the weather" has no edge — the weather never consumes the summary. The edge exists only when data actually moves. → every function takes a thunk.

2. **Your linear script is a degenerate graph.** "Do A, then B, then C" is a single unbranching chain: correct but slow and fragile (if C stalls, D never runs). The first skill is *redrawing* the chain — for each arrow ask "does the next step read the last step's output?" Cut the fake edges and the chain collapses into independent nodes that can run at once.

3. **Give every node a contract.** Bounded input, bounded output, exactly one job. Enforce output shape with a **schema** so the next node consumes it without guessing — validation at the tool-call layer, not free text you parse and pray over. → `agent(prompt, { schema })`.

4. **Treat the edge as a data contract.** An edge is a promise about what crosses: A produces this shape, B consumes it. Name edges by their data, not their order. Much of what people burn tokens on is really an edge — and edges are free code (flatten/dedupe/filter). → `reduce` steps.

5. **Fan out with `parallel()`.** N independent nodes → run them at once, not chained. It's a **barrier** (waits for all) and a thrown thunk resolves to `null` instead of sinking the batch — always `.filter(Boolean)`. Concurrency caps around core count; the excess queues. → `parallel()`, `withConcurrency()`.

6. **Fan in at a barrier.** The node where edges converge and one agent/one piece of code sees the whole set (dedupe across sources, rank, early-exit on empty). Use a barrier *only* when a stage genuinely needs every prior result together. `parallel → transform → parallel` with no cross-item dependency in the middle should have been a pipeline.

7. **The diamond: split → work → merge.** Fan-out + fan-in = the workhorse topology. Canonical form: **fan out → reduce → synthesize.** Fan out for breadth, reduce with code to compress, synthesize with a final agent to write the answer. Stop asking "how do I make the agent do more steps" and ask "where's the split, where's the merge." → `diamond()`.

8. **Route the edge at runtime with a conditional.** A router node inspects a result and picks the downstream path (classify the ticket → branch; check diff size → quick pass or full audit). The judgment can be Claude-powered but the routing is code, so it's deterministic. → `route()`.

9. **Put a verifier on the edge.** A verifier sits before a result is allowed downstream; its only job is to *try to kill the finding*. Three patterns: **adversarial** (N skeptics, keep on majority-survive), **perspective-diverse** (each verifier a distinct lens — correctness, security, reproducibility), **judge panel** (score N attempts, synthesize the winner). → `verify()`, `verifyAll()`.

10. **Isolate nodes so one failure can't poison the graph.** In a chain, failure cascades; in a graph, contain it to the node (`null` + `.filter(Boolean)`). Design every fan-in to tolerate missing inputs. When nodes write files in parallel, isolate them (a worktree each) — the seatbelt for the one topology that needs it, not a default tax.

11. **Add a cycle — but make it converge.** Unknown-size discovery, bug sweeps. Danger: a non-converging cycle spawns agents until the budget's gone. Pattern: **loop-until-dry** — keep going until K consecutive rounds surface nothing new. The make-or-break detail: **dedupe against everything seen, not just confirmed results**, or rejected items reappear every round. → `loopUntilDry()`.

12. **Tier the models across the nodes.** Bounded/repetitive nodes (extract, classify) → cheap model. Judgment nodes (synthesize, adjudicate) → top model. → `MODELS`, `cheapAgent`, `topAgent`.

13. **Topology is your cost and latency.** `parallel()` (barrier: everything waits for the slowest) vs `pipeline()` (no barrier: fast items finish early). **Default to `pipeline()`.** Reach for a barrier only when a stage truly needs every prior result at once. "It's cleaner code" is not a reason; barrier latency is real, measurable, wasted time. → `pipeline()`.

14. **Let Claude draw the graph — self-routing.** For jobs you can't plan in advance, describe the objective and let the model write the orchestration itself, then save the good runs as reusable, version-controlled workflows.

## Six graphs to build this week

- **Security sweep** — one subagent per route file hunts missing auth, verifier confirms each finding. (`route()` + `verifyAll()`)
- **Cited report** — decompose → parallel search → dedupe → adversarial-verify → write. (`deep-research.mjs`)
- **Port a module** — fan out translation across files, tests gate each, loop failures back. (`diamond()` + `loopUntilDry()`)
- **Adversarial diff review** — route on size; large → parallel lenses + judge panel. (`router-review.mjs`)
- **Scheduled ecosystem scan** — parallel sources → rank at a barrier → digest.
- **Unknown-size discovery** — finders in parallel, dedupe-all, verify, loop till dry. (`discovery-loop.mjs`)
