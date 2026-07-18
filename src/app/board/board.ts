/**
 * The board page: the human-facing view of the shared agent bulletin board.
 *
 * It renders tasks as cards grouped into status columns, shows which agents are
 * online, shows recently completed work, and lets a human (identifying as one of
 * the agents, or as themselves) create, claim, and move tasks. All reads come
 * from {@link BoardService}, which polls so other agents' changes appear live.
 */
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BoardService } from './board.service';
import {
  COLUMNS,
  ONLINE_WINDOW_MS,
  type Agent,
  type Task,
  type TaskStatus,
} from './models';

/** localStorage key under which the chosen board identity is remembered. */
const IDENTITY_KEY = 'agent-board.identity';

@Component({
  selector: 'app-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board.html',
  styleUrl: './board.scss',
})
export class Board {
  protected readonly board = inject(BoardService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly columns = COLUMNS;

  /** Who the web user is acting as when they claim/create (defaults to human). */
  protected readonly identity = signal<string>('human');

  /** New-task form fields. */
  protected readonly draftTitle = signal('');
  protected readonly draftRepo = signal('');
  protected readonly draftBody = signal('');
  protected readonly draftTags = signal('');
  protected readonly draftPriority = signal(0);
  protected readonly formOpen = signal(false);
  protected readonly archiveOpen = signal(false);

  /** Tasks grouped by status, so each column can read its bucket directly. */
  protected readonly grouped = computed(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of COLUMNS) {
      map.set(col.status, []);
    }
    for (const task of this.board.tasks.value()) {
      map.get(task.status)?.push(task);
    }
    return map;
  });

  constructor() {
    if (this.isBrowser) {
      const saved = localStorage.getItem(IDENTITY_KEY);
      if (saved) {
        this.identity.set(saved);
      }
      effect(() => localStorage.setItem(IDENTITY_KEY, this.identity()));
    }
  }

  /** Tasks currently in the given column. */
  protected tasksFor(status: TaskStatus): Task[] {
    return this.grouped().get(status) ?? [];
  }

  /** True if the agent checked in recently enough to count as online. */
  protected isOnline(agent: Agent): boolean {
    return Date.now() - agent.last_seen < ONLINE_WINDOW_MS;
  }

  /** Split a comma/space separated tag string into chips. */
  protected chips(tags: string): string[] {
    return tags
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  /** Human-friendly relative time, e.g. "3m ago". */
  protected ago(ts: number | null): string {
    if (!ts) {
      return '';
    }
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  /** Set the repo filter (empty string clears it). */
  protected onRepoFilter(value: string): void {
    this.board.repoFilter.set(value ? value : null);
  }

  protected onIdentityInput(event: Event): void {
    this.identity.set((event.target as HTMLInputElement).value);
  }

  protected onRepoFilterChange(event: Event): void {
    this.onRepoFilter((event.target as HTMLSelectElement).value);
  }

  protected onSearchInput(event: Event): void {
    this.board.search.set((event.target as HTMLInputElement).value);
  }

  protected onArchiveSearchInput(event: Event): void {
    this.board.archiveSearch.set((event.target as HTMLInputElement).value);
  }

  protected onDraftInput(
    field: 'title' | 'repo' | 'tags' | 'body',
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    const target = {
      title: this.draftTitle,
      repo: this.draftRepo,
      tags: this.draftTags,
      body: this.draftBody,
    }[field];
    target.set(value);
  }

  protected onPriorityInput(event: Event): void {
    this.draftPriority.set(Number((event.target as HTMLInputElement).value) || 0);
  }

  /** Submit the new-task form. */
  protected async submit(): Promise<void> {
    const title = this.draftTitle().trim();
    if (!title) {
      return;
    }
    try {
      await this.board.createTask({
        title,
        repo: this.draftRepo().trim() || 'global',
        body: this.draftBody().trim(),
        tags: this.draftTags().trim(),
        priority: Number(this.draftPriority()) || 0,
        agent: this.identity(),
      });
    } catch {
      return;
    }
    this.draftTitle.set('');
    this.draftBody.set('');
    this.draftTags.set('');
    this.draftPriority.set(0);
    this.formOpen.set(false);
  }

  /** Try to claim a task; surface a message if another agent beat us to it. */
  protected async claim(task: Task): Promise<void> {
    await this.safely(() => this.board.claim(task.id, this.identity()));
  }

  protected async release(task: Task): Promise<void> {
    await this.safely(() => this.board.release(task.id, this.identity()));
  }

  protected async move(task: Task, status: TaskStatus): Promise<void> {
    await this.safely(() => this.board.setStatus(task.id, status, this.identity()));
  }

  protected async remove(task: Task): Promise<void> {
    if (!this.isBrowser || confirm(`Delete task #${task.id}?`)) {
      await this.safely(() => this.board.remove(task.id));
    }
  }

  private async safely(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch {
      // BoardService exposes the actionable error in the page.
    }
  }

}
