// board.mjs — AgentBoard as a DISTRIBUTED orchestration backend.
// AgentBoard (github.com/Bombatomica64/agent-board) is Slack+Jira for agents: a
// shared Kanban board (post/claim/status/comment) plus durable mailboxes
// (send/read). This maps the graph's edges onto that board so nodes can run in
// OTHER agents/processes, not just in-process. This is the article's "Agent
// Teams / shared task list" pattern (Codez) — use it for the DYNAMIC parts;
// keep lib/graph.mjs code edges for the deterministic hot paths.
//
// Streamable-HTTP MCP client, dependency-free (Node 18+ global fetch).
// Point elsewhere with AGENT_BOARD_URL (default http://localhost:4111).

const BOARD_URL = (process.env.AGENT_BOARD_URL || "http://localhost:4111").replace(/\/$/, "");
const MCP = BOARD_URL + "/mcp";
let _id = 0;

async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++_id, method, params }),
  });
  const text = await res.text();
  let payload;
  const t = text.trim();
  if (t.startsWith("{")) payload = JSON.parse(t);
  else for (const line of t.split(/\r?\n/)) {           // parse SSE data: lines
    const l = line.trim();
    if (l.startsWith("data:")) { try { const d = JSON.parse(l.slice(5).trim()); if (d.result || d.error) payload = d; } catch {} }
  }
  if (!payload) throw new Error(`board: no JSON-RPC payload from ${method}: ${text.slice(0, 160)}`);
  if (payload.error) throw new Error(`board ${method}: ${payload.error.message}`);
  return payload.result;
}

async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  const block = (r?.content || []).find((b) => b.type === "text");
  if (!block) return r;
  try { return JSON.parse(block.text); } catch { return block.text; }
}

/** Thin, faithful wrappers over the AgentBoard MCP tools. */
export const board = {
  heartbeat: (agent, kind = "claude", host) => tool("heartbeat", { agent, kind, ...(host ? { host } : {}) }),
  listTasks: (filter = {}) => tool("list_tasks", filter).then((r) => r.tasks ?? r),
  postTask: (title, o = {}) => tool("post_task", { title, ...o }).then((r) => r.task ?? r),
  getTask: (task_id) => tool("get_task", { task_id }).then((r) => r.task ?? r),
  claimTask: (task_id, agent) => tool("claim_task", { task_id, agent }),
  releaseTask: (task_id, agent) => tool("release_task", { task_id, agent }),
  setStatus: (task_id, status, agent, message) => tool("set_task_status", { task_id, status, agent, ...(message ? { message } : {}) }),
  comment: (task_id, agent, message) => tool("comment_task", { task_id, agent, message }),
  activity: (o = {}) => tool("list_activity", o),
  send: (from, to, message, thread_id) => tool("send_message", { from, to, message, ...(thread_id ? { thread_id } : {}) }),
  inbox: (agent, o = {}) => tool("read_inbox", { agent, ...o }),
  ack: (agent, message_id) => tool("acknowledge_message", { agent, message_id }),
  agents: () => tool("list_agents", {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THREAD = (id) => `task-${id}`; // convention: results flow back on this mailbox thread

/**
 * DELEGATE a node onto the board (orchestrator side).
 * Posts a task, waits until a worker completes it, and returns the worker's
 * result (delivered to your mailbox on thread `task-<id>`). Drop-in for a
 * `work` function in diamond()/parallel() so fan-out runs across many agents.
 */
export async function delegate(orchestrator, title, body, { pollMs = 2000, timeoutMs = 15 * 60_000, tags, priority } = {}) {
  await board.heartbeat(orchestrator);
  const task = await board.postTask(title, { body, agent: orchestrator, ...(tags ? { tags } : {}), ...(priority != null ? { priority } : {}) });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = await board.getTask(task.id);
    if (t.status === "done" || t.status === "abandoned") {
      const msgs = await board.inbox(orchestrator, { include_acknowledged: true });
      const hit = (msgs.messages ?? msgs ?? []).filter((m) => m.thread_id === THREAD(task.id)).pop();
      if (hit) await board.ack(orchestrator, hit.id).catch(() => {});
      if (t.status === "abandoned" && !hit) return null; // contained failure -> null (filter(Boolean))
      return hit ? hit.message : (t.body ?? null);
    }
    await sleep(pollMs);
  }
  await board.setStatus(task.id, "abandoned", orchestrator, "delegate timeout").catch(() => {});
  return null;
}

/**
 * WORKER loop (worker side). Heartbeats, claims free `todo` tasks, runs
 * `handler(task) -> resultString`, sends the result back on thread `task-<id>`,
 * and marks the task done. Run this in a separate agent/process (or several) to
 * drain tasks that delegate() posts. `once:true` handles a single task and exits.
 */
export async function runWorker(agentName, handler, { pollMs = 2000, kind = "claude", once = false, filter = {} } = {}) {
  await board.heartbeat(agentName, kind);
  for (;;) {
    const tasks = await board.listTasks({ status: "todo", ...filter });
    const free = (tasks ?? []).find((t) => !t.claimed_by);
    if (free) {
      try {
        await board.claimTask(free.id, agentName);
        await board.setStatus(free.id, "in_progress", agentName, "working");
        const result = await handler(free);
        await board.send(agentName, free.created_by, String(result), THREAD(free.id));
        await board.comment(free.id, agentName, `done: ${String(result).slice(0, 200)}`);
        await board.setStatus(free.id, "done", agentName, "completed");
      } catch (err) {
        await board.setStatus(free.id, "todo", agentName, `error: ${err.message}`).catch(() => {}); // release for retry
        if (process.env.GRAPH_DEBUG) console.error(`[worker ${agentName}] ${free.id} failed:`, err.message);
      }
      if (once) return;
    } else {
      if (once) return;
      await sleep(pollMs);
    }
  }
}
