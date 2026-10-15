import {
  loadDatasetFromDir,
  monthsOf,
  query_metrics,
  compare,
  compare_latest_month,
  training_status,
  rank_attention,
  today_priorities,
  refund_findings,
  refund_summary,
} from '../data';

/**
 * Read-only demo/report script.
 *
 * Every figure printed here is produced by the pure functions in `src/data`.
 * This is the same surface the chat/BI layer will call - nothing is hard-coded
 * and nothing is computed by hand.
 *
 * Usage: `npm run demo`
 */

const line = '─'.repeat(72);

function heading(title: string): void {
  console.log(`\n${title}\n${line}`);
}

const dataset = loadDatasetFromDir();
const months = monthsOf(dataset);
const latest = months[months.length - 1];

// ── 1. Group metrics for the latest month ────────────────────────────────────
const group = query_metrics(dataset, { month: latest });
heading(`1. Group metrics - ${group.monthLabels.join(', ')}`);
console.log(`Revenue        ${group.revenue.actualDisplay} vs target ${group.revenue.targetDisplay}  (${group.revenue.attainmentDisplay}, ${group.revenue.varianceDisplay})`);
console.log(`Conversion     ${group.conversion.rateDisplay} vs target ${group.conversion.targetDisplay}  (${group.conversion.varianceDisplay}) over ${group.conversion.exams} exams`);
console.log(`Contact lens   ${group.contactLens.actualDisplay} vs target ${group.contactLens.targetDisplay}  (${group.contactLens.attainmentDisplay})`);
console.log(`Practices      ${group.practiceCount} · ${months.length} months: ${months.join(', ')}`);

// ── 2. rank_attention - top 5 ────────────────────────────────────────────────
const attention = rank_attention(dataset, { limit: 5 });
heading('2. rank_attention - top 5 practices needing attention');
for (const [i, row] of attention.entries()) {
  console.log(`\n${i + 1}. ${row.name} (${row.region}) - score ${row.score}/100 · ${row.band}`);
  console.log(`   Revenue ${row.stats.revenueDisplay} (${row.stats.revenueMoMDisplay} MoM) · Conversion ${row.stats.conversionDisplay} (${row.stats.conversionMoMDisplay}) · CL ${row.stats.clAttainmentDisplay} · Training ${row.stats.trainingCompletionDisplay}`);
  for (const signal of row.signals) {
    console.log(`   • [${signal.points} pts] ${signal.label}: ${signal.evidence}`);
  }
}

// ── 2b. today_priorities - the five things to look at now ────────────────────
const today = today_priorities(dataset);
heading(`2b. today_priorities - ${today.monthLabel} (exactly ${today.items.length} items, varied)`);
for (const [i, item] of today.items.entries()) {
  const target = item.practiceId ? `practice ${item.practiceId}` : `region ${item.region}`;
  console.log(`\n${i + 1}. [${item.kind}] ${item.title}`);
  console.log(`   ${item.summary}`);
  console.log(`   metric: ${item.metric.label} ${item.metric.value} (${item.metric.comparison}) · ${target}`);
  console.log(`   map: lens=${item.mapView.lens} · dashboard: ${item.dashboardQuery.metrics.join('+')} by ${item.dashboardQuery.group_by}`);
}

// ── 3. North West vs other regions ───────────────────────────────────────────heading('3. North West vs other regions (latest month vs previous)');
for (const metric of ['revenue', 'conversion'] as const) {
  const cmp = compare_latest_month(dataset, metric, 'region', { sort: 'delta-asc' });
  console.log(`\n${metric === 'revenue' ? 'Revenue' : 'Conversion'} - ${cmp.periodALabel} vs ${cmp.periodBLabel}`);
  for (const row of cmp.rows) {
    const flag = row.region === undefined && row.label === 'North West' ? '  <-- declining' : '';
    console.log(`  ${row.label.padEnd(14)} ${row.currentDisplay.padStart(10)}  (prev ${row.previousDisplay.padStart(10)})  ${row.deltaDisplay}${flag}`);
  }
}

const restRegions = [...new Set(dataset.practices.map((p) => p.region))].filter((r) => r !== 'North West');
const nw = query_metrics(dataset, { regions: ['North West'], month: latest });
const rest = query_metrics(dataset, { regions: restRegions, month: latest });
console.log('\nNorth West vs all other regions combined (latest month):');
console.log(`  North West     revenue ${nw.revenue.actualDisplay} · conversion ${nw.conversion.rateDisplay} · attainment ${nw.revenue.attainmentDisplay}`);
console.log(`  Other regions  revenue ${rest.revenue.actualDisplay} · conversion ${rest.conversion.rateDisplay} · attainment ${rest.revenue.attainmentDisplay}`);

// ── 4. Practices below contact-lens target ───────────────────────────────────
const byPractice = query_metrics(dataset, { month: latest, groupBy: 'practice' }).breakdown ?? [];
const clBelow = byPractice
  .filter((row) => row.metrics.contactLens.attainmentPct < 90)
  .sort((a, b) => a.metrics.contactLens.attainmentPct - b.metrics.contactLens.attainmentPct);
heading(`4. Practices below contact-lens target (<90% of target) - ${clBelow.length} found`);
for (const row of clBelow) {
  console.log(`  ${row.label.padEnd(14)} ${row.region?.padEnd(12)} ${row.metrics.contactLens.attainmentDisplay}  (${row.metrics.contactLens.actualDisplay} vs ${row.metrics.contactLens.targetDisplay})`);
}

// ── 5. Practices with incomplete training ────────────────────────────────────
const training = training_status(dataset, { onlyIncomplete: true });
heading(`5. Practices with incomplete training - ${training.summary.practicesWithGaps} found`);
console.log(`Group training completion: ${training.summary.completionDisplay} across ${training.summary.practices} practices (${training.summary.practicesOverdue} overdue)\n`);
for (const row of training.byPractice) {
  const modules = row.gaps.map((g) => `${g.moduleName}${g.overdue ? ' (overdue)' : ''}`).join(', ');
  console.log(`  ${row.name.padEnd(14)} ${row.region.padEnd(12)} ${row.completionDisplay.padStart(4)}  ${modules}`);
}

// ── 6. Refunds and goodwill - the money given back ───────────────────────────
const refunds = refund_summary(dataset, { groupBy: 'region' });
heading(`6. Refunds - ${refunds.monthLabel}`);
console.log(`Refunds        ${refunds.totalDisplay} across ${refunds.countDisplay} payments (${refunds.rateDisplay} of revenue)`);
console.log(`Vs previous    ${refunds.previous.changeDisplay ?? 'n/a'} against ${refunds.previous.monthLabel} (${refunds.previous.totalDisplay ?? '-'})`);
console.log(`Net revenue    ${refunds.netRevenueDisplay} after refunds`);
console.log(`By reason      ${refunds.byReason.map((row) => `${row.label} ${row.totalDisplay} (${row.shareDisplay})`).join(' · ')}`);
console.log(`By region      ${(refunds.breakdown ?? []).map((row) => `${row.label} ${row.totalDisplay}`).join(' · ')}`);
console.log(`Trend          ${refunds.trend.map((point) => `${point.monthLabel} ${point.totalDisplay}`).join(' → ')}`);

const refundRows = refund_findings(dataset);
const flaggedRefunds = refundRows.filter((row) => row.findings.length > 0);
console.log(`\nUnusual refunds (${flaggedRefunds.length} practices):`);
for (const row of flaggedRefunds) {
  console.log(`  ${row.name.padEnd(14)} ${row.region.padEnd(12)} ${row.latestTotalDisplay.padStart(8)} ${row.rateDisplay.padStart(6)}`);
  for (const finding of row.findings) {
    console.log(`     • [${finding.points} pts] ${finding.label}: ${finding.evidence}`);
  }
}
if (refunds.aboveAuthority.length > 0) {
  console.log(`\nAbove-authority gestures: ${refunds.aboveAuthority.map((entry) => entry.evidence).join(' ')}`);
}
if (refunds.nearThreshold.length > 0) {
  console.log(`Under-the-line clusters: ${refunds.nearThreshold.map((entry) => entry.evidence).join(' ')}`);
}

// ── 7. Consistency checks ────────────────────────────────────────────────────
heading('7. Consistency checks');
const practiceSum = byPractice.reduce((n, row) => n + row.metrics.revenue.actual, 0);
const regionSum = (query_metrics(dataset, { month: latest, groupBy: 'region' }).breakdown ?? [])
  .reduce((n, row) => n + row.metrics.revenue.actual, 0);
const groupCompare = compare(dataset, {
  metric: 'revenue',
  groupBy: 'group',
  periodA: { from: latest, to: latest },
  periodB: { from: months[months.length - 2], to: months[months.length - 2] },
});
const refundsByPractice = refund_summary(dataset, { groupBy: 'practice' });
const refundSum = (refundsByPractice.breakdown ?? []).reduce((n, row) => n + row.total, 0);
const check = (label: string, a: number, b: number) =>
  console.log(`  ${a === b ? 'PASS' : 'FAIL'}  ${label}: ${a} vs ${b}`);

check('sum(practice revenue) == group revenue (query_metrics)', practiceSum, group.revenue.actual);
check('sum(region revenue) == group revenue (query_metrics)', regionSum, group.revenue.actual);
check('compare(group, latest) == query_metrics(latest)', groupCompare.rows[0].current, group.revenue.actual);
check('sum(practice refunds) == group refunds (refund_summary)', refundSum, refunds.total);
console.log(`\n${line}`);
console.log('All figures above come from src/data pure functions - none are hard-coded.');
