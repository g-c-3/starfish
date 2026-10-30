// files.js — binds filestore.js to the device (Decision 162). Home files are wrapped under the master key; Vault files
// (Decision 212) use the same format with their keys wrapped under the Vault key, which the caller passes in.
// Every Home file read, write, size and removal goes through here. Rows with file_key null are plain files from before
// per-file encryption and are read as they are until the migration.
// Capacitor is imported lazily, so the module loads in Node with injected IO.

import { createFileStore, loadMasterKey, rewrapFileKey, sameWrappedKey, newFilePath } from './filestore.js';
import { toBase64, fromBase64 } from './crypto.js';

let boundDb = null;
let store = null;
let io = null;
let homeKey = null; // () => Promise<CryptoKey>, the master key
let chunk;

// Device IO: base64 through the Filesystem plugin; reads go through the app's own file URL (Decision 154).
function deviceIo() {
  const fs = () => import('@capacitor/filesystem');
  return {
    async write(path, bytes) {
      const { Filesystem, Directory } = await fs();
      await Filesystem.writeFile({ path, directory: Directory.Data, data: toBase64(bytes), recursive: true });
    },
    async append(path, bytes) {
      const { Filesystem, Directory } = await fs();
      await Filesystem.appendFile({ path, directory: Directory.Data, data: toBase64(bytes) });
    },
    async read(path) {
      const { Filesystem, Directory } = await fs();
      try {
        const { Capacitor } = await import('@capacitor/core');
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
        const res = await fetch(Capacitor.convertFileSrc(uri));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        return new Uint8Array(fromBase64((await Filesystem.readFile({ path, directory: Directory.Data })).data));
      }
    },
    async stat(path) {
      const { Filesystem, Directory } = await fs();
      return (await Filesystem.stat({ path, directory: Directory.Data })).size || 0;
    },
    async remove(path) {
      const { Filesystem, Directory } = await fs();
      await Filesystem.deleteFile({ path, directory: Directory.Data });
    },
    async list(dir) {
      const { Filesystem, Directory } = await fs();
      try { return (await Filesystem.readdir({ path: dir, directory: Directory.Data })).files.map((f) => f.name); }
      catch { return []; } // no folder yet
    }
  };
}

// Idempotent per database object. options.io replaces the device IO (tests).
function initFiles(db, options = {}) {
  if (store && boundDb === db && !options.io) return;
  boundDb = db;
  io = options.io || deviceIo();
  const get = async (key) => ((await db.query(`SELECT value FROM meta WHERE key = ?`, [key])).values || [])[0]?.value ?? null;
  const set = (key, value) => db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
  let master = null;
  chunk = options.chunkSize;
  homeKey = () => (master ||= loadMasterKey({ get, set }));
  store = createFileStore({ io, getMasterKey: homeKey, chunkSize: chunk });
}

function need() {
  if (!store) throw new Error('File storage is not ready.');
  return store;
}

// A list row may not carry file_key; look it up once rather than read an encrypted file as plain.
async function withKey(row) {
  if (row.file_key !== undefined || !row.id) return row;
  const found = ((await boundDb.query(`SELECT file_key FROM entries WHERE id = ?`, [row.id])).values || [])[0];
  return { ...row, file_key: found?.file_key ?? null };
}

// -> { path, fileKey }; store both on the entry (file_path, file_key).
const saveBytes = (bytes) => need().write(bytes);
const saveBase64 = (b64) => need().write(new Uint8Array(fromBase64(b64)));
// Streaming writer: append(bytes) in any sizes, finish() -> { path, fileKey }, abort() removes the partial file.
const beginFile = () => need().begin();

async function readBytes(row) { return need().read(await withKey(row)); }
// The plain bytes as a list of chunks (Decision 329); onProgress(0..1).
async function readParts(row, onProgress) { return need().readParts(await withKey(row), onProgress); }
async function readBase64(row) { return toBase64(await readBytes(row)); }
// Size of the stored file's contents; 0 when the file is missing.
async function fileSize(row) {
  try { return await need().size(await withKey(row)); } catch { return 0; }
}
async function removeFile(row) {
  if (!row?.file_path) return;
  try { await io.remove(row.file_path); } catch { /* already gone */ }
}

// ---- Vault files (Decision 212): same on-disk format, file key wrapped under the Vault key (a CryptoKey) ----
const vaultStore = (vmk) => { need(); return createFileStore({ io, getMasterKey: async () => vmk, chunkSize: chunk }); };
// Streaming Vault writer: same shape as beginFile(), the file key wrapped under the Vault key (Decision 319).
const beginVaultFile = (vmk) => vaultStore(vmk).begin();
const saveVaultBase64 = (vmk, b64) => vaultStore(vmk).write(new Uint8Array(fromBase64(b64)));
const readVaultBytes = (vmk, row) => vaultStore(vmk).read(row);
const readVaultBase64 = async (vmk, row) => toBase64(await readVaultBytes(vmk, row));
async function vaultFileSize(vmk, row) { return vaultStore(vmk).size(row); } // throws when the file is missing

// Small text files by path (Vault thumbnails, Decision 254). The caller encrypts; these only move text and list a folder.
async function writeText(path, text) { need(); await io.write(path, new TextEncoder().encode(text)); }
async function readText(path) { need(); return new TextDecoder().decode(await io.read(path)); }
async function removePath(path) { need(); try { await io.remove(path); } catch { /* already gone */ } }
async function listPaths(dir) { need(); return io.list(dir); }

// ---- Home thumbnails (Decision 311): one small file per Home image or video in `hthumbs/`, named by the SHA-256 of the entry id, holding
// { p: the file_path, d: JPEG data URL } under the master key (AES-GCM, the name as additional data). A thumbnail whose `p` differs from
// the row's is stale and is made again. A cache: not in backups, made again when missing, removed by the sweep when no Home image maps to it.
const HTHUMB_DIR = 'hthumbs';
async function hthumbPath(id) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)));
  return `${HTHUMB_DIR}/${[...h].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
async function putHomeThumb(id, filePath, dataUrl) {
  try {
    need();
    const path = await hthumbPath(id), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) }, await homeKey(),
      new TextEncoder().encode(JSON.stringify({ p: filePath || null, d: dataUrl }))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv, 0); out.set(ct, 12);
    await io.write(path, out);
  } catch { /* a cache */ }
}
// -> data URL, or null when there is none, it is stale, or it does not open under this key.
async function getHomeThumb(id, filePath) {
  try {
    need();
    const path = await hthumbPath(id), b = await io.read(path);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: new TextEncoder().encode(path) }, await homeKey(), b.subarray(12));
    const t = JSON.parse(new TextDecoder().decode(pt));
    return t && t.p === (filePath || null) && typeof t.d === 'string' ? t.d : null;
  } catch { return null; }
}
// Removes thumbnails of images that no longer exist on Home (deleted, purged, moved to the Vault, wiped by a restore). Trashed ones keep theirs.
async function sweepHomeThumbs() {
  try {
    need();
    const names = await io.list(HTHUMB_DIR);
    if (!names.length) return 0;
    const ids = ((await boundDb.query(`SELECT id FROM entries WHERE is_private=0 AND type='image'`)).values || []).map((r) => r.id);
    const keep = new Set(await Promise.all(ids.map(async (id) => (await hthumbPath(id)).slice(HTHUMB_DIR.length + 1))));
    let removed = 0;
    for (const n of names) if (!keep.has(n)) { await io.remove(`${HTHUMB_DIR}/${n}`); removed++; }
    return removed;
  } catch { return 0; }
}

// Move: the file stays where it is; only its key is wrapped again, for the other key. Both need the file's path.
async function rewrapForVault(vmk, row) { need(); return rewrapFileKey(row.file_key, row.file_path, row.file_path, await homeKey(), vmk); }
async function rewrapForHome(vmk, row) { need(); return rewrapFileKey(row.file_key, row.file_path, row.file_path, vmk, await homeKey()); }
// True when the Vault wrapper and the Home wrapper hold the same file key for this path.
async function keysMatch(vmk, path, vaultWrapped, homeWrapped) { need(); return sameWrappedKey(vaultWrapped, path, vmk, homeWrapped, path, await homeKey()); }

// Backup restore of a Vault file: the stored (already encrypted) bytes are written as they are.
// -> { path, append(bytes), finish(), abort() }; the path is the given one or a new one.
async function beginRawFile(path = newFilePath()) {
  need();
  await io.write(path, new Uint8Array(0));
  return { path, append: (bytes) => io.append(path, bytes), finish: async () => ({ path }), abort: async () => { try { await io.remove(path); } catch { /* nothing written */ } } };
}
async function writeRawBase64(path, b64) { need(); await io.write(path, new Uint8Array(fromBase64(b64))); }

// ---- One-time migration of plain Home files (Phase 17 F, Decision 163) ----
const MIGRATED_META = 'files_migrated';
const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

async function plainRows() {
  return (await boundDb.query(
    `SELECT id, file_path FROM entries WHERE file_path IS NOT NULL AND file_key IS NULL AND is_private = 0`)).values || [];
}

// Per file: write the encrypted copy, read it back and compare, point the entry at it, then remove the plain file.
// A file that is missing or fails stays plain and is retried at the next start. Once every plain file is converted, files in
// files/ that no entry points to (left by earlier versions, or by an interruption here) are removed, once.
// -> { total, migrated, failed, missing, orphans }
async function migratePlainFiles({ onProgress } = {}) {
  const out = { total: 0, migrated: 0, failed: 0, missing: 0, orphans: 0 };
  const flag = ((await boundDb.query(`SELECT value FROM meta WHERE key = ?`, [MIGRATED_META])).values || [])[0]?.value;
  if (flag === '1') return out;
  const rows = await plainRows();
  out.total = rows.length;
  let done = 0;
  for (const row of rows) {
    onProgress?.({ done, total: rows.length });
    done++;
    let plain;
    try { plain = await io.read(row.file_path); } catch { out.missing++; continue; }
    let saved = null;
    try {
      saved = await need().write(plain);
      const back = await need().read({ file_path: saved.path, file_key: saved.fileKey });
      if (!sameBytes(back, plain)) throw new Error('mismatch');
      await boundDb.run(`UPDATE entries SET file_path = ?, file_key = ? WHERE id = ?`, [saved.path, saved.fileKey, row.id]);
      out.migrated++;
    } catch {
      if (saved) { try { await io.remove(saved.path); } catch { /* nothing written */ } }
      out.failed++;
      continue;
    }
    try { await io.remove(row.file_path); } catch { /* swept below or at the next start */ }
  }
  if (out.failed === 0 && out.missing === 0) {
    const kept = new Set(((await boundDb.query(`SELECT file_path FROM entries WHERE file_path IS NOT NULL UNION SELECT file_path FROM widget_inbox WHERE file_path IS NOT NULL`)).values || []).map((r) => r.file_path)); // inbox files wait for the next unlock (Decision 266)
    for (const name of await io.list('files')) {
      const path = `files/${name}`;
      if (kept.has(path)) continue;
      try { await io.remove(path); out.orphans++; } catch { /* leave it */ }
    }
    await boundDb.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`, [MIGRATED_META]);
  }
  return out;
}

export {
  migratePlainFiles, initFiles, withKey, saveBytes, saveBase64, beginFile, readBytes, readParts, readBase64, fileSize, removeFile,
  beginVaultFile, saveVaultBase64, readVaultBytes, readVaultBase64, vaultFileSize, rewrapForVault, rewrapForHome, keysMatch, beginRawFile, writeRawBase64, newFilePath, writeText, readText, removePath, listPaths,
  putHomeThumb, getHomeThumb, sweepHomeThumbs
};
