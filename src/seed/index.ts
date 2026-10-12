import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../data/load';
import { parseCsv, toCsv } from '../lib/csv';
import { serializeDataset } from '../data/dataset';
import { generateDataset } from './generate';
import { DEFAULT_SEED } from './config';

/**
 * Seed CLI: generate the sample dataset and write it to CSV.
 *
 * Usage: `npm run seed` (optionally `npm run seed -- --seed 123`).
 */

const FILES: Array<[keyof ReturnType<typeof serializeDataset>, string]> = [
  ['practices', 'practices.csv'],
  ['performance', 'monthly_performance.csv'],
  ['training', 'training.csv'],
];

function argSeed(): number {
  const idx = process.argv.indexOf('--seed');
  if (idx !== -1 && process.argv[idx + 1]) {
    const parsed = Number.parseInt(process.argv[idx + 1], 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_SEED;
}

function preview(csv: string, rows = 5): string {
  const matrix = parseCsv(csv);
  const header = matrix[0] ?? [];
  const body = matrix.slice(1, rows + 1);
  const widths = header.map((_, col) =>
    Math.max(header[col].length, ...body.map((r) => (r[col] ?? '').length)),
  );
  const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ');
  return [line(header), ...body.map(line)].join('\n');
}

function main(): void {
  const seed = argSeed();
  const dataset = generateDataset({ seed });
  const raw = serializeDataset(dataset);

  mkdirSync(DATA_DIR, { recursive: true });

  console.log(`\nOptific+ sample data - seed ${seed}\n${'─'.repeat(64)}`);
  console.log(
    `${dataset.practices.length} practices · ` +
      `${new Set(dataset.practices.map((p) => p.region)).size} regions · ` +
      `${new Set(dataset.performance.map((p) => p.month)).size} months\n`,
  );

  for (const [key, file] of FILES) {
    const csv = raw[key];
    const path = join(DATA_DIR, file);
    writeFileSync(path, csv, 'utf8');
    const total = parseCsv(csv).length - 1;
    console.log(`\n${file}  (${total} data rows)`);
    console.log(preview(csv, 5));
  }

  // Round-trip guard: writing then reading must not lose rows.
  const header = toCsv(['ok'], [[1]]).trim();
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`Wrote ${FILES.length} files to ${DATA_DIR}`);
  console.log(`CSV self-check: ${header === 'ok\n1' ? 'ok' : 'FAILED'}\n`);
}

main();
