import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, toCsv } from '../src/lib/csv';

describe('csv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields, embedded commas and escaped quotes', () => {
    const csv = 'name,note\n"Smith, John","He said ""hi"""\n';
    expect(parseCsv(csv)).toEqual([
      ['name', 'note'],
      ['Smith, John', 'He said "hi"'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('parses row objects keyed by header', () => {
    const rows = parseCsvObjects('id,value\nP1,10\nP2,20\n');
    expect(rows).toEqual([
      { id: 'P1', value: '10' },
      { id: 'P2', value: '20' },
    ]);
  });

  it('round-trips values that need quoting', () => {
    const csv = toCsv(['a', 'b'], [['plain', 'has,comma'], ['quote"inside', 5]]);
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['plain', 'has,comma'],
      ['quote"inside', '5'],
    ]);
  });
});
