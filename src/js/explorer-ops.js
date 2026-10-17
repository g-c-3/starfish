// explorer-ops.js — copy and move in the File explorer (Decision 222). The work is native (window.ArklyFileOps,
// scripts/java/ArklyFileOpsBridge.java, written into the app by scripts/patch-fileops.js); this file starts the job, polls it,
// checks a destination before it is offered and words the outcome. Nothing is sent anywhere.

const parentOf = (p) => { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Starts a job and polls it. Returns { cancel(), done }; done resolves with the final status:
// { state: 'done' | 'error' | 'cancelled', code, message, items, total, failed, skipped, bytes, bytesTotal }.
export function startOps(bridge, op, destDir, paths, { onProgress = () => {}, pollMs = 300, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let id = '';
  try { id = bridge.start(op, destDir, paths.map((p) => encodeURIComponent(p)).join(',')); } catch { id = ''; }
  if (!id) return { cancel() {}, done: Promise.resolve({ state: 'error', code: 'busy', message: 'Another copy or move is still running, or the destination is not available.' }) };
  const done = (async () => {
    for (;;) {
      await wait(pollMs);
      let s;
      try { s = JSON.parse(bridge.status(id)); } catch { s = { state: 'error', code: 'io', message: 'The job did not answer.' }; }
      if (s.state !== 'running') { try { bridge.release(id); } catch { /* nothing to release */ } return s; }
      onProgress(s);
    }
  })();
  return { cancel() { try { bridge.cancel(id); } catch { /* already finished */ } }, done };
}

// Why a folder cannot be the destination for these sources, or '' when it can. sources: [{ path, name, isDir }].
export function destProblem(op, dest, sources) {
  if (dest.split('/').includes('.arkly-trash')) return 'Nothing can be copied or moved into the trash folder.';
  for (const s of sources) {
    if (s.isDir && (dest === s.path || dest.startsWith(`${s.path}/`))) return `"${s.name}" cannot go into itself.`;
  }
  if (op === 'move' && sources.every((s) => parentOf(s.path) === dest)) return 'Already in this folder.';
  return '';
}

// One line for the outcome of a finished job.
export function resultText(op, r) {
  const past = op === 'copy' ? 'copied' : 'moved';
  if (r.state === 'cancelled') return r.items ? `Cancelled. ${plural(r.items, 'item')} already ${past}; the one in progress was removed.` : 'Cancelled. Nothing was changed.';
  if (r.state === 'error') return r.code === 'space' ? 'There is not enough free space on the destination. Nothing more was copied.' : (r.message || 'The job failed.');
  const parts = [`${plural(r.items, 'item')} ${past}.`];
  if (r.failed) parts.push(`${r.failed} could not be ${past}${r.message ? `: ${r.message.replace(/\.$/, '')}` : ''}.`);
  if (r.skipped) parts.push(`${plural(r.skipped, 'link')} skipped.`);
  return parts.join(' ');
}
