/**
 * Tasks: work assigned to a person from something seen in the workspace.
 *
 * Kept in this browser for the trial, like the chats. The board is real, the
 * delivery is not: a task reaches its person the day the platform has accounts.
 * The store mirrors the chat store's shape so both can move server-side the
 * same way.
 */

export interface TaskSource {
  /** What the task came from, e.g. "Chorlton" or "North West". */
  label: string;
  practiceId?: string;
  region?: string;
  /** The line that was on screen, e.g. "Revenue -3.1% vs £80,510". */
  finding?: string;
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
}

const TASKS_KEY = 'opticf-tasks-v1';
const listeners = new Set<() => void>();

export function listTasks(): Task[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TASKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as Task[]).slice().sort((a, b) => b.createdAt - a.createdAt);
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

export function setTaskStatus(id: string, status: Task['status']): void {
  write(listTasks().map((task) => (task.id === id ? { ...task, status } : task)));
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
