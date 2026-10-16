/**
 * The invariant script: one pass over every engine, against the CSVs on disk.
 *
 *   npm run invariants
 *
 * It asserts the properties that must hold whatever the data looks like: no
 * NaN or Infinity anywhere, group sums equal the sums of their parts, every
 * display string resolves, and no practice outside the reporting estate is
 * presented as failing. Run it before and after any data or engine change; a
 * failure prints the exact path to the offending value and sets exit code 1.
 */
import { loadDatasetFromDir } from '../src/data/load';
import { monthsOf } from '../src/data/dataset';
import { query_metrics } from '../src/data/metrics';
import { rank_attention } from '../src/data/attention';
import { refund_findings, refund_summary } from '../src/data/refunds';
import { training_status } from '../src/data/training';
import { compare_latest_month } from '../src/data/compare';
import { buildMapModel, mentor_portfolios } from '../src/data/map-model';
import { today_priorities } from '../src/data/today';

let failures = 0;

function fail(path: string, message: string): void {
  failures += 1;
  console.log(`  FAIL ${path}: ${message}`);
}

/** Walk any value: every number finite, every string resolved. */
function walk(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, `non-finite number ${value}`);
    return;
  }
  if (typeof value === 'string') {
    if (/NaN|Infinity|undefined/.test(value)) fail(path, `unresolved string "${value}"`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
  }
}

function main(): void {
  const dataset = loadDatasetFromDir();
  const months = monthsOf(dataset);
  const latest = months[months.length - 1];
  console.log(`Optific+ invariants - ${dataset.practices.length} practices, latest month ${latest}\n`);

  // 1. Every engine runs, with finite numbers and resolved strings.
  const engines: Array<[string, () => unknown]> = [
    ['query_metrics.group', () => query_metrics(dataset, { month: latest })],
    ['query_metrics.byRegion', () => query_metrics(dataset, { month: latest, groupBy: 'region' })],
    ['query_metrics.byPractice', () => query_metrics(dataset, { month: latest, groupBy: 'practice' })],
    ['rank_attention', () => rank_attention(dataset)],
    ['rank_attention.limit5', () => rank_attention(dataset, { limit: 5 })],
    ['refund_findings', () => refund_findings(dataset)],
    ['refund_summary', () => refund_summary(dataset)],
    ['training_status', () => training_status(dataset)],
    ['compare.region.revenue', () => compare_latest_month(dataset, 'revenue', 'region')],
    ['compare.practice.conversion', () => compare_latest_month(dataset, 'conversion', 'practice')],
    ['map_model', () => buildMapModel(dataset)],
    ['mentor_portfolios', () => mentor_portfolios(buildMapModel(dataset))],
    ['today_priorities', () => today_priorities(dataset)],
  ];
  console.log('Engines resolve with finite numbers and resolved strings:');
  for (const [name, run] of engines) {
    try {
      walk(run(), name);
    } catch (error) {
      fail(name, error instanceof Error ? error.message : String(error));
    }
  }

  // 2. Group sums equal the sums of their parts.
  console.log('Group sums equal the sums of their parts:');
  const group = query_metrics(dataset, { month: latest });
  const byRegion = query_metrics(dataset, { month: latest, groupBy: 'region' }).breakdown ?? [];
  const byPractice = query_metrics(dataset, { month: latest, groupBy: 'practice' }).breakdown ?? [];
  const regionSum = byRegion.reduce((n, row) => n + row.metrics.revenue.actual, 0);
  const practiceSum = byPractice.reduce((n, row) => n + row.metrics.revenue.actual, 0);
  if (regionSum !== group.revenue.actual) fail('sums.region', `${regionSum} vs group ${group.revenue.actual}`);
  if (practiceSum !== group.revenue.actual) fail('sums.practice', `${practiceSum} vs group ${group.revenue.actual}`);

  const refunds = refund_summary(dataset);
  const mixCount = refunds.byReason.reduce((n, row) => n + row.count, 0);
  const mixTotal = refunds.byReason.reduce((n, row) => n + row.total, 0);
  if (mixCount !== refunds.count) fail('refunds.reasonCount', `${mixCount} vs ${refunds.count}`);
  if (mixTotal !== refunds.total) fail('refunds.reasonTotal', `${mixTotal} vs ${refunds.total}`);

  // 3. The reporting estate is honest.
  console.log('The reporting estate is honest:');
  const model = buildMapModel(dataset);
  const notReported = model.practices.filter((p) => !p.reported);
  console.log(`  ${model.practices.length - notReported.length} reporting, ${notReported.length} not${notReported.length ? ` (${notReported.map((p) => p.name).join(', ')})` : ''}`);
  const attention = rank_attention(dataset);
  const attentionIds = new Set(attention.map((row) => row.practiceId));
  for (const practice of notReported) {
    if (practice.attentionSignals.length > 0) fail(`estate.${practice.practiceId}.signals`, 'has attention signals while not reporting');
    if (attentionIds.has(practice.practiceId)) fail(`estate.${practice.practiceId}.ranked`, 'appears in rank_attention while not reporting');
  }
  const portfolios = mentor_portfolios(model);
  const portfolioIds = portfolios.flatMap((portfolio) => portfolio.practiceIds);
  if (portfolioIds.length !== dataset.practices.length) {
    fail('estate.portfolios', `${portfolioIds.length} ids across portfolios vs ${dataset.practices.length} practices`);
  }

  // 4. Every display a reported practice shows resolves.
  console.log('Every reported practice display resolves:');
  for (const practice of model.practices) {
    if (!practice.reported) continue;
    if (!practice.revenueDisplay.includes('£')) fail(`display.${practice.practiceId}.revenue`, practice.revenueDisplay);
    if (!practice.conversionDisplay.includes('%')) fail(`display.${practice.practiceId}.conversion`, practice.conversionDisplay);
    if (!practice.clAttainmentDisplay.includes('%')) fail(`display.${practice.practiceId}.contactLens`, practice.clAttainmentDisplay);
    if (!practice.trainingCompletionDisplay.includes('%')) fail(`display.${practice.practiceId}.training`, practice.trainingCompletionDisplay);
    if (practice.revenueTrend.length !== months.length) fail(`display.${practice.practiceId}.trend`, `${practice.revenueTrend.length} points vs ${months.length} months`);
  }

  // 5. The report a reviewer reads.
  const scoreById = new Map(attention.map((row) => [row.practiceId, row.score]));
  console.log('\nPer practice:');
  for (const practice of model.practices) {
    const estate = practice.reported ? 'reporting' : '   --   ';
    const score = String(scoreById.get(practice.practiceId) ?? '-').padStart(3);
    console.log(
      `  ${practice.practiceId}  ${practice.name.padEnd(36)} ${estate}  ${practice.revenueDisplay.padStart(10)}  score ${score}  flags ${practice.refundFlags.length}  ${practice.trainingStatus}`,
    );
  }

  console.log(failures === 0 ? '\nAll invariants hold.' : `\n${failures} invariant failure${failures === 1 ? '' : 's'}.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
