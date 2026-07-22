/**
 * Data-access layer for the bulletin board.
 *
 * All SQL lives here so the HTTP layer (`api.ts`) stays a thin translation of
 * requests to these typed operations. The one piece of real concurrency logic
 * is {@link claimTask}, which performs an atomic conditional UPDATE so two
 * agents can never win the same task.
 */
import { db, now } from './db';

/** Lifecycle states a task can be in. */
export type TaskStatus = 'todo' | 'claimed' | 'in_progress' | 'blocked' | 'done' | 'abandoned';

/** Known agent runtimes, used only for display/filtering. */
export type AgentKind = 'claude' | 'codex' | 'other';

/** A unit of work posted to the board. */
export interface Task {
  id: number;
  repo: string;
  title: string;
  body: string;
  status: TaskStatus;
  claimed_by: string | null;
  claimed_at: number | null;
  tags: string;
  priority: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

/** An agent process that has checked in with the board. */
export interface Agent {
  id: string;
  kind: AgentKind;
  host: string | null;
  created_at: number;
  last_seen: number;
}

/** A single entry in the append-only activity feed. */
export interface Activity {
  id: number;
  task_id: number | null;
  agent: string | null;
  repo: string | null;
  kind: string;
  message: string;
  created_at: number;
}

export interface MailMessage {
  id: number;
  sender: string;
  recipient: string;
  body: string;
  thread_id: string | null;
  created_at: number;
  acked_at: number | null;
}

/** Statuses that leave a task free for another agent to pick up. */
const CLAIMABLE_STATES: TaskStatus[] = ['todo', 'abandoned'];
export const ARCHIVE_AFTER_MS = 15 * 60 * 1000;

/** Record an entry in the activity feed. Best-effort, never throws to caller. */
function logActivity(entry: {
  task_id?: number | null;
  agent?: string | null;
  repo?: string | null;
  kind: string;
  message?: string;
}): void {
  db()
    .prepare(
      `INSERT INTO activity (task_id, agent, repo, kind, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.task_id ?? null,
      entry.agent ?? null,
      entry.repo ?? null,
      entry.kind,
      entry.message ?? '',
      now(),
    );
}

/** Upsert an agent heartbeat, refreshing `last_seen`. */
export function heartbeat(input: { name: string; kind?: AgentKind; host?: string }): Agent {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO agents (id, kind, host, created_at, last_seen)
       VALUES (@id, @kind, @host, @ts, @ts)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         host = excluded.host,
         last_seen = excluded.last_seen`,
    )
    .run({
      id: input.name,
      kind: input.kind ?? 'other',
      host: input.host ?? null,
      ts,
    });
  return db().prepare(`SELECT * FROM agents WHERE id = ?`).get(input.name) as unknown as Agent;
}

/** List all known agents, most-recently-seen first. */
export function listAgents(): Agent[] {
  return db().prepare(`SELECT * FROM agents ORDER BY last_seen DESC`).all() as unknown as Agent[];
}

/** Options for filtering the task list. */
export interface TaskQuery {
  repo?: string;
  status?: TaskStatus;
  q?: string;
}

/** List tasks, newest first, optionally filtered by repo/status/search. */
export function listTasks(query: TaskQuery = {}): Task[] {
  const clauses: string[] = [`(status != 'done' OR updated_at >= @archive_cutoff)`];
  const params: Record<string, string | number> = {};
  params['archive_cutoff'] = now() - ARCHIVE_AFTER_MS;
  if (query.repo) {
    clauses.push('repo = @repo');
    params['repo'] = query.repo;
  }
  if (query.status) {
    clauses.push('status = @status');
    params['status'] = query.status;
  }
  if (query.q) {
    clauses.push('(title LIKE @like OR body LIKE @like OR tags LIKE @like)');
    params['like'] = `%${query.q}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db()
    .prepare(
      `SELECT * FROM tasks ${where}
       ORDER BY priority DESC, created_at DESC`,
    )
    .all(params) as unknown as Task[];
}

/** Recently completed work shown briefly outside the active workflow lanes. */
export function listRecentlyCompleted(
  query: {
    repo?: string;
    limit?: number;
  } = {},
): Task[] {
  const limit = Math.min(Math.max(query.limit ?? 8, 1), 50);
  const clauses = [`status = 'done'`, `updated_at >= @archive_cutoff`];
  const params: Record<string, string | number> = {
    archive_cutoff: now() - ARCHIVE_AFTER_MS,
    limit,
  };
  if (query.repo) {
    clauses.push('repo = @repo');
    params['repo'] = query.repo;
  }
  return db()
    .prepare(
      `SELECT * FROM tasks WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC LIMIT @limit`,
    )
    .all(params) as unknown as Task[];
}

/** Search completed work once it has aged out of the operational board. */
export function listArchivedTasks(
  query: {
    repo?: string;
    q?: string;
    limit?: number;
  } = {},
): Task[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const clauses = [`status = 'done'`, `updated_at < @archive_cutoff`];
  const params: Record<string, string | number> = {
    archive_cutoff: now() - ARCHIVE_AFTER_MS,
    limit,
  };
  if (query.repo) {
    clauses.push('repo = @repo');
    params['repo'] = query.repo;
  }
  if (query.q) {
    clauses.push(
      '(title LIKE @like OR body LIKE @like OR tags LIKE @like OR created_by LIKE @like)',
    );
    params['like'] = `%${query.q}%`;
  }
  return db()
    .prepare(
      `SELECT * FROM tasks WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC LIMIT @limit`,
    )
    .all(params) as unknown as Task[];
}

/** Fetch a single task by id, or `undefined` if it does not exist. */
export function getTask(id: number): Task | undefined {
  return db().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as Task | undefined;
}

/** Distinct repo names currently represented on the board. */
export function listRepos(): string[] {
  const rows = db().prepare(`SELECT DISTINCT repo FROM tasks ORDER BY repo`).all() as unknown as {
    repo: string;
  }[];
  return rows.map((r) => r.repo);
}

/** Create a new task in the `todo` state. */
export function createTask(input: {
  repo?: string;
  title: string;
  body?: string;
  tags?: string;
  priority?: number;
  created_by?: string;
}): Task {
  const ts = now();
  const result = db()
    .prepare(
      `INSERT INTO tasks (repo, title, body, status, tags, priority, created_by, created_at, updated_at)
       VALUES (@repo, @title, @body, 'todo', @tags, @priority, @created_by, @ts, @ts)`,
    )
    .run({
      repo: input.repo?.trim() || 'global',
      title: input.title,
      body: input.body ?? '',
      tags: input.tags ?? '',
      priority: input.priority ?? 0,
      created_by: input.created_by ?? null,
      ts,
    });
  const id = Number(result.lastInsertRowid);
  logActivity({
    task_id: id,
    agent: input.created_by,
    repo: input.repo?.trim() || 'global',
    kind: 'created',
    message: input.title,
  });
  return getTask(id)!;
}

/** Outcome of a claim attempt. */
export type ClaimResult =
  | { ok: true; task: Task }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; task: Task };

export type ReleaseResult =
  | { ok: true; task: Task }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; task: Task };

export type StatusResult =
  | { ok: true; task: Task }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; task: Task }
  | { ok: false; reason: 'invalid_transition'; task: Task };

const STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ['abandoned'],
  claimed: ['in_progress', 'abandoned'],
  in_progress: ['blocked', 'done', 'abandoned'],
  blocked: ['in_progress', 'abandoned'],
  done: ['todo'],
  abandoned: ['todo'],
};

const OWNED_STATES: readonly TaskStatus[] = ['claimed', 'in_progress', 'blocked'];

/**
 * Atomically claim a task for `agent`.
 *
 * The UPDATE only matches rows that are still free (todo/abandoned) or already
 * held by the same agent (idempotent re-claim). SQLite executes the statement
 * atomically, so of two concurrent claimers exactly one sees `changes === 1`;
 * the loser gets a `conflict` with the current holder.
 */
export function claimTask(id: number, agent: string): ClaimResult {
  const ts = now();
  const placeholders = CLAIMABLE_STATES.map(() => '?').join(', ');
  const result = db()
    .prepare(
      `UPDATE tasks
         SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = ?
         AND (status IN (${placeholders}) OR (status = 'claimed' AND claimed_by = ?))`,
    )
    .run(agent, ts, ts, id, ...CLAIMABLE_STATES, agent);

  const task = getTask(id);
  if (!task) {
    return { ok: false, reason: 'not_found' };
  }
  if (result.changes === 0) {
    return { ok: false, reason: 'conflict', task };
  }
  logActivity({ task_id: id, agent, repo: task.repo, kind: 'claimed' });
  return { ok: true, task };
}

/** Release a claim, returning the task to `todo`. */
export function releaseTask(id: number, agent: string): ReleaseResult {
  const ts = now();
  const result = db()
    .prepare(
      `UPDATE tasks
         SET status = 'todo', claimed_by = NULL, claimed_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'claimed' AND claimed_by = ?`,
    )
    .run(ts, id, agent);
  const task = getTask(id);
  if (!task) {
    return { ok: false, reason: 'not_found' };
  }
  if (result.changes === 0) {
    return { ok: false, reason: 'conflict', task };
  }
  logActivity({ task_id: id, agent, repo: task.repo, kind: 'released' });
  return { ok: true, task };
}

/** Change a task's status (e.g. in_progress, blocked, done). */
export function setStatus(
  id: number,
  status: TaskStatus,
  agent?: string,
  message?: string,
): StatusResult {
  const existing = getTask(id);
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }
  if (!STATUS_TRANSITIONS[existing.status].includes(status)) {
    return { ok: false, reason: 'invalid_transition', task: existing };
  }
  if (OWNED_STATES.includes(existing.status) && (!agent || existing.claimed_by !== agent)) {
    return { ok: false, reason: 'conflict', task: existing };
  }

  const ts = now();
  const clearsClaim = status === 'todo' || status === 'done' || status === 'abandoned';
  db()
    .prepare(
      `UPDATE tasks
          SET status = ?,
              claimed_by = CASE WHEN ? THEN NULL ELSE claimed_by END,
              claimed_at = CASE WHEN ? THEN NULL ELSE claimed_at END,
              updated_at = ?
        WHERE id = ?`,
    )
    .run(status, clearsClaim ? 1 : 0, clearsClaim ? 1 : 0, ts, id);
  const task = getTask(id);
  if (!task) {
    return { ok: false, reason: 'not_found' };
  }
  logActivity({
    task_id: id,
    agent,
    repo: task.repo,
    kind: 'status',
    message: message ? `${status}: ${message}` : status,
  });
  return { ok: true, task };
}

/** Partially update editable fields of a task. */
export function updateTask(
  id: number,
  patch: Partial<Pick<Task, 'title' | 'body' | 'tags' | 'priority' | 'repo'>>,
): Task | undefined {
  const existing = getTask(id);
  if (!existing) {
    return undefined;
  }
  const ts = now();
  db()
    .prepare(
      `UPDATE tasks
         SET title = @title, body = @body, tags = @tags,
             priority = @priority, repo = @repo, updated_at = @ts
       WHERE id = @id`,
    )
    .run({
      id,
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      tags: patch.tags ?? existing.tags,
      priority: patch.priority ?? existing.priority,
      repo: patch.repo ?? existing.repo,
      ts,
    });
  return getTask(id);
}

/** Delete a task and its activity (via ON DELETE CASCADE). */
export function deleteTask(id: number): boolean {
  const result = db().prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  return result.changes > 0;
}

/** Post a free-form comment against a task. */
export function commentTask(id: number, agent: string, message: string): boolean {
  const task = getTask(id);
  if (!task) {
    return false;
  }
  logActivity({
    task_id: id,
    agent,
    repo: task.repo,
    kind: 'comment',
    message,
  });
  return true;
}

/**
 * Record a free-form activity note that isn't tied to a task lifecycle action.
 * Used by agent hooks (e.g. Claude Code's UserPromptSubmit) to report presence
 * and what they're currently being asked to work on.
 */
export function recordNote(input: {
  agent?: string;
  repo?: string;
  kind?: string;
  message: string;
}): void {
  logActivity({
    agent: input.agent ?? null,
    repo: input.repo ?? null,
    kind: input.kind ?? 'note',
    message: input.message,
  });
}

/** Read the activity feed, newest first. */
export function listActivity(query: { repo?: string; limit?: number } = {}): Activity[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  if (query.repo) {
    return db()
      .prepare(`SELECT * FROM activity WHERE repo = ? ORDER BY created_at DESC LIMIT ?`)
      .all(query.repo, limit) as unknown as Activity[];
  }
  return db()
    .prepare(`SELECT * FROM activity ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as Activity[];
}

/** Store a message for another agent. Delivery is pull-based through its inbox. */
export function sendMessage(input: {
  sender: string;
  recipient: string;
  body: string;
  thread_id?: string;
}): MailMessage {
  const result = db()
    .prepare(
      `INSERT INTO messages (sender, recipient, body, thread_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.sender, input.recipient, input.body, input.thread_id?.trim() || null, now());
  return db()
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as unknown as MailMessage;
}

/** Read the shared message transcript in chronological order. */
export function listMessages(
  input: {
    after_id?: number;
    limit?: number;
  } = {},
): MailMessage[] {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 200);
  return db()
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE id > @after_id
         ORDER BY id DESC
         LIMIT @limit
       ) ORDER BY id ASC`,
    )
    .all({ after_id: input.after_id ?? 0, limit }) as unknown as MailMessage[];
}

/** Read an agent inbox in ascending order so cursors advance naturally. */
export function readInbox(input: {
  agent: string;
  after_id?: number;
  limit?: number;
  include_acknowledged?: boolean;
}): MailMessage[] {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  return db()
    .prepare(
      `SELECT * FROM messages
       WHERE recipient = @agent
         AND id > @after_id
         AND (@include_acknowledged = 1 OR acked_at IS NULL)
       ORDER BY id ASC
       LIMIT @limit`,
    )
    .all({
      agent: input.agent,
      after_id: input.after_id ?? 0,
      include_acknowledged: input.include_acknowledged ? 1 : 0,
      limit,
    }) as unknown as MailMessage[];
}

/** Acknowledge one message, only when the caller is its intended recipient. */
export function acknowledgeMessage(id: number, agent: string): MailMessage | undefined {
  db()
    .prepare(
      `UPDATE messages
       SET acked_at = COALESCE(acked_at, ?)
       WHERE id = ? AND recipient = ?`,
    )
    .run(now(), id, agent);
  return db()
    .prepare(`SELECT * FROM messages WHERE id = ? AND recipient = ?`)
    .get(id, agent) as unknown as MailMessage | undefined;
}
