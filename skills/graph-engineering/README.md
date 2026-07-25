# graph-engineering

A self-contained Claude skill that turns linear multi-agent work into **graphs** —
fan-out, diamonds, routers, verifier gates, converging cycles, model tiering —
with **grounding anchors** so the graph stays honest.

Distilled from four sources:
- **Codez (@0xCodez)** — *Graph Engineering with Claude: 14-step roadmap* (the primitives)
- **Machina (@EXM7777)** — *How to master graph engineering* (the beginner framing + business builds)
- **Viv (@Vtrivedy10)** — *Towards Automating Eval Engineering* / LangChain (the eval loop)
- **Carlos Perez (@IntuitMachine)** — *From Loop Engineering to Graph Engineering?* (grounding & anchors)

## Layout
```
graph-engineering/
├── SKILL.md                 # skill entry point (Claude Code frontmatter)
├── package.json             # type:module, @anthropic-ai/sdk, npm scripts
├── bin/
│   └── ensure-board.sh      # start AgentBoard (clone+compose if needed) + register with Claude Code
├── lib/
│   ├── graph.mjs            # the primitives — pure orchestration, zero tokens
│   ├── agent.mjs            # in-process node: calls Claude (+ model tiers)
│   └── board.mjs            # board backend: delegate nodes to AgentBoard (Slack+Jira for agents)
├── workflows/               # runnable example graphs
│   ├── deep-research.mjs    # diamond + verifier + synthesis
│   ├── router-review.mjs    # conditional edge (diff review)
│   ├── discovery-loop.mjs   # converging cycle (unknown-size discovery)
│   ├── eval-harness.mjs     # Viv's eval-engineering loop
│   └── optimize-loop.mjs    # frozen calculator + optimizer + counter-metric (Goodhart-safe)
└── references/
    ├── 01-principles.md     # the 14 principles → primitives
    ├── 02-patterns.md       # copy-paste cookbook
    ├── 03-grounding-anchors.md    # Perez: the four loop failures + anchors
    ├── 04-eval-engineering.md     # Viv: the 5-step eval flow
    └── 05-orchestration-backends.md  # in-process vs AgentBoard + the optimization rule
```

## AgentBoard orchestration (optional)
Nodes can run in-process (default) or be delegated to **AgentBoard** — Slack+Jira
for agents, one Docker service on `:4111` (`github.com/Bombatomica64/agent-board`):
```bash
npm run board:up        # start it (clones+builds if missing) + register with Claude Code
```
Then `delegate()` / `runWorker()` from `lib/board.mjs` map graph nodes onto shared
Kanban tasks other agents claim and complete.

## Quick start
```bash
cd graph-engineering
npm install
export ANTHROPIC_API_KEY=…          # or `ant auth login`
npm run smoke                        # dry run, no tokens (GRAPH_ENGINE_MOCK=1)
node workflows/deep-research.mjs "what makes agent graphs faster than loops?"
GRAPH_DEBUG=1 node workflows/discovery-loop.mjs somefile.txt
```

## Use it as an installed skill
Move or symlink this folder into your skills directory (e.g.
`~/.claude/skills/graph-engineering`). The `SKILL.md` frontmatter lets it be
invoked by name.

## The mental model
- **Nodes are jobs, edges are data.** An "and then" with no data flow is a fake edge — cut it.
- **The diamond** (fan out → reduce → synthesize) is the workhorse; reduce is free code.
- **Default to `pipeline()`**, not a barrier — barrier latency is real, wasted time.
- **Verify on the edge** — a finding must survive skeptics before it's trusted.
- **Cycles must converge** — loop until N quiet rounds; dedupe against *everything* seen.
- **Tier the models** — cheap for the boring fan-out, top for the judgment node.
- **Anchor it** — at least one node reads ground truth; frozen rules; report-only until earned.
```
