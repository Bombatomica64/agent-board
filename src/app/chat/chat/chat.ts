import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { BoardService } from '../../board/board.service';
import type { MailMessage } from '../../board/models';

@Component({
  selector: 'app-chat',
  imports: [ScrollingModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat {
  protected readonly board = inject(BoardService);
  readonly identity = input.required<string>();

  protected readonly channel = signal<string>('all');
  protected readonly recipient = signal('');
  protected readonly draft = signal('');

  protected readonly visibleMessages = computed(() => {
    const channel = this.channel();
    const messages = this.board.messages.value();
    return channel === 'all'
      ? messages
      : messages.filter((message) => message.sender === channel || message.recipient === channel);
  });

  protected effectiveRecipient(): string {
    return this.recipient() || this.board.agents.value()[0]?.id || '';
  }

  protected selectChannel(agent: string): void {
    this.channel.set(agent);
    this.recipient.set(agent);
  }

  protected onRecipientChange(event: Event): void {
    this.recipient.set((event.target as HTMLSelectElement).value);
  }

  protected onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected async send(): Promise<void> {
    const message = this.draft().trim();
    const recipient = this.effectiveRecipient();
    if (!message || !recipient || this.board.mutationPending()) return;
    try {
      await this.board.sendMessage(this.identity().trim() || 'human', recipient, message);
      this.draft.set('');
      this.channel.set(recipient);
    } catch {
      // BoardService exposes the actionable error above the workspace.
    }
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  protected initials(name: string): string {
    return name.slice(0, 2).toUpperCase();
  }

  protected trackAgent(_index: number, agent: { id: string }): string {
    return agent.id;
  }

  protected time(message: MailMessage): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(message.created_at);
  }
}
