# Patterns → primitives cookbook

Copy-paste starting points. Import from `../lib/graph.mjs` and `../lib/agent.mjs`.

## The diamond (fan out → reduce → synthesize)
```js
import { diamond } from "../lib/graph.mjs";
import { agent, cheapAgent, topAgent, MODELS } from "../lib/agent.mjs";

await diamond({
  input: task,
  scope:      async (t) => splitIntoUnits(t),        // 1 agent (or code)
  work:       (unit) => cheapAgent(prompt(unit)),    // fan out, cheap tier
  reduce:     (results) => dedupe(results.flat()),   // code, free
  synthesize: (r) => topAgent(writePrompt(r)),       // 1 judgment node
});
```

## Barrier vs pipeline — pick deliberately
```js
import { parallel, pipeline } from "../lib/graph.mjs";

// BARRIER: the next stage needs the whole set (cross-item dedupe, ranking).
const all = await parallel(units.map(u => () => work(u)));
const ranked = rankAcross(all);

// PIPELINE (default): each item flows independently; fast ones finish first.
const done = await pipeline(units, [stageA, stageB, stageC]);
```
Rule: if you wrote `parallel → transform → parallel` and the middle transform has
no cross-item dependency, you wanted a pipeline.

## Conditional edge (router)
```js
import { route } from "../lib/graph.mjs";
await route(input,
  async (x) => classify(x),          // returns a key
  { high: handleHigh, low: handleLow, default: handleLow });
```

## Verifier gate (try to kill the finding)
```js
import { verify, verifyAll } from "../lib/graph.mjs";

// One finding, 3 diverse-lens skeptics, 2/3 must survive:
const { passed } = await verify(finding, [correct, secure, reproduces], { threshold: 2 });

// Filter a whole list down to survivors:
const kept = await verifyAll(findings, (f) => [correct(f), secure(f)], { threshold: 2 });
```

## Converging cycle (loop-until-dry)
```js
import { loopUntilDry } from "../lib/graph.mjs";
const all = await loopUntilDry(
  async (seen) => findNew(seen),   // return items; dedupe is automatic
  { key: (x) => x.id, quietRounds: 2, maxRounds: 25 }
);
```
Critical: `findNew` must be *told* what's already `seen` and avoid it, and you
dedupe against **everything seen**, not just kept results.

## Model tiering
```js
import { agent, MODELS } from "../lib/agent.mjs";
agent(p, { model: MODELS.cheap, effort: "low" });   // extract/classify
agent(p, { model: MODELS.top,   effort: "high", think: true }); // synthesize/judge
```

## Node with a contract (structured output)
```js
const { items } = await agent(prompt, {
  schema: { type: "object", additionalProperties: false,
    properties: { items: { type: "array", items: { type: "string" } } },
    required: ["items"] },
});
```
`additionalProperties: false` + `required` are mandatory for structured output.

## Delegate a node onto AgentBoard (distributed)
```js
import { delegate } from "../lib/board.mjs";
// node runs in ANOTHER agent that claims the task off the board:
await diamond({ input: task,
  scope: splitIntoUnits,
  work:  (u) => delegate("me", `research: ${u}`, u),   // posts task, awaits done
  reduce: dedupe, synthesize: writeUp });
```
See `05-orchestration-backends.md`.
