/* =============================================================================
 * xlsx-test.mjs — Excel (.xlsx) read/write round-trip, no browser required.
 *
 * The SheetJS mini build ships as a browser <script>, so the only honest way to
 * exercise it is to reproduce that environment: a bare `window` inside a vm
 * context, exactly as index.html would see it. Loading it through `require`
 * instead would take the CommonJS branch of its UMD wrapper, which is not the
 * code path the site ever runs.
 *
 * What this pins, and why each one matters:
 *   - a blank cell must become null, not a crash. `sheet_to_json` with
 *     `defval: null` hands `matrixToColumns` a null, and that function used to
 *     call `.trim()` on it — one blank cell failed the whole import.
 *   - dates must survive as date strings. With `cellDates` off they arrive as
 *     serial numbers (45678) and nothing downstream can parse them.
 *   - blank rows must be dropped, or Excel's stray formatted rows swamp the
 *     frame with all-null records.
 *   - legacy .xls must be *rejected*, because the UI only advertises .xlsx and
 *     a silent failure there would look like a corrupt file to the user.
 *   - output must actually be a zip (PK\x03\x04), not a stringified object.
 * ========================================================================== */

import fs from 'node:fs';
import vm from 'node:vm';
import { readWorkbook, sheetToColumns, sheetNames, writeWorkbook } from '../js/xlsx.js';
import { DataFrame } from '../js/dataframe.js';

const sandbox = { window: {}, self: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/vendor/xlsx.mini.min.js', 'utf8'), sandbox);
const XLSX = sandbox.window.XLSX;

let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const sheets = [
  { name: 'Data', rows: [
    ['city', 'sales', 'qty', 'when'],
    ['Beijing', 1200.5, 3, '2026-01-05'],
    ['Shanghai', 980.25, null, '2026-01-06'],
    ['Guangzhou', 1430, 4, '2026-01-07'],
    [null, 700, 1, null],
  ] },
  { name: 'Summary', rows: [['col', 'mean'], ['sales', 1077.69]] },
];
const bytes = writeWorkbook(XLSX, sheets);
const size = bytes.byteLength ?? bytes.length;
ok('writeWorkbook returns a real archive', size > 500, `${size} B`);
/* the zip magic PK\x03\x04 must be the first four bytes of the buffer */
const head = new Uint8Array(bytes.slice ? bytes.slice(0, 4) : bytes.buffer, 0, 4);
ok('output starts with the zip magic', String.fromCharCode(...head) === 'PK\x03\x04',
  JSON.stringify(String.fromCharCode(...head)));

const wb = readWorkbook(XLSX, new Uint8Array(bytes));
ok('sheet names survive', JSON.stringify(sheetNames(wb)) === '["Data","Summary"]', JSON.stringify(sheetNames(wb)));

const p = sheetToColumns(XLSX, wb, 'Data');
ok('blank cell becomes null, not a crash', p !== null);
const df = new DataFrame(p.columns, p.data, { name: 't.xlsx' });
ok('rows = 4 (blank rows dropped)', df.nrows === 4, `nrows=${df.nrows}`);
ok('sales inferred numeric', df.type('sales') === 'number', `type=${df.type('sales')}`);
ok('qty inferred numeric', df.type('qty') === 'number', `type=${df.type('qty')}`);
ok('city inferred string', df.type('city') === 'string', `type=${df.type('city')}`);
ok('when inferred date', df.type('when') === 'date', `type=${df.type('when')}`);
ok('the blank qty is null, not 0',
  df.values('qty')[1] === null, JSON.stringify(df.values('qty')));
ok('describe.mean reads the strings as numbers',
  Math.abs(df.describe().sales.mean - 1077.6875) < 1e-9, String(df.describe().sales.mean));
ok('missing counts see the hole',
  df.missingCounts().find((r) => r.name === 'qty').missing === 1);

let xlsMsg = '';
try { XLSX.write(wb, { bookType: 'xls', type: 'array' }); xlsMsg = 'supported'; }
catch (e) { xlsMsg = 'rejected: ' + e.message; }
ok('legacy .xls is not supported (UI must not promise it)', /reject/.test(xlsMsg), xlsMsg);
ok('a missing sheet name returns null', sheetToColumns(XLSX, wb, 'Nope') === null);

/* a duplicated/sheet-illegal name must be repaired, not dropped */
const weird = writeWorkbook(XLSX, [
  { name: 'a/b:c', rows: [['x'], [1]] },
  { name: 'a/b:c', rows: [['x'], [2]] },
]);
const wr = readWorkbook(XLSX, new Uint8Array(weird));
ok('illegal sheet chars are sanitised and duplicates renamed',
  JSON.stringify(sheetNames(wr)) === '["a_b_c","a_b_c (2)"]', JSON.stringify(sheetNames(wr)));

console.log(fails ? `\n✗ ${fails} failed` : '\n✓ all xlsx integration checks passed');
process.exit(fails ? 1 : 0);
