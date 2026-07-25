# Eval engineering as a graph

From Viv (@Vtrivedy10), "Towards Automating Eval Engineering" (LangChain). The 5-step flow, and why it's a loop of loops.

## The flow (the diagram)
```
1. Map agent definition & behavior from repository + traces
2. Propose eval directions to user      ◄─────────────┐
3. Build Harbor tasks                                  │
4. Run agent and verifier                              │ "next eval"
5. Revise or accept eval  ─────────────────────────────┘
```

1. **Map the agent surface.** Read the repo — prompts, models, tools, skills, hooks — and the data/services behind them (API calls). If traces are available (e.g. via `langsmith-cli`), mine them: traces show how tools behave in practice — arguments, results, errors — the observed contracts you reproduce in a controlled environment.
2. **Propose directions, interview the user.** Interviewing beats one-shot generation for eval acceptance. The user picks a direction and answers questions like *which tools/dependencies run live vs are simulated* (tool calls that cost money or write to prod get simulated, not run every invocation).
3. **Build Harbor tasks.** Each task = **an instruction** (given to the agent at start) + **an environment** (a Dockerfile: what to install, what data to seed) + **a verifier** (scores whether the task was completed correctly).
4. **Run agent and verifier.** Harbor runs the agent in the environment and records its trajectory, artifacts, reward, and errors. The same eval then runs against different models, prompts, tools, and versions.
5. **Revise or accept.** The first verifier is rarely the final one. Inspect **both** sides: the agent trajectory (messages, tool calls, actions) *and* the verifier trajectory (evidence, reasoning, score). This reveals whether you're measuring what you care about or whether it can be **reward-hacked** — over-citing irrelevant sources for full credit, claiming an action never taken, exploiting exposed answer material, satisfying a proxy without doing the task.

## Why it belongs in this skill
- It's the **outer loop** that grounds the inner agent graphs. Evals are the audit loop from `03-grounding-anchors.md`: their whole job is to check that the agent's numbers still touch reality.
- "Evals rhyme with training data" — the same rigor you put into data curation goes into eval design.
- Continual learning = a continuous data-mining problem: point agentic compute at every trace, mine errors, fix + test, turn each into a data point.

## In the code here
`../workflows/eval-harness.mjs` implements steps 2–5 as a `pipeline`:
`proposeEval → runAndGrade`, where the grader explicitly hunts for reward-hacking
and checks against a golden-answer criterion (the frozen anchor). Swap the demo
`runAgent` for your real agent; feed `proposeEval` a real repo/trace summary.
