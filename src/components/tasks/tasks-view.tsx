'use client';

import { useEffect, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Check, ChevronRight, Trash2 } from 'lucide-react';
import {
  deleteTask,
  dueLabel,
  isOverdue,
  listTasks,
  setTaskStatus,
  subscribeToTasks,
  type Task,
  type TaskSource,
} from '@/lib/task-store';
import { cn } from '@/lib/utils';

/**
 * The task board: what was assigned, to whom, by when, and where it came from.
 * The source chip opens the thing it came from, so a task is never a dead end.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
};

function TaskRow({ task, onOpenSource }: { task: Task; onOpenSource: (source: TaskSource) => void }) {
  const source = task.source;
  const overdue = isOverdue(task);
  const due = dueLabel(task);
  const isDone = task.status === 'done';

  return (
    <motion.li
      variants={fadeUp}
      data-anim
      className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 [box-shadow:var(--hi),var(--shadow-raised)]"
    >
      <button
        onClick={() => setTaskStatus(task.id, isDone ? 'open' : 'done')}
        aria-label={isDone ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        aria-pressed={isDone}
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
          isDone
            ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
            : 'border-[color:var(--line-strong)] text-transparent hover:text-muted-foreground',
        )}
      >
        <Check className="size-3" />
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', isDone && 'text-muted-foreground line-through')}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{task.assignee}</span>
          <span>{task.assigneeRole}</span>
          {due ? (
            <>
              <span aria-hidden>·</span>
              <span className={cn(overdue && 'font-medium text-[var(--bad)]')}>{due}</span>
            </>
          ) : null}
          {source ? (
            <>
              <span aria-hidden>·</span>
              <button
                onClick={() => onOpenSource(source)}
                className="inline-flex items-center gap-0.5 rounded-full border border-border px-2 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
              >
                {source.label}
                <ChevronRight className="size-3" />
              </button>
            </>
          ) : null}
        </div>
        {task.note ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{task.note}</p> : null}
      </div>

      <button
        onClick={() => deleteTask(task.id)}
        aria-label={`Delete ${task.title}`}
        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </motion.li>
  );
}

export function TasksView({ onOpenSource }: { onOpenSource: (source: TaskSource) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const refresh = () => setTasks(listTasks());
    refresh();
    return subscribeToTasks(refresh);
  }, []);

  const open = tasks.filter((task) => task.status === 'open');
  const done = tasks.filter((task) => task.status === 'done');
  const visible = showDone ? tasks : open;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-8 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <span className="text-xs tabular-nums text-muted-foreground">
            {open.length} open{done.length > 0 ? ` · ${done.length} done` : ''}
          </span>
          {done.length > 0 ? (
            <button
              onClick={() => setShowDone((value) => !value)}
              aria-pressed={showDone}
              className="ml-auto text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showDone ? 'Hide done' : 'Show done'}
            </button>
          ) : null}
        </div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Work assigned from what you saw, kept with the reason it exists. Tasks live in this browser
          for now; they reach the person the day the platform has accounts.
        </p>

        {visible.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            Nothing here yet. Assign one from a practice page, or from a priority in the briefing.
          </p>
        ) : (
          <motion.ul variants={stagger} initial="hidden" animate="show" className="mt-6 space-y-2">
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} onOpenSource={onOpenSource} />
            ))}
          </motion.ul>
        )}
      </div>
    </div>
  );
}
