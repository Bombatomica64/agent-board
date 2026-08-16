#!/usr/bin/env node
/**
 * Claude Code `UserPromptSubmit` / `SessionStart` hook for agent-board.
 *
 * Runs at the two boundaries Claude Code gives us — session start, and every
 * message you send. At each one it:
 *   1. heartbeats this agent (refreshes presence on the board),
 *   2. logs a short note of what you asked, tagged with the current repo,
 *      so other agents can see what this session is working on, and
 *   3. polls this agent's mailbox and prints anything pending, which Claude
 *      Code injects into the session context.
 *
 * Step 3 is the whole delivery story: mail is pull-based, so nothing can wake
 * an idle session. This hook turns each prompt boundary into a poll, which is
 * the closest thing to delivery a running session gets. Messages are printed,
 * not acknowledged — Claude acknowledges once it has actually handled them.
 *
 * The hook stays non-blocking: it swallows all errors, bounds every request
 * with a short timeout, and never fails the prompt. Set
 * `AGENT_BOARD_HOOK_QUIET=1` to suppress the mailbox output entirely and keep
 * the original silent reporting behaviour. Wire it up in
 * ~/.claude/settings.json under hooks.UserPromptSubmit and hooks.SessionStart.
 *
 * Configuration (environment):
 *   AGENT_BOARD_URL        board base URL (default http://localhost:4111)
 *   AGENT_BOARD_NAME       fixed identity; otherwise derived per session
 *   AGENT_BOARD_KIND       claude | codex | other (default claude)
 *   AGENT_BOARD_HOOK_QUIET 1 to never print pending mail into the context
 */
import { basename } from 'node:path';
import { hostname } from 'node:os';

const BASE = (process.env.AGENT_BOARD_URL || 'http://localhost:4111').replace(/\/$/, '');
const KIND = process.env.AGENT_BOARD_KIND || 'claude';
const MAX_MESSAGE = 160;
const TIMEOUT_MS = 1500;

/** Read the hook's JSON payload from stdin (Claude Code passes it there). */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Best-effort request; never throws, bounded by a short timeout. */
async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    // Board may be down; a message hook must never disrupt the session.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const post = (path, body) => request('POST', path, body);
const get = (path) => request('GET', path);

/** Derive a stable-per-session identity when AGENT_BOARD_NAME isn't set. */
function identity(payload) {
  if (process.env.AGENT_BOARD_NAME) return process.env.AGENT_BOARD_NAME;
  const sid = String(payload.session_id || '').replace(/-/g, '').slice(0, 6);
  return sid ? `${KIND}-${hostname()}-${sid}` : `${KIND}-${hostname()}`;
}

/** Repo name = basename of the session's working directory. */
function repoOf(payload) {
  const dir = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return basename(dir) || 'global';
}

/** One-line, length-capped summary of the user's prompt. */
function summarize(payload) {
  const prompt = String(payload.prompt || '').replace(/\s+/g, ' ').trim();
  if (!prompt) return '(sent a message)';
  return prompt.length > MAX_MESSAGE ? `${prompt.slice(0, MAX_MESSAGE - 1)}…` : prompt;
}

/**
 * Render pending mail as the context block Claude Code injects. Returns an
 * empty string when there is nothing to report.
 */
function renderInbox(inbox, agent) {
  const messages = inbox?.messages ?? [];
  if (messages.length === 0) return '';
  const lines = messages.map((m) => {
    const thread = m.thread_id ? ` [thread ${m.thread_id}]` : '';
    return `- #${m.id} from ${m.sender}${thread}: ${m.body}`;
  });
  const extra = inbox.pending > messages.length ? ` (${inbox.pending} pending in total)` : '';
  return [
    `[agent-board] ${messages.length} unread message(s) for ${agent}${extra}:`,
    ...lines,
    'Acknowledge each one you have handled with the acknowledge_message MCP tool, ' +
      `or: agentboard ack <id> (as ${agent}).`,
  ].join('\n');
}

async function main() {
  const payload = await readStdin();
  const agent = identity(payload);
  const repo = repoOf(payload);
  const isPrompt = String(payload.hook_event_name || 'UserPromptSubmit') === 'UserPromptSubmit';

  // Heartbeat first so the identity exists before anyone tries to address it;
  // the note only makes sense for an actual prompt.
  await post('/api/agents/heartbeat', { name: agent, kind: KIND, host: hostname() });
  const [, inbox] = await Promise.all([
    isPrompt
      ? post('/api/activity', { agent, repo, kind: 'prompt', message: summarize(payload) })
      : Promise.resolve(null),
    process.env.AGENT_BOARD_HOOK_QUIET === '1'
      ? Promise.resolve(null)
      : get(`/api/inbox?agent=${encodeURIComponent(agent)}&limit=10`),
  ]);

  // Anything printed here becomes session context; staying silent when the
  // mailbox is empty keeps the hook invisible in the common case.
  const block = renderInbox(inbox, agent);
  if (block) process.stdout.write(`${block}\n`);
}

main().catch(() => process.exit(0));
