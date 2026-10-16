/**
 * Sheets: charts collected from the BI panel, saved in this browser.
 *
 * A sheet is a small pack of charts a reader assembles for a meeting or a
 * review. The shape is intentionally server-shaped, like the chat store's:
 * when a real API arrives, these functions are replaced and every caller (the
 * chart menu, the Tasks tab) stays the same.
 */

import type { Widget } from '@/ai/types';
import { plainDashes } from './text';

export interface SheetChart {
  /** The chart's title when it was collected. */
  title: string;
  /** The widget as it arrived, plain JSON, ready for WidgetRenderer. */
  widget: Widget;
}

export interface Sheet {
  id: string;
  name: string;
  createdAt: number;
  charts: SheetChart[];
}

const KEY = 'opticf-sheets-v1';
/** The caps keep the Tasks tab readable; the oldest sheet gives way first. */
const MAX_SHEETS = 20;
export const MAX_CHARTS = 12;
const MAX_NAME = 60;

export const SHEETS_CHANGED = 'opticf:sheets-changed';

/** A stored chart only counts when it can render: a title and a widget. */
function isChart(value: unknown): value is SheetChart {
  if (typeof value !== 'object' || value === null) return false;
  const chart = value as { title?: unknown; widget?: unknown };
  if (typeof chart.title !== 'string') return false;
  const widget = chart.widget as { type?: unknown } | null;
  return typeof widget === 'object' && widget !== null && typeof widget.type === 'string';
}

/** One stored entry, made safe; malformed sheets are dropped, not crashed on. */
function toSheet(value: unknown): Sheet | null {
  if (typeof value !== 'object' || value === null) return null;
  const sheet = value as { id?: unknown; name?: unknown; createdAt?: unknown; charts?: unknown };
  if (typeof sheet.id !== 'string' || typeof sheet.name !== 'string' || typeof sheet.createdAt !== 'number') {
    return null;
  }
  const charts = Array.isArray(sheet.charts) ? sheet.charts.filter(isChart) : [];
  return {
    id: sheet.id,
    name: plainDashes(sheet.name).slice(0, MAX_NAME),
    createdAt: sheet.createdAt,
    charts: charts.slice(0, MAX_CHARTS),
  };
}

function readAll(): Sheet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(toSheet).filter((sheet): sheet is Sheet => sheet !== null);
  } catch {
    return [];
  }
}

function writeAll(sheets: Sheet[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sheets.slice(0, MAX_SHEETS)));
    window.dispatchEvent(new Event(SHEETS_CHANGED));
  } catch {
    // Storage full or unavailable; the sheets simply stop growing.
  }
}

/** Newest first. */
export function listSheets(): Sheet[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function createSheet(name: string): Sheet {
  const sheet: Sheet = {
    id: newSheetId(),
    name: plainDashes(name.trim()).slice(0, MAX_NAME) || 'Untitled sheet',
    createdAt: Date.now(),
    charts: [],
  };
  writeAll([sheet, ...readAll()].slice(0, MAX_SHEETS));
  return sheet;
}

/** Collect one chart. A missing sheet or a full one is a quiet no-op. */
export function addChartToSheet(sheetId: string, title: string, widget: Widget): void {
  const sheets = readAll();
  const target = sheets.find((sheet) => sheet.id === sheetId);
  if (!target || target.charts.length >= MAX_CHARTS) return;
  writeAll(
    sheets.map((sheet) =>
      sheet.id === sheetId
        ? { ...sheet, charts: [...sheet.charts, { title: plainDashes(title), widget }] }
        : sheet,
    ),
  );
}

export function deleteSheet(id: string): void {
  writeAll(readAll().filter((sheet) => sheet.id !== id));
}

function newSheetId(): string {
  return 'sheet-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** "16 Oct" for the sheet rows, matching the due dates on tasks. */
export function createdLabel(at: number): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Fires on every save in this tab, and on saves from other tabs. */
export function subscribeToSheets(onChange: () => void): () => void {
  const onLocal = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener(SHEETS_CHANGED, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SHEETS_CHANGED, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}
