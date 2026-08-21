import { Router, json, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  acknowledgeMessage,
  claimTask,
  commentTask,
  countInbox,
  createChannel,
  createTask,
  getTask,
  heartbeat,
  joinChannel,
  leaveChannel,
  listActivity,
  listAgents,
  listChannels,
  listMessages,
  listTasks,
  listThreads,
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

type ToolResponse = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function toolResult(value: unknown): ToolResponse {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function toolError(message: string, value?: unknown): ToolResponse {
  return {
    content: [{ type: 'text' as const, text: message }],
    ...(value === undefined ? {} : { structuredContent: value as Record<string, unknown> }),
    isError: true,
  };
}

/**
 * One board capability. These are kept in a registry rather than registered
 * directly so the server can either advertise them all or hide them behind
 * `search_tools` / `call_tool`.
 */
interface BoardTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  /** Extra search terms that do not appear in the name or description. */
  keywords: string;
  shape: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => ToolResponse | Promise<ToolResponse>;
}

function defineTool<Shape extends z.ZodRawShape>(tool: BoardTool<Shape>): BoardTool {
  return tool as unknown as BoardTool;
}

const BOARD_TOOLS: readonly BoardTool[] = [
  defineTool({
    name: 'heartbeat',
    description: 'Register or refresh an agent identity on the shared board.',
    keywords: 'check in presence online session start identity',
    shape: {
      agent: z.string().trim().min(1),
      kind: z.enum(AGENT_KINDS).optional(),
      host: z.string().trim().min(1).optional(),
    },
    handler: ({ agent, kind, host }) => toolResult({ agent: heartbeat({ name: agent, kind, host }) }),
  }),

  defineTool({
    name: 'list_tasks',
    description: 'List tasks visible on the shared Kanban board.',
    keywords: 'find work backlog todo search board repo status',
    shape: {
      repo: z.string().trim().min(1).optional(),
      status: z.enum(TASK_STATUSES).optional(),
      q: z.string().trim().min(1).optional(),
    },
    handler: ({ repo, status, q }) => toolResult({ tasks: listTasks({ repo, status, q }) }),
  }),

  defineTool({
    name: 'post_task',
    description: 'Post a new task to the shared Kanban board.',
    keywords: 'create add new work item ticket',
    shape: {
      title: z.string().trim().min(1).max(500),
      repo: z.string().trim().min(1).optional(),
      body: z.string().max(16_000).optional(),
      tags: z.string().max(1_000).optional(),
      priority: z.number().int().optional(),
      agent: z.string().trim().min(1).optional(),
    },
    handler: ({ title, repo, body, tags, priority, agent }) =>
      toolResult({
        task: createTask({ title, repo, body, tags, priority, created_by: agent }),
      }),
  }),

  defineTool({
    name: 'get_task',
    description: 'Fetch one shared-board task by id.',
    keywords: 'read detail single show',
    shape: { task_id: z.number().int().positive() },
    handler: ({ task_id }) => {
      const task = getTask(task_id);
      return task
        ? toolResult({ task })
        : toolError(`Task #${task_id} was not found.`, { reason: 'not_found' });
    },
  }),

  defineTool({
    name: 'claim_task',
    description: 'Atomically claim a free task for an agent.',
    keywords: 'take own lock assign reserve',
    shape: { task_id: z.number().int().positive(), agent: z.string().trim().min(1) },
    handler: ({ task_id, agent }) => {
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
  }),

  defineTool({
    name: 'release_task',
    description: 'Release an agent-owned claim back to the shared task pool.',
    keywords: 'give back unclaim abandon drop stop',
    shape: { task_id: z.number().int().positive(), agent: z.string().trim().min(1) },
    handler: ({ task_id, agent }) => {
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
  }),

  defineTool({
    name: 'set_task_status',
    description: 'Advance, block, resume, complete, abandon, or reopen a task.',
    keywords: 'start done finish in_progress blocked progress update',
    shape: {
      task_id: z.number().int().positive(),
      status: z.enum(TASK_STATUSES),
      agent: z.string().trim().min(1),
      message: z.string().trim().min(1).max(16_000).optional(),
    },
    handler: ({ task_id, status, agent, message }) => {
      const result = setStatus(task_id, status, agent, message);
      return result.ok
        ? toolResult({ task: result.task })
        : toolError(`Could not set task #${task_id} to ${status}: ${result.reason}.`, result);
    },
  }),

  defineTool({
    name: 'comment_task',
    description: 'Add an agent comment to a shared-board task.',
    keywords: 'note annotate context discuss',
    shape: {
      task_id: z.number().int().positive(),
      agent: z.string().trim().min(1),
      message: z.string().trim().min(1).max(16_000),
    },
    handler: ({ task_id, agent, message }) =>
      commentTask(task_id, agent, message)
        ? toolResult({ posted: true, task_id })
        : toolError(`Task #${task_id} was not found.`, { reason: 'not_found' }),
  }),

  defineTool({
    name: 'list_activity',
    description: 'Read recent public activity from the shared board.',
    keywords: 'feed history log recent events',
    shape: {
      repo: z.string().trim().min(1).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    handler: ({ repo, limit }) => toolResult({ activity: listActivity({ repo, limit }) }),
  }),

  defineTool({
    name: 'send_message',
    description: 'Send a durable mailbox message to another agent.',
    keywords: 'mail dm write tell notify channel post',
    shape: {
      from: z.string().trim().min(1).describe('Sending agent identity'),
      to: z.string().trim().min(1).describe('Recipient agent identity'),
      message: z.string().trim().min(1).max(16_000),
      thread_id: z.string().trim().min(1).max(200).optional(),
    },
    handler: ({ from, to, message, thread_id }) => {
      const result = sendMessage({
        sender: from,
        recipient: to,
        body: message,
        thread_id,
      });
      return result.ok
        ? toolResult({ message: result.message })
        : toolError(
            `Agent ${to} is not active. Ask it to heartbeat before sending a message.`,
            result,
          );
    },
  }),

  defineTool({
    name: 'read_inbox',
    description: 'Read pending messages addressed to an agent, oldest first.',
    keywords: 'mail unread poll check pending receive',
    shape: {
      agent: z.string().trim().min(1),
      after_id: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      include_acknowledged: z.boolean().optional(),
    },
    handler: ({ agent, after_id, limit, include_acknowledged }) => {
      const messages = readInbox({
        agent,
        after_id,
        limit,
        include_acknowledged,
      });
      return toolResult({
        messages,
        pending: countInbox(agent),
        next_cursor: messages.at(-1)?.id ?? after_id ?? 0,
      });
    },
  }),

  defineTool({
    name: 'search_messages',
    description:
      'Search the shared message transcript by text, thread, participant, or unread state.',
    keywords: 'find history past mail grep transcript',
    shape: {
      q: z.string().trim().min(1).max(500).optional().describe('Free-text match'),
      thread_id: z.string().trim().min(1).max(200).optional(),
      agent: z.string().trim().min(1).optional().describe('Sender or recipient'),
      unread_only: z.boolean().optional().describe('Only messages not yet acknowledged'),
      after_id: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    handler: ({ q, thread_id, agent, unread_only, after_id, limit }) => {
      const messages = listMessages({ q, thread_id, agent, unread_only, after_id, limit });
      return toolResult({
        messages,
        next_cursor: messages.at(-1)?.id ?? after_id ?? 0,
      });
    },
  }),

  defineTool({
    name: 'list_threads',
    description: 'List conversation threads with their message and unread counts.',
    keywords: 'conversations topics mail overview',
    shape: { limit: z.number().int().min(1).max(500).optional() },
    handler: ({ limit }) => toolResult({ threads: listThreads({ limit }) }),
  }),

  defineTool({
    name: 'acknowledge_message',
    description: 'Mark one received message as acknowledged.',
    keywords: 'ack handled read mark done mail',
    shape: {
      agent: z.string().trim().min(1),
      message_id: z.number().int().positive(),
    },
    handler: ({ agent, message_id }) => {
      const message = acknowledgeMessage(message_id, agent);
      return message
        ? toolResult({ message })
        : toolError('Message not found for this recipient.', { reason: 'not_found' });
    },
  }),

  defineTool({
    name: 'list_agents',
    description: 'List known agent identities and their last heartbeat time.',
    keywords: 'who online peers roster others',
    shape: {},
    handler: () => toolResult({ agents: listAgents() }),
  }),

  defineTool({
    name: 'list_channels',
    description: 'List group-chat channels and their members.',
    keywords: 'rooms groups broadcast membership',
    shape: {},
    handler: () => toolResult({ channels: listChannels() }),
  }),

  defineTool({
    name: 'create_channel',
    description:
      'Create a group-chat channel. Send to it with send_message using to="#<channel-id>".',
    keywords: 'new room group broadcast',
    shape: {
      name: z.string().trim().min(1).max(200),
      agent: z.string().trim().min(1).optional().describe('Creator; auto-joined as a member'),
      members: z.array(z.string().trim().min(1)).optional(),
    },
    handler: ({ name, agent, members }) => {
      const result = createChannel({ name, created_by: agent, members });
      return result.ok
        ? toolResult({ channel: result.channel })
        : toolError(`Could not create channel: ${result.reason}.`, result);
    },
  }),

  defineTool({
    name: 'join_channel',
    description: 'Join a group-chat channel so its messages reach your inbox.',
    keywords: 'subscribe enter room group',
    shape: {
      channel_id: z.string().trim().min(1),
      agent: z.string().trim().min(1),
    },
    handler: ({ channel_id, agent }) => {
      const channel = joinChannel(channel_id, agent);
      return channel
        ? toolResult({ channel })
        : toolError(`Channel #${channel_id} was not found.`, { reason: 'not_found' });
    },
  }),

  defineTool({
    name: 'leave_channel',
    description: 'Leave a group-chat channel.',
    keywords: 'unsubscribe exit room group',
    shape: {
      channel_id: z.string().trim().min(1),
      agent: z.string().trim().min(1),
    },
    handler: ({ channel_id, agent }) => {
      const channel = leaveChannel(channel_id, agent);
      return channel
        ? toolResult({ channel })
        : toolError(`Channel #${channel_id} was not found.`, { reason: 'not_found' });
    },
  }),
];

const TOOLS_BY_NAME = new Map(BOARD_TOOLS.map((tool) => [tool.name, tool]));
const TOOL_NAMES = BOARD_TOOLS.map((tool) => tool.name);

function inputSchemaOf(tool: BoardTool): Record<string, unknown> {
  return zodToJsonSchema(z.object(tool.shape), {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
}

function scoreTool(tool: BoardTool, terms: readonly string[]): number {
  const name = tool.name.toLowerCase();
  const haystack = `${name} ${tool.description} ${tool.keywords}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name === term) score += 100;
    else if (name.includes(term)) score += 20;
    if (haystack.includes(term)) score += 5;
  }
  return score;
}

const SEARCH_INSTRUCTIONS = [
  'Coordinate shared work through this board. Tools are not all advertised: call search_tools',
  'to look one up by intent, then call_tool to run it. Arguments are validated, and an invalid',
  'call returns the tool JSON Schema so you can retry immediately.',
  `Available tools: ${TOOL_NAMES.join(', ')}.`,
  'Usual flow: heartbeat, list_tasks, post_task, claim_task, set_task_status, comment_task.',
  'Mail delivery is pull-based: nothing here can interrupt you, so run read_inbox at session',
  'start and after each meaningful work boundary, then acknowledge_message what you handled.',
].join(' ');

const FULL_INSTRUCTIONS =
  'Coordinate shared work through heartbeat, list_tasks, post_task, claim_task, set_task_status, release_task, and comment_task. Use mailbox tools for notes addressed to one agent. Mail delivery is pull-based: nothing here can interrupt you, so call read_inbox at session start and after each meaningful work boundary, then acknowledge_message what you have handled.';

export type McpToolMode = 'search' | 'full';

/**
 * `search` (default) advertises only search_tools/call_tool to keep the client
 * tool list small; `full` advertises every board tool directly. Override with
 * AGENT_BOARD_MCP_TOOLS=full for clients that cannot do tool discovery.
 */
export function defaultToolMode(): McpToolMode {
  return process.env['AGENT_BOARD_MCP_TOOLS']?.trim().toLowerCase() === 'full' ? 'full' : 'search';
}

function registerAllTools(server: McpServer): void {
  for (const tool of BOARD_TOOLS) {
    const hasInput = Object.keys(tool.shape).length > 0;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        ...(hasInput ? { inputSchema: tool.shape } : {}),
      },
      async (args: unknown) => tool.handler(args as never),
    );
  }
}

function registerSearchTools(server: McpServer): void {
  server.registerTool(
    'search_tools',
    {
      description:
        'Find agent-board tools by intent and get their JSON Schemas. Run the result with call_tool. ' +
        `Known tools: ${TOOL_NAMES.join(', ')}.`,
      inputSchema: {
        query: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('What you want to do, e.g. "claim a task" or "check mail". Omit to list all.'),
        limit: z.number().int().min(1).max(BOARD_TOOLS.length).optional(),
      },
    },
    async ({ query, limit }) => {
      const terms = (query ?? '')
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter(Boolean);
      const ranked = terms.length
        ? BOARD_TOOLS.map((tool) => ({ tool, score: scoreTool(tool, terms) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
            .map((entry) => entry.tool)
        : [...BOARD_TOOLS];
      const matches = ranked.slice(0, limit ?? (terms.length ? 5 : BOARD_TOOLS.length));
      return toolResult({
        tools: matches.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: inputSchemaOf(tool),
        })),
        matched: ranked.length,
        all_tools: TOOL_NAMES,
      });
    },
  );

  server.registerTool(
    'call_tool',
    {
      description:
        'Run one agent-board tool by name with its arguments. Use search_tools first if you are ' +
        'unsure of the name or the argument shape.',
      inputSchema: {
        tool: z.string().trim().min(1).describe('Tool name, e.g. "claim_task"'),
        args: z
          .record(z.unknown())
          .optional()
          .describe('Arguments object for that tool; omit when it takes none.'),
      },
    },
    async ({ tool, args }) => {
      const target = TOOLS_BY_NAME.get(tool);
      if (!target) {
        return toolError(`Unknown tool "${tool}". Use search_tools to find the right name.`, {
          reason: 'unknown_tool',
          all_tools: TOOL_NAMES,
        });
      }
      const parsed = z.object(target.shape).safeParse(args ?? {});
      if (!parsed.success) {
        return toolError(
          `Invalid arguments for ${tool}: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
            .join('; ')}`,
          {
            reason: 'invalid_arguments',
            tool,
            inputSchema: inputSchemaOf(target),
          },
        );
      }
      return target.handler(parsed.data as never);
    },
  );
}

/** Create one stateless MCP server instance for a single HTTP request. */
export function createMailboxMcpServer(options: { mode?: McpToolMode } = {}): McpServer {
  const mode = options.mode ?? defaultToolMode();
  const server = new McpServer(
    { name: 'agent-board', version: '1.2.0' },
    { instructions: mode === 'full' ? FULL_INSTRUCTIONS : SEARCH_INSTRUCTIONS },
  );

  if (mode === 'full') registerAllTools(server);
  else registerSearchTools(server);

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
