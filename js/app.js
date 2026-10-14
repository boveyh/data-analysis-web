/* =============================================================================
 * app.js — PandaLens application controller.
 * Wires the DataFrame engine, the parsers, the charts and the bilingual UI
 * into one pipeline:  raw  ->  cleaning ops  ->  filters  ->  views/charts.
 * ========================================================================== */

import { t, setLang, getLang, applyStatic } from './i18n.js';
import {
  DataFrame, histogram, describeSeries, quantile,
  chiSquareTest, welchTTest, oneWayAnova, missingMatrix, numericMatrix,
  pearsonTest, mannWhitneyU, kruskalWallis, leveneTest, jarqueBera, qqData,
  linearFit, resample, rolling, pivotTable, columnTypeConflicts, PIVOT_AGGS,
  MAX_PIVOT_CELLS,
} from './dataframe.js';
import { parseText } from './parse.js';
import {
  loadXLSX, isWorkbookFile, readWorkbook, sheetNames, sheetToColumns, writeWorkbook,
} from './xlsx.js';
import * as CH from './charts.js';

/* ------------------------------- helpers --------------------------------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(tag, attrs = {}, html) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('data-')) n.setAttribute(k, v);
    else n[k] = v;
  }
  if (html !== undefined) n.innerHTML = html;
  return n;
}

const OPTEXT = { '==': '=', '!=': '≠', '>': '>', '<': '<', '>=': '≥', '<=': '≤' };

const AGG_LABEL = {
  zh: { count: '计数', sum: '求和', mean: '均值', median: '中位数', min: '最小值', max: '最大值', std: '标准差', nunique: '唯一值数' },
  en: { count: 'count', sum: 'sum', mean: 'mean', median: 'median', min: 'min', max: 'max', std: 'std', nunique: 'nunique' },
};
const aggLabel = (fn) => AGG_LABEL[getLang()][fn] || fn;

const AGG_SQL = { count: 'count', sum: 'sum', mean: 'mean', median: 'median', min: 'min', max: 'max', std: 'std', nunique: 'nunique' };

/**
 * The bundled catalogue of well-known public datasets, ordered from small and
 * simple to large and messy so the list doubles as a suggested tour. Every CSV
 * lives in data/ and is parsed by the same reader used for uploads, so `rows`
 * and `cols` here are just labels for the picker — regenerate them with
 * `node tools/dataset-stats.mjs` after changing any file.
 */
const SAMPLE_DEFS = [
  { id: 'sales',     file: 'data/sales.csv',     icon: '🛒', rows: 210,   cols: 16, key: 'sample.sales' },
  { id: 'iris',      file: 'data/iris.csv',      icon: '🌸', rows: 150,   cols: 5,  key: 'sample.iris' },
  { id: 'tips',      file: 'data/tips.csv',      icon: '🍽️', rows: 244,   cols: 7,  key: 'sample.tips' },
  { id: 'titanic',   file: 'data/titanic.csv',   icon: '🚢', rows: 891,   cols: 15, key: 'sample.titanic' },
  { id: 'penguins',  file: 'data/penguins.csv',  icon: '🐧', rows: 344,   cols: 7,  key: 'sample.penguins' },
  { id: 'flights',   file: 'data/flights.csv',   icon: '✈️', rows: 144,   cols: 3,  key: 'sample.flights' },
  { id: 'mpg',       file: 'data/mpg.csv',       icon: '🚗', rows: 398,   cols: 9,  key: 'sample.mpg' },
  { id: 'gapminder', file: 'data/gapminder.csv', icon: '🌍', rows: 1704,  cols: 6,  key: 'sample.gapminder' },
  { id: 'taxis',     file: 'data/taxis.csv',     icon: '🚕', rows: 6433,  cols: 14, key: 'sample.taxis' },
  { id: 'diamonds',  file: 'data/diamonds.csv',  icon: '💎', rows: 53940, cols: 10, key: 'sample.diamonds' },
];

const API_MAP = [
  ['载入 CSV', 'Load CSV', 'pd.read_csv("file.csv")'],
  ['载入 JSON', 'Load JSON', 'pd.read_json("file.json")'],
  ['查看前几行', 'Preview rows', 'df.head(10)'],
  ['数据形状', 'Shape', 'df.shape'],
  ['字段类型', 'Dtypes', 'df.dtypes'],
  ['描述统计', 'Descriptive stats', 'df.describe()'],
  ['缺失值统计', 'Missing values', 'df.isna().sum()'],
  ['频数分布', 'Value counts', 'df["col"].value_counts()'],
  ['条件筛选', 'Boolean filter', 'df[df["revenue"] > 1000]'],
  ['表达式查询', 'Query', 'df.query("revenue > 1000 and region == \'East\'")'],
  ['排序', 'Sort', 'df.sort_values("revenue", ascending=False)'],
  ['分组聚合', 'Group by + agg', 'df.groupby("region")["revenue"].sum()'],
  ['数据透视', 'Pivot / crosstab', 'pd.crosstab(df["region"], df["category"])'],
  ['相关系数', 'Correlation', 'df.corr(numeric_only=True)'],
  ['去重', 'Drop duplicates', 'df.drop_duplicates(subset=["order_id"])'],
  ['删除缺失', 'Drop NA', 'df.dropna(subset=["rating"])'],
  ['填充缺失', 'Fill NA', 'df["rating"].fillna(df["rating"].mean())'],
  ['类型转换', 'Cast type', 'df["units"].astype(float)'],
  ['重命名列', 'Rename', 'df.rename(columns={"revenue": "sales"})'],
  ['删除列', 'Drop column', 'df.drop(columns=["cost"])'],
  ['直方图', 'Histogram', 'df["revenue"].plot.hist(bins=20)'],
  ['分组柱状图', 'Grouped bar', 'df.groupby("category")["revenue"].sum().plot.bar()'],
  ['箱线图', 'Box plot', 'df.boxplot(column="revenue", by="region")'],
  ['散点图', 'Scatter', 'df.plot.scatter(x="units", y="revenue")'],
  ['导出 CSV', 'Export CSV', 'df.to_csv("out.csv", index=False)'],
];

/* -------------------------------- state ---------------------------------- */

const state = {
  raw: null,            // untouched DataFrame as loaded
  df: null,             // current frame after cleaning ops
  view: null,           // current frame after filters
  rawName: 'sales.csv',
  source: 'sales',

  cleanOps: [],         // [{kind, ...}]  -> rebuild() replays these onto raw
  filters: [],          // [{col, op, value}]
  queryText: '',
  queryError: null,

  sort: { col: null, asc: true },
  page: 1,
  pageSize: 50,
  search: '',
  hiddenCols: new Set(),

  activeTab: 'table',
  chartType: 'bar',
  chartModel: null,
  /* pivot builder state — shared by the Pivot panel and the heatmap's
     "pivot aggregation" mode, so it is configured in exactly one place */
  pivot: { rows: [], cols: [], value: null, agg: 'mean' },
  testSummary: null,    // last structured test run, reused by the HTML report
  /* the open .xlsx, if any: {file, XLSX, wb, names, frames, active}. Holds the
     parsed workbook plus lazily-converted sheets. Never serialised into the
     URL, and cleared as soon as a CSV or a bundled sample is loaded. */
  workbook: null,
  codeSteps: [],        // [{label, code}]
  currentCode: '',
  echartsReady: false,

  history: [],          // pipeline snapshots *before* each change
  future: [],           // undone snapshots, for redo
  autoFilledFor: null,
  conflictDismissedFor: null,
  shareUrl: '',
};

/* ------------------------------ undo / redo ------------------------------- */
/* The whole analysis is derived from three lists (cleanOps, filters, queryText),
 * so undoing is just "keep the previous value of those three". Snapshots stay
 * tiny even on a 50k-row frame because they only hold the recipe, never data. */

const HISTORY_LIMIT = 60;

function snapshotPipeline(label, params) {
  return {
    label,
    params: params || null,
    cleanOps: state.cleanOps.map((o) => ({ ...o })),
    filters: state.filters.map((f) => ({ ...f })),
    queryText: state.queryText,
  };
}

function restorePipeline(snap) {
  state.cleanOps = snap.cleanOps.map((o) => ({ ...o }));
  state.filters = snap.filters.map((f) => ({ ...f }));
  state.queryText = snap.queryText || '';
  $('#queryInput').value = state.queryText;
  state.page = 1;
  rebuild();
  renderAfterFilter();
  renderHistory();
}

/** Record the pipeline as it stands now — call BEFORE mutating it. */
function commit(label, params) {
  pushSnapshot(snapshotPipeline(label, params));
}

function pushSnapshot(snap) {
  state.history.push(snap);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future.length = 0;
  renderHistory();
}

function undo() {
  if (!state.history.length) return false;
  const prev = state.history.pop();
  state.future.push(snapshotPipeline(prev.label, prev.params));
  restorePipeline(prev);
  syncUrl();
  toast(t('hist.undone', { what: t(prev.label, prev.params || {}) }), 'info');
  return true;
}

function redo() {
  if (!state.future.length) return false;
  const next = state.future.pop();
  state.history.push(snapshotPipeline(next.label, next.params));
  restorePipeline(next);
  syncUrl();
  toast(t('hist.redone', { what: t(next.label, next.params || {}) }), 'info');
  return true;
}

/** Human-readable name for each cleaning op, reused by the pipeline list. */
function cleanOpLabel(op) {
  switch (op.kind) {
    case 'dropna': return { key: 'hist.dropna', params: { cols: op.subset.length ? op.subset.join(', ') : '—' } };
    case 'fillna': return { key: 'hist.fillna', params: { col: op.col, value: op.value } };
    case 'astype': return { key: 'hist.astype', params: { col: op.col, type: op.type } };
    case 'dropdup': return { key: 'hist.dropdup', params: { cols: op.subset.length ? op.subset.join(', ') : '—' } };
    case 'dropcol': return { key: 'hist.dropcol', params: { cols: op.cols.join(', ') } };
    case 'rename': return { key: 'hist.rename', params: { col: op.col, name: op.value } };
    default: return { key: 'hist.step', params: {} };
  }
}

/** The current recipe, as an ordered list a reader can follow top to bottom. */
function pipelineSteps() {
  const steps = [{ key: 'hist.load', params: { name: state.rawName } }];
  for (const op of state.cleanOps) steps.push(cleanOpLabel(op));
  for (const f of state.filters) {
    steps.push({ key: 'hist.stepFilter', params: { col: f.col, op: OPTEXT[f.op] || f.op, value: f.value } });
  }
  if (state.queryText.trim()) steps.push({ key: 'hist.stepQuery', params: { q: state.queryText } });
  return steps;
}

function renderHistory() {
  const host = $('#historyList');
  if (!host) return;
  host.innerHTML = '';

  const steps = pipelineSteps();
  steps.forEach((s, i) => {
    const li = el('li', { class: `hist-item${i === steps.length - 1 ? ' is-current' : ''}` });
    li.appendChild(el('span', { class: 'hist-n', text: String(i + 1) }));
    li.appendChild(el('span', { class: 'hist-text', text: t(s.key, s.params) }));
    if (i > 0) {
      const back = el('button', { class: 'hist-back', type: 'button', title: t('hist.rewindTo') });
      back.textContent = '↺';
      back.addEventListener('click', () => rewindTo(i));
      li.appendChild(back);
    }
    host.appendChild(li);
  });

  const u = $('#btnUndo');
  const r = $('#btnRedo');
  if (u) { u.disabled = !state.history.length; u.title = t('hist.undoTip', { n: state.history.length }); }
  if (r) { r.disabled = !state.future.length; r.title = t('hist.redoTip', { n: state.future.length }); }
  const badge = $('#histCount');
  if (badge) {
    badge.hidden = steps.length <= 1;
    badge.textContent = t('hist.steps', { n: steps.length - 1 });
  }
}

/**
 * Jump straight back to the pipeline as it looked after step `n` by replaying
 * the recipe prefix. Every step is a pure function of its predecessors, so
 * truncating the lists is enough — no need to unwind anything.
 */
function rewindTo(n) {
  const keep = Math.max(0, n - 1);                       // everything after "load"
  const nClean = Math.min(state.cleanOps.length, keep);
  const nFilter = Math.min(state.filters.length, keep - nClean);
  const keepQuery = keep - nClean - nFilter > 0;

  commit('hist.rewind', { n });
  state.cleanOps = state.cleanOps.slice(0, nClean);
  state.filters = state.filters.slice(0, nFilter);
  state.queryText = keepQuery ? state.queryText : '';
  $('#queryInput').value = state.queryText;
  rebuild();
  renderAfterFilter();
  pushCode('filter', t('hist.rewindCode', { n }));
  syncUrl();
}

/* --------------------------- shareable URL state -------------------------- */
/* The link carries the recipe, never the rows — a shared URL can describe
 * "titanic, not-survived males over 30" without shipping anyone's data. */

function encodePayload(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePayload(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function currentPayload() {
  return {
    v: 1,
    s: state.source || null,
    c: state.cleanOps,
    f: state.filters,
    q: state.queryText,
    t: state.chartType,
    x: $('#chX') ? $('#chX').value : '',
    y: $('#chY') ? $('#chY').value : '',
    g: $('#chSeries') ? $('#chSeries').value : '',
    a: $('#chAgg') ? $('#chAgg').value : '',
    o: $('#chSort') ? $('#chSort').value : '',
    k: $('#chTop') ? $('#chTop').value : '',
    b: $('#chBins') ? $('#chBins').value : '',
    m: $('#chNumCols') ? [...$('#chNumCols').selectedOptions].map((o) => o.value) : [],
    tab: state.activeTab,
    lang: getLang(),
  };
}

/** Mirror the current view into the address bar (replace, so Back still works). */
function syncUrl() {
  if (!state.raw) return;
  try {
    const hash = `#s=${encodePayload(currentPayload())}`;
    if (location.hash !== hash) window.history.replaceState(null, '', hash);
    state.shareUrl = location.href;
  } catch { /* a URL we cannot encode is not worth breaking the app over */ }
}

function payloadFromUrl() {
  const m = /[#&]s=([^&]+)/.exec(location.hash || '');
  if (!m) return null;
  try {
    const p = decodePayload(m[1]);
    return p && p.v === 1 ? p : null;
  } catch { return null; }
}

/* ----------------------------- chart → filter ----------------------------- */
/* Clicking a mark builds the same filter the user could have typed by hand,
 * which keeps the generated pandas honest. */

const DRILLABLE = ['bar', 'grouped', 'line', 'area', 'pie', 'box', 'hist', 'missing'];

function addChartFilter(params) {
  const df = state.view;
  if (!df) return false;
  const type = state.chartType;
  const xCol = $('#chX') ? $('#chX').value : '';
  const sCol = $('#chSeries') ? $('#chSeries').value : '';
  const model = state.chartModel || {};
  const added = [];

  if (type === 'missing') {
    const col = model.cols ? model.cols[params.value && params.value[0]] : null;
    if (!col) return false;
    added.push({ col, op: 'isna', value: '' });
  } else if (type === 'hist') {
    const i = params.dataIndex;
    if (!model.edges || model.edges[i] === undefined || model.edges[i + 1] === undefined) return false;
    added.push({ col: model.col, op: '>=', value: String(model.edges[i]) });
    added.push({ col: model.col, op: '<', value: String(model.edges[i + 1]) });
  } else {
    if (!xCol || !df.has(xCol) || params.name === undefined || params.name === null) return false;
    added.push({ col: xCol, op: '==', value: String(params.name) });
    if (sCol && params.seriesName && df.has(sCol)) {
      const sVal = String(params.seriesName);
      if (df.unique(sCol).slice(0, 60).some((v) => String(v) === sVal)) {
        added.push({ col: sCol, op: '==', value: sVal });
      }
    }
  }

  commit('hist.clickFilter', { col: added[0].col });
  for (const f of added) state.filters.push(f);
  rebuild();
  pushCode('filter', added.map(filterCode).join('\n'));
  renderAfterFilter();
  const n = state.view.nrows.toLocaleString();
  toast(t('filter.drilled', { n }), 'ok');
  syncUrl();
  return true;
}

function wireChartClick() {
  const type = state.chartType;
  if (!DRILLABLE.includes(type)) {
    CH.bindChartClick($('#mainChart'), null);
    return;
  }
  CH.bindChartClick($('#mainChart'), (p) => { addChartFilter(p); });
}

/* --------------------------- parsing off-thread --------------------------- */
/* A 50 MB CSV takes seconds to tokenise; doing it on the main thread freezes
 * the UI. The worker is optional — if it cannot start (file://, old browser)
 * we quietly fall back to the synchronous path. */

let parseWorker = null;
let parseSeq = 0;
const pendingParses = new Map();

function ensureParseWorker() {
  if (parseWorker !== null) return parseWorker;
  try {
    const w = new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, ok, columns, data, error } = e.data || {};
      const slot = pendingParses.get(id);
      if (!slot) return;
      pendingParses.delete(id);
      if (ok) slot.resolve({ columns, data });
      else slot.reject(new Error(error || 'parse-failed'));
    };
    w.onerror = () => {
      for (const [, slot] of pendingParses) slot.reject(new Error('worker-failed'));
      pendingParses.clear();
      try { w.terminate(); } catch { /* already gone */ }
      parseWorker = false;
      // a worker that fails once should not be retried on every load
    };
    parseWorker = w;
  } catch {
    parseWorker = false;
  }
  return parseWorker;
}

async function parseAsync(text, name) {
  const w = ensureParseWorker();
  if (w) {
    try {
      const id = ++parseSeq;
      return await new Promise((resolve, reject) => {
        pendingParses.set(id, { resolve, reject });
        w.postMessage({ id, text, name });
      });
    } catch {
      /* Worker unavailable (file:// origin, CSP, crash). Re-running the parser
       * on the main thread keeps the feature working — just without the
       * concurrency win. Genuine parse errors resurface identically below. */
    }
  }
  return parseText(text, name);
}

/* --------------------------- data ingestion ------------------------------- */

function setDataFrame(columns, data, name, sourceId, { keepWorkbook = false } = {}) {
  state.raw = new DataFrame(columns, data, { name });
  state.rawName = name;
  state.source = sourceId || null;
  state.conflictDismissedFor = null;
  /* Loading a CSV (or a bundled sample) closes any open workbook. Switching
     between the sheets of one workbook must not, hence the flag. */
  if (!keepWorkbook) state.workbook = null;
  /* any newly loaded frame supersedes the "link could not be restored" banner */
  if ($('#shareNotice')) $('#shareNotice').hidden = true;
  resetPipeline(false);
  refreshAll();
  syncUrl();
}

function resetPipeline(rerender = true) {
  state.cleanOps = [];
  state.filters = [];
  state.queryText = '';
  state.queryError = null;
  $('#queryInput').value = '';
  state.sort = { col: null, asc: true };
  state.page = 1;
  state.search = '';
  $('#tableSearch').value = '';
  state.hiddenCols = new Set();
  state.codeSteps = [];
  state.currentCode = '';
  state.history = [];
  state.future = [];
  rebuild();
  pushCode('load', loadCode());
  renderHistory();
  if (rerender) refreshAll();
}

async function loadSample(id) {
  const def = SAMPLE_DEFS.find((s) => s.id === id);
  if (!def) return;
  showLoading(t('sample.loading'));
  /* any deliberate load supersedes a stale "this link could not be restored"
     banner; during boot this runs before the banner is ever shown */
  if ($('#shareNotice')) $('#shareNotice').hidden = true;
  try {
    const res = await fetch(def.file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = await parseAsync(text, def.file);
    if (!parsed || !parsed.columns.length) throw new Error('empty');
    setDataFrame(parsed.columns, parsed.data, def.file.split('/').pop(), id);
    toast(t('load.done', { name: def.file.split('/').pop(), rows: state.raw.nrows, cols: state.raw.ncols }), 'ok');
  } catch (err) {
    toast(t('sample.fail'), 'err');
  } finally {
    hideLoading();
  }
}

async function loadText(text, name) {
  let parsed;
  try {
    parsed = await parseAsync(text, name);
  } catch {
    toast(t('load.empty'), 'err');
    return false;
  }
  if (!parsed || !parsed.columns.length || !parsed.columns.some((c) => parsed.data[c].length)) {
    toast(t('load.empty'), 'err');
    return false;
  }
  setDataFrame(parsed.columns, parsed.data, name, null);
  toast(t('load.done', { name, rows: state.raw.nrows, cols: state.raw.ncols }), 'ok');
  return true;
}

function readFile(file) {
  showLoading(t('load.file'));
  const reader = new FileReader();
  /* A workbook is a zip: reading it as text would corrupt every byte above
     U+007F. Branch on the extension before the reader is even opened. */
  const asWorkbook = isWorkbookFile(file.name);
  reader.onload = async () => {
    try {
      if (asWorkbook) await loadWorkbookFile(reader.result, file.name);
      else await loadText(String(reader.result), file.name);
    } catch { toast(t('paste.failed'), 'err'); }
    finally { hideLoading(); }
  };
  reader.onerror = () => { hideLoading(); toast(t('paste.failed'), 'err'); };
  if (asWorkbook) reader.readAsArrayBuffer(file);
  else reader.readAsText(file, 'utf-8');
}

/* ------------------------------- workbooks -------------------------------- */

/** Convert one sheet on demand and memoise it, so unopened sheets cost nothing. */
function sheetFrame(entry, name) {
  if (entry.frames.has(name)) return entry.frames.get(name);
  const parsed = sheetToColumns(entry.XLSX, entry.wb, name);
  entry.frames.set(name, parsed);
  return parsed;
}

async function loadWorkbookFile(buffer, name) {
  const XLSX = await loadXLSX();
  if (!XLSX) { toast(t('xlsx.unavailable'), 'err'); return false; }

  let wb;
  try { wb = readWorkbook(XLSX, new Uint8Array(buffer)); }
  catch { toast(t('xlsx.badFile'), 'err'); return false; }

  const names = sheetNames(wb);
  if (!names.length) { toast(t('xlsx.badFile'), 'err'); return false; }

  state.workbook = { file: name, XLSX, wb, names, frames: new Map(), active: null };
  // try each sheet in order — a workbook whose first sheet is a cover page
  // should still open on something usable
  for (const n of names) {
    if (applySheet(n, { quiet: true })) {
      toast(t('load.done', {
        name: `${name} · ${n}`, rows: state.raw.nrows, cols: state.raw.ncols,
      }), 'ok');
      if (names.length > 1) toast(t('xlsx.sheetCount', { file: name, n: names.length }), 'info');
      return true;
    }
  }
  state.workbook = null;
  refreshAll();
  toast(t('xlsx.empty'), 'err');
  return false;
}

/**
 * Switch the frame to one sheet of the open workbook.
 * `quiet` suppresses the toast when probing sheets during load.
 */
function applySheet(name, { quiet = false } = {}) {
  const entry = state.workbook;
  if (!entry || !entry.names.includes(name)) return false;

  const parsed = sheetFrame(entry, name);
  if (!parsed || !parsed.columns.length
      || !parsed.columns.some((c) => parsed.data[c].length)) {
    if (!quiet) toast(t('xlsx.emptySheet', { name }), 'err');
    return false;
  }

  entry.active = name;
  const label = `${entry.file} · ${name}`;
  setDataFrame(parsed.columns, parsed.data, label, null, { keepWorkbook: true });
  if (!quiet) {
    toast(t('load.done', { name: label, rows: state.raw.nrows, cols: state.raw.ncols }), 'ok');
  }
  return true;
}

/** The sheet picker only exists while a workbook is open. */
function renderSheetPicker() {
  const host = $('#sheetPicker');
  const sel = $('#sheetSelect');
  if (!host || !sel) return;
  const entry = state.workbook;
  if (!entry) { host.hidden = true; return; }

  host.hidden = false;
  const sig = `${entry.file}\u0001${entry.names.join('\u0001')}`;
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = '';
    for (const n of entry.names) sel.appendChild(el('option', { value: n, text: n }));
  }
  if (entry.active) sel.value = entry.active;

  const note = $('#sheetNote');
  if (note) {
    note.textContent = entry.names.length > 1
      ? t('xlsx.sheetCount', { file: entry.file, n: entry.names.length })
      : entry.file;
  }
}

/* ------------------------------ pipeline ---------------------------------- */

function rebuild() {
  let df = state.raw.clone();
  for (const op of state.cleanOps) df = applyCleanOp(df, op);
  state.df = df;

  // filters -> row indices into df
  let idx = df.rowIndexArray();

  for (const f of state.filters) {
    if (f.value === '' && !['isna', 'notna'].includes(f.op)) continue;
    idx = idx.filter((i) => testCondition(f, i));
  }

  if (state.queryText.trim()) {
    try {
      const hit = new Set(df.query(state.queryText));
      idx = idx.filter((i) => hit.has(i));
      state.queryError = null;
    } catch (err) {
      state.queryError = err.message;
    }
  } else {
    state.queryError = null;
  }

  state.view = df.take(idx);
}

function applyCleanOp(df, op) {
  switch (op.kind) {
    case 'dropna': return df.dropna(op.subset);
    case 'fillna': return df.fillna(op.col, op.value);
    case 'astype': return df.astype(op.col, op.type);
    case 'dropdup': return df.dropDuplicates(op.subset);
    case 'dropcol': return df.drop(op.cols);
    case 'rename': return df.rename({ [op.col]: op.value });
    default: return df;
  }
}

function testCondition(f, i) {
  const df = state.df;
  if (!df.has(f.col)) return true;
  const raw = df.values(f.col)[i];
  const isNullVal = raw === null || raw === undefined || raw === '';
  const num = Number(raw);
  const numeric = !isNullVal && !Number.isNaN(num);
  const targetNum = Number(f.value);
  const targetNumeric = f.value !== '' && !Number.isNaN(targetNum);

  switch (f.op) {
    case 'isna': return isNullVal;
    case 'notna': return !isNullVal;
    case 'contains': return !isNullVal && String(raw).toLowerCase().includes(String(f.value).toLowerCase());
    case 'startswith': return !isNullVal && String(raw).toLowerCase().startsWith(String(f.value).toLowerCase());
    case 'endswith': return !isNullVal && String(raw).toLowerCase().endsWith(String(f.value).toLowerCase());
    case 'in': {
      const list = String(f.value).split(',').map((s) => s.trim().toLowerCase());
      return !isNullVal && list.includes(String(raw).toLowerCase());
    }
    case 'notin': {
      const list = String(f.value).split(',').map((s) => s.trim().toLowerCase());
      return !isNullVal && !list.includes(String(raw).toLowerCase());
    }
    default: break;
  }
  if (isNullVal) return false;
  const useNum = numeric && targetNumeric;
  const a = useNum ? num : String(raw);
  const b = useNum ? targetNum : String(f.value);
  switch (f.op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return true;
  }
}

/* --------------------------- pandas codegen ------------------------------- */

function py(v) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'number') return String(v);
  return `"${String(v)}"`;
}
const pyList = (arr) => `[${arr.map(py).join(', ')}]`;

function loadCode() {
  const n = state.rawName;
  if (/\.json$/i.test(n)) return `import pandas as pd\n\ndf = pd.read_json(${py(n)})\ndf.head()`;
  return `import pandas as pd\n\ndf = pd.read_csv(${py(n)})\ndf.head()`;
}

function cleanOpCode(op) {
  switch (op.kind) {
    case 'dropna': return `df = df.dropna(${op.subset.length ? `subset=${pyList(op.subset)}` : ''})`;
    case 'fillna': {
      const isNum = state.df && state.df.type(op.col) === 'number';
      const v = isNum && !Number.isNaN(Number(op.value)) ? Number(op.value) : py(op.value);
      return `df[${py(op.col)}] = df[${py(op.col)}].fillna(${v})`;
    }
    case 'astype': return `df[${py(op.col)}] = df[${py(op.col)}].astype(${{ number: 'float', string: 'str', boolean: 'bool' }[op.type]})`;
    case 'dropdup': return `df = df.drop_duplicates(${op.subset.length ? `subset=${pyList(op.subset)}` : ''})`;
    case 'dropcol': return `df = df.drop(columns=${pyList(op.cols)})`;
    case 'rename': return `df = df.rename(columns={${py(op.col)}: ${py(op.value)}})`;
    default: return '';
  }
}

function filterCode(f) {
  const c = `df[${py(f.col)}]`;
  switch (f.op) {
    case 'isna': return `df = df[${c}.isna()]`;
    case 'notna': return `df = df[${c}.notna()]`;
    case 'contains': return `df = df[${c}.str.contains(${py(f.value)}, case=False, na=False)]`;
    case 'startswith': return `df = df[${c}.str.startswith(${py(f.value)}, na=False)]`;
    case 'endswith': return `df = df[${c}.str.endswith(${py(f.value)}, na=False)]`;
    case 'in': return `df = df[${c}.isin(${pyList(String(f.value).split(',').map((s) => s.trim()))})]`;
    case 'notin': return `df = df[~${c}.isin(${pyList(String(f.value).split(',').map((s) => s.trim()))})]`;
    default: break;
  }
  const isNum = state.df && state.df.type(f.col) === 'number';
  const v = isNum && !Number.isNaN(Number(f.value)) ? Number(f.value) : py(f.value);
  return `df = df[df[${py(f.col)}] ${f.op} ${v}]`;
}

function pushCode(label, code) {
  if (!code) return;
  state.currentCode = code;
  const last = state.codeSteps[state.codeSteps.length - 1];
  if (last && last.code === code) return;
  state.codeSteps.push({ label, code });
  if (state.codeSteps.length > 60) state.codeSteps.shift();
}

function buildFullScript() {
  const parts = [loadCode()];
  for (const s of state.codeSteps) {
    if (s.label === 'load') continue;
    parts.push(s.code);
  }
  const df = state.view;
  if (df && df.nrows) {
    parts.push('');
    parts.push('# ---- 分析 / analysis ----');
    if (df.numericCols.length) parts.push('print(df.describe())');
    const cat = pickCategorical(df);
    if (cat && df.nunique(cat) <= 40) parts.push(`print(df[${py(cat)}].value_counts().head(10))`);
    if (df.numericCols.length > 1) parts.push('print(df.corr(numeric_only=True).round(2))');
  }
  return parts.join('\n');
}

/* ---------------------------- code highlighting --------------------------- */

function highlight(src) {
  const re = /(#[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|\b(import|from|as|def|return|for|in|if|else|elif|not|and|or|None|True|False|lambda|with|print|assert|break|continue|class)\b|(\d+(?:\.\d+)?)|(\.\w+)(?=\()/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="k">${esc(m[3])}</span>`;
    else if (m[4]) out += `<span class="n">${esc(m[4])}</span>`;
    else out += `<span class="f">${esc(m[5])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}

/* ------------------------------ rendering -------------------------------- */

/**
 * The filter builder and the history list are two views of the same state
 * (`filters` + `queryText`), so they must always be repainted together — a
 * handler that refreshes one and not the other leaves a stale panel behind.
 */
function renderPipelinePanels() {
  renderFilterPanel();
  renderHistory();
}

/* ---------------------------- data hygiene -------------------------------- */
/* pandas quietly turns a column holding one stray token into `object`, and
 * every numeric operation on that column then fails — or worse, silently
 * returns nothing. Saying so at load time beats letting the user find out
 * three steps later. */

function renderTypeConflicts() {
  const card = $('#conflictCard');
  const body = $('#conflictBody');
  if (!card || !body) return;
  const df = state.raw;
  if (!df || state.conflictDismissedFor === state.raw) { card.hidden = true; return; }

  const conflicts = columnTypeConflicts(df);
  if (!conflicts.length) { card.hidden = true; return; }

  const rows = conflicts.slice(0, 3).map((c) => {
    const ex = c.samples
      .map((s) => `<code>${esc(String(s.value).slice(0, 24))}</code>`)
      .join(' ');
    return esc(t('conflict.row', {
      col: c.name, bad: c.total - c.numeric, total: c.total,
    })) + ' ' + ex;
  });

  body.innerHTML = `${esc(t('conflict.body', { n: conflicts.length }))}<br/>${
    rows.join('<br/>')}<br/><span class="muted-note">${esc(t('conflict.fix'))}</span>`;
  card.hidden = false;
}

function refreshAll() {
  renderTypeConflicts();
  renderKPIs();
  renderSamples();
  renderSheetPicker();
  renderExportMenu();
  renderColumnList();
  renderColumnControls();
  renderTable();
  renderStats();
  renderMissingChart();
  renderTests();
  renderPipelinePanels();
  renderGroupby();
  renderPivotPanel();
  // a brand-new dataset deserves fresh, sensible chart defaults
  if (state.autoFilledFor !== state.raw) {
    state.autoFilledFor = state.raw;
    autoFillChartConfig();
  }
  switchTab(state.activeTab || 'table');
  renderCharts();
  renderCode();
}

/* KPIs */
function renderKPIs() {
  const df = state.df;
  if (!df) return;
  $('#kpiRows').textContent = (state.view ? state.view.nrows : df.nrows).toLocaleString();
  $('#kpiCols').textContent = df.ncols;
  $('#kpiNum').textContent = df.numericCols.length;

  let missing = 0;
  for (const c of df.columns) missing += df.values(c.name).filter((v) => v === null || v === undefined || v === '').length;
  $('#kpiNa').textContent = missing.toLocaleString();

  let bytes = 0;
  for (const c of df.columns) for (const v of df.values(c.name)) bytes += v === null || v === undefined ? 4 : String(v).length * 2 + 16;
  $('#kpiMem').textContent = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

  $('#headerDatasetName').textContent = state.rawName;
  $('#headerDatasetShape').textContent = `${df.nrows} × ${df.ncols}`;

  const shown = state.view ? state.view.nrows : df.nrows;
  const badge = $('#filterBadge');
  if (shown !== df.nrows) {
    badge.hidden = false;
    badge.textContent = t('filter.badge', { n: shown.toLocaleString(), total: df.nrows.toLocaleString() });
  } else {
    badge.hidden = true;
  }
}

/* samples */
function renderSamples() {
  const box = $('#sampleList');
  box.innerHTML = '';
  for (const s of SAMPLE_DEFS) {
    const name = t(`${s.key}.name`);
    const desc = t(`${s.key}.desc`);
    const size = t('sample.size', { rows: s.rows.toLocaleString(), cols: s.cols });

    const btn = el('button', {
      class: `sample-item${state.source === s.id ? ' is-active' : ''}`,
      type: 'button',
      'data-id': s.id,
      title: `${name} — ${size}\n${desc}`,
    });

    const head = el('span', { class: 'sample-head' });
    head.appendChild(el('span', { class: 'sample-ico', text: s.icon }));
    head.appendChild(el('span', { class: 'sample-name', text: name }));

    btn.appendChild(head);
    btn.appendChild(el('span', { class: 'sample-desc', text: desc }));
    btn.appendChild(el('span', { class: 'sample-meta', text: size }));
    btn.addEventListener('click', () => loadSample(s.id));
    box.appendChild(btn);
  }
}

/* sidebar column list */
function renderColumnList() {
  const df = state.df;
  const list = $('#colList');
  const q = ($('#colSearch').value || '').toLowerCase();
  list.innerHTML = '';
  if (!df) return;
  $('#colCount').textContent = df.ncols;
  const na = df.isna();
  for (const c of df.columns) {
    if (q && !c.name.toLowerCase().includes(q)) continue;
    const miss = na[c.name].filter(Boolean).length;
    const li = el('li', { class: 'col-item' });
    li.innerHTML = `<span class="dtype dtype-${c.type}">${c.type}</span>
      <span class="cname" title="${esc(c.name)}">${esc(c.name)}</span>
      ${miss ? `<span class="cna" title="missing">${miss}</span>` : ''}`;
    list.appendChild(li);
  }
}

/* table control selects */
function renderColumnControls() {
  const df = state.df;
  if (!df) return;
  const cols = df.colNames;
  const numCols = df.numericCols;
  const catCols = df.categoricalCols;
  const all = [''].concat(cols);

  const fill = (sel, items, { allowEmpty = true, label = '' } = {}) => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    if (allowEmpty) sel.appendChild(el('option', { value: '', text: label }));
    for (const c of items) sel.appendChild(el('option', { value: c, text: c }));
    // only re-apply a value that still exists — assigning '' unselects a full list
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else sel.selectedIndex = 0;
  };

  // multi-select helpers
  const fillMulti = (sel, items) => {
    if (!sel) return;
    const chosen = [...sel.selectedOptions].map((o) => o.value).filter((v) => items.includes(v));
    sel.innerHTML = '';
    for (const c of items) sel.appendChild(el('option', { value: c, text: c }));
    [...sel.options].forEach((o) => { if (chosen.includes(o.value)) o.selected = true; });
  };

  fillMulti($('#dropnaSubset'), cols);
  fillMulti($('#dupSubset'), cols);
  fillMulti($('#dropCol'), cols);
  fillMulti($('#gbBy'), catCols.length ? catCols.concat(numCols.filter((c) => df.nunique(c) <= 30)) : cols);

  fill($('#fillnaCol'), cols, { allowEmpty: false });
  fill($('#astypeCol'), cols, { allowEmpty: false });
  fill($('#renameCol'), cols, { allowEmpty: false });

  // value counts: categorical first
  const vc = $('#vcColumn');
  const vcPrev = vc.value;
  vc.innerHTML = '';
  for (const c of (catCols.length ? catCols : cols)) {
    if (df.nunique(c) <= 200) vc.appendChild(el('option', { value: c, text: c }));
  }
  if ([...vc.options].some((o) => o.value === vcPrev)) vc.value = vcPrev;

  // chart selects
  const chX = $('#chX'); const chY = $('#chY'); const chS = $('#chSeries');
  const xPrev = chX.value, yPrev = chY.value, sPrev = chS.value;
  fill(chX, cols, { allowEmpty: false });
  fill(chY, numCols.length ? numCols : cols, { allowEmpty: false, label: t('chart.count') });
  chY.insertBefore(el('option', { value: '', text: `— ${t('chart.count')} —` }), chY.firstChild);
  fill(chS, catCols, { allowEmpty: true, label: `— ${t('chart.noneSeries')} —` });
  if (cols.includes(xPrev)) chX.value = xPrev;
  if ([...chY.options].some((o) => o.value === yPrev)) chY.value = yPrev;
  if ([...chS.options].some((o) => o.value === sPrev)) chS.value = sPrev;

  // aggregate-function select — rebuilt on every refresh so labels follow the language
  const agg = $('#chAgg');
  const aggPrev = agg.value;
  agg.innerHTML = '';
  for (const fn of ['sum', 'mean', 'median', 'count', 'min', 'max', 'nunique']) {
    agg.appendChild(el('option', { value: fn, text: `${aggLabel(fn)} (${fn})` }));
  }
  if ([...agg.options].some((o) => o.value === aggPrev)) agg.value = aggPrev;

  // multi-column numeric picker used by parallel coordinates / SPLOM
  const numSel = $('#chNumCols');
  if (numSel) {
    const nPrev = [...numSel.selectedOptions].map((o) => o.value);
    numSel.innerHTML = '';
    for (const c of numCols) numSel.appendChild(el('option', { value: c, text: c }));
    const keep = nPrev.filter((c) => numCols.includes(c));
    if (keep.length) [...numSel.options].forEach((o) => { o.selected = keep.includes(o.value); });
    else {
      /* The multivariate charts fall back to the highest-ranked measures when
         the picker is empty. Select them here too, so the control stops
         claiming "nothing chosen" while six dimensions are on the chart. */
      const def = rankedNumeric(df).slice(0, 4);
      [...numSel.options].forEach((o) => { o.selected = def.includes(o.value); });
    }
  }

  const gbCol = $('#gbCol');
  fillMulti(gbCol, numCols.length ? numCols : cols);

  // groupby function checkboxes — keep the user's selection across re-renders
  const gbFuncs = $('#gbFuncs');
  const checkedNow = new Set($$('#gbFuncs input:checked').map((i) => i.value));
  const initial = gbFuncs.childElementCount ? checkedNow : new Set(['sum', 'mean']);
  gbFuncs.innerHTML = '';
  for (const fn of ['sum', 'mean', 'median', 'count', 'min', 'max', 'std', 'nunique']) {
    const on = initial.has(fn);
    const lab = el('label', { class: on ? 'is-on' : '' });
    lab.innerHTML = `<input type="checkbox" value="${fn}" ${on ? 'checked' : ''}/><span>${esc(aggLabel(fn))}</span>`;
    lab.querySelector('input').addEventListener('change', (e) => lab.classList.toggle('is-on', e.target.checked));
    gbFuncs.appendChild(lab);
  }

  /* ---------------- pivot builder (click-to-assign, no drag) -------------- */
  /* Both axes are `<select multiple>`, so they must be filled with `fillMulti`.
     `fill` is the *single*-select helper: whenever the previous choice is gone
     it falls back to `selectedIndex = 0`, which silently pointed rows, cols and
     value at the frame's first column — typically an id or a timestamp. That is
     both meaningless (pivot on a primary key) and ruinous (the grid is
     rows × cols), so it is exactly the mistake worth designing out. */
  const pvRows = $('#pvRows');
  const pvCols = $('#pvCols');
  fillMulti(pvRows, cols);
  if (pvRows && ![...pvRows.selectedOptions].length) {
    const cat = pickCategorical(df);
    if (cat) [...pvRows.options].forEach((o) => { o.selected = o.value === cat; });
  }
  /* Left deliberately empty. No column axis yields a plain one-number summary,
     which is the useful default; the heatmap already has its own correlation
     view, so nothing is lost by not pre-filling a second axis. */
  fillMulti(pvCols, cols);

  const pvValue = $('#pvValue');
  const prevValue = pvValue ? pvValue.value : null;
  fill(pvValue, numCols, { allowEmpty: false });
  // keep the user's measure while the same frame is on screen, but re-seed it
  // from the ranked list when a new dataset arrives
  if (pvValue && numCols.length && (prevValue === null || !numCols.includes(prevValue))) {
    pvValue.value = rankedNumeric(df)[0] || numCols[0];
  }

  const pvAgg = $('#pvAgg');
  if (pvAgg && !pvAgg.childElementCount) {
    for (const fn of PIVOT_AGGS) pvAgg.appendChild(el('option', { value: fn, text: aggLabel(fn) }));
    pvAgg.value = 'mean';
  }
}

/* column visibility dropdown */
function renderColVis() {
  const menu = $('#colVisMenu');
  const df = state.df;
  if (!df) return;
  menu.innerHTML = '';
  for (const c of df.columns) {
    const lab = el('label');
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !state.hiddenCols.has(c.name);
    cb.addEventListener('change', () => {
      if (cb.checked) state.hiddenCols.delete(c.name); else state.hiddenCols.add(c.name);
      renderTable();
    });
    // build children with appendChild — `innerHTML +=` would re-parse and drop the listener
    lab.appendChild(cb);
    lab.appendChild(el('span', { class: 'cname', text: c.name }));
    lab.appendChild(el('span', { class: `dtype dtype-${c.type}`, text: c.type }));
    menu.appendChild(lab);
  }
}

/* ------------------------------- table ----------------------------------- */

function currentRows() {
  const df = state.view;
  if (!df) return { rows: [], total: 0 };
  const visible = visibleCols();
  let idx = df.rowIndexArray();

  const q = state.search.trim().toLowerCase();
  if (q) {
    idx = idx.filter((i) => visible.some((c) => {
      const v = df.values(c)[i];
      return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
    }));
  }

  if (state.sort.col && visible.includes(state.sort.col)) {
    const col = state.sort.col;
    const type = df.type(col);
    const dir = state.sort.asc ? 1 : -1;
    idx = [...idx].sort((a, b) => {
      const va = df.values(col)[a], vb = df.values(col)[b];
      const na = va === null || va === '', nb = vb === null || vb === '';
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      let c;
      if (type === 'number') c = Number(va) - Number(vb);
      else if (type === 'date') c = Date.parse(va) - Date.parse(vb);
      else c = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return c * dir;
    });
  }
  return { rows: idx, total: idx.length };
}

const visibleCols = () => (state.view ? state.view.colNames.filter((c) => !state.hiddenCols.has(c)) : []);

function cellHtml(col, value) {
  if (value === null || value === undefined || value === '') return '<span class="na">NaN</span>';
  if (col.type === 'number') return CH.fmtNum(value);
  if (col.type === 'boolean') return String(value);
  return esc(value);
}

/* Row height is fixed in virtual mode so the scroll offset maps to an index
   without measuring anything. */
const ROW_H = 30;
const VIRTUAL_OVERSCAN = 6;

let virtualView = null;

function renderTable() {
  const host = $('#tableScroll');
  const df = state.view;
  if (!df) { host.innerHTML = ''; return; }
  const cols = visibleCols();
  const types = new Map(df.columns.map((c) => [c.name, c.type]));
  const { rows, total } = currentRows();

  const virtual = state.pageSize === 'virtual';
  const pageSize = virtual ? Math.max(total, 1) : Number(state.pageSize);
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  if (state.page > maxPage) state.page = maxPage;
  const from = (state.page - 1) * pageSize;
  const slice = rows.slice(from, from + pageSize);

  $('#tableInfo').textContent = t('table.info', {
    from: total ? from + 1 : 0, to: Math.min(from + pageSize, total), total: total.toLocaleString(),
  });

  const head = ['<th class="td-idx" scope="col">' + t('table.index') + '</th>']
    .concat(cols.map((c) => {
      const sorted = state.sort.col === c;
      const arrow = sorted ? (state.sort.asc ? '▲' : '▼') : '↕';
      const ariaSort = sorted ? (state.sort.asc ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" tabindex="0" aria-sort="${ariaSort}" class="sortable${sorted ? ' is-sorted' : ''}${types.get(c) === 'number' ? ' num' : ''}" data-col="${esc(c)}">
        <span class="th-inner">${esc(c)}<span class="arrow" aria-hidden="true">${arrow}</span></span></th>`;
    })).join('');

  host.classList.toggle('is-virtual', virtual);

  const rowHtml = (i) => {
    const tds = cols.map((c) => {
      const type = types.get(c);
      const cls = type === 'number' ? ' class="num"' : '';
      return `<td${cls}>${cellHtml({ type }, df.values(c)[i])}</td>`;
    }).join('');
    return `<tr><td class="td-idx">${i + 1}</td>${tds}</tr>`;
  };

  if (virtual) {
    host.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody></tbody></table>`;
    virtualView = { slice, cols, types, from, rowHtml, body: host.querySelector('tbody') };
    paintVirtual();
  } else {
    virtualView = null;
    const body = slice.length
      ? slice.map(rowHtml).join('')
      : `<tr><td colspan="${cols.length + 1}" style="text-align:center;padding:26px;color:var(--text-3)">${t('table.nohit')}</td></tr>`;
    host.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  host.querySelectorAll('th.sortable').forEach((th) => {
    const toggle = () => {
      const col = th.dataset.col;
      if (state.sort.col === col) state.sort.asc = !state.sort.asc;
      else state.sort = { col, asc: false };
      renderTable();
      const again = host.querySelector(`th.sortable[data-col="${CSS.escape(col)}"]`);
      if (again) again.focus();
    };
    th.addEventListener('click', toggle);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  renderPager(maxPage, total, virtual);
}

/**
 * Draw only the rows the viewport can see, bookended by two spacer rows that
 * hold the scrollbar honest. 50k rows cost the same DOM as 40.
 *
 * The viewport height cannot come from `clientHeight` here: immediately after
 * `innerHTML` is replaced the container has collapsed to the height of its
 * header, so measuring would paint a handful of rows and leave a blank gap
 * until the user scrolled. The container's own `max-height` is the stable
 * number — it is what the box will settle at once the rows exist.
 */
function viewportHeight(host) {
  const max = parseFloat(getComputedStyle(host).maxHeight);
  if (Number.isFinite(max) && max > 0) return max;
  return host.clientHeight || 520;
}

function paintVirtual() {
  const v = virtualView;
  if (!v) return;
  const host = $('#tableScroll');
  const viewH = viewportHeight(host);
  const n = v.slice.length;
  const first = Math.max(0, Math.floor(host.scrollTop / ROW_H) - VIRTUAL_OVERSCAN);
  const last = Math.min(n, first + Math.ceil(viewH / ROW_H) + VIRTUAL_OVERSCAN * 2);
  const span = v.cols.length + 1;
  const above = first * ROW_H;
  const below = Math.max(0, (n - last) * ROW_H);

  v.body.innerHTML =
    `<tr class="v-spacer" aria-hidden="true" style="height:${above}px"><td colspan="${span}"></td></tr>` +
    (n ? v.slice.slice(first, last).map(v.rowHtml).join('')
       : `<tr><td colspan="${span}" style="text-align:center;padding:26px;color:var(--text-3)">${t('table.nohit')}</td></tr>`) +
    `<tr class="v-spacer" aria-hidden="true" style="height:${below}px"><td colspan="${span}"></td></tr>`;
}

let virtualRaf = 0;
function onVirtualScroll() {
  if (!virtualView || virtualRaf) return;
  virtualRaf = requestAnimationFrame(() => { virtualRaf = 0; paintVirtual(); });
}

function renderPager(maxPage, total, virtual = false) {
  const host = $('#pager');
  host.innerHTML = '';
  if (!state.view) return;
  if (virtual) {
    host.appendChild(el('span', { class: 'pg-info', text: t('table.virtualInfo', { n: total.toLocaleString() }) }));
    return;
  }
  const mk = (label, page, opts = {}) => {
    const b = el('button', { type: 'button', text: label });
    if (opts.on) b.classList.add('is-on');
    if (opts.dis) b.disabled = true;
    if (!opts.dis && !opts.on) b.addEventListener('click', () => { state.page = page; renderTable(); });
    return b;
  };

  host.appendChild(mk('‹', state.page - 1, { dis: state.page <= 1 }));

  const win = [];
  const push = (p) => { if (!win.includes(p) && p >= 1 && p <= maxPage) win.push(p); };
  push(1);
  for (let p = state.page - 2; p <= state.page + 2; p++) push(p);
  push(maxPage);
  win.sort((a, b) => a - b);

  let prev = 0;
  for (const p of win) {
    if (prev && p - prev > 1) {
      const s = el('button', { type: 'button', text: '…' });
      s.disabled = true;
      host.appendChild(s);
    }
    host.appendChild(mk(String(p), p, { on: p === state.page }));
    prev = p;
  }
  host.appendChild(mk('›', state.page + 1, { dis: state.page >= maxPage }));
  host.appendChild(el('span', { class: 'pg-info', text: `${state.page} / ${maxPage} · ${total.toLocaleString()} rows` }));
}

/* ------------------------------- stats ----------------------------------- */

function renderStats() {
  const df = state.view;
  if (!df) return;
  const cols = df.numericCols;

  /* describe */
  const desc = df.describe();
  const stats = ['count', 'mean', 'std', 'min', 'q25', 'q50', 'q75', 'max'];
  const descHost = $('#describeTable');
  if (!cols.length) {
    descHost.innerHTML = `<p class="muted-note" style="padding:16px">${t('stats.noNumeric')}</p>`;
  } else {
    const head = `<tr><th>${t('stats.column')}</th>${cols.map((c) => `<th class="num" title="${esc(c)}">${esc(c)}</th>`).join('')}</tr>`;
    const body = stats.map((s) => {
      const tds = cols.map((c) => {
        const v = desc[c][s];
        return `<td class="num">${v === null || v === undefined ? '—' : CH.fmtNum(v, 3)}</td>`;
      }).join('');
      return `<tr><td>${esc(t(`stats.${s}`))}</td>${tds}</tr>`;
    }).join('');
    descHost.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  /* missing */
  const missHost = $('#missingTable');
  const mrows = df.missingCounts();
  const anyMissing = mrows.some((r) => r.missing > 0);
  if (!anyMissing) {
    missHost.innerHTML = `<p class="muted-note" style="padding:16px">${t('stats.noMissing')}</p>`;
  } else {
    const head = `<tr><th>${t('stats.column')}</th><th>type</th><th class="num">${t('stats.missingCol')}</th><th class="num">${t('stats.missingPct')}</th><th></th></tr>`;
    const body = mrows.sort((a, b) => b.missing - a.missing).map((r) => {
      const pct = r.total ? (r.missing / r.total) * 100 : 0;
      return `<tr>
        <td>${esc(r.name)}</td>
        <td><span class="dtype dtype-${r.type}">${r.type}</span></td>
        <td class="num">${r.missing}</td>
        <td class="num">${pct.toFixed(1)}%</td>
        <td style="width:120px"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td>
      </tr>`;
    }).join('');
    missHost.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  renderValueCounts();
}

function renderValueCounts() {
  const df = state.view;
  const col = $('#vcColumn').value;
  const host = $('#vcTable');
  if (!df || !col || !df.has(col)) { host.innerHTML = ''; return; }

  const rows = df.valueCounts(col, { limit: 40 });
  const max = rows.length ? rows[0].count : 1;
  const head = `<tr><th>${t('stats.value')}</th><th class="num">${t('stats.freq')}</th><th class="num">${t('stats.ratio')}</th><th></th></tr>`;
  const body = rows.map((r) => `<tr>
      <td>${esc(r.value)}</td>
      <td class="num">${r.count.toLocaleString()}</td>
      <td class="num">${(r.ratio * 100).toFixed(1)}%</td>
      <td style="width:130px"><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${(r.count / max) * 100}%"></div></div></div></td>
    </tr>`).join('');
  host.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;

  if (!state.echartsReady) { chartPending($('#vcChart')); return; }
  const top = rows.slice(0, 12).slice().reverse();
  const vcOpt = CH.horizontalBarOption(top.map((r) => r.value), top.map((r) => r.count), {
    xName: t('stats.freq'),
    formatter: (v) => `${v} · ${((v / (state.view.nrows || 1)) * 100).toFixed(1)}%`,
  });
  CH.renderChart($('#vcChart'), vcOpt);
  renderChartA11y($('#vcChart'), vcOpt, $('#vcChartA11y'));
}

/* --------------------- missingness matrix + tests ------------------------ */

/**
 * ECharts is a CDN download over an unknown network. Every chart surface has
 * to cope with "not here yet" — and the honest answer is to say so. Returning
 * early and leaving the box empty looks exactly like a dataset that failed to
 * load, which is how this placeholder came to exist.
 */
function chartPending(host, key = 'chart.loading') {
  if (!host) return;
  host.innerHTML = `<p class="muted-note chart-pending">${esc(t(key))}</p>`;
}

/**
 * ECharts paints into a <canvas>, which assistive technology cannot read at
 * all — a screen reader gets an unlabelled box. Every chart therefore also
 * publishes a summary plus a small data table into a visually-hidden node,
 * and the canvas itself is labelled rather than left anonymous.
 */
function renderChartA11y(dom, option, host) {
  if (!dom || !host) return;
  const info = CH.describeOption(option);
  if (!info.rows.length) {
    host.innerHTML = '';
    dom.removeAttribute('role');
    dom.removeAttribute('aria-label');
    return;
  }
  const summary = t('chart.a11ySummary', {
    s: info.seriesCount,
    n: info.pointCount.toLocaleString(),
  });
  dom.setAttribute('role', 'img');
  dom.setAttribute('aria-label', summary);
  host.innerHTML = `<table><caption>${esc(summary)}${
    info.truncated ? ` ${esc(t('chart.a11yTruncated'))}` : ''}</caption>
    <thead><tr>${info.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${info.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function missingChartLabels() {
  return {
    rows: t('miss.rowsAxis'),
    row: t('miss.row'),
    present: t('miss.present'),
    missing: t('miss.missing'),
    isMissing: t('miss.isMissing'),
  };
}

function renderMissingChart() {
  const host = $('#missChart');
  const df = state.view;
  if (!host || !df) return;
  if (!state.echartsReady) { chartPending(host); return; }
  const matrix = missingMatrix(df, 180, 20);
  const sub = $('#missChartSub');

  if (!matrix.cols.length) {
    CH.clearChart(host);
    host.innerHTML = `<p class="muted-note" style="padding:16px">${esc(t('stats.noMissing'))}</p>`;
    if (sub) sub.textContent = t('stats.missingMapSub');
    return;
  }

  /* The sample ratio belongs in the card subtitle, not parked on the y axis:
     there it sat on the same line as the column labels and read like a date
     ("行 (1/26)" rendered beside "discount 62%"), which is exactly how a
     reader ends up believing the chart has a column that does not exist. */
  if (sub) {
    sub.textContent = matrix.step > 1
      ? `${t('stats.missingMapSub')} · ${t('miss.sampled', { n: matrix.step, rows: matrix.sampled })}`
      : t('stats.missingMapSub');
  }

  CH.clearChart(host);
  CH.renderChart(host, CH.missingnessOption({
    matrix,
    labels: missingChartLabels(),
  }, CH.chartTheme()));

  /* The nullity matrix is not an x/y series, so describeOption would only
     produce row and column indices — build the alternative from the rates. */
  const a11yHost = $('#missChartA11y');
  if (a11yHost) {
    const summary = t('stats.missingMapA11y', {
      n: matrix.cols.length,
      cells: matrix.missingCells.toLocaleString(),
      total: matrix.totalCells.toLocaleString(),
    });
    host.setAttribute('role', 'img');
    host.setAttribute('aria-label', summary);
    a11yHost.innerHTML = `<table><caption>${esc(summary)}</caption>
      <thead><tr><th>${esc(t('stats.column'))}</th><th>${esc(t('stats.missingCol'))}</th><th>${esc(t('stats.missingPct'))}</th></tr></thead>
      <tbody>${matrix.cols.map((c, i) => `<tr><td>${esc(c)}</td><td>${Math.round(matrix.rates[i] * matrix.total)}</td><td>${(matrix.rates[i] * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>`;
  }
}

/** p-values are only interesting for a few digits, then they are just "tiny".
 *  A chi-square on a few thousand rows overflows double precision and returns
 *  exactly 0 — "0.00e+0" reads like a broken number, so name the floor. */
function fmtP(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  if (p === 0) return '< 1e-308';
  if (p < 1e-4) return p.toExponential(2);
  return p.toFixed(4);
}

function renderTests() {
  const df = state.view;
  const host = $('#testTable');
  if (!host || !df) return;

  const gSel = $('#testGroup');
  const vSel = $('#testValue');
  const cSel = $('#testCat2');

  /* repopulate only when the frame's columns actually changed */
  const sig = `${df.ncols}|${df.colNames.join('\u0001')}`;
  if (gSel.dataset.sig !== sig) {
    gSel.dataset.sig = sig;
    const prevG = gSel.value, prevV = vSel.value;
    gSel.innerHTML = ''; vSel.innerHTML = '';
    for (const c of df.categoricalCols.filter((c) => df.nunique(c) >= 2 && df.nunique(c) <= 30)) {
      gSel.appendChild(el('option', { value: c, text: c }));
    }
    for (const c of df.numericCols) vSel.appendChild(el('option', { value: c, text: c }));
    const preferG = pickCategorical(df);
    if ([...gSel.options].some((o) => o.value === preferG)) gSel.value = preferG;
    else if ([...gSel.options].some((o) => o.value === prevG)) gSel.value = prevG;
    const ranked = rankedNumeric(df);
    if ([...vSel.options].some((o) => o.value === ranked[0])) vSel.value = ranked[0];
    else if ([...vSel.options].some((o) => o.value === prevV)) vSel.value = prevV;
  }

  const gCol = gSel.value;
  const vCol = vSel.value;

  /* The cross-tab column can never equal the grouping column, so its options
   * depend on the grouping selection and are rebuilt on every pass. On the
   * first pass pick the categorical column whose cardinality is closest to 3 —
   * wide enough to be interesting, narrow enough for the expected counts to
   * stay usable. */
  if (cSel) {
    const cands = df.categoricalCols.filter(
      (c) => c !== gCol && df.nunique(c) >= 2 && df.nunique(c) <= 12,
    );
    const want = `${gCol}\u0001${cands.join('\u0001')}`;
    if (cSel.dataset.sig !== want) {
      const prev = cSel.value;
      cSel.dataset.sig = want;
      cSel.innerHTML = '';
      for (const c of cands) cSel.appendChild(el('option', { value: c, text: c }));
      if (cands.includes(prev)) cSel.value = prev;
      else if (cands.length) {
        cSel.value = [...cands].sort(
          (a, b) => Math.abs(df.nunique(a) - 3) - Math.abs(df.nunique(b) - 3),
        )[0];
      }
    }
  }

  if (!gCol || !vCol || !df.has(gCol) || !df.has(vCol)) {
    host.innerHTML = `<p class="muted-note" style="padding:16px">${esc(t('test.needCols'))}</p>`;
    return;
  }

  const gv = df.values(gCol);
  const vv = df.values(vCol);
  const levels = df.unique(gCol).slice(0, 30).map(String);
  const buckets = new Map(levels.map((l) => [l, []]));
  for (let i = 0; i < df.nrows; i++) {
    const k = String(gv[i]);
    if (buckets.has(k)) buckets.get(k).push(vv[i]);
  }
  const groups = [...buckets.values()].filter((g) => g.length >= 2);

  const found = [];

  /* two groups -> Welch t-test; three or more -> one-way ANOVA */
  if (levels.length === 2 && groups.length === 2) {
    const r = welchTTest(buckets.get(levels[0]), buckets.get(levels[1]));
    if (r) found.push({
      /* the p-value says "different", not "which is bigger" — carry both group
         means into the label so the direction is readable at a glance */
      key: 'test.welchT',
      params: {
        a: levels[0], b: levels[1],
        am: CH.fmtNum(r.mean1, 2), bm: CH.fmtNum(r.mean2, 2),
      },
      stat: r.t, df: r.df, p: r.p,
      effect: r.cohensD, effectName: "Cohen's d",
      scipy: `stats.ttest_ind(${py(vCol)}[g == ${py(levels[0])}], ${py(vCol)}[g == ${py(levels[1])}], equal_var=False)`,
    });
  }
  if (levels.length >= 2 && levels.length <= 30 && groups.length >= 2) {
    const r = oneWayAnova(groups);
    if (r) found.push({
      key: 'test.anova', params: { k: r.k },
      stat: r.f, df: `${r.dfBetween}, ${r.dfWithin}`, p: r.p,
      effect: r.etaSquared, effectName: 'η²',
      scipy: `stats.f_oneway(${levels.slice(0, 3).map((l) => `g[${py(l)}]`).join(', ')}${levels.length > 3 ? ', …' : ''})`,
    });
  }

  /* chi-square needs a second categorical column; which one is the user's call,
     defaulting to a sensible middle-cardinality pick only on first render */
  const other = cSel && cSel.value && cSel.value !== gCol && df.has(cSel.value)
    ? cSel.value
    : null;
  let chiInfo = null;
  if (other) {
    const ct = df.crosstab(gCol, other);
    if (ct.rows.length >= 2 && ct.cols.length >= 2) {
      const r = chiSquareTest(ct.grid);
      if (r) {
        found.push({
          key: 'test.chi2', params: { a: gCol, b: other },
          stat: r.chi2, df: r.df, p: r.p,
          effect: r.cramersV, effectName: "Cramér's V",
          warn: r.minExpected < 5 ? t('test.lowExpected', { n: r.minExpected.toFixed(1) }) : '',
          scipy: `stats.chi2_contingency(pd.crosstab(df[${py(gCol)}], df[${py(other)}]))`,
        });
        chiInfo = { a: gCol, b: other, r };
      }
    }
  }

  /* ------------------- correlation, significance included ---------------- */
  /* Report whichever other numeric column tracks the value column most
     closely: "what moves with this?" is the question worth answering. */
  let bestCorr = null;
  for (const c of df.numericCols) {
    if (c === vCol) continue;
    const t2 = pearsonTest(vv, df.values(c));
    if (t2 && (bestCorr === null || Math.abs(t2.r) > Math.abs(bestCorr.r))) {
      bestCorr = { ...t2, col: c };
    }
  }
  if (bestCorr) {
    found.push({
      key: 'test.pearson',
      params: { a: vCol, b: bestCorr.col, r: CH.fmtNum(bestCorr.r, 3) },
      stat: bestCorr.t, df: bestCorr.df, p: bestCorr.p,
      effect: bestCorr.r, effectName: 'r',
      scipy: `stats.pearsonr(df[${py(vCol)}], df[${py(bestCorr.col)}])`,
    });
  }

  /* ------------------- rank-based and variance tests --------------------- */
  if (groups.length >= 2) {
    const lv = leveneTest(groups);
    if (lv) {
      found.push({
        key: 'test.levene', params: { k: lv.k },
        stat: lv.w, df: `${lv.df1}, ${lv.df2}`, p: lv.p,
        effect: null, effectName: '',
        scipy: `stats.levene(${levels.slice(0, 2).map((l) => `g[${py(l)}]`).join(', ')}${levels.length > 2 ? ', …' : ''})`,
      });
    }

    /* Mann-Whitney is the two-group counterpart of the t-test above; the
       rank-biserial correlation is its effect size, playing Cohen's d's role. */
    if (levels.length === 2 && groups.length === 2) {
      const mw = mannWhitneyU(buckets.get(levels[0]), buckets.get(levels[1]));
      if (mw) {
        found.push({
          key: 'test.mannWhitney', params: { a: levels[0], b: levels[1] },
          stat: mw.z, df: '—', p: mw.p,
          effect: mw.rankBiserial, effectName: 'rank-biserial',
          scipy: `stats.mannwhitneyu(${py(vCol)}[g == ${py(levels[0])}], ${py(vCol)}[g == ${py(levels[1])}], alternative="two-sided")`,
        });
      }
    }

    const kw = kruskalWallis(groups);
    if (kw) {
      found.push({
        key: 'test.kruskal', params: { k: kw.k },
        stat: kw.h, df: kw.df, p: kw.p,
        effect: null, effectName: '',
        scipy: `stats.kruskal(${levels.slice(0, 2).map((l) => `g[${py(l)}]`).join(', ')}${levels.length > 2 ? ', …' : ''})`,
      });
    }
  }

  /* ---------------------------- normality -------------------------------- */
  const jb = jarqueBera(vv);
  if (jb) {
    found.push({
      key: 'test.jarqueBera', params: { col: vCol },
      stat: jb.jb, df: 2, p: jb.p,
      effect: jb.skew, effectName: t('test.skew'),
      scipy: `stats.jarque_bera(df[${py(vCol)}])`,
    });
  }

  if (!found.length) {
    host.innerHTML = `<p class="muted-note" style="padding:16px">${esc(t('test.noTest'))}</p>`;
    return;
  }

  const head = `<tr>
    <th>${esc(t('test.name'))}</th>
    <th class="num">${esc(t('test.stat'))}</th>
    <th class="num">${esc(t('test.df'))}</th>
    <th class="num">p</th>
    <th class="num">${esc(t('test.effect'))}</th>
    <th>${esc(t('test.verdict'))}</th>
  </tr>`;

  const body = found.map((r) => {
    const sig = r.p < 0.05;
    return `<tr>
      <td title="${esc(r.scipy)}">${esc(t(r.key, r.params))}</td>
      <td class="num">${CH.fmtNum(r.stat, 3)}</td>
      <td class="num">${typeof r.df === 'number' ? r.df.toFixed(1) : r.df}</td>
      <td class="num">${fmtP(r.p)}</td>
      <td class="num">${CH.fmtNum(r.effect, 3)} <span class="muted-note">${esc(r.effectName)}</span></td>
      <td><span class="verdict ${sig ? 'is-sig' : 'is-ns'}">${esc(t(sig ? 'test.significant' : 'test.notSignificant'))}</span>${
        r.warn ? `<span class="test-warn" title="${esc(r.warn)}">!</span>` : ''}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>
    <p class="muted-note test-note">${esc(t('test.note', { p: '0.05' }))}</p>`;

  state.testSummary = { gCol, vCol, chiInfo, found };
}

/* ------------------------------- filters --------------------------------- */

function renderFilterPanel() {
  const df = state.df;
  const host = $('#filterRows');
  host.innerHTML = '';

  if (!df) return;

  if (!state.filters.length) {
    host.appendChild(el('p', { class: 'muted-note', text: t('filter.none') }));
  }

  state.filters.forEach((f, idx) => {
    const row = el('div', { class: 'filter-row' });

    const colSel = el('select', { class: 'select' });
    for (const c of df.colNames) colSel.appendChild(el('option', { value: c, text: c }));
    colSel.value = f.col;
    colSel.addEventListener('change', () => { commit('hist.filterEdit', { col: f.col }); f.col = colSel.value; rebuild(); renderAfterFilter(); syncUrl(); });

    const type = df.type(f.col);
    const ops = type === 'number'
      ? ['==', '!=', '>', '>=', '<', '<=', 'in', 'notin', 'isna', 'notna']
      : ['==', '!=', 'contains', 'startswith', 'endswith', 'in', 'notin', 'isna', 'notna'];
    const opSel = el('select', { class: 'select' });
    for (const o of ops) opSel.appendChild(el('option', { value: o, text: OPTEXT[o] || o }));
    opSel.value = ops.includes(f.op) ? f.op : ops[0];
    f.op = opSel.value;
    opSel.addEventListener('change', () => { commit('hist.filterEdit', { col: f.col }); f.op = opSel.value; rebuild(); renderAfterFilter(); syncUrl(); });

    const valInput = el('input', { class: 'input', value: f.value });
    valInput.placeholder = t('filter.value');
    valInput.disabled = ['isna', 'notna'].includes(f.op);
    valInput.addEventListener('input', () => {
      f.value = valInput.value;
      rebuild();
      renderAfterFilter({ keepFilterPanel: true });
    });
    /* typing re-filters live, but only one undo step is kept for the whole edit:
       the "before" state is captured on focus and committed on blur. */
    let beforeEdit = null;
    valInput.addEventListener('focus', () => { beforeEdit = snapshotPipeline('hist.filterEdit', { col: f.col }); });
    valInput.addEventListener('change', () => {
      if (beforeEdit) { pushSnapshot(beforeEdit); beforeEdit = null; }
      syncUrl();
    });

    const rm = el('button', { class: 'rm', type: 'button', title: t('filter.clear') });
    rm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    rm.addEventListener('click', () => {
      commit('hist.filterRemove', { col: f.col });
      state.filters.splice(idx, 1);
      rebuild();
      pushCode('filter', t('code.removedFilter'));
      renderAfterFilter();
      syncUrl();
    });

    row.append(colSel, opSel, valInput, rm);
    host.appendChild(row);
  });

  const msg = $('#queryMsg');
  if (state.queryError) {
    msg.className = 'query-msg err';
    msg.textContent = t('filter.error', { msg: state.queryError });
  } else if (state.queryText.trim()) {
    msg.className = 'query-msg ok';
    msg.textContent = t('filter.matched', { n: state.view.nrows.toLocaleString() });
  } else {
    msg.textContent = '';
    msg.className = 'query-msg';
  }
}

function renderAfterFilter(opts) {
  renderKPIs();
  renderTable();
  renderStats();
  renderMissingChart();
  renderTests();
  renderValueCounts();
  renderCharts();
  renderCode();
  /* `keepFilterPanel` is for the one caller that runs while the user is typing
     in a filter row: rebuilding those rows swaps the <input> node the caret
     lives in, so the next keystroke lands on <body> instead of the field. The
     history list is safe to redraw — it holds no editable nodes. */
  if (opts && opts.keepFilterPanel) renderHistory();
  else renderPipelinePanels();
}

/** pandas-style string literal for source code (single-quoted, escaped). */
const pyStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function runQuery() {
  const next = $('#queryInput').value;
  if (next !== state.queryText) commit('hist.query', { q: next });
  state.queryText = next;
  rebuild();
  const msg = $('#queryMsg');
  if (state.queryError) {
    msg.className = 'query-msg err';
    msg.textContent = t('filter.error', { msg: state.queryError });
    toast(t('filter.error', { msg: state.queryError }), 'err');
  } else if (state.queryText.trim()) {
    const n = state.view.nrows.toLocaleString();
    msg.className = 'query-msg ok';
    msg.textContent = t('filter.matched', { n });
    toast(t('filter.matched', { n }), 'ok');
    pushCode('query', `df = df.query(${pyStr(state.queryText)})`);
  } else {
    msg.className = 'query-msg';
    msg.textContent = '';
  }
  renderAfterFilter();
  renderCode();
  syncUrl();
}

/* ------------------------------- groupby --------------------------------- */

/* -------------------------------- pivot ---------------------------------- */
/* The pivot builder lives in the groupby tab and is read straight from the
 * DOM. One source of truth means the heatmap's "pivot aggregation" mode and
 * the table beneath the builder can never drift apart. */

function readPivotConfig() {
  const sel = (id) => ($(id) ? [...$(id).selectedOptions].map((o) => o.value) : []);
  return {
    rows: sel('#pvRows'),
    cols: sel('#pvCols'),
    value: $('#pvValue') ? $('#pvValue').value : null,
    agg: $('#pvAgg') ? $('#pvAgg').value : 'mean',
  };
}

const pivotCall = (cfg) =>
  `df.pivot_table(index=${pyList(cfg.rows)}, columns=${pyList(cfg.cols)}, `
  + `values=${py(cfg.value)}, aggfunc=${py(cfg.agg)})`;

function renderPivotPanel() {
  const host = $('#pivotTable');
  const df = state.view;
  if (!host) return;
  if (!df) { host.innerHTML = ''; return; }

  const cfg = readPivotConfig();
  state.pivot = cfg;
  if (!cfg.rows.length || !cfg.value || !df.has(cfg.value)) {
    host.innerHTML = `<p class="muted-note" style="padding:14px">${esc(t('pivot.needFields'))}</p>`;
    return;
  }

  const pv = pivotTable(df, cfg);
  if (!pv || !pv.rowKeys.length) {
    host.innerHTML = `<p class="muted-note" style="padding:14px">${esc(t('pivot.empty'))}</p>`;
    return;
  }
  /* Rendering the grid means one cell per row × column; past the budget there
     is nothing useful to show, so say so rather than freeze the tab. */
  if (pv.tooLarge) {
    host.innerHTML = `<p class="muted-note" style="padding:14px">${esc(t('pivot.tooLarge', {
      r: pv.rowKeys.length, c: pv.colKeys.length, max: pv.maxCells,
    }))}</p>`;
    return;
  }

  const head = `<tr><th>${esc(cfg.rows.join(' / '))}${
    cfg.cols.length ? ` \\ ${esc(cfg.cols.join(' / '))}` : ''}</th>${
    pv.colKeys.map((c) => `<th class="num">${esc(c || '—')}</th>`).join('')}</tr>`;
  const body = pv.rowKeys.map((r, i) => `<tr><td>${esc(r)}</td>${
    pv.grid[i].map((v) => `<td class="num">${v === null ? '—' : CH.fmtNum(v, 2)}</td>`).join('')
  }</tr>`).join('');

  host.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>
    <p class="muted-note test-note">${esc(t('pivot.code', { code: pivotCall(cfg) }))}</p>`;
}

function renderGroupby() {
  const sub = $('#gbSub');
  if (sub) sub.textContent = t('gb.selectHint');
}

function runGroupby(demo = false) {
  const df = state.df;
  if (!df) return;

  let by = [...$('#gbBy').selectedOptions].map((o) => o.value);
  let cols = [...$('#gbCol').selectedOptions].map((o) => o.value);
  let fns = $$('#gbFuncs input:checked').map((i) => i.value);

  if (demo) {
    by = df.categoricalCols.filter((c) => df.nunique(c) <= 12).slice(0, 1);
    cols = df.numericCols.slice(0, 3);
    fns = ['sum', 'mean'];
    [...$('#gbBy').options].forEach((o) => { o.selected = by.includes(o.value); });
    [...$('#gbCol').options].forEach((o) => { o.selected = cols.includes(o.value); });
    $$('#gbFuncs label').forEach((l) => {
      const i = l.querySelector('input');
      i.checked = fns.includes(i.value);
      l.classList.toggle('is-on', i.checked);
    });
  }

  if (!by.length) { toast(t('gb.needBy'), 'err'); return; }
  if (!cols.length || !fns.length) { toast(t('gb.needAgg'), 'err'); return; }

  const aggs = [];
  for (const c of cols) for (const fn of fns) aggs.push({ col: c, fn, alias: `${c}_${fn}` });

  const result = df.groupby(by, aggs);
  const host = $('#gbTable');

  const head = `<tr><th>${t('table.index')}</th>${result.colNames.map((c) => {
    const isNum = result.type(c) === 'number';
    return `<th class="${isNum ? 'num' : ''}">${esc(c)}</th>`;
  }).join('')}</tr>`;

  const body = result.toMatrix().map((r, i) => `<tr><td class="td-idx">${i}</td>${
    r.map((v, j) => {
      const type = result.columns[j].type;
      if (v === null || v === undefined) return '<td class="num na">NaN</td>';
      return type === 'number' ? `<td class="num">${CH.fmtNum(v, 3)}</td>` : `<td>${esc(v)}</td>`;
    }).join('')}</tr>`).join('');

  host.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  $('#gbSub').textContent = t('gb.groups', { n: result.nrows, m: result.ncols });

  const aggCode = aggs.map((a) => `        ${a.alias}=(${py(a.col)}, ${py(AGG_SQL[a.fn])}),`).join('\n');
  pushCode('groupby',
    `df.groupby(${pyList(by)}).agg(\n${aggCode}\n).reset_index()`);

  toast(t('gb.done', { n: result.nrows }), 'ok');
  renderCode();
}

/* -------------------------------- charts --------------------------------- */

const CHART_TYPES = [
  ['bar', 'ct.bar'], ['line', 'ct.line'], ['area', 'ct.area'], ['scatter', 'ct.scatter'],
  ['hist', 'ct.hist'], ['box', 'ct.box'], ['pie', 'ct.pie'], ['heat', 'ct.heat'], ['grouped', 'ct.grouped'],
  ['missing', 'ct.missing'], ['parallel', 'ct.parallel'], ['splom', 'ct.splom'], ['qq', 'ct.qq'],
];

const CHART_ICONS = {
  bar: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 20h16M6 20v-8M11 20V6M16 20v-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 17l5-6 4 3 6-8" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  area: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 17l5-6 4 3 6-8v11H4z" stroke="currentColor" stroke-width="1.7" fill="currentColor" fill-opacity=".22" stroke-linejoin="round"/></svg>',
  scatter: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="7" cy="15" r="2" fill="currentColor"/><circle cx="12" cy="9" r="2" fill="currentColor"/><circle cx="17" cy="13" r="2" fill="currentColor"/><circle cx="10" cy="18" r="1.6" fill="currentColor" opacity=".6"/></svg>',
  hist: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 20h18M4 20v-5h4v5M9 20v-9h4v9M14 20v-4h4v4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>',
  box: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12h16" stroke="currentColor" stroke-width="1.6"/><rect x="7" y="8" width="10" height="8" rx="1.4" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 4v4M12 16v4" stroke="currentColor" stroke-width="1.7"/></svg>',
  pie: '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M12 12V4a8 8 0 018 8h-8z" fill="currentColor" opacity=".55"/></svg>',
  heat: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="3" width="6" height="6" rx="1.4" fill="currentColor" opacity=".85"/><rect x="10" y="3" width="6" height="6" rx="1.4" fill="currentColor" opacity=".4"/><rect x="17" y="3" width="4" height="6" rx="1.4" fill="currentColor" opacity=".65"/><rect x="3" y="10" width="6" height="6" rx="1.4" fill="currentColor" opacity=".45"/><rect x="10" y="10" width="6" height="6" rx="1.4" fill="currentColor" opacity=".9"/><rect x="17" y="10" width="4" height="6" rx="1.4" fill="currentColor" opacity=".3"/></svg>',
  grouped: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="4" y="10" width="6" height="10" rx="1.2" fill="currentColor" opacity=".8"/><rect x="4" y="15" width="6" height="5" rx="1.2" fill="currentColor" opacity=".4"/><rect x="14" y="6" width="6" height="14" rx="1.2" fill="currentColor" opacity=".8"/><rect x="14" y="13" width="6" height="7" rx="1.2" fill="currentColor" opacity=".4"/></svg>',
  missing: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="4" width="18" height="16" rx="1.6" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="5.5" y="6.5" width="3" height="3" fill="currentColor" opacity=".28"/><rect x="10" y="6.5" width="3" height="3" fill="currentColor"/><rect x="14.5" y="6.5" width="3" height="3" fill="currentColor" opacity=".28"/><rect x="5.5" y="11" width="3" height="3" fill="currentColor"/><rect x="10" y="11" width="3" height="3" fill="currentColor" opacity=".28"/><rect x="14.5" y="11" width="3" height="3" fill="currentColor" opacity=".28"/><rect x="5.5" y="15.5" width="3" height="3" fill="currentColor" opacity=".28"/><rect x="10" y="15.5" width="3" height="3" fill="currentColor" opacity=".28"/><rect x="14.5" y="15.5" width="3" height="3" fill="currentColor"/></svg>',
  parallel: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 4v16M12 4v16M19 4v16" stroke="currentColor" stroke-width="1.4" opacity=".45" stroke-linecap="round"/><path d="M5 8l7 4 7-6M5 14l7-3 7 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  splom: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="3" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="none"/><rect x="13" y="3" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="none"/><rect x="3" y="13" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="none"/><rect x="13" y="13" width="8" height="8" rx="1.2" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="5" r="1" fill="currentColor"/><circle cx="19" cy="8" r="1" fill="currentColor"/><circle cx="6" cy="16" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/><circle cx="19" cy="19" r="1" fill="currentColor"/></svg>',
  qq: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3 2.4" fill="none" stroke-linecap="round"/><circle cx="6" cy="18" r="1.7" fill="currentColor"/><circle cx="9" cy="14.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12.5" r="1.7" fill="currentColor"/><circle cx="15.5" cy="9" r="1.7" fill="currentColor"/><circle cx="19" cy="6" r="1.7" fill="currentColor"/></svg>',
};

function renderChartTypes() {
  const host = $('#chartTypes');
  if (host.childElementCount) return;
  for (const [type, key] of CHART_TYPES) {
    const b = el('button', { class: 'chart-type', type: 'button', 'data-type': type });
    b.innerHTML = `${CHART_ICONS[type]}<span>${esc(t(key))}</span>`;
    b.addEventListener('click', () => {
      state.chartType = type;
      $$('.chart-type').forEach((x) => x.classList.toggle('is-on', x.dataset.type === type));
      syncChartFields();
      autoFillChartConfig();
      renderCharts();
      syncUrl();
    });
    host.appendChild(b);
  }
  $$('.chart-type').forEach((x) => x.classList.toggle('is-on', x.dataset.type === state.chartType));
  syncChartFields();
}

/**
 * Which mapping control each chart type actually reads. Controls are tagged in
 * the markup with `data-field`, so the panel only ever shows inputs that will
 * change what you see — a correlation matrix has no axes, parallel coordinates
 * have no X/Y, and a histogram has no aggregation.
 */
const FIELD_FOR = {
  bar: ['x', 'y', 'series', 'agg', 'sort', 'topN', 'stack', 'label'],
  line: ['x', 'y', 'series', 'agg', 'sort', 'topN', 'smooth', 'label'],
  area: ['x', 'y', 'series', 'agg', 'sort', 'topN', 'smooth', 'label'],
  grouped: ['x', 'y', 'series', 'agg', 'sort', 'topN', 'stack', 'label'],
  scatter: ['x', 'y', 'series', 'sort', 'topN', 'smooth'],
  /* hist and qq both reduce one numeric column, and the Y picker is the only
     one populated with numeric columns — so Y is what they must show. The old
     entry exposed X while the code read yCol, which meant choosing a column
     for a histogram silently did nothing. */
  hist: ['y', 'bins', 'series', 'sort', 'topN'],
  box: ['x', 'y', 'series', 'sort', 'topN'],
  pie: ['x', 'y', 'agg', 'sort', 'topN'],
  heat: ['heatMode'],
  missing: [],
  parallel: ['numCols', 'series', 'smooth'],
  splom: ['numCols'],
  qq: ['y'],
};

function syncChartFields() {
  const type = state.chartType;
  const on = new Set(FIELD_FOR[type] || FIELD_FOR.bar);

  $$('#chartConfig [data-field]').forEach((node) => {
    // a wrapper may cover several controls ("xy" holds both the X and Y rows)
    node.hidden = !node.dataset.field.split(' ').some((tok) => on.has(tok));
  });

  const hint = $('#chartDrillHint');
  if (hint) hint.hidden = !DRILLABLE.includes(type);
}

/* ------------------------- smart column defaults -------------------------- */

/** Rank numeric columns so ids/indexes never become the charted measure. */
function rankedNumeric(df) {
  const score = (c) => {
    const uniq = df.nunique(c);
    const vals = df.values(c).map(Number).filter((v) => !Number.isNaN(v));
    const hasDecimal = vals.some((v) => !Number.isInteger(v));
    const allUnique = uniq >= df.nrows * 0.98;

    let s = 0;
    if (/(^|[_.])id$|^id$|index|编号|序号|号码/i.test(c)) s -= 200;
    // an integer column where every row is unique *and* monotonic is a key, not a measure
    let monoInc = true, monoDec = true;
    for (let i = 1; i < Math.min(vals.length, 300); i++) {
      if (!(vals[i] > vals[i - 1])) monoInc = false;
      if (!(vals[i] < vals[i - 1])) monoDec = false;
    }
    if (allUnique && !hasDecimal) s -= 80;
    if (allUnique && (monoInc || monoDec)) s -= 120;

    if (/revenue|sales|gmv|amount|profit|income|turnover|销售额|收入|利润|金额/i.test(c)) s += 50;
    if (/rating|score|grade|quality|评分|得分|分数/i.test(c)) s += 25;
    if (/units|qty|quantity|volume|count|数量|销量|人数/i.test(c)) s += 18;
    if (/price|cost|fee|expense|价格|成本|费用/i.test(c)) s += 12;
    if (hasDecimal) s += 6;
    return s;
  };
  return [...df.numericCols].sort((a, b) => score(b) - score(a));
}

/** Prefer a modest-cardinality, semantically "grouping-ish" categorical column. */
function pickCategorical(df) {
  const cats = df.categoricalCols.filter((c) => df.nunique(c) >= 2);
  const score = (c) => {
    const u = df.nunique(c);
    let s = u >= 3 && u <= 8 ? 34 : (u === 2 ? 26 : (u <= 12 ? 22 : (u <= 20 ? 10 : -25)));
    if (/categor|region|segment|channel|group|class|species|grade|level|类别|地区|区域|分类|渠道|品类|类型|等级/i.test(c)) s += 25;
    if (/(^|[_.])id$|index|日期|编号/i.test(c)) s -= 20;
    return s;
  };
  return cats.sort((a, b) => score(b) - score(a))[0] || df.colNames[0];
}

function autoFillChartConfig() {
  const df = state.view || state.df;
  if (!df || !df.ncols) return;
  const type = state.chartType;
  const nums = rankedNumeric(df);
  const cat = pickCategorical(df);
  const best = nums[0];
  const setIf = (sel, val) => { if (val && [...sel.options].some((o) => o.value === val)) sel.value = val; };

  if (type === 'hist' || type === 'box') {
    if (cat) setIf($('#chX'), cat);
    if (best) setIf($('#chY'), best);
    return;
  }
  if (type === 'scatter') {
    // X: a plausible "driver" column, else the runner-up measure
    const driver = df.numericCols.find((c) => c !== best &&
      /units|qty|quantity|volume|count|hours|size|age|price|数量|时长|年龄|价格/i.test(c));
    setIf($('#chX'), driver || nums[1] || best);
    setIf($('#chY'), best);
    return;
  }
  if (type === 'heat') return;

  // bar / grouped / line / area / pie
  const dateCol = df.columns.find((c) => c.type === 'date');
  if ((type === 'line' || type === 'area') && dateCol) {
    setIf($('#chX'), dateCol.name);
    $('#chSort').value = 'none';       // keep the chronological order as-is
  } else {
    setIf($('#chX'), cat);
  }
  if (best) setIf($('#chY'), best);
}

function chartTitle(xName, yLabel, aggWord, type) {
  const isPie = type === 'pie';
  let s = isPie
    ? t('chart.titlePie', { y: yLabel, x: xName })
    : t('chart.title', { agg: aggWord, y: yLabel, x: xName });
  if (!$('#chSeries').value && !isPie) return s;
  if ($('#chSeries').value && !isPie) s += t('chart.bySeries', { s: $('#chSeries').value });
  return s;
}

function renderCharts() {
  const df = state.view;
  if (!df) return;
  renderChartTypes();

  const type = state.chartType;
  const xCol = $('#chX').value;
  const yCol = $('#chY').value;
  const sCol = $('#chSeries').value;
  const aggFn = $('#chAgg').value || 'sum';
  const sortMode = $('#chSort').value;
  const topN = Number($('#chTop').value) || 0;
  const bins = Math.max(2, Math.min(100, Number($('#chBins').value) || 20));

  const stage = $('#mainChart');
  const titleEl = $('#chartTitle');
  const subEl = $('#chartSub');
  const dataHost = $('#chartDataTable');

  let model = null;
  let option = null;
  let aggWord = '';

  /** Render and re-attach the drill-down click handler in one step. */
  const paint = (opt) => {
    CH.renderChart(stage, opt);
    wireChartClick();
    renderChartA11y(stage, opt, $('#chartA11y'));
  };

  state.chartModel = null;

  /* The library may still be downloading. A blank box reads as "your data is
     broken", so say what is actually happening instead. */
  if (!state.echartsReady) { chartPending(stage); return; }

  /* chart types that read a multi-column numeric selection instead of X/Y */
  const NO_XY = ['heat', 'missing', 'parallel', 'splom'];

  /* nothing chosen yet (e.g. right after a dataset swap) — show a friendly hint */
  if (!NO_XY.includes(type) && (!xCol || !df.has(xCol))) {
    titleEl.textContent = '—';
    subEl.textContent = '';
    chartPlaceholder(t('chart.none'));
    return;
  }

  try {
    if (type === 'heat') {
      const heatMode = $('#chHeatMode') ? $('#chHeatMode').value : 'corr';

      /* the generic X × Y × aggregation view: same renderer, data from the
         pivot builder instead of the correlation matrix */
      if (heatMode === 'pivot') {
        const cfg = readPivotConfig();
        const pv = cfg && cfg.value && cfg.rows.length ? pivotTable(df, cfg) : null;
        if (!pv || !pv.rowKeys.length) {
          titleEl.textContent = '—'; subEl.textContent = '';
          chartPlaceholder(t('chart.heatNeedsPivot'));
          return;
        }
        if (pv.tooLarge) {
          titleEl.textContent = '—';
          subEl.textContent = '';
          chartPlaceholder(t('pivot.tooLarge', {
            r: pv.rowKeys.length, c: pv.colKeys.length, max: pv.maxCells,
          }));
          return;
        }
        state.chartModel = { type: 'heat', pivot: true };
        const opt2 = CH.buildOption('heat', { pivot: pv, title: null }, {}, CH.chartTheme());
        titleEl.textContent = `${pv.value} · ${pv.rowKeys.length} × ${pv.colKeys.length}`;
        const call = pivotCall(cfg);
        subEl.textContent = call;
        CH.renderChart(stage, opt2);
        wireChartClick();
        dataHost.innerHTML = `<table class="data"><thead><tr><th></th>${
          pv.colKeys.map((c) => `<th class="num">${esc(c || '—')}</th>`).join('')}</tr></thead><tbody>${
          pv.rowKeys.map((r, i) => `<tr><td>${esc(r)}</td>${
            pv.grid[i].map((v) => `<td class="num">${v === null ? '—' : CH.fmtNum(v, 2)}</td>`).join('')
          }</tr>`).join('')}</tbody></table>`;
        state.currentCode = call.replace(/\s+/g, ' ');
        pushCode('pivot', state.currentCode);
        return;
      }

      const corr = df.corr();
      if (corr.cols.length < 2) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('stats.noNumeric'));
        return;
      }
      const opt2 = CH.buildOption('heat', { corr, title: null }, {}, CH.chartTheme());
      titleEl.textContent = `corr() · ${corr.cols.length} × ${corr.cols.length}`;
      subEl.textContent = 'df.corr(numeric_only=True)';
      state.chartModel = { type: 'heat', pivot: false };
      CH.renderChart(stage, opt2);
      wireChartClick();
      dataHost.innerHTML = '';
      state.currentCode = 'df.corr(numeric_only=True).round(2)';
      pushCode('corr', state.currentCode);
      return;
    }

    /* ---------------------- missingness matrix ------------------------ */
    if (type === 'missing') {
      const matrix = missingMatrix(df, 260, 30);
      if (!matrix.cols.length) {
        titleEl.textContent = '—'; subEl.textContent = '';
        state.chartModel = null;
        chartPlaceholder(t('chart.noMissing'));
        return;
      }
      model = {
        matrix,
        labels: {
          rows: t('miss.rowsAxis'),
          row: t('miss.row'),
          present: t('miss.present'),
          missing: t('miss.missing'),
          isMissing: t('miss.isMissing'),
        },
        sampledNote: matrix.step > 1 ? ` (1/${matrix.step})` : '',
      };
      state.chartModel = { type: 'missing', cols: matrix.cols };

      titleEl.textContent = t('chart.missingTitle', { n: matrix.cols.length });
      subEl.textContent = `df.isna().mean().sort_values(ascending=False)`;
      paint(CH.missingnessOption(model, CH.chartTheme()));
      state.currentCode = 'df.isna().mean().sort_values(ascending=False).round(4)';
      pushCode('missing', state.currentCode);
      sub2(subEl, matrix.sampled);

      dataHost.innerHTML = `<table class="data"><thead><tr><th>${esc(t('stats.column'))}</th>
        <th class="num">${esc(t('stats.missingCol'))}</th><th class="num">${esc(t('stats.missingPct'))}</th><th></th></tr></thead><tbody>${
        matrix.cols.map((c, i) => {
          const pct = matrix.rates[i] * 100;
          return `<tr><td>${esc(c)}</td><td class="num">${Math.round(matrix.rates[i] * matrix.total).toLocaleString()}</td>
            <td class="num">${pct.toFixed(1)}%</td>
            <td style="width:120px"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td></tr>`;
        }).join('')}</tbody></table>`;
      return;
    }

    /* ------------------ multivariate: parallel / SPLOM ----------------- */
    if (type === 'parallel' || type === 'splom') {
      const cap = type === 'splom' ? 4 : 8;
      let chosen = ($('#chNumCols') ? [...$('#chNumCols').selectedOptions].map((o) => o.value) : [])
        .filter((c) => df.numericCols.includes(c));
      if (chosen.length < 2) chosen = rankedNumeric(df);
      chosen = chosen.slice(0, cap);

      if (chosen.length < 2) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needTwoNumeric'));
        return;
      }

      const nm = numericMatrix(df, chosen, type === 'splom' ? 700 : 1200);
      if (!nm.rows.length) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needTwoNumeric'));
        return;
      }

      if (type === 'parallel') {
        const dims = chosen.map((c, i) => {
          let lo = Infinity, hi = -Infinity;
          for (const r of nm.rows) { if (r[i] < lo) lo = r[i]; if (r[i] > hi) hi = r[i]; }
          return { name: c, min: lo, max: hi };
        });
        const sCol = $('#chSeries').value;
        const colors = CH.chartTheme().colors;
        let groups;
        if (sCol && df.has(sCol)) {
          const buckets = new Map();
          for (let k = 0; k < nm.rows.length; k++) {
            const key = String(df.values(sCol)[nm.indices[k]] ?? '');
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(nm.rows[k]);
          }
          groups = [...buckets.entries()].slice(0, 10)
            .map(([name, rows], i) => ({ name, rows, color: colors[i % colors.length] }));
        } else {
          groups = [{ name: '', rows: nm.rows, color: colors[0] }];
        }
        state.chartModel = { type: 'parallel' };
        titleEl.textContent = t('chart.parallelTitle', { n: chosen.length });
        /* Name everything the call determines. pandas' second positional
           argument is `class_column`, not the list of axes: printing only that
           beside a title saying "2 dimensions" reads as if one column were
           being plotted. The generated code below is the same call verbatim. */
        const classCol = sCol || chosen[0];
        subEl.textContent = `parallel_coordinates(df, ${py(classCol)}, cols=${pyList(chosen)})`;
        paint(CH.parallelOption({ dims, groups }, {
          smooth: $('#chSmooth').checked, opacity: 0.42,
        }, CH.chartTheme()));
        sub2(subEl, nm.rows.length);
        state.currentCode = `from pandas.plotting import parallel_coordinates\n\nparallel_coordinates(df, ${py(sCol || chosen[0])}, cols=${pyList(chosen)})`;
        pushCode('parallel', state.currentCode);
        dataHost.innerHTML = '';
        return;
      }

      const cells = {};
      for (let r = 0; r < chosen.length; r++) {
        for (let c = 0; c < chosen.length; c++) {
          if (r === c) continue;
          cells[`${r},${c}`] = nm.rows.map((row) => [row[c], row[r]]);
        }
      }
      state.chartModel = { type: 'splom' };
      titleEl.textContent = t('chart.splomTitle', { n: chosen.length });
      subEl.textContent = `px.scatter_matrix(df, dimensions=${pyList(chosen)})`;
      paint(CH.splomOption({ variables: chosen, cells }, CH.chartTheme()));
      sub2(subEl, nm.rows.length);
      state.currentCode = `import plotly.express as px\n\npx.scatter_matrix(df, dimensions=${pyList(chosen)}, opacity=0.4)`;
      pushCode('splom', state.currentCode);
      dataHost.innerHTML = '';
      return;
    }

    if (type === 'scatter') {
      const y = yCol || df.numericCols[1] || df.numericCols[0];
      if (!y || !df.numericCols.includes(xCol) || !df.numericCols.includes(y)) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needNumeric'));
        return;
      }
      const groups = new Map();
      const sVals = sCol ? df.unique(sCol).slice(0, 10) : [null];
      for (const s of sVals) groups.set(String(s), []);
      const keyOf = (i) => (sCol ? String(df.values(sCol)[i] ?? '') : 'null');
      for (let i = 0; i < df.nrows; i++) {
        const xv = Number(df.values(xCol)[i]);
        const yv = Number(df.values(y)[i]);
        if (Number.isNaN(xv) || Number.isNaN(yv)) continue;
        const k = keyOf(i);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push([xv, yv]);
      }
      const allPoints = [...groups.values()].flat();
      const fit = linearFit(
        allPoints.map((p) => p[0]),
        allPoints.map((p) => p[1]),
      );
      model = {
        scatter: [...groups.entries()].filter(([, p]) => p.length)
          .map(([name, points]) => ({ name: sCol ? name : `${xCol} vs ${y}`, points })),
        xName: xCol, yName: y,
        /* one line across the whole cloud: with a series split the caller is
           comparing groups, and a single fit would misrepresent them */
        fit: sCol ? null : fit,
        fitLabel: t('chart.fitLabel'),
      };
      option = CH.buildOption('scatter', model, {}, CH.chartTheme());
      titleEl.textContent = `${xCol} vs ${y}`;
      subEl.textContent = `df.plot.scatter(x=${py(xCol)}, y=${py(y)})`;
      state.currentCode = `df.plot.scatter(x=${py(xCol)}, y=${py(y)})`;
      pushCode('scatter', state.currentCode);
      sub2(subEl, model.scatter.reduce((a, s) => a + s.points.length, 0));
      if (fit && fit.r2 !== null) {
        subEl.textContent = `${subEl.textContent} · ${t('chart.fitTitle', {
          a: CH.fmtNum(fit.slope, 3), b: CH.fmtNum(fit.intercept, 3), r2: CH.fmtNum(fit.r2, 3),
        })}`;
      }
      paint(option);
      dataHost.innerHTML = '';
      return;
    }

    if (type === 'qq') {
      const col = yCol || df.numericCols[0];
      if (!col || !df.numericCols.includes(col)) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needNumeric'));
        return;
      }
      const qd = qqData(df.values(col));
      if (!qd) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needFive'));
        return;
      }
      const jb = jarqueBera(df.values(col));
      model = {
        qq: qd,
        labels: {
          theoretical: t('chart.qqTheoretical'),
          sample: t('chart.qqSample'),
          points: t('chart.qqPoints'),
          reference: t('chart.qqReference'),
        },
      };
      state.chartModel = { type: 'qq', col, n: qd.n };
      option = CH.buildOption('qq', model, {}, CH.chartTheme());
      titleEl.textContent = t('chart.qqTitle', { col });
      /* the Jarque-Bera statistic is what turns "these points look straight"
         into a number, and it is already computed for the tests panel */
      subEl.textContent = jb
        ? `${t('chart.qqDesc')} · JB=${CH.fmtNum(jb.jb, 2)}, p=${fmtP(jb.p)}`
        : t('chart.qqDesc');
      state.currentCode = `scipy.stats.probplot(df[${py(col)}], dist="norm")`;
      pushCode('qq', state.currentCode);
      sub2(subEl, qd.sampled);
      paint(option);
      dataHost.innerHTML = `<table class="data"><thead><tr><th>${esc(t('chart.qqTheoretical'))}</th><th class="num">${esc(t('chart.qqSample'))}</th></tr></thead><tbody>${
        qd.points.slice(0, 60).map((p) => `<tr><td class="num">${CH.fmtNum(p[0], 3)}</td><td class="num">${CH.fmtNum(p[1], 3)}</td></tr>`).join('')
      }</tbody></table>`;
      return;
    }

    if (type === 'hist') {
      const y = yCol || df.numericCols[0];
      if (!y || !df.numericCols.includes(y)) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needNumeric'));
        return;
      }
      const h = histogram(df.values(y), bins);
      state.chartModel = { type: 'hist', col: y, edges: h.edges };
      model = {
        categories: h.edges.slice(0, -1).map((e, i) => `${CH.fmtNum(e, 1)}–${CH.fmtNum(h.edges[i + 1], 1)}`),
        series: [{ name: y, values: h.counts }],
        xName: y, yName: t('chart.count'),
      };
      option = CH.buildOption('hist', model, {}, CH.chartTheme());
      titleEl.textContent = `hist(${y}, bins=${bins})`;
      subEl.textContent = `df[${py(y)}].plot.hist(bins=${bins})`;
      state.currentCode = `df[${py(y)}].plot.hist(bins=${bins}, edgecolor="white")`;
      pushCode('hist', state.currentCode);
      sub2(subEl, h.counts.reduce((a, b) => a + b, 0));
      paint(option);
      dataHost.innerHTML = `<table class="data"><thead><tr><th>bin</th><th class="num">${t('stats.freq')}</th></tr></thead><tbody>${
        model.categories.map((c, i) => `<tr><td>${esc(c)}</td><td class="num">${h.counts[i]}</td></tr>`).join('')}</tbody></table>`;
      return;
    }

    if (type === 'box') {
      const y = yCol || df.numericCols[0];
      if (!y || !df.numericCols.includes(y)) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('chart.needNumeric'));
        return;
      }
      const groups = new Map();
      for (let i = 0; i < df.nrows; i++) {
        const k = String(df.values(xCol)[i] ?? '');
        const v = Number(df.values(y)[i]);
        if (Number.isNaN(v)) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(v);
      }
      let entries = [...groups.entries()].filter(([, v]) => v.length >= 2);
      entries.sort((a, b) => medianOf(b[1]) - medianOf(a[1]));
      if (topN) entries = entries.slice(0, topN);
      state.chartModel = { type: 'box' };
      model = {
        categories: entries.map(([k]) => k),
        box: entries.map(([k, v]) => {
          const d = describeSeries(v);
          return { name: k, stats: [d.min, d.q25, d.q50, d.q75, d.max] };
        }),
        series: [],
        xName: xCol, yName: y,
      };
      option = CH.buildOption('box', model, {}, CH.chartTheme());
      titleEl.textContent = `boxplot(${y} by ${xCol})`;
      subEl.textContent = `df.boxplot(column=${py(y)}, by=${py(xCol)})`;
      state.currentCode = `df.boxplot(column=${py(y)}, by=${py(xCol)}, grid=False)`;
      pushCode('box', state.currentCode);
      sub2(subEl, entries.length);
      paint(option);
      dataHost.innerHTML = `<table class="data"><thead><tr><th>${esc(xCol)}</th><th class="num">min</th><th class="num">Q1</th><th class="num">median</th><th class="num">Q3</th><th class="num">max</th></tr></thead><tbody>${
        model.box.map((b) => `<tr><td>${esc(b.name)}</td>${b.stats.map((s) => `<td class="num">${CH.fmtNum(s, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return;
    }

    /* ---- categorical aggregations: bar / grouped / line / area / pie ---- */
    const SINGLE = '__single__';
    const byCols = sCol ? [xCol, sCol] : [xCol];
    const aggCol = yCol || xCol;
    const fn = yCol ? aggFn : 'count';
    aggWord = yCol ? aggLabel(fn) : t('chart.count');
    const yLabel = yCol || t('chart.count');

    const gb = df.groupby(byCols, [{ col: aggCol, fn, alias: 'value' }]);

    const cats = [];
    const catSet = new Set();
    const seriesNames = [];
    const seriesSet = new Set();
    for (let i = 0; i < gb.nrows; i++) {
      const c = String(gb.values(xCol)[i]);
      if (!catSet.has(c)) { catSet.add(c); cats.push(c); }
      if (sCol) {
        const s = String(gb.values(sCol)[i]);
        if (!seriesSet.has(s)) { seriesSet.add(s); seriesNames.push(s); }
      }
    }
    const keys = sCol ? seriesNames : [SINGLE];
    const labelOf = (k) => (k === SINGLE ? `${yLabel} · ${aggWord}` : k);

    const lookup = new Map();
    for (let i = 0; i < gb.nrows; i++) {
      const c = String(gb.values(xCol)[i]);
      const s = sCol ? String(gb.values(sCol)[i]) : SINGLE;
      lookup.set(`${s}\u0001${c}`, gb.values('value')[i]);
    }
    const totalOf = (c) => keys.reduce((s, k) => s + (Number(lookup.get(`${k}\u0001${c}`)) || 0), 0);

    let order = cats.slice();
    if (sortMode === 'cat') {
      order.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    } else if (sortMode === 'asc' || sortMode === 'desc') {
      order.sort((a, b) => (sortMode === 'asc' ? totalOf(a) - totalOf(b) : totalOf(b) - totalOf(a)));
    }
    let catsFinal = order;
    if (topN) catsFinal = catsFinal.slice(0, topN);

    const series = keys.map((k) => ({
      name: labelOf(k),
      values: catsFinal.map((c) => {
        const v = lookup.get(`${k}\u0001${c}`);
        return v === null || v === undefined ? 0 : Number(v);
      }),
    }));

    model = { categories: catsFinal, series, xName: xCol, yName: yLabel };

    if (type === 'pie') {
      model.series = [{ name: yLabel, values: catsFinal.map(totalOf) }];
    }

    option = CH.buildOption(type, model, {
      stack: $('#chStack').checked,
      smooth: $('#chSmooth').checked,
      label: $('#chLabel').checked,
    }, CH.chartTheme());

    titleEl.textContent = chartTitle(xCol, yLabel, aggWord, type);

    const kind = { bar: 'bar', grouped: 'bar', line: 'line', area: 'area', pie: 'pie' }[type];
    const aggPy = { count: 'count', sum: 'sum', mean: 'mean', median: 'median', min: 'min', max: 'max', std: 'std', nunique: 'nunique' }[fn];
    const base = (!yCol && !sCol)
      ? `df[${py(xCol)}].value_counts()`
      : `df.groupby(${pyList(byCols)})[${py(aggCol)}].${aggPy}()`;
    const sortCode = sortMode === 'desc' ? '.sort_values(ascending=False)'
      : (sortMode === 'asc' ? '.sort_values()' : '');
    const stackCode = sCol && type !== 'pie' ? '.unstack()' : '';
    const extra = type === 'pie' ? ', autopct="%1.1f%%"' : (type === 'grouped' ? ', stacked=True' : '');
    state.currentCode = `${base}${sortCode}${stackCode}\n    .plot(kind=${py(kind)}${extra})`;
    pushCode('chart', state.currentCode);

    subEl.textContent = `df.groupby(${pyList(byCols)})[${py(aggCol)}].${aggPy}()`;
    sub2(subEl, catsFinal.length);
    paint(option);

    dataHost.innerHTML = `<table class="data"><thead><tr><th>${esc(xCol)}</th>${
      series.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${
      catsFinal.map((c, i) => `<tr><td>${esc(c)}</td>${series.map((s) => `<td class="num">${CH.fmtNum(s.values[i], 3)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    state.chartModel = model;
    renderCode();
  } catch (err) {
    console.error(err);
    titleEl.textContent = '—';
    subEl.textContent = '';
    chartPlaceholder(String(err.message || err));
  }
}

/** Replace the chart area with a centred hint (and free the ECharts instance). */
function chartPlaceholder(msg) {
  const host = $('#mainChart');
  CH.clearChart(host);
  host.innerHTML = `<p class="muted-note" style="padding:34px;text-align:center">${esc(msg)}</p>`;
}

/** Append the data-point count to the chart subtitle without losing the base text. */
/** Append the point count to whatever base the active branch just wrote.
 *  Each branch always overwrites textContent first, so this needs no cache —
 *  and a cache would leak the previous chart type's subtitle across switches. */
function sub2(subEl, n) {
  subEl.textContent = `${subEl.textContent} · ${t('chart.rows', { n })}`;
  /* the subtitle is clipped to one line in CSS, so keep the whole call reachable */
  subEl.title = subEl.textContent;
}
const medianOf = (arr) => quantile(arr, 0.5);

/* --------------------------------- code ---------------------------------- */

function renderCode() {
  $('#codeCurrent').innerHTML = state.currentCode ? highlight(state.currentCode) : `<span class="c">${esc(t('code.empty'))}</span>`;
  $('#codeFull').innerHTML = highlight(buildFullScript());

  const host = $('#apiMapTable');
  if (!host.childElementCount) {
    const lang = getLang();
    const head = `<tr><th>${t('code.feature')}</th><th>pandas API</th></tr>`;
    const body = API_MAP.map((r) => `<tr><td>${esc(lang === 'zh' ? r[0] : r[1])}</td><td><code style="font-family:var(--font-mono);font-size:11.5px;color:var(--accent-ink)">${esc(r[2])}</code></td></tr>`).join('');
    host.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  } else {
    const lang = getLang();
    $$('#apiMapTable tbody tr').forEach((tr, i) => {
      if (API_MAP[i]) tr.firstElementChild.textContent = lang === 'zh' ? API_MAP[i][0] : API_MAP[i][1];
    });
  }
}

/* --------------------------------- ui ------------------------------------ */

function switchTab(name) {
  state.activeTab = name;
  $$('.tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  $$('.panel').forEach((p) => {
    const on = p.dataset.panel === name;
    p.classList.toggle('is-active', on);
    p.hidden = !on;
  });
  if (name === 'charts') setTimeout(() => CH.resizeAll(), 40);
  if (name === 'stats') setTimeout(() => CH.resizeAll(), 40);
}

function toast(msg, kind = 'info') {
  const stack = $('#toastStack');
  const node = el('div', { class: `toast ${kind}` });
  node.innerHTML = `<span class="t-ico"></span><span>${esc(msg)}</span>`;
  stack.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, 2600);
}

function showLoading(text) {
  $('#loadingText').textContent = text || 'Loading…';
  $('#loadingVeil').hidden = false;
}
function hideLoading() { $('#loadingVeil').hidden = true; }

/* ------------------------------- exporting -------------------------------- */
/* Six formats, one menu. CSV/JSON/XLSX carry the data, the HTML report is a
 * self-contained snapshot with the chart pixels inlined, and the .ipynb / .py
 * pair hand the analysis back as runnable pandas. Nothing here uploads. */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  a.style.display = 'none';
  // Firefox ignores a click on a detached anchor
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Derive a tidy file stem from whatever the dataset is currently called. */
function exportName(ext) {
  const stem = String(state.rawName || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${stem || 'pandalens'}.${ext}`;
}

const EXPORT_FORMATS = [
  { id: 'csv', labelKey: 'export.csv', hintKey: 'export.hintView' },
  { id: 'json', labelKey: 'export.json', hintKey: 'export.hintView' },
  { id: 'xlsx', labelKey: 'export.xlsx', hintKey: 'export.hintXlsx' },
  { id: 'html', labelKey: 'export.html', hintKey: 'export.hintReport' },
  { id: 'ipynb', labelKey: 'export.ipynb', hintKey: 'export.hintNotebook' },
  { id: 'py', labelKey: 'export.py', hintKey: 'export.hintScript' },
];

function renderExportMenu() {
  const menu = $('#exportMenu');
  if (!menu) return;
  menu.innerHTML = '';
  for (const f of EXPORT_FORMATS) {
    const b = el('button', { class: 'menu-item', type: 'button' });
    b.setAttribute('role', 'menuitem');
    b.appendChild(el('span', { class: 'mi-label', text: t(f.labelKey) }));
    b.appendChild(el('span', { class: 'mi-hint', text: t(f.hintKey) }));
    b.addEventListener('click', () => { closeExportMenu(); runExport(f.id); });
    menu.appendChild(b);
  }
}

function closeExportMenu() {
  const m = $('#exportMenu');
  if (m) m.classList.remove('is-open');
  const b = $('#btnExport');
  if (b) b.setAttribute('aria-expanded', 'false');
}

function runExport(id) {
  switch (id) {
    case 'csv': return exportCsv();
    case 'json': return exportJson();
    case 'xlsx': return exportXlsx();
    case 'html': return exportHtmlReport();
    case 'ipynb': return exportIpynb();
    case 'py': return exportPy();
    default: return undefined;
  }
}

function downloadText(text, filename, mime) {
  saveBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
  toast(t('export.done', { name: filename }), 'ok');
}

function exportCsv() {
  const df = state.view;
  if (!df) return;
  const cols = visibleCols();
  const q = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (let i = 0; i < df.nrows; i++) lines.push(cols.map((c) => q(df.values(c)[i])).join(','));
  const filename = exportName('csv');
  // the BOM is what makes Excel read the file as UTF-8 rather than Latin-1
  saveBlob(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
  toast(t('export.done', { name: filename }), 'ok');
  pushCode('export', `df.to_csv(${py(filename)}, index=False)`);
  renderCode();
}

function exportJson() {
  const df = state.view;
  if (!df) return;
  const cols = visibleCols();
  const records = [];
  for (let i = 0; i < df.nrows; i++) {
    const o = {};
    for (const c of cols) {
      const v = df.values(c)[i];
      o[c] = v === undefined ? null : v;
    }
    records.push(o);
  }
  const filename = exportName('json');
  downloadText(JSON.stringify(records), filename, 'application/json');
  pushCode('export', `df.to_json(${py(filename)}, orient="records", force_ascii=False)`);
  renderCode();
}

/** The describe() table, transposed so each column of the frame is a row. */
function summaryRows(df) {
  const desc = df.describe();
  const all = df.describeAll();
  const stats = ['count', 'mean', 'std', 'min', 'q25', 'q50', 'q75', 'max'];
  const rows = [[
    t('stats.column'), 'dtype', ...stats.map((s) => t(`stats.${s}`)),
    'unique', t('stats.missingCol'), 'top', 'freq',
  ]];
  for (const c of df.columns) {
    const a = all[c.name] || {};
    const missing = typeof a.count === 'number' ? df.nrows - a.count : null;
    if (c.type === 'number' && desc[c.name]) {
      rows.push([
        c.name, c.type,
        ...stats.map((s) => {
          const v = desc[c.name][s];
          return v === null || v === undefined ? null : v;
        }),
        null, missing, null, null,
      ]);
    } else {
      rows.push([
        c.name, c.type, ...stats.map(() => null),
        a.unique ?? null, missing, a.top ?? null, a.freq ?? null,
      ]);
    }
  }
  return rows;
}

function pivotRows(pv) {
  // an over-budget pivot has no grid to walk; the caller skips the sheet
  if (!pv || pv.tooLarge || !pv.grid) return [];
  const head = [`${pv.rows.join(' / ')}${pv.cols.length ? ` \\ ${pv.cols.join(' / ')}` : ''}`,
    ...pv.colKeys.map((c) => c || (pv.single ? pv.value : '—'))];
  return [head, ...pv.rowKeys.map((r, i) => [r, ...pv.grid[i]])];
}

/** Every sheet the workbook export will contain, in order. */
function buildExportSheets() {
  const df = state.view;
  const cols = visibleCols();

  const data = [cols.slice()];
  for (let i = 0; i < df.nrows; i++) {
    data.push(cols.map((c) => { const v = df.values(c)[i]; return v === undefined ? null : v; }));
  }
  const sheets = [{ name: t('export.sheetData'), rows: data }];

  if (df.numericCols.length) {
    sheets.push({ name: t('export.sheetSummary'), rows: summaryRows(df) });
  }

  const mrows = df.missingCounts()
    .filter((r) => r.missing > 0)
    .sort((a, b) => b.missing - a.missing);
  if (mrows.length) {
    sheets.push({
      name: t('export.sheetMissing'),
      rows: [
        [t('stats.column'), 'dtype', t('stats.missingCol'), t('stats.missingPct')],
        ...mrows.map((r) => [
          r.name, r.type, r.missing,
          r.total ? Number(((r.missing / r.total) * 100).toFixed(2)) : 0,
        ]),
      ],
    });
  }

  const cfg = readPivotConfig();
  if (cfg.rows.length && cfg.value && df.has(cfg.value)) {
    const rows = pivotRows(pivotTable(df, cfg));
    if (rows.length > 1) sheets.push({ name: t('export.sheetPivot'), rows });
  }
  return sheets;
}

async function exportXlsx() {
  const df = state.view;
  if (!df) return;

  const XLSX = await loadXLSX();
  if (!XLSX) { toast(t('xlsx.unavailable'), 'err'); return; }

  /* Writing a large workbook is synchronous and can take seconds. Yielding
     once after showing the veil lets the browser actually paint it, instead of
     handing the user a frozen tab with no explanation. */
  showLoading(t('export.working'));
  await new Promise((r) => setTimeout(r, 0));
  let bytes;
  try {
    bytes = writeWorkbook(XLSX, buildExportSheets());
  } catch {
    hideLoading();
    toast(t('export.failed'), 'err');
    return;
  }
  hideLoading();

  const filename = exportName('xlsx');
  saveBlob(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), filename);
  toast(t('export.done', { name: filename }), 'ok');
  pushCode('export', `df.to_excel(${py(filename)}, index=False)`);
  renderCode();
}

function exportPy() {
  if (!state.view) return;
  const filename = exportName('py');
  downloadText(buildFullScript() + '\n', filename, 'text/x-python');
}

function exportIpynb() {
  if (!state.view) return;
  const df = state.view;
  const now = new Date().toISOString();

  const md = [
    `# ${state.rawName}`,
    '',
    t('report.notebookIntro', { rows: df.nrows, cols: df.ncols }),
    '',
    `- ${t('kpi.rows')}: ${df.nrows}`,
    `- ${t('kpi.cols')}: ${df.ncols}`,
    `- ${t('kpi.numeric')}: ${df.numericCols.length}`,
    `- ${t('report.generated')}: ${now}`,
    '',
    t('report.notebookHint'),
  ].join('\n');

  const nb = {
    cells: [
      { cell_type: 'markdown', metadata: {}, source: md.split('\n').map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l)) },
      { cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: buildFullScript().split('\n').map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l)) },
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  const filename = exportName('ipynb');
  downloadText(JSON.stringify(nb, null, 1), filename, 'application/x-ipynb+json');
}

/* ---------------------------- the HTML report ------------------------------ */

const REPORT_CSS = `
:root{--bg:#f6f7f9;--surface:#fff;--ink:#16181d;--ink-2:#5b6272;--ink-3:#8b93a5;
--border:#e3e6ec;--accent:#4c6ef5;--ok:#12a150;--bad:#e5484d}
@media (prefers-color-scheme:dark){:root{--bg:#101216;--surface:#181b21;--ink:#eef0f4;
--ink-2:#a7aebd;--ink-3:#79808f;--border:#282c35;--accent:#7f96ff;--ok:#35c07a;--bad:#ff6369}}
*{box-sizing:border-box}
body{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--ink);
font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1040px;margin:0 auto}
h1{font-size:23px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:15px;margin:32px 0 10px;padding-bottom:7px;border-bottom:1px solid var(--border)}
.sub{color:var(--ink-2);margin:0 0 4px;font-size:13px}
.meta{color:var(--ink-3);font-size:12px;margin:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:20px 0 0}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 13px}
.kpi b{display:block;font-size:19px;font-variant-numeric:tabular-nums;margin-top:2px}
.kpi span{font-size:11.5px;color:var(--ink-3)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
padding:4px 14px 14px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{padding:5px 9px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
th{font-weight:600;color:var(--ink-2);font-size:11.5px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:last-child td{border-bottom:none}
pre{background:var(--surface);border:1px solid var(--border);border-radius:10px;
padding:14px;overflow-x:auto;font-size:12.5px;
font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
img.chart{max-width:100%;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.sig{color:var(--ok);font-weight:600}.ns{color:var(--bad)}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--border);
color:var(--ink-3);font-size:11.5px}
.note{color:var(--ink-3);font-size:12px;margin:8px 0 0}
`;

function reportTable(head, body, { numericFrom = 1 } = {}) {
  if (!body.length) return '';
  const th = head.map((h, i) => `<th${i >= numericFrom ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const tr = body.map((r) => `<tr>${r.map((c, i) => {
    const cls = i >= numericFrom ? ' class="num"' : '';
    const v = c === null || c === undefined ? '—' : (typeof c === 'number' ? CH.fmtNum(c, 4) : esc(c));
    return `<td${cls}>${v}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="card"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function exportHtmlReport() {
  const df = state.view;
  if (!df) return;

  const now = new Date();
  const parts = [];

  let missing = 0;
  for (const c of df.columns) {
    missing += df.values(c.name).filter((v) => v === null || v === undefined || v === '').length;
  }

  parts.push('<!DOCTYPE html>');
  parts.push(`<html lang="${getLang() === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">`);
  parts.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push(`<title>PandaLens · ${esc(state.rawName)}</title>`);
  parts.push(`<style>${REPORT_CSS}</style></head><body><div class="wrap">`);
  parts.push(`<h1>${esc(state.rawName)}</h1>`);
  parts.push(`<p class="sub">${esc(t('report.subtitle', { rows: df.nrows, cols: df.ncols }))}</p>`);
  parts.push(`<p class="meta">${esc(t('report.generated'))}: ${esc(now.toLocaleString())} · PandaLens</p>`);

  parts.push('<div class="kpis">');
  for (const [label, value] of [
    [t('kpi.rows'), df.nrows.toLocaleString()],
    [t('kpi.cols'), String(df.ncols)],
    [t('kpi.numeric'), String(df.numericCols.length)],
    [t('kpi.missing'), missing.toLocaleString()],
  ]) {
    parts.push(`<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b></div>`);
  }
  parts.push('</div>');

  /* the chart, inlined so the file opens with no network access at all */
  const png = CH.chartPngUrl($('#mainChart'));
  if (png) {
    parts.push(`<h2>${esc(t('report.chart'))}</h2>`);
    parts.push(`<img class="chart" alt="${esc(t('report.chartAlt'))}" src="${png}">`);
    if (state.chartType) parts.push(`<p class="note">${esc(t(`ct.${state.chartType}`))}</p>`);
  }

  if (df.numericCols.length) {
    const desc = df.describe();
    const stats = ['count', 'mean', 'std', 'min', 'q25', 'q50', 'q75', 'max'];
    const body = df.numericCols.map((c) => [c, ...stats.map((s) => desc[c][s])]);
    parts.push(`<h2>${esc(t('report.describe'))}</h2>`);
    parts.push(reportTable([t('stats.column'), ...stats.map((s) => t(`stats.${s}`))], body));
  }

  const mrows = df.missingCounts().filter((r) => r.missing > 0).sort((a, b) => b.missing - a.missing);
  if (mrows.length) {
    parts.push(`<h2>${esc(t('report.missing'))}</h2>`);
    parts.push(reportTable(
      [t('stats.column'), 'dtype', t('stats.missingCol'), t('stats.missingPct')],
      mrows.map((r) => [r.name, r.type, r.missing, r.total ? Number(((r.missing / r.total) * 100).toFixed(2)) : 0]),
      { numericFrom: 2 },
    ));
  }

  if (df.numericCols.length > 1) {
    const { cols, matrix } = df.corr();
    parts.push(`<h2>${esc(t('report.corr'))}</h2>`);
    parts.push(reportTable(
      [t('stats.column'), ...cols],
      cols.map((c, i) => [c, ...matrix[i].map((v) => (v === null ? null : v))]),
    ));
  }

  /* reuse the exact test results the Statistics tab is showing */
  const ts = state.testSummary;
  if (ts && ts.found && ts.found.length) {
    parts.push(`<h2>${esc(t('report.tests'))}</h2>`);
    const body = ts.found.map((r) => [
      t(r.key, r.params),
      CH.fmtNum(r.stat, 3),
      typeof r.df === 'number' ? r.df.toFixed(1) : r.df,
      fmtP(r.p),
      r.effect === null || r.effect === undefined ? '—' : `${CH.fmtNum(r.effect, 3)} ${r.effectName}`,
      `<span class="${r.p < 0.05 ? 'sig' : 'ns'}">${esc(t(r.p < 0.05 ? 'test.significant' : 'test.notSignificant'))}</span>`,
    ]);
    parts.push(reportTable(
      [t('test.name'), t('test.stat'), t('test.df'), 'p', t('test.effect'), t('test.verdict')],
      body,
    ));
    parts.push(`<p class="note">${esc(t('test.note', { p: '0.05' }))} · ${esc(t('report.testsScope', { g: ts.gCol, v: ts.vCol }))}</p>`);
  }

  parts.push(`<h2>${esc(t('report.code'))}</h2>`);
  parts.push(`<pre>${esc(buildFullScript())}</pre>`);

  parts.push(`<footer>${esc(t('report.footer'))}</footer>`);
  parts.push('</div></body></html>');

  const filename = exportName('html');
  downloadText(parts.join('\n'), filename, 'text/html');
}


async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { value: text });
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = t('action.copied');
  setTimeout(() => { btn.textContent = old; }, 1400);
}

/* -------------------------------- events --------------------------------- */

function bindEvents() {
  /* tabs */
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  /* language */
  $('#btnLang').addEventListener('click', () => {
    const next = getLang() === 'zh' ? 'en' : 'zh';
    setLang(next);
    $$('.lang-opt').forEach((o) => o.classList.toggle('is-on', o.dataset.lang === next));
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    document.title = next === 'zh' ? 'PandaLens · 可视化数据分析工作台' : 'PandaLens · Visual Data Analysis Workbench';
    applyStatic();
    $('#apiMapTable').innerHTML = '';   // rebuilt below with the new language
    $('#chartTypes').innerHTML = '';    // chart-type labels need re-rendering too
    refreshAll();
    renderChartTypes();
    CH.resizeAll();
  });

  /* theme */
  $('#btnTheme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('pandalens-theme', next);
    renderCharts();
    renderValueCounts();
    renderMissingChart();
  });

  /* file input + dropzone */
  const dz = $('#dropzone');
  const fi = $('#fileInput');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click(); });
  fi.addEventListener('change', () => { if (fi.files[0]) readFile(fi.files[0]); fi.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('is-over');
  }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  /* paste modal */
  $('#btnPaste').addEventListener('click', () => { $('#pasteModal').hidden = false; $('#pasteArea').focus(); });
  $('#btnClosePaste').addEventListener('click', () => { $('#pasteModal').hidden = true; });
  $('#btnCancelPaste').addEventListener('click', () => { $('#pasteModal').hidden = true; });
  $('#btnConfirmPaste').addEventListener('click', () => {
    const text = $('#pasteArea').value;
    if (!text.trim()) { toast(t('paste.empty'), 'err'); return; }
    if (loadText(text, 'pasted.csv')) { $('#pasteModal').hidden = true; }
  });
  $('#pasteModal').addEventListener('click', (e) => { if (e.target.id === 'pasteModal') $('#pasteModal').hidden = true; });

  /* help modal */
  $('#btnHelp').addEventListener('click', () => { $('#helpModal').hidden = false; });
  $('#btnCloseHelp').addEventListener('click', () => { $('#helpModal').hidden = true; });
  $('#helpModal').addEventListener('click', (e) => { if (e.target.id === 'helpModal') $('#helpModal').hidden = true; });

  /* table */
  $('#tableSearch').addEventListener('input', (e) => { state.search = e.target.value; state.page = 1; renderTable(); });
  $('#pageSize').addEventListener('change', (e) => {
    state.pageSize = e.target.value === 'virtual' ? 'virtual' : Number(e.target.value);
    state.page = 1;
    renderTable();
  });
  $('#tableScroll').addEventListener('scroll', onVirtualScroll, { passive: true });
  $('#colSearch').addEventListener('input', renderColumnList);

  const drop = $('#colVisDrop');
  drop.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    renderColVis();
    $('#colVisMenu').classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!drop.contains(e.target)) $('#colVisMenu').classList.remove('is-open');
  });

  const expDrop = $('#exportDrop');
  $('#btnExport').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#exportMenu');
    const open = menu.classList.toggle('is-open');
    $('#btnExport').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', (e) => {
    if (expDrop && !expDrop.contains(e.target)) closeExportMenu();
  });

  /* the sheet picker re-reads a sheet out of the workbook already in memory —
     no file access, no re-upload */
  const sheetSel = $('#sheetSelect');
  if (sheetSel) {
    sheetSel.addEventListener('change', () => {
      if (!applySheet(sheetSel.value)) sheetSel.value = state.workbook ? state.workbook.active : '';
    });
  }

  $('#btnReset').addEventListener('click', () => { resetPipeline(false); refreshAll(); toast(t('load.reset'), 'info'); });

  /* stats */
  $('#vcColumn').addEventListener('change', () => { renderValueCounts(); CH.resizeAll(); });
  $('#testGroup').addEventListener('change', renderTests);
  $('#testValue').addEventListener('change', renderTests);
  $('#testCat2').addEventListener('change', renderTests);

  /* filters */
  $('#btnAddFilter').addEventListener('click', () => {
    const df = state.df;
    if (!df) return;
    const type = df.columns[0].type;
    commit('hist.filterAdd');
    state.filters.push({
      col: type === 'number' ? df.numericCols[0] || df.colNames[0] : df.colNames[0],
      op: type === 'number' ? '>' : 'contains',
      value: '',
    });
    rebuild();
    renderPipelinePanels();
    syncUrl();
  });
  $('#btnClearFilter').addEventListener('click', () => {
    if (state.filters.length || state.queryText.trim()) commit('hist.filterClear');
    state.filters = [];
    state.queryText = '';
    $('#queryInput').value = '';
    rebuild();
    renderAfterFilter();
    pushCode('filter', t('code.clearedFilters'));
    syncUrl();
  });
  $('#btnRunQuery').addEventListener('click', runQuery);
  $('#queryInput').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery();
  });

  /* cleaning */
  $('#btnDropna').addEventListener('click', () => {
    const subset = [...$('#dropnaSubset').selectedOptions].map((o) => o.value);
    const before = state.df.nrows;
    commit('hist.dropna', { cols: subset.join(', ') || '—' });
    state.cleanOps.push({ kind: 'dropna', subset });
    rebuild();
    const removed = before - state.df.nrows;
    pushCode('clean', cleanOpCode({ kind: 'dropna', subset }));
    renderAfterFilter();
    syncUrl();
    toast(t('clean.dropnaDone', { n: removed }), removed ? 'ok' : 'info');
  });

  $('#btnFillna').addEventListener('click', () => {
    const col = $('#fillnaCol').value;
    const value = $('#fillnaValue').value;
    if (!col) { toast(t('clean.noneSelected'), 'err'); return; }
    const before = state.df.values(col).filter((v) => v === null || v === undefined || v === '').length;
    commit('hist.fillna', { col, value });
    state.cleanOps.push({ kind: 'fillna', col, value });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'fillna', col, value }));
    renderAfterFilter();
    syncUrl();
    toast(t('clean.fillnaDone', { n: before }), before ? 'ok' : 'info');
  });

  $('#btnAstype').addEventListener('click', () => {
    const col = $('#astypeCol').value;
    const type = $('#astypeType').value;
    if (!col) { toast(t('clean.noneSelected'), 'err'); return; }
    commit('hist.astype', { col, type });
    state.cleanOps.push({ kind: 'astype', col, type });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'astype', col, type }));
    renderAfterFilter();
    syncUrl();
    toast(t('clean.astypeDone', { col, type }), 'ok');
  });

  $('#btnDropDup').addEventListener('click', () => {
    const subset = [...$('#dupSubset').selectedOptions].map((o) => o.value);
    const before = state.df.nrows;
    commit('hist.dropdup', { cols: subset.join(', ') || '—' });
    state.cleanOps.push({ kind: 'dropdup', subset });
    rebuild();
    const removed = before - state.df.nrows;
    pushCode('clean', cleanOpCode({ kind: 'dropdup', subset }));
    renderAfterFilter();
    syncUrl();
    toast(t('clean.dupDone', { n: removed }), removed ? 'ok' : 'info');
  });

  $('#btnDropCol').addEventListener('click', () => {
    const cols = [...$('#dropCol').selectedOptions].map((o) => o.value);
    if (!cols.length) { toast(t('clean.noneSelected'), 'err'); return; }
    commit('hist.dropcol', { cols: cols.join(', ') });
    state.cleanOps.push({ kind: 'dropcol', cols });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'dropcol', cols }));
    renderAfterFilter();
    syncUrl();
    toast(t('clean.dropColDone', { cols: cols.join(', ') }), 'ok');
  });

  $('#btnRename').addEventListener('click', () => {
    const col = $('#renameCol').value;
    const value = $('#renameValue').value.trim();
    if (!col || !value) { toast(t('clean.noneSelected'), 'err'); return; }
    commit('hist.rename', { col, name: value });
    state.cleanOps.push({ kind: 'rename', col, value });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'rename', col, value }));
    renderAfterFilter();
    syncUrl();
    toast(t('clean.renameDone', { name: value }), 'ok');
  });

  /* groupby */
  $('#btnGroupby').addEventListener('click', () => runGroupby(false));
  $('#btnGroupbyDemo').addEventListener('click', () => runGroupby(true));

  /* pivot builder: every control refreshes the table, and the heatmap too if
     it happens to be showing the pivot aggregation */
  const onPivotChange = () => {
    renderPivotPanel();
    const mode = $('#chHeatMode') ? $('#chHeatMode').value : 'corr';
    if (state.chartType === 'heat' && mode === 'pivot') renderCharts();
  };
  ['#pvRows', '#pvCols', '#pvValue', '#pvAgg'].forEach((s) => {
    if ($(s)) $(s).addEventListener('change', onPivotChange);
  });
  if ($('#btnPivot')) $('#btnPivot').addEventListener('click', () => {
    renderPivotPanel();
    toast(t('pivot.done'), 'ok');
  });

  if ($('#conflictClose')) $('#conflictClose').addEventListener('click', () => {
    state.conflictDismissedFor = state.raw;
    $('#conflictCard').hidden = true;
  });

  /* charts */
  ['#chX', '#chY', '#chSeries', '#chAgg', '#chSort', '#chNumCols'].forEach((s) => {
    $(s).addEventListener('change', () => {
      renderCharts();
      syncUrl();
    });
  });
  ['#chTop', '#chBins'].forEach((s) => $(s).addEventListener('input', () => renderCharts()));
  ['#chStack', '#chSmooth', '#chLabel'].forEach((s) => $(s).addEventListener('change', () => renderCharts()));
  if ($('#chHeatMode')) $('#chHeatMode').addEventListener('change', () => renderCharts());
  $('#btnChartData').addEventListener('click', () => $('#chartDataTable').classList.toggle('collapsed'));

  /* One exporter for every chart surface. The old version returned a bare
     boolean that an `if` swallowed, so clicking before the chart finished
     rendering did nothing at all — no download, no message. */
  const exportPng = (sel, name) => {
    const res = CH.downloadChartPng($(sel), name);
    if (res.ok) toast(t('chart.exported'), 'ok');
    else if (res.reason === 'not-ready' || res.reason === 'no-chart') toast(t('chart.pngNotReady'), 'info');
    else toast(t('chart.pngFailed'), 'err');
  };
  $('#btnDownloadPng').addEventListener('click',
    () => exportPng('#mainChart', `pandalens-${state.chartType}.png`));
  $('#missDownloadPng').addEventListener('click',
    () => exportPng('#missChart', 'pandalens-missingness.png'));
  $('#vcDownloadPng').addEventListener('click',
    () => exportPng('#vcChart', 'pandalens-value-counts.png'));

  /* undo / redo / share */
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnShare').addEventListener('click', (e) => {
    syncUrl();
    copyText(state.shareUrl || location.href, e.currentTarget);
  });

  /* colour-blind safe palette */
  $('#btnCbSafe').addEventListener('click', () => {
    const on = !CH.isColorblindSafe();
    CH.setColorblindSafe(on);
    localStorage.setItem('pandalens-cbsafe', on ? '1' : '0');
    $('#btnCbSafe').classList.toggle('is-on', on);
    $('#btnCbSafe').setAttribute('aria-pressed', on ? 'true' : 'false');
    renderCharts();
    renderValueCounts();
    renderMissingChart();
  });

  /* code */
  $('#btnCopyCode').addEventListener('click', (e) => copyText(state.currentCode, e.currentTarget));
  $('#btnCopyFull').addEventListener('click', (e) => copyText(buildFullScript(), e.currentTarget));

  /* resize */
  let rid = null;
  window.addEventListener('resize', () => {
    clearTimeout(rid);
    rid = setTimeout(() => CH.resizeAll(), 140);
  });

  /* shortcuts */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (e.key >= '1' && e.key <= '6') {
      const names = ['table', 'stats', 'filter', 'groupby', 'charts', 'code'];
      switchTab(names[Number(e.key) - 1]);
    } else if (e.key === '/') {
      e.preventDefault();
      switchTab('table');
      $('#tableSearch').focus();
    } else if (e.key.toLowerCase() === 'l') {
      $('#btnLang').click();
    } else if (e.key.toLowerCase() === 't') {
      $('#btnTheme').click();
    } else if (e.key === 'Escape') {
      $('#pasteModal').hidden = true;
      $('#helpModal').hidden = true;
    }
  });
}

/**
 * Replay a share link. A link can only name a bundled dataset — an uploaded
 * file is deliberately never encoded, because that would mean putting someone's
 * data in a URL.
 */
function applyPayload(p) {
  state.cleanOps = (p.c || []).filter(Boolean).map((o) => ({ ...o }));
  state.filters = (p.f || []).filter(Boolean).map((f) => ({ ...f }));
  state.queryText = p.q || '';
  $('#queryInput').value = state.queryText;
  rebuild();

  if (p.t && CHART_TYPES.some(([id]) => id === p.t)) state.chartType = p.t;
  state.autoFilledFor = null;
  autoFillChartConfig();
  state.autoFilledFor = state.raw;

  const setIf = (sel, val) => {
    if (val === undefined || val === null || val === '') return;
    const node = $(sel);
    if (node && [...node.options].some((o) => o.value === val)) node.value = val;
  };
  setIf('#chX', p.x); setIf('#chY', p.y); setIf('#chSeries', p.g);
  setIf('#chAgg', p.a); setIf('#chSort', p.o);
  if (p.k !== undefined && p.k !== '') $('#chTop').value = p.k;
  if (p.b !== undefined && p.b !== '') $('#chBins').value = p.b;
  if (Array.isArray(p.m) && p.m.length) {
    const sel = $('#chNumCols');
    if (sel) [...sel.options].forEach((o) => { o.selected = p.m.includes(o.value); });
  }

  $$('.chart-type').forEach((x) => x.classList.toggle('is-on', x.dataset.type === state.chartType));
  syncChartFields();
  refreshAll();
  if (p.tab) switchTab(p.tab);
}

/* --------------------------------- init ---------------------------------- */

async function init() {
  // theme from storage / system
  const saved = localStorage.getItem('pandalens-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');

  // colour-blind safe palette
  const cbOn = localStorage.getItem('pandalens-cbsafe') === '1';
  CH.setColorblindSafe(cbOn);
  const cbBtn = $('#btnCbSafe');
  if (cbBtn) {
    cbBtn.classList.toggle('is-on', cbOn);
    cbBtn.setAttribute('aria-pressed', cbOn ? 'true' : 'false');
  }

  const payload = payloadFromUrl();
  const lang = payload && payload.lang === 'en' ? 'en' : 'zh';
  setLang(lang);
  $$('.lang-opt').forEach((o) => o.classList.toggle('is-on', o.dataset.lang === lang));
  applyStatic();

  const help = ['help.k1', 'help.k2', 'help.k3', 'help.k4', 'help.k5',
    'help.k6', 'help.k7', 'help.k8', 'help.k9'];
  $('#helpList').innerHTML = help.map((k) => `<li>${esc(t(k))}</li>`).join('');

  bindEvents();
  await loadSample(payload && payload.s ? payload.s : 'sales');

  if (payload && payload.s) {
    applyPayload(payload);
    toast(t('share.loaded'), 'info');
  } else if (payload) {
    /* The link pointed at an uploaded file. A toast disappears in 2.6 s and
       leaves the user staring at somebody else's dataset wondering why; state
       it in the page until they do something about it. */
    const notice = $('#shareNotice');
    if (notice) notice.hidden = false;
    toast(t('share.noData'), 'info');
  }

  /* The chart library is a CDN download, and nothing else on the page waits on
     it — the table, the summary, the tests and the pandas code are all usable
     immediately. So start the download in the background instead of holding the
     whole app on it: `refreshAll` above has already drawn the placeholders, and
     the charts paint for real the moment the library lands. */
  CH.loadECharts().then(() => {
    state.echartsReady = true;
    renderValueCounts();
    renderMissingChart();
    renderCharts();
  });

  /* The loader never gives up, so the two milestones are reported on our own
     clock: a nudge while the library is still coming, and a plain failure
     message if it never arrives. Both are no-ops in practice — the bundled copy
     lands in milliseconds — but a deployment that forgot to ship it would
     otherwise leave the user staring at "loading" forever. */
  setTimeout(() => { if (!state.echartsReady) toast(t('chart.libSlow'), 'info'); }, 15000);
  setTimeout(() => {
    if (state.echartsReady) return;
    toast(t('chart.libMissing'), 'err');
    for (const sel of ['#mainChart', '#missChart', '#vcChart']) chartPending($(sel), 'chart.libMissing');
  }, 45000);

  syncUrl();
}

document.addEventListener('DOMContentLoaded', init);
