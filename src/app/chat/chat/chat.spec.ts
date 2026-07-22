import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BoardService } from '../../board/board.service';
import { Chat } from './chat';

describe('Chat', () => {
  it('sends a direct message using the selected agent', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const board = {
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
      messages: { value: signal([]) },
      mutationPending: signal(false),
      sendMessage,
    };
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

    expect(sendMessage).toHaveBeenCalledWith('human', 'codex-root', 'Can you check task 13?');
    expect(textarea.value).toBe('');
  });
});
