'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addTask, type TaskSource } from '@/lib/task-store';

export interface Assignee {
  name: string;
  role: string;
}

/**
 * The assign form, shared by every place something is worth acting on: the
 * practice page and the Home priorities. The source line rides along, so the
 * task keeps the reason it exists.
 */
export function AssignTaskDialog({
  open,
  onOpenChange,
  defaultTitle,
  defaultNote,
  source,
  assignees,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle: string;
  /** Optional prefill for the note, e.g. the finding the task came from. */
  defaultNote?: string;
  source?: TaskSource;
  assignees: Assignee[];
  onAssigned?: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [assigneeName, setAssigneeName] = useState(assignees[0]?.name ?? '');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');

  // Every opening starts from the thing that was on screen, never the last task.
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setAssigneeName(assignees[0]?.name ?? '');
    setDue('');
    setNote(defaultNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const assignee = assignees.find((person) => person.name === assigneeName) ?? assignees[0];

  function save(): void {
    if (!title.trim() || !assignee) return;
    addTask({
      title: title.trim(),
      note: note.trim() || undefined,
      assignee: assignee.name,
      assigneeRole: assignee.role,
      due: due || undefined,
      createdBy: 'Sara Kelly',
      source,
    });
    onOpenChange(false);
    onAssigned?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign a task</DialogTitle>
          {source ? (
            <DialogDescription>
              From {source.label}
              {source.finding ? ` · ${source.finding}` : ''}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="label-caps mb-1.5 block" htmlFor="task-title">
              Task
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs doing?"
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">Assign to</label>
              <Select value={assigneeName} onValueChange={setAssigneeName}>
                <SelectTrigger className="text-sm" aria-label="Assign to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignees.map((person) => (
                    <SelectItem key={person.name} value={person.name} className="text-xs">
                      {person.name} · {person.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="label-caps mb-1.5 block" htmlFor="task-due">
                Due
              </label>
              <Input
                id="task-due"
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          <div>
            <label className="label-caps mb-1.5 block" htmlFor="task-note">
              Note
            </label>
            <Textarea
              id="task-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional detail for the person picking this up."
              rows={2}
              className="text-sm"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Tasks live in this browser for now. They reach the person the day the platform has accounts.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!title.trim()}>
            Assign task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
