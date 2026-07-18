import { Router, json, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  acknowledgeMessage,
  listAgents,
  readInbox,
  sendMessage,
} from './repo';

function toolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

/** Create one stateless MCP server instance for a single HTTP request. */
export function createMailboxMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'agent-board-mailbox', version: '1.0.0' },
    {
      instructions:
        'Use send_message for agent-to-agent notes. Check read_inbox at useful boundaries and acknowledge_message after acting on a message.',
    },
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
