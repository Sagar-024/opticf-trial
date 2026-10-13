/**
 * Model markup scrubbing.
 *
 * DeepSeek family models normally return tool calls in the structured
 * `tool_calls` field. Some gateways and some streaming paths instead leave the
 * model's internal markup in the content string, so the user sees raw markup
 * like `<|DSML|tool_calls>` or `<｜tool▁calls▁begin｜>` or a `<tool_call>` XML
 * block with the arguments as JSON.
 *
 * This module does three jobs:
 *   1. `MarkupStreamFilter` removes markup from a token stream, without leaving
 *      half a tag on screen while the rest is still in flight.
 *   2. `stripModelMarkup` removes markup from a complete string.
 *   3. `extractLeakedToolCalls` recovers the tool call the model was trying to
 *      make, so a leaked call can still be executed instead of becoming an
 *      error. Recovered arguments go through the same sanitiser as a native
 *      call before any tool runs.
 */

export interface MarkupStripResult {
  text: string;
  /** True when anything was removed. */
  stripped: boolean;
  /** Which markup families were seen, for logging. */
  families: string[];
}

export interface SalvagedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** U+FF5C, the full width vertical bar used by DeepSeek control tokens. */
const FULLWIDTH_BAR = '\uFF5C';

/** A block that never closes cannot swallow the rest of the answer forever. */
const MAX_BLOCK_CHARS = 24_000;

/** Longer than this and a dangling `<` is prose, not a tag being streamed. */
const MAX_PARTIAL_TAG = 400;

const ASCII_TAG = /<\|[^<>]*>/;
const ASCII_CLOSE = /<\/\|[^<>]*>/;
const FULLWIDTH_TAG = /<｜[^<>]*｜>/;
const XML_TAG = /<\/?(?:tool_calls?|function_calls?|tool_use|invoke|parameter|tool_code|antml:invoke|antml:parameter|minimax:tool_call|dsml:[\w-]+)\b[^<>]*>/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface OpenerHit {
  index: number;
  match: string;
  kind: 'ascii' | 'fullwidth' | 'xml';
}

function findEarliestOpener(text: string): OpenerHit | null {
  const hits: OpenerHit[] = [];
  for (const [regex, kind] of [
    [ASCII_CLOSE, 'ascii'],
    [ASCII_TAG, 'ascii'],
    [FULLWIDTH_TAG, 'fullwidth'],
    [XML_TAG, 'xml'],
  ] as Array<[RegExp, OpenerHit['kind']]>) {
    const match = text.match(regex);
    if (match && match.index !== undefined) hits.push({ index: match.index, match: match[0], kind });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index || b.match.length - a.match.length);
  return hits[0];
}

/**
 * The closer for a block opened by this tag, or null when the tag should just
 * be dropped on its own (a stray closer, a self closing tag, an end token).
 */
function blockCloserFor(tag: string): RegExp | null {
  if (tag.startsWith('</') || tag.endsWith('/>')) return null;

  // Full width control tokens: <｜tool▁calls▁begin｜> ... <｜tool▁calls▁end｜>
  if (tag.includes(FULLWIDTH_BAR)) {
    if (/end/i.test(tag) && !/begin/i.test(tag)) return null;
    const end = tag.replace(/begin/i, 'end');
    return end !== tag
      ? new RegExp(escapeRegExp(end))
      : /<｜[^<>]*｜>/;
  }

  // ASCII pipe tags: <|DSML|tool_calls> ... </|DSML|tool_calls>
  if (tag.startsWith('<|')) {
    if (/end/i.test(tag) && !/begin/i.test(tag)) return null;
    const end = tag.replace(/begin/i, 'end');
    if (end !== tag) return new RegExp(escapeRegExp(end));
    return /<\/\|[^<>]*>/;
  }

  // XML tags: <tool_call ...> ... </tool_call>, namespaced names included.
  const name = /^<\s*([\w:.-]+)/.exec(tag)?.[1];
  if (!name) return null;
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  const alternative = local !== name ? `|${escapeRegExp(local)}` : '';
  return new RegExp(`</\\s*(?:${escapeRegExp(name)}${alternative})\\b[^<>]*>`, 'i');
}

/** Start index of a trailing tag that has not finished arriving yet. */
function partialTagStart(buffer: string): number {
  const candidates = [buffer.lastIndexOf('<'), buffer.lastIndexOf(FULLWIDTH_BAR)].filter((index) => index !== -1);
  if (candidates.length === 0) return buffer.length;
  const start = Math.max(...candidates);
  const tail = buffer.slice(start);
  if (tail.length > MAX_PARTIAL_TAG) return buffer.length;
  if (tail.includes('>')) return buffer.length;
  // A lone opening bracket is the start of a tag being streamed.
  if (tail === '<' || tail === '</') return start;
  // Definitely markup, only the closing bracket is missing: <|, <｜, <tool, </tool, </|.
  if (/^<\/?(?:\||｜|[A-Za-z_])/.test(tail)) return start;
  // A full width token that somehow lost its opening bracket.
  if (/^｜[A-Za-z_]/.test(tail)) return start;
  return buffer.length;
}

/** Hold back a trailing unfinished tag so it never flashes on screen. */
export function trimTrailingPartialTag(text: string): string {
  const start = partialTagStart(text);
  return start === text.length ? text : text.slice(0, start);
}

export class MarkupStreamFilter {
  private buffer = '';
  private inBlock = false;
  private closer: RegExp | null = null;
  private strippedAny = false;
  private readonly seen = new Set<string>();

  get stripped(): boolean {
    return this.strippedAny;
  }

  get families(): string[] {
    return [...this.seen];
  }

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';

    for (let guard = 0; guard < 64; guard += 1) {
      if (this.inBlock) {
        const closer = this.closer;
        const match = closer ? this.buffer.match(closer) : null;
        if (!match || match.index === undefined) {
          // The block may still be arriving. Drop what we hold, and give up on
          // it entirely if it grows without end.
          if (this.buffer.length > MAX_BLOCK_CHARS) {
            this.buffer = '';
            this.inBlock = false;
            this.closer = null;
          }
          return out;
        }
        this.buffer = this.buffer.slice(match.index + match[0].length);
        this.inBlock = false;
        this.closer = null;
        continue;
      }

      const found = findEarliestOpener(this.buffer);
      if (!found) {
        const hold = partialTagStart(this.buffer);
        out += this.buffer.slice(0, hold);
        this.buffer = this.buffer.slice(hold);
        if (this.buffer.length > MAX_PARTIAL_TAG) {
          // Not a tag after all; let it through rather than hold forever.
          out += this.buffer;
          this.buffer = '';
        }
        return out;
      }

      out += this.buffer.slice(0, found.index);
      this.strippedAny = true;
      this.seen.add(found.kind);

      const closer = blockCloserFor(found.match);
      this.buffer = this.buffer.slice(found.index + found.match.length);
      if (closer) {
        this.inBlock = true;
        this.closer = closer;
      }
    }

    return out;
  }

  /** End of stream: drop an unclosed block or dangling half tag. */
  flush(): string {
    if (this.inBlock) {
      this.buffer = '';
      this.inBlock = false;
      this.closer = null;
      return '';
    }
    const held = this.buffer;
    this.buffer = '';
    const keep = partialTagStart(held);
    return held.slice(0, keep);
  }
}

/** Scan a balanced JSON object starting at `start`. */
function scanJsonObject(text: string, start: number): { end: number; value: unknown } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return { end: index + 1, value: JSON.parse(text.slice(start, index + 1)) };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function looksLikeToolCallObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return false;
  return 'arguments' in record || 'parameters' in record || 'input' in record;
}

/**
 * Remove standalone `{"name": "...", "arguments": {...}}` JSON objects that
 * some models emit instead of a tool call. Prose that merely contains braces is
 * left alone: the object must have the tool call shape.
 */
export function stripStandaloneJsonCalls(text: string): { text: string; stripped: boolean } {
  let out = text;
  let stripped = false;
  for (let index = 0; index < out.length; index += 1) {
    if (out[index] !== '{') continue;
    const scanned = scanJsonObject(out, index);
    if (!scanned || !looksLikeToolCallObject(scanned.value)) continue;
    out = out.slice(0, index) + out.slice(scanned.end);
    out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    stripped = true;
    index = Math.max(index - 1, -1);
  }
  return { text: out, stripped };
}

/** Remove every known markup family from a complete string. */
export function stripModelMarkup(text: string): MarkupStripResult {
  const filter = new MarkupStreamFilter();
  let out = filter.push(text) + filter.flush();
  const json = stripStandaloneJsonCalls(out);
  if (json.stripped) out = json.text;
  const families = [...filter.families];
  if (json.stripped) families.push('json');
  return { text: out, stripped: filter.stripped || json.stripped, families };
}

/** Cheap test used by the interface before it decides to show a fallback. */
export function containsModelMarkup(text: string): boolean {
  return stripModelMarkup(text).stripped;
}

function coerceParameter(value: string): unknown {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Recover tool calls that arrived as text. Only calls naming a tool the current
 * turn was allowed to use are returned, and the arguments stay in their raw
 * JSON form so the standard sanitiser is the only thing that touches them.
 */
export function extractLeakedToolCalls(text: string, knownTools?: ReadonlySet<string>): SalvagedToolCall[] {
  const calls: SalvagedToolCall[] = [];
  const MAX_CALLS = 4;

  const accept = (name: unknown, rawArguments: unknown): void => {
    if (calls.length >= MAX_CALLS) return;
    if (typeof name !== 'string' || name.length === 0) return;
    if (knownTools && !knownTools.has(name)) return;

    let value: Record<string, unknown>;
    if (typeof rawArguments === 'string') {
      try {
        const parsed = JSON.parse(rawArguments);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        value = parsed as Record<string, unknown>;
      } catch {
        return;
      }
    } else if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
      value = rawArguments as Record<string, unknown>;
    } else {
      return;
    }

    const argumentsJson = JSON.stringify(value);
    if (calls.some((call) => call.name === name && call.arguments === argumentsJson)) return;
    calls.push({ id: `leaked_${calls.length}`, name, arguments: argumentsJson });
  };

  // 1. XML blocks holding JSON: <tool_call>{"name": ..., "arguments": {...}}</tool_call>
  for (const block of text.matchAll(/<(?:tool_call|tool_calls|function_call|function_calls)\b[^<>]*>([\s\S]*?)<\/(?:tool_call|tool_calls|function_call|function_calls)>/gi)) {
    const body = block[1].trim();
    if (!body) continue;
    try {
      const parsed: unknown = JSON.parse(body);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (looksLikeToolCallObject(item)) {
          const record = item;
          accept(record.name, record.arguments ?? record.parameters ?? record.input);
        }
      }
    } catch {
      // Not JSON; the DSML pattern below may still match.
    }
  }

  // 2. DSML invoke blocks with parameters.
  for (const block of text.matchAll(/<\|DSML\|invoke\s+name="([^"]+)"[^<>]*>([\s\S]*?)<\/\|DSML\|invoke>/gi)) {
    const args: Record<string, unknown> = {};
    for (const param of block[2].matchAll(/<\|DSML\|parameter\s+name="([^"]+)"[^<>]*>([\s\S]*?)<\/\|DSML\|parameter>/gi)) {
      args[param[1]] = coerceParameter(param[2]);
    }
    const body = block[2].replace(/<\|DSML\|parameter\s+name="[^"]+"[^<>]*>[\s\S]*?<\/\|DSML\|parameter>/gi, '').trim();
    if (body && Object.keys(args).length === 0) {
      accept(block[1], body);
    } else {
      accept(block[1], args);
    }
  }

  // 3. Standalone JSON objects anywhere in the text.
  let index = text.indexOf('{');
  while (index !== -1 && calls.length < MAX_CALLS) {
    const scanned = scanJsonObject(text, index);
    if (scanned && looksLikeToolCallObject(scanned.value)) {
      const record = scanned.value;
      accept(record.name, record.arguments ?? record.parameters ?? record.input);
      index = scanned.end;
      continue;
    }
    index = text.indexOf('{', index + 1);
  }

  return calls;
}
