/**
 * Board data service.
 *
 * Reads use `httpResource` so the board is reactive: changing the repo/search
 * signals re-issues the query automatically, and a browser-only polling timer
 * calls `reload()` so agents' changes show up without a manual refresh. Writes
 * go through `HttpClient` and then trigger a reload of the affected resources.
 */
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Agent, Channel, MailMessage, Task, TaskStatus } from './models';

/** How often (ms) the browser re-polls the board for other agents' changes. */
const POLL_INTERVAL_MS = 4000;

@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Active repo filter (`null` = all repos). */
  readonly repoFilter = signal<string | null>(null);
  /** Free-text search across title/body/tags. */
  readonly search = signal('');
  readonly archiveSearch = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly mutationPending = signal(false);

  /** Query string derived from the current filters. */
  private readonly taskQuery = computed(() => {
    const params = new URLSearchParams();
    const repo = this.repoFilter();
    const q = this.search().trim();
    if (repo) {
      params.set('repo', repo);
    }
    if (q) {
      params.set('q', q);
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  });

  /** All tasks matching the current filters. */
  readonly tasks = httpResource<Task[]>(() => `/api/tasks${this.taskQuery()}`, {
    defaultValue: [],
  });

  /** Every agent that has checked in with the board. */
  readonly agents = httpResource<Agent[]>(() => `/api/agents`, {
    defaultValue: [],
  });

  readonly messages = httpResource<MailMessage[]>(() => `/api/messages?limit=200`, {
    defaultValue: [],
  });

  /** Every group-chat channel with its membership. */
  readonly channels = httpResource<Channel[]>(() => `/api/channels`, {
    defaultValue: [],
  });

  readonly recentlyCompleted = httpResource<Task[]>(
    () => {
      const repo = this.repoFilter();
      return `/api/tasks/recently-completed?limit=8${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`;
    },
    { defaultValue: [] },
  );

  readonly archive = httpResource<Task[]>(
    () => {
      const params = new URLSearchParams({ limit: '200' });
      const repo = this.repoFilter();
      const q = this.archiveSearch().trim();
      if (repo) params.set('repo', repo);
      if (q) params.set('q', q);
      return `/api/archive?${params.toString()}`;
    },
    { defaultValue: [] },
  );

  /** Distinct repo names, for the filter dropdown. */
  readonly repos = httpResource<string[]>(() => `/api/repos`, {
    defaultValue: [],
  });

  constructor() {
    if (this.isBrowser) {
      setInterval(() => this.reloadAll(), POLL_INTERVAL_MS);
    }
  }

  /** Force an immediate refresh of every resource. */
  reloadAll(): void {
    this.tasks.reload();
    this.agents.reload();
    this.recentlyCompleted.reload();
    this.archive.reload();
    this.repos.reload();
    this.messages.reload();
    this.channels.reload();
  }

  /** Create a new task, then refresh. */
  async createTask(input: {
    repo: string;
    title: string;
    body: string;
    tags: string;
    priority: number;
    agent: string;
  }): Promise<void> {
    await this.runMutation(firstValueFrom(this.http.post('/api/tasks', input)));
  }

  /** Attempt to claim a task for `agent`. Resolves to `false` on conflict. */
  async claim(id: number, agent: string): Promise<boolean> {
    this.errorMessage.set(null);
    this.mutationPending.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/tasks/${id}/claim`, { agent }));
      this.reloadAll();
      return true;
    } catch (error: unknown) {
      this.reloadAll();
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.errorMessage.set('That task was claimed by another agent.');
        return false;
      }
      this.errorMessage.set(this.messageFor(error));
      throw error;
    } finally {
      this.mutationPending.set(false);
    }
  }

  /** Release a claim back to the todo column. */
  async release(id: number, agent: string): Promise<void> {
    await this.runMutation(firstValueFrom(this.http.post(`/api/tasks/${id}/release`, { agent })));
  }

  /** Move a task to a new status. */
  async setStatus(id: number, status: TaskStatus, agent: string): Promise<void> {
    await this.runMutation(
      firstValueFrom(this.http.post(`/api/tasks/${id}/status`, { status, agent })),
    );
  }

  /** Delete a task. */
  async remove(id: number): Promise<void> {
    await this.runMutation(firstValueFrom(this.http.delete(`/api/tasks/${id}`)));
  }

  async sendMessage(from: string, to: string, message: string): Promise<void> {
    await this.runMutation(firstValueFrom(this.http.post('/api/messages', { from, to, message })));
  }

  /** Create a group-chat channel, seeded with `members`, then refresh. */
  async createChannel(name: string, agent: string, members: string[]): Promise<Channel> {
    return this.runMutation(
      firstValueFrom(this.http.post<Channel>('/api/channels', { name, agent, members })),
    );
  }

  /** Add `agent` to a channel, then refresh. */
  async joinChannel(id: string, agent: string): Promise<void> {
    await this.runMutation(firstValueFrom(this.http.post(`/api/channels/${id}/join`, { agent })));
  }

  /** Remove `agent` from a channel, then refresh. */
  async leaveChannel(id: string, agent: string): Promise<void> {
    await this.runMutation(firstValueFrom(this.http.post(`/api/channels/${id}/leave`, { agent })));
  }

  private async runMutation<T>(request: Promise<T>): Promise<T> {
    this.errorMessage.set(null);
    this.mutationPending.set(true);
    try {
      const result = await request;
      this.reloadAll();
      return result;
    } catch (error: unknown) {
      this.errorMessage.set(this.messageFor(error));
      this.reloadAll();
      throw error;
    } finally {
      this.mutationPending.set(false);
    }
  }

  private messageFor(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { error?: unknown } | null;
      if (typeof body?.error === 'string') {
        return body.error;
      }
      if (error.status === 0) {
        return 'The board server is unavailable.';
      }
    }
    return 'The action could not be completed.';
  }
}
