// explorer-archive.js — open and extract archives in the File explorer (Decisions 220, 221). The work is native
// (window.ArklyArchive, scripts/java/ArklyArchiveBridge.java, written into the app by scripts/patch-archive.js); this file detects
// archive names, polls the running job, reads folder lists and words the outcomes. Nothing is sent anywhere.

const ENDINGS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.tbz2', '.tbz', '.txz', '.tar', '.zip', '.cbz', '.jar', '.7z', '.rar', '.cbr', '.gz', '.bz2', '.xz'];

export function isArchive(name) {
  const l = String(name || '').toLowerCase();
  return ENDINGS.some((e) => l.endsWith(e) && l.length > e.length);
}

// The folder name an extraction makes: the archive's name without its ending (the native side uses the same rule).
export function baseNameOf(name) {
  const l = String(name || '').toLowerCase();
  const e = ENDINGS.find((x) => l.endsWith(x) && l.length > x.length);
  return e ? name.slice(0, name.length - e.length) : name;
}

// Starts a job and polls it. Returns { cancel(), done } where done resolves with the final status:
// { state: 'done' | 'error' | 'cancelled', code, message, files, skipped, bytes, dest }.
// Everything by default; `entries` (paths inside the archive) extracts only those; `entry` (one path) extracts that one into the
// app's cache for viewing, and the file is then dest + '/' + entry.
// `mode` (Decision 295): 'merge' writes into the existing folder of the archive's name and, for each file that already exists, calls
// `destParent`: make the folder inside this folder instead of beside the archive (an archive taken out of another one sits in the
// cache; Decision 297). onConflict(path) for 'replace' | 'skip' | 'replaceAll' | 'skipAll'; 'replace' replaces without asking; anything else makes a new folder.
export function startExtract(bridge, archivePath, { password = '', entries = null, entry = null, mode = null, destParent = '', onConflict = async () => 'skip', onProgress = () => {}, pollMs = 300, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let id = '';
  try {
    if (entry) id = bridge.startEntry(archivePath, password, entry);
    else if (destParent && bridge.startModeIn) id = bridge.startModeIn(archivePath, password, entries ? entries.map((p) => encodeURIComponent(p)).join(',') : '', mode || 'new', destParent);
    else if ((mode === 'merge' || mode === 'replace') && bridge.startMode) id = bridge.startMode(archivePath, password, entries ? entries.map((p) => encodeURIComponent(p)).join(',') : '', mode);
    else if (entries) id = bridge.startSelected(archivePath, password, entries.map((p) => encodeURIComponent(p)).join(','));
    else id = bridge.start(archivePath, password);
  } catch { id = ''; }
  if (!id) return { cancel() {}, done: Promise.resolve({ state: 'error', code: 'busy', message: 'Another extraction is still running, or the file is gone.' }) };
  const done = (async () => {
    for (;;) {
      await wait(pollMs);
      let s;
      try { s = JSON.parse(bridge.status(id)); } catch { s = { state: 'error', code: 'io', message: 'The extractor did not answer.' }; }
      if (s.state === 'conflict') { // the job waits for an answer
        let c = 'skip';
        try { c = (await onConflict(s.pending)) || 'skip'; } catch { c = 'skip'; }
        try { bridge.answer(id, c); } catch { /* the job is gone */ }
        continue;
      }
      if (s.state !== 'running') { try { bridge.release(id); } catch { /* nothing to release */ } return s; }
      onProgress(s);
    }
  })();
  return { cancel() { try { bridge.cancel(id); } catch { /* already finished */ } }, done };
}

export const needsPassword = (r) => r?.state === 'error' && r.code === 'password';

// One line for an error result. `hadPassword`: a password was already tried.
export function errorText(r, hadPassword = false) {
  switch (r?.code) {
    case 'password': return hadPassword ? 'That password did not work.' : 'This archive needs a password.';
    case 'rar5': return r.message;
    case 'format': return 'This archive type is not supported.';
    case 'space': return 'There is not enough free space on this storage. Nothing was kept.';
    case 'entries': return 'The archive holds too many files to extract. Nothing was kept.';
    case 'busy': return r.message;
    default: return `Could not extract: ${r?.message || 'the archive could not be read.'} Nothing was kept.`;
  }
}

// Reads an archive's entry list in the background. Returns { cancel(), done }; done resolves { state: 'ready' | 'error' | 'cancelled',
// id, count, code, message }. An id is kept only for 'ready'; the caller closes it with bridge.closeArchive(id).
export function openBrowse(bridge, archivePath, { password = '', onProgress = () => {}, pollMs = 250, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let id = '';
  try { id = bridge.openArchive(archivePath, password); } catch { id = ''; }
  if (!id) return { cancel() {}, done: Promise.resolve({ state: 'error', code: 'busy', message: 'The archive could not be opened.' }) };
  let cancelled = false;
  const done = (async () => {
    for (;;) {
      await wait(pollMs);
      let s;
      try { s = JSON.parse(bridge.browseStatus(id)); } catch { s = { state: 'error', code: 'io', message: 'The archive reader did not answer.' }; }
      if (cancelled || s.state === 'cancelled') { try { bridge.closeArchive(id); } catch { /* already closed */ } return { state: 'cancelled' }; }
      if (s.state === 'ready') return { ...s, id };
      if (s.state !== 'running') { try { bridge.closeArchive(id); } catch { /* already closed */ } return s; }
      onProgress(s);
    }
  })();
  return { cancel() { cancelled = true; }, done };
}

// The entries directly inside one folder of an open archive: [{ name, isDir, size, mtime: 0, path }]. `prefix` is '' for the top.
export function listFolder(bridge, id, prefix) {
  let rows = [];
  try { rows = JSON.parse(bridge.children(id, prefix) || '[]'); } catch { rows = []; }
  return rows.map((r) => ({ name: r.n, isDir: !!r.d, size: Number(r.s) || 0, mtime: 0, path: prefix ? `${prefix}/${r.n}` : r.n }));
}
