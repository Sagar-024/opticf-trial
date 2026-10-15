/**
 * Tasks: work assigned to a person from something seen in the workspace.
 *
 * Kept in this browser for the trial, like the chats. The board is real, the
 * delivery is not: a task reaches its person the day the platform has accounts.
 * The store mirrors the chat store's shape so both can move server-side the
 * same way.
 */

import { plainDashes } from './text';

export interface TaskSource {
  /** What the task came from, e.g. "Chorlton" or "North West". */
  label: string;
  practiceId?: string;
  region?: string;
  /** The line that was on screen, e.g. "Revenue -3.1% vs £80,510". */
  finding?: string;
  /** Set when a skill created this task, e.g. "watch-cl". */
  automationJob?: string;
}

export interface Task {
  id: string;
  title: string;
  note?: string;
  assignee: string;
  assigneeRole: string;
  /** YYYY-MM-DD, optional. */
  due?: string;
  status: 'open' | 'done';
  createdAt: number;
  createdBy: string;
  source?: TaskSource;
  /** What changed when it was closed, in the closer's words. The record
      leadership actually reads: not that it was ticked, but that it moved. */
  outcome?: string;
  /** When it was closed; cleared on reopen, so it always means "closed now". */
  closedAt?: number;
}

const TASKS_KEY = 'opticf-tasks-v1';
const listeners = new Set<() => void>();

/** Stored text can predate the no-dashes rule; clean it on the way out. */
function plainTask(task: Task): Task {
  return {
    ...task,
    title: plainDashes(task.title),
    ...(task.note !== undefined ? { note: plainDashes(task.note) } : {}),
    ...(task.outcome !== undefined ? { outcome: plainDashes(task.outcome) } : {}),
    ...(task.source
      ? {
          source: {
            ...task.source,
            label: plainDashes(task.source.label),
            ...(task.source.finding !== undefined ? { finding: plainDashes(task.source.finding) } : {}),
          },
        }
      : {}),
  };
}

export function listTasks(): Task[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TASKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as Task[]).map(plainTask).slice().sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function write(tasks: Task[]): void {
  try {
    window.localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, 200)));
  } catch {
    // Storage unavailable; the board simply stops growing.
  }
  listeners.forEach((listener) => listener());
}

export function addTask(task: Omit<Task, 'id' | 'createdAt' | 'status'>): Task {
  const full: Task = {
    ...task,
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    status: 'open',
  };
  write([full, ...listTasks()]);
  return full;
}

/**
 * Insert tasks that already carry their ids: the seeded history, and the
 * one-time migration of tasks that used to live in the automations store.
 * Existing ids are skipped, so this is safe to call more than once.
 */
export function importTasks(tasks: Task[]): void {
  if (tasks.length === 0) return;
  const existing = new Set(listTasks().map((task) => task.id));
  const fresh: Task[] = [];
  for (const task of tasks) {
    if (existing.has(task.id)) continue;
    existing.add(task.id);
    fresh.push(task);
  }
  if (fresh.length === 0) return;
  write([...fresh, ...listTasks()]);
}

/**
 * Close a task with the outcome: what changed. The outcome is optional, but
 * it is the point of the record: a done tick says the work stopped, the
 * outcome says whether the problem did.
 */
export function closeTask(id: string, outcome?: string): void {
  const clean = outcome?.trim();
  write(
    listTasks().map((task) =>
      task.id === id
        ? { ...task, status: 'done' as const, outcome: clean || undefined, closedAt: Date.now() }
        : task,
    ),
  );
}

/**
 * Reopen: the outcome stays as history (a re-close pre-fills it), the close
 * date goes, because the task is not closed anymore.
 */
export function reopenTask(id: string): void {
  write(
    listTasks().map((task) =>
      task.id === id ? { ...task, status: 'open' as const, closedAt: undefined } : task,
    ),
  );
}

/** Move a task's review date; an empty value clears it. */
export function setTaskDue(id: string, due?: string): void {
  write(listTasks().map((task) => (task.id === id ? { ...task, due: due || undefined } : task)));
}

export function deleteTask(id: string): void {
  write(listTasks().filter((task) => task.id !== id));
}

export function subscribeToTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Today as YYYY-MM-DD, so due dates compare as plain strings. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(task: Task): boolean {
  if (!task.due || task.status === 'done') return false;
  return task.due < today();
}

/** "due 18 Oct" or "overdue, was due 12 Oct", in the reader's words. */
export function dueLabel(task: Task): string | null {
  if (!task.due) return null;
  const formatted = new Date(`${task.due}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  return isOverdue(task) ? `overdue, was due ${formatted}` : `due ${formatted}`;
}
