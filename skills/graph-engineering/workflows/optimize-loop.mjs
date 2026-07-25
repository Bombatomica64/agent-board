#!/usr/bin/env node
// optimize-loop.mjs — how to build an OPTIMIZATION graph without fooling itself.
//
// THE RULE (your question, answered): an optimization loop needs AT LEAST two
// SEPARATE nodes, and they must not be the same agent:
//   1. a CALCULATOR / MEASURER  — computes the metric from GROUND TRUTH.
//      Prefer plain code; if it must be an agent, it's frozen and never sees the
//      optimizer's goal. This is the anchor (Perez). The optimizer must NOT be
//      able to write it — or it games the metric instead of improving the work
//      (Goodhart).
//   2. an OPTIMIZER — proposes changes to move the metric.
// And you add a third guard:
//   3. a COUNTER-METRIC watcher — a paired metric that catches the cheap win
//      (resolution-rate paired with churn). A proposal is accepted only if the
//      metric improves AND the counter-metric does not regress.
//
// Extras that keep it honest: report-only until it earns trust, and a damper so
// it won't apply a change while the metric is oscillating.

import { agent, cheapAgent, topAgent, MODELS } from "../lib/agent.mjs";

/**
 * @param subject         the thing being optimized (state you can mutate)
 * @param measure         (subject) -> number   CALCULATOR. Deterministic. Frozen. Ground truth.
 * @param counterMetric   (subject) -> number   watcher; lower is better, must not regress
 * @param propose         (subject, metric, counter) -> candidateSubject   OPTIMIZER
 * @param opts.rounds     max rounds
 * @param opts.apply      false = report-only (default): recommend, never mutate
 * @param opts.epsilon    min metric gain required to accept (damper vs oscillation)
 */
export async function optimize(subject, { measure, counterMetric, propose, rounds = 5, apply = false, epsilon = 1e-6 }) {
  let current = subject;
  let metric = await measure(current);            // CALCULATOR — separate node
  let counter = counterMetric ? await counterMetric(current) : 0;
  const log = [{ round: 0, metric, counter, action: "baseline" }];

  for (let r = 1; r <= rounds; r++) {
    const candidate = await propose(current, metric, counter);   // OPTIMIZER — separate node
    const candMetric = await measure(candidate);                 // re-measured by the SAME frozen calculator
    const candCounter = counterMetric ? await counterMetric(candidate) : counter;

    const improved = candMetric > metric + epsilon;              // real gain, past the damper
    const noRegression = candCounter <= counter + epsilon;       // counter-metric guard (Goodhart)
    const accept = improved && noRegression;

    log.push({ round: r, metric: candMetric, counter: candCounter,
      action: accept ? (apply ? "applied" : "recommended") : (!improved ? "rejected: no gain" : "rejected: counter-metric regressed") });

    if (accept) {
      if (apply) { current = candidate; metric = candMetric; counter = candCounter; }
      else return { result: current, recommendation: candidate, metric, candMetric, log, mode: "report-only" };
    }
  }
  return { result: current, metric, counter, log, mode: apply ? "applied" : "report-only" };
}

// --- demo: optimize a prompt for a scoring rubric ----------------------------
// CALCULATOR is a *separate, frozen* judge that only scores against the rubric —
// it never sees the optimizer's instruction to "improve the score", so it can't
// be talked into inflating it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const RUBRIC = "Answer must: (a) define the term, (b) give one concrete example, (c) stay under 40 words. +1 per criterion met, ground each in the actual text.";
  const question = process.argv.slice(2).join(" ") || "Explain what a graph 'diamond' is in agent orchestration.";

  const measure = async (prompt) => {
    const answer = await cheapAgent(`${prompt}\n\nQ: ${question}`);
    const { score } = await agent(
      `Score this answer 0-3 STRICTLY against the rubric. Only count a criterion if you can point to it.\nRUBRIC: ${RUBRIC}\nANSWER: ${answer}`,
      { model: MODELS.mid, effort: "low",
        schema: { type: "object", additionalProperties: false, properties: { score: { type: "integer" } }, required: ["score"] } }
    );
    return score;
  };
  const counterMetric = async (prompt) => {           // paired metric: verbosity (lower better)
    const answer = await cheapAgent(`${prompt}\n\nQ: ${question}`);
    return answer.split(/\s+/).length;                // words — the cheap way to "win" is to pad, this catches it
  };
  const propose = (prompt) =>                          // OPTIMIZER — different agent, different job
    topAgent(`Rewrite this instruction so answers score higher on the rubric WITHOUT getting longer.\nRUBRIC: ${RUBRIC}\nCURRENT INSTRUCTION: ${prompt}\nReturn only the improved instruction.`);

  optimize("Answer the question.", { measure, counterMetric, propose, rounds: 3, apply: false })
    .then((r) => { console.log(`\nmode: ${r.mode}`); console.table(r.log); if (r.recommendation) console.log("\nRECOMMENDED INSTRUCTION:\n" + r.recommendation); })
    .catch((e) => { console.error(e); process.exit(1); });
}
