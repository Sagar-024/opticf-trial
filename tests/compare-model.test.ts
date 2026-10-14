import { describe, expect, it } from 'vitest';
import { buildCompareView, COMPARE_METRIC_IDS } from '../src/compare/model';
import { buildMapModel } from '../src/data/map-model';
import { getTool } from '../src/ai/tools';
import { validateWidgets } from '../src/ai/widgets';
import { generateDataset } from '../src/seed/generate';
import type { Widget } from '../src/ai/types';

const dataset = generateDataset();
const model = buildMapModel(dataset);
const [first, second] = model.practices;
const many = model.practices.slice(0, 5);

const view = buildCompareView([first, second], model.monthLabel, model.month);
const wide = buildCompareView(many, model.monthLabel, model.month);

describe('practice comparison model', () => {
  it('draws one row per metric, one bar per practice, all inside the track', () => {
    expect(view.rows.map((row) => row.id)).toEqual([
      'revenue',
      'conversion',
      'contactLens',
      'training',
      'change',
    ]);
    for (const row of view.rows) {
      expect(row.bars).toHaveLength(view.sides.length);
      for (const bar of row.bars) {
        expect(bar.fraction).toBeGreaterThanOrEqual(0);
        expect(bar.fraction).toBeLessThanOrEqual(1);
        expect(bar.display.length).toBeGreaterThan(0);
        expect(bar.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the lead consistent with the bars on every target row', () => {
    for (const row of view.rows.filter((row) => !row.signed)) {
      if (row.lead >= 0) {
        const leadBar = row.bars[row.lead];
        for (const bar of row.bars) expect(leadBar.fraction).toBeGreaterThanOrEqual(bar.fraction);
      }
      for (const bar of row.bars) {
        expect(bar.targetAt).toBeGreaterThanOrEqual(0);
        expect(bar.targetAt!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('carries any number of practices, in the order they were given', () => {
    expect(wide.sides.map((side) => side.practiceId)).toEqual(many.map((practice) => practice.practiceId));
    for (const row of wide.rows) expect(row.bars).toHaveLength(many.length);
    expect(wide.wins).toHaveLength(many.length);
    expect(wide.wins.reduce((total, wins) => total + wins, 0) + wide.even).toBe(wide.rows.length);
  });

  it('names the metric set a reader can switch on', () => {
    expect(COMPARE_METRIC_IDS).toEqual(['revenue', 'conversion', 'contactLens', 'training']);
    for (const id of COMPARE_METRIC_IDS) {
      expect(view.rows.some((row) => row.id === id)).toBe(true);
    }
  });

  it('describes the comparison in plain sentences', () => {
    expect(view.summary.length).toBeGreaterThan(0);
    expect(view.summary.length).toBeLessThanOrEqual(5);
    for (const line of view.summary) {
      expect(line.endsWith('.')).toBe(true);
      expect(line).not.toMatch(/undefined|NaN/);
    }
  });

  it('survives a trip through JSON, because it crosses the wire', () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.parse(JSON.stringify(wide))).toEqual(wide);
  });
});

describe('compare_practices tool', () => {
  const tool = getTool('compare_practices');
  if (!tool) throw new Error('compare_practices tool is not registered');

  it('returns one comparison widget the client can render', () => {
    const out = tool.run(dataset, { practice_ids: [first.practiceId, second.practiceId] });
    expect(out.widgets).toHaveLength(1);
    const widget = out.widgets[0];
    expect(widget.type).toBe('compare');
    const { widgets, dropped } = validateWidgets([widget as Widget]);
    expect(dropped).toBe(0);
    expect(widgets).toHaveLength(1);
    expect(out.summary).toContain(first.name);
    expect(out.summary).toContain(second.name);
  });

  it('accepts three or more practices, by name or id', () => {
    const out = tool.run(dataset, {
      practice_ids: [many[0].practiceId, many[1].name, many[2].name],
    });
    const widget = out.widgets[0];
    expect(widget.type).toBe('compare');
    if (widget.type === 'compare') expect(widget.view.sides).toHaveLength(3);
    expect(validateWidgets([widget as Widget]).dropped).toBe(0);
  });

  it('asks for two known practices instead of guessing', () => {
    const out = tool.run(dataset, { practice_ids: ['P001'] });
    expect(out.widgets).toHaveLength(0);
    expect(out.summary).toMatch(/two/i);
  });

  it('hands every practice to the map in the tool context', () => {
    const out = tool.run(dataset, { practice_ids: [first.practiceId, second.practiceId] });
    expect(out.context?.practiceIds).toEqual([first.practiceId, second.practiceId]);
  });
});
