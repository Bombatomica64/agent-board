import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { BoardService } from '../../board/board.service';
import { CHANNEL_PREFIX, type Channel, type MailMessage } from '../../board/models';

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

  /** Selected conversation: `all`, an agent id (DM), or a `#channel` token. */
  protected readonly channel = signal<string>('all');
  /** Recipient picked from the dropdown while viewing the shared transcript. */
  protected readonly recipient = signal('');
  protected readonly draft = signal('');
  protected readonly newChannelName = signal('');
  protected readonly composingChannel = signal(false);

  /** True when the active conversation is a channel rather than a DM/all view. */
  protected readonly isChannel = computed(() => this.channel().startsWith(CHANNEL_PREFIX));

  protected readonly visibleMessages = computed(() => {
    const channel = this.channel();
    const messages = this.board.messages.value();
    if (channel === 'all') return messages;
    if (channel.startsWith(CHANNEL_PREFIX)) {
      return messages.filter((message) => message.recipient === channel);
    }
    return messages.filter(
      (message) => message.sender === channel || message.recipient === channel,
    );
  });

  /** The channel record backing the active `#channel` view, if any. */
  protected readonly activeChannel = computed(() => {
    const channel = this.channel();
    if (!channel.startsWith(CHANNEL_PREFIX)) return undefined;
    const id = channel.slice(CHANNEL_PREFIX.length);
    return this.board.channels.value().find((entry) => entry.id === id);
  });

  /** Where the composer will send: the active conversation, or the dropdown pick. */
  protected readonly composerTarget = computed(() => {
    const channel = this.channel();
    if (channel !== 'all') return channel;
    return this.recipient() || this.board.agents.value()[0]?.id || '';
  });

  protected selectChannel(token: string): void {
    this.channel.set(token);
  }

  protected onRecipientChange(event: Event): void {
    this.recipient.set((event.target as HTMLSelectElement).value);
  }

  protected onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected async send(): Promise<void> {
    const message = this.draft().trim();
    const target = this.composerTarget();
    if (!message || !target || this.board.mutationPending()) return;
    try {
      await this.board.sendMessage(this.identity().trim() || 'human', target, message);
      this.draft.set('');
      this.channel.set(target);
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

  protected onNewChannelInput(event: Event): void {
    this.newChannelName.set((event.target as HTMLInputElement).value);
  }

  protected async createChannel(): Promise<void> {
    const name = this.newChannelName().trim();
    if (!name || this.board.mutationPending()) return;
    try {
      // Seed the channel with every known agent so messages reach them, plus
      // the human creating it.
      const members = this.board.agents.value().map((agent) => agent.id);
      const channel = await this.board.createChannel(
        name,
        this.identity().trim() || 'human',
        members,
      );
      this.newChannelName.set('');
      this.composingChannel.set(false);
      this.channel.set(CHANNEL_PREFIX + channel.id);
    } catch {
      // BoardService exposes the actionable error above the workspace.
    }
  }

  protected channelToken(channel: Channel): string {
    return CHANNEL_PREFIX + channel.id;
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
