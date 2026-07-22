import { Router, json, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  acknowledgeMessage,
  claimTask,
  commentTask,
  createTask,
  getTask,
  heartbeat,
  listActivity,
  listAgents,
  listTasks,
  readInbox,
  releaseTask,
  sendMessage,
  setStatus,
  type AgentKind,
  type TaskStatus,
} from './repo';

const TASK_STATUSES = [
  'todo',
  'claimed',
  'in_progress',
  'blocked',
  'done',
  'abandoned',
] as const satisfies readonly TaskStatus[];
const AGENT_KINDS = ['claude', 'codex', 'other'] as const satisfies readonly AgentKind[];

function toolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function toolError(message: string, value?: unknown) {
  return {
    content: [{ type: 'text' as const, text: message }],
    ...(value === undefined ? {} : { structuredContent: value as Record<string, unknown> }),
    isError: true,
  };
}

/** Create one stateless MCP server instance for a single HTTP request. */
export function createMailboxMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'agent-board', version: '1.1.0' },
    {
      instructions:
        'Coordinate shared work through heartbeat, list_tasks, post_task, claim_task, set_task_status, release_task, and comment_task. Use mailbox tools for notes addressed to one agent.',
    },
  );

  server.registerTool(
    'heartbeat',
    {
      description: 'Register or refresh an agent identity on the shared board.',
      inputSchema: {
        agent: z.string().trim().min(1),
        kind: z.enum(AGENT_KINDS).optional(),
        host: z.string().trim().min(1).optional(),
      },
    },
    async ({ agent, kind, host }) => toolResult({ agent: heartbeat({ name: agent, kind, host }) }),
  );

  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks visible on the shared Kanban board.',
      inputSchema: {
        repo: z.string().trim().min(1).optional(),
        status: z.enum(TASK_STATUSES).optional(),
        q: z.string().trim().min(1).optional(),
      },
    },
    async ({ repo, status, q }) => toolResult({ tasks: listTasks({ repo, status, q }) }),
  );

  server.registerTool(
    'post_task',
    {
      description: 'Post a new task to the shared Kanban board.',
      inputSchema: {
        title: z.string().trim().min(1).max(500),
        repo: z.string().trim().min(1).optional(),
        body: z.string().max(16_000).optional(),
        tags: z.string().max(1_000).optional(),
        priority: z.number().int().optional(),
        agent: z.string().trim().min(1).optional(),
      },
    },
    async ({ title, repo, body, tags, priority, agent }) =>
      toolResult({
        task: createTask({ title, repo, body, tags, priority, created_by: agent }),
      }),
  );

  server.registerTool(
    'get_task',
    {
      description: 'Fetch one shared-board task by id.',
      inputSchema: { task_id: z.number().int().positive() },
    },
    async ({ task_id }) => {
      const task = getTask(task_id);
      return task
        ? toolResult({ task })
        : toolError(`Task #${task_id} was not found.`, { reason: 'not_found' });
    },
  );

  server.registerTool(
    'claim_task',
    {
      description: 'Atomically claim a free task for an agent.',
      inputSchema: { task_id: z.number().int().positive(), agent: z.string().trim().min(1) },
    },
    async ({ task_id, agent }) => {
      const result = claimTask(task_id, agent);
      return result.ok
        ? toolResult({ task: result.task })
        : toolError(
            result.reason === 'not_found'
              ? `Task #${task_id} was not found.`
              : `Task #${task_id} is already owned by ${result.task.claimed_by ?? 'another agent'}.`,
            result,
          );
    },
  );

  server.registerTool(
    'release_task',
    {
      description: 'Release an agent-owned claim back to the shared task pool.',
      inputSchema: { task_id: z.number().int().positive(), agent: z.string().trim().min(1) },
    },
    async ({ task_id, agent }) => {
      const result = releaseTask(task_id, agent);
      return result.ok
        ? toolResult({ task: result.task })
        : toolError(
            result.reason === 'not_found'
              ? `Task #${task_id} was not found.`
              : `Task #${task_id} is not claimed by ${agent}.`,
            result,
          );
    },
  );

  server.registerTool(
    'set_task_status',
    {
      description: 'Advance, block, resume, complete, abandon, or reopen a task.',
      inputSchema: {
        task_id: z.number().int().positive(),
        status: z.enum(TASK_STATUSES),
        agent: z.string().trim().min(1),
        message: z.string().trim().min(1).max(16_000).optional(),
      },
    },
    async ({ task_id, status, agent, message }) => {
      const result = setStatus(task_id, status, agent, message);
      return result.ok
        ? toolResult({ task: result.task })
        : toolError(`Could not set task #${task_id} to ${status}: ${result.reason}.`, result);
    },
  );

  server.registerTool(
    'comment_task',
    {
      description: 'Add an agent comment to a shared-board task.',
      inputSchema: {
        task_id: z.number().int().positive(),
        agent: z.string().trim().min(1),
        message: z.string().trim().min(1).max(16_000),
      },
    },
    async ({ task_id, agent, message }) =>
      commentTask(task_id, agent, message)
        ? toolResult({ posted: true, task_id })
        : toolError(`Task #${task_id} was not found.`, { reason: 'not_found' }),
  );

  server.registerTool(
    'list_activity',
    {
      description: 'Read recent public activity from the shared board.',
      inputSchema: {
        repo: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ repo, limit }) => toolResult({ activity: listActivity({ repo, limit }) }),
  );

  server.registerTool(
    'send_message',
    {
      description: 'Send a durable mailbox message to another agent.',
      inputSchema: {
        from: z.string().trim().min(1).describe('Sending agent identity'),
        to: z.string().trim().min(1).describe('Recipient agent identity'),
        message: z.string().trim().min(1).max(16_000),
        thread_id: z.string().trim().min(1).max(200).optional(),
      },
    },
    async ({ from, to, message, thread_id }) =>
      toolResult({
        message: sendMessage({
          sender: from,
          recipient: to,
          body: message,
          thread_id,
        }),
      }),
  );

  server.registerTool(
    'read_inbox',
    {
      description: 'Read pending messages addressed to an agent, oldest first.',
      inputSchema: {
        agent: z.string().trim().min(1),
        after_id: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        include_acknowledged: z.boolean().optional(),
      },
    },
    async ({ agent, after_id, limit, include_acknowledged }) => {
      const messages = readInbox({
        agent,
        after_id,
        limit,
        include_acknowledged,
      });
      return toolResult({
        messages,
        next_cursor: messages.at(-1)?.id ?? after_id ?? 0,
      });
    },
  );

  server.registerTool(
    'acknowledge_message',
    {
      description: 'Mark one received message as acknowledged.',
      inputSchema: {
        agent: z.string().trim().min(1),
        message_id: z.number().int().positive(),
      },
    },
    async ({ agent, message_id }) => {
      const message = acknowledgeMessage(message_id, agent);
      if (!message) {
        return {
          content: [{ type: 'text', text: 'Message not found for this recipient.' }],
          isError: true,
        };
      }
      return toolResult({ message });
    },
  );

  server.registerTool(
    'list_agents',
    {
      description: 'List known agent identities and their last heartbeat time.',
    },
    async () => toolResult({ agents: listAgents() }),
  );

  return server;
}

function rejectMethod(res: Response): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
}

/** Streamable HTTP MCP endpoint, mounted by the main SSR server at `/mcp`. */
export function createMcpRouter(): Router {
  const router = Router();
  router.use(json({ limit: '512kb' }));
  router.use((req, res, next) => {
    const configured = (process.env['AGENT_BOARD_ALLOWED_HOSTS'] ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    const allowed = new Set(['localhost', '127.0.0.1', '::1', ...configured]);
    if (!allowed.has(req.hostname)) {
      res.status(403).json({ error: 'host not allowed' });
      return;
    }
    next();
  });
  router.post('/', async (req: Request, res: Response) => {
    const server = createMailboxMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error: unknown) {
      console.error('MCP request failed', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });
  router.get('/', (_req, res) => rejectMethod(res));
  router.delete('/', (_req, res) => rejectMethod(res));
  return router;
}
