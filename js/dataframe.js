/* =============================================================================
 * dataframe.js — A tiny pandas-like DataFrame engine in pure JavaScript.
 *
 * Column-oriented storage ({name: [values]}) mirrors pandas' block layout,
 * and every operation returns a NEW frame — just like pandas' immutable style.
 *
 * Supported API (mirrors the pandas names):
 *   head/tail, describe, valueCounts, groupby+agg, query, sortValues,
 *   dropna, fillna, astype, rename, drop, corr, nunique, isna, dropDuplicates
 * ========================================================================== */

/* ----------------------------- small utils ------------------------------- */

export const isNull = (v) =>
  v === null || v === undefined || v === '' ||
  (typeof v === 'number' && Number.isNaN(v));

const toNumber = (v) => {
  if (typeof v === 'number') return v;
  if (isNull(v)) return NaN;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isNaN(n) ? NaN : n;
};

/** pandas-like dtype inference for a whole column. */
export function inferType(values) {
  const nonNull = values.filter((v) => !isNull(v));
  if (!nonNull.length) return 'string';

  // boolean
  if (nonNull.every((v) =>
    typeof v === 'boolean' ||
    ['true', 'false'].includes(String(v).toLowerCase().trim()))) return 'boolean';

  // number
  if (nonNull.every((v) => !Number.isNaN(toNumber(v)))) return 'number';

  // datetime — accepts ISO, yyyy/mm/dd, yyyy-mm-dd hh:mm:ss ...
  const dateRe = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})([ T]\d{1,2}:\d{2}(:\d{2})?)?$|^\d{4}-\d{2}-\d{2}T/;
  if (nonNull.every((v) => dateRe.test(String(v).trim()) && !Number.isNaN(Date.parse(v)))) {
    return 'date';
  }
  return 'string';
}

export const isNumericType = (t) => t === 'number';

/* ------------------------------ DataFrame -------------------------------- */

export class DataFrame {
  /**
   * @param {string[]} columns  ordered column names
   * @param {Object}   data     { colName: value[] }
   */
  constructor(columns, data, meta = {}) {
    this.columns = columns.map((name) => ({ name, type: inferType(data[name] || []) }));
    this.data = data;
    this.meta = meta;                 // { name, source }
  }

  get nrows() { return this.columns.length ? (this.data[this.columns[0].name] || []).length : 0; }
  get ncols() { return this.columns.length; }
  get colNames() { return this.columns.map((c) => c.name); }
  get numericCols() { return this.columns.filter((c) => c.type === 'number').map((c) => c.name); }
  get categoricalCols() { return this.columns.filter((c) => c.type !== 'number').map((c) => c.name); }
  type(name) { const c = this.columns.find((c) => c.name === name); return c ? c.type : null; }
  has(name) { return this.columns.some((c) => c.name === name); }
  values(name) { return this.data[name] || []; }

  /** Rows as array-of-arrays (used by the table view + export). */
  toMatrix(rows = null) {
    const idx = rows || this.rowIndexArray();
    return idx.map((i) => this.colNames.map((n) => this.data[n][i]));
  }

  rowIndexArray() { return Array.from({ length: this.nrows }, (_, i) => i); }

  /** Build a new frame from an explicit list of row indices. */
  take(indices) {
    const data = {};
    for (const n of this.colNames) data[n] = indices.map((i) => this.data[n][i]);
    return new DataFrame(this.colNames, data, this.meta);
  }

  clone() { return this.take(this.rowIndexArray()); }

  /* ------------------------- shape / selection ------------------------- */

  head(n = 5) { return this.take(this.rowIndexArray().slice(0, n)); }
  tail(n = 5) { return this.take(this.rowIndexArray().slice(-n)); }

  select(cols) {
    const data = {};
    for (const c of cols) if (this.has(c)) data[c] = this.data[c];
    return new DataFrame(cols.filter((c) => this.has(c)), data, this.meta);
  }

  drop(cols) {
    const keep = this.colNames.filter((c) => !cols.includes(c));
    return this.select(keep);
  }

  rename(map) { // map: {old: new}
    const data = {};
    const cols = [];
    for (const n of this.colNames) {
      const nn = map[n] || n;
      cols.push(nn);
      data[nn] = this.data[n];
    }
    return new DataFrame(cols, data, this.meta);
  }

  /** Cast a column to a new dtype (number / string / boolean). */
  astype(col, type) {
    const data = {};
    for (const n of this.colNames) data[n] = this.data[n].slice();
    data[col] = data[col].map((v) => {
      if (isNull(v)) return null;
      if (type === 'number') { const n = toNumber(v); return Number.isNaN(n) ? null : n; }
      if (type === 'boolean') return ['true', '1', 'yes', 1, true].includes(
        typeof v === 'string' ? v.toLowerCase().trim() : v);
      return String(v);
    });
    const df = new DataFrame(this.colNames, data, this.meta);
    return df;
  }

  /* ---------------------------- missing data --------------------------- */

  isna() { // returns { col: boolean[] }
    const out = {};
    for (const n of this.colNames) out[n] = this.data[n].map(isNull);
    return out;
  }

  missingCounts() {
    return this.columns.map((c) => ({
      name: c.name,
      type: c.type,
      missing: this.data[c.name].filter(isNull).length,
      total: this.nrows,
    }));
  }

  dropna(subset = null) {
    const cols = subset && subset.length ? subset : this.colNames;
    const keep = [];
    for (let i = 0; i < this.nrows; i++) {
      if (cols.every((c) => !isNull(this.data[c][i]))) keep.push(i);
    }
    return this.take(keep);
  }

  fillna(col, value) {
    const data = {};
    for (const n of this.colNames) data[n] = this.data[n].slice();
    const cast = isNumericType(this.type(col)) ? toNumber(value) : value;
    data[col] = data[col].map((v) => (isNull(v) ? cast : v));
    return new DataFrame(this.colNames, data, this.meta);
  }

  dropDuplicates(subset = null) {
    const cols = subset && subset.length ? subset : this.colNames;
    const seen = new Set();
    const keep = [];
    for (let i = 0; i < this.nrows; i++) {
      const key = cols.map((c) => String(this.data[c][i])).join('\u0001');
      if (!seen.has(key)) { seen.add(key); keep.push(i); }
    }
    return this.take(keep);
  }

  nunique(col) { return new Set(this.data[col].filter((v) => !isNull(v)).map(String)).size; }

  unique(col) {
    const seen = new Set(), out = [];
    for (const v of this.data[col]) {
      if (isNull(v)) continue;
      const k = String(v);
      if (!seen.has(k)) { seen.add(k); out.push(v); }
    }
    return out;
  }

  /* ------------------------------- sorting ----------------------------- */

  sortValues(by, ascending = true) {
    const type = this.type(by);
    const idx = this.rowIndexArray();
    const dir = ascending ? 1 : -1;
    idx.sort((a, b) => {
      const va = this.data[by][a], vb = this.data[by][b];
      const na = isNull(va), nb = isNull(vb);
      if (na && nb) return 0;
      if (na) return 1;              // NaN always last (pandas na_position='last')
      if (nb) return -1;
      let cmp;
      if (type === 'number') cmp = toNumber(va) - toNumber(vb);
      else if (type === 'date') cmp = Date.parse(va) - Date.parse(vb);
      else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return cmp * dir;
    });
    return this.take(idx);
  }

  /* ------------------------------ describe ----------------------------- */

  describe() {
    const out = {};
    for (const c of this.columns) {
      if (c.type !== 'number') continue;
      out[c.name] = describeSeries(this.data[c.name]);
    }
    return out;
  }

  describeAll(counts = true, top = 5) {
    const out = {};
    for (const c of this.columns) {
      const vals = this.data[c.name];
      if (c.type === 'number') { out[c.name] = { type: 'number', ...describeSeries(vals) }; }
      else {
        const nn = vals.filter((v) => !isNull(v));
        const freq = {};
        for (const v of nn) freq[v] = (freq[v] || 0) + 1;
        let topVal = null, topCnt = 0;
        for (const [k, n] of Object.entries(freq)) if (n > topCnt) { topCnt = n; topVal = k; }
        out[c.name] = {
          type: 'object',
          count: nn.length,
          unique: new Set(nn.map(String)).size,
          missing: vals.length - nn.length,
          top: topVal,
          freq: topCnt,
        };
      }
    }
    return out;
  }

  valueCounts(col, { normalize = false, ascending = false, limit = null } = {}) {
    const freq = new Map();
    let valid = 0;
    for (const v of this.data[col]) {
      if (isNull(v)) continue;
      const k = String(v);
      freq.set(k, (freq.get(k) || 0) + 1);
      valid++;
    }
    let entries = [...freq.entries()].map(([value, count]) => ({
      value, count, ratio: valid ? count / valid : 0,
    }));
    entries.sort((a, b) => (ascending ? a.count - b.count : b.count - a.count));
    if (limit) entries = entries.slice(0, limit);
    return entries;
  }

  /* ------------------------------- groupby ----------------------------- */

  /**
   * @param {string[]} by    grouping column names
   * @param {Array}    aggs  [{ col, fn }] fn in AGG_FUNCS
   * @returns {DataFrame}
   */
  groupby(by, aggs = []) {
    for (const c of by) if (!this.has(c)) throw new Error(`groupby: unknown column "${c}"`);
    for (const a of aggs) if (!this.has(a.col)) throw new Error(`groupby: unknown column "${a.col}"`);
    if (!by.length) throw new Error('groupby: "by" must contain at least one column');

    const groups = new Map();
    for (let i = 0; i < this.nrows; i++) {
      const key = by.map((c) => (isNull(this.data[c][i]) ? '' : String(this.data[c][i])));
      const k = key.join('\u0001');
      if (!groups.has(k)) groups.set(k, { key, rows: [] });
      groups.get(k).rows.push(i);
    }

    const data = {};
    for (let j = 0; j < by.length; j++) {
      data[by[j]] = [...groups.values()].map((g) => g.key[j]);
    }
    for (const a of aggs) {
      const outName = a.alias || `${a.col}_${a.fn}`;
      data[outName] = [...groups.values()].map((g) =>
        aggregate(this.data[a.col], g.rows, a.fn));
    }
    return new DataFrame([...by, ...aggs.map((a) => a.alias || `${a.col}_${a.fn}`)], data, this.meta);
  }

  /* -------------------------- correlation ------------------------------ */

  corr(method = 'pearson') {
    const cols = this.numericCols;
    const matrix = cols.map(() => cols.map(() => null));
    for (let i = 0; i < cols.length; i++) {
      for (let j = i; j < cols.length; j++) {
        const [a, b] = pairValues(this.data[cols[i]], this.data[cols[j]]);
        let r;
        if (cols[i] === cols[j]) r = 1;
        else r = method === 'spearman' ? spearman(a, b) : pearson(a, b);
        matrix[i][j] = r; matrix[j][i] = r;
      }
    }
    return { cols, matrix };
  }

  /* ----------------------- crosstab / pivot ---------------------------- */

  crosstab(rowCol, colCol) {
    const rows = this.unique(rowCol).map(String).sort();
    const cols = this.unique(colCol).map(String).sort();
    const grid = rows.map(() => cols.map(() => 0));
    for (let i = 0; i < this.nrows; i++) {
      const r = rows.indexOf(String(this.data[rowCol][i]));
      const c = cols.indexOf(String(this.data[colCol][i]));
      if (r >= 0 && c >= 0) grid[r][c]++;
    }
    return { rows, cols, grid };
  }

  /* ------------------------------- query ------------------------------- */

  /** pandas-style boolean expression -> row indices */
  query(expression) {
    if (!expression || !expression.trim()) return this.rowIndexArray();
    const ast = parseQuery(expression);
    const out = [];
    for (let i = 0; i < this.nrows; i++) if (evalNode(ast, this, i)) out.push(i);
    return out;
  }
}

/* ---------------------------- agg functions ------------------------------ */

export const AGG_FUNCS = ['count', 'sum', 'mean', 'median', 'min', 'max', 'std', 'nunique', 'first', 'last'];

export function aggregate(values, rows, fn) {
  const vals = rows.map((i) => values[i]);
  switch (fn) {
    case 'count': return vals.filter((v) => !isNull(v)).length;
    case 'nunique': return new Set(vals.filter((v) => !isNull(v)).map(String)).size;
    case 'first': return vals.find((v) => !isNull(v)) ?? null;
    case 'last': return [...vals].reverse().find((v) => !isNull(v)) ?? null;
    case 'min': { const n = vals.filter((v) => !isNull(v)); return n.length ? Math.min(...n.map(toNumber)) : null; }
    case 'max': { const n = vals.filter((v) => !isNull(v)); return n.length ? Math.max(...n.map(toNumber)) : null; }
    case 'sum': { const n = vals.filter((v) => !isNull(v)); return n.length ? n.reduce((s, v) => s + toNumber(v), 0) : null; }
    case 'mean': { const n = vals.filter((v) => !isNull(v)); return n.length ? n.reduce((s, v) => s + toNumber(v), 0) / n.length : null; }
    case 'median': return quantile(vals.filter((v) => !isNull(v)).map(toNumber), 0.5);
    case 'std': return stddev(vals.filter((v) => !isNull(v)).map(toNumber));
    default: return null;
  }
}

/* ----------------------------- statistics -------------------------------- */

export function quantile(sortedOrRaw, q) {
  const arr = sortedOrRaw.map(toNumber).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const pos = (arr.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}

export function stddev(arr) {
  if (arr.length < 2) return null;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export function describeSeries(values) {
  const nums = values.filter((v) => !isNull(v)).map(toNumber).filter((v) => !Number.isNaN(v));
  const count = nums.length;
  if (!count) return { count: 0, mean: null, std: null, min: null, q25: null, q50: null, q75: null, max: null, sum: null };
  const sum = nums.reduce((s, v) => s + v, 0);
  return {
    count,
    mean: sum / count,
    std: stddev(nums),
    min: Math.min(...nums),
    q25: quantile(nums, 0.25),
    q50: quantile(nums, 0.5),
    q75: quantile(nums, 0.75),
    max: Math.max(...nums),
    sum,
    missing: values.length - count,
  };
}

export function pearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? null : num / den;
}

function rank(arr) {
  const order = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(a, b) { return pearson(rank(a), rank(b)); }

/** Pairwise-complete observations (like pandas corr default). */
function pairValues(a, b) {
  const x = [], y = [];
  for (let i = 0; i < a.length; i++) {
    if (isNull(a[i]) || isNull(b[i])) continue;
    const na = toNumber(a[i]), nb = toNumber(b[i]);
    if (Number.isNaN(na) || Number.isNaN(nb)) continue;
    x.push(na); y.push(nb);
  }
  return [x, y];
}

/* ------------------------------ histogram -------------------------------- */

export function histogram(values, bins = 20) {
  const nums = values.filter((v) => !isNull(v)).map(toNumber).filter((v) => !Number.isNaN(v));
  if (!nums.length) return { edges: [], counts: [], centers: [] };
  const min = Math.min(...nums), max = Math.max(...nums);
  const width = (max - min) / bins || 1;
  const edges = Array.from({ length: bins + 1 }, (_, i) => min + i * width);
  const counts = new Array(bins).fill(0);
  for (const v of nums) {
    let k = Math.floor((v - min) / width);
    if (k >= bins) k = bins - 1;
    if (k < 0) k = 0;
    counts[k]++;
  }
  const centers = counts.map((_, i) => (edges[i] + edges[i + 1]) / 2);
  return { edges, counts, centers };
}

/* ------------------------ inferential statistics -------------------------- */
/* Implemented from first principles so the workbench keeps its promise of
 * having no runtime dependency other than ECharts. The distribution tails use
 * the usual Lanczos log-gamma plus continued-fraction expansion
 * (Numerical Recipes §6.2 / §6.4); tools/selftest.mjs pins them against
 * published critical values rather than against themselves.
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

const FPMIN = 1e-300;
const EPS = 1e-14;

export function gammaln(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaln(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const w = z + 7.5;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(w) - w + Math.log(a);
}

/** Regularised upper incomplete gamma Q(a, x) = 1 − P(a, x). */
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {                       // series for P, then complement
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 1; n <= 500; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

function betacf(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function ibeta(a, b, x) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** p-value of a chi-square statistic (upper tail). */
export function chi2PValue(x, df) {
  if (!(x > 0) || df <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

/** Two-tailed p-value of a t statistic. */
export function tPValue(t, df) {
  if (!Number.isFinite(t) || df <= 0) return 1;
  return ibeta(df / 2, 0.5, df / (df + t * t));
}

/** p-value of an F statistic (upper tail). */
export function fPValue(f, d1, d2) {
  if (!(f > 0) || d1 <= 0 || d2 <= 0) return 1;
  return ibeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * f));
}

/**
 * Chi-square test of independence on a contingency table (array of rows of
 * counts) — the test that belongs with `pd.crosstab`.
 */
export function chiSquareTest(table) {
  const rows = table.length;
  const cols = rows ? table[0].length : 0;
  if (rows < 2 || cols < 2) return null;

  const rowSum = new Array(rows).fill(0);
  const colSum = new Array(cols).fill(0);
  let total = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = Number(table[i][j]) || 0;
      rowSum[i] += v; colSum[j] += v; total += v;
    }
  }
  if (!total) return null;

  let chi2 = 0, minExpected = Infinity;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const e = (rowSum[i] * colSum[j]) / total;
      if (e > 0) {
        const d = (Number(table[i][j]) || 0) - e;
        chi2 += (d * d) / e;
        minExpected = Math.min(minExpected, e);
      }
    }
  }
  const df = (rows - 1) * (cols - 1);
  const k = Math.min(rows, cols);
  return {
    chi2, df,
    p: chi2PValue(chi2, df),
    cramersV: total && k > 1 ? Math.sqrt(chi2 / (total * (k - 1))) : null,
    minExpected: Number.isFinite(minExpected) ? minExpected : 0,
    rows, cols, total,
  };
}

/**
 * Welch's t-test — the unequal-variance variant, which is the safe default
 * when you have not checked the equal-variance assumption.
 */
export function welchTTest(a, b) {
  const clean = (arr) => arr.filter((v) => !isNull(v)).map(toNumber).filter((v) => !Number.isNaN(v));
  const x = clean(a), y = clean(b);
  if (x.length < 2 || y.length < 2) return null;

  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const varOf = (arr, m) => arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);

  const mx = mean(x), my = mean(y);
  const vx = varOf(x, mx), vy = varOf(y, my);
  const se2 = vx / x.length + vy / y.length;
  if (!(se2 > 0)) return null;

  const t = (mx - my) / Math.sqrt(se2);
  const df = (se2 * se2) / (
    ((vx / x.length) ** 2) / (x.length - 1) + ((vy / y.length) ** 2) / (y.length - 1)
  );
  const pooled = Math.sqrt(
    ((x.length - 1) * vx + (y.length - 1) * vy) / (x.length + y.length - 2),
  );
  return {
    t, df, p: tPValue(t, df),
    n1: x.length, n2: y.length,
    mean1: mx, mean2: my,
    std1: Math.sqrt(vx), std2: Math.sqrt(vy),
    diff: mx - my,
    cohensD: pooled ? (mx - my) / pooled : null,
  };
}

/** One-way ANOVA across independent groups. */
export function oneWayAnova(groups) {
  const gs = groups
    .map((g) => g.filter((v) => !isNull(v)).map(toNumber).filter((v) => !Number.isNaN(v)))
    .filter((g) => g.length);
  if (gs.length < 2) return null;

  const all = gs.flat();
  const n = all.length;
  const d1 = gs.length - 1;
  const d2 = n - gs.length;
  if (d2 <= 0) return null;

  const grand = all.reduce((s, v) => s + v, 0) / n;
  let ssBetween = 0, ssWithin = 0;
  for (const g of gs) {
    const m = g.reduce((s, v) => s + v, 0) / g.length;
    ssBetween += g.length * (m - grand) ** 2;
    for (const v of g) ssWithin += (v - m) ** 2;
  }
  const msWithin = ssWithin / d2;
  const f = msWithin === 0 ? Infinity : (ssBetween / d1) / msWithin;
  const ssTotal = ssBetween + ssWithin;
  return {
    f, dfBetween: d1, dfWithin: d2,
    p: msWithin === 0 ? 0 : fPValue(f, d1, d2),
    etaSquared: ssTotal ? ssBetween / ssTotal : null,
    k: gs.length, n,
  };
}

/* ------------------------- multivariate helpers --------------------------- */

/**
 * Missingness map in the layout `missingno.matrix()` made popular: columns
 * ordered worst-first, rows down-sampled to something drawable, 1 = missing.
 */
export function missingMatrix(df, maxRows = 600, maxCols = 40) {
  const na = df.isna();
  const stats = df.colNames.map((name) => {
    const col = na[name];
    let miss = 0;
    for (let i = 0; i < col.length; i++) if (col[i]) miss++;
    return { name, missing: miss, rate: col.length ? miss / col.length : 0 };
  });

  const dirty = stats.filter((s) => s.missing > 0).sort((a, b) => b.rate - a.rate);
  const cols = dirty.slice(0, maxCols);

  const total = df.nrows;
  const step = Math.max(1, Math.ceil(total / maxRows));
  const picked = [];
  for (let i = 0; i < total && picked.length < maxRows; i += step) picked.push(i);

  let dirtyRows = 0;
  for (let i = 0; i < total; i++) {
    for (const s of stats) {
      if (na[s.name][i]) { dirtyRows++; break; }
    }
  }

  return {
    cols: cols.map((c) => c.name),
    rates: cols.map((c) => c.rate),
    grid: picked.map((i) => cols.map((c) => (na[c.name][i] ? 1 : 0))),
    sampled: picked.length,
    total,
    step,
    missingCells: stats.reduce((s, x) => s + x.missing, 0),
    totalCells: total * df.ncols,
    dirtyRows,
    droppedCols: Math.max(0, dirty.length - cols.length),
  };
}

/**
 * Row-complete numeric matrix for multivariate plots (parallel coordinates,
 * scatter matrices), down-sampled so a 50k-row frame still draws instantly.
 * `indices` keeps the original row numbers so a category label can be joined
 * back on.
 */
export function numericMatrix(df, cols, maxRows = 1200) {
  const step = Math.max(1, Math.ceil(df.nrows / maxRows));
  const series = cols.map((c) => df.values(c));
  const rows = [];
  const indices = [];
  for (let i = 0; i < df.nrows && rows.length < maxRows; i += step) {
    const row = new Array(cols.length);
    let ok = true;
    for (let j = 0; j < cols.length; j++) {
      const v = toNumber(series[j][i]);
      if (Number.isNaN(v)) { ok = false; break; }
      row[j] = v;
    }
    if (ok) { rows.push(row); indices.push(i); }
  }
  return { rows, indices, step, total: df.nrows };
}

/* --------------------------- query parser -------------------------------- */
/* Supports:  col > 10 and col == "x" or col in ["a","b"]
 *            col.str.contains("ab")  col.isna()  col.notna()  not (...)
 *            operators: == != >= <= > < ; and/& or/| not/!  ; parentheses
 */

function tokenize(src) {
  const tokens = [];
  const re = /\s*([A-Za-z_$][\w$]*)|("[^"]*"|'[^']*')|(-?\d+(?:\.\d+)?)|(==|!=|>=|<=|&&|\|\||[><&|!()\[\],.])/g;
  let m, last = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index !== last && src.slice(last, m.index).trim()) {
      throw new Error(`Unexpected input: "${src.slice(last, m.index).trim()}"`);
    }
    last = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'id', v: m[1] });
    else if (m[2] !== undefined) tokens.push({ t: 'str', v: m[2].slice(1, -1) });
    else if (m[3] !== undefined) tokens.push({ t: 'num', v: Number(m[3]) });
    else tokens.push({ t: 'op', v: m[4] });
  }
  if (last < src.length && src.slice(last).trim()) throw new Error(`Unexpected input: "${src.slice(last).trim()}"`);
  return tokens;
}

export function parseQuery(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const isKw = (kw) => { const p = peek(); return !!p && p.t === 'id' && p.v.toLowerCase() === kw; };

  function parseOr() {
    let left = parseAnd();
    while (isKw('or') || isOp('|') || isOp('||')) { next(); left = { k: 'or', l: left, r: parseAnd() }; }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (isKw('and') || isOp('&') || isOp('&&')) { next(); left = { k: 'and', l: left, r: parseNot() }; }
    return left;
  }
  function parseNot() {
    if (isKw('not') || isOp('!')) { next(); return { k: 'not', v: parseNot() }; }
    return parseCmp();
  }
  function parseCmp() {
    const left = parseOperand();
    for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
      if (isOp(op)) { next(); const right = parseOperand(); return { k: 'cmp', op, l: left, r: right }; }
    }
    // `col in [a, b]` / `col not in (...)`
    const nextTok = tokens[p + 1];
    const notIn = isKw('not') && nextTok && nextTok.t === 'id' && nextTok.v.toLowerCase() === 'in';
    if (isKw('in') || notIn) {
      let negate = false;
      if (isKw('not')) { next(); negate = true; }
      next(); // consume `in`
      const list = parseOperand();
      return { k: 'in', l: left, r: list, negate };
    }
    // A parenthesised group or a standalone method call is already a boolean.
    if (left.k === 'col' || left.k === 'lit' || left.k === 'list') {
      throw new Error('Expected a comparison operator');
    }
    return left;
  }
  function parseOperand() {
    if (isOp('(')) {
      next();
      const e = parseOr();
      if (!isOp(')')) throw new Error('Missing closing parenthesis');
      next();
      return e;
    }
    if (isOp('[')) {                        // list literal [a, b, c]
      next();
      const items = [];
      if (!isOp(']')) {
        items.push(parseOperand());
        while (isOp(',')) { next(); items.push(parseOperand()); }
      }
      if (!isOp(']')) throw new Error('Missing closing bracket');
      next();
      return { k: 'list', items };
    }
    const tok = next();
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.t === 'num') return { k: 'lit', v: tok.v };
    if (tok.t === 'str') return { k: 'lit', v: tok.v };
    if (tok.t === 'id') {
      const lower = tok.v.toLowerCase();
      if (lower === 'true') return { k: 'lit', v: true };
      if (lower === 'false') return { k: 'lit', v: false };
      if (lower === 'null' || lower === 'nan' || lower === 'none') return { k: 'lit', v: null };

      let ref = { k: 'col', name: tok.v };
      while (isOp('.')) {
        next();
        const meth = next();
        if (!meth || meth.t !== 'id') throw new Error('Expected method name');
        const name = meth.v.toLowerCase();
        if (name === 'str') {
          if (!isOp('.')) throw new Error('Expected . after .str');
          next();
          const fn = next();
          if (isOp('(')) {
            next();
            const arg = parseOperand();
            nextIf(')');
            ref = { k: 'method', name: fn.v.toLowerCase(), col: ref.name, arg };
          }
        } else if (isOp('(')) {
          next();
          let arg = null;
          const args = [];
          if (!isOp(')')) {
            args.push(parseOperand());
            while (isOp(',')) { next(); args.push(parseOperand()); }
          }
          nextIf(')');
          ref = { k: 'method', name, col: ref.name, arg: args[0] ?? null, args };
        }
      }
      return ref;
    }
    throw new Error(`Unexpected token "${tok.v}"`);
  }
  function nextIf(v) { if (isOp(v)) { next(); return true; } return false; }

  const ast = parseOr();
  if (p < tokens.length) throw new Error(`Unexpected token "${tokens[p].v}"`);
  return ast;
}

export function evalNode(node, df, i) {
  switch (node.k) {
    case 'and': return evalNode(node.l, df, i) && evalNode(node.r, df, i);
    case 'or': return evalNode(node.l, df, i) || evalNode(node.r, df, i);
    case 'not': return !evalNode(node.v, df, i);

    case 'lit': return node.v;
    case 'col': return df.values(node.name)[i];

    case 'in': {
      const raw = resolve(node.l, df, i);
      const list = node.r && node.r.k === 'list' ? node.r.items : [node.r];
      const hit = list.some((x) => {
        const target = x.k === 'lit' ? x.v : resolve(x, df, i);
        return String(target) === String(raw);
      });
      return node.negate ? !hit : hit;
    }

    case 'method': {
      const v = df.values(node.col)[i];
      const s = v === null || v === undefined ? '' : String(v);
      const lit = String((node.arg && node.arg.v) ?? '').toLowerCase();
      switch (node.name) {
        case 'isna': return isNull(v);
        case 'notna': return !isNull(v);
        case 'contains': return s.toLowerCase().includes(lit);
        case 'startswith': return s.toLowerCase().startsWith(lit);
        case 'endswith': return s.toLowerCase().endsWith(lit);
        case 'isin': {
          const list = node.args.length > 1
            ? node.args
            : (node.arg && node.arg.k === 'list' ? node.arg.items : [node.arg]);
          return list.some((x) => String(x && x.v) === s);
        }
        case 'abs': { const n = toNumber(v); return Number.isNaN(n) ? NaN : Math.abs(n); }
        default: return false;
      }
    }

    case 'cmp': {
      const l = resolve(node.l, df, i);
      const r = resolve(node.r, df, i);
      if (l === null || r === null) return false;
      const nl = toNumber(l), nr = toNumber(r);
      const useNum = !Number.isNaN(nl) && !Number.isNaN(nr);
      switch (node.op) {
        case '==': return useNum ? nl === nr : String(l) === String(r);
        case '!=': return useNum ? nl !== nr : String(l) !== String(r);
        case '>': return useNum ? nl > nr : String(l) > String(r);
        case '<': return useNum ? nl < nr : String(l) < String(r);
        case '>=': return useNum ? nl >= nr : String(l) >= String(r);
        case '<=': return useNum ? nl <= nr : String(l) <= String(r);
        default: return false;
      }
    }
    default: return false;
  }
}

function resolve(node, df, i) {
  if (node.k === 'lit') return node.v;
  if (node.k === 'col') return df.values(node.name)[i];
  return evalNode(node, df, i);
}
