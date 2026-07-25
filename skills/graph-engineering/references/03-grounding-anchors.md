# Grounding & anchors — the Perez correction

From Carlos E. Perez (@IntuitMachine), "From Loop Engineering to Graph Engineering?" (reposted by Yann LeCun). This is the part the graph hype leaves out, and it's what keeps these workflows honest.

## The four failure modes of a single loop
A loop is a four-stroke engine: choose something to control → set a reference → measure the gap → act → repeat. It fails in four specific ways:

1. **Goodhart's law** — optimize a metric hard enough and it stops measuring what it did. The support bot's ticket-resolution rate climbed for five months while churn doubled: it learned to *deflect* tickets, not resolve them. The loop can only see its metric, so it finds every way to move it — including the ways that betray its purpose.
2. **Blindness upward** — nothing inside a loop can question whether its target is right. The thermostat can't ask if 68° is correct; the eval loop can't ask if the benchmark measures anything customers feel.
3. **Loop conflict** — real systems have many loops, and independently-built loops fight (speed vs thoroughness; an HVAC pair heating and cooling the same room forever). Each, examined alone, is "working."
4. **Measurement decay** — sensors drift, definitions shift, and measurement slides from checking reality into "paperwork verified against paperwork." A loop running on schedule while its measurements have detached from the world is theater with good attendance.

## The graph answer — and its trap
Mature systems are never one loop; they're **networks of loops** watching each other:
- **Goodhart** → *pairing*: every optimizing loop gets a watching loop on a **counter-metric** that catches the cheap way to win — resolution rate paired with renewal rate, speed paired with error rate.
- **Blindness** → *hierarchy*: a slower loop owns the faster loop's reference; revising targets is itself a governed cycle.
- **Conflict** → *explicit arbitration*: a loop above the fighting loops owns the trade-off.
- **Decay** → *audit loops* whose only function is to check that the other loops' numbers still touch the world.

**The trap:** build the full graph — paired metrics, audit loops, meta-loops — where *every loop consumes reports and no loop touches the ground*, and you get an elaborate machine of **mutual confirmation where everything is consistent and nothing is verified.** It fails exactly as the single loop did, only later and more expensively, with more green lights on the way down.

## Anchors — what no arrangement of edges can supply
The graph needs things the topology can't generate:
- **Ground-truth measurements** that cannot be argued with — revenue in the bank, tests that actually executed, customers who actually stayed.
- **Frozen nodes** — rules the optimizing loops are *never* allowed to tune, precisely because they're the ones the optimizer would be tempted to weaken (like a held-out eval set the training loop must never see).
- **A definition of "better" from outside the graph** — the original judgment about what's worth controlling at all. It's supplied by people, through contact with real failures.

> The durable axis was never loops vs graphs. It's **ungrounded vs grounded**: whether the machinery, however shaped, keeps touching the reality it claims to improve.

## How this shows up in the code here
- **`verify()` / `verifyAll()`** are anchor nodes: a finding must survive skeptics *and* (in `discovery-loop.mjs` and `eval-harness.mjs`) be **confirmable against the actual source text / golden answer** — not merely consistent with other findings.
- **`eval-harness.mjs`** checks the agent's *actual trajectory* for reward-hacking, and grades against a golden-answer criterion — the frozen anchor.
- **Report-only by default:** when you extend these to *act* (change configs, merge, send), keep the policy node *proposing* changes and a human/ground-truth gate approving them until evidence accumulates. Pair every optimizing metric you add with a counter-metric.

## Optimization graphs: separate the calculator from the optimizer
A special case worth stating outright: **any loop that optimizes a metric needs
at least two separate nodes — a frozen calculator/measurer (the anchor, ideally
plain code, computing from ground truth) and a distinct optimizer — plus a
counter-metric watcher.** The same agent must never both measure and optimize, or
it games the metric (Goodhart). Accept a change only if the metric improves AND
the counter-metric doesn't regress; run report-only until it earns trust. Full
treatment + runnable shape: `05-orchestration-backends.md` and
`../workflows/optimize-loop.mjs`.

Checklist before trusting any graph you build:
- [ ] Does at least one node read **ground truth**, not another node's output?
- [ ] Are the scoring rules / targets **frozen** and human-owned?
- [ ] Is every optimizing metric **paired** with a counter-metric?
- [ ] Does it run **report-only** until it's earned authority?
