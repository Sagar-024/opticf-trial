import type { MapPractice } from '@/data/map-model';
import { formatPercent } from '@/lib/format';

/**
 * The practice comparison model.
 *
 * Any number of practices, one row per metric. The map builds the view in the
 * browser from the MapPractice rows it already holds, and the chat tool builds
 * the same shape on the server from the dataset, so a comparison drawn in chat
 * and one drawn on the map can never disagree. Everything is pre-formatted
 * here; the card does no arithmetic and the model does no styling.
 *
 * The shape is deliberately serialisable: it crosses the wire as a widget.
 */

export interface CompareSide {
  practiceId: string;
  name: string;
  region: string;
}

export interface CompareBar {
  /** Share of the track the bar fills, 0 to 1. Change rows are signed. */
  fraction: number;
  /** The figure printed beside the bar, e.g. `97.8%` or `£99,440`. */
  display: string;
  /** The reading behind the bar, e.g. `£99,440 of a £101,700 target`. */
  detail: string;
  /** Where the bar starts: 0 for a normal bar, 0.5 for a change row. */
  origin: number;
  /** True when the bar grows left of its origin (a fall). */
  leftward?: boolean;
  /** True when there is no change at all; neither up nor down. */
  neutral?: boolean;
  /** Where this side's hairline sits, 0 to 1. Each bar carries its own target. */
  targetAt?: number;
}

export type CompareRowId = 'revenue' | 'conversion' | 'contactLens' | 'training' | 'change';

/** The rows a reader can switch on and off. `change` reads as one line. */
export const COMPARE_METRIC_IDS: CompareRowId[] = ['revenue', 'conversion', 'contactLens', 'training'];

export interface CompareRow {
  id: CompareRowId;
  label: string;
  /** The same metric in a sentence, e.g. `revenue attainment`. */
  short: string;
  /** What the row measures, in one line, for the Explain panel. */
  context: string;
  /** One bar per side, in the same order as the view's sides. */
  bars: CompareBar[];
  /** Index of the leading side, or -1 when the row is level. */
  lead: number;
  /** The gap between best and worst, pre-formatted, e.g. `3.0pp`. */
  gap: string;
  /** A change row: bars grow from the centre and the sign matters. */
  signed?: boolean;
}

export interface CompareView {
  title: string;
  month: string;
  monthLabel: string;
  sides: CompareSide[];
  rows: CompareRow[];
  /** Deterministic sentences behind the Explain toggle. */
  summary: string[];
  /** Evidence each side carries, straight from the data. */
  watch: Array<{ practiceId: string; name: string; lines: string[] }>;
  /** Rows each side leads, indexed like `sides`. */
  wins: number[];
  /** Rows where no side leads. */
  even: number;
}

/** Two readings within this of each other read as level, not a lead. */
const EVEN_EPSILON = 0.05;
/** A gap this wide earns its own line in the summary. */
const WIDEST_GAP_PP = 5;
/** How many names a sentence lists before it says "and N others". */
const NAMES_IN_PROSE = 3;

function side(practice: MapPractice): CompareSide {
  return { practiceId: practice.practiceId, name: practice.name, region: practice.region };
}

/**
 * A track top that leaves a little air above the tallest bar and lands on a
 * round number, so a hairline never sits on the edge of the track.
 */
function trackTop(...values: number[]): number {
  const top = Math.max(...values, 1) * 1.08;
  return Math.ceil(top / 10) * 10;
}

/** A symmetric change scale: minus this to plus this. */
function changeLimit(...values: number[]): number {
  const top = Math.max(...values.map(Math.abs), 0.5) * 1.15;
  if (top <= 3) return Math.ceil(top * 2) / 2;
  if (top <= 10) return Math.ceil(top);
  return Math.ceil(top / 5) * 5;
}

function pp(value: number): string {
  return `${Math.abs(value).toFixed(1)}pp`;
}

function round(value: number): string {
  return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Index of the largest value, or -1 when they are all within a hair. */
function leaderOf(values: number[]): number {
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min < EVEN_EPSILON) return -1;
  return values.indexOf(max);
}

/** Index of the smallest value, or -1 when they are all within a hair. */
function trailerOf(values: number[]): number {
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min < EVEN_EPSILON) return -1;
  return values.indexOf(min);
}

/** `Bath, Warwick and 3 others` - long lists stay short in prose. */
function nameList(sides: CompareSide[]): string {
  const names = sides.map((entry) => entry.name);
  if (names.length <= NAMES_IN_PROSE) {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  }
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

/**
 * The rows that read against a target line. Every side shares one track top,
 * so the bars are directly comparable; each bar carries its own hairline,
 * which line up when the practices share a target.
 */
function targetRow(opts: {
  id: CompareRowId;
  label: string;
  short: string;
  context: string;
  values: number[];
  targets: number[];
  display: (value: number) => string;
  detail: (practice: MapPractice) => string;
  practices: MapPractice[];
}): CompareRow {
  const top = trackTop(...opts.values, ...opts.targets);
  return {
    id: opts.id,
    label: opts.label,
    short: opts.short,
    context: opts.context,
    bars: opts.values.map((value, index) => ({
      fraction: Math.min(1, Math.max(0, value / top)),
      display: opts.display(value),
      detail: opts.detail(opts.practices[index]),
      origin: 0,
      targetAt: Math.min(1, Math.max(0, (opts.targets[index] ?? 100) / top)),
    })),
    lead: leaderOf(opts.values),
    gap: pp(Math.max(...opts.values) - Math.min(...opts.values)),
  };
}

/** The change row: signed bars grown from the centre of the track. */
function changeRow(practices: MapPractice[]): CompareRow {
  const values = practices.map((practice) => practice.revenueMoMPct);
  const limit = changeLimit(...values);
  return {
    id: 'change',
    label: 'Revenue since last month',
    short: 'revenue change',
    context: 'Change against the previous month. The centre line is no change.',
    bars: values.map((value) => ({
      fraction: Math.min(1, Math.abs(value) / (limit * 2)),
      display: value > 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`,
      detail: value > 0 ? 'up on last month' : value < 0 ? 'down on last month' : 'unchanged on last month',
      origin: 0.5,
      leftward: value < 0,
      neutral: value === 0,
    })),
    lead: leaderOf(values),
    gap: pp(Math.max(...values) - Math.min(...values)),
    signed: true,
  };
}

function revenueRow(practices: MapPractice[]): CompareRow {
  return targetRow({
    id: 'revenue',
    label: 'Revenue vs target',
    short: 'revenue attainment',
    context: '100% means the month revenue target was met.',
    values: practices.map((practice) => practice.revenueAttainmentPct),
    targets: practices.map(() => 100),
    display: (value) => `${value.toFixed(1)}%`,
    detail: (practice) => `${practice.revenueDisplay} of ${practice.revenueTargetDisplay}`,
    practices,
  });
}

function conversionRow(practices: MapPractice[]): CompareRow {
  return targetRow({
    id: 'conversion',
    label: 'Conversion',
    short: 'conversion',
    context: 'Share of examinations that led to a purchase, against the practice target.',
    values: practices.map((practice) => practice.conversionPct),
    targets: practices.map((practice) => practice.conversionTargetPct),
    display: (value) => formatPercent(value),
    detail: (practice) => `target ${formatPercent(practice.conversionTargetPct)}`,
    practices,
  });
}

function contactLensRow(practices: MapPractice[]): CompareRow {
  return targetRow({
    id: 'contactLens',
    label: 'Contact lens vs target',
    short: 'contact lens',
    context: 'Contact lens revenue against its target. Above 100% is ahead of target.',
    values: practices.map((practice) => practice.clAttainmentPct),
    targets: practices.map(() => 100),
    display: (value) => `${value.toFixed(1)}%`,
    detail: (practice) => `${practice.clActualDisplay} of ${practice.clTargetDisplay}`,
    practices,
  });
}

function trainingRow(practices: MapPractice[]): CompareRow {
  const detail = (practice: MapPractice): string => {
    if (practice.trainingOverdue > 0) return `${practice.trainingOverdue} overdue`;
    if (practice.trainingGaps.length > 0) {
      return `${practice.trainingGaps.length} module${practice.trainingGaps.length === 1 ? '' : 's'} outstanding`;
    }
    return 'all modules complete';
  };
  return targetRow({
    id: 'training',
    label: 'Training complete',
    short: 'training',
    context: 'Required training modules complete. 100% is the target.',
    values: practices.map((practice) => practice.trainingCompletionPct),
    targets: practices.map(() => 100),
    display: round,
    detail,
    practices,
  });
}

/** One row, one sentence: who leads, who trails, the gap. */
function rowLine(row: CompareRow, sides: CompareSide[]): string {
  const lead = row.lead;
  if (lead < 0) return `${capitalise(row.short)} is level: ${nameList(sides)} all sit at ${row.bars[0].display}.`;
  const trailer = trailerOf(row.bars.map((bar) => Number.parseFloat(bar.display.replace(/[^0-9.-]/g, ''))));
  if (trailer < 0 || trailer === lead) {
    return `${sides[lead].name} leads on ${row.short} at ${row.bars[lead].display}.`;
  }
  return `${sides[lead].name} leads on ${row.short}: ${row.bars[lead].display}, ahead of ${sides[trailer].name} at ${row.bars[trailer].display} (${row.gap}).`;
}

function widestGapLine(rows: CompareRow[], sides: CompareSide[]): string | null {
  let widest: { row: CompareRow; gap: number } | null = null;
  for (const row of rows) {
    if (row.signed || row.lead < 0) continue;
    const gap = Number.parseFloat(row.gap);
    if (!Number.isFinite(gap)) continue;
    if (!widest || gap > widest.gap) widest = { row, gap };
  }
  if (!widest || widest.gap < WIDEST_GAP_PP) return null;
  const row = widest.row;
  const trailer = row.bars.reduce(
    (lowest, bar, index) => (bar.fraction < row.bars[lowest].fraction ? index : lowest),
    0,
  );
  return `The widest gap is ${row.short}: ${sides[row.lead].name} reads ${row.bars[row.lead].display} against ${sides[trailer].name} at ${row.bars[trailer].display}, ${row.gap} apart.`;
}

function trainingLine(row: CompareRow, sides: CompareSide[]): string | null {
  if (row.lead < 0) return null;
  const trailer = row.bars.reduce(
    (lowest, bar, index) => (bar.fraction < row.bars[lowest].fraction ? index : lowest),
    0,
  );
  if (trailer === row.lead) return null;
  return `Training differs: ${sides[trailer].name} has ${row.bars[trailer].detail}, ${row.bars[row.lead].detail} at ${sides[row.lead].name}.`;
}

function changeLine(row: CompareRow, sides: CompareSide[]): string {
  const list = sides
    .slice(0, NAMES_IN_PROSE)
    .map((entry, index) => `${entry.name} ${row.bars[index].display}`)
    .join(', ');
  const suffix = sides.length > NAMES_IN_PROSE ? `, and ${sides.length - NAMES_IN_PROSE} more` : '';
  const allDown = row.bars.every((bar) => bar.leftward);
  const allUp = row.bars.every((bar) => !bar.leftward && !bar.neutral);
  if (allDown) return `Revenue fell at every practice since last month: ${list}${suffix}.`;
  if (allUp) return `Revenue rose at every practice since last month: ${list}${suffix}.`;
  return `Since last month: ${list}${suffix}.`;
}

/**
 * Build the whole comparison: the rows, the deterministic summary, and the
 * evidence each side already carries. Pure: same inputs, same view.
 */
export function buildCompareView(practices: MapPractice[], monthLabel: string, month: string): CompareView {
  const sides = practices.map(side);
  const rows: CompareRow[] = [
    revenueRow(practices),
    conversionRow(practices),
    contactLensRow(practices),
    trainingRow(practices),
    changeRow(practices),
  ];

  const summary = [
    rowLine(rows[0], sides),
    rowLine(rows[1], sides),
    widestGapLine(rows, sides),
    trainingLine(rows[3], sides),
    changeLine(rows[4], sides),
  ].filter((line): line is string => Boolean(line));

  const wins = sides.map(() => 0);
  let even = 0;
  for (const row of rows) {
    if (row.lead < 0) even += 1;
    else wins[row.lead] += 1;
  }

  return {
    title: sides.length === 2 ? `${sides[0].name} vs ${sides[1].name}` : `${sides.length} practices compared`,
    month,
    monthLabel,
    sides,
    rows,
    summary,
    watch: practices
      .map((practice, index) => ({
        practiceId: sides[index].practiceId,
        name: sides[index].name,
        lines: practice.attentionSignals.slice(0, 3),
      }))
      .filter((entry) => entry.lines.length > 0)
      .slice(0, 6),
    wins,
    even,
  };
}
