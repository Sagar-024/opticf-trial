import { describe, expect, it } from 'vitest';
import { boundsOfSubset, computeFit, computeFlyTo, computeLayout, nearestNode, type LayoutItem } from '../src/map/layout';
import { buildLenses, filterById, lensById, tooltipLines } from '../src/map/lenses';
import { buildMapModel, mentor_portfolios } from '../src/data/map-model';
import { query_metrics } from '../src/data/metrics';
import { getTool } from '../src/ai/tools';
import { generateDataset } from '../src/seed/generate';

const dataset = generateDataset();
const model = buildMapModel(dataset);

const items: LayoutItem[] = model.practices.map((practice) => ({
  id: practice.practiceId,
  region: practice.region,
  radius: 2 + Math.sqrt(practice.revenue / 1000),
}));

const lenses = buildLenses({
  regions: model.regions.map((r) => r.name),
  mentors: model.mentors.map((m) => ({ mentorId: m.mentorId, name: m.name })),
});

describe('map layout', () => {
  it('is deterministic for the same seed', () => {
    const a = computeLayout('group', null, items);
    const b = computeLayout('group', null, items);
    expect(b.nodes.map((n) => `${n.id}:${n.x}:${n.y}`)).toEqual(a.nodes.map((n) => `${n.id}:${n.x}:${n.y}`));
  });

  it('produces finite positions for every practice', () => {
    const layout = computeLayout('group', null, items);
    expect(layout.nodes).toHaveLength(items.length);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.r)).toBe(true);
    }
  });

  it('keeps every node inside the reported bounds', () => {
    const layout = computeLayout('group', null, items);
    for (const node of layout.nodes) {
      expect(node.x - node.r).toBeGreaterThanOrEqual(layout.bounds.minX - 1);
      expect(node.x + node.r).toBeLessThanOrEqual(layout.bounds.maxX + 1);
      expect(node.y - node.r).toBeGreaterThanOrEqual(layout.bounds.minY - 1);
      expect(node.y + node.r).toBeLessThanOrEqual(layout.bounds.maxY + 1);
    }
  });

  it('handles a single practice and an empty set without breaking', () => {
    const single = computeLayout('group', null, [items[0]]);
    expect(Number.isFinite(single.bounds.minX)).toBe(true);
    const empty = computeLayout('group', null, []);
    expect(empty.nodes).toHaveLength(0);
    expect(Number.isFinite(empty.bounds.minX)).toBe(true);
  });

  it('lays out a single region with one hub and its practices', () => {
    const layout = computeLayout('region', 'North West', items);
    expect(layout.hubs).toHaveLength(1);
    expect(layout.nodes).toHaveLength(11); // 10 plus Whitefield, divested but still in the estate
    expect(layout.edges.every((edge) => edge.a === layout.hubs[0].id)).toBe(true);
  });

  it('mutes a practice that stopped reporting instead of failing it', () => {
    const whitefield = model.practices.find((p) => p.practiceId === 'P042')!;
    expect(whitefield.reported).toBe(false);
    const clLens = lensById(lenses, 'contactLens');
    const below = filterById(clLens, 'below-90');
    expect(below.match(whitefield)).toBe(false);
    expect(clLens.visual(whitefield).colorKey).toBe('muted');
    // Nothing claims it failed in October: no attention signals at all.
    expect(whitefield.attentionSignals).toHaveLength(0);
  });

  it('separates nodes instead of stacking them', () => {
    const layout = computeLayout('group', null, items);
    const byRegion = new Map<string, typeof layout.nodes>();
    for (const node of layout.nodes) {
      byRegion.set(node.region, [...(byRegion.get(node.region) ?? []), node]);
    }
    for (const nodes of byRegion.values()) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const distance = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          expect(distance).toBeGreaterThan(4);
        }
      }
    }
  });
});

describe('fit to view', () => {
  it('centres the graph in the visible area', () => {
    const layout = computeLayout('group', null, items);
    const viewport = { width: 1000, height: 700, top: 80, right: 300, bottom: 120, left: 40 };
    const fit = computeFit(layout.bounds, viewport);

    const centreX = (layout.bounds.minX + layout.bounds.maxX) / 2;
    const centreY = (layout.bounds.minY + layout.bounds.maxY) / 2;
    const screenX = fit.offsetX + centreX * fit.scale;
    const screenY = fit.offsetY + centreY * fit.scale;

    const expectedX = viewport.left + 40 + (viewport.width - viewport.left - viewport.right - 80) / 2;
    const expectedY = viewport.top + 40 + (viewport.height - viewport.top - viewport.bottom - 80) / 2;

    expect(Math.abs(screenX - expectedX)).toBeLessThan(1);
    expect(Math.abs(screenY - expectedY)).toBeLessThan(1);
  });

  it('survives a zero-size bounding box', () => {
    const fit = computeFit({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, { width: 800, height: 600, top: 0, right: 0, bottom: 0, left: 0 });
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(Number.isFinite(fit.offsetX)).toBe(true);
    expect(fit.scale).toBeGreaterThan(0);
  });

  it('caps the scale when a maximum is given, keeping the graph centred', () => {
    const bounds = { minX: -50, maxX: 50, minY: -50, maxY: 50 };
    const viewport = { width: 2000, height: 1200, top: 0, right: 0, bottom: 0, left: 0 };
    const fitted = computeFit(bounds, viewport);
    const capped = computeFit(bounds, viewport, 40, 1.15);
    expect(fitted.scale).toBeGreaterThan(1.15);
    expect(capped.scale).toBe(1.15);

    const centreX = 0;
    const centreY = 0;
    const screenX = capped.offsetX + centreX * capped.scale;
    const screenY = capped.offsetY + centreY * capped.scale;
    expect(Math.abs(screenX - viewport.width / 2)).toBeLessThan(1);
    expect(Math.abs(screenY - viewport.height / 2)).toBeLessThan(1);
  });
});

describe('fly to a highlighted set', () => {
  const viewport = { top: 14, right: 20, bottom: 56, left: 20 };

  it('centres the highlighted practice under the resting transform', () => {
    const bounds = { minX: 100, maxX: 120, minY: -50, maxY: -30 };
    const current = { scale: 0.5, offsetX: 300, offsetY: 150, width: 800, height: 500 };
    const flyTo = computeFlyTo(bounds, current, viewport);

    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;
    const screenX = current.offsetX + centreX * current.scale * flyTo.zoom + flyTo.panX;
    const screenY = current.offsetY + centreY * current.scale * flyTo.zoom + flyTo.panY;
    const focusX = current.width / 2 + (viewport.left - viewport.right) / 2;
    const focusY = current.height / 2 + (viewport.top - viewport.bottom) / 2;

    expect(Math.abs(screenX - focusX)).toBeLessThan(0.001);
    expect(Math.abs(screenY - focusY)).toBeLessThan(0.001);
  });

  it('zooms in harder for a tighter set, inside the limits', () => {
    const current = { scale: 0.5, offsetX: 0, offsetY: 0, width: 800, height: 500 };
    const wide = computeFlyTo({ minX: -100, maxX: 100, minY: -100, maxY: 100 }, current, viewport);
    const tight = computeFlyTo({ minX: -10, maxX: 10, minY: -10, maxY: 10 }, current, viewport);
    expect(tight.zoom).toBeGreaterThan(wide.zoom);
    expect(tight.zoom).toBeLessThanOrEqual(5);
  });

  it('caps a single practice so its region stays in view', () => {
    const current = { scale: 0.4, offsetX: 0, offsetY: 0, width: 800, height: 500 };
    const flyTo = computeFlyTo({ minX: 0, maxX: 2, minY: 0, maxY: 2 }, current, viewport, { maxZoom: 2.5 });
    expect(flyTo.zoom).toBe(2.5);
  });
});

describe('hit testing', () => {  it('finds the nearest node and returns null when far away', () => {
    const layout = computeLayout('group', null, items);
    const target = layout.nodes[0];
    const project = (node: typeof target) => ({ x: node.x * 2 + 100, y: node.y * 2 + 100, r: node.r });
    const found = nearestNode(layout.nodes, target.x * 2 + 100, target.y * 2 + 100, project);
    expect(found?.id).toBe(target.id);
    expect(nearestNode(layout.nodes, 99999, 99999, project)).toBeNull();
  });

  it('computes bounds for a highlighted subset', () => {
    const layout = computeLayout('group', null, items);
    const bounds = boundsOfSubset(layout.nodes, ['P001', 'P002']);
    expect(bounds).not.toBeNull();
    expect(bounds!.maxX).toBeGreaterThan(bounds!.minX);
    expect(boundsOfSubset(layout.nodes, ['nope'])).toBeNull();
  });
});

describe('lenses', () => {
  it('defines the six lenses requested, without claims or systems', () => {
    expect(lenses.map((lens) => lens.id)).toEqual(['region', 'sales', 'refunds', 'contactLens', 'training', 'mentors']);
  });

  it('colours refund stories: coral for the spike, amber for the policy flag', () => {
    const lens = lensById(lenses, 'refunds');
    const chorlton = model.practices.find((p) => p.practiceId === 'P001')!;
    const liverpool = model.practices.find((p) => p.practiceId === 'P008')!;
    const normal = model.practices.find((p) => p.refundFlags.length === 0)!;
    expect(lens.visual(chorlton).colorKey).toBe('coral');
    expect(lens.visual(liverpool).colorKey).toBe('amber');
    expect(lens.visual(normal).colorKey).toBe('green');
  });

  it('colours contact lens shortfalls in coral and on-track practices in green', () => {
    const lens = lensById(lenses, 'contactLens');
    const chorlton = model.practices.find((p) => p.practiceId === 'P001')!;
    const healthy = model.practices.find((p) => p.clAttainmentPct >= 100)!;
    expect(lens.visual(chorlton).colorKey).toBe('coral');
    expect(lens.visual(healthy).colorKey).toBe('green');
  });

  it('marks overdue training distinctly from incomplete', () => {
    const lens = lensById(lenses, 'training');
    const overdue = model.practices.find((p) => p.trainingOverdue > 0)!;
    const incomplete = model.practices.find((p) => p.trainingCompletionPct < 100 && p.trainingOverdue === 0)!;
    expect(lens.visual(overdue).colorKey).toBe('coral');
    expect(lens.visual(incomplete).colorKey).toBe('amber');
  });

  it('produces unique tooltip lines for every lens and practice', () => {
    for (const lens of lenses) {
      for (const practice of model.practices) {
        const lines = tooltipLines(practice, lens);
        expect(lines.length, `${lens.id} / ${practice.name}`).toBeGreaterThan(0);
        expect(new Set(lines).size, `${lens.id} / ${practice.name} has a duplicate line`).toBe(lines.length);
        expect(lines.every((line) => line.length > 0)).toBe(true);
      }
    }
  });

  it('gives every mentor a distinct colour', () => {    const lens = lensById(lenses, 'mentors');
    const keys = model.mentors.map((mentor) => {
      const practice = model.practices.find((p) => p.mentorId === mentor.mentorId)!;
      return lens.visual(practice).colorKey;
    });
    expect(new Set(keys).size).toBe(model.mentors.length);
  });
});

describe('mentor portfolios', () => {
  const portfolios = mentor_portfolios(model);

  it('gives every mentor one portfolio, covering every practice exactly once', () => {
    expect(portfolios).toHaveLength(model.mentors.length);
    const ids = portfolios.flatMap((portfolio) => portfolio.practiceIds);
    expect(ids).toHaveLength(model.practices.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the portfolios add up to the group revenue for the month', () => {
    const total = portfolios.reduce((sum, portfolio) => sum + Number(portfolio.revenueDisplay.replace(/[^\d]/g, '')), 0);
    const group = query_metrics(dataset, { month: '2026-10' });
    expect(total).toBe(group.revenue.actual);
  });

  it('reports formatted figures and honest counts', () => {
    for (const portfolio of portfolios) {
      expect(portfolio.revenueDisplay).toMatch(/£/);
      expect(portfolio.revenueChangeDisplay).toMatch(/%/);
      expect(portfolio.conversionDisplay).toMatch(/%/);
      expect(portfolio.conversionChangeDisplay).toMatch(/pp/);
      expect(portfolio.practicesImproving).toBeGreaterThanOrEqual(0);
      expect(portfolio.practicesImproving).toBeLessThanOrEqual(portfolio.practiceCount);
      expect(portfolio.belowTargetCount).toBeLessThanOrEqual(portfolio.practiceCount);
    }
  });
});

describe('the map and the chat cannot disagree', () => {
  it('contact lens shortfalls match the chat tool exactly', () => {
    const lens = lensById(lenses, 'contactLens');
    const filter = filterById(lens, 'below-90');
    const mapCount = model.practices.filter(filter.match).length;
    const chatCount = (getTool('below_cl_target')!.run(dataset, {}).mapHighlight ?? []).length;
    expect(mapCount).toBe(chatCount);
  });

  it('incomplete training matches the chat tool exactly', () => {
    const lens = lensById(lenses, 'training');
    const filter = filterById(lens, 'incomplete');
    const mapCount = model.practices.filter(filter.match).length;
    const chatCount = (getTool('training_status')!.run(dataset, {}).mapHighlight ?? []).length;
    expect(mapCount).toBe(chatCount);
  });

  it('unusual refunds match the chat tool exactly', () => {
    const lens = lensById(lenses, 'refunds');
    const filter = filterById(lens, 'flagged');
    const mapCount = model.practices.filter(filter.match).length;
    const chatCount = (getTool('refund_anomalies')!.run(dataset, {}).mapHighlight ?? []).length;
    expect(mapCount).toBe(chatCount);
    expect(mapCount).toBe(3);
  });

  it('builds one map row per practice with no missing metrics', () => {    expect(model.practices).toHaveLength(dataset.practices.length);
    for (const practice of model.practices) {
      expect(practice.revenueDisplay).toMatch(/£/);
      expect(practice.revenueMoMDisplay).toMatch(/%/);
      expect(practice.conversionDisplay).toMatch(/%/);
      expect(practice.clAttainmentDisplay).toMatch(/%/);
      expect(practice.trainingCompletionDisplay).toMatch(/%/);
      expect(practice.revenueTrend).toHaveLength(6);
    }
  });
});
