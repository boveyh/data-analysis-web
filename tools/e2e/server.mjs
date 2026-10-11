/* =============================================================================
 * server.mjs — dependency-free static file server for the end-to-end tests.
 *
 * The workbench must be served over HTTP, not opened via file://, for two
 * reasons: ES modules are blocked by the file origin's CORS rules, and the
 * parse Web Worker cannot be constructed there. This server reproduces the
 * GitHub Pages behaviour closely enough (correct MIME types, no directory
 * listing, index.html at the root) to make the tests meaningful.
 * ========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Only ever serve inside ROOT — a request must never escape the project. */
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = path.resolve(ROOT, '.' + decoded);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

export function createServer() {
  return http.createServer((req, res) => {
    let target = resolveSafe(req.url || '/');
    if (!target) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let stat = null;
    try { stat = fs.statSync(target); } catch { stat = null; }
    if (stat && stat.isDirectory()) target = path.join(target, 'index.html');

    fs.readFile(target, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(buf);
    });
  });
}

/** Start on an ephemeral port and resolve once it is listening. */
export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ server, port: actual, origin: `http://127.0.0.1:${actual}` });
    });
  });
}

/* Allow `node tools/e2e/server.mjs 5173` for manual browsing. */
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const wanted = Number(process.argv[2] || 5173);
  const { origin } = await startServer(wanted);
  console.log(`PandaLens served at ${origin}/`);
}
