/**
 * Frontend view models. These mirror the JSON shapes returned by the `/api`
 * endpoints (see `src/server/repo.ts`). Kept as a standalone file so both the
 * service and the components share one source of truth.
 */

/** Lifecycle states a task can be in, in board column order. */
export type TaskStatus = 'todo' | 'claimed' | 'in_progress' | 'blocked' | 'done' | 'abandoned';

/** Known agent runtimes. */
export type AgentKind = 'claude' | 'codex' | 'other';

/** A unit of work on the board. */
export interface Task {
  id: number;
  repo: string;
  title: string;
  body: string;
  status: TaskStatus;
  claimed_by: string | null;
  claimed_at: number | null;
  tags: string;
  priority: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

/** An agent process that has checked in with the board. */
export interface Agent {
  id: string;
  kind: AgentKind;
  host: string | null;
  created_at: number;
  last_seen: number;
}

export interface MailMessage {
  id: number;
  sender: string;
  recipient: string;
  body: string;
  thread_id: string | null;
  created_at: number;
  acked_at: number | null;
}

/** The board columns, in display order, with human labels. */
export const COLUMNS: readonly { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'claimed', label: 'Claimed' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked', label: 'Blocked' },
];

/** An agent is considered "online" if it has checked in within this window. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
