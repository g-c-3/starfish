// explorer-archive.js — extract an archive from the File explorer (Decision 220). The work is native (window.ArklyArchive,
// scripts/java/ArklyArchiveBridge.java, written into the app by scripts/patch-archive.js); this file detects archive names,
// polls the running job and words the outcomes. Nothing is sent anywhere.

const ENDINGS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.tbz2', '.tbz', '.txz', '.tar', '.zip', '.cbz', '.jar', '.7z', '.rar', '.cbr', '.gz', '.bz2', '.xz'];

export function isArchive(name) {
  const l = String(name || '').toLowerCase();
  return ENDINGS.some((e) => l.endsWith(e) && l.length > e.length);
}

// Starts a job and polls it. Returns { cancel(), done } where done resolves with the final status:
// { state: 'done' | 'error' | 'cancelled', code, message, files, skipped, bytes, dest }.
export function startExtract(bridge, archivePath, { password = '', onProgress = () => {}, pollMs = 300, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let id = '';
  try { id = bridge.start(archivePath, password); } catch { id = ''; }
  if (!id) return { cancel() {}, done: Promise.resolve({ state: 'error', code: 'busy', message: 'Another extraction is still running, or the file is gone.' }) };
  const done = (async () => {
    for (;;) {
      await wait(pollMs);
      let s;
      try { s = JSON.parse(bridge.status(id)); } catch { s = { state: 'error', code: 'io', message: 'The extractor did not answer.' }; }
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
