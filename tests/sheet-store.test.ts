import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartWidget } from '../src/ai/types';
import { addChartToSheet, createSheet, listSheets } from '../src/lib/sheet-store';

/**
 * The store reads and writes window.localStorage; the suite runs in node, so
 * every test gets a fresh in-memory window. dispatchEvent is stubbed too: the
 * store tells listeners by hand, the way the chat store does.
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
    dispatchEvent: () => true,
  });
}

const chart: ChartWidget = {
  type: 'chart',
  id: 'chart-revenue',
  title: 'Revenue by month',
  chart: 'bar',
  valueType: 'currency',
  series: [
    {
      name: 'Revenue',
      points: [
        { label: 'Aug', value: 100, display: '£100' },
        { label: 'Sep', value: 120, display: '£120' },
      ],
    },
  ],
};

beforeEach(stubWindow);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sheet store', () => {
  it('creates a sheet, trims the name and lists it', () => {
    const sheet = createSheet('  Board pack  ');
    expect(listSheets().map((stored) => stored.name)).toEqual(['Board pack']);
    expect(sheet.id).toMatch(/^sheet-/);
  });

  it('adds a chart to an existing sheet', () => {
    const sheet = createSheet('Board pack');
    addChartToSheet(sheet.id, chart.title, chart);
    expect(listSheets()[0].charts).toEqual([{ title: 'Revenue by month', widget: chart }]);
  });

  it('reads a corrupt store defensively, keeping only entries it can trust', () => {
    window.localStorage.setItem('opticf-sheets-v1', '{ not json');
    expect(listSheets()).toEqual([]);
    window.localStorage.setItem(
      'opticf-sheets-v1',
      JSON.stringify([
        null,
        { id: 7 },
        {
          id: 'sheet-ok',
          name: 'Kept',
          createdAt: 1,
          charts: [{ title: 'ok', widget: chart }, { bad: true }],
        },
      ]),
    );
    expect(listSheets().map((stored) => stored.name)).toEqual(['Kept']);
  });
});
