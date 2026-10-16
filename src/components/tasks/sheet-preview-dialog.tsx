'use client';

import { useEffect, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { PeoplePicker } from '@/components/tasks/people-picker';
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
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { LEADERSHIP } from '@/lib/people';
import { createdLabel, deleteSheet, type Sheet } from '@/lib/sheet-store';

/**
 * One sheet, opened: every collected chart rendered with the same renderer
 * the BI panel uses, so the preview can never disagree with the dashboard.
 * Delete lives here, beside the thing it deletes. Send by email is the front
 * door of the send step: people, a subject, and an honest state of the pipe.
 */
export function SheetPreviewDialog({
  sheet,
  onOpenChange,
}: {
  sheet: Sheet | null;
  onOpenChange: (open: boolean) => void;
}) {
  /** The send flow runs as a step inside this dialog, not a dialog on top. */
  const [step, setStep] = useState<'preview' | 'send' | 'ready'>('preview');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');

  // A different sheet is a different send: start from the top every time.
  useEffect(() => {
    setStep('preview');
    setRecipients([]);
  }, [sheet?.id]);

  function remove(): void {
    if (!sheet) return;
    deleteSheet(sheet.id);
    onOpenChange(false);
  }

  /** A real send would carry the sheet's name; the subject starts with it. */
  function openSend(): void {
    if (!sheet) return;
    setSubject(sheet.name);
    setStep('send');
  }

  /** Nothing leaves the browser; the ready step says so plainly. */
  function send(): void {
    if (recipients.length === 0 || !subject.trim()) return;
    setStep('ready');
  }

  return (
    <Dialog open={Boolean(sheet)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {sheet && step === 'preview' ? (
          <>
            <DialogHeader>
              <DialogTitle>{sheet.name}</DialogTitle>
              <DialogDescription>
                {sheet.charts.length} {sheet.charts.length === 1 ? 'chart' : 'charts'} · created{' '}
                {createdLabel(sheet.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {sheet.charts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No charts yet. Add one from the menu on any chart in the BI panel.
              </p>
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {sheet.charts.map((chart, index) => (
                  <WidgetRenderer key={`${chart.widget.id}-${index}`} widget={chart.widget} />
                ))}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={remove}
                className="mr-auto text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Delete sheet
              </Button>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button size="sm" onClick={openSend}>
                <Send className="size-3.5" />
                Send by email
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {sheet && step === 'send' ? (
          <>
            <DialogHeader>
              <DialogTitle>Send by email</DialogTitle>
              <DialogDescription>{sheet.name}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <PeoplePicker
                label="Send to"
                people={LEADERSHIP}
                multiple
                value={recipients}
                onChange={setRecipients}
              />
              <div>
                <label className="label-caps mb-2 block" htmlFor="sheet-send-subject">
                  Subject
                </label>
                <Input
                  id="sheet-send-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  autoComplete="off"
                  className="text-sm"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setStep('preview')}>
                Back
              </Button>
              <Button size="sm" onClick={send} disabled={recipients.length === 0 || !subject.trim()}>
                <Send className="size-3.5" />
                Send
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {sheet && step === 'ready' ? (
          <>
            <DialogHeader>
              <DialogTitle>Send by email</DialogTitle>
              <DialogDescription>{sheet.name}</DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Ready to send to {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
              </p>
              <p className="text-xs text-muted-foreground">{subject}</p>
              <p className="text-xs text-muted-foreground">
                Email delivery is not wired in the trial yet; nothing left the browser.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
