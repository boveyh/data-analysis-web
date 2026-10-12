/* =============================================================================
 * smoke.mjs — end-to-end browser checks for PandaLens.
 *
 * Runs the real app in real Chrome against a real HTTP origin, because the
 * features most likely to break — ES modules, the parse Web Worker, URL-state
 * round-tripping, ECharts click drill-down, virtual scrolling — are exactly the
 * ones a Node-only unit test cannot reach.
 *
 * Usage:
 *   node tools/e2e/smoke.mjs [--shots] [--keep] [--url <origin>]
 * Exit code 0 when every assertion holds, 1 otherwise.
 * ========================================================================== */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { findChrome, loadPuppeteer } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARTIFACTS = path.join(HERE, 'artifacts');

const argv = process.argv.slice(2);
const WANT_SHOTS = argv.includes('--shots');
const urlFlag = argv.indexOf('--url');
const EXT_URL = urlFlag >= 0 ? argv[urlFlag + 1] : null;

/* ------------------------------- harness --------------------------------- */

let passed = 0;
const failures = [];
const group = (name) => console.log(`\n${name}`);

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(detail ? `${label} — ${detail}` : label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ bootstrap -------------------------------- */

const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH and retry.');
  process.exit(1);
}
const { default: puppeteer } = await loadPuppeteer();

let server = null, origin = EXT_URL;
if (!origin) {
  const started = await startServer(0);
  server = started.server;
  origin = started.origin;
}
console.log(`PandaLens e2e · ${origin}`);
console.log(`Chrome     · ${chrome}`);

if (WANT_SHOTS) fs.mkdirSync(ARTIFACTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--force-color-profile=srgb', '--font-render-hinting=none',
    // a worker that cannot spawn would silently disable a feature under test
    '--allow-file-access-from-files',
  ],
  defaultViewport: { width: 1500, height: 960, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
await page.setCacheEnabled(false);
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

const consoleErrors = [];
const requestFailures = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  // the 4-CDN fallback chain probes a few hosts that may be blocked locally
  if (u.startsWith(origin)) requestFailures.push(`${u} ${r.failure()?.errorText || ''}`);
});

const shot = async (name) => {
  if (!WANT_SHOTS) return;
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`), fullPage: false });
};

const evalPage = (fn, ...args) => page.evaluate(fn, ...args);

/* The chart library loads in the background (it used to block boot), so after a
 * navigation nothing may assume `window.echarts` already exists. */
const waitForLib = (timeout = 20000) =>
  page.waitForFunction('!!window.echarts', { timeout });

/** Wait until the app has painted a given number of table rows. */
async function waitForRows(expected, timeout = 20000) {
  await page.waitForFunction(
    (n) => document.querySelectorAll('#tableScroll tbody tr:not(.v-spacer)').length === n,
    { timeout }, expected,
  );
}

async function readState() {
  return evalPage(() => ({
    rows: document.querySelector('#kpiRows')?.textContent || '',
    cols: document.querySelector('#kpiCols')?.textContent || '',
    na: document.querySelector('#kpiNa')?.textContent || '',
    headerName: document.querySelector('#headerDatasetName')?.textContent || '',
    histItems: document.querySelectorAll('#historyList .hist-item').length,
    histCount: document.querySelector('#histCount')?.textContent || '',
    undoDisabled: !!document.querySelector('#btnUndo')?.disabled,
    redoDisabled: !!document.querySelector('#btnRedo')?.disabled,
    filterRows: document.querySelectorAll('#filterRows .filter-row').length,
    badge: document.querySelector('#filterBadge')?.hidden ? '' : (document.querySelector('#filterBadge')?.textContent || ''),
    hash: location.hash,
  }));
}

/** Load a bundled dataset through the sidebar card and wait for it to settle. */
async function loadSample(id) {
  await page.evaluate((sid) => {
    const card = [...document.querySelectorAll('#sampleList .sample-item')]
      .find((el) => el.dataset.id === sid);
    if (card) card.click();
  }, id);
  await page.waitForFunction(
    () => !document.querySelector('#loadingVeil') || document.querySelector('#loadingVeil').hidden,
    { timeout: 30000 },
  );
  await sleep(450);
}

/** Switch tab and give ECharts a frame to lay out. */
async function tab(name, wait = 420) {
  await page.click(`#tab-${name}`);
  await sleep(wait);
}

/* -------------------------------- 1. load -------------------------------- */

/* Time the chart library from the first byte of the document.
 *
 * This guards a specific regression: the CDN chain used to advance only on
 * `onerror`, so a mirror that was throttled rather than dead held every chart
 * on the page hostage while healthy mirrors sat untried. Racing the mirrors
 * means the winner lands in seconds; the assertion below fails loudly if that
 * ever regresses to "first mirror wins or nothing does". */
await page.evaluateOnNewDocument(() => {
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (window.echarts) {
      window.__libMs = Math.round(performance.now() - t0);
      clearInterval(iv);
    }
  }, 40);
  setTimeout(() => clearInterval(iv), 40000);
});

group('1 · boot & dataset catalogue');
/* `networkidle2` is the wrong wait here: the CDN race keeps requests in flight
   for as long as the slowest mirror takes, so "network idle" arrives far later
   than "app ready". The selector wait below is the real readiness signal. */
await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#sampleList .sample-item', { timeout: 20000 });
await sleep(1200);
await waitForLib();

let st = await readState();
check('default dataset is sales.csv', st.headerName === 'sales.csv', st.headerName);
check('KPI rows rendered', /^[\d,]+$/.test(st.rows) && st.rows !== '0', st.rows);
check('KPI columns rendered', Number(st.cols) === 16, st.cols);
check('10 bundled datasets offered',
  (await evalPage(() => document.querySelectorAll('#sampleList .sample-item').length)) === 10);
check('table painted rows',
  (await evalPage(() => document.querySelectorAll('#tableScroll tbody tr').length)) > 5);
check('undo starts disabled', st.undoDisabled);
check('history starts at the load step', st.histItems === 1, `items=${st.histItems}`);
await shot('01-boot');

/* --------------------------- 2. i18n coverage ---------------------------- */

group('2 · bilingual parity');
const i18nParity = await evalPage(async () => {
  const mod = await import('./js/i18n.js');
  const zh = Object.keys(mod.STRINGS.zh);
  const en = Object.keys(mod.STRINGS.en);
  const untranslated = zh.filter((k) => !(k in mod.STRINGS.en));
  const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  const mismatched = zh.filter((k) => k in mod.STRINGS.en
    && placeholders(mod.STRINGS.zh[k]) !== placeholders(mod.STRINGS.en[k]));
  return { zh: zh.length, en: en.length, untranslated, mismatched };
});
check('zh and en expose the same key count', i18nParity.zh === i18nParity.en,
  `${i18nParity.zh} vs ${i18nParity.en}`);
check('no untranslated keys', i18nParity.untranslated.length === 0,
  i18nParity.untranslated.slice(0, 5).join(', '));
check('placeholders match across languages', i18nParity.mismatched.length === 0,
  i18nParity.mismatched.slice(0, 5).join(', '));

const zhTitle = await evalPage(() => document.querySelector('#tab-charts span').textContent);
await page.click('#btnLang');
await sleep(500);
const enTitle = await evalPage(() => document.querySelector('#tab-charts span').textContent);
check('language toggle relabels the UI', zhTitle !== enTitle, `${zhTitle} → ${enTitle}`);
check('html lang attribute follows', (await evalPage(() => document.documentElement.lang)) === 'en');
await page.click('#btnLang');
await sleep(500);
check('language toggle is reversible',
  (await evalPage(() => document.querySelector('#tab-charts span').textContent)) === zhTitle);

/* ----------------------- 3. parse worker + big table --------------------- */

group('3 · off-thread parsing');
const worker = await evalPage(() => new Promise((resolve) => {
  let done = false;
  const finish = (v) => { if (!done) { done = true; resolve(v); } };
  try {
    const w = new Worker(new URL('./js/parse.worker.js', location.href), { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); finish({ ok: false, why: 'timeout' }); }, 8000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      const d = e.data || {};
      w.terminate();
      finish({
        ok: !!d.ok,
        columns: d.columns,
        rowCount: d.data && d.data.a ? d.data.a.length : -1,
        // the quoted field must survive a delimiter inside the quotes
        quoted: d.data && d.data.b ? d.data.b[0] : null,
        blank: d.data && d.data['b.1'] ? d.data['b.1'][0] : null,
      });
    };
    w.onerror = (err) => { clearTimeout(timer); finish({ ok: false, why: err.message || 'error' }); };
    w.postMessage({ id: 7, text: 'a,b,b\n1,"x,1",z\n2,y,w\n', name: 'tiny.csv' });
  } catch (e) {
    finish({ ok: false, why: e.message });
  }
}));
check('worker answers a parse request', worker.ok, worker.why || '');
check('worker honours quoted fields', worker.quoted === 'x,1', String(worker.quoted));
check('worker de-duplicates headers pandas-style',
  Array.isArray(worker.columns) && worker.columns.join(',') === 'a,b,b.1',
  JSON.stringify(worker.columns));
check('worker returns every row', worker.rowCount === 2, String(worker.rowCount));

/* ------------------------------ 4. tabs ---------------------------------- */

group('4 · every tab renders');
await tab('table');
check('table panel visible', await evalPage(() => !document.querySelector('#panel-table').hidden));
for (const name of ['stats', 'filter', 'groupby', 'charts', 'code']) {
  await tab(name, name === 'charts' ? 900 : 500);
  const visible = await evalPage((n) => !document.querySelector(`#panel-${n}`).hidden
    && document.querySelector(`#panel-${n}`).offsetHeight > 0, name);
  check(`${name} panel paints`, visible);
  const others = await evalPage((n) => [...document.querySelectorAll('.panel')]
    .filter((p) => p.dataset.panel !== n).every((p) => p.hidden), name);
  check(`${name} panel hides the rest`, others);
}
check('aria-selected tracks the active tab',
  (await evalPage(() => document.querySelector('#tab-code').getAttribute('aria-selected'))) === 'true');
await shot('02-code-tab');

/* --------------------------- 5. missingness + tests ---------------------- */

group('5 · missingness map & hypothesis tests (titanic)');
await loadSample('titanic');
st = await readState();
check('titanic loaded', st.headerName === 'titanic.csv', st.headerName);
check('titanic has missing values', st.na !== '0' && st.na !== '—', st.na);

await tab('stats', 900);
const miss = await evalPage(() => {
  const host = document.querySelector('#missChart');
  const c = host.querySelector('canvas');
  const inst = window.echarts.getInstanceByDom(host);
  return {
    canvas: host.querySelectorAll('canvas').length,
    size: c ? `${c.width}x${c.height}` : '',
    sub: document.querySelector('#missChartSub')?.textContent || '',
    axisName: inst ? (inst.getOption().yAxis[0].name || '') : '(none)',
    note: host.querySelector('.muted-note')?.textContent || '',
  };
});
check('missingness matrix is drawn', miss.canvas > 0, miss.note);
/* ECharts will happily create a 0x0 canvas inside a container that had no size
   at init time — "a canvas exists" is not the same as "something was drawn" */
check('the missingness canvas has real dimensions',
  /^(\d+)x(\d+)$/.test(miss.size)
  && Number(miss.size.split('x')[0]) > 10 && Number(miss.size.split('x')[1]) > 10,
  miss.size || '(none)');
/* The sample ratio used to ride on the y-axis name, where it landed inline with
   the column labels and read as a date — so it moved to the card subtitle. */
check('the sample ratio is stated in the subtitle', /抽样|Sampled/.test(miss.sub), miss.sub);
check('nothing stray is left on the missingness y axis', miss.axisName === '', miss.axisName);

const tests = await evalPage(() => {
  const rows = [...document.querySelectorAll('#testTable tbody tr')];
  return {
    count: rows.length,
    headers: [...document.querySelectorAll('#testTable thead th')].map((t) => t.textContent),
    verdicts: rows.map((r) => r.querySelector('.verdict')?.className || ''),
    names: rows.map((r) => r.children[0]?.textContent || ''),
    first: rows[0] ? [...rows[0].children].map((c) => c.textContent.trim()) : [],
    group: document.querySelector('#testGroup')?.value,
    value: document.querySelector('#testValue')?.value,
  };
});
check('test table has rows', tests.count >= 2, `count=${tests.count}`);
check('all six test columns present', tests.headers.length === 6, tests.headers.join('|'));
check('titanic yields a chi-square result',
  tests.names.some((n) => n.includes('card') || n.includes('方') || n.includes('hi')), tests.names.join(' / '));
check('verdict badge on every row',
  tests.verdicts.length === tests.count && tests.verdicts.every((c) => c.includes('is-')),
  tests.verdicts.join(' | '));
check('a p-value is numeric', /^[\d.e-]+$/.test(tests.first[3] || ''), tests.first.join(' | '));
await shot('03-stats-titanic');

const switchTest = await evalPage(async () => {
  const g = document.querySelector('#testGroup');
  const before = document.querySelector('#testTable tbody').textContent;
  const alt = [...g.options].map((o) => o.value).find((v) => v !== g.value);
  if (!alt) return { changed: false };
  g.value = alt;
  g.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return { changed: document.querySelector('#testTable tbody').textContent !== before, alt };
});
check('switching the grouping column re-runs the tests', switchTest.changed, switchTest.alt || '');

/* ------------------- 6. undo / redo + pipeline history ------------------- */

group('6 · undo / redo');
await loadSample('sales');
await tab('filter', 500);

await page.click('#btnAddFilter');
await sleep(350);
let afterAdd = await readState();
check('adding a filter records history', afterAdd.histItems >= 2, `items=${afterAdd.histItems}`);
check('undo becomes enabled', !afterAdd.undoDisabled);

await page.click('#btnUndo');
await sleep(400);
let afterUndo = await readState();
check('undo removes the filter row', afterUndo.filterRows === 0, `rows=${afterUndo.filterRows}`);
check('redo becomes enabled after undo', !afterUndo.redoDisabled);

await page.click('#btnRedo');
await sleep(400);
check('redo restores the filter row', (await readState()).filterRows === 1);

/* keyboard shortcut path */
await page.click('body');
await page.keyboard.down('Control');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Control');
await sleep(400);
check('Ctrl+Z drives the same undo', (await readState()).filterRows === 0);

/* rewind by clicking a history step */
await evalPage(() => {
  const items = document.querySelectorAll('#historyList .hist-item');
  const back = items.length > 1 ? items[items.length - 1].querySelector('.hist-back') : null;
  if (back) back.click();
});
await sleep(400);
check('history rows are clickable and stable', (await readState()).histItems === 1);

/* ---------------------------- 7. share URL ------------------------------- */

group('7 · shareable URL state');
await tab('filter', 400);
await page.click('#queryInput');
await page.type('#queryInput', 'revenue > 2000');
await page.click('#btnRunQuery');
await sleep(600);
const filtered = await readState();
check('query applied a badge', filtered.badge.length > 0, filtered.badge);
check('URL carries the recipe', /#s=/.test(filtered.hash), filtered.hash.slice(0, 40));

const rowsBefore = Number(filtered.rows.replace(/[^\d]/g, ''));
const restored = `${origin}${filtered.hash}`;
await page.goto(restored, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#sampleList .sample-item', { timeout: 20000 });
await sleep(1600);
/* Read the toast before waiting on the chart library — toasts are transient and
   the library race can take a while on a slow link. */
const toastText = await evalPage(() => [...document.querySelectorAll('#toastStack .toast')]
  .map((t) => t.textContent).join(' | '));
const after = await readState();
check('reload restores the dataset', after.headerName === 'sales.csv', after.headerName);
check('reload restores the query text',
  (await evalPage(() => document.querySelector('#queryInput').value)) === 'revenue > 2000');
check('reload restores the row count', Number(after.rows.replace(/[^\d]/g, '')) === rowsBefore,
  `${after.rows} vs ${filtered.rows}`);
check('a link-restore toast is shown', toastText.length > 0, toastText);
await waitForLib();
await shot('04-share-restore');

/* an uploaded file must never be encoded into the URL — a share link carries
 * the recipe only, and an upload has no recipe to name */
await tab('table', 250);
await page.click('#btnPaste');
await sleep(300);
await page.type('#pasteArea', 'name,score\nAlice,92\nBob,85\nCara,99');
await page.click('#btnConfirmPaste');
await sleep(1000);
const upload = await readState();
const hashMatch = /#s=(.+)$/.exec(upload.hash);
const payload = hashMatch
  ? JSON.parse(Buffer.from(hashMatch[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  : null;
check('a payload is still written', payload !== null);
check('uploaded data is never encoded in the URL', payload && payload.s === null,
  JSON.stringify(payload && payload.s));
check('the pasted frame is what the table shows', upload.headerName === 'pasted.csv', upload.headerName);
check('pasted columns are recognised',
  (await evalPage(() => document.querySelectorAll('#colList .col-item').length)) === 2);

/* ---------------------------- 8. chart drill ----------------------------- */

group('8 · chart click drill-down');
await loadSample('sales');
await tab('charts', 1000);
await page.click('.chart-type[data-type="bar"]');
await sleep(900);

const hintVisible = await evalPage(() => !document.querySelector('#chartDrillHint').hidden);
check('drill hint shown for bar charts', hintVisible);

/** Click a point inside the plot area and report whether a filter appeared. */
async function clickChartToFilter() {
  const box = await page.evaluate(() => {
    const el = document.querySelector('#mainChart');
    const c = window.echarts.getInstanceByDom(el);
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height, series: c ? !!c.getOption().series.length : false };
  });
  if (!box.series) return false;
  // bars grow from the baseline, so a horizontal sweep just above the axis
  // is guaranteed to land on one; the sweep keeps the test independent of
  // how many categories the auto-filler chose.
  const y = box.top + box.h * 0.82;
  for (let i = 1; i <= 28; i++) {
    const x = box.left + (box.w * i) / 30;
    await page.mouse.click(x, y);
    await sleep(90);
    const n = await evalPage(() => document.querySelectorAll('#filterRows .filter-row').length);
    if (n > 0) return true;
  }
  return false;
}

const drilled = await clickChartToFilter();
check('clicking a bar creates a filter', drilled);
if (drilled) {
  const d = await readState();
  check('drill-down records history', d.histItems >= 2, `items=${d.histItems}`);
  check('drill-down narrows the frame', Number(d.rows.replace(/[^\d]/g, '')) > 0, d.rows);
  const cats = await evalPage(() => [...document.querySelectorAll('#filterRows .filter-row select')]
    .map((s) => s.value).join(','));
  check('the filter names the charted column', /region|category|product|channel|segment/i.test(cats), cats);
}
await shot('05-drill-down');

await page.click('.chart-type[data-type="heat"]');
await sleep(700);
check('drill hint hidden for correlation matrix',
  await evalPage(() => document.querySelector('#chartDrillHint').hidden));
check('axes hidden for correlation matrix',
  await evalPage(() => document.querySelector('[data-field="x"]').hidden
    && document.querySelector('[data-field="y"]').hidden));

/* --------------------- 9. new multivariate chart types ------------------- */

group('9 · missingness / parallel / scatter-matrix charts');
// sales.csv is complete, so the missingness map would (correctly) show its
// empty state; titanic is the dataset that actually exercises the renderer.
await loadSample('titanic');
await tab('charts', 700);
for (const type of ['missing', 'parallel', 'splom']) {
  await page.click(`.chart-type[data-type="${type}"]`);
  await sleep(1100);
  const r = await evalPage(() => ({
    title: document.querySelector('#chartTitle').textContent,
    sub: document.querySelector('#chartSub').textContent,
    canvas: document.querySelectorAll('#mainChart canvas').length,
    numColsShown: !document.querySelector('#numColsField').hidden,
  }));
  check(`${type}: canvas rendered`, r.canvas > 0, r.title);
  check(`${type}: chart title is set`, r.title && r.title !== '—', r.title);
  // a stale subtitle is how the mapping panel silently lies about the chart
  check(`${type}: subtitle matches this chart, not the previous one`,
    !/groupby|plot\.(bar|hist)|^—/.test(r.sub), r.sub);
  check(`${type}: multi-column picker ${type === 'missing' ? 'hidden' : 'visible'}`,
    r.numColsShown === (type !== 'missing'));
  check(`${type}: drill hint ${type === 'missing' ? 'shown' : 'hidden'}`,
    (await evalPage(() => !document.querySelector('#chartDrillHint').hidden)) === (type === 'missing'));
}
await page.click('.chart-type[data-type="parallel"]');
await sleep(1000);
check('subtitle names the parallel-coordinates call',
  (await evalPage(() => document.querySelector('#chartSub').textContent)).includes('parallel_coordinates'));

/* The picker and the plot have to agree. They did not look like they did: the
   subtitle printed pandas' single `class_column` argument while the title said
   "2 dimensions", so the chart appeared to contradict its own caption. */
const parallelAgree = await evalPage(() => {
  const selected = [...document.querySelector('#chNumCols').selectedOptions].map((o) => o.value);
  const inst = window.echarts.getInstanceByDom(document.querySelector('#mainChart'));
  const axes = (inst.getOption().parallelAxis || []).map((a) => a.name).filter(Boolean);
  return { selected, axes, sub: document.querySelector('#chartSub').textContent };
});
check('every plotted axis was actually selected in the picker',
  parallelAgree.axes.length > 0
  && parallelAgree.axes.every((a) => parallelAgree.selected.includes(a)),
  `${JSON.stringify(parallelAgree.axes)} vs picker ${JSON.stringify(parallelAgree.selected)}`);
check('the parallel subtitle names the axis list, not just the class column',
  /cols=/.test(parallelAgree.sub), parallelAgree.sub);

/* the scatter matrix draws its tick labels outside the grids, so the grids must
 * stop short of the canvas edges or the bottom row gets clipped away */
await page.click('.chart-type[data-type="splom"]');
await sleep(1200);
const splomLayout = await evalPage(() => {
  const c = window.echarts.getInstanceByDom(document.querySelector('#mainChart'));
  const o = c.getOption();
  return {
    grids: o.grid.length,
    xAxes: o.xAxis.length,
    bothTriangles: o.series.length,
    maxBottom: Math.max(...o.grid.map((g) => parseFloat(g.top) + parseFloat(g.height))),
    minLeft: Math.min(...o.grid.map((g) => parseFloat(g.left))),
    diagTitles: (o.title || []).length,
  };
});
check('splom draws a full k×k grid minus the diagonal',
  splomLayout.grids === 12 && splomLayout.xAxes === 12, JSON.stringify(splomLayout));
check('splom keeps room for the bottom tick row', splomLayout.maxBottom <= 92,
  `lowest grid edge at ${splomLayout.maxBottom.toFixed(1)}%`);
check('splom keeps room for the left tick column', splomLayout.minLeft >= 6,
  `leftmost grid at ${splomLayout.minLeft}%`);
check('splom labels the diagonal', splomLayout.diagTitles === 4, String(splomLayout.diagTitles));
const numCols = await evalPage(() => document.querySelectorAll('#chNumCols option').length);
check('multi-column picker lists numeric columns', numCols >= 3, String(numCols));
await shot('06-multivariate');

/* ------------------------ 10. colour-blind palette ---------------------- */

group('10 · colour-blind safe palette');
await page.click('.chart-type[data-type="bar"]');
await sleep(700);
const paletteOff = await evalPage(async () => (await import('./js/charts.js')).isColorblindSafe());
await page.click('#btnCbSafe');
await sleep(800);
const paletteOn = await evalPage(async () => (await import('./js/charts.js')).isColorblindSafe());
check('palette toggle flips the flag', paletteOff === false && paletteOn === true,
  `${paletteOff} → ${paletteOn}`);
check('aria-pressed reflects the state',
  (await evalPage(() => document.querySelector('#btnCbSafe').getAttribute('aria-pressed'))) === 'true');
check('preference persisted', (await evalPage(() => localStorage.getItem('pandalens-cbsafe'))) === '1');
check('charts repaint without error', (await evalPage(() => document.querySelectorAll('#mainChart canvas').length)) > 0);
await shot('07-colourblind-bar');
await page.click('#btnCbSafe');
await sleep(600);

/* -------------------------- 11. virtual scrolling ----------------------- */

group('11 · virtual scrolling on a large table');
await loadSample('taxis');
st = await readState();
check('taxis loaded', st.headerName === 'taxis.csv', st.headerName);
const totalRows = Number(st.rows.replace(/[^\d]/g, ''));
check('taxis is large enough to matter', totalRows > 5000, String(totalRows));

/* a chi-square this large overflows double precision and comes back as exactly
 * 0; printing "0.00e+0" would look like a broken number rather than a tiny p */
await tab('stats', 800);
const pValues = await evalPage(() => [...document.querySelectorAll('#testTable tbody tr')]
  .map((r) => r.children[3]?.textContent.trim())
  .filter((v) => v && v !== '—'));
check('underflowing p-values are labelled, not printed as zero',
  pValues.length > 0 && pValues.every((v) => !/^0(\.0+)?e\+?0?$/.test(v)), pValues.join(', '));
await tab('table', 400);
await page.select('#pageSize', 'virtual');
await sleep(900);
const virt = await evalPage(() => ({
  rendered: document.querySelectorAll('#tableScroll tbody tr:not(.v-spacer)').length,
  spacers: document.querySelectorAll('#tableScroll tbody tr.v-spacer').length,
  virtualClass: document.querySelector('#tableScroll').classList.contains('is-virtual'),
  pager: document.querySelector('#pager .pg-info')?.textContent || '',
  pagerButtons: document.querySelectorAll('#pager button').length,
}));
check('virtual mode engages', virt.virtualClass);
check('only a viewport of rows is in the DOM', virt.rendered > 0 && virt.rendered < 200,
  `rendered=${virt.rendered} of ${totalRows}`);
check('two spacer rows hold the scroll height', virt.spacers === 2, String(virt.spacers));
check('pager explains the mode', virt.pager.length > 0, virt.pager);
check('pager has no page buttons in virtual mode', virt.pagerButtons === 0);

/* The container collapses to header height the instant its tbody is replaced,
 * so measuring clientHeight at that moment would paint ~14 rows and leave a
 * blank gap. Assert the painted window actually reaches the bottom edge. */
const fill = await evalPage(() => {
  const host = document.querySelector('#tableScroll');
  const rows = [...host.querySelectorAll('tbody tr:not(.v-spacer)')];
  const last = rows[rows.length - 1];
  const hb = host.getBoundingClientRect();
  const lb = last.getBoundingClientRect();
  return { gap: Math.round(hb.bottom - lb.bottom), hostH: Math.round(hb.height), painted: rows.length };
});
check('painted rows fill the viewport on first paint', fill.gap < 40,
  `blank gap of ${fill.gap}px below the last of ${fill.painted} rows (viewport ${fill.hostH}px)`);

/* scrolling must repaint rows without exploding the DOM. The row index cell is
 * the only column guaranteed to differ between two scroll positions. */
const scrolled = await evalPage(async () => {
  const host = document.querySelector('#tableScroll');
  const firstIdx = () => host.querySelector('tbody tr:not(.v-spacer) td.td-idx')?.textContent;
  const before = firstIdx();
  host.scrollTop = host.scrollHeight * 0.7;
  host.dispatchEvent(new Event('scroll'));
  await new Promise((r) => setTimeout(r, 450));
  return {
    before,
    after: firstIdx(),
    rendered: host.querySelectorAll('tbody tr:not(.v-spacer)').length,
  };
});
check('scrolling swaps the rendered rows', scrolled.after !== scrolled.before,
  `first visible row ${scrolled.before} → ${scrolled.after}`);
check('the swapped window contains real rows', /^\d+$/.test(scrolled.after || ''), String(scrolled.after));
check('DOM stays bounded after scrolling', scrolled.rendered < 200, String(scrolled.rendered));
check('scroll position was preserved', (await evalPage(() => document.querySelector('#tableScroll').scrollTop)) > 0);
await shot('08-virtual-scroll');
await page.select('#pageSize', '50');
await sleep(600);
check('leaving virtual mode paginates again',
  (await evalPage(() => document.querySelectorAll('#pager button').length)) > 0);

/* --------------------------- 12. a11y wiring ----------------------------- */

group('12 · accessibility wiring');
const a11y = await evalPage(() => ({
  duplicateIds: (() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    return [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  })(),
  thScope: [...document.querySelectorAll('#tableScroll thead th')].every((t) => t.getAttribute('scope') === 'col'),
  ariaSort: [...document.querySelectorAll('#tableScroll thead th.sortable')]
    .every((t) => ['none', 'ascending', 'descending'].includes(t.getAttribute('aria-sort'))),
  tabRoles: document.querySelectorAll('[role="tab"]').length,
  panelRoles: document.querySelectorAll('[role="tabpanel"]').length,
  ariaControlsResolve: [...document.querySelectorAll('[aria-controls]')]
    .every((el) => document.getElementById(el.getAttribute('aria-controls'))),
  liveRegion: document.querySelector('#toastStack')?.getAttribute('aria-live'),
  focusableSortHeader: !!document.querySelector('#tableScroll thead th.sortable[tabindex]'),
}));
check('no duplicate ids in the DOM', a11y.duplicateIds.length === 0, a11y.duplicateIds.join(','));
check('table headers carry scope=col', a11y.thScope);
check('sortable headers expose aria-sort', a11y.ariaSort);
check('six tabs and six panels are declared', a11y.tabRoles === 6 && a11y.panelRoles === 6,
  `${a11y.tabRoles}/${a11y.panelRoles}`);
check('every aria-controls resolves', a11y.ariaControlsResolve);
check('toasts live in a polite live region', a11y.liveRegion === 'polite', String(a11y.liveRegion));
check('sort headers are keyboard reachable', a11y.focusableSortHeader);

/* keyboard sort */
await page.click('#tableScroll thead th.sortable');
await sleep(300);
await page.keyboard.press('Tab');
const sortedByKey = await evalPage(async () => {
  const th = document.querySelector('#tableScroll thead th.sortable');
  th.focus();
  const before = th.getAttribute('aria-sort');
  th.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const after = document.querySelector('#tableScroll thead th.sortable').getAttribute('aria-sort');
  return { before, after };
});
check('Enter on a header flips the sort', sortedByKey.before !== sortedByKey.after,
  `${sortedByKey.before} → ${sortedByKey.after}`);

/* --------------------------- 13. theme toggle ---------------------------- */

group('13 · theme');
await page.click('#btnTheme');
await sleep(700);
check('dark theme applied', (await evalPage(() => document.documentElement.dataset.theme)) === 'dark');
await tab('charts', 900);
check('charts still render in dark mode',
  (await evalPage(() => document.querySelectorAll('#mainChart canvas').length)) > 0);
await shot('09-dark');
await page.click('#btnTheme');
await sleep(600);
check('theme toggles back', (await evalPage(() => document.documentElement.dataset.theme)) === 'light');

/* --------------------------- 14. uploaded file --------------------------- */
/* Everything above runs on bundled datasets, but dragging in your own CSV is
 * the main entry point. Exercise that path with a temp file that carries two
 * deliberately dirty columns, so the missingness machinery has real work. */

group('14 · a file you drag in yourself');

const tmpCsv = path.join(os.tmpdir(), `pandalens-upload-${process.pid}.csv`);
{
  const lines = ['order_id,city,channel,amount,discount,member'];
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 1; i <= 900; i++) {
    const member = rnd() < 0.5 ? 'Yes' : 'No';
    const city = ['A', 'B', 'C'][Math.floor(rnd() * 3)];
    /* members spend noticeably more — the t-test below should find this */
    const amount = (member === 'Yes' ? 52 : 44) + rnd() * 18;
    lines.push([
      i, city, rnd() < 0.5 ? 'x' : 'y', amount.toFixed(2),
      rnd() < 0.6 ? '' : '0.10', member,
    ].join(','));
  }
  fs.writeFileSync(tmpCsv, lines.join('\n') + '\n');
}

await tab('table', 400);
const fileInput = await page.$('#fileInput');
await fileInput.uploadFile(tmpCsv);
await sleep(2800);
const up = await evalPage(() => ({
  rows: document.querySelector('#kpiRows').textContent,
  cols: document.querySelector('#kpiCols').textContent,
  name: document.querySelector('#headerDatasetName').textContent,
  shape: document.querySelector('#headerDatasetShape').textContent,
  active: [...document.querySelectorAll('#sampleList .sample-item')]
    .filter((e) => e.classList.contains('is-active')).length,
}));
check('an uploaded file replaces the frame',
  up.rows.replace(/[^\d]/g, '') === '900', up.rows);
check('the uploaded column count is right', up.cols === '6', up.cols);
check('the header names the uploaded file', /pandalens-upload/.test(up.name), up.name);
check('the shape line reflects the upload', /900/.test(up.shape), up.shape);
check('no bundled dataset stays highlighted', up.active === 0, String(up.active));

await tab('stats', 1500);
const upStats = await evalPage(() => ({
  miss: document.querySelector('#missingTable').textContent.replace(/\s+/g, ' '),
  hasMissCanvas: document.querySelectorAll('#missChart canvas').length,
  group: document.querySelector('#testGroup').value,
  cat2: [...document.querySelectorAll('#testCat2 option')].map((o) => o.value),
}));
check('the uploaded missing column is detected', /discount/.test(upStats.miss), upStats.miss.slice(0, 90));
check('the missingness map draws for the upload', upStats.hasMissCanvas > 0);
check('the cross-tab picker drops the active group column',
  !upStats.cat2.includes(upStats.group), `group=${upStats.group} cat2=${upStats.cat2.join(',')}`);

await page.select('#testGroup', 'member');
await page.select('#testValue', 'amount');
await sleep(900);
const upTest = await evalPage(() => document.querySelector('#testTable').textContent.replace(/\s+/g, ' '));
check('a t-test runs on the uploaded columns', /Welch/.test(upTest), upTest.slice(0, 110));
check('the t-test label carries both group means, not just a p-value',
  /μ=\d/.test(upTest), upTest.slice(0, 110));
await page.select('#testCat2', 'channel');
await sleep(900);
check('the chi-square follows the chosen cross-tab column',
  /member\s*×\s*channel/.test(await evalPage(() => document.querySelector('#testTable').textContent)),
  'expected member × channel');

await tab('charts', 900);
await page.click('.chart-type[data-type="hist"]');
await sleep(1300);
check('a histogram draws the uploaded column',
  (await evalPage(() => document.querySelectorAll('#mainChart canvas').length)) > 0);
check('the chart subtitle names the uploaded column',
  /amount/.test(await evalPage(() => document.querySelector('#chartSub').textContent)),
  await evalPage(() => document.querySelector('#chartSub').textContent));

await tab('filter', 700);
await page.click('#btnAddFilter');
await sleep(800);
const upFilter = await evalPage(() => ({
  rows: document.querySelectorAll('#filterRows .filter-row').length,
  cols: [...document.querySelectorAll('#filterRows .filter-row option')].map((o) => o.value),
}));
check('the filter builder lists the uploaded columns',
  upFilter.rows === 1 && upFilter.cols.includes('amount'), upFilter.cols.slice(0, 6).join(','));
await page.click('#btnUndo');
await sleep(900);
check('undo works on an uploaded pipeline',
  (await evalPage(() => document.querySelectorAll('#filterRows .filter-row').length)) === 0);

const upHash = await evalPage(() => location.hash);
check('the share hash carries the recipe, never the 900 rows',
  upHash.startsWith('#s=') && upHash.length < 900, `hash is ${upHash.length} chars`);
fs.unlinkSync(tmpCsv);

/* ------------------------ 15. chart library delivery --------------------- */

group('15 · chart library delivery');
const lib = await evalPage(() => ({ ms: window.__libMs ?? null, hasLib: !!window.echarts }));
check('ECharts arrives from the bundled copy', lib.hasLib);
/* The bundled copy takes the network off the critical path entirely */
check('the bundled copy is used, with no CDN round trip in the way',
  typeof lib.ms === 'number' && lib.ms > 0 && lib.ms < 5000, `resolved in ${lib.ms} ms`);

/* Deterministic replay of the failure modes this section exists for.
 *
 * Stalling the *bundled* copy reproduces both at once. The hung request never
 * fires `onload` or `onerror`, so the local timeout is the only thing that can
 * advance things — and the mirrors that then race each other execute in
 * download-completion order, which is what used to swap the ECharts instance
 * registry out from under charts that had already been drawn. */
const stallPage = await browser.newPage();
await stallPage.setRequestInterception(true);
stallPage.on('request', (req) => {
  // never resolve this one: a hung request is indistinguishable from a slow disk
  if (/vendor\/echarts/.test(req.url())) return;
  req.continue().catch(() => {});
});
await stallPage.evaluateOnNewDocument(() => {
  window.__t0 = performance.now();
  const iv = setInterval(() => {
    if (window.echarts) { window.__libMs = Math.round(performance.now() - window.__t0); clearInterval(iv); }
  }, 40);
  setTimeout(() => clearInterval(iv), 40000);
});
await stallPage.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
const stalled = await stallPage.waitForFunction('!!window.echarts', { timeout: 40000 })
  .then(() => stallPage.evaluate(() => ({ ms: window.__libMs, ver: window.echarts.version })))
  .catch(() => null);
check('a stalled bundled copy still falls back to the mirrors',
  stalled && stalled.ms > 2500 && stalled.ms < 40000,
  stalled ? `${stalled.ms} ms, won by ECharts ${stalled.ver}` : 'library never arrived');

/* The subtle half: a loser that was already executing would reassign
   `window.echarts`, swapping the registry out from under charts created against
   the winner. A canvas that exists but is unknown to `getInstanceByDom` is
   exactly that failure. */
const stalledAttached = await stallPage.waitForFunction(
  `(() => {
     const el = document.querySelector('#mainChart');
     return !!(el && el.querySelector('canvas') && window.echarts.getInstanceByDom(el));
   })()`,
  { timeout: 20000 },
).then(() => true).catch(() => false);
check('charts stay attached to the winning registry', stalledAttached);
await stallPage.close();

/* ------------------------------ teardown -------------------------------- */

group('16 · console hygiene');
/* The bundled ECharts means no third-party request is issued at all in the
   normal case, so this check is deliberately strict again. */
const relevant = consoleErrors.filter((e) => !/favicon/i.test(e));
check('no console or page errors', relevant.length === 0, relevant.slice(0, 4).join(' || '));
check('no failed same-origin requests', requestFailures.length === 0, requestFailures.slice(0, 3).join(' || '));

await browser.close();
if (server) server.close();

console.log('\n' + '─'.repeat(58));
if (failures.length) {
  console.log(`✗ ${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ all ${passed} browser checks passed`);
if (WANT_SHOTS) console.log(`  screenshots → ${path.relative(ROOT, ARTIFACTS)}/`);
