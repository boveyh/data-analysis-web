/* =============================================================================
 * parse.js — dependency-free CSV / TSV / JSON readers.
 * Handles quoted fields, escaped quotes, CRLF, BOM and duplicate headers.
 * ========================================================================== */

/** Guess the delimiter from the first non-empty line. */
export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',', bestCount = -1;
  for (const d of candidates) {
    let count = 0, inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) count++;
    }
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/** RFC-4180-ish delimited-text parser. Returns a 2-D array of strings. */
export function parseDelimited(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQ = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === d) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/** Turn a 2-D string matrix into {columns, data} (column-oriented). */
export function matrixToColumns(rows) {
  if (!rows.length) return null;
  const header = rows[0].map((h, i) => {
    const v = String(h ?? '').trim();
    return v || `col_${i + 1}`;
  });

  // de-duplicate header names the way pandas does: a, a.1, a.2
  const seen = new Map();
  const columns = header.map((name) => {
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    return n === 0 ? name : `${name}.${n}`;
  });

  const data = {};
  for (const c of columns) data[c] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < columns.length; c++) {
      const v = row[c];
      /* The CSV reader only ever produces strings, but the Excel path hands us
         `null` for a blank cell and can hand us other scalars. Normalise before
         trimming: the previous `v.trim()` on a null cell threw, and one blank
         cell is enough to fail the entire import. */
      if (v === undefined || v === null) { data[columns[c]].push(null); continue; }
      const s = (typeof v === 'string' ? v : String(v)).trim();
      data[columns[c]].push(s === '' ? null : s);
    }
  }
  return { columns, data };
}

/** Parse a JSON array of records (or {data:[...]} / {rows:[...]} wrappers). */
export function parseJSONRecords(text) {
  let parsed = JSON.parse(text);
  if (parsed && !Array.isArray(parsed)) {
    parsed = parsed.data || parsed.rows || parsed.records || parsed.results || [parsed];
  }
  if (!Array.isArray(parsed) || !parsed.length) return null;

  if (Array.isArray(parsed[0])) return matrixToColumns(parsed);

  const columns = [];
  for (const rec of parsed) {
    if (rec && typeof rec === 'object') {
      for (const k of Object.keys(rec)) if (!columns.includes(k)) columns.push(k);
    }
  }
  if (!columns.length) return null;

  const data = {};
  for (const c of columns) {
    data[c] = parsed.map((rec) => {
      const v = rec ? rec[c] : null;
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
  }
  return { columns, data };
}

/** Entry point: pick a parser from the file name / content shape. */
export function parseText(text, filename = '') {
  const name = filename.toLowerCase();
  const trimmed = text.trim();
  if (name.endsWith('.json') || (!name.endsWith('.csv') && !name.endsWith('.tsv') &&
      (trimmed.startsWith('[') || trimmed.startsWith('{')))) {
    try { return parseJSONRecords(text); } catch { /* fall through to CSV */ }
  }
  const delim = name.endsWith('.tsv') ? '\t' : undefined;
  return matrixToColumns(parseDelimited(text, delim));
}
