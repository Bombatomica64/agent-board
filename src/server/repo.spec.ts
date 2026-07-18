import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let tempDir: string;
let repo: typeof import('./repo');
let closeDatabase: typeof import('./db').closeDatabase;
let database: ReturnType<typeof import('./db').db>;
let createMailboxMcpServer: typeof import('./mcp').createMailboxMcpServer;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'agent-board-test-'));
  process.env['AGENT_BOARD_DB'] = join(tempDir, 'board.db');
  repo = await import('./repo');
  const dbModule = await import('./db');
  closeDatabase = dbModule.closeDatabase;
  database = dbModule.db();
  ({ createMailboxMcpServer } = await import('./mcp'));
});

describe('mailbox', () => {
  it('delivers messages only to the intended recipient and supports acknowledgement', () => {
    const message = repo.sendMessage({
      sender: 'alice',
      recipient: 'bob',
      body: 'Please review task 12.',
      thread_id: 'task-12',
    });

    expect(repo.readInbox({ agent: 'alice' })).toEqual([]);
    expect(repo.readInbox({ agent: 'bob' })).toEqual([message]);
    expect(repo.acknowledgeMessage(message.id, 'alice')).toBeUndefined();
    expect(repo.acknowledgeMessage(message.id, 'bob')?.acked_at).not.toBeNull();
    expect(repo.readInbox({ agent: 'bob' })).toEqual([]);
    expect(
      repo.readInbox({ agent: 'bob', include_acknowledged: true }),
    ).toHaveLength(1);
  });

  it('exposes send, read, and acknowledge through MCP tools', async () => {
    const server = createMailboxMcpServer();
    const client = new Client({ name: 'mailbox-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const sent = await client.callTool({
      name: 'send_message',
      arguments: { from: 'codex', to: 'claude', message: 'Your turn.' },
    });
    const inbox = await client.callTool({
      name: 'read_inbox',
      arguments: { agent: 'claude' },
    });

    expect(sent.isError).not.toBe(true);
    expect(JSON.stringify(inbox.structuredContent)).toContain('Your turn.');

    await client.close();
    await server.close();
  });
});

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env['AGENT_BOARD_DB'];
});

describe('task lifecycle integrity', () => {
  it('does not let another agent release a claimed task', () => {
    const task = repo.createTask({ title: 'owned task' });
    expect(repo.claimTask(task.id, 'alice').ok).toBe(true);

    const result = repo.releaseTask(task.id, 'bob');

    expect(result.ok).toBe(false);
    expect(repo.getTask(task.id)?.claimed_by).toBe('alice');
  });

  it('rejects invalid transitions and cross-owner status changes', () => {
    const task = repo.createTask({ title: 'transition task' });
    expect(repo.claimTask(task.id, 'alice').ok).toBe(true);

    const invalid = repo.setStatus(task.id, 'done', 'alice');
    const conflict = repo.setStatus(task.id, 'in_progress', 'bob');

    expect(invalid).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(conflict).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('clears ownership on completion so completed work cannot be reclaimed', () => {
    const task = repo.createTask({ title: 'completed task' });
    repo.claimTask(task.id, 'alice');
    repo.setStatus(task.id, 'in_progress', 'alice');

    const completed = repo.setStatus(task.id, 'done', 'alice');
    const reclaimed = repo.claimTask(task.id, 'alice');

    expect(completed.ok && completed.task.claimed_by).toBeNull();
    expect(reclaimed).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('rejects comments for tasks that do not exist', () => {
    expect(repo.commentTask(999_999, 'alice', 'hello')).toBe(false);
  });

  it('moves completed work from recent results into the searchable archive', () => {
    const task = repo.createTask({
      title: 'archive search target',
      tags: 'retention',
      created_by: 'alice',
    });
    repo.claimTask(task.id, 'alice');
    repo.setStatus(task.id, 'in_progress', 'alice');
    repo.setStatus(task.id, 'done', 'alice');

    expect(repo.listRecentlyCompleted().map((item) => item.id)).toContain(task.id);

    database
      .prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`)
      .run(Date.now() - repo.ARCHIVE_AFTER_MS - 1, task.id);

    expect(repo.listTasks().map((item) => item.id)).not.toContain(task.id);
    expect(repo.listRecentlyCompleted().map((item) => item.id)).not.toContain(task.id);
    expect(repo.listArchivedTasks({ q: 'retention' }).map((item) => item.id)).toContain(task.id);
  });
});
