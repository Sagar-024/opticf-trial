import {
  query_metrics,
  compare,
  training_status,
  rank_attention,
  today_priorities,
  refund_findings,
  refund_summary,
  monthsOf,
  practiceDisplayName,
  selectPerformance,
} from '../data/index';
import type { Dataset, SeriesMetrics, MetricsBreakdownRow } from '../data/index';
import { formatMoney, formatNumber, formatPercent, formatSignedPercent } from '../lib/format';
import { monthLabel } from '../lib/months';
import { buildCompareView } from '../compare/model';
import { buildMapModel, type MapPractice } from '../data/map-model';
import { BRAIN_DOCUMENTS, type BrainDocument } from '../content/brain';
import { resolvePracticeIds, selectBrainDocuments, type PracticeRef } from '../brain/retrieve';
import { extractNumbers } from './guard';
import type { LlmToolDefinition } from './llm';
import type { ChatContext, TableWidget, ToolOutput, Widget } from './types';

/**
 * The tool layer.
 *
 * Every tool is a thin wrapper over the pure functions in `src/data`. Tools
 * build widgets themselves and hand the model a pre-formatted `summary` it may
 * quote. The model never computes or formats a number.
 */

export type MetricKey = 'revenue' | 'conversion' | 'contactLens' | 'exams' | 'target' | 'clTarget';
const METRIC_KEYS: MetricKey[] = ['revenue', 'conversion', 'contactLens', 'exams', 'target', 'clTarget'];

const METRIC_LABEL: Record<MetricKey, string> = {
  revenue: 'Revenue',
  conversion: 'Conversion',
  contactLens: 'Contact lens',
  exams: 'Examinations',
  target: 'Revenue target',
  clTarget: 'Contact lens target',
};

function metricValue(m: SeriesMetrics, key: MetricKey): number {
  switch (key) {
    case 'revenue': return m.revenue.actual;
    case 'conversion': return m.conversion.ratePct;
    case 'contactLens': return m.contactLens.actual;
    case 'exams': return m.conversion.exams;
    case 'target': return m.revenue.target;
    case 'clTarget': return m.contactLens.target;
  }
}

function metricDisplay(m: SeriesMetrics, key: MetricKey): string {
  switch (key) {
    case 'revenue': return m.revenue.actualDisplay;
    case 'conversion': return m.conversion.rateDisplay;
    case 'contactLens': return m.contactLens.actualDisplay;
    case 'exams': return formatNumber(m.conversion.exams);
    case 'target': return m.revenue.targetDisplay;
    case 'clTarget': return m.contactLens.targetDisplay;
  }
}

function metricValueType(key: MetricKey): 'currency' | 'percent' | 'number' {
  if (key === 'conversion') return 'percent';
  if (key === 'exams') return 'number';
  return 'currency';
}

/**
 * A group-level dashboard with a single data point is useless (one giant bar,
 * a one-row table). So when the request is group level we chart the region
 * breakdown instead, and when the scope is a single region we chart practices.
 * The KPI card still shows the group totals.
 */
function resolveBreakdown(
  requested: 'group' | 'region' | 'practice',
  regions: string[] | undefined,
  practiceIds: string[] | undefined,
): { groupBy: 'group' | 'region' | 'practice'; label: string } {
  if (requested === 'practice') return { groupBy: 'practice', label: 'practice' };
  if (requested === 'region') return { groupBy: 'region', label: 'region' };
  if (practiceIds && practiceIds.length > 0) return { groupBy: 'practice', label: 'practice' };
  if (regions && regions.length === 1) return { groupBy: 'practice', label: 'practice' };
  return { groupBy: 'region', label: 'region' };
}

/**
 * What the numbers actually cover, for the KPI card's title: a named
 * practice, the practices in scope, the regions in scope, or the group. A
 * region-scoped card must never say "Group metrics" over North West figures.
 */
function scopeName(ds: Dataset, regions: string[] | undefined, practiceIds: string[] | undefined): string {
  if (practiceIds && practiceIds.length > 0) {
    if (practiceIds.length === 1) {
      const practice = ds.practices.find((row) => row.practiceId === practiceIds[0]);
      if (practice) return practice.name;
    }
    if (practiceIds.length === 2) {
      return practiceIds
        .map((id) => ds.practices.find((row) => row.practiceId === id)?.name ?? id)
        .join(' and ');
    }
    return `${practiceIds.length} practices`;
  }
  if (regions && regions.length > 0) return regions.join(', ');
  return 'Group';
}

interface ScopeRow {
  label: string;
  metrics: SeriesMetrics;
}

function scopeRows(m: { breakdown?: MetricsBreakdownRow[] } & SeriesMetrics): ScopeRow[] {  if (m.breakdown && m.breakdown.length > 0) {
    return m.breakdown.map((row) => ({ label: row.label, metrics: row.metrics }));
  }
  return [{ label: 'Group', metrics: m }];
}

function kpiWidget(id: string, title: string, m: SeriesMetrics): Widget {
  return {
    type: 'kpi',
    id,
    title,
    items: [
      { label: 'Revenue', value: m.revenue.actualDisplay, sub: `${m.revenue.attainmentDisplay} of target` },
      { label: 'Conversion', value: m.conversion.rateDisplay, sub: `vs ${m.conversion.targetDisplay} target` },
      { label: 'Contact lens', value: m.contactLens.actualDisplay, sub: `${m.contactLens.attainmentDisplay} of target` },
      { label: 'Examinations', value: formatNumber(m.conversion.exams), sub: `${m.practiceCount} practices` },
    ],
  };
}

function chartWidgets(rows: ScopeRow[], keys: MetricKey[], idPrefix: string, groupLabel = 'group'): Widget[] {
  return keys.map((key) => ({
    type: 'chart',
    id: `${idPrefix}-${key}`,
    title: `${METRIC_LABEL[key]} by ${groupLabel}`,
    chart: 'bar',
    valueType: metricValueType(key),
    series: [
      {
        name: METRIC_LABEL[key],
        points: rows.map((row) => ({ label: row.label, value: metricValue(row.metrics, key), display: metricDisplay(row.metrics, key) })),
      },
    ],
  }));
}

function metricTable(title: string, rows: ScopeRow[], keys: MetricKey[]): TableWidget {
  return {
    type: 'table',
    title,
    id: `table-${title.toLowerCase().replace(/\W+/g, '-')}`,
    columns: ['Group', ...keys.map((k) => METRIC_LABEL[k])],
    rows: rows.map((row) => [row.label, ...keys.map((k) => metricDisplay(row.metrics, k))]),
  };
}

function context(opts: {
  metric?: string;
  groupBy?: string;
  regions?: string[];
  practiceIds?: string[];
  month?: string;
}): ChatContext {
  return {
    metric: opts.metric,
    group_by: opts.groupBy,
    filters: { regions: opts.regions, practiceIds: opts.practiceIds },
    period: { month: opts.month },
    practiceIds: opts.practiceIds ?? [],
  };
}

/** Build the ToolOutput numbers field from everything the tool produced. */
function withNumbers(output: Omit<ToolOutput, 'numbers'>): ToolOutput {
  const text = JSON.stringify({ summary: output.summary, widgets: output.widgets, mapHighlight: output.mapHighlight ?? [] });
  return { ...output, numbers: extractNumbers(text) };
}

// ── Handlers ────────────────────────────────────────────────────────────────

function runQueryMetrics(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const latest = monthsOf(ds).at(-1);
  const requested = (input.group_by as 'group' | 'region' | 'practice') ?? 'group';
  const regions = input.regions as string[] | undefined;
  const practiceIds = input.practiceIds as string[] | undefined;
  const month = (input.month as string) ?? latest;
  const { groupBy, label } = resolveBreakdown(requested, regions, practiceIds);

  const m = query_metrics(ds, { month, groupBy, regions, practiceIds });
  const rows = scopeRows(m);
  const widgets: Widget[] = [kpiWidget('qm-kpi', `${scopeName(ds, regions, practiceIds)} metrics - ${monthLabel(month)}`, m)];
  if (rows.length >= 2) {
    widgets.push(...chartWidgets(rows, ['revenue', 'conversion'], 'qm', label));
    widgets.push(metricTable(`Metrics by ${label}`, rows, ['revenue', 'conversion', 'contactLens']));
  }

  const summary = [
    `${monthLabel(month)}: revenue ${m.revenue.actualDisplay} (${m.revenue.attainmentDisplay} of a ${m.revenue.targetDisplay} target),`,
    `conversion ${m.conversion.rateDisplay} vs ${m.conversion.targetDisplay} target across ${formatNumber(m.conversion.exams)} examinations,`,
    `contact lens ${m.contactLens.actualDisplay} (${m.contactLens.attainmentDisplay} of target),`,
    `${m.practiceCount} practices.`,
    rows.length >= 2 ? `Breakdown by ${label}: ${rows.map((row) => `${row.label} ${metricDisplay(row.metrics, 'revenue')}`).join(', ')}.` : '',
  ].join(' ');

  return withNumbers({
    summary,
    widgets,
    sources: [`Monthly performance, ${monthLabel(month)}`],
    context: context({ metric: 'revenue+conversion', groupBy, regions, practiceIds, month }),
  });
}

function runCompare(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const metric = (input.metric as 'revenue' | 'conversion' | 'contactLens') ?? 'revenue';
  const groupBy = (input.group_by as 'group' | 'region' | 'practice') ?? 'region';
  const periodA = input.period_a as { from: string; to: string };
  const periodB = input.period_b as { from: string; to: string };
  const regions = input.regions as string[] | undefined;
  const limit = (input.limit as number) ?? 10;

  const result = compare(ds, { metric, groupBy, periodA, periodB, regions, sort: 'delta-asc' });
  const shown = result.rows.slice(0, limit);
  const table: TableWidget = {
    type: 'table',
    id: 'compare-table',
    title: `${METRIC_LABEL[metric as MetricKey] ?? metric} - ${result.periodALabel} vs ${result.periodBLabel}`,
    columns: ['Group', result.periodALabel, result.periodBLabel, 'Change'],
    rows: shown.map((row) => [row.label, row.currentDisplay, row.previousDisplay, row.deltaDisplay]),
  };
  const chart: Widget = {
    type: 'chart',
    id: 'compare-chart',
    title: `${METRIC_LABEL[metric as MetricKey] ?? metric} change`,
    chart: 'bar',
    valueType: metricValueType(metric as MetricKey),
    series: [
      {
        name: 'Change',
        points: shown.map((row) => ({ label: row.label, value: row.delta, display: row.deltaDisplay })),
      },
    ],
  };
  const biggest = result.rows[0];
  const summary = [
    `Comparing ${result.periodALabel} with ${result.periodBLabel} by ${groupBy}.`,
    biggest ? `Largest fall: ${biggest.label} ${biggest.deltaDisplay} (now ${biggest.currentDisplay}, was ${biggest.previousDisplay}).` : 'No rows.',
    `Returned ${shown.length} of ${result.rows.length} rows.`,
  ].join(' ');

  return withNumbers({
    summary,
    widgets: [chart, table],
    sources: [`Monthly performance, ${result.periodALabel} vs ${result.periodBLabel}`],
    context: context({ metric, groupBy, regions, month: periodA.to }),
  });
}

/**
 * Two or more named practices, one card. The view comes from the same pure
 * builder the map uses, so the chat widget and the map page are one design and
 * cannot disagree. The card carries every figure; the prose is a caption.
 */
function runComparePractices(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const ids = (input.practice_ids as string[] | undefined) ?? [];
  const month = input.month as string | undefined;
  const model = buildMapModel(ds, month);

  const chosen: MapPractice[] = [];
  for (const value of ids) {
    const needle = value.trim().toLowerCase();
    const practice =
      model.practices.find((row) => row.practiceId.toLowerCase() === needle) ??
      model.practices.find((row) => row.name.toLowerCase() === needle);
    if (practice && !chosen.includes(practice)) chosen.push(practice);
  }

  if (chosen.length < 2) {
    const known = model.practices.slice(0, 5).map((practice) => `${practice.practiceId} (${practice.name})`).join(', ');
    return withNumbers({
      summary: `A comparison needs at least two known practices. Received: ${ids.join(', ') || 'none'}. Some practice ids: ${known}.`,
      widgets: [],
      sources: [`Monthly performance, ${model.monthLabel}`],
      context: context({ metric: 'comparison', groupBy: 'practice', practiceIds: chosen.map((p) => p.practiceId), month: model.month }),
    });
  }

  const view = buildCompareView(chosen, model.monthLabel, model.month);
  const widget: Widget = {
    type: 'compare',
    id: `compare-${chosen.map((practice) => practice.practiceId).join('-')}`,
    title: view.title,
    view,
  };
  const evidence = view.watch.length > 0
    ? `Evidence. ${view.watch.map((entry) => `${entry.name}: ${entry.lines.join(' ')}`).join(' ')}`
    : '';
  const summary = [
    `${view.title}, ${view.monthLabel}.`,
    ...view.summary,
    evidence,
  ].filter(Boolean).join(' ');

  return withNumbers({
    summary,
    widgets: [widget],
    sources: [`Monthly performance, ${view.monthLabel}`, 'Training records'],
    context: context({
      metric: 'comparison',
      groupBy: 'practice',
      practiceIds: chosen.map((practice) => practice.practiceId),
      month: model.month,
    }),
  });
}

function runTrainingStatus(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const regions = input.regions as string[] | undefined;
  const practiceIds = input.practiceIds as string[] | undefined;
  const onlyIncomplete = input.only_incomplete === true;
  const result = training_status(ds, { regions, practiceIds, onlyIncomplete });

  const shown = result.byPractice.slice(0, 20);
  const table: TableWidget = {
    type: 'table',
    id: 'training-table',
    title: 'Training completion by practice',
    columns: ['Practice', 'Region', 'Completion', 'Missing modules'],
    rows: shown.map((row) => [
      row.name,
      row.region,
      row.completionDisplay,
      row.gaps.map((g) => `${g.moduleName}${g.overdue ? ' (overdue)' : ''}`).join(', ') || 'None',
    ]),
  };
  const mapHighlight = result.byPractice.filter((p) => !p.compliant).map((p) => p.practiceId);
  const summary = [
    `Group training completion ${result.summary.completionDisplay} across ${result.summary.practices} practices.`,
    `${result.summary.practicesWithGaps} practices have gaps, ${result.summary.practicesOverdue} are overdue.`,
    result.byPractice[0] ? `Lowest: ${result.byPractice[0].name} at ${result.byPractice[0].completionDisplay}.` : '',
  ].join(' ');

  return withNumbers({
    summary,
    widgets: [table],
    mapHighlight,
    sources: ['Training records'],
    context: context({ metric: 'training', groupBy: 'practice', regions, practiceIds }),
  });
}

function runRankAttention(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const latest = monthsOf(ds).at(-1)!;
  const regions = input.regions as string[] | undefined;
  const limit = (input.limit as number) ?? 8;
  const rows = rank_attention(ds, { regions, limit });
  const table: TableWidget = {
    type: 'table',
    id: 'attention-table',
    title: 'Practices ranked by need',
    columns: ['Practice', 'Region', 'Why'],
    rows: rows.map((row) => [
      row.name,
      row.region,
      row.signals.map((s) => s.label).join('; '),
    ]),
  };
  const mapHighlight = rows.map((row) => row.practiceId);
  const top = rows[0];
  const summary = [
    `Top ${rows.length} practices by need, in order.`,
    top ? `Highest: ${top.name} (${top.region}) - ${top.signals.map((s) => s.evidence).join(' ')}` : '',
    'The order weighs revenue decline, conversion decline, being below target, contact-lens shortfall and training gaps. Each row states the evidence behind it.',
  ].join(' ');

  return withNumbers({
    summary,
    widgets: [table],
    mapHighlight,
    sources: [`Monthly performance, ${monthLabel(latest)}`, 'Training records'],
    context: context({ metric: 'attention', groupBy: 'practice', regions, practiceIds: mapHighlight }),
  });
}

function runTodayPriorities(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const month = input.month as string | undefined;
  const today = today_priorities(ds, month);
  const table: TableWidget = {
    type: 'table',
    id: 'today-table',
    title: `Today's priorities - ${today.monthLabel}`,
    columns: ['#', 'Priority', 'Issue', 'Where', 'Metric'],
    rows: today.items.map((item, i) => [
      String(i + 1),
      item.title,
      item.issue,
      item.practiceId ? `Practice ${item.practiceId}` : `Region ${item.region}`,
      `${item.metric.label} ${item.metric.value} (${item.metric.comparison})`,
    ]),
  };
  const mapHighlight = today.items.map((i) => i.practiceId).filter((id): id is string => Boolean(id));
  const summary = [
    `Today's priorities for ${today.monthLabel} (exactly ${today.items.length} items).`,
    ...today.items.map((item, i) => `${i + 1}. ${item.title} - ${item.summary}`),
  ].join(' ');

  return withNumbers({
    summary,
    widgets: [table],
    mapHighlight,
    sources: [`Monthly performance, ${today.monthLabel}`, 'Training records'],
    context: context({ metric: 'attention', groupBy: 'practice', practiceIds: mapHighlight, month: today.month }),
  });
}

function runGetPractice(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const id = String(input.practice_id ?? '').trim();
  const matches = ds.practices.filter(
    (p) =>
      p.practiceId.toLowerCase() === id.toLowerCase()
      || p.name.toLowerCase() === id.toLowerCase()
      || practiceDisplayName(ds, p.practiceId).toLowerCase() === id.toLowerCase(),
  );

  // Two practices can share a name. Never guess between them: list them and
  // let the reader pick by town.
  if (matches.length > 1) {
    const table: TableWidget = {
      type: 'table',
      id: 'practice-table',
      title: `More than one practice is called ${id}`,
      columns: ['Practice', 'Town', 'Region', 'Manager'],
      rows: matches.map((p) => [
        practiceDisplayName(ds, p.practiceId),
        p.town,
        p.region,
        p.manager || 'No manager recorded',
      ]),
    };
    return withNumbers({
      summary: `${matches.length} practices are called ${id}: ${matches.map((p) => practiceDisplayName(ds, p.practiceId)).join(' and ')}. Ask about one of them by town.`,
      widgets: [table],
      mapHighlight: matches.map((p) => p.practiceId),
      sources: ['Practice directory'],
      context: context({ groupBy: 'practice', practiceIds: matches.map((p) => p.practiceId) }),
    });
  }

  const practice = matches[0];
  if (!practice) {
    return withNumbers({ summary: `No practice found for "${id}".`, widgets: [], mapHighlight: [], sources: ['Practice directory'] });
  }
  const displayName = practiceDisplayName(ds, practice.practiceId);
  const months = monthsOf(ds);
  const latest = months[months.length - 1];

  // A practice with no latest-month row shows its last reported month, never a
  // month it was not there for: "no data" must never read as a collapse.
  const reported = selectPerformance(ds, { practiceIds: [practice.practiceId], month: latest }).length > 0;
  const effective = reported
    ? latest
    : [...months].reverse().find((month) => selectPerformance(ds, { practiceIds: [practice.practiceId], month }).length > 0) ?? latest;

  const m = query_metrics(ds, { practiceIds: [practice.practiceId], month: effective });
  const previousMonth = months[months.indexOf(effective) - 1];
  const b = previousMonth ? query_metrics(ds, { practiceIds: [practice.practiceId], month: previousMonth }) : null;
  const momPct = b && b.revenue.actual > 0 ? ((m.revenue.actual - b.revenue.actual) / b.revenue.actual) * 100 : null;
  const momText = momPct !== null && previousMonth ? `${formatSignedPercent(momPct)} vs ${monthLabel(previousMonth)}` : '';
  const training = training_status(ds, { practiceIds: [practice.practiceId] });
  const t = training.byPractice[0];
  const refunds = reported ? refund_findings(ds, { practiceIds: [practice.practiceId] })[0] : undefined;

  const table: TableWidget = {
    type: 'table',
    id: 'practice-table',
    title: `${displayName} - context`,
    columns: ['Field', 'Value'],
    rows: [
      ...(reported ? [] : [['Status', `Stopped reporting after ${monthLabel(effective)}`]]),
      ['Region', practice.region],
      ['Manager', practice.manager || 'No manager recorded'],
      ['Mentor', practice.mentorName],
      ['PMS', practice.pmsSystem],
      ['Revenue', m.revenue.actualDisplay],
      ['Revenue vs target', m.revenue.attainmentDisplay],
      ['Revenue change', momText || 'n/a'],
      ['Conversion', m.conversion.rateDisplay],
      ['Contact lens', `${m.contactLens.actualDisplay} (${m.contactLens.attainmentDisplay} of target)`],
      ['Training', t ? `${t.completionDisplay}${t.gaps.length ? ` - missing ${t.gaps.map((g) => g.moduleName).join(', ')}` : ''}` : 'n/a'],
      [
        'Refunds',
        refunds
          ? `${refunds.latestTotalDisplay} (${refunds.rateDisplay} of revenue${refunds.momDisplay ? `, ${refunds.momDisplay} vs ${refunds.prevMonthLabel}` : ''})${refunds.findings.length ? ` - ${refunds.findings.map((finding) => finding.label).join('; ')}` : ''}`
          : reported ? 'n/a' : 'none after divestment',
      ],
    ],
  };
  const managerPart = practice.manager ? `manager ${practice.manager}, ` : 'no manager recorded, ';
  const summary = reported
    ? `${displayName} (${practice.region}), ${managerPart}mentor ${practice.mentorName}. Revenue ${m.revenue.actualDisplay} (${m.revenue.attainmentDisplay} of target)${momText ? `, ${momText}` : ''}, conversion ${m.conversion.rateDisplay}, contact lens ${m.contactLens.attainmentDisplay} of target${t ? `, training ${t.completionDisplay} complete` : ''}${refunds ? `, refunds ${refunds.latestTotalDisplay} (${refunds.rateDisplay} of revenue)` : ''}.`
    : `${displayName} (${practice.region}) stopped reporting after ${monthLabel(effective)} and is no longer part of the trading group. Its last reported month: revenue ${m.revenue.actualDisplay} (${m.revenue.attainmentDisplay} of target)${momText ? `, ${momText}` : ''}, conversion ${m.conversion.rateDisplay}, contact lens ${m.contactLens.attainmentDisplay} of target${t ? `, training ${t.completionDisplay} complete` : ''}.`;

  return withNumbers({
    summary,
    widgets: [kpiWidget('practice-kpi', reported ? `${displayName} - ${monthLabel(effective)}` : `${displayName} - ${monthLabel(effective)} (last reported)`, m), table],
    mapHighlight: [practice.practiceId],
    sources: ['Practice directory', `Monthly performance, ${monthLabel(effective)}`, 'Training records'],
    context: context({ metric: 'revenue+conversion', groupBy: 'practice', practiceIds: [practice.practiceId], month: effective }),
  });
}

function runBelowClTarget(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const latest = monthsOf(ds).at(-1)!;
  const threshold = (input.threshold as number) ?? 90;
  const regions = input.regions as string[] | undefined;
  const month = (input.month as string) ?? latest;

  const breakdown = query_metrics(ds, { month, groupBy: 'practice', regions }).breakdown ?? [];
  const below = breakdown
    .filter((row) => row.metrics.contactLens.attainmentPct < threshold)
    .sort((a, b) => a.metrics.contactLens.attainmentPct - b.metrics.contactLens.attainmentPct);

  const table: TableWidget = {
    type: 'table',
    id: 'cl-table',
    title: `Contact lens below ${threshold}% of target - ${monthLabel(month)}`,
    columns: ['Practice', 'Region', 'Attainment', 'Actual', 'Target'],
    rows: below.map((row) => [
      row.label,
      row.region ?? '',
      row.metrics.contactLens.attainmentDisplay,
      row.metrics.contactLens.actualDisplay,
      row.metrics.contactLens.targetDisplay,
    ]),
  };
  const mapHighlight = below.map((row) => row.key);
  const summary = [
    `${below.length} practices are below ${threshold}% of their contact-lens target in ${monthLabel(month)}.`,
    below[0] ? `Lowest: ${below[0].label} at ${below[0].metrics.contactLens.attainmentDisplay}.` : '',
  ].join(' ');

  return withNumbers({
    summary,
    widgets: [table],
    mapHighlight,
    sources: [`Monthly performance, ${monthLabel(month)}`, 'Practice directory'],
    context: context({ metric: 'contactLens', groupBy: 'practice', regions, practiceIds: mapHighlight, month }),
  });
}

function runHighlightOnMap(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const ids = (input.practice_ids as string[]) ?? [];
  const practices = ds.practices.filter((p) => ids.includes(p.practiceId));
  const table: TableWidget = {
    type: 'table',
    id: 'highlight-table',
    title: 'Highlighted on the map',
    columns: ['Practice', 'Region', 'Manager'],
    rows: practices.map((p) => [practiceDisplayName(ds, p.practiceId), p.region, p.manager || 'No manager recorded']),
  };
  return withNumbers({
    summary: `Highlighted ${practices.length} practices on the map: ${practices.map((p) => practiceDisplayName(ds, p.practiceId)).join(', ')}.`,
    widgets: [table],
    mapHighlight: practices.map((p) => p.practiceId),
    sources: ['Practice directory'],
    context: context({ groupBy: 'practice', practiceIds: practices.map((p) => p.practiceId) }),
  });
}

function runBuildDashboard(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const latest = monthsOf(ds).at(-1)!;
  const metrics = ((input.metrics as string[]) ?? ['revenue', 'conversion']).filter((k): k is MetricKey =>
    (METRIC_KEYS as string[]).includes(k),
  );
  const requested = (input.group_by as 'group' | 'region' | 'practice') ?? 'group';
  const filters = (input.filters as { regions?: string[]; practiceIds?: string[] }) ?? {};
  const period = (input.period as { month?: string }) ?? {};
  const month = period.month ?? latest;
  const { groupBy, label } = resolveBreakdown(requested, filters.regions, filters.practiceIds);

  const m = query_metrics(ds, { month, groupBy, regions: filters.regions, practiceIds: filters.practiceIds });
  const rows = scopeRows(m);
  const widgets: Widget[] = [kpiWidget('dash-kpi', `${scopeName(ds, filters.regions, filters.practiceIds)} dashboard - ${monthLabel(month)}`, m)];
  if (rows.length >= 2) {
    widgets.push(...chartWidgets(rows, metrics, 'dash', label));
    widgets.push(metricTable(`Dashboard table by ${label}`, rows, metrics));
  }

  const summary = [
    `Dashboard for ${monthLabel(month)}: revenue ${m.revenue.actualDisplay} (${m.revenue.attainmentDisplay} of target),`,
    `conversion ${m.conversion.rateDisplay}, contact lens ${m.contactLens.actualDisplay} (${m.contactLens.attainmentDisplay} of target),`,
    `across ${m.practiceCount} practices.`,
    rows.length >= 2
      ? `Charts show ${metrics.map((k) => METRIC_LABEL[k]).join(', ')} by ${label}: ${rows.map((row) => `${row.label} ${metricDisplay(row.metrics, metrics[0] ?? 'revenue')}`).join(', ')}.`
      : '',
  ].join(' ');

  return withNumbers({
    summary,
    widgets,
    sources: [`Monthly performance, ${monthLabel(month)}`],
    context: context({ metric: metrics.join('+'), groupBy, regions: filters.regions, practiceIds: filters.practiceIds, month }),
  });
}

/**
 * Refunds: totals, rate, trend, reason mix and the policy checks. This is the
 * tool behind "show me refunds", which used to have no answer.
 */
function runQueryRefunds(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const latest = monthsOf(ds).at(-1)!;
  const month = (input.month as string) ?? latest;
  const regions = input.regions as string[] | undefined;
  const practiceIds = input.practiceIds as string[] | undefined;
  const requested = (input.group_by as 'group' | 'region' | 'practice') ?? 'group';
  const { groupBy, label } = resolveBreakdown(requested, regions, practiceIds);

  const summary = refund_summary(ds, { month, regions, practiceIds, groupBy });
  const topReason = summary.byReason[0];
  const flaggedNames = summary.flaggedPracticeIds
    .map((id) => ds.practices.find((practice) => practice.practiceId === id)?.name ?? id)
    .join(', ');

  const kpi: Widget = {
    type: 'kpi',
    id: 'refunds-kpi',
    title: `Refunds - ${monthLabel(month)}`,
    items: [
      {
        label: 'Refunds',
        value: summary.totalDisplay,
        sub: summary.previous.changeDisplay
          ? `${summary.countDisplay} payments, ${summary.previous.changeDisplay} vs ${summary.previous.monthLabel}`
          : `${summary.countDisplay} payments`,
      },
      { label: 'Refund rate', value: summary.rateDisplay, sub: `of ${summary.revenueDisplay} revenue` },
      { label: 'Net revenue', value: summary.netRevenueDisplay, sub: `after ${summary.totalDisplay} refunded` },
      topReason
        ? { label: 'Largest reason', value: topReason.label, sub: `${topReason.totalDisplay} (${topReason.shareDisplay} of refunds)` }
        : { label: 'Largest reason', value: 'None', sub: 'no refunds this month' },
    ],
  };

  const widgets: Widget[] = [kpi];

  const trendChart: Widget = {
    type: 'chart',
    id: 'refunds-trend',
    title: `Refunds by month to ${monthLabel(month)}`,
    chart: 'bar',
    valueType: 'currency',
    series: [
      {
        name: 'Refunds',
        points: summary.trend.map((point) => ({ label: point.monthLabel, value: point.total, display: point.totalDisplay })),
      },
    ],
  };
  widgets.push(trendChart);

  if (summary.byReason.length > 0) {
    const reasonChart: Widget = {
      type: 'chart',
      id: 'refunds-reasons',
      title: `Refunds by reason - ${monthLabel(month)}`,
      chart: 'bar',
      valueType: 'currency',
      series: [
        {
          name: 'Refunds',
          points: summary.byReason.map((row) => ({ label: row.label, value: row.total, display: row.totalDisplay })),
        },
      ],
    };
    widgets.push(reasonChart);

    const reasonTable: TableWidget = {
      type: 'table',
      id: 'refunds-reason-table',
      title: 'Refunds by reason',
      columns: ['Reason', 'Payments', 'Total', 'Share'],
      rows: summary.byReason.map((row) => [row.label, formatNumber(row.count), row.totalDisplay, row.shareDisplay]),
    };
    widgets.push(reasonTable);
  }

  const breakdown = summary.breakdown ?? [];
  if (breakdown.length >= 2) {
    const table: TableWidget = {
      type: 'table',
      id: 'refunds-breakdown',
      title: `Refunds by ${label} - ${monthLabel(month)}`,
      columns: ['Group', 'Refunds', 'Payments', 'Rate', 'Vs previous month'],
      rows: breakdown
        .slice(0, 20)
        .map((row) => [row.label, row.totalDisplay, formatNumber(row.count), row.rateDisplay, row.momDisplay || '-']),
    };
    widgets.push(table);
  }

  const summaryText = [
    `Refunds in ${monthLabel(month)}: ${summary.totalDisplay} across ${summary.countDisplay} payments, ${summary.rateDisplay} of revenue.`,
    summary.previous.changeDisplay
      ? `That is ${summary.previous.changeDisplay} against ${summary.previous.monthLabel} (${summary.previous.totalDisplay}).`
      : '',
    `Net revenue ${summary.netRevenueDisplay} after refunds.`,
    topReason ? `Largest reason: ${topReason.label} at ${topReason.totalDisplay} (${topReason.shareDisplay} of refunds).` : 'No refunds this month.',
    breakdown.length >= 2
      ? `By ${label}: ${breakdown.slice(0, 6).map((row) => `${row.label} ${row.totalDisplay} (${row.rateDisplay})`).join(', ')}.`
      : '',
    summary.flaggedPracticeIds.length > 0
      ? `${formatNumber(summary.flaggedPracticeIds.length)} practice${summary.flaggedPracticeIds.length === 1 ? '' : 's'} look unusual this month (${flaggedNames}); use refund_anomalies for the evidence behind each.`
      : 'No practice looks unusual this month.',
  ].join(' ');

  return withNumbers({
    summary: summaryText,
    widgets,
    mapHighlight: summary.flaggedPracticeIds,
    sources: [`Refunds ledger, ${monthLabel(month)}`, `Monthly performance, ${monthLabel(month)}`],
    context: context({ metric: 'refunds', groupBy, regions, practiceIds, month }),
  });
}

/**
 * Which practices look unusual on refunds, and why each was flagged. Every
 * check is a plain rule from the refunds layer, quoted with its evidence.
 */
function runRefundAnomalies(ds: Dataset, input: Record<string, unknown>): ToolOutput {
  const regions = input.regions as string[] | undefined;
  const practiceIds = input.practiceIds as string[] | undefined;
  const limit = (input.limit as number) ?? 8;

  const all = refund_findings(ds, { regions, practiceIds }).filter((row) => row.findings.length > 0);
  const rows = all.slice(0, limit);
  const monthLabelText = rows[0]?.latestMonthLabel ?? monthLabel(monthsOf(ds).at(-1)!);

  const table: TableWidget = {
    type: 'table',
    id: 'refund-anomalies-table',
    title: `Unusual refunds - ${monthLabelText}`,
    columns: ['Practice', 'Region', 'Refunds', 'Rate', 'Vs previous month', 'Why'],
    rows: rows.map((row) => [
      row.name,
      row.region,
      row.latestTotalDisplay,
      row.rateDisplay,
      row.momDisplay || '-',
      row.findings.map((finding) => finding.label).join('; '),
    ]),
  };

  const summaryText = rows.length > 0
    ? [
        `${formatNumber(rows.length)} practice${rows.length === 1 ? '' : 's'} have unusual refunds in ${monthLabelText}.`,
        ...rows.slice(0, 3).map((row) => `${row.name}: ${row.findings.map((finding) => finding.evidence).join(' ')}`),
        'The checks: a spike against the practice\'s own usual level, a refund rate above 1.0% of revenue, goodwill above £50 without the regional lead, and gestures clustered under £50.',
      ].join(' ')
    : `No practice has unusual refunds in ${monthLabelText}.`;

  return withNumbers({
    summary: summaryText,
    widgets: [table],
    mapHighlight: rows.map((row) => row.practiceId),
    sources: [`Refunds ledger, ${monthLabelText}`, 'Goodwill policy (Brain)'],
    context: context({ metric: 'refunds', groupBy: 'practice', regions, practiceIds: rows.map((row) => row.practiceId) }),
  });
}

/** The practices a search resolves against, named as the reader sees them. */
function practiceRefs(ds: Dataset): PracticeRef[] {
  return ds.practices.map((practice) => ({
    id: practice.practiceId,
    name: practiceDisplayName(ds, practice.practiceId),
  }));
}

/**
 * The practice ids a search is about. The model's input is untrusted: it may
 * pass an id, a name, or nothing at all, so ids are resolved from the values
 * given and from the question text itself through the shared resolver in
 * `brain/retrieve`. A question that names a practice must never miss that
 * practice's recorded context because of a bad argument.
 */
function resolveSearchPracticeIds(ds: Dataset, raw: unknown, query: string): string[] {
  const values = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return resolvePracticeIds(practiceRefs(ds), [...values, query].join('\n'));
}

function runSearchBrain(ds: Dataset, input: Record<string, unknown>, ctx?: ToolContext): ToolOutput {
  const query = String(input.query ?? '').trim();
  const limit = Math.min(6, Math.max(1, Number(input.limit) || 3));
  const documents = ctx?.brainDocuments ?? BRAIN_DOCUMENTS;
  const practiceIds = resolveSearchPracticeIds(ds, input.practiceIds, query);

  if (query.length === 0) {
    return withNumbers({
      summary: 'No search terms were provided, so no guidance was looked up.',
      widgets: [],
      sources: [],
    });
  }

  // The selection rule lives in brain/retrieve, so the chat tool and the ask
  // surface can never rank the same corpus two ways: linked documents first,
  // then keyword matches, a document scoped to other practices never surfacing.
  const chosen = selectBrainDocuments(documents, { text: query, practiceIds, limit });

  if (chosen.length === 0) {
    return withNumbers({
      summary: `The Brain has no guidance matching "${query}". Say that the guidance is missing rather than inventing a procedure.`,
      widgets: [],
      sources: [],
    });
  }

  const table: TableWidget = {
    type: 'table',
    id: 'brain-table',
    title: 'Guidance found in the Brain',
    columns: ['Section', 'Guidance', 'Owner', 'Reviewed', 'Scope'],
    rows: chosen.map((document) => [
      document.section,
      document.title,
      document.owner,
      document.reviewed,
      document.scope,
    ]),
  };

  const summary = [
    `Found ${chosen.length} guidance document${chosen.length === 1 ? '' : 's'} for "${query}"${practiceIds.length > 0 ? `, including context for ${practiceIds.join(', ')}` : ''}.`,
    ...chosen.map((document) =>
      `[${document.title} | ${document.scope} | owner ${document.owner} | reviewed ${document.reviewed}] <<<${document.content}>>>`,
    ),
    chosen.some((document) => document.conflict)
      ? 'One of these documents is marked as conflicting with other guidance and needs clarification before it is relied on.'
      : '',
  ].join(' ');

  return withNumbers({
    summary,
    widgets: [table],
    sources: chosen.map((document) => `Brain: ${document.title}`),
    context: context({ metric: 'knowledge' }),
  });
}

// ── Definitions handed to the model ──────────────────────────────────────────
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Per-request context the tools may need beyond the dataset. */
export interface ToolContext {
  /** Group guidance with any local edits applied. */
  brainDocuments?: BrainDocument[];
}

export interface Tool {
  definition: ToolDefinition;
  run: (ds: Dataset, input: Record<string, unknown>, ctx?: ToolContext) => ToolOutput;
}

const MONTH_DESC = 'Month key YYYY-MM. Omit to use the latest month in the data ("this month").';

export const TOOLS: Tool[] = [
  {
    definition: {
      name: 'search_brain',
      description:
        'Search the group written guidance (the Brain): procedures, policies and practice context. Use this for any question about how something should be done, what the policy is, what guidance applies, or what the group has recorded about a specific practice. Returns the matching documents so the answer can cite them.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look up, e.g. "frame warranty" or "contact lens training".' },
          practiceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Practice ids the question is about. Their context documents are returned first.',
          },
          limit: { type: 'number', description: 'Maximum documents to return (default 3, max 6).' },
        },
        required: ['query'],
      },
    },
    run: runSearchBrain,
  },
  {
    definition: {
      name: 'query_metrics',
      description: 'Aggregate revenue, conversion rate, contact-lens sales and examinations for a month, optionally grouped by region or practice. Use for "how are we doing" questions and single-period dashboards.',
      input_schema: {
        type: 'object',
        properties: {
          month: { type: 'string', description: MONTH_DESC },
          regions: { type: 'array', items: { type: 'string' }, description: 'Restrict to these regions.' },
          practiceIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these practice ids.' },
          group_by: { type: 'string', enum: ['group', 'region', 'practice'], description: 'Aggregation level (default group).' },
        },
      },
    },
    run: runQueryMetrics,
  },
  {
    definition: {
      name: 'query_refunds',
      description:
        'Refunds and goodwill for a month: the total, the refund rate as a share of revenue, net revenue after refunds, the month-on-month change, the reason mix, and the trend across all months. Use this for "show me refunds", "how much did we refund", "what are refunds costing us" and refund breakdowns by region or practice. The summary states which practices look unusual; call refund_anomalies for their evidence.',
      input_schema: {
        type: 'object',
        properties: {
          month: { type: 'string', description: MONTH_DESC },
          regions: { type: 'array', items: { type: 'string' }, description: 'Restrict to these regions.' },
          practiceIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these practice ids.' },
          group_by: { type: 'string', enum: ['group', 'region', 'practice'], description: 'Aggregation level (default group).' },
        },
      },
    },
    run: runQueryRefunds,
  },
  {
    definition: {
      name: 'compare',
      description: 'Compare a metric between two periods at group, region or practice level, sorted by biggest fall first. Use for "biggest drop vs last month" and "compare region X with the others".',
      input_schema: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['revenue', 'conversion', 'contactLens'] },
          group_by: { type: 'string', enum: ['group', 'region', 'practice'] },
          period_a: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], description: 'Current period (YYYY-MM).' },
          period_b: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], description: 'Previous period (YYYY-MM).' },
          regions: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number', description: 'Max rows (default 10).' },
        },
        required: ['metric', 'group_by', 'period_a', 'period_b'],
      },
    },
    run: runCompare,
  },
  {
    definition: {
      name: 'compare_practices',
      description:
        'Compare two or more named practices head to head: revenue against target, conversion, contact lens against target, training, and revenue since last month. Use this whenever the question compares practices with each other (for example "compare Bath with Warwick" or "how do our five weakest stores stack up"). It draws a comparison card with one line per metric and a picker for which metrics are shown. The card carries every figure, so keep the written answer to one or two short sentences: what stands out and nothing more.',
      input_schema: {
        type: 'object',
        properties: {
          practice_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'The practices to compare, at least two, by id (e.g. "P001") or by name (e.g. "Bath").',
          },
          month: { type: 'string', description: MONTH_DESC },
        },
        required: ['practice_ids'],
      },
    },
    run: runComparePractices,
  },
  {
    definition: {
      name: 'training_status',
      description: 'Training completion by practice, including missing and overdue modules. Use for "which practices haven\'t completed their training?".',
      input_schema: {
        type: 'object',
        properties: {
          regions: { type: 'array', items: { type: 'string' } },
          practiceIds: { type: 'array', items: { type: 'string' } },
          only_incomplete: { type: 'boolean', description: 'Only practices with gaps.' },
        },
      },
    },
    run: runTrainingStatus,
  },
  {
    definition: {
      name: 'rank_attention',
      description: 'Rank practices by how much they need attention, with the evidence behind each position. Use for "which practices need the most attention?".',
      input_schema: {
        type: 'object',
        properties: {
          regions: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number', description: 'Number of practices (default 8).' },
        },
      },
    },
    run: runRankAttention,
  },
  {
    definition: {
      name: 'today_priorities',
      description: "The five priorities to look at today: one region-level item if a region is clearly underperforming, then the best practice for each distinct issue (sales decline, contact lens below target, training).",
      input_schema: {
        type: 'object',
        properties: { month: { type: 'string', description: MONTH_DESC } },
      },
    },
    run: runTodayPriorities,
  },
  {
    definition: {
      name: 'get_practice',
      description: 'Full context for one practice: region, manager, mentor, revenue, conversion, contact lens and training.',
      input_schema: {
        type: 'object',
        properties: { practice_id: { type: 'string', description: 'Practice id (e.g. P001) or name (e.g. Chorlton).' } },
        required: ['practice_id'],
      },
    },
    run: runGetPractice,
  },
  {
    definition: {
      name: 'below_cl_target',
      description: 'Practices whose contact-lens revenue is below target, worst first. Use for "which practices are below their contact lens target?".',
      input_schema: {
        type: 'object',
        properties: {
          month: { type: 'string', description: MONTH_DESC },
          threshold: { type: 'number', description: 'Attainment percent below which a practice counts (default 90).' },
          regions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    run: runBelowClTarget,
  },
  {
    definition: {
      name: 'refund_anomalies',
      description:
        'Practices whose refunds look unusual this month, worst first, each with the evidence behind the flag: a spike against the practice\'s own usual level, a refund rate above 1.0% of revenue, goodwill above £50 without the regional lead recorded, or gestures clustered just under £50. Use for "which practices have unusual refunds?" and after query_refunds reports flags. Reporting the pattern is fine; never invent a cause for it.',
      input_schema: {
        type: 'object',
        properties: {
          regions: { type: 'array', items: { type: 'string' } },
          practiceIds: { type: 'array', items: { type: 'string' }, description: 'Restrict to these practice ids.' },
          limit: { type: 'number', description: 'Max rows (default 8).' },
        },
      },
    },
    run: runRefundAnomalies,
  },
  {
    definition: {
      name: 'highlight_on_map',
      description: 'Return the practice ids to highlight on the map and a table describing them. Use after identifying a set of practices ("show those on the map").',
      input_schema: {
        type: 'object',
        properties: { practice_ids: { type: 'array', items: { type: 'string' } } },
        required: ['practice_ids'],
      },
    },
    run: runHighlightOnMap,
  },
  {
    definition: {
      name: 'build_dashboard',
      description: 'Build a dashboard: KPI cards plus a chart per metric, optionally grouped by region or practice. Use for "create a dashboard showing X".',
      input_schema: {
        type: 'object',
        properties: {
          metrics: { type: 'array', items: { type: 'string', enum: ['revenue', 'conversion', 'contactLens', 'exams', 'target'] }, description: 'Metrics to chart.' },
          group_by: { type: 'string', enum: ['group', 'region', 'practice'] },
          filters: { type: 'object', properties: { regions: { type: 'array', items: { type: 'string' } }, practiceIds: { type: 'array', items: { type: 'string' } } } },
          period: { type: 'object', properties: { month: { type: 'string' } } },
        },
        required: ['metrics', 'group_by'],
      },
    },
    run: runBuildDashboard,
  },
];

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.definition.name === name);
}

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map((tool) => tool.definition);

/** The same tools in OpenAI chat-completions function-calling format. */
export function llmToolDefinitions(): LlmToolDefinition[] {
  return TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: tool.definition.input_schema,
    },
  }));
}
