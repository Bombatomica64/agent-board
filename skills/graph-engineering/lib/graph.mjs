// graph.mjs — the primitives of graph engineering.
// Runtime-agnostic: every function takes plain async task functions ("thunks").
// The model-calling part lives in agent.mjs; this file is pure orchestration
// and costs zero model tokens (it's code, not a conversation).

/**
 * Run an array of thunks with a concurrency cap.
 * A thunk that throws resolves to null instead of rejecting the whole batch,
 * so one flaky node can't sink the run. (Codez step 05.)
 */
export async function withConcurrency(thunks, concurrency = Math.max(2, (globalThis.navigator?.hardwareConcurrency ?? 4))) {
  const results = new Array(thunks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= thunks.length) return;
      try {
        results[i] = await thunks[i]();
      } catch (err) {
        results[i] = null; // contained: failure stays in its node
        if (process.env.GRAPH_DEBUG) console.error(`[node ${i}] failed:`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, thunks.length) }, worker));
  return results;
}

/** Drop the nulls a failed thunk leaves behind. Always .filter(Boolean) a fan-out. */
export const compact = (arr) => arr.filter(Boolean);

/**
 * FAN OUT — parallel() (Codez step 05).
 * A BARRIER: waits for every thunk before returning, so the next stage sees the
 * complete set. Use only when a downstream node genuinely needs all results at once.
 */
export async function parallel(thunks, opts = {}) {
  const raw = await withConcurrency(thunks, opts.concurrency);
  return opts.keepNulls ? raw : compact(raw);
}

/**
 * PIPELINE — pipeline() (Codez step 13). NO barrier: each item flows through all
 * stages on its own, so fast items finish early instead of idling behind slow ones.
 * DEFAULT TO THIS. Reach for a barrier only when a stage needs every prior result.
 */
export async function pipeline(items, stages, opts = {}) {
  const run = async (item) => {
    let v = item;
    for (const stage of stages) v = await stage(v);
    return v;
  };
  return parallel(items.map((it) => () => run(it)), opts);
}

/**
 * CONDITIONAL EDGE — route the edge at runtime (Codez step 08).
 * `classify` returns a key; `routes[key]` (or routes.default) fires. Control flow
 * lives in code, so it's deterministic for the same classification.
 */
export async function route(input, classify, routes) {
  const key = await classify(input);
  const handler = routes[key] ?? routes.default;
  if (!handler) throw new Error(`route: no handler for "${key}" and no default`);
  return handler(input, key);
}

/**
 * THE DIAMOND — split -> work -> reduce -> synthesize (Codez step 07).
 * The workhorse topology. `reduce` is plain code (flatten/dedupe/rank) — free.
 */
export async function diamond({ scope = (x) => [x], work, reduce = (r) => r, synthesize, input, concurrency }) {
  const units = await scope(input);
  const results = await parallel(units.map((u) => () => work(u)), { concurrency });
  const reduced = await reduce(results);
  return synthesize ? synthesize(reduced) : reduced;
}

/**
 * VERIFIER ON THE EDGE — a finding must survive skeptics before it passes (steps 09).
 * Spawns N skeptics; keeps the finding only if >= threshold of them vote to keep.
 * `skeptic(finding)` must resolve to a truthy value to KEEP (survive), falsy to KILL.
 */
export async function verify(finding, skeptics, { threshold } = {}) {
  const votes = await parallel(skeptics.map((s) => () => s(finding)), { keepNulls: true });
  const survived = votes.filter(Boolean).length;
  const need = threshold ?? Math.ceil((skeptics.length * 2) / 3); // 2/3 default
  return { finding, survived, of: skeptics.length, passed: survived >= need };
}

/** Verify a whole list; return only findings that pass the gate. */
export async function verifyAll(findings, makeSkeptics, opts = {}) {
  const checked = await parallel(
    findings.map((f) => () => verify(f, makeSkeptics(f), opts)),
    { keepNulls: true }
  );
  return checked.filter((c) => c && c.passed).map((c) => c.finding);
}

/**
 * CONVERGING CYCLE — loop-until-dry (Codez step 11).
 * Keep calling `round(seenKeys)` (which returns new items) until `quietRounds`
 * consecutive rounds surface nothing new. Dedupe against EVERYTHING seen — not
 * just kept results — or rejected items reappear forever and the loop never dries.
 */
export async function loopUntilDry(round, { key = (x) => JSON.stringify(x), quietRounds = 2, maxRounds = 25 } = {}) {
  const seen = new Set();
  const kept = [];
  let quiet = 0;
  for (let r = 0; r < maxRounds && quiet < quietRounds; r++) {
    const found = (await round(seen)) ?? [];
    let novel = 0;
    for (const item of found) {
      const k = key(item);
      if (seen.has(k)) continue; // dedupe against all seen
      seen.add(k);
      kept.push(item);
      novel++;
    }
    quiet = novel === 0 ? quiet + 1 : 0;
    if (process.env.GRAPH_DEBUG) console.error(`[loopUntilDry] round ${r}: +${novel} new (${kept.length} total, quiet ${quiet}/${quietRounds})`);
  }
  return kept;
}

/** Tiny structured logger so a run's shape is visible. */
export function trace(label) {
  const t0 = Date.now();
  if (process.env.GRAPH_DEBUG) console.error(`▶ ${label}`);
  return () => { if (process.env.GRAPH_DEBUG) console.error(`◀ ${label} (${Date.now() - t0}ms)`); };
}
