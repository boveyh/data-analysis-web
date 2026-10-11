/* =============================================================================
 * parse.worker.js — off-main-thread CSV / TSV / JSON tokeniser.
 *
 * Large files (tens of megabytes) can take seconds to split into columns.
 * Doing that here keeps the UI responsive: the main thread only receives the
 * finished column-oriented payload and never blocks on a single long task.
 *
 * Protocol
 *   in : { id: number, text: string, name: string }
 *   out: { id, ok: true,  columns: string[], data: { [col]: any[] } }
 *      | { id, ok: false, error: string }
 * ========================================================================== */

import { parseText } from './parse.js';

self.onmessage = (event) => {
  const { id, text, name } = event.data || {};
  try {
    const parsed = parseText(text, name || '');
    if (!parsed) {
      self.postMessage({ id, ok: true, columns: [], data: {} });
      return;
    }
    self.postMessage({ id, ok: true, columns: parsed.columns, data: parsed.data });
  } catch (err) {
    // Surface the message verbatim: the caller decides whether to retry
    // synchronously (a worker bug) or report a real parse error to the user.
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
