/* =============================================================================
 * screenshots.mjs — capture a visual tour of the workbench.
 *
 * Complements smoke.mjs: the assertions prove behaviour, these images are how a
 * human (or a reviewer) spots a layout that renders but looks wrong. Output
 * goes to tools/e2e/artifacts/, which is gitignored.
 *
 * Usage: node tools/e2e/screenshots.mjs [--out <dir>]
 * ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { findChrome, loadPuppeteer } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const outFlag = argv.indexOf('--out');
const OUT = path.resolve(outFlag >= 0 ? argv[outFlag + 1] : path.join(HERE, 'artifacts'));

const chrome = findChrome();
if (!chrome) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH and retry.');
  process.exit(1);
}
const { default: puppeteer } = await loadPuppeteer();
fs.mkdirSync(OUT, { recursive: true });

const { server, origin } = await startServer(0);
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  defaultViewport: { width: 1500, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#sampleList .sample-item');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  → ${name}.png`);
};
const click = async (sel, wait = 420) => { await page.click(sel); await sleep(wait); };
const load = async (id) => {
  await page.evaluate((sid) => {
    const card = [...document.querySelectorAll('#sampleList .sample-item')].find((e) => e.dataset.id === sid);
    if (card) card.click();
  }, id);
  await sleep(2600);
};
const scrollTo = (y) => page.evaluate((v) => window.scrollTo(0, v), y);

await sleep(1500);
console.log(`PandaLens screenshots → ${OUT}`);

await shot('01-table-light');

/* charts, one per interesting renderer */
await click('#tab-charts', 700);
for (const type of ['bar', 'line', 'pie', 'box', 'heat', 'missing', 'parallel', 'splom']) {
  await page.click(`.chart-type[data-type="${type}"]`);
  await sleep(1300);
  await shot(`02-chart-${type}`);
}

/* stats: describe, missingness and the hypothesis tests */
await load('titanic');
await click('#tab-stats', 700);
await shot('03-stats-top');
await scrollTo(620);
await sleep(700);
await shot('04-stats-missing-and-tests');

/* the pipeline history panel */
await click('#tab-filter', 500);
await scrollTo(2000);
await sleep(600);
await shot('05-history');

/* virtual scrolling over a large frame */
await load('taxis');
await click('#tab-table', 500);
await page.select('#pageSize', 'virtual');
await sleep(1000);
await shot('06-virtual-scroll');

/* dark theme */
await click('#btnTheme', 900);
await click('#tab-stats', 800);
await scrollTo(620);
await sleep(900);
await shot('07-dark-stats');
await click('#btnTheme', 700);

/* narrow viewport — the sidebar collapses and the header must not wrap */
await page.setViewport({ width: 760, height: 1100, deviceScaleFactor: 1 });
await sleep(900);
await shot('08-narrow');
await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });
await sleep(900);
await shot('09-mobile');

await browser.close();
server.close();
console.log(`\n${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} images in ${OUT}`);
