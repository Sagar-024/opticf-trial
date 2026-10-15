/**
 * The automation engine: evaluate a watch against the real dataset.
 *
 * Server-only: watch evaluation needs the loaded dataset, so it lives behind
 * `/api/automations/run`. Every figure in a hit is a pre-formatted string
 * copied from `rank_attention`, the same function the Today tab, the map and
 * the chat tools use. Nothing is computed here, so a watch can never disagree
 * with what the rest of the product says.
 *
 * Briefs never hit this file: they are composed on the client from the
 * `TodayPriorities` object the page already received from the server.
 */

import type { Dataset } from '../domain/types';
import { rank_attention, type AttentionRow, type AttentionSignalCode } from '../data/attention';
import { refund_findings } from '../data/refunds';
import { REGIONS } from '../seed/config';
import type { WatchHit, WatchJobKey } from './types';

/** Which attention signal each watch listens to. */
export const WATCH_SIGNAL: Record<WatchJobKey, AttentionSignalCode> = {
  'watch-cl': 'cl-below-target',
  'watch-conversion': 'conversion-decline',
  'watch-revenue': 'revenue-decline',
  'watch-refunds': 'refund-spike',
  'watch-training': 'training-overdue',
};

/**
 * The refund watch listens to every refund check, not only the spike: a
 * policy breach or a cluster under the line is worth a hit on its own.
 */
const REFUND_WATCH_CODES: AttentionSignalCode[] = [
  'refund-spike',
  'refund-rate-high',
  'goodwill-above-authority',
  'goodwill-near-threshold',
];

/** The signal a watch catches on this row, or null. */
function signalFor(job: WatchJobKey, row: AttentionRow): AttentionRow['signals'][number] | null {
  if (job === 'watch-refunds') {
    const found = REFUND_WATCH_CODES.map((code) => row.signals.find((s) => s.code === code)).find(Boolean);
    return found ?? null;
  }
  return row.signals.find((s) => s.code === WATCH_SIGNAL[job]) ?? null;
}

/** The headline figure for a hit, straight from the attention stats. */
function headlineFor(job: WatchJobKey, row: AttentionRow): { value: string; caption: string } {
  switch (job) {
    case 'watch-cl':
      return { value: row.stats.clAttainmentDisplay, caption: 'of target' };
    case 'watch-conversion':
      return { value: row.stats.conversionMoMDisplay, caption: `vs ${row.stats.latestMonthLabel}` };
    case 'watch-revenue':
      return { value: row.stats.revenueMoMDisplay, caption: `vs ${row.stats.latestMonthLabel}` };
    case 'watch-refunds':
      return { value: row.stats.refundLatestDisplay, caption: `this month, ${row.stats.refundRateDisplay} of revenue` };
    case 'watch-training':
      return { value: row.stats.trainingCompletionDisplay, caption: 'complete' };
  }
}

/**
 * Every practice the condition currently catches, worst first, with the
 * evidence sentence behind the catch.
 *
 * Refund hits route the fix by reason, following the group's own policy: a
 * gesture above the authority line escalates to the regional lead, everything
 * else stays with the practice manager.
 */
export function evaluateWatch(dataset: Dataset, job: WatchJobKey, regions: string[]): WatchHit[] {
  const rows = rank_attention(dataset, regions.length > 0 ? { regions } : {});
  const hits: WatchHit[] = [];

  const refundsByPractice = job === 'watch-refunds'
    ? new Map(refund_findings(dataset, regions.length > 0 ? { regions } : {}).map((row) => [row.practiceId, row]))
    : null;

  for (const row of rows) {
    const signal = signalFor(job, row);
    if (!signal) continue;
    const headline = headlineFor(job, row);

    let owner: WatchHit['owner'];
    const refundRow = refundsByPractice?.get(row.practiceId);
    if (refundRow?.findings.some((finding) => finding.code === 'goodwill-above-authority')) {
      const lead = REGIONS.find((region) => region.name === row.region)?.lead;
      if (lead) owner = { name: lead, role: `${row.region} lead` };
    }

    hits.push({
      practiceId: row.practiceId,
      name: row.name,
      region: row.region,
      manager: row.manager,
      ...(owner ? { owner } : {}),
      evidence: signal.evidence,
      headline: headline.value,
      caption: headline.caption,
    });
  }

  return hits;
}

export interface RunRequest {
  job: WatchJobKey;
  regions: string[];
}

const WATCH_JOBS: WatchJobKey[] = ['watch-cl', 'watch-conversion', 'watch-revenue', 'watch-refunds', 'watch-training'];

/**
 * Validate an incoming run request against the dataset's actual regions.
 * Strict on shape, lenient on membership the way the chat layer is: unknown
 * regions are dropped rather than failed, a malformed body is rejected.
 */
export function sanitizeRunRequest(input: unknown, validRegions: string[]): RunRequest | null {
  if (typeof input !== 'object' || input === null) return null;
  const body = input as { job?: unknown; regions?: unknown };

  const job = WATCH_JOBS.find((key) => key === body.job);
  if (!job) return null;

  let regions: string[] = [];
  if (body.regions !== undefined) {
    if (!Array.isArray(body.regions)) return null;
    regions = [...new Set(body.regions)]
      .filter((region): region is string => typeof region === 'string')
      .filter((region) => validRegions.includes(region))
      .slice(0, validRegions.length);
  }

  return { job, regions };
}
