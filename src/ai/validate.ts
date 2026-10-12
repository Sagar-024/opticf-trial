import type { Dataset } from '../data/index';
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
