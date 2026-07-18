/**
 * Board data service.
 *
 * Reads use `httpResource` so the board is reactive: changing the repo/search
 * signals re-issues the query automatically, and a browser-only polling timer
 * calls `reload()` so agents' changes show up without a manual refresh. Writes
 * go through `HttpClient` and then trigger a reload of the affected resources.
 */
import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Activity, Agent, Task, TaskStatus } from './models';

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

  /** The activity feed, optionally scoped to the selected repo. */
  readonly activity = httpResource<Activity[]>(
    () => {
      const repo = this.repoFilter();
      return `/api/activity?limit=60${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`;
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
    this.activity.reload();
    this.repos.reload();
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
    await firstValueFrom(this.http.post('/api/tasks', input));
    this.reloadAll();
  }

  /** Attempt to claim a task for `agent`. Resolves to `false` on conflict. */
  async claim(id: number, agent: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post(`/api/tasks/${id}/claim`, { agent }));
      this.reloadAll();
      return true;
    } catch {
      this.reloadAll();
      return false;
    }
  }

  /** Release a claim back to the todo column. */
  async release(id: number, agent: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/tasks/${id}/release`, { agent }));
    this.reloadAll();
  }

  /** Move a task to a new status. */
  async setStatus(id: number, status: TaskStatus, agent: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`/api/tasks/${id}/status`, { status, agent }),
    );
    this.reloadAll();
  }

  /** Delete a task. */
  async remove(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/tasks/${id}`));
    this.reloadAll();
  }
}
