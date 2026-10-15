import { MENTORS, REGIONS } from '@/seed/config';

/** A person work can go to, resolved from the seed directory. */
export interface Person {
  name: string;
  role: string;
}

/**
 * The leadership directory: group leadership, the five region leads and the
 * four mentors, all from the seed so names have one source of truth. Practice
 * managers arrive with their practice's findings, so they are not duplicated
 * here. Used by the task form and by sending a report.
 */
export const LEADERSHIP: Person[] = [
  { name: 'Sara Kelly', role: 'group leadership' },
  ...REGIONS.map((region) => ({ name: region.lead, role: `${region.name} lead` })),
  ...MENTORS.map((mentor) => ({ name: mentor.name, role: 'mentor' })),
];
