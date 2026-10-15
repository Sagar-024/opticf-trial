import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addTask,
  closeTask,
  deleteTask,
  dueLabel,
  importTasks,
  isOverdue,
  listTasks,
  reopenTask,
  setTaskDue,
  subscribeToTasks,
  today,
} from '../src/lib/task-store';

/**
 * The store reads and writes window.localStorage; the suite runs in node, so
 * every test gets a fresh in-memory window. Each test starts empty, which is
 * also what a clean browser sees.
 */
function stubWindow(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
}

const draft = {
  title: 'Lift North West conversion',
  assignee: 'Emma Lawson',
  assigneeRole: 'North West lead',
  createdBy: 'Sara Kelly',
};

beforeEach(stubWindow);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('task store', () => {
  it('adds a task as open and lists it newest first', () => {
    const first = addTask(draft);
    const second = addTask({ ...draft, title: 'Second task' });
    expect(first.status).toBe('open');
    expect(listTasks().map((task) => task.id)).toEqual([second.id, first.id]);
  });

  it('closes with the outcome, trimmed, and a close date', () => {
    const task = addTask(draft);
    closeTask(task.id, '  conversion back to 57.1%  ');
    const closed = listTasks()[0];
    expect(closed.status).toBe('done');
    expect(closed.outcome).toBe('conversion back to 57.1%');
    expect(typeof closed.closedAt).toBe('number');
  });

  it('closes without an outcome when the line is left empty', () => {
    const task = addTask(draft);
    closeTask(task.id, '   ');
    const closed = listTasks()[0];
    expect(closed.status).toBe('done');
    expect(closed.outcome).toBeUndefined();
    expect(typeof closed.closedAt).toBe('number');
  });

  it('reopening keeps the outcome as history and clears the close date', () => {
    const task = addTask(draft);
    closeTask(task.id, 'rota fixed');
    reopenTask(task.id);
    const open = listTasks()[0];
    expect(open.status).toBe('open');
    expect(open.outcome).toBe('rota fixed');
    expect(open.closedAt).toBeUndefined();
  });

  it('re-closing after a reopen replaces the outcome', () => {
    const task = addTask(draft);
    closeTask(task.id, 'first attempt');
    reopenTask(task.id);
    closeTask(task.id, 'conversion back to 57.1%');
    const closed = listTasks()[0];
    expect(closed.status).toBe('done');
    expect(closed.outcome).toBe('conversion back to 57.1%');
  });

  it('deletes a task', () => {
    const task = addTask(draft);
    deleteTask(task.id);
    expect(listTasks()).toEqual([]);
  });

  it('imports tasks with their ids and skips ones already there', () => {
    const seeded = {
      ...addTask(draft),
      id: 'task-seeded-1',
      source: { label: 'Chorlton', practiceId: 'P001', automationJob: 'watch-cl' },
    };
    importTasks([seeded, seeded]);
    expect(listTasks().filter((task) => task.id === 'task-seeded-1')).toHaveLength(1);
    importTasks([seeded]);
    expect(listTasks().filter((task) => task.id === 'task-seeded-1')).toHaveLength(1);
  });

  it('moves a review date, and clears it on an empty value', () => {
    const task = addTask(draft);
    setTaskDue(task.id, '2026-10-22');
    expect(listTasks()[0]?.due).toBe('2026-10-22');
    setTaskDue(task.id, '');
    expect(listTasks()[0]?.due).toBeUndefined();
  });

  it('notifies subscribers on every write', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToTasks(() => seen.push(listTasks().length));
    const task = addTask(draft);
    closeTask(task.id, 'done it');
    deleteTask(task.id);
    unsubscribe();
    expect(seen).toEqual([1, 1, 0]);
  });

  it('flags overdue only for open tasks with a past due date', () => {
    const task = addTask({ ...draft, due: '2020-01-01' });
    expect(isOverdue(task)).toBe(true);
    expect(isOverdue({ ...task, due: today() })).toBe(false);
    expect(isOverdue({ ...task, status: 'done' })).toBe(false);
  });

  it("labels due dates in the reader's words", () => {
    const task = addTask(draft);
    expect(dueLabel({ ...task, due: '2020-01-01' })).toMatch(/^overdue, was due 1 Jan$/);
    expect(dueLabel({ ...task, due: '2999-12-31' })).toMatch(/^due 31 Dec$/);
    expect(dueLabel(task)).toBeNull();
  });
});
