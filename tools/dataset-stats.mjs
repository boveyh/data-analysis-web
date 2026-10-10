/**
 * Print row/column counts for every bundled sample dataset, parsed with the very
 * same reader the app uses — so the numbers quoted in the sidebar can be
 * regenerated instead of guessed.
 *
 *   node tools/dataset-stats.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseText } from '../js/parse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data');

const files = fs.readdirSync(dir).filter((f) => /\.(csv|tsv)$/i.test(f)).sort();

const rows = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const t0 = Date.now();
  const parsed = parseText(text, file);
  const ms = Date.now() - t0;
  const ncols = parsed.columns.length;
  const nrows = ncols ? parsed.data[parsed.columns[0]].length : 0;
  const kb = fs.statSync(path.join(dir, file)).size / 1024;
  rows.push({
    id: path.basename(file, path.extname(file)),
    nrows, ncols, kb, ms,
  });
}

const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));
console.log(pad('id', 12) + pad('rows', 8, true) + pad('cols', 6, true) + pad('size', 10, true) + pad('parse', 9, true));
console.log('-'.repeat(45));
for (const r of rows) {
  console.log(pad(r.id, 12) + pad(r.nrows, 8, true) + pad(r.ncols, 6, true) +
    pad(`${r.kb.toFixed(0)} KB`, 10, true) + pad(`${r.ms} ms`, 9, true));
}

console.log('\nSAMPLE_DEFS snippet\n');
for (const r of rows) {
  console.log(`  { id: '${r.id}',${' '.repeat(Math.max(1, 9 - r.id.length))}file: 'data/${r.id}.csv', icon: '', rows: ${r.nrows}, cols: ${r.ncols}, key: 'sample.${r.id}' },`);
}
