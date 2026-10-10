/* =============================================================================
 * selftest.mjs — runs the DataFrame engine against known-good values.
 * Run with:  node tools/selftest.mjs      (or: npm test)
 * ========================================================================== */

import { DataFrame, describeSeries, histogram, quantile } from '../js/dataframe.js';
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
for (const file of ['data/sales.csv', 'data/iris.csv', 'data/tips.csv']) {
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
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
