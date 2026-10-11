/* =============================================================================
 * selftest.mjs — runs the DataFrame engine against known-good values.
 * Run with:  node tools/selftest.mjs      (or: npm test)
 * ========================================================================== */

import {
  DataFrame, describeSeries, histogram, quantile,
  gammaln, chi2PValue, tPValue, fPValue,
  chiSquareTest, welchTTest, oneWayAnova,
  missingMatrix, numericMatrix,
} from '../js/dataframe.js';
import { parseDelimited, matrixToColumns, parseJSONRecords, detectDelimiter } from '../js/parse.js';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const eq = (label, actual, expected, tol = 1e-6) => {
  const ok = typeof expected === 'number' && typeof actual === 'number'
    ? Math.abs(actual - expected) <= tol
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.log(`  \u2717 ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`); }
};

console.log('\ndataframe.js');

/* ---- basics ---- */
const df = new DataFrame(
  ['city', 'units', 'price', 'date'],
  {
    city: ['A', 'B', 'A', 'C', 'B', 'A'],
    units: [10, 20, 30, null, 50, 60],
    price: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
    date: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06'],
  },
  { name: 'test.csv' },
);

eq('nrows / ncols', [df.nrows, df.ncols], [6, 4]);
eq('dtype inference', df.columns.map((c) => c.type), ['string', 'number', 'number', 'date']);
eq('numericCols', df.numericCols, ['units', 'price']);
eq('categoricalCols', df.categoricalCols, ['city', 'date']);
eq('missingCounts[units]', df.missingCounts().find((c) => c.name === 'units').missing, 1);
eq('nunique(city)', df.nunique('city'), 3);

/* ---- describe (pandas semantics: sample std, ddof=1) ---- */
const d = describeSeries([1, 2, 3, 4]);
eq('count', d.count, 4);
eq('mean', d.mean, 2.5);
eq('population-free sample std of 1..4', d.std, 1.2909944487358056, 1e-9);
eq('median', d.q50, 2.5);
eq('q25', d.q25, 1.75);
eq('q75', d.q75, 3.25);
eq('min / max', [d.min, d.max], [1, 4]);

/* quantile interpolation matches numpy's default (linear) */
eq('quantile 0.1 of 1..10', quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1), 1.9, 1e-9);

/* ---- valueCounts ---- */
const vc = df.valueCounts('city');
eq('valueCounts order (desc)', vc.map((r) => r.value), ['A', 'B', 'C']);
eq('valueCounts counts', vc.map((r) => r.count), [3, 2, 1]);
eq('valueCounts ratio', vc[0].ratio, 0.5, 1e-9);

/* ---- sorting (NaN last) ---- */
eq('sortValues units asc, nulls last', df.sortValues('units', true).values('units'), [10, 20, 30, 50, 60, null]);
eq('sortValues units desc, nulls last', df.sortValues('units', false).values('units'), [60, 50, 30, 20, 10, null]);

/* ---- groupby ---- */
const gb = df.groupby(['city'], [
  { col: 'units', fn: 'sum', alias: 'units_sum' },
  { col: 'units', fn: 'mean', alias: 'units_mean' },
  { col: 'units', fn: 'count', alias: 'units_count' },
]);
const gbRows = Object.fromEntries(gb.toMatrix().map((r) => [r[0], r]));
eq('groupby A sum', gbRows.A[1], 100);
eq('groupby B sum', gbRows.B[1], 70);
eq('groupby A count (skips NaN)', gbRows.A[3], 3);
eq('groupby B mean', gbRows.B[2], 35);

/* ---- query parser ---- */
eq('query >', df.query('units > 25').length, 3);
eq('query >= + and', df.query('units >= 20 and price < 6').length, 3);
eq('query or', df.query('city == "A" or city == "C"').length, 4);
eq('query in list', df.query('city in ["A","B"]').length, 5);
eq('query str.contains', df.query('date.str.contains("01-0")').length, 6);
eq('query isna', df.query('units.isna()').length, 1);
eq('query not isna', df.query('not units.isna()').length, 5);
eq('query !=', df.query('city != "A"').length, 3);
eq('query parentheses', df.query('(city == "A" or city == "B") and units > 25').length, 3);
eq('query empty string returns all', df.query('').length, 6);

/* ---- cleaning ---- */
eq('dropna(units) rows', df.dropna(['units']).nrows, 5);
eq('fillna(units, 0)', df.fillna('units', 0).values('units'), [10, 20, 30, 0, 50, 60]);
eq('astype price -> string', typeof df.astype('price', 'string').values('price')[0], 'string');
eq('dropDuplicates(city) rows', df.dropDuplicates(['city']).nrows, 3);
eq('drop(units)', df.drop(['units']).colNames, ['city', 'price', 'date']);
eq('rename', df.rename({ units: 'qty' }).colNames[1], 'qty');
eq('take preserves order', df.take([5, 0]).values('city'), ['A', 'A']);

/* ---- correlation ---- */
const perfect = new DataFrame(['a', 'b'], { a: [1, 2, 3, 4], b: [2, 4, 6, 8] });
eq('pearson r = 1 for linear pair', perfect.corr().matrix[0][1], 1, 1e-9);
const inverse = new DataFrame(['a', 'b'], { a: [1, 2, 3, 4], b: [8, 6, 4, 2] });
eq('pearson r = -1 for inverse pair', inverse.corr().matrix[0][1], -1, 1e-9);

/* ---- crosstab ---- */
const ct = df.crosstab('city', 'date');
eq('crosstab shape', [ct.rows.length, ct.cols.length], [3, 6]);

/* ---- histogram ---- */
const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
eq('histogram bins', h.counts.length, 5);
eq('histogram total', h.counts.reduce((a, b) => a + b, 0), 10);

/* ---- distribution tails ----
 * Pinned against the published critical values every statistics table lists,
 * NOT against our own output — so a sign error or a swapped parameter in the
 * continued-fraction code cannot pass unnoticed. Each row is the statistic
 * value whose upper tail is exactly 0.05 for the given degrees of freedom. */
console.log('\ndistribution tails (vs published 5% critical values)');

eq('lgamma(5) = ln 24', gammaln(5), Math.log(24), 1e-10);

const CHI2_CRIT = [[1, 3.841459], [2, 5.991465], [5, 11.070498], [10, 18.307038]];
for (const [dfv, crit] of CHI2_CRIT) {
  eq(`chi2PValue(${crit}, ${dfv}) = 0.05`, chi2PValue(crit, dfv), 0.05, 1e-4);
}

const T_CRIT = [[1, 12.706205], [5, 2.570582], [10, 2.228139], [30, 2.042272], [100, 1.983972]];
for (const [dfv, crit] of T_CRIT) {
  eq(`tPValue(±${crit}, ${dfv}) = 0.05`, tPValue(crit, dfv), 0.05, 1e-4);
}
eq('tPValue is symmetric', tPValue(-2.228139, 10), tPValue(2.228139, 10), 1e-12);

const F_CRIT = [[1, 10, 4.964603], [2, 12, 3.885294], [3, 20, 3.098391]];
for (const [d1, d2, crit] of F_CRIT) {
  eq(`fPValue(${crit}, ${d1}, ${d2}) = 0.05`, fPValue(crit, d1, d2), 0.05, 1e-4);
}

/* ---- chi-square test of independence ---- */
console.log('\nchi-square');

const cs = chiSquareTest([[10, 20], [30, 40]]);
// rowSum [30,70] colSum [40,60] n 100 -> expected [12,18],[28,42]
// chi2 = 4/12 + 4/18 + 4/28 + 4/42
eq('chi2 of a 2x2 table', cs.chi2, 4 / 12 + 4 / 18 + 4 / 28 + 4 / 42, 1e-10);
eq('chi2 df', cs.df, 1);
eq("Cramer's V", cs.cramersV, Math.sqrt(cs.chi2 / 100), 1e-10);
eq('smallest expected count', cs.minExpected, 12, 1e-9);
eq('chi2 p matches the tail function', cs.p, chi2PValue(cs.chi2, 1), 1e-12);
eq('3x2 table df', chiSquareTest([[1, 2], [3, 4], [5, 6]]).df, 2);
eq('degenerate 1-column table -> null', chiSquareTest([[1], [2]]), null);

/* ---- Welch t-test (algebra is checkable by hand) ---- */
console.log('\nWelch t-test');

const wt = welchTTest([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
// mean 3 vs 6, var 2.5 vs 10, se^2 = 0.5 + 2 = 2.5, t = -3 / sqrt(2.5)
// df = 6.25 / (0.0625 + 1) = 5.8823529...
eq('welch t', wt.t, -3 / Math.sqrt(2.5), 1e-12);
eq('welch df (Satterthwaite)', wt.df, 6.25 / 1.0625, 1e-12);
eq('welch means', [wt.mean1, wt.mean2], [3, 6]);
eq('welch n', [wt.n1, wt.n2], [5, 5]);
// pooled sd = sqrt((4*2.5 + 4*10)/8) = sqrt(6.25) = 2.5 -> d = -3/2.5
eq('Cohen d', wt.cohensD, -1.2, 1e-12);
eq('welch p consistent with tPValue', wt.p, tPValue(wt.t, wt.df), 1e-12);
eq('welch skips nulls', welchTTest([1, null, 3], [2, 4]).n1, 2);
eq('welch needs 2+ per side', welchTTest([1], [2, 3]), null);

/* ---- one-way ANOVA ---- */
console.log('\none-way ANOVA');

const an = oneWayAnova([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
// grand 5; ssBetween = 3*(9+0+9) = 54; ssWithin = 3*2 = 6; F = 27/1
eq('anova F', an.f, 27, 1e-10);
eq('anova df', [an.dfBetween, an.dfWithin], [2, 6]);
eq('anova eta squared', an.etaSquared, 54 / 60, 1e-12);
eq('anova p consistent with fPValue', an.p, fPValue(27, 2, 6), 1e-12);
eq('anova needs 2+ groups', oneWayAnova([[1, 2, 3]]), null);

/* ---- missingness matrix ---- */
console.log('\nmissingness matrix');

const holey = new DataFrame(['a', 'b', 'c'], {
  a: [1, 2, 3, 4],
  b: [null, 2, 3, 4],
  c: [null, null, 3, 4],
});
const mm = missingMatrix(holey);
eq('columns with gaps only, worst first', mm.cols, ['c', 'b']);
eq('missing rate per column', mm.rates, [0.5, 0.25]);
eq('grid 1 = missing', mm.grid, [[1, 1], [1, 0], [0, 0], [0, 0]]);
eq('rows carrying at least one gap', mm.dirtyRows, 2);
eq('missing cell count', [mm.missingCells, mm.totalCells], [3, 12]);
eq('fully-populated frame yields no columns', missingMatrix(new DataFrame(['x'], { x: [1, 2] })).cols.length, 0);

const dm = missingMatrix(new DataFrame(['x'], { x: Array.from({ length: 5000 }, (_, i) => i) }), 600);
eq('row sampling caps the grid', dm.sampled <= 600 && dm.sampled > 0, true);
eq('row sampling reports the original size', dm.total, 5000);

/* ---- numeric matrix ---- */
console.log('\nnumeric matrix');

const wide = new DataFrame(['x', 'y'], {
  x: [1, 2, 3, 4, 5, 6, 7, 8],
  y: [2, 4, null, 8, 10, 12, 14, 16],
});
const nm = numericMatrix(wide, ['x', 'y'], 100);
eq('drops rows with any null', nm.rows.length, 7);
eq('keeps original row numbers', nm.indices.includes(2), false);
eq('values stay aligned', nm.rows[2], [4, 8]);
eq('down-samples large frames', numericMatrix(wide, ['x'], 3).rows.length, 3);

console.log('\nparse.js');

eq('detectDelimiter comma', detectDelimiter('a,b,c\n1,2,3'), ',');
eq('detectDelimiter tab', detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
eq('detectDelimiter semicolon', detectDelimiter('a;b;c\n1;2;3'), ';');

const quoted = matrixToColumns(parseDelimited('name,note\n"Doe, J","say ""hi"""\nPlain,x'));
eq('quoted field with comma', quoted.data.name[0], 'Doe, J');
eq('escaped double quote', quoted.data.note[0], 'say "hi"');
eq('trailing plain row', quoted.data.name[1], 'Plain');

const noHeaderDup = matrixToColumns(parseDelimited('a,a,a\n1,2,3'));
eq('duplicate headers de-duplicated', noHeaderDup.columns, ['a', 'a.1', 'a.2']);

const emptyCells = matrixToColumns(parseDelimited('x,y\n1,\n,2'));
// the tokenizer keeps raw strings; dtype inference happens later in DataFrame
eq('empty cell -> null', [emptyCells.data.x[1], emptyCells.data.y[1]], [null, '2']);

const crlf = matrixToColumns(parseDelimited('\uFEFFa,b\r\n1,2\r\n3,4'));
eq('BOM + CRLF handled', [crlf.columns.join(','), crlf.data.a.length], ['a,b', 2]);

const js = parseJSONRecords('[{"n":1,"s":"x"},{"n":2,"t":true}]');
eq('JSON union of keys', js.columns, ['n', 's', 't']);
eq('JSON missing key -> null', js.data.t[0], null);

/* ---- real sample files ---- */
console.log('\nsample data');
for (const file of ['data/sales.csv', 'data/iris.csv', 'data/tips.csv', 'data/titanic.csv']) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const p = matrixToColumns(parseDelimited(text));
  const frame = new DataFrame(p.columns, p.data, { name: file });
  console.log(`  \u2713 ${file}: ${frame.nrows} rows × ${frame.ncols} cols ` +
    `[${frame.columns.map((c) => c.type).join(', ')}]`);
  if (file.includes('iris')) {
    eq('iris rows', frame.nrows, 150);
    eq('iris species count', frame.nunique('species'), 3);
    const bySpecies = frame.groupby(['species'], [{ col: 'petal_length', fn: 'mean', alias: 'm' }]);
    const rows = Object.fromEntries(bySpecies.toMatrix().map((r) => [r[0], r[1]]));
    eq('iris setosa mean petal_length ≈ 1.464', Math.round(rows.setosa * 100) / 100, 1.46);
    eq('iris virginica mean petal_length ≈ 5.552', Math.round(rows.virginica * 100) / 100, 5.55);
  }
  if (file.includes('sales')) {
    eq('sales has 16 columns', frame.ncols, 16);
    eq('sales numeric cols', frame.numericCols.length, 9);
  }
  if (file.includes('titanic')) {
    eq('titanic rows', frame.nrows, 891);
    // the set is famous for its gaps — age, cabin and deck are all incomplete
    const tm = missingMatrix(frame);
    eq('titanic has gappy columns', tm.cols.length > 0, true);
    eq('titanic worst column is cabin, ~77% missing', Math.round(tm.rates[0] * 100), 77);
    eq('titanic rows with at least one gap', tm.dirtyRows > 700, true);
    // sex x survived: 342 female (231 survived), 549 male (109 survived)
    const ct2 = frame.crosstab('sex', 'survived');
    eq('titanic crosstab is 2x2', [ct2.rows.length, ct2.cols.length], [2, 2]);
    eq('titanic chi2 is large and significant', chiSquareTest(ct2.grid).p < 1e-20, true);
    eq('titanic sex x survived groups', frame.groupby(['sex', 'survived'], []).nrows, 4);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
