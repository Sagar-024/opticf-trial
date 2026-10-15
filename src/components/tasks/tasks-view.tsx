'use client';

import { useEffect, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Check, ChevronRight, ListPlus, Trash2, X } from 'lucide-react';
import {
  closeTask,
  deleteTask,
  dueLabel,
  isOverdue,
  listTasks,
  reopenTask,
  subscribeToTasks,
  type Task,
  type TaskSource,
} from '@/lib/task-store';
import { AssignTaskDialog } from '@/components/tasks/assign-task-dialog';
import { LEADERSHIP } from '@/lib/people';
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
  // Closing asks for the outcome first: one line, then the record has it.
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState('');

  function startClosing(): void {
    setDraft(task.outcome ?? '');
    setClosing(true);
  }

  function confirmClose(): void {
    closeTask(task.id, draft.trim() || undefined);
    setClosing(false);
  }

  return (
    <motion.li
      variants={fadeUp}
      data-anim
      className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 [box-shadow:var(--hi),var(--shadow-raised)]"
    >
      <button
        onClick={() => {
          if (isDone) reopenTask(task.id);
          else if (closing) confirmClose();
          else startClosing();
        }}
        aria-label={isDone ? `Reopen ${task.title}` : `Close ${task.title}`}
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
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
                title={`Open ${source.label}`}
                className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent hover:text-foreground"
              >
                {source.label}
                <ChevronRight className="size-3" />
              </button>
            </>
          ) : null}
        </div>

        {/* The why, in the numbers it came from. */}
        {source?.finding ? (
          <p className="mt-1.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{source.finding}</p>
        ) : null}

        {task.note ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{task.note}</p> : null}

        {/* The record: what changed when it was closed. */}
        {isDone && task.outcome ? (
          <p className="mt-1.5 text-xs leading-relaxed">
            <span className="font-medium text-foreground/80">Outcome: </span>
            <span className="text-muted-foreground">{task.outcome}</span>
          </p>
        ) : null}

        {/* Closing asks one optional line before the task is done, so the
            record says what moved, not just that it was ticked. */}
        {closing ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirmClose();
                }
                if (event.key === 'Escape') setClosing(false);
              }}
              placeholder="What changed? (optional)"
              aria-label="What changed"
              className="h-8 min-w-0 flex-1 rounded-md border border-[color:var(--line)] bg-secondary px-2.5 text-xs text-foreground placeholder:text-[color:var(--ink-3)] focus-visible:outline-none focus-visible:border-[color:var(--line-strong)]"
            />
            <button
              onClick={confirmClose}
              className="inline-flex h-8 shrink-0 items-center rounded-full border border-[color:var(--accent-border)] bg-[var(--accent-soft)] px-3 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:border-[color:var(--accent-500)]"
            >
              Close task
            </button>
            <button
              onClick={() => setClosing(false)}
              aria-label="Cancel closing"
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
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
  const [newOpen, setNewOpen] = useState(false);

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
          <div className="ml-auto flex items-center gap-3">
            {done.length > 0 ? (
              <button
                onClick={() => setShowDone((value) => !value)}
                aria-pressed={showDone}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showDone ? 'Hide done' : 'Show done'}
              </button>
            ) : null}
            {/* Not every task starts from a finding. A plain task can be
                written here and given the same owner, date and record. */}
            <button
              onClick={() => setNewOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent-text)] transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
            >
              <ListPlus className="size-3" />
              New task
            </button>
          </div>
        </div>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Work assigned from what you saw, kept with the reason it exists. Tasks live in this browser
          for now; they reach the person the day the platform has accounts.
        </p>

        {visible.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            Nothing here yet. Create one with New task, or assign one from a practice page or a
            priority in the briefing.
          </p>
        ) : (
          <motion.ul variants={stagger} initial="hidden" animate="show" className="mt-6 space-y-2">
            {visible.map((task) => (
              <TaskRow key={task.id} task={task} onOpenSource={onOpenSource} />
            ))}
          </motion.ul>
        )}
      </div>

      <AssignTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        defaultTitle=""
        assignees={LEADERSHIP}
      />
    </div>
  );
}
