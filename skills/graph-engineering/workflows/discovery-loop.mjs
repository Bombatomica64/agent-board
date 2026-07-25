#!/usr/bin/env node
// discovery-loop.mjs — the converging cycle (Codez step 11), grounded per Perez.
// You don't know how many issues exist. Run finders in parallel each round,
// dedupe against EVERYTHING seen, verify survivors, and stop when 2 rounds
// surface nothing new. The anchor (Perez): a frozen, ground-truth check —
// here every candidate must be confirmable against the actual text, not just
// "consistent with other findings" (avoids mutual-confirmation collapse).
import { loopUntilDry, parallel, verifyAll } from "../lib/graph.mjs";
import { cheapAgent, agent, MODELS } from "../lib/agent.mjs";

export async function discover(corpus, lens = "bugs, risks, or inconsistencies") {
  const found = await loopUntilDry(
    async (seen) => {
      // Fan out several finders with different seeds so they explore differently.
      const seeds = ["obvious ones", "subtle / edge cases", "things others would miss"];
      const batches = await parallel(seeds.map((seed) => () =>
        cheapAgent(
          `Find ${lens} in the text below (focus: ${seed}). ` +
          `Do NOT repeat any of these already-found items:\n${[...seen].slice(0, 40).join("\n")}\n\n` +
          `Return one item per line, terse.\n\nTEXT:\n${corpus.slice(0, 6000)}`
        )));
      return batches.flatMap((b) => b.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean));
    },
    { key: (s) => s.toLowerCase().slice(0, 80), quietRounds: 2, maxRounds: 6 }
  );

  // ANCHOR / verifier: each candidate must be grounded in the actual corpus.
  const confirmed = await verifyAll(
    found,
    (item) => [
      (f) => grounded(`Can this claim be directly supported by quoting the TEXT? Answer YES only if you can point to specific evidence.\nClaim: ${f}\n\nTEXT:\n${corpus.slice(0, 6000)}`),
    ],
    { threshold: 1 }
  );

  return { candidates: found.length, confirmed };
}

async function grounded(prompt) {
  const r = await agent(prompt, { model: MODELS.cheap, effort: "low" });
  return /^\s*yes/i.test(r);
}

const SAMPLE = `The config loads api_key from the URL query string. Passwords are compared with ==.
Retries loop forever if the server returns 500. The cache never expires.`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const path = process.argv[2];
  const corpus = path ? fs.readFileSync(path, "utf8") : SAMPLE;
  discover(corpus).then((r) => {
    console.log(`\n${r.candidates} candidates -> ${r.confirmed.length} confirmed (grounded)\n`);
    r.confirmed.forEach((c, i) => console.log(`${i + 1}. ${c}`));
  }).catch((e) => { console.error(e); process.exit(1); });
}
