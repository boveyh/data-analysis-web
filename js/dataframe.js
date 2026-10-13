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

/**
 * min/max over a numeric array, without the spread operator.
 *
 * `Math.min(...arr)` throws `RangeError: Maximum call stack size exceeded`
 * somewhere above ~125k elements (measured: 130,000 fails, 54,000 is fine).
 * Nothing here is bounded by the bundled datasets — the app accepts an upload
 * of any size — so a 200k-row column used to make `describe()`,
 * `aggregate('min')` and `histogram()` fail outright. A loop has no such limit
 * and is faster besides.
 *
 * NaN propagates exactly as `Math.min` would, because `aggregate()` relies on
 * that to report a non-numeric column rather than inventing a number.
 */
function minOf(nums) {
  let m = Infinity;
  for (let i = 0; i < nums.length; i++) {
    const v = nums[i];
    if (Number.isNaN(v)) return NaN;
    if (v < m) m = v;
  }
  return m;
}

function maxOf(nums) {
  let m = -Infinity;
  for (let i = 0; i < nums.length; i++) {
    const v = nums[i];
    if (Number.isNaN(v)) return NaN;
    if (v > m) m = v;
  }
  return m;
}

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

  /**
   * Sort rows by one column, returning a NEW frame.
   *
   * Decorate–sort–undecorate rather than sorting indices with a comparator.
   * The comparator form re-derived the key on every comparison — `toNumber()`
   * runs a regex on every call, and `localeCompare` allocated an options
   * object each time — so a 53,940-row numeric sort was doing roughly 1.7M
   * regex passes and took ~450 ms. Extracting the key once turns each
   * comparison into a subtraction or a string compare.
   *
   * `na_position` matches pandas' default: nulls sort last in BOTH directions.
   */
  sortValues(by, ascending = true) {
    const type = this.type(by);
    const col = this.data[by];
    const dir = ascending ? 1 : -1;
    const n = this.nrows;
    if (n < 2) return this.clone();

    const keys = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = col[i];
      if (isNull(v)) { keys[i] = { i, isNull: true, k: 0 }; continue; }
      let k;
      if (type === 'number') k = toNumber(v);
      else if (type === 'date') k = Date.parse(v);
      else k = String(v);
      keys[i] = { i, isNull: false, k };
    }

    /* one collator, not one options object per comparison */
    const collate = (type === 'number' || type === 'date')
      ? null
      : new Intl.Collator(undefined, { numeric: true });

    keys.sort((a, b) => {
      /* nulls always last, regardless of direction */
      if (a.isNull) return b.isNull ? a.i - b.i : 1;
      if (b.isNull) return -1;
      let c;
      if (collate) c = collate.compare(a.k, b.k);
      else if (a.k < b.k) c = -1;
      else if (a.k > b.k) c = 1;
      else c = 0;
      return c * dir;
    });

    return this.take(keys.map((e) => e.i));
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

    /* Convert each column ONCE, up front.
     *
     * `pairValues()` re-parsed both of its columns on every pair, and
     * `toNumber()` runs a regex on every value — so a 10-column frame paid for
     * each column nine times over, i.e. ~4.9M regex passes on 53,940 rows. With
     * the columns pre-converted, the pairwise pass is a plain scan and `corr()`
     * drops from ~218 ms to well under 100 ms on the same data. */
    const numeric = cols.map((c) => {
      const raw = this.data[c];
      const out = new Float64Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const v = raw[i];
        out[i] = isNull(v) ? NaN : toNumber(v);
      }
      return out;
    });

    for (let i = 0; i < cols.length; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < cols.length; j++) {
        const [a, b] = pairNumeric(numeric[i], numeric[j]);
        const r = method === 'spearman' ? spearman(a, b) : pearson(a, b);
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
    case 'min': { const n = vals.filter((v) => !isNull(v)); return n.length ? minOf(n.map(toNumber)) : null; }
    case 'max': { const n = vals.filter((v) => !isNull(v)); return n.length ? maxOf(n.map(toNumber)) : null; }
    case 'sum': { const n = vals.filter((v) => !isNull(v)); return n.length ? n.reduce((s, v) => s + toNumber(v), 0) : null; }
    case 'mean': { const n = vals.filter((v) => !isNull(v)); return n.length ? n.reduce((s, v) => s + toNumber(v), 0) / n.length : null; }
    case 'median': return quantile(vals.filter((v) => !isNull(v)).map(toNumber), 0.5);
    case 'std': return stddev(vals.filter((v) => !isNull(v)).map(toNumber));
    default: return null;
  }
}

/* ----------------------------- statistics -------------------------------- */

/**
 * The q-quantile of an ALREADY-SORTED numeric array (linear interpolation,
 * matching numpy's default rule).
 *
 * Split out from `quantile()` so `describe()` can sort a column once and read
 * three quantiles from it. `quantile()` re-sorts on every call, and calling it
 * three times per column was the single most expensive thing `describe()` did —
 * on the 53,940-row diamonds dataset it was ~250 ms of a ~275 ms total.
 */
function quantileSorted(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function quantile(sortedOrRaw, q) {
  const arr = sortedOrRaw.map(toNumber).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  return quantileSorted(arr, q);
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
  /* one sort, three reads — see quantileSorted */
  const sorted = nums.slice().sort((a, b) => a - b);
  return {
    count,
    mean: sum / count,
    std: stddev(nums),
    min: sorted[0],
    q25: quantileSorted(sorted, 0.25),
    q50: quantileSorted(sorted, 0.5),
    q75: quantileSorted(sorted, 0.75),
    max: sorted[sorted.length - 1],
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

/**
 * Pairwise-complete observations from two already-converted numeric arrays
 * (NaN marks a missing value). Same contract as `pairValues`, minus the
 * re-parsing — see the note in `corr()`.
 */
function pairNumeric(a, b) {
  const n = Math.min(a.length, b.length);
  const x = [], y = [];
  for (let i = 0; i < n; i++) {
    const va = a[i], vb = b[i];
    if (Number.isNaN(va) || Number.isNaN(vb)) continue;
    x.push(va); y.push(vb);
  }
  return [x, y];
}

/* ------------------------------ histogram -------------------------------- */

export function histogram(values, bins = 20) {
  const nums = values.filter((v) => !isNull(v)).map(toNumber).filter((v) => !Number.isNaN(v));
  if (!nums.length) return { edges: [], counts: [], centers: [] };
  const min = minOf(nums), max = maxOf(nums);
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

/* ------------------------ more inferential statistics --------------------- */
/* Everything below reuses the distribution tails above — no new maths is
 * introduced, only new test statistics that funnel into the same gammaln /
 * ibeta core. Critical values are pinned in tools/selftest.mjs.
 */

const cleanNums = (arr) =>
  arr.filter((v) => !isNull(v)).map(toNumber).filter((v) => !Number.isNaN(v));

const meanOf = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

/** Standard normal CDF, built from the regularised gamma already here. */
export function normalCdf(z) {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const q = gammaQ(0.5, (z * z) / 2);
  return z >= 0 ? 1 - 0.5 * q : 0.5 * q;
}

/** Inverse standard normal CDF (Acklam's rational approximation, |ε| < 1.15e-9). */
export function probit(p) {
  if (!(p > 0) || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Two-tailed significance test for a Pearson correlation (t with n−2 df). */
export function pearsonTest(a, b) {
  const [x, y] = pairValues(a, b);
  const n = x.length;
  if (n < 3) return null;
  const r = pearson(x, y);
  if (r === null) return null;
  const df = n - 2;
  if (Math.abs(r) >= 1) return { r, n, df, t: Infinity, p: 0 };
  const t = r * Math.sqrt(df / (1 - r * r));
  return { r, n, df, t, p: tPValue(t, df) };
}

/** Tie correction Σ(t³ − t), shared by the rank-based tests below. */
function tieSum(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let s = 0;
  for (const t of counts.values()) if (t > 1) s += t ** 3 - t;
  return s;
}

/**
 * Mann-Whitney U (Wilcoxon rank-sum) — the non-parametric stand-in for
 * Welch's t-test. Normal approximation with tie correction and a continuity
 * correction; exact enough for the sample sizes a browser tool sees.
 */
export function mannWhitneyU(a, b) {
  const x = cleanNums(a), y = cleanNums(b);
  const n1 = x.length, n2 = y.length;
  if (n1 < 1 || n2 < 1) return null;

  const all = [...x, ...y];
  const ranks = rank(all);
  let r1 = 0;
  for (let i = 0; i < n1; i++) r1 += ranks[i];
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;

  const n = n1 + n2;
  const mu = (n1 * n2) / 2;
  const tie = tieSum(all);
  const varU = ((n1 * n2) / 12) * ((n + 1) - (n > 1 ? tie / (n * (n - 1)) : 0));

  const base = {
    u: Math.min(u1, u2), u1, u2, n1, n2,
    median1: quantile(x, 0.5), median2: quantile(y, 0.5),
  };
  if (!(varU > 0)) return { ...base, z: 0, p: 1, method: 'exact-ties' };

  const d = u1 - mu;
  const z = (d - 0.5 * Math.sign(d)) / Math.sqrt(varU);
  return {
    ...base, z, p: 2 * (1 - normalCdf(Math.abs(z))),
    method: 'normal',
    rankBiserial: (2 * u1) / (n1 * n2) - 1,
  };
}

/** Kruskal-Wallis H — the non-parametric one-way ANOVA. Chi-square tail. */
export function kruskalWallis(groups) {
  const gs = groups.map(cleanNums).filter((g) => g.length);
  const k = gs.length;
  const n = gs.reduce((s, g) => s + g.length, 0);
  if (k < 2 || n < 3) return null;

  const all = gs.flat();
  const ranks = rank(all);
  let idx = 0, acc = 0;
  for (const g of gs) {
    let s = 0;
    for (let i = 0; i < g.length; i++) s += ranks[idx++];
    acc += (s * s) / g.length;
  }
  let h = (12 / (n * (n + 1))) * acc - 3 * (n + 1);

  const corr = 1 - tieSum(all) / (n ** 3 - n);
  if (corr > 0) h /= corr;

  const df = k - 1;
  return {
    h, df, p: chi2PValue(h, df), k, n,
    medians: gs.map((g) => quantile(g, 0.5)),
    sizes: gs.map((g) => g.length),
  };
}

/**
 * Levene's test for equal variance. Defaults to centring on the median
 * (Brown-Forsythe), which is the robust variant scipy.levene also defaults
 * to; it is simply a one-way ANOVA on the absolute deviations.
 */
export function leveneTest(groups, center = 'median') {
  const gs = groups.map(cleanNums).filter((g) => g.length >= 2);
  if (gs.length < 2) return null;
  const z = gs.map((g) => {
    const c = center === 'mean' ? meanOf(g) : quantile(g, 0.5);
    return g.map((v) => Math.abs(v - c));
  });
  const a = oneWayAnova(z);
  if (!a) return null;
  return { w: a.f, df1: a.dfBetween, df2: a.dfWithin, p: a.p, center, k: a.k, n: a.n };
}

/** Jarque-Bera normality test — chi-square with 2 df. */
export function jarqueBera(values) {
  const x = cleanNums(values);
  const n = x.length;
  if (n < 4) return null;
  const m = meanOf(x);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of x) {
    const d = v - m, d2 = d * d;
    m2 += d2; m3 += d2 * d; m4 += d2 * d2;
  }
  m2 /= n; m3 /= n; m4 /= n;
  if (!(m2 > 0)) return null;
  const skew = m3 / Math.pow(m2, 1.5);
  const kurt = m4 / (m2 * m2);
  const jb = (n / 6) * (skew * skew + ((kurt - 3) ** 2) / 4);
  return {
    jb, df: 2, p: chi2PValue(jb, 2), n,
    skew, kurtosis: kurt, excessKurtosis: kurt - 3,
  };
}

/**
 * Normal QQ coordinates: quantiles of the data against the matching normal
 * quantiles, plus the quartile reference line scipy's probplot draws.
 */
export function qqData(values, maxPoints = 500) {
  const x = cleanNums(values).slice().sort((a, b) => a - b);
  const n = x.length;
  if (n < 5) return null;

  const step = Math.max(1, Math.ceil(n / maxPoints));
  const points = [];
  for (let i = 0; i < n; i += step) {
    points.push([probit((i + 0.5) / n), x[i]]);
  }

  // Reference line through the quartiles (against theoretical quartiles).
  const q1 = quantile(x, 0.25), q3 = quantile(x, 0.75);
  const zq = probit(0.75);                     // ±0.6745
  const slope = (q3 - q1) / (2 * zq);
  const intercept = quantile(x, 0.5);
  return { points, slope, intercept, n, sampled: points.length, step };
}

/* ------------------------------ regression -------------------------------- */

/** Ordinary least squares on pairwise-complete observations. */
export function linearFit(x, y) {
  const xs = [], ys = [];
  for (let i = 0; i < x.length; i++) {
    if (isNull(x[i]) || isNull(y[i])) continue;
    const a = toNumber(x[i]), b = toNumber(y[i]);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    xs.push(a); ys.push(b);
  }
  const n = xs.length;
  if (n < 2) return null;
  const mx = meanOf(xs), my = meanOf(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = pearson(xs, ys);
  return {
    slope, intercept, n,
    r, r2: r === null ? null : r * r,
    residuals: ys.map((v, i) => v - (slope * xs[i] + intercept)),
    predicted: xs.map((v) => slope * v + intercept),
    xRange: [minOf(xs), maxOf(xs)],
  };
}

/* ------------------------------ time series ------------------------------- */

/** Split a value into [year, monthIndex, day] without timezone surprises. */
function dateParts(v) {
  if (v instanceof Date) return [v.getFullYear(), v.getMonth(), v.getDate()];
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return [d.getFullYear(), d.getMonth(), d.getDate()];
}

const isoDate = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Period label a row falls into: 'D' day, 'W' ISO week start, 'M' month. */
export function periodKey(v, freq) {
  const parts = dateParts(v);
  if (!parts) return null;
  let [y, m, d] = parts;
  if (freq === 'M') return isoDate(y, m, 1);
  if (freq === 'W') {
    const dt = new Date(y, m, d);
    const back = (dt.getDay() + 6) % 7;        // Monday-start weeks
    const w = new Date(y, m, d - back);
    y = w.getFullYear(); m = w.getMonth(); d = w.getDate();
  }
  return isoDate(y, m, d);
}

/**
 * pandas' `df.resample(freq).agg(...)`: bucket rows by period and aggregate.
 * The period column keeps the original date column's name, like pandas
 * turning the datetime index into the result's index.
 */
export function resample(df, dateCol, freq, aggs = []) {
  if (!df.has(dateCol)) throw new Error(`resample: unknown column "${dateCol}"`);
  const PERIOD = '\u0001period';
  const data = {};
  for (const n of df.colNames) data[n] = df.data[n].slice();
  data[PERIOD] = df.values(dateCol).map((v) => periodKey(v, freq));

  const tmp = new DataFrame([...df.colNames, PERIOD], data, df.meta);
  const out = tmp.groupby(
    [PERIOD],
    aggs.length ? aggs : df.numericCols.map((c) => ({ col: c, fn: 'mean' })),
  );
  const renamed = out.rename({ [PERIOD]: dateCol });
  return renamed.sortValues(dateCol, true);
}

const ROLL_FUNCS = ['mean', 'std', 'sum', 'min', 'max', 'median'];

/**
 * pandas' `series.rolling(window).mean()` — trailing window, leading
 * positions left null exactly as pandas does with the default min_periods.
 */
export function rolling(values, window, fn = 'mean') {
  if (!(window >= 1)) throw new Error('rolling: window must be >= 1');
  if (!ROLL_FUNCS.includes(fn)) throw new Error(`rolling: unknown fn "${fn}"`);
  const nums = values.map((v) => (isNull(v) ? NaN : toNumber(v)));
  const out = new Array(nums.length).fill(null);
  for (let i = window - 1; i < nums.length; i++) {
    const win = nums.slice(i - window + 1, i + 1);
    if (win.some(Number.isNaN)) continue;
    if (fn === 'mean') out[i] = meanOf(win);
    else if (fn === 'sum') out[i] = win.reduce((s, v) => s + v, 0);
    else if (fn === 'min') out[i] = minOf(win);
    else if (fn === 'max') out[i] = maxOf(win);
    else if (fn === 'median') out[i] = quantile(win, 0.5);
    else out[i] = stddev(win);
  }
  return out;
}

/** Period-over-period change in %, matching `series.pct_change()`. */
export function pctChange(values) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = isNull(values[i]) ? NaN : toNumber(values[i]);
    if (Number.isNaN(v)) { prev = null; continue; }
    if (prev !== null && prev !== 0) out[i] = (v - prev) / prev;
    prev = v;
  }
  return out;
}

/** Lagged copy of a column, matching `series.shift(periods)`. */
export function shift(values, periods = 1) {
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const j = i - periods;
    out[i] = j >= 0 && j < values.length ? values[j] : null;
  }
  return out;
}

/* ------------------------------- pivot table ------------------------------ */

export const PIVOT_AGGS = ['mean', 'sum', 'count', 'median', 'min', 'max', 'std', 'nunique'];

/**
 * Excel-style pivot: fields into rows / columns, one value field aggregated
 * per cell. Multiple row or column fields are joined into a composite key,
 * which is what a two-level drag target does in a spreadsheet anyway.
 */
/**
 * Cartesian-product budget for `pivotTable`.
 *
 * A pivot is inherently O(rows × cols): every cell must be produced before it
 * can be drawn. Two wide axes therefore ask for an unbounded amount of work —
 * pivoting a 6,000-value timestamp against itself means 36 million cells, which
 * froze the tab for 33 seconds in profiling. Callers that render the grid pass
 * a budget and get `tooLarge` back instead of a hang.
 */
export const MAX_PIVOT_CELLS = 10000;

export function pivotTable(df, { rows = [], cols = [], value = null, agg = 'mean', maxCells = MAX_PIVOT_CELLS } = {}) {
  if (!rows.length || !value || !df.has(value)) return null;
  if (!PIVOT_AGGS.includes(agg)) return null;

  const keyOf = (fields, i) => fields
    .map((f) => { const v = df.values(f)[i]; return isNull(v) ? '' : String(v); })
    .join(' / ');

  const rowSet = new Set(), colSet = new Set();
  const cells = new Map();
  const valSeries = df.values(value);

  for (let i = 0; i < df.nrows; i++) {
    const r = keyOf(rows, i);
    const c = cols.length ? keyOf(cols, i) : '';
    rowSet.add(r); colSet.add(c);
    const k = `${r}\u0001${c}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(valSeries[i]);
  }

  const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const rowKeys = [...rowSet].sort(cmp);
  const colKeys = [...colSet].sort(cmp);

  const cellCount = rowKeys.length * colKeys.length;
  if (cellCount > maxCells) {
    return {
      rowKeys, colKeys, grid: null, tooLarge: true, cellCount, maxCells,
      agg, value, rows, cols, single: !cols.length,
    };
  }

  const grid = rowKeys.map((r) => colKeys.map((c) => {
    const bucket = cells.get(`${r}\u0001${c}`);
    if (!bucket || !bucket.length) return null;
    return aggregate(bucket, bucket.map((_, i) => i), agg);
  }));

  return { rowKeys, colKeys, grid, agg, value, rows, cols, single: !cols.length };
}

/* ---------------------------- data hygiene -------------------------------- */

/**
 * Columns that *look* numeric but contain a minority of junk. pandas silently
 * makes these `object` and every downstream numeric op then fails on the whole
 * column; surfacing it up front is far kinder than the silent degradation.
 */
export function columnTypeConflicts(df, tolerance = 0.05) {
  const out = [];
  for (const c of df.columns) {
    if (c.type === 'number') continue;
    const vals = cleanAndRaw(df.values(c.name));
    if (vals.length < 5) continue;

    let numeric = 0;
    const junk = new Map();
    for (const v of vals) {
      if (!Number.isNaN(toNumber(v))) { numeric++; continue; }
      const k = String(v);
      junk.set(k, (junk.get(k) || 0) + 1);
    }
    const rate = numeric / vals.length;
    if (rate < 1 - tolerance) continue;

    out.push({
      name: c.name,
      numeric,
      total: vals.length,
      rate,
      samples: [...junk.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([v, n]) => ({ value: v, count: n })),
    });
  }
  return out.sort((a, b) => b.rate - a.rate);
}

function cleanAndRaw(values) { return values.filter((v) => !isNull(v)); }

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
