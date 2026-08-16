import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../board/board.service';
import type { MailMessage } from '../../board/models';
import { Chat } from './chat';

/** Minimal BoardService stand-in covering everything the chat template reads. */
function stubBoard(overrides: Record<string, unknown> = {}) {
  const unread = new Map<string, number>();
  return {
    agents: {
      value: signal([
        {
          id: 'codex-root',
          kind: 'codex',
          host: null,
          created_at: 1,
          last_seen: 1,
        },
      ]),
    },
    messages: { value: signal<MailMessage[]>([]) },
    channels: { value: signal([]) },
    threads: { value: signal([]) },
    unreadCounts: { value: signal([]) },
    messageSearch: signal(''),
    messageThread: signal<string | null>(null),
    messageUnreadOnly: signal(false),
    totalUnread: () => 0,
    unreadFor: (recipient: string) => unread.get(recipient) ?? 0,
    mutationPending: signal(false),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    acknowledgeMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function message(patch: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 1,
    sender: 'codex-root',
    recipient: 'human',
    body: 'Need a review on task 13.',
    thread_id: null,
    created_at: 1,
    acked_at: null,
    unread: true,
    ...patch,
  };
}

describe('Chat', () => {
  it('sends a direct message using the selected agent', async () => {
    const board = stubBoard();
    TestBed.configureTestingModule({
      providers: [{ provide: BoardService, useValue: board }],
    });
    const fixture = TestBed.createComponent(Chat);
    fixture.componentRef.setInput('identity', 'human');
    await fixture.whenStable();

    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Can you check task 13?';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const send = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);

    send.click();
    await fixture.whenStable();

    expect(board.sendMessage).toHaveBeenCalledWith(
      'human',
      'codex-root',
      'Can you check task 13?',
      '',
    );
    expect(textarea.value).toBe('');
  });

  it('shows acknowledgement state and acknowledges as the current identity', async () => {
    const board = stubBoard({ messages: { value: signal([message()]) } });
    TestBed.configureTestingModule({
      providers: [{ provide: BoardService, useValue: board }],
    });
    const fixture = TestBed.createComponent(Chat);
    fixture.componentRef.setInput('identity', 'human');
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Unread');
    expect(text).toContain('1 unread');

    const ack = fixture.nativeElement.querySelector('.ack-button') as HTMLButtonElement;
    ack.click();
    await fixture.whenStable();

    expect(board.acknowledgeMessage).toHaveBeenCalledWith(1, 'human');
  });

  it('renders acknowledged messages without an acknowledge action', async () => {
    const board = stubBoard({
      messages: { value: signal([message({ unread: false, acked_at: 5 })]) },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: BoardService, useValue: board }],
    });
    const fixture = TestBed.createComponent(Chat);
    fixture.componentRef.setInput('identity', 'human');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Acknowledged');
    expect(fixture.nativeElement.querySelector('.ack-button')).toBeNull();
  });

  it('drives the mailbox search and unread filters through the board service', async () => {
    const board = stubBoard();
    TestBed.configureTestingModule({
      providers: [{ provide: BoardService, useValue: board }],
    });
    const fixture = TestBed.createComponent(Chat);
    fixture.componentRef.setInput('identity', 'human');
    await fixture.whenStable();

    const search = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'review';
    search.dispatchEvent(new Event('input'));
    const toggle = fixture.nativeElement.querySelector('.filter-toggle') as HTMLButtonElement;
    toggle.click();
    await fixture.whenStable();

    expect(board.messageSearch()).toBe('review');
    expect(board.messageUnreadOnly()).toBe(true);
  });
});
