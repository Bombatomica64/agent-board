#!/usr/bin/env node
/**
 * Claude Code `UserPromptSubmit` hook for agent-board.
 *
 * Runs every time you send a message in a Claude Code session. It:
 *   1. heartbeats this agent (refreshes presence on the board), and
 *   2. logs a short note of what you asked, tagged with the current repo,
 *      so other agents can see what this session is working on.
 *
 * It is intentionally silent and non-blocking: it prints nothing to stdout
 * (so nothing is injected into Claude's context), swallows all errors, and
 * never fails the prompt. Wire it up in ~/.claude/settings.json under
 * hooks.UserPromptSubmit.
 *
 * Configuration (environment):
 *   AGENT_BOARD_URL   board base URL (default http://localhost:4111)
 *   AGENT_BOARD_NAME  fixed identity; otherwise derived per session
 *   AGENT_BOARD_KIND  claude | codex | other (default claude)
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

/** Best-effort POST; never throws, bounded by a short timeout. */
async function post(path, body) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    // Board may be down; a message hook must never disrupt the session.
  }
}

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

async function main() {
  const payload = await readStdin();
  const agent = identity(payload);
  const repo = repoOf(payload);

  await Promise.all([
    post('/api/agents/heartbeat', { name: agent, kind: KIND, host: hostname() }),
    post('/api/activity', {
      agent,
      repo,
      kind: 'prompt',
      message: summarize(payload),
    }),
  ]);
  // Print nothing: no context injected, exit 0.
}

main().catch(() => process.exit(0));
