import type { Dataset } from '../domain/types';
import { monthLabel } from '../lib/months';
import { monthsOf } from './dataset';
import { compare } from './compare';
import { query_metrics } from './metrics';
import { rank_attention, type AttentionRow } from './attention';

/**
 * `today_priorities` - the five things worth looking at today.
 *
 * Rules that make the list useful rather than repetitive:
 *  1. At most one region-level item, and only if a region is clearly
 *     underperforming on both revenue and conversion.
 *  2. Then the best practice for each distinct primary issue
 *     (sales decline → contact lens below target → training).
 *  3. A maximum of two items from any one region, and no practice twice.
 *  4. Always exactly five items (filling with the next-best practices).
 *
 * Every string is pre-formatted here so the UI and the LLM only ever quote it.
 */

export type PracticeIssue = 'sales-decline' | 'cl-below-target' | 'training';
export type TodayIssue = 'region-underperformance' | PracticeIssue;

export interface MapView {
  lens: 'performance' | 'contactLens' | 'training';
  regions?: string[];
  practiceIds?: string[];
  attentionOnly?: boolean;
}

export interface DashboardQuery {
  metrics: string[];
  group_by: 'group' | 'region' | 'practice';
  filters: { regions?: string[]; practiceIds?: string[] };
  period: { month: string };
}

export interface TodayPriority {
  id: string;
  kind: 'region' | 'practice';
  issue: TodayIssue;
  /** Short headline. */
  title: string;
  /** One-line "what needs attention". */
  summary: string;
  metric: { label: string; value: string; comparison: string };
  /** Pre-formatted evidence strings. */
  evidence: string[];
  region?: string;
  practiceId?: string;
  mapView: MapView;
  dashboardQuery: DashboardQuery;
}

export interface TodayPriorities {
  month: string;
  monthLabel: string;
  items: TodayPriority[];
}

const MAX_ITEMS = 5;
const MAX_PER_REGION = 2;
const ISSUE_ORDER: PracticeIssue[] = ['sales-decline', 'cl-below-target', 'training'];

const ISSUE_TITLE: Record<PracticeIssue, string> = {
  'sales-decline': 'revenue is falling',
  'cl-below-target': 'contact lens below target',
  training: 'required training incomplete',
};

const ISSUE_LENS: Record<PracticeIssue, MapView['lens']> = {
  'sales-decline': 'performance',
  'cl-below-target': 'contactLens',
  training: 'training',
};

const ISSUE_METRICS: Record<PracticeIssue, string[]> = {
  'sales-decline': ['revenue', 'conversion'],
  'cl-below-target': ['contactLens', 'revenue'],
  training: ['revenue'],
};

/** Which category a practice's signals point at most strongly. */
function primaryIssue(row: AttentionRow): PracticeIssue | null {
  const points: Record<PracticeIssue, number> = { 'sales-decline': 0, 'cl-below-target': 0, training: 0 };
  for (const signal of row.signals) {
    const cat: PracticeIssue = signal.code === 'cl-below-target'
      ? 'cl-below-target'
      : signal.code.startsWith('training')
        ? 'training'
        : 'sales-decline';
    points[cat] += signal.points;
  }
  let best: PracticeIssue | null = null;
  let bestPoints = 0;
  for (const issue of ISSUE_ORDER) {
    if (points[issue] > bestPoints) {
      best = issue;
      bestPoints = points[issue];
    }
  }
  return best;
}

function practiceMetric(row: AttentionRow, issue: PracticeIssue): TodayPriority['metric'] {
  switch (issue) {
    case 'sales-decline':
      return { label: 'Revenue', value: row.stats.revenueDisplay, comparison: `${row.stats.revenueMoMDisplay} vs previous month` };
    case 'cl-below-target':
      return { label: 'Contact lens', value: row.stats.clAttainmentDisplay, comparison: 'of target' };
    case 'training':
      return { label: 'Training', value: row.stats.trainingCompletionDisplay, comparison: 'of required modules' };
  }
}

/** Build the Today priority list for a month (defaults to the latest). */
export function today_priorities(dataset: Dataset, month?: string): TodayPriorities {
  const months = monthsOf(dataset);
  const target = month && months.includes(month) ? month : months[months.length - 1];
  const prevIndex = months.indexOf(target) - 1;
  const previous = prevIndex >= 0 ? months[prevIndex] : target;

  const items: TodayPriority[] = [];
  const usedPractice = new Set<string>();
  const regionCount = new Map<string, number>();
  const canAddRegion = (region: string) => (regionCount.get(region) ?? 0) < MAX_PER_REGION;
  const noteRegion = (region: string) => regionCount.set(region, (regionCount.get(region) ?? 0) + 1);

  // ── 1. Region-level item, only if revenue AND conversion are falling ───────
  const revenueByRegion = compare(dataset, {
    metric: 'revenue',
    groupBy: 'region',
    periodA: { from: target, to: target },
    periodB: { from: previous, to: previous },
    sort: 'delta-asc',
  });
  const conversionByRegion = compare(dataset, {
    metric: 'conversion',
    groupBy: 'region',
    periodA: { from: target, to: target },
    periodB: { from: previous, to: previous },
    sort: 'delta-asc',
  });
  const conversionByLabel = new Map(conversionByRegion.rows.map((r) => [r.label, r]));

  const weakest = revenueByRegion.rows.find(
    (row) => row.deltaPct !== null && row.deltaPct < -1 && (conversionByLabel.get(row.label)?.delta ?? 0) < 0,
  );

  if (weakest) {
    const conversion = conversionByLabel.get(weakest.label)!;
    const scope = query_metrics(dataset, { regions: [weakest.label], month: target });
    items.push({
      id: `region-${weakest.label}`,
      kind: 'region',
      issue: 'region-underperformance',
      title: `${weakest.label} - revenue and conversion both falling`,
      summary: `${weakest.label} revenue fell ${weakest.deltaDisplay} and conversion dropped ${conversion.deltaDisplay}; it is the weakest region in the group.`,
      metric: { label: 'Revenue', value: weakest.currentDisplay, comparison: `${weakest.deltaDisplay} vs ${revenueByRegion.periodBLabel}` },
      evidence: [
        `${weakest.label} revenue ${weakest.currentDisplay} in ${revenueByRegion.periodALabel}, ${weakest.deltaDisplay} against ${weakest.previousDisplay}.`,
        `${weakest.label} conversion ${conversion.currentDisplay}, ${conversion.deltaDisplay} against ${conversion.previousDisplay}.`,
        `Region revenue attainment ${scope.revenue.attainmentDisplay} of plan.`,
      ],
      region: weakest.label,
      mapView: { lens: 'performance', regions: [weakest.label], attentionOnly: true },
      dashboardQuery: {
        metrics: ['revenue', 'conversion'],
        group_by: 'practice',
        filters: { regions: [weakest.label] },
        period: { month: target },
      },
    });
    noteRegion(weakest.label);
  }

  // ── 2. Practice items ──────────────────────────────────────────────────────
  const attention = rank_attention(dataset);
  const issueByPractice = new Map<string, PracticeIssue | null>();
  for (const row of attention) issueByPractice.set(row.practiceId, primaryIssue(row));

  const pick = (predicate: (row: AttentionRow) => boolean): AttentionRow | undefined =>
    attention.find((row) => !usedPractice.has(row.practiceId) && canAddRegion(row.region) && predicate(row));

  const pushPractice = (row: AttentionRow, issue: PracticeIssue): void => {
    usedPractice.add(row.practiceId);
    noteRegion(row.region);
    const top = row.signals[0];
    items.push({
      id: `practice-${row.practiceId}`,
      kind: 'practice',
      issue,
      title: `${row.name} - ${ISSUE_TITLE[issue]}`,
      summary: top?.evidence ?? `${row.name} needs review.`,
      metric: practiceMetric(row, issue),
      evidence: row.signals.map((s) => s.evidence),
      practiceId: row.practiceId,
      region: row.region,
      mapView: { lens: ISSUE_LENS[issue], practiceIds: [row.practiceId], attentionOnly: false },
      dashboardQuery: {
        metrics: ISSUE_METRICS[issue],
        group_by: 'practice',
        filters: { practiceIds: [row.practiceId] },
        period: { month: target },
      },
    });
  };

  // Pass 1 - one practice per distinct issue, best first.
  for (const issue of ISSUE_ORDER) {
    const row = pick((r) => issueByPractice.get(r.practiceId) === issue);
    if (row) pushPractice(row, issue);
  }
  // Pass 2 - fill to five with the next-best practices, still respecting the cap.
  let guard = 0;
  while (items.length < MAX_ITEMS && guard < attention.length) {
    guard += 1;
    const row = attention.find((r) => !usedPractice.has(r.practiceId) && canAddRegion(r.region));
    if (!row) break;
    pushPractice(row, issueByPractice.get(row.practiceId) ?? 'sales-decline');
  }
  // Pass 3 - fallback: relax the region cap (never repeat a practice).
  guard = 0;
  while (items.length < MAX_ITEMS && guard < attention.length) {
    guard += 1;
    const row = attention.find((r) => !usedPractice.has(r.practiceId));
    if (!row) break;
    pushPractice(row, issueByPractice.get(row.practiceId) ?? 'sales-decline');
  }

  return { month: target, monthLabel: monthLabel(target), items };
}
