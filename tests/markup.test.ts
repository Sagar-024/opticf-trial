import { describe, expect, it } from 'vitest';
import {
  containsModelMarkup,
  extractLeakedToolCalls,
  MarkupStreamFilter,
  stripModelMarkup,
  stripStandaloneJsonCalls,
  trimTrailingPartialTag,
} from '../src/ai/markup';

const DSML_BLOCK = [
  '<|DSML|tool_calls>',
  '<|DSML|invoke name="query_metrics">',
  '<|DSML|parameter name="month">2026-10</|DSML|parameter>',
  '</|DSML|invoke>',
  '</|DSML|tool_calls>',
].join('\n');

const FULLWIDTH_BLOCK = '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>query_metrics<｜tool▁sep｜>{"month":"2026-10"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>';

describe('markup stripping', () => {
  it('removes an ASCII DSML tool call block', () => {
    const result = stripModelMarkup(`Looking now.\n${DSML_BLOCK}\nDone.`);
    expect(result.stripped).toBe(true);
    expect(result.text).toContain('Looking now.');
    expect(result.text).toContain('Done.');
    expect(result.text).not.toContain('DSML');
    expect(result.text).not.toContain('query_metrics');
    expect(result.families).toContain('ascii');
  });

  it('removes a full width control token block', () => {
    const result = stripModelMarkup(`Here: ${FULLWIDTH_BLOCK}`);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe('Here: ');
    expect(result.families).toContain('fullwidth');
  });

  it('removes an XML tool call block containing JSON', () => {
    const xml = '<tool_call>{"name":"query_metrics","arguments":{"month":"2026-10"}}</tool_call>';
    const result = stripModelMarkup(`Before ${xml} after`);
    expect(result.text).toBe('Before  after');
    expect(result.text).not.toContain('query_metrics');
    expect(result.families).toContain('xml');
  });

  it('removes stray control tokens on their own', () => {
    expect(stripModelMarkup('Hello <|end_of_sentence|> world').text).toBe('Hello  world');
    expect(stripModelMarkup('Hello <｜end▁of▁sentence｜> world').text).toBe('Hello  world');
    expect(stripModelMarkup('Answer.<tool_code></tool_code>').text).toBe('Answer.');
  });

  it('removes a standalone JSON tool call object', () => {
    const result = stripStandaloneJsonCalls('Sure: {"name": "query_metrics", "arguments": {"month": "2026-10"}} that is all.');
    expect(result.stripped).toBe(true);
    expect(result.text).not.toContain('query_metrics');
    expect(result.text).toContain('that is all.');
  });

  it('leaves ordinary prose alone, including angle brackets and pipes', () => {
    const prose = 'Revenue was £746,430, up 3 < 5 and a | b. See P047 for detail.';
    const result = stripModelMarkup(prose);
    expect(result.stripped).toBe(false);
    expect(result.text).toBe(prose);
    expect(containsModelMarkup(prose)).toBe(false);
  });

  it('does not mistake a JSON object without tool call shape for a call', () => {
    const result = stripStandaloneJsonCalls('The payload was {"month": "2026-10", "limit": 5}.');
    expect(result.stripped).toBe(false);
  });
});

describe('markup stream filter', () => {
  it('removes a block split across many small chunks', () => {
    const filter = new MarkupStreamFilter();
    const source = `North West fell. ${DSML_BLOCK} That is the summary.`;
    let out = '';
    for (const char of source) out += filter.push(char);
    out += filter.flush();
    expect(out).toContain('North West fell.');
    expect(out).toContain('That is the summary.');
    expect(out).not.toContain('DSML');
    expect(out).not.toContain('2026-10');
    expect(filter.stripped).toBe(true);
  });

  it('holds a half arrived tag so it never flashes, then drops it', () => {
    const filter = new MarkupStreamFilter();
    expect(filter.push('hello <tool_ca')).toBe('hello ');
    expect(filter.push('ll>{"name":"query_metrics"}')).toBe('');
    expect(filter.push('</tool_call> world')).toBe(' world');
    expect(filter.flush()).toBe('');
  });

  it('drops an unclosed block at the end of the stream', () => {
    const filter = new MarkupStreamFilter();
    const out = filter.push('Ok. <|DSML|tool_calls>never closes') + filter.flush();
    expect(out).toBe('Ok. ');
  });

  it('keeps a comparison sign and a pipe in normal prose', () => {
    const filter = new MarkupStreamFilter();
    const out = filter.push('capacity is 3 < 5 and use a | b') + filter.flush();
    expect(out).toBe('capacity is 3 < 5 and use a | b');
  });

  it('trims a trailing partial tag from display text', () => {
    expect(trimTrailingPartialTag('hello <tool_ca')).toBe('hello ');
    expect(trimTrailingPartialTag('hello <')).toBe('hello ');
    expect(trimTrailingPartialTag('hello |')).toBe('hello |');
  });
});

describe('quote marker stripping', () => {
  it('removes the triple angle markers around quoted guidance', () => {
    const result = stripModelMarkup('It states that <<<record the reason and the amount>>> on the patient record.');
    expect(result.stripped).toBe(true);
    expect(result.text).toBe('It states that record the reason and the amount on the patient record.');
    expect(result.families).toContain('quote-marker');
  });

  it('removes markers split across chunks without flashing one', () => {
    const filter = new MarkupStreamFilter();
    let out = '';
    out += filter.push('Up to 50 pounds ');
    out += filter.push('<<');
    out += filter.push('<Practice managers may authorise');
    out += filter.push('>>>');
    out += filter.push(' and above that needs the lead');
    out += filter.flush();
    expect(out).toBe('Up to 50 pounds Practice managers may authorise and above that needs the lead');
    expect(filter.stripped).toBe(true);
    expect(filter.families).toContain('quote-marker');
  });

  it('releases a lone angle bracket that never becomes a marker', () => {
    const filter = new MarkupStreamFilter();
    let out = filter.push('capacity is 3 <');
    out += filter.push(' 5');
    out += filter.flush();
    expect(out).toBe('capacity is 3 < 5');

    const tail = new MarkupStreamFilter();
    expect(tail.push('over 95% >') + tail.flush()).toBe('over 95% >');
  });

  it('leaves ordinary prose with angle brackets and pipes untouched', () => {
    const prose = '3 < 5 and a | b, no markers here.';
    const result = stripModelMarkup(prose);
    expect(result.stripped).toBe(false);
    expect(result.text).toBe(prose);
  });
});

describe('leaked tool call recovery', () => {
  const known = new Set(['query_metrics', 'compare']);

  it('recovers a DSML invoke with parameters', () => {
    const calls = extractLeakedToolCalls(DSML_BLOCK, known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('query_metrics');
    expect(JSON.parse(calls[0].arguments)).toEqual({ month: '2026-10' });
  });

  it('coerces numeric and boolean parameter values', () => {
    const block = [
      '<|DSML|tool_calls>',
      '<|DSML|invoke name="compare">',
      '<|DSML|parameter name="limit">5</|DSML|parameter>',
      '<|DSML|parameter name="metric">revenue</|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|tool_calls>',
    ].join('\n');
    const calls = extractLeakedToolCalls(block, known);
    expect(JSON.parse(calls[0].arguments)).toEqual({ limit: 5, metric: 'revenue' });
  });

  it('recovers a JSON call inside an XML block, including an array of calls', () => {
    const single = '<tool_call>{"name":"query_metrics","arguments":{"month":"2026-10"}}</tool_call>';
    expect(extractLeakedToolCalls(single, known)).toHaveLength(1);

    const list = '<tool_calls>[{"name":"query_metrics","arguments":{}},{"name":"compare","arguments":{}}]</tool_calls>';
    const calls = extractLeakedToolCalls(list, known);
    expect(calls.map((call) => call.name)).toEqual(['query_metrics', 'compare']);
  });

  it('recovers a standalone JSON call object', () => {
    const calls = extractLeakedToolCalls('Sure {"name": "query_metrics", "arguments": {"month": "2026-10"}}', known);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('query_metrics');
  });

  it('refuses a call to a tool that is not known', () => {
    const unknown = '<tool_call>{"name":"drop_database","arguments":{}}</tool_call>';
    expect(extractLeakedToolCalls(unknown, known)).toHaveLength(0);
    expect(extractLeakedToolCalls(unknown)).toHaveLength(1);
  });

  it('does not duplicate an identical call', () => {
    const text = `${DSML_BLOCK}\n${DSML_BLOCK}`;
    const calls = extractLeakedToolCalls(text, known);
    expect(calls).toHaveLength(1);
  });
});
