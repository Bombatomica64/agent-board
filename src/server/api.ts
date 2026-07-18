/**
 * HTTP API for the bulletin board.
 *
 * This router is mounted at `/api` by the SSR server (`server.ts`). It is a thin
 * translation layer over `repo.ts`: parse/validate input, call the data layer,
 * map results to status codes. Everything speaks JSON.
 *
 * Agents (Claude, Codex, or anything that can make an HTTP request) drive the
 * board entirely through these endpoints; see `AGENTS.md` for the protocol.
 */
import { Router, json, type Request, type Response } from 'express';
import {
  claimTask,
  commentTask,
  createTask,
  deleteTask,
  getTask,
  heartbeat,
  listActivity,
  listAgents,
  listRepos,
  listTasks,
  recordNote,
  releaseTask,
  setStatus,
  updateTask,
  type AgentKind,
  type TaskStatus,
} from './repo';

/** Valid task statuses accepted from clients. */
const STATUSES: readonly TaskStatus[] = [
  'todo',
  'claimed',
  'in_progress',
  'blocked',
  'done',
  'abandoned',
];

/** Parse a route `:id` param into a positive integer, or `null` if invalid. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Build the `/api` router with all board endpoints registered. */
export function createApiRouter(): Router {
  const api = Router();
  api.use(json({ limit: '512kb' }));

  /** Liveness probe. */
  api.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'agent-board', time: Date.now() });
  });

  // --- Agents ---------------------------------------------------------------

  /** Register / refresh an agent's presence. */
  api.post('/agents/heartbeat', (req: Request, res: Response) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const kind = req.body?.kind as AgentKind | undefined;
    const host = req.body?.host ? String(req.body.host) : undefined;
    res.json(heartbeat({ name, kind, host }));
  });

  /** List all agents that have ever checked in. */
  api.get('/agents', (_req, res) => {
    res.json(listAgents());
  });

  // --- Tasks ----------------------------------------------------------------

  /** List tasks with optional `repo`, `status`, and `q` (search) filters. */
  api.get('/tasks', (req: Request, res: Response) => {
    const status = req.query['status'] as TaskStatus | undefined;
    if (status && !STATUSES.includes(status)) {
      res.status(400).json({ error: `invalid status: ${status}` });
      return;
    }
    res.json(
      listTasks({
        repo: req.query['repo'] ? String(req.query['repo']) : undefined,
        status,
        q: req.query['q'] ? String(req.query['q']) : undefined,
      }),
    );
  });

  /** Distinct repo names on the board (for filter UIs). */
  api.get('/repos', (_req, res) => {
    res.json(listRepos());
  });

  /** Create a new task. `title` is required; everything else has defaults. */
  api.post('/tasks', (req: Request, res: Response) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const task = createTask({
      repo: req.body?.repo ? String(req.body.repo) : undefined,
      title,
      body: req.body?.body ? String(req.body.body) : undefined,
      tags: req.body?.tags ? String(req.body.tags) : undefined,
      priority: Number.isFinite(req.body?.priority)
        ? Number(req.body.priority)
        : undefined,
      created_by: req.body?.agent ? String(req.body.agent) : undefined,
    });
    res.status(201).json(task);
  });

  /** Fetch a single task. */
  api.get('/tasks/:id', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const task = getTask(id);
    if (!task) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(task);
  });

  /** Edit task fields (title/body/tags/priority/repo). */
  api.patch('/tasks/:id', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const task = updateTask(id, {
      title: req.body?.title !== undefined ? String(req.body.title) : undefined,
      body: req.body?.body !== undefined ? String(req.body.body) : undefined,
      tags: req.body?.tags !== undefined ? String(req.body.tags) : undefined,
      priority: Number.isFinite(req.body?.priority)
        ? Number(req.body.priority)
        : undefined,
      repo: req.body?.repo !== undefined ? String(req.body.repo) : undefined,
    });
    if (!task) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(task);
  });

  /** Delete a task. */
  api.delete('/tasks/:id', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    res.json({ deleted: deleteTask(id) });
  });

  /**
   * Atomically claim a task. Returns 200 on success, 409 with the current
   * holder if another agent already owns it, 404 if it does not exist.
   */
  api.post('/tasks/:id/claim', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const agent = String(req.body?.agent ?? '').trim();
    if (!agent) {
      res.status(400).json({ error: 'agent is required' });
      return;
    }
    const result = claimTask(id, agent);
    if (result.ok) {
      res.json(result.task);
      return;
    }
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res
      .status(409)
      .json({ error: 'already claimed', claimed_by: result.task.claimed_by, task: result.task });
  });

  /** Release a claim, returning the task to `todo`. */
  api.post('/tasks/:id/release', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const agent = String(req.body?.agent ?? '').trim();
    const task = releaseTask(id, agent);
    if (!task) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(task);
  });

  /** Transition a task to a new status (in_progress, blocked, done, ...). */
  api.post('/tasks/:id/status', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const status = req.body?.status as TaskStatus;
    if (!STATUSES.includes(status)) {
      res.status(400).json({ error: `invalid status: ${status}` });
      return;
    }
    const task = setStatus(
      id,
      status,
      req.body?.agent ? String(req.body.agent) : undefined,
      req.body?.message ? String(req.body.message) : undefined,
    );
    if (!task) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(task);
  });

  /** Post a comment against a task (recorded in the activity feed). */
  api.post('/tasks/:id/comment', (req: Request, res: Response) => {
    const id = parseId(String(req.params['id']));
    if (id === null) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const agent = String(req.body?.agent ?? '').trim();
    const message = String(req.body?.message ?? '').trim();
    if (!agent || !message) {
      res.status(400).json({ error: 'agent and message are required' });
      return;
    }
    commentTask(id, agent, message);
    res.status(201).json({ ok: true });
  });

  // --- Activity -------------------------------------------------------------

  /** Read the append-only activity feed. */
  api.get('/activity', (req: Request, res: Response) => {
    res.json(
      listActivity({
        repo: req.query['repo'] ? String(req.query['repo']) : undefined,
        limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
      }),
    );
  });

  /**
   * Record a free-form activity note (not tied to a task). Agent hooks post
   * here to report presence and what they're working on.
   */
  api.post('/activity', (req: Request, res: Response) => {
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    recordNote({
      agent: req.body?.agent ? String(req.body.agent) : undefined,
      repo: req.body?.repo ? String(req.body.repo) : undefined,
      kind: req.body?.kind ? String(req.body.kind) : undefined,
      message,
    });
    res.status(201).json({ ok: true });
  });

  return api;
}
