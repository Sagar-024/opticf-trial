import { describe, expect, it } from 'vitest';
import { sourcePhrase, toolLabel, toolSources } from '../src/lib/tool-labels';

describe('the provenance line', () => {
  it('names the sources a run actually touched, data first', () => {
    expect(toolSources(['search_brain', 'get_practice'])).toEqual(['data', 'notes']);
    expect(toolSources(['search_brain'])).toEqual(['notes']);
    expect(toolSources(['build_dashboard', 'highlight_on_map'])).toEqual([]);
  });

  it('phrases the sources in plain words', () => {
    expect(sourcePhrase(['query_metrics'])).toBe('your practice data');
    expect(sourcePhrase(['search_brain'])).toBe('your saved notes');
    expect(sourcePhrase(['query_metrics', 'search_brain', 'query_metrics'])).toBe(
      'your practice data and your saved notes',
    );
    expect(sourcePhrase(['build_dashboard'])).toBeNull();
  });

  it('keeps the step labels readable by a non technical reader', () => {
    expect(toolLabel('search_brain')).toBe('checking your saved notes');
    expect(toolLabel('build_dashboard')).toBe('building the chart');
  });
});
