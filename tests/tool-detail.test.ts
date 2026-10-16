import { describe, expect, it } from 'vitest';
import { toolStep } from '../src/ai/tool-detail';

describe('the live trace step detail', () => {
  it('counts and names the notes search_brain really returned', () => {
    // Shape copied from runSearchBrain: the guidance table plus one source per document.
    const output = {
      summary: 'Found 3 guidance documents for "warranty".',
      widgets: [
        {
          type: 'table',
          id: 'brain-table',
          title: 'Guidance found in the Brain',
          columns: ['Section', 'Guidance', 'Owner', 'Reviewed', 'Scope'],
          rows: [
            ['Operations', 'Frame warranty procedure', 'Practice Support', '2026-10-07', 'Group guidance'],
            ['Operations', 'Practice performance review guide', 'Practice Mentoring', '2026-10-07', 'Group guidance'],
            ['Finance & Claims', 'Refunds and goodwill authority', 'Finance Support', '2026-10-02', 'Group guidance'],
          ],
        },
      ],
      sources: [
        'Brain: Frame warranty procedure',
        'Brain: Practice performance review guide',
        'Brain: Refunds and goodwill authority',
      ],
      numbers: [],
    };
    expect(toolStep('search_brain', { query: 'warranty' }, output)).toEqual({
      detail: 'Found 3 notes in your saved notes',
      items: ['Frame warranty procedure', 'Practice performance review guide', 'Refunds and goodwill authority'],
    });
  });

  it('names the practice get_practice resolved', () => {
    // Shape copied from runGetPractice: the context table is titled "<name> - context".
    const output = {
      summary: 'Chorlton (North West), manager ...',
      widgets: [
        { type: 'kpi', id: 'practice-kpi', title: 'Chorlton - Oct 2026', items: [] },
        {
          type: 'table',
          id: 'practice-table',
          title: 'Chorlton - context',
          columns: ['Field', 'Value'],
          rows: [['Region', 'North West']],
        },
      ],
      sources: ['Practice directory'],
      numbers: [],
    };
    expect(toolStep('get_practice', { practice_id: 'P001' }, output)).toEqual({
      detail: 'Looked up Chorlton',
      items: [],
    });
  });

  it('counts the practices rank_attention ranked', () => {
    // Shape copied from runRankAttention: one table row per ranked practice.
    const output = {
      summary: 'Top 3 practices by need, in order.',
      widgets: [
        {
          type: 'table',
          id: 'attention-table',
          title: 'Practices ranked by need',
          columns: ['Practice', 'Region', 'Why'],
          rows: [
            ['Bristol', 'South West', 'Revenue down 8.2%'],
            ['Chorlton', 'North West', 'Conversion down 1.4pp'],
            ['Stockport', 'North West', 'Below contact lens target'],
          ],
        },
      ],
      numbers: [],
    };
    expect(toolStep('rank_attention', { limit: 3 }, output)).toEqual({
      detail: 'Ranked 3 practices by need',
      items: ['Bristol', 'Chorlton', 'Stockport'],
    });
  });

  it('keeps the plain label for tools without a detail', () => {
    expect(toolStep('build_dashboard', { metrics: ['revenue'] }, { widgets: [] })).toEqual({});
  });

  it('never throws on empty or odd shapes', () => {
    expect(() => {
      toolStep('search_brain', null, null);
      toolStep('query_metrics', undefined, []);
      toolStep('compare', 42, 'not an output');
      toolStep('today_priorities', {}, { widgets: [{ type: 'table', id: 'today-table', rows: 'nope' }] });
      toolStep('below_cl_target', {}, {});
    }).not.toThrow();
  });
});
