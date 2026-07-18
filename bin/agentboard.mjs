#!/usr/bin/env node
/**
 * agentboard — command-line client for the shared agent bulletin board.
 *
 * Any agent (Claude, Codex, a human, a script) coordinates through the same
 * HTTP API the web UI uses. This CLI is a thin, dependency-free wrapper over
 * that API using Node's global `fetch`.
 *
 * Configuration (environment):
 *   AGENT_BOARD_URL   base URL of the board server (default http://localhost:4111)
 *   AGENT_BOARD_NAME  identity used for claims/posts (default: user@host)
 *   AGENT_BOARD_KIND  claude | codex | other (default: other)
 *
 * Exit codes: 0 success, 1 usage/other error, 2 claim conflict (already taken).
 */
import { hostname, userInfo } from 'node:os';

const BASE = (process.env.AGENT_BOARD_URL || 'http://localhost:4111').replace(/\/$/, '');
const NAME =
  process.env.AGENT_BOARD_NAME || `${safeUser()}@${hostname()}`;
const KIND = process.env.AGENT_BOARD_KIND || 'other';

function safeUser() {
  try {
    return userInfo().username;
  } catch {
    return 'agent';
  }
}

/** Perform a JSON request; returns { status, body }. */
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Parse `--flag value` pairs and positional args out of argv. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

/** Render a task as a compact one-liner for terminal output. */
function taskLine(t) {
  const owner = t.claimed_by ? `@${t.claimed_by}` : '(free)';
  const prio = t.priority ? ` P${t.priority}` : '';
  return `#${String(t.id).padEnd(3)} [${t.status.padEnd(11)}] ${t.repo}: ${t.title} ${owner}${prio}`;
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

const HELP = `agentboard — shared AI-agent bulletin board client

Usage: agentboard <command> [args] [--flags]

Identity: acting as "${NAME}" (kind: ${KIND}), server ${BASE}
  override via AGENT_BOARD_NAME / AGENT_BOARD_KIND / AGENT_BOARD_URL

Commands:
  list [--repo R] [--status S] [--q TEXT]   list tasks (default: all)
  post "<title>" [--repo R] [--body B]      create a task
        [--tags a,b] [--prio N]
  show <id>                                 show one task as JSON
  claim <id>                                atomically claim a task (exit 2 if taken)
  release <id>                              return a claimed task to the pool
  start <id>                                mark in_progress
  done <id>                                 mark done
  block <id> [--message M]                  mark blocked
  comment <id> "<message>"                  post a comment
  agents                                    list agents and last-seen
  activity [--repo R] [--limit N]           recent activity feed
  heartbeat                                 announce presence (refresh last-seen)
  repos                                     list known repos
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return;

    case 'heartbeat': {
      const { body } = await api('POST', '/api/agents/heartbeat', {
        name: NAME,
        kind: KIND,
        host: hostname(),
      });
      console.log(`ok: ${body.id} checked in`);
      return;
    }

    case 'list': {
      const params = new URLSearchParams();
      if (flags.repo) params.set('repo', String(flags.repo));
      if (flags.status) params.set('status', String(flags.status));
      if (flags.q) params.set('q', String(flags.q));
      const qs = params.toString();
      const { body } = await api('GET', `/api/tasks${qs ? `?${qs}` : ''}`);
      if (!Array.isArray(body) || body.length === 0) {
        console.log('(no tasks)');
        return;
      }
      for (const t of body) console.log(taskLine(t));
      return;
    }

    case 'repos': {
      const { body } = await api('GET', '/api/repos');
      console.log((body || []).join('\n') || '(none)');
      return;
    }

    case 'post': {
      const title = positional[0];
      if (!title) die('usage: agentboard post "<title>" [--repo R] [--body B] [--tags a,b] [--prio N]');
      const { status, body } = await api('POST', '/api/tasks', {
        title,
        repo: flags.repo ? String(flags.repo) : undefined,
        body: flags.body ? String(flags.body) : undefined,
        tags: flags.tags ? String(flags.tags) : undefined,
        priority: flags.prio ? Number(flags.prio) : undefined,
        agent: NAME,
      });
      if (status >= 400) die(`error: ${JSON.stringify(body)}`);
      console.log(`created ${taskLine(body)}`);
      return;
    }

    case 'show': {
      const id = positional[0];
      if (!id) die('usage: agentboard show <id>');
      const { status, body } = await api('GET', `/api/tasks/${id}`);
      if (status >= 400) die(`error: ${JSON.stringify(body)}`);
      console.log(JSON.stringify(body, null, 2));
      return;
    }

    case 'claim': {
      const id = positional[0];
      if (!id) die('usage: agentboard claim <id>');
      const { status, body } = await api('POST', `/api/tasks/${id}/claim`, {
        agent: NAME,
      });
      if (status === 409) {
        die(`CONFLICT: #${id} already claimed by @${body.claimed_by}`, 2);
      }
      if (status >= 400) die(`error: ${JSON.stringify(body)}`);
      console.log(`claimed ${taskLine(body)}`);
      return;
    }

    case 'release': {
      const id = positional[0];
      if (!id) die('usage: agentboard release <id>');
      const { status, body } = await api('POST', `/api/tasks/${id}/release`, {
        agent: NAME,
      });
      if (status >= 400) die(`error: ${JSON.stringify(body)}`);
      console.log(`released ${taskLine(body)}`);
      return;
    }

    case 'start':
    case 'done':
    case 'block': {
      const id = positional[0];
      if (!id) die(`usage: agentboard ${cmd} <id>`);
      const status = cmd === 'start' ? 'in_progress' : cmd === 'done' ? 'done' : 'blocked';
      const { status: code, body } = await api('POST', `/api/tasks/${id}/status`, {
        status,
        agent: NAME,
        message: flags.message ? String(flags.message) : undefined,
      });
      if (code >= 400) die(`error: ${JSON.stringify(body)}`);
      console.log(`${status} ${taskLine(body)}`);
      return;
    }

    case 'comment': {
      const id = positional[0];
      const message = positional[1];
      if (!id || !message) die('usage: agentboard comment <id> "<message>"');
      const { status, body } = await api('POST', `/api/tasks/${id}/comment`, {
        agent: NAME,
        message,
      });
      if (status >= 400) die(`error: ${JSON.stringify(body)}`);
      console.log('comment posted');
      return;
    }

    case 'agents': {
      const { body } = await api('GET', '/api/agents');
      const nowTs = Date.now();
      for (const a of body || []) {
        const secs = Math.round((nowTs - a.last_seen) / 1000);
        const online = secs < 120 ? 'online ' : 'offline';
        console.log(`${online}  ${a.id.padEnd(20)} ${a.kind.padEnd(7)} ${secs}s ago`);
      }
      if (!body || body.length === 0) console.log('(no agents)');
      return;
    }

    case 'activity': {
      const params = new URLSearchParams();
      if (flags.repo) params.set('repo', String(flags.repo));
      params.set('limit', String(flags.limit || 30));
      const { body } = await api('GET', `/api/activity?${params}`);
      for (const e of (body || []).reverse()) {
        const t = new Date(e.created_at).toLocaleTimeString();
        console.log(`${t}  ${e.agent || '-'}  ${e.kind}  #${e.task_id ?? '-'}  ${e.message}`);
      }
      return;
    }

    default:
      die(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

main().catch((err) => {
  die(`request failed: ${err.message}\n(is the board server running at ${BASE}?)`);
});
