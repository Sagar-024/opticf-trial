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
import type { WatchHit, WatchJobKey } from './types';

/** Which attention signal each watch listens to. */
export const WATCH_SIGNAL: Record<WatchJobKey, AttentionSignalCode> = {
  'watch-cl': 'cl-below-target',
  'watch-conversion': 'conversion-decline',
  'watch-revenue': 'revenue-decline',
  'watch-training': 'training-overdue',
};

/** The headline figure for a hit, straight from the attention stats. */
function headlineFor(job: WatchJobKey, row: AttentionRow): { value: string; caption: string } {
  switch (job) {
    case 'watch-cl':
      return { value: row.stats.clAttainmentDisplay, caption: 'of target' };
    case 'watch-conversion':
      return { value: row.stats.conversionMoMDisplay, caption: `vs ${row.stats.latestMonthLabel}` };
    case 'watch-revenue':
      return { value: row.stats.revenueMoMDisplay, caption: `vs ${row.stats.latestMonthLabel}` };
    case 'watch-training':
      return { value: row.stats.trainingCompletionDisplay, caption: 'complete' };
  }
}

/**
 * Every practice the condition currently catches, worst first, with the
 * evidence sentence behind the catch.
 */
export function evaluateWatch(dataset: Dataset, job: WatchJobKey, regions: string[]): WatchHit[] {
  const rows = rank_attention(dataset, regions.length > 0 ? { regions } : {});
  const code = WATCH_SIGNAL[job];
  const hits: WatchHit[] = [];

  for (const row of rows) {
    const signal = row.signals.find((s) => s.code === code);
    if (!signal) continue;
    const headline = headlineFor(job, row);
    hits.push({
      practiceId: row.practiceId,
      name: row.name,
      region: row.region,
      manager: row.manager,
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

const WATCH_JOBS: WatchJobKey[] = ['watch-cl', 'watch-conversion', 'watch-revenue', 'watch-training'];

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
