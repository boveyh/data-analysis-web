/* =============================================================================
 * app.js — PandaLens application controller.
 * Wires the DataFrame engine, the parsers, the charts and the bilingual UI
 * into one pipeline:  raw  ->  cleaning ops  ->  filters  ->  views/charts.
 * ========================================================================== */

import { t, setLang, getLang, applyStatic } from './i18n.js';
import { DataFrame, histogram, describeSeries, quantile } from './dataframe.js';
import { parseText } from './parse.js';
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

const SAMPLE_DEFS = [
  { id: 'sales', file: 'data/sales.csv', icon: '🛒', key: 'sample.sales' },
  { id: 'iris',  file: 'data/iris.csv',  icon: '🌸', key: 'sample.iris' },
  { id: 'tips',  file: 'data/tips.csv',  icon: '🍽️', key: 'sample.tips' },
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
  codeSteps: [],        // [{label, code}]
  currentCode: '',
  echartsReady: false,
};

/* --------------------------- data ingestion ------------------------------- */

function setDataFrame(columns, data, name, sourceId) {
  state.raw = new DataFrame(columns, data, { name });
  state.rawName = name;
  state.source = sourceId || null;
  resetPipeline(false);
  refreshAll();
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
  rebuild();
  pushCode('load', loadCode());
  if (rerender) refreshAll();
}

async function loadSample(id) {
  const def = SAMPLE_DEFS.find((s) => s.id === id);
  if (!def) return;
  showLoading(t('sample.loading'));
  try {
    const res = await fetch(def.file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseText(text, def.file);
    if (!parsed || !parsed.columns.length) throw new Error('empty');
    setDataFrame(parsed.columns, parsed.data, def.file.split('/').pop(), id);
    toast(t('load.done', { name: def.file.split('/').pop(), rows: state.raw.nrows, cols: state.raw.ncols }), 'ok');
  } catch (err) {
    toast(t('sample.fail'), 'err');
  } finally {
    hideLoading();
  }
}

function loadText(text, name) {
  const parsed = parseText(text, name);
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
  reader.onload = () => {
    try { loadText(String(reader.result), file.name); }
    catch { toast(t('paste.failed'), 'err'); }
    finally { hideLoading(); }
  };
  reader.onerror = () => { hideLoading(); toast(t('paste.failed'), 'err'); };
  reader.readAsText(file, 'utf-8');
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

function refreshAll() {
  renderKPIs();
  renderSamples();
  renderColumnList();
  renderColumnControls();
  renderTable();
  renderStats();
  renderFilterPanel();
  renderGroupby();
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
    const btn = el('button', {
      class: `sample-item${state.source === s.id ? ' is-active' : ''}`,
      type: 'button',
    });
    btn.innerHTML = `
      <span class="sample-ico">${s.icon}</span>
      <span class="sample-txt">
        <span class="sample-name">${esc(t(`${s.key}.name`))}</span>
        <span class="sample-desc">${esc(t(`${s.key}.desc`))}</span>
      </span>`;
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

function renderTable() {
  const host = $('#tableScroll');
  const df = state.view;
  if (!df) { host.innerHTML = ''; return; }
  const cols = visibleCols();
  const types = new Map(df.columns.map((c) => [c.name, c.type]));
  const { rows, total } = currentRows();

  const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > maxPage) state.page = maxPage;
  const from = (state.page - 1) * state.pageSize;
  const slice = rows.slice(from, from + state.pageSize);

  $('#tableInfo').textContent = t('table.info', {
    from: total ? from + 1 : 0, to: Math.min(from + state.pageSize, total), total: total.toLocaleString(),
  });

  const head = ['<th class="td-idx">' + t('table.index') + '</th>']
    .concat(cols.map((c) => {
      const sorted = state.sort.col === c;
      const arrow = sorted ? (state.sort.asc ? '▲' : '▼') : '↕';
      return `<th class="sortable${sorted ? ' is-sorted' : ''}${types.get(c) === 'number' ? ' num' : ''}" data-col="${esc(c)}">
        <span class="th-inner">${esc(c)}<span class="arrow">${arrow}</span></span></th>`;
    })).join('');

  const body = slice.length
    ? slice.map((i) => {
        const tds = cols.map((c) => {
          const type = types.get(c);
          const cls = type === 'number' ? ' class="num"' : '';
          return `<td${cls}>${cellHtml({ type }, df.values(c)[i])}</td>`;
        }).join('');
        return `<tr><td class="td-idx">${i + 1}</td>${tds}</tr>`;
      }).join('')
    : `<tr><td colspan="${cols.length + 1}" style="text-align:center;padding:26px;color:var(--text-3)">${t('table.nohit')}</td></tr>`;

  host.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

  host.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sort.col === col) state.sort.asc = !state.sort.asc;
      else state.sort = { col, asc: false };
      renderTable();
    });
  });

  renderPager(maxPage, total);
}

function renderPager(maxPage, total) {
  const host = $('#pager');
  host.innerHTML = '';
  if (!state.view) return;
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

  if (!state.echartsReady) return;
  const top = rows.slice(0, 12).slice().reverse();
  CH.renderChart($('#vcChart'), CH.horizontalBarOption(top.map((r) => r.value), top.map((r) => r.count), {
    xName: t('stats.freq'),
    formatter: (v) => `${v} · ${((v / (state.view.nrows || 1)) * 100).toFixed(1)}%`,
  }));
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
    colSel.addEventListener('change', () => { f.col = colSel.value; rebuild(); renderAfterFilter(); });

    const type = df.type(f.col);
    const ops = type === 'number'
      ? ['==', '!=', '>', '>=', '<', '<=', 'in', 'notin', 'isna', 'notna']
      : ['==', '!=', 'contains', 'startswith', 'endswith', 'in', 'notin', 'isna', 'notna'];
    const opSel = el('select', { class: 'select' });
    for (const o of ops) opSel.appendChild(el('option', { value: o, text: OPTEXT[o] || o }));
    opSel.value = ops.includes(f.op) ? f.op : ops[0];
    f.op = opSel.value;
    opSel.addEventListener('change', () => { f.op = opSel.value; rebuild(); renderAfterFilter(); });

    const valInput = el('input', { class: 'input', value: f.value });
    valInput.placeholder = t('filter.value');
    valInput.disabled = ['isna', 'notna'].includes(f.op);
    valInput.addEventListener('input', () => { f.value = valInput.value; rebuild(); renderAfterFilter(); });

    const rm = el('button', { class: 'rm', type: 'button', title: t('filter.clear') });
    rm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    rm.addEventListener('click', () => {
      state.filters.splice(idx, 1);
      rebuild();
      pushCode('filter', '# 已移除一个筛选条件');
      renderAfterFilter();
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

function renderAfterFilter() {
  renderKPIs();
  renderTable();
  renderStats();
  renderValueCounts();
  renderCharts();
  renderCode();
  renderFilterPanel();
}

/** pandas-style string literal for source code (single-quoted, escaped). */
const pyStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function runQuery() {
  state.queryText = $('#queryInput').value;
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
}

/* ------------------------------- groupby --------------------------------- */

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
      $('#binsField').hidden = type !== 'hist';
      autoFillChartConfig();
      renderCharts();
    });
    host.appendChild(b);
  }
  $$('.chart-type').forEach((x) => x.classList.toggle('is-on', x.dataset.type === state.chartType));
  $('#binsField').hidden = state.chartType !== 'hist';
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

  /* nothing chosen yet (e.g. right after a dataset swap) — show a friendly hint */
  if (type !== 'heat' && (!xCol || !df.has(xCol))) {
    titleEl.textContent = '—';
    subEl.textContent = '';
    chartPlaceholder(t('chart.none'));
    return;
  }

  try {
    if (type === 'heat') {
      const corr = df.corr();
      if (corr.cols.length < 2) {
        titleEl.textContent = '—'; subEl.textContent = '';
        chartPlaceholder(t('stats.noNumeric'));
        return;
      }
      const opt2 = CH.buildOption('heat', { corr, title: null }, {}, CH.chartTheme());
      titleEl.textContent = `corr() · ${corr.cols.length} × ${corr.cols.length}`;
      subEl.textContent = 'df.corr(numeric_only=True)';
      CH.renderChart(stage, opt2);
      dataHost.innerHTML = '';
      state.currentCode = 'df.corr(numeric_only=True).round(2)';
      pushCode('corr', state.currentCode);
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
      model = {
        scatter: [...groups.entries()].filter(([, p]) => p.length)
          .map(([name, points]) => ({ name: sCol ? name : `${xCol} vs ${y}`, points })),
        xName: xCol, yName: y,
      };
      option = CH.buildOption('scatter', model, {}, CH.chartTheme());
      titleEl.textContent = `${xCol} vs ${y}`;
      subEl.textContent = `df.plot.scatter(x=${py(xCol)}, y=${py(y)})`;
      state.currentCode = `df.plot.scatter(x=${py(xCol)}, y=${py(y)})`;
      pushCode('scatter', state.currentCode);
      sub2(subEl, model.scatter.reduce((a, s) => a + s.points.length, 0));
      CH.renderChart(stage, option);
      dataHost.innerHTML = '';
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
      CH.renderChart(stage, option);
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
      CH.renderChart(stage, option);
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

    subEl.dataset.base = `df.groupby(${pyList(byCols)})[${py(aggCol)}].${aggPy}()`;
    subEl.textContent = subEl.dataset.base;
    sub2(subEl, catsFinal.length);
    CH.renderChart(stage, option);

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
function sub2(subEl, n) {
  if (!subEl.dataset.base) subEl.dataset.base = subEl.textContent;
  subEl.textContent = `${subEl.dataset.base} · ${t('chart.rows', { n })}`;
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
  $$('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
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
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `pandalens-${Date.now()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast(t('export.done', { name: `pandalens-export.csv` }), 'ok');
  pushCode('export', `df.to_csv("out.csv", index=False)`);
  renderCode();
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
  $('#pageSize').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderTable(); });
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

  $('#btnExport').addEventListener('click', exportCsv);
  $('#btnReset').addEventListener('click', () => { resetPipeline(false); refreshAll(); toast(t('load.reset'), 'info'); });

  /* stats */
  $('#vcColumn').addEventListener('change', () => { renderValueCounts(); CH.resizeAll(); });

  /* filters */
  $('#btnAddFilter').addEventListener('click', () => {
    const df = state.df;
    if (!df) return;
    const type = df.columns[0].type;
    state.filters.push({
      col: type === 'number' ? df.numericCols[0] || df.colNames[0] : df.colNames[0],
      op: type === 'number' ? '>' : 'contains',
      value: '',
    });
    rebuild();
    renderFilterPanel();
  });
  $('#btnClearFilter').addEventListener('click', () => {
    state.filters = [];
    state.queryText = '';
    $('#queryInput').value = '';
    rebuild();
    renderAfterFilter();
    pushCode('filter', '# 已清空全部筛选条件');
  });
  $('#btnRunQuery').addEventListener('click', runQuery);
  $('#queryInput').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery();
  });

  /* cleaning */
  $('#btnDropna').addEventListener('click', () => {
    const subset = [...$('#dropnaSubset').selectedOptions].map((o) => o.value);
    const before = state.df.nrows;
    state.cleanOps.push({ kind: 'dropna', subset });
    rebuild();
    const removed = before - state.df.nrows;
    pushCode('clean', cleanOpCode({ kind: 'dropna', subset }));
    renderAfterFilter();
    toast(t('clean.dropnaDone', { n: removed }), removed ? 'ok' : 'info');
  });

  $('#btnFillna').addEventListener('click', () => {
    const col = $('#fillnaCol').value;
    const value = $('#fillnaValue').value;
    if (!col) { toast(t('clean.noneSelected'), 'err'); return; }
    const before = state.df.values(col).filter((v) => v === null || v === undefined || v === '').length;
    state.cleanOps.push({ kind: 'fillna', col, value });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'fillna', col, value }));
    renderAfterFilter();
    toast(t('clean.fillnaDone', { n: before }), before ? 'ok' : 'info');
  });

  $('#btnAstype').addEventListener('click', () => {
    const col = $('#astypeCol').value;
    const type = $('#astypeType').value;
    if (!col) { toast(t('clean.noneSelected'), 'err'); return; }
    state.cleanOps.push({ kind: 'astype', col, type });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'astype', col, type }));
    renderAfterFilter();
    toast(t('clean.astypeDone', { col, type }), 'ok');
  });

  $('#btnDropDup').addEventListener('click', () => {
    const subset = [...$('#dupSubset').selectedOptions].map((o) => o.value);
    const before = state.df.nrows;
    state.cleanOps.push({ kind: 'dropdup', subset });
    rebuild();
    const removed = before - state.df.nrows;
    pushCode('clean', cleanOpCode({ kind: 'dropdup', subset }));
    renderAfterFilter();
    toast(t('clean.dupDone', { n: removed }), removed ? 'ok' : 'info');
  });

  $('#btnDropCol').addEventListener('click', () => {
    const cols = [...$('#dropCol').selectedOptions].map((o) => o.value);
    if (!cols.length) { toast(t('clean.noneSelected'), 'err'); return; }
    state.cleanOps.push({ kind: 'dropcol', cols });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'dropcol', cols }));
    renderAfterFilter();
    toast(t('clean.dropColDone', { cols: cols.join(', ') }), 'ok');
  });

  $('#btnRename').addEventListener('click', () => {
    const col = $('#renameCol').value;
    const value = $('#renameValue').value.trim();
    if (!col || !value) { toast(t('clean.noneSelected'), 'err'); return; }
    state.cleanOps.push({ kind: 'rename', col, value });
    rebuild();
    pushCode('clean', cleanOpCode({ kind: 'rename', col, value }));
    renderAfterFilter();
    toast(t('clean.renameDone', { name: value }), 'ok');
  });

  /* groupby */
  $('#btnGroupby').addEventListener('click', () => runGroupby(false));
  $('#btnGroupbyDemo').addEventListener('click', () => runGroupby(true));

  /* charts */
  ['#chX', '#chY', '#chSeries', '#chAgg', '#chSort'].forEach((s) => {
    $(s).addEventListener('change', () => { $('#chartSub').dataset.base = ''; renderCharts(); });
  });
  ['#chTop', '#chBins'].forEach((s) => $(s).addEventListener('input', () => renderCharts()));
  ['#chStack', '#chSmooth', '#chLabel'].forEach((s) => $(s).addEventListener('change', () => renderCharts()));
  $('#btnChartData').addEventListener('click', () => $('#chartDataTable').classList.toggle('collapsed'));
  $('#btnDownloadPng').addEventListener('click', () => {
    if (CH.downloadChartPng($('#mainChart'), `pandalens-${state.chartType}.png`)) toast(t('chart.exported'), 'ok');
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
    if (e.key >= '1' && e.key <= '6') {
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

/* --------------------------------- init ---------------------------------- */

async function init() {
  // theme from storage / system
  const saved = localStorage.getItem('pandalens-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');

  setLang('zh');
  $$('.lang-opt').forEach((o) => o.classList.toggle('is-on', o.dataset.lang === 'zh'));
  applyStatic();

  const help = ['help.k1', 'help.k2', 'help.k3', 'help.k4', 'help.k5', 'help.k6'];
  $('#helpList').innerHTML = help.map((k) => `<li>${esc(t(k))}</li>`).join('');

  bindEvents();
  await loadSample('sales');

  // warm the chart library, then paint every chart
  try {
    await CH.loadECharts();
    state.echartsReady = true;
    renderChartTypes();
    renderValueCounts();
    renderCharts();
  } catch {
    toast(t('chart.libMissing'), 'err');
  }
}

document.addEventListener('DOMContentLoaded', init);
