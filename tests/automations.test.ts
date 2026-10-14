import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/seed/generate';
import { today_priorities } from '../src/data/today';
import { composeBrief, defaultSkills, JOBS, resolveRecipients } from '../src/automations/catalog';
import { evaluateWatch, sanitizeRunRequest } from '../src/automations/engine';

/**
 * The automations layer quotes the data layer, so these tests assert the same
 * planted stories the rest of the suite does: eight contact-lens practices,
 * four overdue training modules, and a brief that is the Today list verbatim.
 */

const dataset = generateDataset();
const today = today_priorities(dataset);

describe('automation catalogue', () => {
  it('seeds three skills, every one backed by a real job', () => {
    const skills = defaultSkills();
    expect(skills).toHaveLength(3);
    for (const skill of skills) {
      expect(JOBS.some((job) => job.key === skill.job)).toBe(true);
      expect(skill.enabled).toBe(true);
    }
    expect(skills.map((skill) => skill.job)).toEqual(['brief', 'watch-cl', 'watch-training']);
  });

  it('every job carries a sentence, a cadence and recipients', () => {
    for (const job of JOBS) {
      expect(job.sentence.length).toBeGreaterThan(20);
      expect(job.cadence.length).toBeGreaterThan(0);
      const anyRecipient =
        job.defaultRecipients.group || job.defaultRecipients.regionLeads || job.defaultRecipients.mentors;
      expect(anyRecipient).toBe(true);
    }
  });

  it('resolves real people for a scope, from the seed directory', () => {
    const northWestLeads = resolveRecipients({ group: false, regionLeads: true, mentors: false }, ['North West']);
    expect(northWestLeads.map((person) => person.name)).toEqual(['Emma Lawson']);

    const northWestMentors = resolveRecipients({ group: false, regionLeads: false, mentors: true }, ['North West']);
    expect(northWestMentors.map((person) => person.name)).toEqual(['Alex Morgan']);

    const everyone = resolveRecipients({ group: true, regionLeads: true, mentors: true }, []);
    expect(everyone).toHaveLength(1 + 5 + 4);
    expect(everyone.map((person) => person.name)).toEqual(
      expect.arrayContaining(['Sara Kelly', 'Emma Lawson', 'James Bennett', 'Sophie Clarke', 'Priya Nair']),
    );
  });

  it('composes the brief without touching a single figure', () => {
    const items = composeBrief(today);
    expect(items).toHaveLength(5);
    for (let index = 0; index < items.length; index += 1) {
      const source = today.items[index];
      expect(items[index].title).toBe(source.title);
      expect(items[index].summary).toBe(source.summary);
      expect(items[index].metricValue).toBe(source.metric.value);
      expect(items[index].metricComparison).toBe(source.metric.comparison);
      expect(items[index].question).toMatch(/^Why is /);
    }
  });
});

describe('watch evaluation', () => {
  it('finds exactly the eight contact-lens practices from the planted story', () => {
    const hits = evaluateWatch(dataset, 'watch-cl', []);
    expect(hits).toHaveLength(8);
    expect(hits.map((hit) => hit.name)).toContain('Chorlton');
    for (const hit of hits) {
      expect(hit.evidence).toContain('Contact lens');
      expect(hit.headline).toMatch(/%$/);
      expect(hit.caption).toBe('of target');
      expect(hit.manager.length).toBeGreaterThan(0);
    }
  });

  it('finds four overdue-training practices with the modules named', () => {
    const hits = evaluateWatch(dataset, 'watch-training', []);
    expect(hits).toHaveLength(4);
    for (const hit of hits) {
      expect(hit.evidence).toMatch(/past the due date/);
    }
  });

  it('scopes a watch to a region', () => {
    const hits = evaluateWatch(dataset, 'watch-cl', ['North West']);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.region).toBe('North West');
    expect(hits.map((hit) => hit.name)).toContain('Chorlton');
  });

  it('revenue hits all quote the real revenue movement', () => {
    const hits = evaluateWatch(dataset, 'watch-revenue', []);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.evidence).toMatch(/Revenue/);
      expect(hit.headline).toMatch(/^[+-]/);
    }
  });
});

describe('run request sanitising', () => {
  const regions = ['North West', 'South East'];

  it('accepts a valid request and drops unknown regions', () => {
    expect(sanitizeRunRequest({ job: 'watch-cl' }, regions)).toEqual({ job: 'watch-cl', regions: [] });
    expect(sanitizeRunRequest({ job: 'watch-cl', regions: ['North West', 'Atlantis'] }, regions)).toEqual({
      job: 'watch-cl',
      regions: ['North West'],
    });
  });

  it('rejects the brief, unknown jobs and malformed shapes', () => {
    expect(sanitizeRunRequest({ job: 'brief' }, regions)).toBeNull();
    expect(sanitizeRunRequest({ job: 'watch-weather' }, regions)).toBeNull();
    expect(sanitizeRunRequest({ job: 'watch-cl', regions: 'North West' }, regions)).toBeNull();
    expect(sanitizeRunRequest(null, regions)).toBeNull();
    expect(sanitizeRunRequest('watch-cl', regions)).toBeNull();
  });
});
