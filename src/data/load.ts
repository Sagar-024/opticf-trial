import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dataset, RawDataset } from '../domain/types';
import { parseDataset } from './dataset';

/** Default location of the generated CSV files. */
export const DATA_DIR = join(process.cwd(), 'data');

const FILES: Array<[keyof RawDataset, string]> = [
  ['practices', 'practices.csv'],
  ['performance', 'monthly_performance.csv'],
  ['training', 'training.csv'],
  ['refunds', 'refunds.csv'],
];

/**
 * The one filesystem touch-point in the data layer. Node/server-only.
 * Everything downstream is pure and takes an already-loaded Dataset.
 */
export function loadDatasetFromDir(dir: string = DATA_DIR): Dataset {
  const raw = {} as RawDataset;
  for (const [key, file] of FILES) {
    raw[key] = readFileSync(join(dir, file), 'utf8');
  }
  return parseDataset(raw);
}
