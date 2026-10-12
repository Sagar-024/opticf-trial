/**
 * Minimal, dependency-free CSV reader/writer.
 *
 * Handles quoted fields, escaped quotes (`""`), and both LF and CRLF line
 * endings. Kept deliberately small and pure so it can be unit-tested and reused
 * on both the seed side (writing) and the app side (parsing).
 */

/** Parse CSV text into a matrix of string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  // Normalise CRLF -> LF so the parser only deals with one newline shape.
  const src = text.replace(/\r\n?/g, '\n');

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the final field/row unless the text ended on a newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // Drop a trailing empty row produced by a final newline.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
  }
  return rows;
}

/** Parse CSV text into row objects keyed by the header row. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((key, idx) => {
      obj[key] = cells[idx] ?? '';
    });
    return obj;
  });
}

function escapeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const needsQuotes = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Serialise a header + rows into CSV text with LF line endings. */
export function toCsv(header: string[], rows: Array<Array<string | number | boolean>>): string {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
