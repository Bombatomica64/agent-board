#!/usr/bin/env node
// router-review.mjs — the conditional edge (Codez step 08).
// A router classifies a diff by size/risk, then the code ROUTES:
//   high -> parallel audit on distinct lenses -> judge panel
//   low  -> one quick pass
// The model judges at the node; the script decides at the edge (deterministic).
import { route, parallel } from "../lib/graph.mjs";
import { agent, cheapAgent, topAgent, MODELS } from "../lib/agent.mjs";

export async function reviewDiff(diff) {
  return route(
    diff,
    // CLASSIFY (cheap): the model classifies; the routing is code.
    async (d) => {
      const { risk } = await cheapAgent(
        `Classify this diff's risk as exactly "high" or "low". High = touches auth, data, money, concurrency, or is large.\n\n${d.slice(0, 4000)}`,
        { schema: { type: "object", additionalProperties: false,
            properties: { risk: { type: "string", enum: ["high", "low"] } }, required: ["risk"] } }
      );
      return risk;
    },
    {
      // HIGH edge: fan out reviewers on distinct lenses, then a judge synthesizes.
      high: async (d) => {
        const lenses = ["correctness / logic bugs", "security / injection / authz", "performance / concurrency"];
        const reviews = await parallel(
          lenses.map((lens) => () =>
            agent(`Review this diff strictly through the lens of ${lens}. List concrete issues with file:line if visible; say "none" if clean.\n\n${d}`,
              { model: MODELS.mid, effort: "high" })),
        );
        const verdict = await topAgent(
          `You are the lead reviewer. Merge these lens reviews into a single prioritized verdict (most severe first). Drop duplicates and non-issues.\n\n${reviews.map((r, i) => `## ${lenses[i]}\n${r}`).join("\n\n")}`,
          { think: true }
        );
        return { path: "high (parallel audit + judge panel)", verdict };
      },
      // LOW edge: one quick pass. Also the default if the classifier is unsure.
      low: async (d) => ({
        path: "low (one quick pass)",
        verdict: await cheapAgent(`Quick review — flag anything obviously wrong, else "looks fine":\n\n${d}`),
      }),
      default: (d, key) => ({ path: `default→low (unclassified: ${key})`, verdict: "no clear risk signal; treated as low" }),
    }
  );
}

const SAMPLE = `--- a/auth.js\n+++ b/auth.js\n@@\n-  if (user.token === expected) return true;\n+  if (user.token == expected) return true; // loosened check\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  // Reads a diff from stdin, or uses a tiny sample.
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => run(chunks.join("") || SAMPLE));
  if (process.stdin.isTTY) run(SAMPLE);
  function run(diff) {
    reviewDiff(diff).then((r) => {
      console.log(`\nrouted -> ${r.path}\n`);
      console.log(r.verdict);
    }).catch((e) => { console.error(e); process.exit(1); });
  }
}
