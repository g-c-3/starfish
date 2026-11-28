// drivelib.js — continuous Google Drive backup (Decisions 594 to 600). Opt-in, off by default, runs only while the app is open.
//
// One encrypted object per entry in the Drive folder "Arkly Library", plus manifest.json. Objects are encrypted under a random
// data key. That key lives in two places only: on this phone as a non-extractable CryptoKey in IndexedDB, and in the manifest
// wrapped under the backup passkey (PBKDF2 600000). The passkey itself is never stored (Decision 32 stands for the passkey), so a
// new phone needs the passkey alone. Changes are found by comparing a fingerprint per entry with the local index; no write path
// in the app is hooked. A removed entry's object goes to the Drive trash, not deleted.

import { ensureSignedIn, getDriveStorageEstimate } from './gdrive.js';
import { deriveAesKey, encryptChunk, decryptChunk, BACKUP_KDF_ITERATIONS } from './crypto.js';
import { ENTRY_CATEGORIES, ALL_CATEGORIES, libraryObject, libraryExtras, restoreFromLibrary } from './backup.js';
import { transferInbox } from './widget-inbox.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'Arkly Library';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MANIFEST_NAME = 'manifest.json';
const MULTIPART_MAX = 4 * 1024 * 1024; // above this an object goes up as a resumable upload
const TICK_MS = 60 * 1000;
const RUN_BUDGET_MS = 45 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const QUOTA_RETRY_MS = 30 * 60 * 1000;
const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
async function metaGet(db, key) {
  const r = await db.query(`SELECT value FROM meta WHERE key=?`, [key]);
  return (r.values && r.values[0]) ? r.values[0].value : null;
}
async function metaSet(db, key, value) {
  await db.run(`INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value]);
}
async function metaDel(db, key) { await db.run(`DELETE FROM meta WHERE key=?`, [key]); }

// Two 32-bit FNV-style lanes: a change detector, not a security hash.
function fnv(s) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Data key on this phone: a non-extractable CryptoKey in IndexedDB. Nothing readable is stored.
// ---------------------------------------------------------------------------
const IDB_NAME = 'arkly-library', IDB_STORE = 'k', IDB_KEY = 'dek';
function openIdb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbRun(mode, fn) {
  const d = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, mode);
      const rq = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(rq ? rq.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { d.close(); }
}
const keyGet = () => idbRun('readonly', (s) => s.get(IDB_KEY));
const keyPut = (k) => idbRun('readwrite', (s) => s.put(k, IDB_KEY));
const keyDel = () => idbRun('readwrite', (s) => s.delete(IDB_KEY));

// ---------------------------------------------------------------------------
// Key wrap and manifest. Line numbers are AES-GCM additional data: 0 the key wrap, 1 the sealed index.
// ---------------------------------------------------------------------------
const asKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function newLibraryKey(passphrase, hint) {
  const gen = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', gen));
  const { key: kek, salt } = await deriveAesKey(passphrase, null, BACKUP_KDF_ITERATIONS);
  const dek = await asKey(raw);
  const wrap = await encryptChunk(kek, raw, 0);
  raw.fill(0);
  return { dek, header: { version: 1, kind: 'arkly-library', salt, kdfIterations: BACKUP_KDF_ITERATIONS, hint, dek: wrap } };
}

async function openLibraryKey(passphrase, manifest) {
  const { key: kek } = await deriveAesKey(passphrase, manifest.salt, manifest.kdfIterations);
  let raw;
  try { raw = new Uint8Array(await decryptChunk(kek, manifest.dek.iv, manifest.dek.c, 0)); }
  catch { throw new Error('wrong_passkey'); }
  const dek = await asKey(raw);
  raw.fill(0);
  return dek;
}

const headerOf = (m) => ({ version: m.version, kind: m.kind, salt: m.salt, kdfIterations: m.kdfIterations, hint: m.hint || '', dek: m.dek });
const sealIndex = (dek, payload) => encryptChunk(dek, ENC.encode(JSON.stringify(payload)), 1);
async function openIndex(dek, sealed) { return JSON.parse(DEC.decode(await decryptChunk(dek, sealed.iv, sealed.c, 1))); }

// ---------------------------------------------------------------------------
// Drive REST
// ---------------------------------------------------------------------------
async function dfetch(token, path, opts = {}) {
  const res = await fetch(`${DRIVE_API}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!res.ok) { const e = new Error(`Drive ${res.status}`); e.status = res.status; throw e; }
  return res;
}

async function findFolder(token, create) {
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const found = await (await dfetch(token, `/files?q=${q}&fields=files(id)`)).json();
  if (found.files && found.files.length) return found.files[0].id;
  if (!create) return null;
  const made = await (await dfetch(token, '/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
  })).json();
  return made.id;
}

async function findManifest(token, folderId) {
  const q = encodeURIComponent(`name='${MANIFEST_NAME}' and '${folderId}' in parents and trashed=false`);
  const found = await (await dfetch(token, `/files?q=${q}&fields=files(id)`)).json();
  return found.files && found.files.length ? found.files[0].id : null;
}

async function uploadOnce(token, { folderId, name, blob, fileId, mime }) {
  const meta = fileId ? { name } : { name, parents: [folderId] };
  const method = fileId ? 'PATCH' : 'POST';
  const base = fileId ? `${DRIVE_UPLOAD_API}/files/${fileId}` : `${DRIVE_UPLOAD_API}/files`;
  let res;
  if (blob.size <= MULTIPART_MAX) {
    const b = `arkly-lib-${Math.random().toString(16).slice(2)}`;
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,
      blob, `\r\n--${b}--`
    ]);
    res = await fetch(`${base}?uploadType=multipart`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${b}` }, body
    });
  } else {
    const init = await fetch(`${base}?uploadType=resumable`, {
      method, headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(blob.size)
      }, body: JSON.stringify(meta)
    });
    if (!init.ok) { const e = new Error(`Drive ${init.status}`); e.status = init.status; throw e; }
    const session = init.headers.get('Location');
    if (!session) throw new Error('Drive gave no upload address');
    res = await fetch(session, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob });
  }
  if (!res.ok) { const e = new Error(`Drive ${res.status}`); e.status = res.status; throw e; }
  return (await res.json()).id;
}

// An object the person removed on Drive (404) is created again.
async function putFile(token, args) {
  try { return await uploadOnce(token, args); }
  catch (err) { if (err.status === 404 && args.fileId) return uploadOnce(token, { ...args, fileId: null }); throw err; }
}

async function trashFile(token, id) {
  try {
    await dfetch(token, `/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  } catch (err) { if (err.status !== 404) throw err; }
}

// ---------------------------------------------------------------------------
// Local index: what the library holds, by entry id. { entries: {id: {fid, fp, cat, size}}, extrasFp, folderId, manifestId }
// ---------------------------------------------------------------------------
async function loadIndex(db) {
  try { const v = await metaGet(db, 'lib_index'); if (v) return JSON.parse(v); } catch { /* rebuilt below */ }
  return { entries: {}, extrasFp: '', folderId: null, manifestId: null };
}
const saveIndex = (db, idx) => metaSet(db, 'lib_index', JSON.stringify(idx));

const SCAN_SQL = `SELECT e.id, e.type, e.is_private, e.label, e.file_path, e.extension, e.amount, e.expense_category, e.replied,
    e.fire_at, e.repeat_rule, e.snoozed_until, e.notified, e.completed_at, e.latitude, e.longitude, e.updated_at,
    COALESCE(LENGTH(e.body_text),0) AS bt, COALESCE(LENGTH(e.encrypted_body),0) AS eb, COALESCE(LENGTH(e.description),0) AS de,
    COALESCE(LENGTH(e.encrypted_description),0) AS ed, COALESCE(LENGTH(e.encrypted_label),0) AS el, COALESCE(LENGTH(e.money_json),0) AS mj,
    (SELECT GROUP_CONCAT(n, '|') FROM (SELECT t.name AS n FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id ORDER BY t.name)) AS tg,
    (SELECT COUNT(*) FROM reminder_log r WHERE r.entry_id = e.id) AS rl
  FROM entries e WHERE e.deleted_at IS NULL`;

// One light query, no blobs: [{id, cat, fp}] for every live entry the archive would hold.
async function scan(db) {
  const rows = (await db.query(SCAN_SQL)).values || [];
  const names = Object.keys(ENTRY_CATEGORIES);
  const out = [];
  for (const r of rows) {
    const cat = names.find((c) => ENTRY_CATEGORIES[c](r));
    if (!cat) continue;
    const fp = fnv([r.label, r.file_path, r.extension, r.amount, r.expense_category, r.replied, r.fire_at, r.repeat_rule, r.snoozed_until,
      r.notified, r.completed_at, r.latitude, r.longitude, r.updated_at, r.bt, r.eb, r.de, r.ed, r.el, r.mj, r.tg, r.rl].join('~'));
    out.push({ id: r.id, cat, fp });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
// state: off | idle | syncing | offline | signed_out | key_missing | insufficient_storage | error
let status = { state: 'off', pending: 0, lastSyncAt: 0, skipped: 0, detail: '' };
const listeners = new Set();
function setStatus(patch) { status = { ...status, ...patch }; for (const f of listeners) { try { f(status); } catch { /* a listener never stops a run */ } } }
const getLibraryStatus = () => status;
function onLibraryStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }

function libraryStatusText(s) {
  const when = s.lastSyncAt ? ` Last checked ${new Date(s.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
  const skip = s.skipped ? ` ${s.skipped} file${s.skipped === 1 ? '' : 's'} over 150 MB not included.` : '';
  switch (s.state) {
    case 'syncing': return `Uploading, ${s.pending} left…`;
    case 'idle': return `Up to date.${when}${skip}`;
    case 'offline': return `Waiting for a connection. ${s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting.` : ''}`.trim();
    case 'signed_out': return 'Google account not connected: uploads are paused.';
    case 'key_missing': return 'The key on this phone is gone. Enter your passkey to resume.';
    case 'insufficient_storage': return 'Not enough Drive space: uploads are paused.';
    case 'error': return `Last attempt failed (${s.detail || 'unknown'}). It tries again soon.`;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Sync: runs while the app is open, never in the background (Decision 31).
// ---------------------------------------------------------------------------
let running = false, nextTryAt = 0, timer = null, started = false;

async function writeManifest(db, token, idx, dek, extras) {
  const header = JSON.parse(await metaGet(db, 'lib_header'));
  const entries = {};
  for (const [id, e] of Object.entries(idx.entries)) if (e.fid) entries[id] = { fid: e.fid, fp: e.fp, cat: e.cat, size: e.size };
  const manifest = { ...header, index: await sealIndex(dek, { entries, extras, at: Date.now() }) };
  idx.manifestId = await putFile(token, {
    folderId: idx.folderId, name: MANIFEST_NAME, blob: new Blob([JSON.stringify(manifest)]), fileId: idx.manifestId, mime: 'application/json'
  });
}

async function runSync(db) {
  const dek = await keyGet();
  if (!dek) { setStatus({ state: 'key_missing' }); return; }
  const auth = await ensureSignedIn({ silent: true });
  if (!auth.ok) { setStatus({ state: 'signed_out' }); return; }
  const token = auth.accessToken;
  await transferInbox(db).catch(() => 0); // waiting widget captures become Home items first (Decision 266)

  const idx = await loadIndex(db);
  const rows = await scan(db);
  const live = new Set(rows.map((r) => r.id));
  const todo = rows.filter((r) => !idx.entries[r.id] || idx.entries[r.id].fp !== r.fp);
  const gone = Object.keys(idx.entries).filter((id) => !live.has(id));
  const extras = await libraryExtras(db);
  const extrasFp = fnv(JSON.stringify(extras));
  const skipped = Object.values(idx.entries).filter((e) => e.skipped).length;

  if (!todo.length && !gone.length && extrasFp === idx.extrasFp) { setStatus({ state: 'idle', pending: 0, lastSyncAt: Date.now(), skipped }); return; }
  setStatus({ state: 'syncing', pending: todo.length + gone.length });

  if (!idx.folderId) idx.folderId = await findFolder(token, true);
  const { availableBytes } = await getDriveStorageEstimate(token);
  let used = 0, done = 0, doneTodo = 0, changed = false, stopped = null;
  const t0 = Date.now();
  try {
    for (const r of todo) {
      if (Date.now() - t0 > RUN_BUDGET_MS) break;
      const row = ((await db.query(`SELECT * FROM entries WHERE id=?`, [r.id])).values || [])[0];
      if (!row) continue; // removed since the scan: the next run trashes its object
      const obj = await libraryObject(db, dek, row, r.cat);
      if (obj.tooLarge) { idx.entries[r.id] = { fp: r.fp, fid: null, cat: r.cat, size: 0, skipped: 'large' }; changed = true; done += 1; doneTodo += 1; continue; }
      if (availableBytes !== null && used + obj.blob.size > availableBytes) { stopped = 'insufficient_storage'; break; }
      const prev = idx.entries[r.id];
      const fid = await putFile(token, { folderId: idx.folderId, name: `e_${r.id}.dz`, blob: obj.blob, fileId: prev ? prev.fid : null, mime: 'application/octet-stream' });
      used += obj.blob.size;
      idx.entries[r.id] = { fid, fp: r.fp, cat: r.cat, size: obj.blob.size };
      changed = true; done += 1; doneTodo += 1;
      if (done % 10 === 0) await saveIndex(db, idx); // an interrupted run resumes from here
      setStatus({ pending: todo.length + gone.length - done });
    }
    if (!stopped) {
      for (const id of gone) {
        if (Date.now() - t0 > RUN_BUDGET_MS) break;
        if (idx.entries[id].fid) await trashFile(token, idx.entries[id].fid);
        delete idx.entries[id];
        changed = true; done += 1;
      }
    }
  } finally {
    if (changed) await saveIndex(db, idx);
  }

  const left = todo.length - doneTodo + gone.filter((id) => idx.entries[id]).length;
  if (changed || extrasFp !== idx.extrasFp) {
    await writeManifest(db, token, idx, dek, extras);
    idx.extrasFp = extrasFp;
    await saveIndex(db, idx);
  }
  const skippedNow = Object.values(idx.entries).filter((e) => e.skipped).length;
  if (stopped) { nextTryAt = Date.now() + QUOTA_RETRY_MS; setStatus({ state: stopped, pending: left, skipped: skippedNow }); return; }
  setStatus({ state: left > 0 ? 'syncing' : 'idle', pending: Math.max(0, left), lastSyncAt: Date.now(), skipped: skippedNow });
  if (left > 0) setTimeout(() => syncLibrary(db), 2000);
}

async function syncLibrary(db) {
  if (running || Date.now() < nextTryAt) return;
  running = true; // set before any await: two triggers at once (timer, resume, network) must not start two runs
  try {
    if ((await metaGet(db, 'lib_enabled')) !== 'true') { setStatus({ state: 'off', pending: 0 }); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus({ state: 'offline' }); return; }
    await runSync(db);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) setStatus({ state: 'signed_out' });
    else setStatus({ state: 'error', detail: err && err.status ? `Drive ${err.status}` : 'network' });
    nextTryAt = Date.now() + RETRY_MS;
  } finally { running = false; }
}

// Called once after the app opens. Also runs when the app goes to the background or comes back, and when the network returns.
function startLibraryLoop(db) {
  if (started) return;
  started = true;
  const kick = () => { syncLibrary(db).catch(() => {}); };
  timer = setInterval(kick, TICK_MS);
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('online', () => { nextTryAt = 0; kick(); });
  setTimeout(kick, 5000);
}
function kickLibrary(db) { nextTryAt = 0; return syncLibrary(db); }

// ---------------------------------------------------------------------------
// Turn on, resume, turn off
// ---------------------------------------------------------------------------
const libraryIsEnabled = async (db) => (await metaGet(db, 'lib_enabled')) === 'true';

// True when this Google account already holds a library: the passkey then opens it instead of making a new one.
async function libraryExists() {
  const auth = await ensureSignedIn({ silent: true });
  if (!auth.ok) return false;
  const folderId = await findFolder(auth.accessToken, false);
  return !!(folderId && await findManifest(auth.accessToken, folderId));
}

async function enableLibrary(db, { passphrase, hint = '' }) {
  const auth = await ensureSignedIn({ silent: false });
  const token = auth.accessToken;
  const folderId = await findFolder(token, true);
  const manifestId = await findManifest(token, folderId);
  const idx = { entries: {}, extrasFp: '', folderId, manifestId };
  let dek, header, adopted = false;
  if (manifestId) {
    const manifest = await (await dfetch(token, `/files/${manifestId}?alt=media`)).json();
    dek = await openLibraryKey(passphrase, manifest); // throws wrong_passkey
    header = headerOf(manifest);
    idx.entries = (await openIndex(dek, manifest.index)).entries || {};
    adopted = true;
  } else {
    ({ dek, header } = await newLibraryKey(passphrase, hint));
  }
  await keyPut(dek);
  await metaSet(db, 'lib_header', JSON.stringify(header));
  await saveIndex(db, idx);
  if (!manifestId) { // the passkey wrap reaches Drive before any data does
    await writeManifest(db, token, idx, dek, await libraryExtras(db));
    await saveIndex(db, idx);
  }
  await metaSet(db, 'lib_enabled', 'true');
  nextTryAt = 0;
  setStatus({ state: 'syncing' });
  syncLibrary(db).catch(() => {});
  return { ok: true, adopted };
}

// The key on this phone is gone (storage cleared): the passkey unwraps it again from the manifest.
async function unlockLibrary(db, passphrase) {
  const auth = await ensureSignedIn({ silent: false });
  const folderId = await findFolder(auth.accessToken, false);
  const manifestId = folderId ? await findManifest(auth.accessToken, folderId) : null;
  if (!manifestId) throw new Error('no_library');
  const manifest = await (await dfetch(auth.accessToken, `/files/${manifestId}?alt=media`)).json();
  await keyPut(await openLibraryKey(passphrase, manifest));
  nextTryAt = 0;
  setStatus({ state: 'syncing' });
  syncLibrary(db).catch(() => {});
  return { ok: true };
}

async function disableLibrary(db, { deleteFromDrive = false } = {}) {
  await metaSet(db, 'lib_enabled', 'false');
  await keyDel().catch(() => {});
  if (deleteFromDrive) {
    const auth = await ensureSignedIn({ silent: true });
    if (auth.ok) { const f = await findFolder(auth.accessToken, false); if (f) await trashFile(auth.accessToken, f); }
  }
  await metaDel(db, 'lib_index'); await metaDel(db, 'lib_header');
  setStatus({ state: 'off', pending: 0, lastSyncAt: 0, skipped: 0, detail: '' });
}

// ---------------------------------------------------------------------------
// Restore from the library: append only. The passkey opens the manifest; the key is used here and not kept.
// ---------------------------------------------------------------------------
async function restoreLibrary(db, { passphrase, sourcePin = null, currentPrivateKey = null, onProgress }) {
  const auth = await ensureSignedIn({ silent: false });
  const token = auth.accessToken;
  const folderId = await findFolder(token, false);
  const manifestId = folderId ? await findManifest(token, folderId) : null;
  if (!manifestId) return { ok: false, reason: 'no_library' };
  const manifest = await (await dfetch(token, `/files/${manifestId}?alt=media`)).json();
  let key, payload;
  try { key = await openLibraryKey(passphrase, manifest); payload = await openIndex(key, manifest.index); }
  catch { return { ok: false, reason: 'wrong_passkey' }; }
  const entries = Object.entries(payload.entries || {}).map(([id, e]) => ({ id, ...e }));
  return restoreFromLibrary(db, {
    key, extras: payload.extras || { tags: [], settings: {}, privateVaultWrap: null }, entries,
    fetchObject: async (fid) => (await dfetch(token, `/files/${fid}?alt=media`)).blob(),
    categories: ALL_CATEGORIES, sourcePin, currentPrivateKey, onProgress
  });
}

export {
  startLibraryLoop, kickLibrary, onLibraryStatus, getLibraryStatus, libraryStatusText,
  libraryIsEnabled, libraryExists, enableLibrary, unlockLibrary, disableLibrary, restoreLibrary
};
