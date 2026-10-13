/* =============================================================================
 * bench.mjs — how long the engine takes on the bundled datasets.
 *
 * Purpose is twofold:
 *   1. a number you can quote ("54k rows described in N ms") instead of a
 *      feeling, and
 *   2. a regression gate for algorithmic blowups.
 *
 * On (2): wall-clock budgets are a poor fit for a shared CI runner, so the
 * ceilings here are deliberately loose — two orders of magnitude above the
 * measured times on a laptop. A tight budget would flake on a busy runner; a
 * loose one still catches the failure that actually matters, which is a change
 * in complexity (the pivot Cartesian product, a quadratic dedupe, a re-scan per
 * row). Anything that turns 40 ms into 4 s will trip; ordinary machine noise
 * will not.
 *
 * Usage:
 *   node tools/bench.mjs            # report
 *   node tools/bench.mjs --check    # also fail on a blown ceiling (CI uses this)
 * ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataFrame, pivotTable, resample, rolling } from '../js/dataframe.js';
import { parseDelimited, matrixToColumns } from '../js/parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const REPS = 5;

const ms = (t) => (Number(t) / 1e6);

function timeit(fn, reps = REPS) {
  for (let i = 0; i < 2; i++) fn();          // warm up: let V8 optimise
  const runs = [];
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    runs.push(ms(process.hrtime.bigint() - t0));
  }
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];  // median, so one GC pause cannot lie
}

/* ------------------------------- datasets -------------------------------- */

const CASES = [
  { name: 'diamonds', rowBudget: 1500 },
  { name: 'taxis', rowBudget: 600 },
];

const failures = [];
const rowsReport = [];

function budget(label, got, limit) {
  const ok = got <= limit;
  if (!ok) failures.push(`${label}: ${got.toFixed(1)} ms > ${limit} ms budget`);
  return ok ? '' : '  ← OVER';
}

console.log('\nPandaLens engine benchmark');
console.log(`${process.version} · ${process.platform}/${process.arch}\n`);

for (const { name, rowBudget } of CASES) {
  const file = path.join(ROOT, 'data', `${name}.csv`);
  if (!fs.existsSync(file)) { console.log(`  ! ${name}: no such file`); continue; }
  const text = fs.readFileSync(file, 'utf8');

  const tParse = timeit(() => {
    const p = matrixToColumns(parseDelimited(text));
    return new DataFrame(p.columns, p.data, { name });
  }, 3);

  const p = matrixToColumns(parseDelimited(text));
  const base = new DataFrame(p.columns, p.data, { name });
  const numCols = base.numericCols;
  const catCols = base.categoricalCols;
  const lowCard = catCols.filter((c) => base.nunique(c) <= 30);
  const g = lowCard[0];
  const v = numCols[0];

  const ops = [];
  ops.push(['parse + infer', tParse, rowBudget]);
  ops.push(['describe()', timeit(() => base.describe()), rowBudget]);
  ops.push(['valueCounts', timeit(() => base.valueCounts(lowCard[1] || catCols[0])), rowBudget]);
  ops.push(['missingCounts', timeit(() => base.missingCounts()), rowBudget]);
  if (numCols.length > 1) {
    ops.push(['corr()', timeit(() => base.corr()), rowBudget * 6]);
  }
  if (g && v) {
    ops.push(['groupby(sum/mean)', timeit(() =>
      base.groupby([g], [{ col: v, fn: 'sum' }, { col: v, fn: 'mean' }])), rowBudget]);
  }
  ops.push(['sortValues(desc)', timeit(() => base.sortValues(v, false)), rowBudget]);
  /* the threshold is precomputed: describing inside the timed block would have
     measured describe(), not query() */
  const threshold = base.describe()[v].q50;
  ops.push(['query()', timeit(() => base.query(`${v} > ${threshold}`)), rowBudget * 3]);
  if (lowCard.length >= 2 && v) {
    ops.push(['pivotTable', timeit(() =>
      pivotTable(base, { rows: [lowCard[0]], cols: [lowCard[1]], value: v, agg: 'mean' })),
    rowBudget * 9]);
  }
  /* time-series work is only meaningful when a real date column exists — the
     resample path re-buckets every row, so it is the one most likely to regress */
  const dateCol = base.columns.find((c) => c.type === 'date');
  if (dateCol && v) {
    ops.push(['resample(month)', timeit(() =>
      resample(base, dateCol.name, 'M', [{ col: v, fn: 'mean' }])), rowBudget * 6]);
    ops.push(['rolling(mean, 7)', timeit(() =>
      rolling(base.values(v), 7, 'mean'), 1), rowBudget * 3]);
  }

  console.log(`${name}.csv — ${base.nrows.toLocaleString()} rows × ${base.ncols} cols`);
  for (const [label, t, limit] of ops) {
    const flag = CHECK ? budget(`${name}/${label}`, t, limit) : '';
    rowsReport.push({ name, label, t });
    console.log(`  ${label.padEnd(20)} ${t.toFixed(2).padStart(9)} ms${flag}`);
  }
  console.log('');
}

/* ------------------------------- verdict --------------------------------- */

const worst = rowsReport.reduce((a, b) => (b.t > a.t ? b : a), rowsReport[0]);
if (worst) console.log(`slowest operation: ${worst.name}/${worst.label} at ${worst.t.toFixed(1)} ms`);

if (CHECK && failures.length) {
  console.log(`\n✗ ${failures.length} budget(s) exceeded — this looks algorithmic, not noise\n`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(CHECK ? '\n✓ every operation is within its budget\n' : '\n(report only — pass --check to enforce)\n');
