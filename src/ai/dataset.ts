import { loadDatasetFromDir, type Dataset } from '../data/index';

/**
 * The dataset is loaded once per server process and shared by every tool.
 * Server-only (reads the generated CSVs from disk).
 */
let cached: Dataset | null = null;

export function getDataset(): Dataset {
  if (!cached) cached = loadDatasetFromDir();
  return cached;
}
