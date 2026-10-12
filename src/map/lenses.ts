import type { MapPractice } from '../data/map-model';

/**
 * The map lenses. Each lens is a pure function of a practice, plus a legend and
 * optional filter presets. Lenses never touch the canvas; they return palette
 * keys which the paint layer resolves to real colours for the current theme.
 */

export type LensId = 'region' | 'sales' | 'contactLens' | 'training' | 'mentors';

export type PaletteKey =
  | 'coral'
  | 'amber'
  | 'green'
  | 'blue'
  | 'ink'
  | 'muted'
  | 'chart1'
  | 'chart2'
  | 'chart3'
  | 'chart4'
  | 'chart5';

export interface LensVisual {
  colorKey: PaletteKey;
  opacity: number;
  /** Multiplies the base radius so a lens can emphasise severity. */
  sizeFactor: number;
  /** Draw a ring around matching practices. */
  ring?: boolean;
}

export interface LensFilter {
  id: string;
  label: string;
  match: (practice: MapPractice) => boolean;
}

export interface Lens {
  id: LensId;
  label: string;
  question: string;
  legend: Array<{ colorKey: PaletteKey; label: string }>;
  filters: LensFilter[];
  visual: (practice: MapPractice) => LensVisual;
  valueLabel: (practice: MapPractice) => string;
}

const REGION_COLOR_KEYS: PaletteKey[] = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'];
const MENTOR_COLOR_KEYS: PaletteKey[] = ['chart1', 'chart2', 'chart3', 'chart4'];

const ALL_FILTER: LensFilter = { id: 'all', label: 'All practices', match: () => true };

export interface LensContext {
  regions: string[];
  mentors: Array<{ mentorId: string; name: string }>;
}

export function regionColorKey(region: string, regions: string[]): PaletteKey {
  const index = regions.indexOf(region);
  return REGION_COLOR_KEYS[(index >= 0 ? index : 0) % REGION_COLOR_KEYS.length];
}

export function buildLenses(context: LensContext): Lens[] {
  const { regions, mentors } = context;

  return [
    {
      id: 'region',
      label: 'Region',
      question: 'Where is each practice, and how do the regions compare?',
      legend: regions.map((region) => ({ colorKey: regionColorKey(region, regions), label: region })),
      filters: [ALL_FILTER],
      visual: (practice) => ({ colorKey: regionColorKey(practice.region, regions), opacity: 1, sizeFactor: 1 }),
      valueLabel: (practice) => practice.region,
    },
    {
      id: 'sales',
      label: 'Sales',
      question: 'Which practices are selling well, and which are falling?',
      legend: [
        { colorKey: 'coral', label: 'Falling' },
        { colorKey: 'amber', label: 'Watch' },
        { colorKey: 'green', label: 'On track' },
      ],
      filters: [
        ALL_FILTER,
        { id: 'attention', label: 'Needs attention', match: (p) => p.attentionScore >= 25 },
        { id: 'declining', label: 'Revenue falling', match: (p) => p.revenueMoMPct <= -3 },
        { id: 'below-target', label: 'Below revenue target', match: (p) => p.revenueAttainmentPct < 95 },
      ],
      visual: (practice) => {
        if (practice.attentionBand === 'high' || practice.revenueMoMPct <= -3 || practice.revenueAttainmentPct < 85) {
          return { colorKey: 'coral', opacity: 1, sizeFactor: 1 + practice.attentionScore / 100 };
        }
        if (practice.revenueMoMPct < 0 || practice.revenueAttainmentPct < 95) {
          return { colorKey: 'amber', opacity: 1, sizeFactor: 1 + practice.attentionScore / 100 };
        }
        return { colorKey: 'green', opacity: 1, sizeFactor: 1 + practice.attentionScore / 100 };
      },
      valueLabel: (practice) => `${practice.revenueDisplay} (${practice.revenueMoMDisplay})`,
    },
    {
      id: 'contactLens',
      label: 'Contact lens',
      question: 'Which practices are missing their contact lens target?',
      legend: [
        { colorKey: 'coral', label: 'Below 90% of target' },
        { colorKey: 'amber', label: 'Just below target' },
        { colorKey: 'green', label: 'At or above target' },
      ],
      filters: [
        ALL_FILTER,
        { id: 'below-90', label: 'Below 90% of target', match: (p) => p.clAttainmentPct < 90 },
        { id: 'below-target', label: 'Below target', match: (p) => p.clAttainmentPct < 100 },
      ],
      visual: (practice) => {
        if (practice.clAttainmentPct < 90) return { colorKey: 'coral', opacity: 1, sizeFactor: 1.15 };
        if (practice.clAttainmentPct < 100) return { colorKey: 'amber', opacity: 1, sizeFactor: 1 };
        return { colorKey: 'green', opacity: 1, sizeFactor: 1 };
      },
      valueLabel: (practice) => `${practice.clAttainmentDisplay} of target`,
    },
    {
      id: 'training',
      label: 'Training',
      question: 'Who has not completed their required training?',
      legend: [
        { colorKey: 'coral', label: 'Overdue' },
        { colorKey: 'amber', label: 'Incomplete' },
        { colorKey: 'green', label: 'Complete' },
      ],
      filters: [
        ALL_FILTER,
        { id: 'incomplete', label: 'Training incomplete', match: (p) => p.trainingCompletionPct < 100 },
        { id: 'overdue', label: 'Training overdue', match: (p) => p.trainingOverdue > 0 },
      ],
      visual: (practice) => {
        if (practice.trainingStatus === 'overdue') return { colorKey: 'coral', opacity: 1, sizeFactor: 1.2 };
        if (practice.trainingStatus === 'incomplete') return { colorKey: 'amber', opacity: 1, sizeFactor: 1.1 };
        return { colorKey: 'green', opacity: 1, sizeFactor: 1 };
      },
      valueLabel: (practice) => `${practice.trainingCompletionDisplay} complete`,
    },
    {
      id: 'mentors',
      label: 'Mentors',
      question: 'Which practices does each mentor support, and how are they doing?',
      legend: mentors.map((mentor, index) => ({
        colorKey: MENTOR_COLOR_KEYS[index % MENTOR_COLOR_KEYS.length],
        label: mentor.name,
      })),
      filters: [
        ALL_FILTER,
        ...mentors.map((mentor) => ({
          id: `mentor-${mentor.mentorId}`,
          label: mentor.name,
          match: (p: MapPractice) => p.mentorId === mentor.mentorId,
        })),
      ],
      visual: (practice) => {
        const index = mentors.findIndex((mentor) => mentor.mentorId === practice.mentorId);
        if (index < 0) return { colorKey: 'muted', opacity: 0.8, sizeFactor: 1 };
        return { colorKey: MENTOR_COLOR_KEYS[index % MENTOR_COLOR_KEYS.length], opacity: 1, sizeFactor: 1 };
      },
      valueLabel: (practice) => practice.mentorName,
    },
  ];
}

export function lensById(lenses: Lens[], id: LensId): Lens {
  return lenses.find((lens) => lens.id === id) ?? lenses[0];
}

export function filterById(lens: Lens, id: string): LensFilter {
  return lens.filters.find((filter) => filter.id === id) ?? ALL_FILTER;
}

/**
 * Tooltip lines for a practice under a lens.
 *
 * De-duplicated on purpose: on the Region lens the lens value is the region,
 * which is already the first line. Duplicate strings previously broke the React
 * keys in the tooltip, so this is covered by a test.
 */
export function tooltipLines(practice: MapPractice, lens: Lens): string[] {
  return [
    practice.region,
    `${practice.revenueDisplay} (${practice.revenueMoMDisplay})`,
    lens.valueLabel(practice),
  ].filter((line, index, all) => line.length > 0 && all.indexOf(line) === index);
}
