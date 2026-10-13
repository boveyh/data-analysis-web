/* =============================================================================
 * xlsx.js — Excel (.xlsx / .xlsm) reading and writing.
 *
 * Built on the vendored SheetJS *mini* build in js/vendor/. The library is
 * ~245 KB, so it is loaded lazily: a page that never opens a workbook never
 * pays for it, and the first paint stays free of the dependency. It ships in
 * the repo, so the feature works fully offline — there is deliberately no CDN
 * fallback, which means no network requirement at all.
 *
 * SCOPE — this is the mini build, not the full one. Per the SheetJS docs it
 * reads and writes XLSX correctly but has no BIFF (legacy .xls), XLSB, ODS,
 * Numbers or SpreadsheetML 2003 support. The UI therefore advertises
 * .xlsx/.xlsm only, which is what it can actually honour. (`XLSX.write` with
 * bookType 'xls' throws "write_xlscfb is not defined" — verified.)
 *
 * Everything here is pure conversion. No upload, no parsing on a server.
 * ========================================================================== */

import { matrixToColumns } from './parse.js';

const SRC = './js/vendor/xlsx.mini.min.js';

/** Extensions we can genuinely open. Keep in sync with the file input accept. */
export const WORKBOOK_EXT = /\.(xlsx|xlsm)$/i;
export const isWorkbookFile = (name) => WORKBOOK_EXT.test(String(name || ''));

let pending = null;

/**
 * Resolve with the global `XLSX`, or `null` if the script could not be loaded.
 *
 * Resolve-only, never reject: a rejected promise here would surface as an
 * unhandled rejection and, worse, leave the caller unable to distinguish
 * "still loading" from "broken". The only trustworthy success signal is the
 * global actually appearing — `onload` also fires for an HTTP 200 carrying an
 * error body (the same trap ECharts sets).
 */
export function loadXLSX() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const settle = () => {
      const lib = typeof window !== 'undefined' ? window.XLSX : null;
      // a failed load must not be cached, or one bad moment would disable the
      // feature for the rest of the session
      if (!lib) pending = null;
      resolve(lib || null);
    };
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = settle;
    s.onerror = settle;
    document.head.appendChild(s);
  });
  return pending;
}

/* ------------------------------ cell values ------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/** Excel dates come back as JS Dates (cellDates) — render them ISO-ish. */
function isoLocal(d) {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clock = d.getHours() || d.getMinutes() || d.getSeconds()
    ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : '';
  return day + clock;
}

/**
 * Flatten one cell into the string-ish scalar the rest of the engine expects.
 *
 * `matrixToColumns` is shared with the CSV reader, which only ever sees text,
 * so numbers are stringified here and let the engine's own type inference do
 * the work. Dates are the one case that must not be stringified naively —
 * `String(new Date())` yields "Mon Oct 12 2026 …", which nothing can parse.
 */
function cellToText(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoLocal(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

/* ------------------------------- reading --------------------------------- */

export const sheetNames = (wb) => (wb && wb.SheetNames ? wb.SheetNames.slice() : []);

/** Parse a Uint8Array into a SheetJS workbook. Throws on a malformed file. */
export function readWorkbook(XLSX, bytes) {
  return XLSX.read(bytes, {
    type: 'array',
    /* dates as Dates rather than serial numbers: a "date" column arriving as
       45678 is the single most common way an Excel import goes wrong */
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
}

/**
 * One sheet -> {columns, data}. Returns null for an empty or missing sheet.
 *
 * `blankrows: false` drops rows that are entirely empty. Excel sheets routinely
 * carry hundreds of trailing blank rows (from stray formatting), and importing
 * those as all-null records would swamp the frame.
 */
export function sheetToColumns(XLSX, wb, name) {
  const ws = wb && wb.Sheets ? wb.Sheets[name] : null;
  if (!ws) return null;
  let rows;
  try {
    rows = XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: true, defval: null, blankrows: false,
    });
  } catch {
    return null;
  }
  if (!rows || !rows.length) return null;
  /* Row 0 is taken as the header, matching pd.read_excel's default. */
  return matrixToColumns(rows.map((r) => (Array.isArray(r) ? r.map(cellToText) : [])));
}

/* ------------------------------- writing --------------------------------- */

/* Excel's own limits: 31 characters, and none of : \ / ? * [ ] */
const BAD_SHEET_CHARS = /[:\\/?*[\]]/g;

function safeSheetName(name, taken) {
  let s = String(name || 'Sheet').replace(BAD_SHEET_CHARS, '_').trim().slice(0, 31);
  if (!s) s = 'Sheet';
  let out = s, n = 2;
  while (taken.has(out.toLowerCase())) {
    const suffix = ` (${n++})`;
    out = s.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(out.toLowerCase());
  return out;
}

/** `value` is left as-is when numeric so Excel gets real numbers, not text. */
function cellOut(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return Number.isFinite(v) || typeof v === 'boolean' ? v : null;
  return String(v);
}

/**
 * Build a workbook from [{name, rows}] and return a Uint8Array.
 *
 * Rows are arrays-of-arrays; numbers stay numbers so the result behaves like a
 * spreadsheet rather than a CSV in disguise.
 */
export function writeWorkbook(XLSX, sheets) {
  const wb = XLSX.utils.book_new();
  const taken = new Set();
  for (const s of sheets) {
    if (!s || !s.rows || !s.rows.length) continue;
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map(cellOut)));
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.name, taken));
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}
