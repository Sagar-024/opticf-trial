'use client';

import { useEffect, useState } from 'react';
import type { Widget } from '@/ai/types';
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
import { addChartToSheet, createSheet, listSheets, MAX_CHARTS } from '@/lib/sheet-store';

/**
 * Collect one chart into a sheet by naming it, the way the CEO described:
 * add to task, create sheet_name. A name that already exists joins that sheet,
 * so repeated adds collect charts into one place without a list to choose from.
 */
export function AddToSheetDialog({
  open,
  onOpenChange,
  chart,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chart to collect; null while the dialog is closed. */
  chart: { title: string; widget: Widget } | null;
  /** Told the sheet's name, so the panel can say where the chart went. */
  onAdded?: (sheetName: string) => void;
}) {
  const [name, setName] = useState('');

  // Every opening starts from a clean name, never the last one typed.
  useEffect(() => {
    if (!open) return;
    setName('');
  }, [open]);

  function createAndAdd(): void {
    const clean = name.trim();
    if (!clean || !chart) return;
    const existing = listSheets().find((sheet) => sheet.name.toLowerCase() === clean.toLowerCase());
    const sheet = existing && existing.charts.length < MAX_CHARTS ? existing : createSheet(clean);
    addChartToSheet(sheet.id, chart.title, chart.widget);
    onAdded?.(sheet.name);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to a task</DialogTitle>
          {chart ? <DialogDescription>{chart.title}</DialogDescription> : null}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="label-caps mb-2 block" htmlFor="sheet-new-name">
              Name this sheet
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="sheet-new-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    createAndAdd();
                  }
                }}
                placeholder="e.g. Board pack"
                autoComplete="off"
                className="text-sm"
              />
              <Button size="sm" onClick={createAndAdd} disabled={!name.trim()}>
                Create and add
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Naming a sheet that already exists adds this chart to it, so charts collect together.
            Sheets live in this browser for now and sit under Sheets in the Tasks tab.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
