/* =============================================================================
 * browser.mjs — locate a Chromium build and drive it with puppeteer-core.
 *
 * puppeteer-core ships no browser, which keeps the dependency tiny and lets CI
 * use whatever Chrome the runner already has. The search order is: explicit
 * CHROME_PATH, the puppeteer cache, then the usual install locations per OS.
 * ========================================================================== */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function walkForChrome(dir, depth = 4) {
  if (depth < 0) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && /^(chrome|chrome-headless-shell|headless_shell)(\.exe)?$/.test(e.name)) return full;
    if (e.isDirectory()) {
      const hit = walkForChrome(full, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Best-effort discovery of a Chrome/Chromium executable. */
export function findChrome() {
  const override = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (override && exists(override)) return override;

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }
  for (const c of candidates) if (exists(c)) return c;

  for (const cache of [
    process.env.PUPPETEER_CACHE_DIR,
    path.join(os.homedir(), '.cache', 'puppeteer'),
    path.join(os.homedir(), 'AppData', 'Local', 'puppeteer'),
  ].filter(Boolean)) {
    if (!fs.existsSync(cache)) continue;
    const hit = walkForChrome(cache);
    if (hit) return hit;
  }
  return null;
}

/**
 * Load puppeteer-core.
 *
 * ESM ignores NODE_PATH, so a package that only exists in a shared workspace
 * node_modules would look "not installed" to a bare `import`. Resolving through
 * a CJS require first keeps both layouts working: a local devDependency and a
 * central cache pointed at by NODE_PATH.
 */
export async function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  let lastErr;
  try {
    return await import('puppeteer-core');
  } catch (e) { lastErr = e; }
  try {
    const resolved = require.resolve('puppeteer-core');
    return await import(pathToFileURL(resolved).href);
  } catch (e) { lastErr = e; }
  for (const dir of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    try {
      const pkg = path.join(dir, 'puppeteer-core', 'package.json');
      if (!fs.existsSync(pkg)) continue;
      const meta = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      const entry = path.join(dir, 'puppeteer-core', meta.main || 'lib/cjs/puppeteer/puppeteer-core.js');
      return await import(pathToFileURL(entry).href);
    } catch (e) { lastErr = e; }
  }
  throw new Error(
    'puppeteer-core is not installed.\n' +
    '  npm i -D puppeteer-core\n' +
    '  # or point at a workspace copy:\n' +
    '  NODE_PATH=<dir with node_modules> npm run test:e2e\n' +
    `(${lastErr && lastErr.message})`,
  );
}
