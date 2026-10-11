/* =============================================================================
 * deps-audit.mjs — static wiring check for the pure-front-end app.
 *
 * The workbench has no bundler and no type checker, so a typo in an element id
 * or a translation key only shows up at runtime, in the browser, on the one
 * code path that touches it. This script closes that gap: it cross-references
 * every selector and every string key used by app.js against index.html and
 * i18n.js, and fails loudly when something dangles.
 *
 * Run: node tools/deps-audit.mjs
 * ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('js/app.js');
const html = read('index.html');
const css = read('css/styles.css');
const { STRINGS } = await import('../js/i18n.js');

const problems = [];
const note = (msg) => problems.push(msg);

/* ------------------------- 1. translation keys ---------------------------- */

const zh = STRINGS.zh;
const en = STRINGS.en;

const used = new Set();
// t('key') / t("key")
for (const m of app.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);
// keys passed around as data: { key: 'x' } and commit('x') / snapshotPipeline('x')
for (const m of app.matchAll(/[Kk]ey:\s*'([^']+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/commit\(\s*'([^']+)'/g)) used.add(m[1]);
for (const m of app.matchAll(/snapshotPipeline\(\s*'([^']+)'/g)) used.add(m[1]);
// help keys live in an array literal
for (const m of app.matchAll(/const help = \[([\s\S]*?)\];/g)) {
  for (const k of m[1].matchAll(/'([^']+)'/g)) used.add(k[1]);
}
// second element of every CHART_TYPES pair
for (const m of app.matchAll(/'ct\.[A-Za-z0-9_.]+'/g)) used.add(m[0].slice(1, -1));
// data-i18n* attributes in the markup
for (const m of html.matchAll(/data-i18n(?:-placeholder|-title|-aria)?="([^"]+)"/g)) used.add(m[1]);

for (const k of used) {
  // a "key" may be a prefix the code completes at runtime (sample.sales → .name)
  const ok = (table) => k in table || `${k}.name` in table;
  if (!ok(zh)) note(`i18n: key used but not defined in zh → ${k}`);
  if (!ok(en)) note(`i18n: key used but not defined in en → ${k}`);
}

/* zh / en must be mirror images, key for key */
for (const k of Object.keys(zh)) if (!(k in en)) note(`i18n: zh-only key → ${k}`);
for (const k of Object.keys(en)) if (!(k in zh)) note(`i18n: en-only key → ${k}`);

/* placeholder sets must match too — a {n} in one language only is a bug */
const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of Object.keys(zh)) {
  if (k in en && ph(zh[k]) !== ph(en[k])) {
    note(`i18n: placeholder mismatch on "${k}" → zh(${ph(zh[k]) || 'none'}) vs en(${ph(en[k]) || 'none'})`);
  }
}

/* ---------------------------- 2. element ids ------------------------------ */

const htmlIds = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'/g)].map((m) => m[1]));
for (const m of app.matchAll(/addEventListener[\s\S]{0,40}?\$\(\s*'#([A-Za-z0-9_-]+)'/g)) usedIds.add(m[1]);

for (const id of usedIds) {
  if (!htmlIds.has(id)) note(`dom: app.js selects #${id} but index.html has no such id`);
}

const duplicated = [...htmlIds].filter((id) => {
  const n = [...html.matchAll(new RegExp(`\\bid="${id}"`, 'g'))].length;
  return n > 1;
});
for (const id of duplicated) note(`dom: duplicate id #${id}`);

/* every aria-controls / aria-labelledby must point at something real */
for (const m of html.matchAll(/aria-(?:controls|labelledby|describedby)="([^"]+)"/g)) {
  for (const id of m[1].split(/\s+/)) {
    if (id && !htmlIds.has(id)) note(`a11y: aria reference "${id}" does not exist`);
  }
}

/* ------------------- 3. styles referenced from markup --------------------- */

const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));

/* A class token is only meaningful if it looks like a class and contains no
 * interpolated expression, so filter before comparing. */
const CLASS_RE = /^[a-z][a-z0-9-]{1,}$/i;
const collect = (raw, out) => {
  if (raw.includes('$') || raw.includes('{') || raw.includes('}')) return;
  for (const c of raw.split(/\s+/)) if (CLASS_RE.test(c)) out.add(c);
};

const htmlClasses = new Set();
for (const m of html.matchAll(/\bclass="([^"]*)"/g)) collect(m[1], htmlClasses);
for (const m of app.matchAll(/class:\s*'([^']*)'/g)) collect(m[1], htmlClasses);
for (const m of app.matchAll(/class="([^"]*)"/g)) collect(m[1], htmlClasses);
// template-built markup, e.g. `<div class="verdict ${x}">` — take the literal head
for (const m of app.matchAll(/class="([A-Za-z][A-Za-z0-9_-]*)[^"]*"/g)) htmlClasses.add(m[1]);
for (const m of app.matchAll(/class="\$\{[^}]*\}\s*([A-Za-z][A-Za-z0-9_-]*)/g)) htmlClasses.add(m[1]);

/* State classes are toggled from JS and styled alongside their base class, and
 * a couple of containers are deliberately structural (no rules of their own). */
const IGNORE = new Set(['is-active', 'is-on', 'is-open', 'is-sorted', 'is-over', 'is-current',
  'is-sig', 'is-ns', 'is-virtual', 'is-empty', 'collapsed', 'num', 'na', 'rm', 'err', 'ok',
  'panels']);
const unstyled = [...htmlClasses].filter((c) => !cssClasses.has(c) && !IGNORE.has(c));
for (const c of unstyled.sort()) note(`css: class "${c}" is used but never styled`);

/* ------------------------------ 4. report --------------------------------- */

const counts = {
  'translation keys': Object.keys(zh).length,
  'element ids': htmlIds.size,
  'ids used by app.js': usedIds.size,
  'css classes referenced': htmlClasses.size,
};

console.log('PandaLens dependency audit');
console.log('─'.repeat(46));
for (const [label, n] of Object.entries(counts)) {
  console.log(`  ${label.padEnd(24, '.')} ${n}`);
}
console.log('─'.repeat(46));

if (problems.length) {
  console.log(`✗ ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}
console.log('✓ every selector, key and class resolves');
