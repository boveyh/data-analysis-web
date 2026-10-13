/* =============================================================================
 * parity-test.mjs — does our engine agree with real pandas?
 *
 * The whole product claim is "mirrors the pandas API", so the only meaningful
 * test is a comparison against pandas itself. But CI is a bare Node runner with
 * no Python, so the comparison is split in two:
 *
 *   tools/pandas_golden.py   runs pandas once, by hand, and freezes the answers
 *                            into tools/golden/<dataset>.json
 *   this file                re-derives every one of those answers with our own
 *                            DataFrame and asserts they match
 *
 * So this runs on every push, offline, in about a second — and a change to
 * quantile interpolation, std ddof, corr pairing or value_counts ordering will
 * fail here rather than silently shipping.
 *
 * Regenerate the golden files after a deliberate behaviour change:
 *     python tools/pandas_golden.py
 *
 * Exit code 0 when every dataset matches, 1 otherwise.
 * ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataFrame, describeSeries, quantile } from '../js/dataframe.js';
import { parseDelimited, matrixToColumns } from '../js/parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(ROOT, 'tools', 'golden');

/* Floats travel through JSON as rounded decimals, and sums over 53,940 rows
   lose a few ulps on the way, so compare relatively with an absolute floor. */
const TOL_REL = 1e-9;
const TOL_ABS = 1e-9;

let passed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) { passed++; return; }
  failures.push(detail ? `${label} — ${detail}` : label);
}

function close(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (typeof a !== 'number' || typeof b !== 'number') return String(a) === String(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const d = Math.abs(a - b);
  return d <= TOL_ABS || d <= TOL_REL * Math.max(Math.abs(a), Math.abs(b));
}

/** Compare a map of key -> number, ignoring order and tolerating float noise. */
function compareMap(label, ours, theirs, { numericKeys = true } = {}) {
  const norm = (k) => {
    const s = String(k);
    if (!numericKeys) return s;
    /* pandas stringifies floats as "1.0" where we hold "1" from the CSV text;
       canonicalise both so the key comparison is about the value, not the
       formatting of it. */
    const n = Number(s);
    return Number.isFinite(n) && s.trim() !== '' ? `#${n}` : s;
  };
  const a = new Map(Object.entries(ours).map(([k, v]) => [norm(k), v]));
  const b = new Map(Object.entries(theirs).map(([k, v]) => [norm(k), v]));
  const missing = [...b.keys()].filter((k) => !a.has(k));
  const extra = [...a.keys()].filter((k) => !b.has(k));
  const wrong = [...b.entries()].filter(([k, v]) => a.has(k) && !close(a.get(k), v));
  check(`${label}: same keys`,
    missing.length === 0 && extra.length === 0,
    `missing ${missing.slice(0, 4).join(',')} | extra ${extra.slice(0, 4).join(',')}`);
  check(`${label}: same values`,
    wrong.length === 0,
    wrong.slice(0, 3).map(([k, v]) => `${k} pandas=${v} ours=${a.get(k)}`).join(' | '));
}

/** Our dtype names are already the four the engine models. */
const dtypeName = (t) => t;

/* The one divergence we intend, pinned per column so that a *new* one still
 * fails the build.
 *
 * `pd.read_csv` does not parse dates unless asked — `parse_dates=True` is off by
 * default — so an ISO column comes back as text. We infer `date` on purpose,
 * because the app offers resample/rolling/pct-change the moment a file loads
 * and demanding an explicit cast first would be a worse product. The inference
 * changes no numeric result (everything else here still matches), so it is a
 * labelling difference, not a semantic one. */
const INTENDED_DATE_INFERENCE = new Set([
  'sales/order_date',
  'taxis/pickup',
  'taxis/dropoff',
]);

function loadFrame(name) {
  const text = fs.readFileSync(path.join(ROOT, 'data', `${name}.csv`), 'utf8');
  const p = matrixToColumns(parseDelimited(text));
  return new DataFrame(p.columns, p.data, { name: `${name}.csv` });
}

/* --------------------------------- run ---------------------------------- */

const files = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.json')).sort();
if (!files.length) {
  console.error('No golden files. Run:  python tools/pandas_golden.py');
  process.exit(1);
}

console.log('\npandas parity');
const versions = new Set();

for (const file of files) {
  const g = JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8'));
  const name = g.dataset;
  versions.add(`pandas ${g.pandas} / numpy ${g.numpy}`);
  const df = loadFrame(name);
  const tag = name;
  console.log(`  ${name}`);

  /* ---- shape and columns ---- */
  check(`${tag} shape`, df.nrows === g.shape[0] && df.ncols === g.shape[1],
    `pandas ${g.shape.join('x')} ours ${df.nrows}x${df.ncols}`);
  check(`${tag} column names`, df.colNames.join(',') === g.columns.join(','),
    `pandas ${g.columns.join(',')}`);

  /* ---- dtypes: only where the two type systems can honestly agree --------
     pandas reports int64/float64/object; we report number/string/boolean/date.
     Every divergence must be one we declared in advance. */
  const dtypeMismatch = [];
  const datePinned = new Set();
  for (const c of df.colNames) {
    if (!(c in g.dtypes)) continue;
    const ours = dtypeName(df.type(c));
    const theirs = g.dtypes[c];
    if (ours === theirs) continue;
    const key = `${name}/${c}`;
    if (ours === 'date' && theirs === 'string' && INTENDED_DATE_INFERENCE.has(key)) {
      datePinned.add(key);
      continue;
    }
    dtypeMismatch.push(`${c}: pandas=${theirs} ours=${ours}`);
  }
  check(`${tag} dtypes agree (outside the pinned date inference)`,
    dtypeMismatch.length === 0, dtypeMismatch.slice(0, 4).join(' | '));
  /* a pin that no longer matches reality is stale documentation, so fail it */
  check(`${tag} the date-inference pins are still live`,
    [...INTENDED_DATE_INFERENCE].filter((k) => k.startsWith(`${name}/`))
      .every((k) => datePinned.has(k)),
    `stale: ${[...INTENDED_DATE_INFERENCE].filter((k) => k.startsWith(`${name}/`) && !datePinned.has(k)).join(',')}`);

  /* ---- isna().sum() ---- */
  {
    const ours = {};
    for (const c of df.colNames) ours[c] = df.values(c).filter((v) => v === null || v === undefined || v === '').length;
    compareMap(`${tag} missing`, ours, g.missing, { numericKeys: false });
  }

  /* ---- nunique ---- */
  {
    const ours = {};
    for (const c of df.colNames) ours[c] = df.nunique(c);
    compareMap(`${tag} nunique`, ours, g.nunique, { numericKeys: false });
  }

  /* ---- describe(): the eight numbers the Statistics tab shows ---- */
  if (g.describe) {
    const d = df.describe();
    const mism = [];
    for (const [col, want] of Object.entries(g.describe)) {
      const got = d[col];
      if (!got) { mism.push(`${col}: missing`); continue; }
      for (const k of ['count', 'mean', 'std', 'min', 'q25', 'q50', 'q75', 'max']) {
        if (!close(got[k], want[k])) mism.push(`${col}.${k} pandas=${want[k]} ours=${got[k]}`);
      }
    }
    check(`${tag} describe()`, mism.length === 0, mism.slice(0, 4).join(' | '));
  }

  /* ---- quantile(): pins the interpolation rule ---- */
  if (g.quantiles) {
    const mism = [];
    for (const [col, want] of Object.entries(g.quantiles)) {
      const vals = df.values(col);
      for (const [qs, expect] of Object.entries(want)) {
        const got = quantile(vals, Number(qs));
        if (!close(got, expect)) mism.push(`${col}@${qs} pandas=${expect} ours=${got}`);
      }
    }
    check(`${tag} quantile()`, mism.length === 0, mism.slice(0, 4).join(' | '));
  }

  /* ---- value_counts() ---- */
  if (g.valueCounts) {
    for (const [col, want] of Object.entries(g.valueCounts)) {
      if (!df.has(col)) { check(`${tag} valueCounts(${col}) column exists`, false); continue; }
      const entries = df.valueCounts(col, { limit: Object.keys(want.top).length + 200 });
      const ours = {};
      for (const e of entries) ours[e.value] = e.count;
      compareMap(`${tag} valueCounts(${col})`, ours, want.top);
    }
  }

  /* ---- groupby(): count / sum / mean / median / min / max ---- */
  if (g.groupby) {
    const { by, value: val } = g.groupby;
    if (!df.has(by) || !df.has(val)) {
      check(`${tag} groupby columns exist`, false, `by=${by} value=${val}`);
    } else {
      const fns = ['count', 'sum', 'mean', 'median', 'min', 'max'];
      const out = df.groupby([by], fns.map((fn) => ({ col: val, fn })));
      const keys = out.values(by);
      for (const fn of fns) {
        const col = out.colNames.find((c) => c === `${val}_${fn}`) || `${val}_${fn}`;
        if (!out.has(col)) { check(`${tag} groupby ${fn} column`, false, col); continue; }
        const ours = {};
        keys.forEach((k, i) => { ours[k] = out.values(col)[i]; });
        compareMap(`${tag} groupby(${by}).${fn}(${val})`, ours, g.groupby[fn]);
      }
    }
  }

  /* ---- crosstab() ---- */
  if (g.crosstab) {
    const numCols = Object.values(g.dtypes).length;
    void numCols;
    /* the golden stores the row/col labels, so the caller does not need to know
       which two columns were chosen */
    const pair = findCrosstabPair(df, g.crosstab);
    if (!pair) {
      check(`${tag} crosstab pair found`, false,
        `rows=${g.crosstab.rows.length} cols=${g.crosstab.cols.length}`);
    } else {
      const ct = df.crosstab(pair[0], pair[1]);
      const same = ct.rows.length === g.crosstab.rows.length
        && ct.cols.length === g.crosstab.cols.length
        && ct.grid.every((row, i) => row.every((v, j) => v === g.crosstab.grid[i][j]));
      check(`${tag} crosstab(${pair[0]}, ${pair[1]})`,
        same, `ours ${ct.rows.length}x${ct.cols.length} pandas ${g.crosstab.rows.length}x${g.crosstab.cols.length}`);
    }
  }

  /* ---- corr() ---- */
  if (g.corr) {
    const { cols, matrix } = df.corr();
    check(`${tag} corr column set`, cols.join(',') === g.corr.columns.join(','),
      `pandas ${g.corr.columns.join(',')}`);
    let worst = 0, where = '';
    if (cols.join(',') === g.corr.columns.join(',')) {
      for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {
          const d = Math.abs((matrix[i][j] ?? NaN) - (g.corr.matrix[i][j] ?? NaN));
          if (!(d <= worst)) { worst = d; where = `${cols[i]}x${cols[j]}`; }
          if (!close(matrix[i][j], g.corr.matrix[i][j])) {
            check(`${tag} corr(${cols[i]}, ${cols[j]})`, false,
              `pandas=${g.corr.matrix[i][j]} ours=${matrix[i][j]}`);
          }
        }
      }
    }
    void worst; void where;
  }

  /* ---- sort_values(): head and tail pin the ordering and the stability ---- */
  if (g.sortDescFirst5 && df.numericCols.length) {
    const col = df.numericCols[0];
    const s = df.sortValues(col, false);
    /* nulls must stay null: `Number(null)` is 0, which would quietly turn a
       "NaN sorts last" assertion into a "zero sorts last" one */
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const head = s.values(col).slice(0, 5).map(num);
    const tail = s.values(col).slice(-5).map(num);
    check(`${tag} sort_values(${col}, desc) head`,
      head.every((v, i) => close(v, g.sortDescFirst5[i])),
      `pandas ${JSON.stringify(g.sortDescFirst5)} ours ${JSON.stringify(head)}`);
    check(`${tag} sort_values(${col}, desc) tail`,
      tail.every((v, i) => close(v, g.sortDescLast5[i])),
      `pandas ${JSON.stringify(g.sortDescLast5)} ours ${JSON.stringify(tail)}`);
  }
}

/* The golden file records which two columns were tabulated. Recover them by
   matching the label sets the way crosstab would have produced them. */
function findCrosstabPair(df, ct) {
  const cats = df.categoricalCols;
  const matches = (col, labels) => {
    const seen = new Set(df.unique(col).map(String));
    return labels.length === seen.size && labels.every((l) => seen.has(String(l)));
  };
  for (const a of cats) {
    if (!matches(a, ct.rows)) continue;
    for (const b of cats) {
      if (b === a) continue;
      if (matches(b, ct.cols)) return [a, b];
    }
  }
  return null;
}

/* --------------------------------- report -------------------------------- */

console.log(`\n${[...versions].join(' · ')}`);
if (failures.length) {
  console.log(`\n✗ ${failures.length} parity failures, ${passed} checks passed\n`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${passed} parity checks passed — our engine matches pandas on ` +
  `${files.length} datasets\n`);
