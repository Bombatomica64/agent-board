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
  it('removes expired agents before listing or addressing them', () => {
    repo.heartbeat({ name: 'current' });
    repo.heartbeat({ name: 'expired' });
    database
      .prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`)
      .run(Date.now() - repo.AGENT_TTL_MS - 1, 'expired');

    expect(repo.listAgents().map(({ id }) => id)).toEqual(['current']);
    expect(repo.sendMessage({ sender: 'human', recipient: 'expired', body: 'hello' })).toEqual({
      ok: false,
      reason: 'recipient_not_found',
    });
  });

  it('delivers messages only to the intended recipient and supports acknowledgement', () => {
    repo.heartbeat({ name: 'alice' });
    repo.heartbeat({ name: 'bob' });
    const message = repo.sendMessage({
      sender: 'alice',
      recipient: 'bob',
      body: 'Please review task 12.',
      thread_id: 'task-12',
    });

    expect(repo.readInbox({ agent: 'alice' })).toEqual([]);
    expect(message).toMatchObject({ ok: true });
    if (!message.ok) throw new Error('message was unexpectedly rejected');
    expect(repo.readInbox({ agent: 'bob' })).toEqual([message.message]);
    expect(repo.acknowledgeMessage(message.message.id, 'alice')).toBeUndefined();
    expect(repo.acknowledgeMessage(message.message.id, 'bob')?.acked_at).not.toBeNull();
    expect(repo.readInbox({ agent: 'bob' })).toEqual([]);
    expect(repo.readInbox({ agent: 'bob', include_acknowledged: true })).toHaveLength(1);
  });

  it('lists the recent shared transcript chronologically with cursor pagination', () => {
    repo.heartbeat({ name: 'bob' });
    repo.heartbeat({ name: 'dave' });
    const first = repo.sendMessage({
      sender: 'alice',
      recipient: 'bob',
      body: 'First message',
    });
    const second = repo.sendMessage({
      sender: 'carol',
      recipient: 'dave',
      body: 'Second message',
    });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) throw new Error('messages were unexpectedly rejected');
    expect(repo.listMessages({ after_id: first.message.id })).toEqual([second.message]);
    expect(repo.listMessages({ limit: 1 })).toEqual([second.message]);
  });

  it('exposes send, read, and acknowledge through MCP tools', async () => {
    const server = createMailboxMcpServer();
    const client = new Client({ name: 'mailbox-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await client.callTool({
      name: 'heartbeat',
      arguments: { agent: 'claude', kind: 'claude' },
    });

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

  it('exposes the shared task board lifecycle through MCP tools', async () => {
    const server = createMailboxMcpServer();
    const client = new Client({ name: 'board-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const posted = await client.callTool({
      name: 'post_task',
      arguments: { title: 'MCP-visible task', repo: '/tmp/project', agent: 'alice' },
    });
    const task = (posted.structuredContent as { task: { id: number } }).task;
    const listed = await client.callTool({
      name: 'list_tasks',
      arguments: { repo: '/tmp/project' },
    });
    const claimed = await client.callTool({
      name: 'claim_task',
      arguments: { task_id: task.id, agent: 'alice' },
    });
    const started = await client.callTool({
      name: 'set_task_status',
      arguments: { task_id: task.id, status: 'in_progress', agent: 'alice' },
    });

    expect(JSON.stringify(listed.structuredContent)).toContain('MCP-visible task');
    expect(claimed.isError).not.toBe(true);
    expect(started.structuredContent).toMatchObject({
      task: { id: task.id, status: 'in_progress', claimed_by: 'alice' },
    });

    await client.close();
    await server.close();
  });

  it('reports an MCP claim conflict as a tool error', async () => {
    const task = repo.createTask({ title: 'single owner' });
    repo.claimTask(task.id, 'alice');
    const server = createMailboxMcpServer();
    const client = new Client({ name: 'conflict-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'claim_task',
      arguments: { task_id: task.id, agent: 'bob' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      reason: 'conflict',
      task: { claimed_by: 'alice' },
    });

    await client.close();
    await server.close();
  });
});

describe('channels', () => {
  it('fans a channel message out to every member inbox except the sender', () => {
    const created = repo.createChannel({
      name: 'General Chat',
      created_by: 'grp-a',
      members: ['grp-b', 'grp-c'],
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error('channel was unexpectedly rejected');
    expect(created.channel.id).toBe('general-chat');
    expect(created.channel.members.sort()).toEqual(['grp-a', 'grp-b', 'grp-c']);

    const token = repo.channelRecipient(created.channel.id);
    const sent = repo.sendMessage({ sender: 'grp-a', recipient: token, body: 'hello team' });
    expect(sent).toMatchObject({ ok: true });

    // The sender does not receive their own channel message; members do.
    expect(repo.readInbox({ agent: 'grp-a' })).toEqual([]);
    expect(repo.readInbox({ agent: 'grp-b' }).map((m) => m.body)).toEqual(['hello team']);
    expect(repo.readInbox({ agent: 'grp-c' }).map((m) => m.body)).toEqual(['hello team']);
  });

  it('tracks acknowledgement per member so one ack does not hide it for others', () => {
    const created = repo.createChannel({ name: 'standup', members: ['ack-b', 'ack-c'] });
    if (!created.ok) throw new Error('channel was unexpectedly rejected');
    const sent = repo.sendMessage({
      sender: 'human',
      recipient: repo.channelRecipient(created.channel.id),
      body: 'daily sync',
    });
    if (!sent.ok) throw new Error('message was unexpectedly rejected');

    expect(repo.acknowledgeMessage(sent.message.id, 'ack-b')).toMatchObject({ body: 'daily sync' });
    expect(repo.readInbox({ agent: 'ack-b' })).toEqual([]);
    // ack-c has not acked, so it is still pending for them.
    expect(repo.readInbox({ agent: 'ack-c' }).map((m) => m.body)).toEqual(['daily sync']);
    // A non-member cannot acknowledge the message.
    expect(repo.acknowledgeMessage(sent.message.id, 'stranger')).toBeUndefined();
  });

  it('rejects messages to unknown channels and duplicate channel names', () => {
    expect(repo.sendMessage({ sender: 'human', recipient: '#nope', body: 'x' })).toEqual({
      ok: false,
      reason: 'recipient_not_found',
    });
    expect(repo.createChannel({ name: 'Dup' })).toMatchObject({ ok: true });
    expect(repo.createChannel({ name: 'dup' })).toEqual({ ok: false, reason: 'already_exists' });
    expect(repo.createChannel({ name: '  ' })).toEqual({ ok: false, reason: 'invalid_name' });
  });

  it('reflects membership changes from join and leave', () => {
    const created = repo.createChannel({ name: 'ops' });
    if (!created.ok) throw new Error('channel was unexpectedly rejected');
    const token = repo.channelRecipient(created.channel.id);

    const before = repo.sendMessage({ sender: 'human', recipient: token, body: 'before join' });
    if (!before.ok) throw new Error('message was unexpectedly rejected');
    // Not a member yet, so the channel is invisible.
    expect(repo.readInbox({ agent: 'ops-d' })).toEqual([]);

    repo.joinChannel(created.channel.id, 'ops-d');
    repo.sendMessage({ sender: 'human', recipient: token, body: 'after join' });
    // Membership delivers channel messages; read past the pre-join message.
    expect(
      repo.readInbox({ agent: 'ops-d', after_id: before.message.id }).map((m) => m.body),
    ).toEqual(['after join']);

    repo.leaveChannel(created.channel.id, 'ops-d');
    repo.sendMessage({ sender: 'human', recipient: token, body: 'after leave' });
    // No longer a member, so channel messages stop reaching the inbox.
    expect(repo.readInbox({ agent: 'ops-d', after_id: before.message.id })).toEqual([]);
  });

  it('creates, lists, and messages a channel through MCP tools', async () => {
    const server = createMailboxMcpServer();
    const client = new Client({ name: 'channel-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await client.callTool({ name: 'heartbeat', arguments: { agent: 'zoe', kind: 'claude' } });
    const created = await client.callTool({
      name: 'create_channel',
      arguments: { name: 'MCP Room', agent: 'zoe' },
    });
    const channel = (created.structuredContent as { channel: { id: string } }).channel;
    const listed = await client.callTool({ name: 'list_channels', arguments: {} });
    await client.callTool({
      name: 'send_message',
      arguments: { from: 'human', to: `#${channel.id}`, message: 'ping the room' },
    });
    const inbox = await client.callTool({ name: 'read_inbox', arguments: { agent: 'zoe' } });

    expect(created.isError).not.toBe(true);
    expect(JSON.stringify(listed.structuredContent)).toContain('mcp-room');
    expect(JSON.stringify(inbox.structuredContent)).toContain('ping the room');

    await client.close();
    await server.close();
  });
});

describe('mailbox visibility', () => {
  it('reports unread counts per recipient and clears them on acknowledgement', () => {
    repo.heartbeat({ name: 'unread-a' });
    repo.heartbeat({ name: 'unread-b' });
    const first = repo.sendMessage({ sender: 'human', recipient: 'unread-a', body: 'one' });
    repo.sendMessage({ sender: 'human', recipient: 'unread-a', body: 'two' });
    repo.sendMessage({ sender: 'human', recipient: 'unread-b', body: 'three' });
    if (!first.ok) throw new Error('message was unexpectedly rejected');

    const counts = new Map(repo.unreadCounts().map((row) => [row.recipient, row.unread]));
    expect(counts.get('unread-a')).toBe(2);
    expect(counts.get('unread-b')).toBe(1);
    expect(first.message.unread).toBe(true);
    expect(repo.countInbox('unread-a')).toBe(2);

    repo.acknowledgeMessage(first.message.id, 'unread-a');

    expect(
      new Map(repo.unreadCounts().map((row) => [row.recipient, row.unread])).get('unread-a'),
    ).toBe(1);
    expect(repo.countInbox('unread-a')).toBe(1);
  });

  it('keeps a channel message unread until every member has acknowledged it', () => {
    const created = repo.createChannel({ name: 'unread room', members: ['room-a', 'room-b'] });
    if (!created.ok) throw new Error('channel was unexpectedly rejected');
    const token = repo.channelRecipient(created.channel.id);
    const sent = repo.sendMessage({ sender: 'human', recipient: token, body: 'roll call' });
    if (!sent.ok) throw new Error('message was unexpectedly rejected');

    const unreadFor = () =>
      new Map(repo.unreadCounts().map((row) => [row.recipient, row.unread])).get(token) ?? 0;
    expect(unreadFor()).toBe(1);

    repo.acknowledgeMessage(sent.message.id, 'room-a');
    expect(unreadFor()).toBe(1);

    repo.acknowledgeMessage(sent.message.id, 'room-b');
    expect(unreadFor()).toBe(0);
  });

  it('filters the transcript by text, thread, participant, and unread state', () => {
    repo.heartbeat({ name: 'search-a' });
    repo.heartbeat({ name: 'search-b' });
    const inThread = repo.sendMessage({
      sender: 'human',
      recipient: 'search-a',
      body: 'deploy the indexer',
      thread_id: 'release-9',
    });
    repo.sendMessage({
      sender: 'human',
      recipient: 'search-b',
      body: 'unrelated chatter',
    });
    if (!inThread.ok) throw new Error('message was unexpectedly rejected');
    repo.acknowledgeMessage(inThread.message.id, 'search-a');

    expect(repo.listMessages({ q: 'indexer' }).map((m) => m.id)).toEqual([inThread.message.id]);
    expect(repo.listMessages({ thread_id: 'release-9' }).map((m) => m.id)).toEqual([
      inThread.message.id,
    ]);
    expect(repo.listMessages({ agent: 'search-b' }).map((m) => m.body)).toEqual([
      'unrelated chatter',
    ]);
    // The acknowledged message drops out of the unread view; its sibling stays.
    expect(repo.listMessages({ unread_only: true, agent: 'search-a' })).toEqual([]);
    expect(repo.listMessages({ unread_only: true, agent: 'search-b' })).toHaveLength(1);

    const thread = repo.listThreads().find((entry) => entry.thread_id === 'release-9');
    expect(thread).toMatchObject({ messages: 1, unread: 0 });
  });

  it('searches and lists threads through MCP tools', async () => {
    const server = createMailboxMcpServer();
    const client = new Client({ name: 'search-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await client.callTool({ name: 'heartbeat', arguments: { agent: 'mcp-search' } });
    await client.callTool({
      name: 'send_message',
      arguments: {
        from: 'human',
        to: 'mcp-search',
        message: 'rotate the credentials',
        thread_id: 'ops-42',
      },
    });
    const found = await client.callTool({
      name: 'search_messages',
      arguments: { q: 'rotate', unread_only: true },
    });
    const threads = await client.callTool({ name: 'list_threads', arguments: {} });

    expect(JSON.stringify(found.structuredContent)).toContain('rotate the credentials');
    expect(JSON.stringify(threads.structuredContent)).toContain('ops-42');

    await client.close();
    await server.close();
  });
});

describe('message retention', () => {
  const backdate = (id: number, age: number) =>
    database.prepare(`UPDATE messages SET created_at = ? WHERE id = ?`).run(Date.now() - age, id);

  it('removes acknowledged mail past the TTL and keeps what is still pending', () => {
    repo.heartbeat({ name: 'keep-me' });
    const acked = repo.sendMessage({ sender: 'human', recipient: 'keep-me', body: 'old + acked' });
    const pending = repo.sendMessage({ sender: 'human', recipient: 'keep-me', body: 'old + open' });
    const fresh = repo.sendMessage({ sender: 'human', recipient: 'keep-me', body: 'recent' });
    if (!acked.ok || !pending.ok || !fresh.ok) throw new Error('messages were rejected');
    repo.acknowledgeMessage(acked.message.id, 'keep-me');
    backdate(acked.message.id, repo.MESSAGE_TTL_MS + 1_000);
    backdate(pending.message.id, repo.MESSAGE_TTL_MS + 1_000);

    expect(repo.pruneMessages()).toBe(1);

    const remaining = repo.listMessages({ agent: 'keep-me' }).map((m) => m.id);
    expect(remaining).not.toContain(acked.message.id);
    expect(remaining).toEqual(expect.arrayContaining([pending.message.id, fresh.message.id]));
  });

  it('drops never-acknowledged mail once it passes the hard age ceiling', () => {
    repo.heartbeat({ name: 'ancient' });
    const stale = repo.sendMessage({ sender: 'human', recipient: 'ancient', body: 'forgotten' });
    if (!stale.ok) throw new Error('message was unexpectedly rejected');
    backdate(stale.message.id, repo.MESSAGE_MAX_AGE_MS + 1_000);

    expect(repo.pruneMessages()).toBe(1);
    expect(repo.listMessages({ agent: 'ancient' })).toEqual([]);
  });

  it('bounds each sweep so retention never runs unboundedly', () => {
    repo.heartbeat({ name: 'bulk' });
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const sent = repo.sendMessage({ sender: 'human', recipient: 'bulk', body: `bulk ${i}` });
      if (!sent.ok) throw new Error('message was unexpectedly rejected');
      ids.push(sent.message.id);
    }
    // Age them only once every send is done: sending sweeps opportunistically,
    // so backdating inline would let the next send prune the earlier rows.
    for (const id of ids) backdate(id, repo.MESSAGE_MAX_AGE_MS + 1_000);

    expect(repo.pruneMessages({ limit: 2 })).toBe(2);
    expect(repo.listMessages({ agent: 'bulk' })).toHaveLength(2);
    expect(repo.pruneMessages({ limit: 2 })).toBe(2);
    expect(repo.listMessages({ agent: 'bulk' })).toEqual([]);
    expect(repo.pruneMessages()).toBe(0);
  });

  it('removes per-agent acknowledgements along with the message', () => {
    const created = repo.createChannel({ name: 'retention room', members: ['ret-a', 'ret-b'] });
    if (!created.ok) throw new Error('channel was unexpectedly rejected');
    const sent = repo.sendMessage({
      sender: 'human',
      recipient: repo.channelRecipient(created.channel.id),
      body: 'expiring',
    });
    if (!sent.ok) throw new Error('message was unexpectedly rejected');
    repo.acknowledgeMessage(sent.message.id, 'ret-a');
    repo.acknowledgeMessage(sent.message.id, 'ret-b');
    backdate(sent.message.id, repo.MESSAGE_TTL_MS + 1_000);

    expect(repo.pruneMessages()).toBe(1);
    expect(
      database
        .prepare(`SELECT COUNT(*) AS acks FROM message_acks WHERE message_id = ?`)
        .get(sent.message.id),
    ).toEqual({ acks: 0 });
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
