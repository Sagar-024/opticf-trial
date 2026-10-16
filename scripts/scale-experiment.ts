/**
 * How the map and the charts behave as the estate grows.
 * Clones the shipped dataset in memory at several sizes, runs the real
 * engines, and prints the numbers the chart and map decisions are sized on.
 *
 *   npx tsx scripts/scale-experiment.ts
 */
import { loadDatasetFromDir } from '../src/data/load';
import { buildMapModel } from '../src/data/map-model';
import { query_metrics } from '../src/data/metrics';
import { computeLayout, type LayoutItem } from '../src/map/layout';
import type { Dataset } from '../src/domain/types';

function scaleTo(dataset: Dataset, target: number): Dataset {
  const practices: Dataset['practices'] = [];
  const performance: Dataset['performance'] = [];
  const training: Dataset['training'] = [];
  const refunds: Dataset['refunds'] = [];
  let index = 0;
  while (practices.length < target) {
    const source = dataset.practices[index % dataset.practices.length];
    const copy = Math.floor(index / dataset.practices.length);
    const id = `X${String(practices.length + 1).padStart(3, '0')}`;
    practices.push({ ...source, practiceId: id, name: `${source.name} ${copy + 1}` });
    for (const row of dataset.performance.filter((r) => r.practiceId === source.practiceId)) {
      performance.push({ ...row, practiceId: id, revenue: Math.round(row.revenue * (0.9 + copy * 0.05)) });
    }
    for (const row of dataset.training.filter((r) => r.practiceId === source.practiceId)) {
      training.push({ ...row, practiceId: id });
    }
    for (const row of dataset.refunds.filter((r) => r.practiceId === source.practiceId)) {
      refunds.push({ ...row, refundId: `R${refunds.length + 1}`, practiceId: id });
    }
    index += 1;
  }
  return { practices, performance, training, refunds };
}

function report(label: string, dataset: Dataset): void {
  const model = buildMapModel(dataset);
  const breakdown = query_metrics(dataset, { month: model.month, groupBy: 'practice' }).breakdown ?? [];
  const radii = model.practices.map((p) => 2 + Math.sqrt(p.revenue / 1000));
  const items: LayoutItem[] = model.practices.map((p) => ({ id: p.practiceId, region: p.region, radius: 2 + Math.sqrt(p.revenue / 1000) }));
  const layout = computeLayout('group', null, items);
  const minRadius = Math.min(...radii);
  const maxRadius = Math.max(...radii);
  const belowSix = radii.filter((r) => r < 6).length;
  console.log(`\n${label}`);
  console.log(`  practices ${dataset.practices.length} · chart points ${breakdown.length}`);
  console.log(`  side panel bar width ~${(700 / breakdown.length).toFixed(1)}px · full view bar width ~${(1200 / breakdown.length).toFixed(1)}px`);
  console.log(`  map node radius min ${minRadius.toFixed(1)} max ${maxRadius.toFixed(1)} · nodes under 6px ${belowSix}`);
  console.log(`  layout bounds ${(layout.bounds.maxX - layout.bounds.minX).toFixed(0)} x ${(layout.bounds.maxY - layout.bounds.minY).toFixed(0)} · nodes ${layout.nodes.length}`);
  const regionCounts = new Map<string, number>();
  for (const p of dataset.practices) regionCounts.set(p.region, (regionCounts.get(p.region) ?? 0) + 1);
  console.log(`  per region ${[...regionCounts.values()].join(', ')}`);
}

const base = loadDatasetFromDir();
report('at 42 (today)', base);
report('at 120', scaleTo(base, 120));
report('at 200', scaleTo(base, 200));
report('at 500', scaleTo(base, 500));
