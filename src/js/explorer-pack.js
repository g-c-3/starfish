// explorer-pack.js — compress files and folders in the File explorer (Decision 295). The work is native (window.ArklyPack,
// scripts/java/ArklyPackBridge.java, written into the app by scripts/patch-archive.js); this file starts the job, polls it and words
// the outcome. Nothing is sent anywhere.

export const FORMATS = [
  { id: 'zip', label: 'ZIP', password: true },
  { id: '7z', label: '7z', password: false },
];
export const LEVELS = [
  { id: 1, label: 'Fastest', hint: 'Largest file, quickest' },
  { id: 2, label: 'Standard', hint: 'A balance of size and time' },
  { id: 3, label: 'Best', hint: 'Smallest file, slowest' },
];

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The archive's name (without ending): the item's own name for one item, else the folder's name.
export function packBaseName(items, folderName) {
  if (items.length === 1) {
    const { name, isDir } = items[0];
    const dot = name.lastIndexOf('.');
    return isDir || dot <= 0 ? name : name.slice(0, dot);
  }
  return folderName || 'Archive';
}

// Starts a job and polls it. Returns { cancel(), done }; done resolves with the final status:
// { state: 'done' | 'error' | 'cancelled', code, message, files, total, skipped, bytes, bytesTotal, current, dest }.
export function startPack(bridge, dir, baseName, { format = 'zip', level = 2, password = '', paths, onProgress = () => {}, pollMs = 300, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let id = '';
  try { id = bridge.start(dir, baseName, format, level, password, paths.map((p) => encodeURIComponent(p)).join(',')); } catch { id = ''; }
  if (!id) return { cancel() {}, done: Promise.resolve({ state: 'error', code: 'busy', message: 'Another compression is still running, or the files are not available.' }) };
  const done = (async () => {
    for (;;) {
      await wait(pollMs);
      let s;
      try { s = JSON.parse(bridge.status(id)); } catch { s = { state: 'error', code: 'io', message: 'The compressor did not answer.' }; }
      if (s.state !== 'running') { try { bridge.release(id); } catch { /* nothing to release */ } return s; }
      onProgress(s);
    }
  })();
  return { cancel() { try { bridge.cancel(id); } catch { /* already finished */ } }, done };
}

// One line for a finished job. `size`: the formatted size of the new archive, or ''.
export function packResultText(r, size = '') {
  if (r.state === 'cancelled') return 'Compression cancelled. Nothing was kept.';
  if (r.state === 'error') {
    if (r.code === 'space') return 'There is not enough free space on this storage. Nothing was kept.';
    return `Could not compress: ${r.message || 'the archive could not be written.'} Nothing was kept.`;
  }
  const name = r.dest ? r.dest.split('/').pop() : '';
  return `Created "${name}" from ${plural(r.files, 'file')}${size ? ` (${size})` : ''}.${r.skipped ? ` ${plural(r.skipped, 'link or unreadable item')} left out.` : ''}`;
}
