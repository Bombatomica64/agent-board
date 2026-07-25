// agent.mjs — the ONE node type that spends model tokens.
// Everything else in graph.mjs is free code. This wraps the Anthropic SDK so a
// node is: bounded input -> validated output (Codez steps 03/04, "give every
// node a contract"). Model tiering (step 12) is just the `model` option.
//
// Auth: reads ANTHROPIC_API_KEY, or an `ant auth login` profile — a zero-arg
// client picks either up. Set GRAPH_ENGINE_MOCK=1 to run the graph shapes with a
// stub instead of real calls (no tokens spent) while you wire things together.

// Anthropic SDK is imported lazily (inside client()) so mock/dry runs work
// before `npm install` and spend nothing.

// Model tiers — cheap for bounded/repetitive nodes, top for judgment nodes.
export const MODELS = {
  top: "claude-opus-4-8",     // synthesis, adjudication — where judgment lives
  mid: "claude-sonnet-5",     // balanced
  cheap: "claude-haiku-4-5",  // extract/classify — the boring fan-out nodes
};

let _client;
async function client() {
  if (!_client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _client = new Anthropic(); // resolves env key or ant profile
  }
  return _client;
}

/**
 * agent(prompt, opts) -> string | parsed object
 *
 *   model   : one of MODELS.* or a raw id           (default MODELS.top)
 *   system  : system prompt string
 *   schema  : JSON Schema -> returns a parsed, validated object (structured output)
 *   effort  : "low" | "medium" | "high" | "xhigh" | "max"   (default "high")
 *   think   : true to enable adaptive thinking
 *   maxTokens: default 8000
 */
export async function agent(prompt, opts = {}) {
  const {
    model = MODELS.top,
    system,
    schema,
    effort = "high",
    think = false,
    maxTokens = 8000,
  } = opts;

  if (process.env.GRAPH_ENGINE_MOCK) return mockAgent(prompt, schema);

  const req = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort },
  };
  if (system) req.system = system;
  if (think) req.thinking = { type: "adaptive" };
  if (schema) req.output_config.format = { type: "json_schema", schema };

  const res = await (await client()).messages.create(req);

  if (res.stop_reason === "refusal") {
    throw new Error(`agent refused: ${res.stop_details?.explanation ?? "safety"}`);
  }
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    // structured output guarantees valid JSON, but be defensive on partials
    throw new Error(`agent: schema requested but response was not valid JSON:\n${text.slice(0, 300)}`);
  }
}

/** Convenience wrappers so workflows read like the article's tiers. */
export const cheapAgent = (p, o = {}) => agent(p, { model: MODELS.cheap, effort: "low", ...o });
export const topAgent = (p, o = {}) => agent(p, { model: MODELS.top, effort: "high", ...o });

// --- mock backend (GRAPH_ENGINE_MOCK=1) --------------------------------------
function mockAgent(prompt, schema) {
  const tag = `[mock:${prompt.slice(0, 40).replace(/\s+/g, " ")}...]`;
  if (schema) {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      out[k] = Array.isArray(v.enum) ? v.enum[0] :          // honor enums (e.g. router "high"/"low")
               v.type === "array" ? [`${tag} item`] :
               v.type === "number" || v.type === "integer" ? 1 :
               v.type === "boolean" ? true : `${tag}`;
    }
    return Promise.resolve(out);
  }
  return Promise.resolve(`${tag} (mock response — set a real ANTHROPIC_API_KEY and unset GRAPH_ENGINE_MOCK)`);
}
