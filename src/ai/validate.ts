import type { Dataset } from '../data/index';
import { BRAIN_DOCUMENTS } from '../content/brain';
import type { ChatContext, ChatMessage } from './types';

/**
 * Input validation for the chat route.
 *
 * The client sends both the conversation and the previous analytical context.
 * Both are untrusted: the context is injected into the system prompt, so
 * anything that reaches it must be whitelisted against the dataset. Unknown
 * regions or practice ids are dropped, free text is stripped to a safe charset
 * and capped, and nothing outside these shapes can reach the model.
 */

const MAX_MESSAGES = 40;
const MAX_CONTENT = 4000;
const ALLOWED_GROUP_BY = ['group', 'region', 'practice'];

export type ValidationResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string; status: number };

export function validateMessages(raw: unknown): ValidationResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'messages[] is required.', status: 400 };
  }
  if (raw.length > MAX_MESSAGES) {
    return { ok: false, error: `Too many messages (max ${MAX_MESSAGES}).`, status: 400 };
  }

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'Each message must be an object.', status: 400 };
    }
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') {
      return { ok: false, error: 'Message role must be "user" or "assistant".', status: 400 };
    }
    if (typeof content !== 'string') {
      return { ok: false, error: 'Message content must be a string.', status: 400 };
    }
    if (content.length > MAX_CONTENT) {
      return { ok: false, error: `Message too long (max ${MAX_CONTENT} characters).`, status: 400 };
    }
    messages.push({ role, content });
  }
  return { ok: true, messages };
}

/** Metrics are single tokens like `revenue+conversion`; nothing else is allowed. */
function safeMetric(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z+]{1,40}$/.test(value) ? value : undefined;
}

/** A local edit to a guidance document, sent from the Brain tab. */
export interface BrainOverride {
  content?: string;
  owner?: string;
  conflict?: boolean;
}

/** Reject anything that is not a JSON body, and anything unreasonably large. */
export function isJsonRequest(contentType: string | null): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

export const MAX_BODY_BYTES = 256 * 1024;

export function isBodyTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const bytes = Number.parseInt(contentLength, 10);
  return Number.isFinite(bytes) && bytes > MAX_BODY_BYTES;
}

/**
 * Tool arguments come from the model, so they are treated as untrusted input:
 * unknown keys are dropped, numbers are clamped, arrays are capped, and month
 * strings must look like months. This is the boundary between the model and our
 * pure functions.
 */
export function sanitizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(key)) continue;

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = Math.max(-1_000_000, Math.min(1_000_000, value));
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed.length > 120) continue;
      out[key] = trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const items = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 60))
        .filter((item) => item.length > 0)
        .slice(0, 50);
      if (items.length > 0) out[key] = items;
      continue;
    }
    // Nested objects are used by a couple of tools; keep one level, primitive only.
    if (value && typeof value === 'object') {
      const nested = sanitizeToolInput(value);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}

/** Month keys must look like `YYYY-MM`; anything else is dropped. */
export function sanitizeMonth(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * Guidance edits are the one piece of user content that reaches the model, so
 * they are treated as untrusted: ids must exist, text is capped, and the owner
 * field is restricted to a safe character set.
 */
export function sanitizeBrainOverrides(raw: unknown): Record<string, BrainOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const known = new Set(BRAIN_DOCUMENTS.map((document) => document.id));

  const out: Record<string, BrainOverride> = {};
  let accepted = 0;

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (accepted >= 50) break;
    if (!known.has(id)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const source = value as Record<string, unknown>;
    const override: BrainOverride = {};
    if (typeof source.content === 'string') override.content = source.content.slice(0, 4000);
    if (typeof source.owner === 'string') {
      override.owner = source.owner.replace(/[^\w\s&.,'-]/g, '').trim().slice(0, 100);
    }
    if (typeof source.conflict === 'boolean') override.conflict = source.conflict;

    if (Object.keys(override).length > 0) {
      out[id] = override;
      accepted += 1;
    }
  }

  return out;
}

/** Drop anything that is not a known region or practice id in the dataset. */
export function sanitizeContext(raw: unknown, dataset: Dataset): ChatContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const knownRegions = new Set(dataset.practices.map((p) => p.region));
  const knownPractices = new Set(dataset.practices.map((p) => p.practiceId));

  const out: ChatContext = { filters: {}, period: {}, practiceIds: [] };

  const metric = safeMetric(input.metric);
  if (metric) out.metric = metric;

  if (typeof input.group_by === 'string' && ALLOWED_GROUP_BY.includes(input.group_by)) {
    out.group_by = input.group_by as ChatContext['group_by'];
  }

  const filters = input.filters;
  if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
    const f = filters as Record<string, unknown>;
    if (Array.isArray(f.regions)) {
      const regions = f.regions.filter((r): r is string => typeof r === 'string' && knownRegions.has(r)).slice(0, 10);
      if (regions.length > 0) out.filters.regions = regions;
    }
    if (Array.isArray(f.practiceIds)) {
      const ids = f.practiceIds.filter((p): p is string => typeof p === 'string' && knownPractices.has(p)).slice(0, 50);
      if (ids.length > 0) out.filters.practiceIds = ids;
    }
  }

  const period = input.period;
  if (period && typeof period === 'object' && !Array.isArray(period)) {
    const month = (period as Record<string, unknown>).month;
    if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) out.period.month = month;
  }

  if (Array.isArray(input.practiceIds)) {
    out.practiceIds = input.practiceIds
      .filter((p): p is string => typeof p === 'string' && knownPractices.has(p))
      .slice(0, 50);
  }

  return out;
}
