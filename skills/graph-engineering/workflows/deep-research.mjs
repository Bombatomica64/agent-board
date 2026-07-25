#!/usr/bin/env node
// deep-research.mjs — the canonical diamond, end to end (Codez steps 07/09).
//   scope -> fan out (parallel search) -> reduce (dedupe, code) -> verify (skeptics) -> synthesize (top tier)
//
// Usage:  node workflows/deep-research.mjs "your question"
//         GRAPH_ENGINE_MOCK=1 node workflows/deep-research.mjs "test"   # no tokens
import { diamond, verifyAll, trace } from "../lib/graph.mjs";
import { agent, cheapAgent, topAgent, MODELS } from "../lib/agent.mjs";

export async function deepResearch(question) {
  const done = trace("deep-research");

  const result = await diamond({
    input: question,

    // SCOPE (1 agent): break the question into independent angles.
    scope: async (q) => {
      const { angles } = await agent(
        `Break this research question into 3-5 independent sub-questions that can be researched in parallel.\nQuestion: ${q}`,
        { model: MODELS.mid, effort: "medium",
          schema: { type: "object", additionalProperties: false,
            properties: { angles: { type: "array", items: { type: "string" } } },
            required: ["angles"] } }
      );
      return angles;
    },

    // FAN OUT: one cheap-tier subagent per angle. Each carries its own context;
    // the orchestrator never holds all of them at once.
    work: (angle) =>
      cheapAgent(`Research this and return 1-3 crisp findings as bullet points:\n${angle}`),

    // REDUCE: plain code — flatten and dedupe. Free, no tokens.
    reduce: (chunks) => {
      const findings = chunks.flatMap((c) => c.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean));
      return [...new Set(findings)];
    },

    // SYNTHESIZE happens after verification below, so return reduced findings here.
    synthesize: (r) => r,
  });

  // VERIFIER GATE: each finding must survive 3 diverse-lens skeptics (2/3 vote).
  const survivors = await verifyAll(
    result,
    (finding) => [
      (f) => yesNo(`Is this factually correct? Answer YES or NO first.\n${f}`),
      (f) => yesNo(`Is this specific and non-trivial (not a truism)? YES or NO first.\n${f}`),
      (f) => yesNo(`Would a domain expert endorse this? YES or NO first.\n${f}`),
    ],
    { threshold: 2 }
  );

  // TOP-TIER SYNTHESIS: the single judgment node writes the cited answer.
  const report = await topAgent(
    `Write a concise, well-structured answer to: "${question}"\n\nUse only these verified findings:\n- ${survivors.join("\n- ")}`,
    { think: true }
  );

  done();
  return { report, verified: survivors.length, question };
}

async function yesNo(prompt) {
  const r = await cheapAgent(prompt);
  return /^\s*yes/i.test(r); // survive on YES
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(" ") || "What makes agent graphs more efficient than linear agent loops?";
  deepResearch(q).then((r) => {
    console.log(`\n=== REPORT (${r.verified} verified findings) ===\n`);
    console.log(r.report);
  }).catch((e) => { console.error(e); process.exit(1); });
}
