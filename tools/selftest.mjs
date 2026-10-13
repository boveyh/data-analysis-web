/* =============================================================================
 * selftest.mjs — runs the DataFrame engine against known-good values.
 * Run with:  node tools/selftest.mjs      (or: npm test)
 * ========================================================================== */

import {
  DataFrame, describeSeries, histogram, quantile,
  gammaln, chi2PValue, tPValue, fPValue,
  chiSquareTest, welchTTest, oneWayAnova,
  missingMatrix, numericMatrix,
  normalCdf, probit, pearsonTest, mannWhitneyU, kruskalWallis, leveneTest,
  jarqueBera, qqData, linearFit, periodKey, resample, rolling, pctChange, shift,
  pivotTable, columnTypeConflicts, aggregate,
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

/* ---- normal CDF / quantile (Acklam + incomplete gamma) ---- */
console.log('\nnormal distribution');

eq('probit(0.5) = 0', probit(0.5), 0, 1e-12);
eq('probit(0.975) = 1.959964', probit(0.975), 1.959964, 1e-6);
eq('probit(0.025) = -1.959964', probit(0.025), -1.959964, 1e-6);
eq('probit(0.995) = 2.575829', probit(0.995), 2.575829, 1e-6);
eq('probit(0.75) = 0.674490', probit(0.75), 0.674490, 1e-6);
eq('normalCdf(0) = 0.5', normalCdf(0), 0.5, 1e-12);
eq('normalCdf(1.96) = 0.975002', normalCdf(1.96), 0.975002, 1e-6);
eq('normalCdf(-1.96) = 0.024998', normalCdf(-1.96), 0.024998, 1e-6);
eq('normalCdf(2.575829) = 0.995', normalCdf(2.575829), 0.995, 1e-6);
eq('probit/normalCdf round-trip', normalCdf(probit(0.83)), 0.83, 1e-9);
eq('normalCdf(1) symmetry', normalCdf(1) + normalCdf(-1), 1, 1e-12);

/* ---- correlation significance ---- */
console.log('\ncorrelation significance');

// a=[1..5], b=[2,4,5,4,5]: r = 6/sqrt(60); t = r*sqrt(3/(1-r^2)) = 2.121320344
const pt = pearsonTest([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
eq('pearson r', pt.r, 6 / Math.sqrt(60), 1e-12);
eq('pearson t = 2.121320344', pt.t, 2.121320344, 1e-9);
eq('pearson df', pt.df, 3);
eq('pearson p is the t tail', pt.p, tPValue(pt.t, 3), 1e-12);
const perfectPt = pearsonTest([1, 2, 3, 4], [2, 4, 6, 8]);
eq('perfect correlation r = 1', perfectPt.r, 1, 1e-12);
eq('perfect correlation p = 0', perfectPt.p, 0);
eq('pearson needs 3 points', pearsonTest([1, 2], [3, 4]), null);

/* ---- Mann-Whitney U ---- */
console.log('\nMann-Whitney U');

// fully separated: ranks 1..5 vs 6..10, R1 = 15, U1 = 15 - 15 = 0
const mw = mannWhitneyU([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
eq('mw u1 = 0', mw.u1, 0, 1e-12);
eq('mw u2 = 25', mw.u2, 25, 1e-12);
eq('mw u is the smaller', mw.u, 0, 1e-12);
// var(U) = (n1*n2/12)*(N+1) = (25/12)*11; z = (U1 - mu - 0.5*sign) / sd
eq('mw z = -2.5067182', mw.z, -12 / Math.sqrt((25 / 12) * 11), 1e-12);
eq('mw p ≈ 0.0122', mw.p, 0.012188, 1e-5);
eq('mw n', [mw.n1, mw.n2], [5, 5]);
const mw0 = mannWhitneyU([1, 2, 3, 4], [1, 2, 3, 4]);
eq('mw identical samples -> p near 1', mw0.p > 0.9, true);
eq('mw needs data', mannWhitneyU([], [1]), null);

/* ---- Kruskal-Wallis ---- */
console.log('\nKruskal-Wallis');

// ranks 1..6: R1 = 6, R2 = 15 -> H = (12/42)*87 - 21 = 3.857142857
const kw = kruskalWallis([[1, 2, 3], [4, 5, 6]]);
eq('kw H = 3.857142857', kw.h, 3.857142857, 1e-9);
eq('kw df = 1', kw.df, 1);
eq('kw p consistent with chi2PValue', kw.p, chi2PValue(kw.h, 1), 1e-12);
eq('kw three groups runs', kruskalWallis([[1, 2], [3, 4], [5, 6]]).k, 3);
eq('kw needs 2+ groups', kruskalWallis([[1, 2, 3]]), null);

/* ---- Levene ---- */
console.log('\nLevene (equal variance)');

// medians 2 and 20 -> |dev| [1,0,1] and [10,0,10]; ANOVA on those gives F = 3.20792
const lv = leveneTest([[1, 2, 3], [10, 20, 30]]);
eq('levene W = 3.20792', lv.w, 3.207920792, 1e-7);
eq('levene df', [lv.df1, lv.df2], [1, 4]);
eq('levene centres on the median by default', lv.center, 'median');
const lv0 = leveneTest([[1, 2, 3], [11, 12, 13]]);
eq('levene equal spread -> p near 1', lv0.p > 0.99, true);
eq('levene can centre on the mean', leveneTest([[1, 2, 3], [10, 20, 30]], 'mean').center, 'mean');

/* ---- Jarque-Bera ---- */
console.log('\nJarque-Bera (normality)');

// [-3,-1,1,3]: mean 0, m2 = 5, m3 = 0, m4 = 41 -> skew 0, kurt 1.64
const jb = jarqueBera([-3, -1, 1, 3]);
eq('jb skew = 0', jb.skew, 0, 1e-12);
eq('jb kurtosis = 1.64', jb.kurtosis, 1.64, 1e-12);
eq('jb statistic = 0.3082667', jb.jb, 0.308266667, 1e-9);
eq('jb df = 2', jb.df, 2);
eq('jb p consistent with chi2', jb.p, chi2PValue(jb.jb, 2), 1e-12);
eq('jb needs 4 points', jarqueBera([1, 2, 3]), null);

/* ---- QQ coordinates ---- */
console.log('\nQQ coordinates');

const qq = qqData([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
eq('qq draws every point', qq.sampled, 10);
eq('qq first theoretical quantile', qq.points[0][0], probit(0.05), 1e-12);
eq('qq first sample value', qq.points[0][1], 1);
// quartile reference line: q1 = 3.25, q3 = 7.75 -> slope 4.5 / (2*0.6744898)
eq('qq reference slope', qq.slope, 4.5 / (2 * 0.6744897501960817), 1e-9);
eq('qq reference intercept is the median', qq.intercept, 5.5, 1e-12);
eq('qq needs 5 points', qqData([1, 2, 3, 4]), null);

/* ---- least-squares fit ---- */
console.log('\nlinear fit');

const fit = linearFit([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]);
eq('fit slope = 2', fit.slope, 2, 1e-12);
eq('fit intercept = 1', fit.intercept, 1, 1e-12);
eq('fit r2 = 1 on a perfect line', fit.r2, 1, 1e-12);
eq('fit n', fit.n, 5);
eq('fit skips NaN pairs', linearFit([1, 2, null, 4], [2, 4, 6, null]).n, 2);
eq('fit needs 2 points', linearFit([1], [2]), null);

/* ---- time series ---- */
console.log('\ntime series');

eq('periodKey day', periodKey('2026-01-15', 'D'), '2026-01-15');
eq('periodKey week starts Monday', periodKey('2026-01-15', 'W'), '2026-01-12');
eq('periodKey month', periodKey('2026-01-15', 'M'), '2026-01-01');
eq('periodKey bad input', periodKey('not a date', 'D'), null);

const ts = new DataFrame(['d', 'v'], {
  d: ['2024-01-05', '2024-01-20', '2024-02-10', '2024-02-20', '2024-03-01'],
  v: [1, 2, 3, 4, 5],
});
const monthly = resample(ts, 'd', 'M', [{ col: 'v', fn: 'mean' }]);
eq('resample monthly row count', monthly.nrows, 3);
eq('resample monthly keeps the date column name', monthly.colNames, ['d', 'v_mean']);
eq('resample monthly values', monthly.values('v_mean'), [1.5, 3.5, 5]);
eq('resample sorts by period', monthly.values('d'), ['2024-01-01', '2024-02-01', '2024-03-01']);
eq('resample weekly row count', resample(ts, 'd', 'W', [{ col: 'v', fn: 'mean' }]).nrows, 5);
eq('resample sums too',
  resample(ts, 'd', 'M', [{ col: 'v', fn: 'sum' }]).values('v_sum'), [3, 7, 5]);
eq('resample defaults to mean of every numeric column',
  resample(ts, 'd', 'M').colNames, ['d', 'v_mean']);

// pandas: leading window-1 values are NaN (min_periods defaults to window)
eq('rolling mean', rolling([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
eq('rolling sum', rolling([1, 2, 3, 4], 2, 'sum'), [null, 3, 5, 7]);
eq('rolling max', rolling([1, 5, 3], 2, 'max'), [null, 5, 5]);
// stddev of [1,3] with ddof=1 is sqrt(2)
eq('rolling std', rolling([1, 3], 2, 'std'), [null, Math.SQRT2]);
eq('rolling skips a NaN window', rolling([1, null, 3], 2), [null, null, null]);
eq('rolling window 1 is the identity', rolling([1, 2, 3], 1), [1, 2, 3]);

eq('pctChange', pctChange([10, 15, 15]), [null, 0.5, 0]);
eq('pctChange resets after a gap', pctChange([10, null, 20]), [null, null, null]);
eq('shift forward', shift([1, 2, 3], 1), [null, 1, 2]);
eq('shift back', shift([1, 2, 3], -1), [2, 3, null]);
eq('shift beyond the ends is null', shift([1, 2], 5), [null, null]);

/* ---- pivot table ---- */
console.log('\npivot table');

const pv = new DataFrame(['region', 'product', 'sales'], {
  region: ['E', 'E', 'W', 'W'],
  product: ['A', 'B', 'A', 'B'],
  sales: [10, 20, 30, 40],
});
const pvSum = pivotTable(pv, { rows: ['region'], cols: ['product'], value: 'sales', agg: 'sum' });
eq('pivot row keys', pvSum.rowKeys, ['E', 'W']);
eq('pivot col keys', pvSum.colKeys, ['A', 'B']);
eq('pivot grid', pvSum.grid, [[10, 20], [30, 40]]);
eq('pivot count', pivotTable(pv, { rows: ['region'], cols: ['product'], value: 'sales', agg: 'count' }).grid,
  [[1, 1], [1, 1]]);
const pvFlat = pivotTable(pv, { rows: ['region'], value: 'sales', agg: 'sum' });
eq('pivot without columns is a single column', pvFlat.grid, [[30], [70]]);
eq('pivot flags the single-column case', pvFlat.single, true);
eq('pivot needs a row field', pivotTable(pv, { rows: [], value: 'sales' }), null);
eq('pivot needs a value field', pivotTable(pv, { rows: ['region'], value: 'nope' }), null);
// empty cell stays null rather than becoming 0
const pvHole = pivotTable(
  new DataFrame(['r', 'c', 'v'], { r: ['x', 'y'], c: ['a', 'b'], v: [1, 2] }),
  { rows: ['r'], cols: ['c'], value: 'v', agg: 'sum' },
);
eq('pivot leaves empty cells null', pvHole.grid, [[1, null], [null, 2]]);

/* The Cartesian product is the pivot's whole cost, so it must be bounded.
 * A 40 × 40 cross-tab is 1,600 cells and fine; the same request under a 100
 * budget has to be reported, not attempted. */
const mesh = new DataFrame(['r', 'c', 'v'], {
  r: Array.from({ length: 40 }, (_, i) => `r${i}`),
  c: Array.from({ length: 40 }, (_, i) => `c${i}`),
  v: Array.from({ length: 40 }, (_, i) => i),
});
const meshCfg = { rows: ['r'], cols: ['c'], value: 'v' };
const meshPv = pivotTable(mesh, meshCfg);
eq('a 40 x 40 pivot builds under the default budget', meshPv.grid.length, 40);
eq('a 40 x 40 pivot is 40 columns mesh', meshPv.grid[0].length, 40);
eq('an in-budget pivot is not flagged', meshPv.tooLarge, undefined);

const overBudget = pivotTable(mesh, { ...meshCfg, maxCells: 100 });
eq('an over-budget pivot reports instead of building', overBudget.tooLarge, true);
eq('an over-budget pivot has no grid', overBudget.grid, null);
eq('an over-budget pivot still reports its axes',
  [overBudget.rowKeys.length, overBudget.colKeys.length], [40, 40]);
eq('an over-budget pivot reports the cell count', overBudget.cellCount, 1600);
eq('an over-budget pivot echoes the budget', overBudget.maxCells, 100);
eq('raising the budget unblocks an identical request',
  pivotTable(mesh, { ...meshCfg, maxCells: 5000 }).grid.length, 40);
eq('maxCells = Infinity always builds',
  pivotTable(mesh, { ...meshCfg, maxCells: Infinity }).grid.length, 40);

/* ---- scale guards: nothing may assume a small frame ---- */
console.log('\nscale');

/* `Math.min(...arr)` throws RangeError above roughly 125k elements, and the app
 * takes uploads of any size. A 200k-row column has to describe, aggregate and
 * histogram without a stack overflow. */
const BIG = 200000;
const bigVals = Array.from({ length: BIG }, (_, i) => String((i * 7919) % 100003));
const bigFrame = new DataFrame(['v'], { v: bigVals }, { name: 'big.csv' });
let bigErr = null, bigDesc = null;
try { bigDesc = bigFrame.describe().v; }
catch (e) { bigErr = `${e.constructor.name}: ${e.message}`; }
eq('a 200k-row describe() does not throw', bigErr, null);
eq('its count is right', bigDesc && bigDesc.count, BIG);
eq('its min is right', bigDesc && bigDesc.min, 0);

let aggErr = null;
let aggMin = null;
try {
  aggMin = aggregate(bigFrame.values('v'), bigFrame.rowIndexArray(), 'min');
} catch (e) { aggErr = `${e.constructor.name}: ${e.message}`; }
eq('a 200k-row aggregate(min) does not throw', aggErr, null);
eq('a 200k-row aggregate(min) is right', aggMin, 0);

let histErr = null, histOK = false;
try {
  const h = histogram(bigFrame.values('v'), 12);
  histOK = h.counts.length === 12 && h.counts.reduce((a, b) => a + b, 0) === BIG;
} catch (e) { histErr = `${e.constructor.name}: ${e.message}`; }
eq('a 200k-row histogram() does not throw', histErr, null);
eq('every one of the 200k observations lands in a bin', histOK, true);

/* the one-sort describe must agree with the three-sort quantile, exactly */
const qv = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
const qd = describeSeries(qv);
eq('describe q25 matches quantile()', qd.q25, quantile(qv, 0.25), 0);
eq('describe q50 matches quantile()', qd.q50, quantile(qv, 0.5), 0);
eq('describe q75 matches quantile()', qd.q75, quantile(qv, 0.75), 0);
eq('describe min matches the smallest value', qd.min, 1);
eq('describe max matches the largest value', qd.max, 9);

/* ---- data hygiene ---- */
console.log('\ndata hygiene');

const conflict = new DataFrame(['mostly_num', 'clean_text'], {
  // 19 real numbers and one stray token: pandas would make this object
  mostly_num: [...Array.from({ length: 19 }, (_, i) => i + 1), 'N/A'],
  clean_text: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
    'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'],
});
const conflicts = columnTypeConflicts(conflict);
eq('type conflict finds exactly one column', conflicts.length, 1);
eq('type conflict names the right column', conflicts[0].name, 'mostly_num');
eq('type conflict rate', conflicts[0].rate, 19 / 20, 1e-12);
eq('type conflict samples the junk', conflicts[0].samples[0].value, 'N/A');
eq('clean text is not flagged', conflicts.some((c) => c.name === 'clean_text'), false);

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

/* The Excel reader hands this function `null` for a blank cell (SheetJS's
 * `sheet_to_json` with `defval: null`), and also real numbers when `raw` is on.
 * The CSV path only ever passes strings, so a `.trim()` here used to throw on
 * the first blank cell and fail the entire workbook import. */
const nullCell = matrixToColumns([['a', 'b'], ['x', null], ['y', 'z']]);
eq('a null cell becomes null, not a throw', nullCell.data.b, [null, 'z']);
const numCell = matrixToColumns([['a', 'b'], [12, true]]);
eq('a non-string scalar is coerced', numCell.data.a, ['12']);
eq('a boolean scalar is coerced', numCell.data.b, ['true']);
const nulHeader = matrixToColumns([['a', null], [1, 2]]);
eq('a blank header still gets a name', nulHeader.columns, ['a', 'col_2']);

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
