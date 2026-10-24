// backup.js — full & selective backup/restore. No network calls; everything reads/writes
// device storage via @capacitor/filesystem and encrypts via crypto.js (AES-GCM/PBKDF2).
//
// Two archive formats, both one `.dz` file:
//   Format 1 (still read; still written by the Drive path): one JSON object, AES-GCM encrypted as a whole by
//   crypto.encryptBackup: { schemaVersion, createdAt, categories, entries, tags, settings }, with entries[].fileData
//   as base64 file bytes. Memory grows with the total data.
//   Format 2 (Decision 159, written by createBackup): line 1 is a plain header {version:2, salt, kdfIterations, hint};
//   every later line is {iv, c}, one AES-GCM call whose additional data is the line number. Order: a head record
//   (categories, tags, settings, sizes), then per entry an entry record followed by its body pieces and file chunks,
//   then an end record with the counts. Memory grows with one chunk, not the total.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { transferInbox, clearInbox } from './widget-inbox.js';
import { initFiles, withKey, readBase64 as readStoredBase64, readBytes as readStoredBytes, fileSize, saveBase64, beginFile, removeFile, beginRawFile, writeRawBase64 } from './files.js';
import { rewrapFileKey, newFilePath } from './filestore.js';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { decryptBackup, deriveAesKey, encryptChunk, decryptChunk, fromBase64, toBase64, BACKUP_KDF_ITERATIONS } from './crypto.js';
import { VAULT_PLACEHOLDER_LABEL } from './db.js';
import { planVaultRestore, applyVaultPlan } from './vaultrestore.js';

const SCHEMA_VERSION = 1;
// Home file bytes live in Directory.Data/files/ as files/<32 hex> (Decision 161), read and written through files.js.
const FORMAT2 = 2;
const KDF_ITERATIONS = BACKUP_KDF_ITERATIONS; // written in the header; restore reads the header's count (Decision 171)
const FILE_CHUNK_BYTES = 3 * 1024 * 1024;  // raw file bytes per encrypted line
const BODY_PIECE_CHARS = 2 * 1024 * 1024;  // characters of an oversized stored body per encrypted line
const INLINE_BODY_CHARS = 1024 * 1024;     // a stored body up to this size stays inside its entry record
const FLUSH_CHARS = 2 * 1024 * 1024;       // buffered text before one append to the backup file
const READ_SLICE_BYTES = 2 * 1024 * 1024;  // bytes read from a backup file per slice
const B64_FACTOR = 1.34;                   // every byte is stored as base64
const ENC_T = new TextEncoder();
const DEC_T = new TextDecoder();

// Categories are independent selectable units. Voice/Images/PDFs/Files exclude private ones —
// EVERY private entry, regardless of underlying type, falls under the one unified private_vault
// category instead (Private Vault pivot — was notes-only "private_notes" before). Tags and App
// Settings have no per-entry rows. Expenses have no private variant (out of vault scope) — Reminders
// used to be the same, but now that Reminder is also one of the eight manual capture cards
// (Decision 57) and therefore vault-capable, it needs the same private-exclusion guard as the rest;
// existing (currently always non-private, auto-detected-only) reminder entries are unaffected.
const ENTRY_CATEGORIES = {
  notes: (e) => e.type === 'note' && !e.is_private,
  voice: (e) => e.type === 'voice' && !e.is_private,
  images: (e) => e.type === 'image' && !e.is_private,
  pdfs: (e) => e.type === 'pdf' && !e.is_private,
  reminders: (e) => e.type === 'reminder' && !e.is_private,
  locations: (e) => e.type === 'location' && !e.is_private,
  money: (e) => e.type === 'money' && !e.is_private,
  files: (e) => e.type === 'file' && !e.is_private,
  expenses: (e) => e.type === 'expense',
  private_vault: (e) => e.is_private === 1 // any type — Text/Voice/Image/PDF/Reminder/Location/Money/Files, unified
};
// Non-vault file-bearing categories only — buildBackupPayload reads file_path for these. Vault
// entries (any type) keep file_path NULL; their bytes already travel inside encrypted_body, which
// every category's row spread already carries, so private_vault needs no entry here. Reminder/
// Location/Money aren't listed — none has a defined content shape yet (Decision 55/56), so nothing
// to read a file_path for.
const FILE_BEARING_CATEGORIES = new Set(['voice', 'images', 'pdfs', 'files']);
const ALL_CATEGORIES = [...Object.keys(ENTRY_CATEGORIES), 'tags', 'app_settings'];

const APP_SETTINGS_KEYS = ['dark_mode', 'currency_symbol', 'pdf_inapp_viewer']; // non-sensitive only — never credential hashes/salts/hints (Decision 8).
// gradient_mode/gradient_color_1/gradient_color_2 removed here (Decision 53 removed the feature
// itself; this list just hadn't been updated to match until now) — any old backup still carrying
// those keys restores them as harmless, unread meta rows, same as explained in app.js.

// ---------------------------------------------------------------------------
// Filenames — backup_ddmmyyyy_hhmmss.dz for every backup, local and Drive (Decision 278). Which categories a file holds is
// in its header, not its name. (Earlier files named backup_<letters>_<yyyymmdd>_<hhmmss>.dz still restore: the name is never read.)
// ---------------------------------------------------------------------------
function backupTimestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}${p(date.getMonth() + 1)}${date.getFullYear()}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

// prefix: always 'backup'. The categories argument is kept for the callers' sake and is not used.
function backupFileName(prefix) {
  return `${prefix}_${backupTimestamp()}.dz`;
}

// ---------------------------------------------------------------------------
// Storage sanity checks — real free space of the phone's data partition, from @capacitor/device
// (`realDiskFree`, Android StatFs). The WebView's navigator.storage.estimate() is not used: it
// reports the WebView's own quota, which says nothing about the phone's free space. Where the
// reading is missing (browser preview, plugin error) the answer is null and callers do not block.
// ---------------------------------------------------------------------------
async function getStorageEstimate() {
  try {
    const { realDiskFree } = await Device.getInfo();
    if (Number.isFinite(realDiskFree) && realDiskFree >= 0) return { availableBytes: realDiskFree };
  } catch { /* fall through to unknown */ }
  return { availableBytes: null }; // unknown — caller should not hard-block on null
}

// ---------------------------------------------------------------------------
// Building a backup payload
// ---------------------------------------------------------------------------
const readFileBase64 = (row) => readStoredBase64(row); // decrypted, base64

async function buildBackupPayload(db, categories) {
  initFiles(db);
  const wantAll = (name) => categories.includes(name);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    categories: [...categories],
    entries: [],
    tags: [],
    settings: {},
    privateVaultWrap: null // set below only if private_vault is included — the PIN-wrapped Vault key (Decision 195)
  };

  const entryCategoryNames = Object.keys(ENTRY_CATEGORIES).filter(wantAll);
  if (entryCategoryNames.length > 0) {
    const rows = (await db.query(`SELECT * FROM entries WHERE deleted_at IS NULL`)).values || [];
    for (const row of rows) {
      const cat = entryCategoryNames.find((c) => ENTRY_CATEGORIES[c](row));
      if (!cat) continue;
      const out = { ...row, _category: cat };
      if (!row.is_private) { // a Vault file keeps its wrapped key and meta: they are all that opens it (Decision 212)
        delete out.encrypted_meta; // derived cache, rebuilt on unlock (Decision 156); not part of the backup format
        delete out.file_key; // a device key wrap; never in a backup (Decision 161)
      }
      if (row.is_private && row.file_path) { // Vault file: the stored (encrypted) bytes travel as they are, under the Vault key's wrap (Decision 212)
        const blob = await readFileBlob(row);
        if (blob) { out.fileData = toBase64(new Uint8Array(await blob.arrayBuffer())); out.rawFile = 1; }
      } else if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
        out.fileData = await readFileBase64(row); // raw bytes travel with the entry, decrypted; the backup passkey is their only key
      }
      const tagRows = (await db.query(
        `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ?`,
        [row.id]
      )).values || [];
      out.tags = tagRows.map((t) => t.name); // entry_tags is a join table, not a column — carried separately
      payload.entries.push(out);
    }
  }

  if (wantAll('private_vault') && payload.entries.some((e) => e._category === 'private_vault')) {
    const cred = (await db.query(`SELECT vault_wrap FROM credentials WHERE id=1`)).values[0];
    payload.privateVaultWrap = cred?.vault_wrap || null; // the old PIN unwraps the source key on append
  }

  if (wantAll('tags')) {
    payload.tags = (await db.query(`SELECT name FROM tags`)).values || [];
  }

  if (wantAll('app_settings')) {
    for (const key of APP_SETTINGS_KEYS) {
      const r = await db.query(`SELECT value FROM meta WHERE key=?`, [key]);
      if (r.values && r.values[0]) payload.settings[key] = r.values[0].value;
    }
  }

  return payload;
}

// Required-space estimate for creating a backup: sum of base64'd file bytes + rough JSON overhead.
async function estimateBackupSize(db, categories) {
  const payload = await buildBackupPayload(db, categories);
  return new Blob([JSON.stringify(payload)]).size;
}


// ---------------------------------------------------------------------------
// Format 2 writer (Decision 159)
// ---------------------------------------------------------------------------
// File as a Blob, never as a base64 string. A plain file (file_key null) comes through the app's own file URL (the
// Decision 154 route); an encrypted file is decrypted in memory, one file at a time. null when the file is missing.
async function readFileBlob(entryRow) {
  const row = await withKey(entryRow);
  if (row.file_key && !row.is_private) { // a Vault file is read as it is stored: its key is not available here
    try { return new Blob([await readStoredBytes(row)]); } catch { return null; }
  }
  try {
    const { uri } = await Filesystem.getUri({ path: row.file_path, directory: Directory.Data });
    const res = await fetch(Capacitor.convertFileSrc(uri));
    if (res.ok) return await res.blob();
  } catch { /* fall back below */ }
  try {
    const r = await Filesystem.readFile({ path: row.file_path, directory: Directory.Data });
    return new Blob([fromBase64(r.data)]);
  } catch { return null; }
}

const statSize = (row) => fileSize(row); // decrypted size; 0 when missing

// Sizes only, no payload: one light query plus a stat per file. requiredBytes is the written file's expected size.
async function planBackup(db, categories) {
  initFiles(db);
  const names = Object.keys(ENTRY_CATEGORIES).filter((c) => categories.includes(c));
  const items = [];
  const sizeByCategory = {};
  let bytes = 0;
  if (names.length > 0) {
    const rows = (await db.query(
      `SELECT id, type, is_private, file_path, file_key,
         COALESCE(LENGTH(encrypted_body),0) + COALESCE(LENGTH(body_text),0) + COALESCE(LENGTH(description),0) +
         COALESCE(LENGTH(encrypted_description),0) + COALESCE(LENGTH(encrypted_label),0) + COALESCE(LENGTH(money_json),0) AS rb
       FROM entries WHERE deleted_at IS NULL`
    )).values || [];
    for (const row of rows) {
      const cat = names.find((c) => ENTRY_CATEGORIES[c](row));
      if (!cat) continue;
      const fileSize = ((FILE_BEARING_CATEGORIES.has(cat) || row.is_private) && row.file_path) ? await statSize(row) : 0;
      const size = 600 + (row.rb || 0) + fileSize;
      items.push({ id: row.id, cat });
      sizeByCategory[cat] = (sizeByCategory[cat] || 0) + size;
      bytes += size;
    }
  }
  return { items, sizeByCategory, requiredBytes: Math.ceil(bytes * B64_FACTOR) + 64 * 1024 };
}

// Tags, settings and the Vault salt: the same three reads buildBackupPayload makes, small by nature.
async function readBackupExtras(db, categories, hasVault) {
  const extras = { tags: [], settings: {}, privateVaultWrap: null };
  if (categories.includes('private_vault') && hasVault) {
    const cred = (await db.query(`SELECT vault_wrap FROM credentials WHERE id=1`)).values[0];
    extras.privateVaultWrap = cred?.vault_wrap || null;
  }
  if (categories.includes('tags')) extras.tags = (await db.query(`SELECT name FROM tags`)).values || [];
  if (categories.includes('app_settings')) {
    for (const key of APP_SETTINGS_KEYS) {
      const r = await db.query(`SELECT value FROM meta WHERE key=?`, [key]);
      if (r.values && r.values[0]) extras.settings[key] = r.values[0].value;
    }
  }
  return extras;
}

// Buffers lines and appends them to one file; abort() removes a half-written file.
function makeSink(path, directory) {
  let parts = [];
  let size = 0;
  let started = false;
  const flush = async () => {
    if (parts.length === 0) return;
    const data = parts.join('');
    parts = []; size = 0;
    if (!started) { await Filesystem.writeFile({ path, directory, data, encoding: 'utf8' }); started = true; }
    else await Filesystem.appendFile({ path, directory, data, encoding: 'utf8' });
  };
  return {
    async push(line) { parts.push(line); size += line.length; if (size >= FLUSH_CHARS) await flush(); },
    async finish() { await flush(); },
    async abort() { try { if (started) await Filesystem.deleteFile({ path, directory }); } catch { /* nothing to remove */ } }
  };
}

// ---------------------------------------------------------------------------
// Backups kept on the phone live in the app's own folder, Android/data/com.arkly.app/files (Decision 278). Android does not
// show that folder in file pickers, so the app lists them itself: restore from one, save a copy to Downloads, or delete.
// Uninstalling the app removes the folder and its backups.
// ---------------------------------------------------------------------------
const PHONE_BACKUP_DIR = Directory.External;
const COPY_DIR = 'Download/Arkly';

async function listPhoneBackups() {
  let files = [];
  try { files = (await Filesystem.readdir({ path: '', directory: PHONE_BACKUP_DIR })).files || []; } catch { return []; }
  return files
    .filter((f) => f.type !== 'directory' && /\.dz$/i.test(f.name))
    .map((f) => ({ name: f.name, size: f.size || 0, mtime: f.mtime || 0 }))
    .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
}

async function deletePhoneBackup(name) {
  await Filesystem.deleteFile({ path: name, directory: PHONE_BACKUP_DIR });
}

// Copies one backup into Download/Arkly; an existing name gets " (2)", " (3)" so nothing is overwritten. Returns the path.
async function savePhoneBackupToDownloads(name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let to = `${COPY_DIR}/${name}`;
  for (let n = 2; n < 100; n++) {
    try { await Filesystem.stat({ path: to, directory: Directory.ExternalStorage }); } catch { break; }
    to = `${COPY_DIR}/${stem} (${n})${ext}`;
  }
  await Filesystem.mkdir({ path: COPY_DIR, directory: Directory.ExternalStorage, recursive: true }).catch(() => {});
  await Filesystem.copy({ from: name, directory: PHONE_BACKUP_DIR, to, toDirectory: Directory.ExternalStorage });
  return to;
}

// A File for the existing restore form. The file is read through the app's local server, so a very large backup is held in
// memory: the caller warns above RESTORE_FROM_LIST_MAX and points to the Downloads copy.
const RESTORE_FROM_LIST_MAX = 300 * 1024 * 1024;
async function getPhoneBackupFile(name) {
  const { uri } = await Filesystem.getUri({ path: name, directory: PHONE_BACKUP_DIR });
  const blob = await (await fetch(Capacitor.convertFileSrc(uri))).blob();
  return new File([blob], name, { type: 'application/octet-stream' });
}

// ---------------------------------------------------------------------------
// Create + write a backup file (format 2)
// ---------------------------------------------------------------------------
// onProgress({ done, total }) after each entry. Peak memory is one entry's row plus one 3 MB chunk (and a Vault entry's
// stored body, which is already one string in the database).
async function createBackup(db, { passphrase, hint = '', categories = ALL_CATEGORIES, fileName, onProgress }) {
  await transferInbox(db).catch(() => 0); // waiting widget captures are Home items before they are counted (Decision 266)
  const plan = await planBackup(db, categories);
  const { availableBytes } = await getStorageEstimate();
  if (availableBytes !== null && plan.requiredBytes > availableBytes) {
    return { ok: false, reason: 'insufficient_storage', requiredBytes: plan.requiredBytes, availableBytes };
  }

  const { key, salt } = await deriveAesKey(passphrase, null, KDF_ITERATIONS);
  const name = fileName || backupFileName('backup', categories);
  const sink = makeSink(name, PHONE_BACKUP_DIR);
  let n = 0, count = 0, files = 0, skippedFiles = 0;
  const put = async (data) => { n += 1; await sink.push(JSON.stringify(await encryptChunk(key, data, n)) + '\n'); };

  try {
    await sink.push(JSON.stringify({ version: FORMAT2, salt, kdfIterations: KDF_ITERATIONS, hint }) + '\n');
    const extras = await readBackupExtras(db, categories, plan.items.some((i) => i.cat === 'private_vault'));
    await put(ENC_T.encode(JSON.stringify({
      t: 'head', schemaVersion: SCHEMA_VERSION, createdAt: Date.now(), categories: [...categories],
      entryCount: plan.items.length, sizeByCategory: plan.sizeByCategory, ...extras
    })));

    for (let i = 0; i < plan.items.length; i++) {
      const it = plan.items[i];
      onProgress?.({ done: i, total: plan.items.length });
      const row = ((await db.query(`SELECT * FROM entries WHERE id=?`, [it.id])).values || [])[0];
      if (!row) continue; // removed since the plan was made
      const out = { ...row, _category: it.cat };
      if (!row.is_private) { // a Vault file keeps its wrapped key and meta: they are all that opens it (Decision 212)
        delete out.encrypted_meta; // derived cache, rebuilt on unlock (Decision 156); not part of the backup format
        delete out.file_key; // a device key wrap; never in a backup (Decision 161)
      }
      const tagRows = (await db.query(
        `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ?`, [row.id]
      )).values || [];
      out.tags = tagRows.map((t) => t.name); // entry_tags is a join table, not a column — carried separately

      let pieces = null;
      if (typeof out.encrypted_body === 'string' && out.encrypted_body.length > INLINE_BODY_CHARS) {
        pieces = [];
        for (let p = 0; p < out.encrypted_body.length; p += BODY_PIECE_CHARS) pieces.push(out.encrypted_body.slice(p, p + BODY_PIECE_CHARS));
        out.encrypted_body = null; // travels as its own lines
      }
      let blob = null;
      if ((FILE_BEARING_CATEGORIES.has(it.cat) || row.is_private) && row.file_path) {
        blob = await readFileBlob(row);
        if (!blob) skippedFiles += 1;
      }
      const nFile = blob ? Math.ceil(blob.size / FILE_CHUNK_BYTES) : 0;

      await put(ENC_T.encode(JSON.stringify({ t: 'entry', entry: out, nBody: pieces ? pieces.length : 0, nFile, hasFile: !!blob })));
      if (pieces) for (const piece of pieces) await put(ENC_T.encode(piece));
      for (let c = 0; c < nFile; c++) {
        await put(await blob.slice(c * FILE_CHUNK_BYTES, (c + 1) * FILE_CHUNK_BYTES).arrayBuffer());
      }
      count += 1;
      if (blob) files += 1;
    }

    await put(ENC_T.encode(JSON.stringify({ t: 'end', entries: count, files, skippedFiles })));
    await sink.finish();
  } catch (err) {
    await sink.abort();
    return { ok: false, reason: 'write_failed', detail: String(err?.message || err) };
  }

  await db.run(`UPDATE credentials SET last_backup_at = ? WHERE id = 1`, [Date.now()]); // single-row table, not meta
  return { ok: true, path: name, requiredBytes: plan.requiredBytes, entries: count, skippedFiles };
}

// ---------------------------------------------------------------------------
// Reading + decrypting a backup file (does not touch the DB)
// ---------------------------------------------------------------------------
async function openBackupFile(path, directory = PHONE_BACKUP_DIR) {
  const res = await Filesystem.readFile({ path, directory, encoding: 'utf8' });
  return JSON.parse(res.data); // the encrypted archive object — hint is readable before decrypt
}

async function decryptBackupPayload(passphrase, archiveObj) {
  const plainBuf = await decryptBackup(passphrase, archiveObj); // throws on wrong passphrase
  const text = new TextDecoder().decode(plainBuf);
  return JSON.parse(text);
}

// Required-space estimate for restoring selected categories out of an already-decrypted payload.
function estimateRestoreSize(payload, categories) {
  const wanted = payload.entries.filter((e) => categories.includes(e._category));
  let bytes = 0;
  for (const e of wanted) {
    const { fileData, ...row } = e;
    if (fileData) bytes += Math.ceil(fileData.length * 0.75); // base64 → raw byte estimate
    bytes += JSON.stringify(row).length; // the database row itself (Vault bytes sit inside it as encrypted text)
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Reading a format 2 file: lines come from File.slice, never the whole file at once
// ---------------------------------------------------------------------------
function joinParts(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function lineReader(file) {
  let pos = 0, buf = new Uint8Array(0), bi = 0;
  return {
    async next() { // next line without its newline, or null at the end
      const parts = [];
      for (;;) {
        if (bi >= buf.length) {
          if (pos >= file.size) return parts.length ? joinParts(parts) : null;
          const end = Math.min(pos + READ_SLICE_BYTES, file.size);
          buf = new Uint8Array(await file.slice(pos, end).arrayBuffer());
          pos = end; bi = 0;
        }
        const nl = buf.indexOf(10, bi);
        if (nl === -1) { parts.push(buf.subarray(bi)); bi = buf.length; continue; }
        parts.push(buf.subarray(bi, nl));
        bi = nl + 1;
        return joinParts(parts);
      }
    }
  };
}

// Plain header of a picked file. Format 2: { version: 2, hint, header }. Format 1: the whole archive object, as before.
async function readBackupHeader(file) {
  const first = await file.slice(0, 16).text();
  if (first.startsWith('{"version":2')) {
    const line = await lineReader(file).next();
    const header = JSON.parse(DEC_T.decode(line));
    return { version: 2, hint: header.hint || '', header };
  }
  const archiveObj = JSON.parse(await file.text());
  return { version: archiveObj.version || 1, hint: archiveObj.hint || '', archiveObj };
}

// Cursor over the encrypted lines; numbering starts at 1 after the header, and the number is the AES-GCM additional data.
function openV2(file, key) {
  const reader = lineReader(file);
  let n = 0;
  const take = async () => {
    const raw = await reader.next();
    if (!raw) return null;
    n += 1;
    return { o: JSON.parse(DEC_T.decode(raw)), n };
  };
  return {
    async skipHeader() { await reader.next(); },
    async nextRecord() { // decrypted JSON record, or null at the end of the file
      const line = await take();
      if (!line) return null;
      return JSON.parse(DEC_T.decode(await decryptChunk(key, line.o.iv, line.o.c, line.n)));
    },
    async nextBytes() { // decrypted bytes of a body piece or file chunk
      const line = await take();
      if (!line) throw new Error('backup ends early');
      return decryptChunk(key, line.o.iv, line.o.c, line.n);
    },
    async skip(count) { // lines of an entry that is not restored: read past, no decryption
      for (let i = 0; i < count; i++) if (!(await take())) throw new Error('backup ends early');
    }
  };
}

// Reads and decrypts every line without restoring anything. Run before an overwrite deletes data.
async function verifyV2(file, key) {
  const cur = openV2(file, key);
  await cur.skipHeader();
  const head = await cur.nextRecord();
  if (!head || head.t !== 'head') return false;
  let seen = 0;
  for (;;) {
    const rec = await cur.nextRecord();
    if (!rec) return false; // no end record: cut short
    if (rec.t === 'end') return rec.entries === seen;
    if (rec.t !== 'entry') return false;
    for (let i = 0; i < rec.nBody + rec.nFile; i++) await cur.nextBytes();
    seen += 1;
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------
// Shared by both formats. null = exact UUID match among live entries, skipped; else the id and label to insert under.
async function planEntryTarget(db, entry, mode, summary) {
  let targetId = entry.id;
  let label = entry.label;
  if (mode === 'append') {
    const existing = (await db.query(`SELECT id FROM entries WHERE id=? AND deleted_at IS NULL`, [entry.id])).values || [];
    if (existing.length > 0) {
      summary.skippedExactDup += 1;
      return null; // caller can offer "restore anyway" as a forced re-run with a fresh UUID
    }
    // Trashed rows are not duplicates (Decision 110). A trashed row still owns the primary key, so the
    // restored copy takes a fresh id; the trashed one stays in Trash untouched.
    const trashedSameId = (await db.query(`SELECT id FROM entries WHERE id=?`, [entry.id])).values || [];
    if (trashedSameId.length > 0) targetId = crypto.randomUUID();
    // Vault labels are placeholders or ciphertext, so a label match means nothing there (Decision 145).
    const labelMatch = entry.is_private ? [] : (await db.query(
      `SELECT id FROM entries WHERE label=? AND id != ? AND deleted_at IS NULL`, [entry.label, entry.id]
    )).values || [];
    if (labelMatch.length > 0) {
      targetId = crypto.randomUUID();
      label = `${entry.label} (Restored)`;
      summary.restoredLabeled += 1;
    }
  }
  return { targetId, label };
}

// Overwrite: remove the selected categories' live rows (their files on disk are left, as before).
// One pass over the entries: each row is read once and removed when it belongs to any selected category.
// (Reading every row once per category stalled Overwrite on its "Replacing" step.) onStep({ done, total }) after each row.
async function wipeCategories(db, categories, onStep) {
  initFiles(db);
  const preds = categories.filter((c) => ENTRY_CATEGORIES[c]).map((c) => ENTRY_CATEGORIES[c]);
  if (!preds.length) return;
  await clearInbox(db); // Overwrite clears waiting widget captures (Decision 266)
  const rows = (await db.query(`SELECT id FROM entries WHERE deleted_at IS NULL`)).values || [];
  let done = 0;
  for (const row of rows) {
    const full = ((await db.query(`SELECT * FROM entries WHERE id=?`, [row.id])).values || [])[0];
    if (full && preds.some((match) => match(full))) {
      await db.run(`DELETE FROM entries_fts WHERE id=?`, [row.id]);
      await db.run(`DELETE FROM entry_tags WHERE entry_id=?`, [row.id]); // cascade not relied on — see db.js
      await db.run(`DELETE FROM entries WHERE id=?`, [row.id]);
      await removeFile(full); // the file goes with its entry (Decision 162)
    }
    done += 1;
    if (onStep) onStep({ done, total: rows.length });
  }
}

// A restored file is written for this device, so file_key starts empty and is set when the file is saved.
// The type stays in entries.extension; a backup that only carried it in the old file name gives it back.
function prepareRestoredFile(entry) {
  if (!entry.is_private) entry.file_key = null; // a Vault file keeps its wrapped key (Decision 212)
  if (!entry.extension && /\.[A-Za-z0-9]+$/.test(entry.file_path || '')) entry.extension = entry.file_path.split('.').pop();
}

// Where a Vault file is written on restore and the key wrapped for it (Decision 212). Same Vault key (overwrite, or the archive's
// key is this device's): the path and wrapped key stay. Another key (append with the source PIN, `opts._vault.kind` rekey): a new
// path, the file key unwrapped with the source key and wrapped under this device's key; the file's bytes are not touched.
async function vaultFileTarget(entry, opts) {
  if (opts._vault?.kind !== 'rekey') return { path: entry.file_path, fileKey: entry.file_key };
  const path = newFilePath();
  return { path, fileKey: await rewrapFileKey(entry.file_key, entry.file_path, path, opts._vault.sourceKey, opts.currentPrivateKey) };
}

// Insert one entry whose file (if any) is already written and whose file_path and file_key are set.
async function insertRestoredEntry(db, entry, targetId, label, opts, summary) {
  let bodyText = entry.body_text;
  let encryptedBody = entry.encrypted_body;
  let encryptedMeta = entry.encrypted_meta || null; // set for a Vault file only: size and OCR text
  let encryptedDescription = entry.encrypted_description || null;
  let encryptedLabel = entry.encrypted_label || null; // a backup from before Decision 145 has none: its plaintext label is encrypted at the next unlock
  if (entry._category === 'private_vault') {
    // Vault fields are bound to the entry id and field name (Decision 257). A field is opened and re-encrypted bound to the id it is
    // stored under when (a) the archive's key is not this device's (append, `rekey`: opened by the source key, so every Vault entry in
    // the live database is under one key, see ARCHITECTURE §4) or (b) the entry takes a new id and the field is bound. An unmarked
    // field under the same key and id is kept as it is; the forced pass at the next unlock binds it.
    const { decryptPrivateNote, encryptPrivateNote, fieldAad, isBoundField } = await import('./crypto.js');
    const rekey = opts._vault?.kind === 'rekey';
    const openKey = rekey ? opts._vault.sourceKey : opts.currentPrivateKey;
    const bind = async (blob, name) => {
      if (!blob) return blob;
      if (!rekey && !(targetId !== entry.id && isBoundField(blob))) return blob;
      if (!openKey) throw new Error('The Vault must be unlocked to restore this entry under a new id.');
      return encryptPrivateNote(opts.currentPrivateKey, await decryptPrivateNote(openKey, blob, fieldAad(entry.id, name)), fieldAad(targetId, name));
    };
    encryptedBody = await bind(entry.encrypted_body, 'body'); // a file on disk has none (Decision 212)
    encryptedMeta = await bind(entry.encrypted_meta, 'meta') || null;
    encryptedDescription = await bind(entry.encrypted_description, 'desc') || null;
    if (entry.encrypted_label) {
      encryptedLabel = await bind(entry.encrypted_label, 'label');
      if (rekey) label = VAULT_PLACEHOLDER_LABEL;
    } else if (rekey) {
      encryptedLabel = await encryptPrivateNote(opts.currentPrivateKey, entry.label, fieldAad(targetId, 'label')); // pre-change backup: encrypt on the way in
      label = VAULT_PLACEHOLDER_LABEL;
    }
    if (!rekey && [encryptedBody, encryptedMeta, encryptedDescription, encryptedLabel].some((f) => f && !isBoundField(f))) {
      try { await db.run(`DELETE FROM meta WHERE key='vault_bound_v2'`); } catch { /* the pass then waits for the next restore */ }
    }
  }

  await db.run(
    `INSERT INTO entries (id, type, label, body_text, is_private, encrypted_body, file_path, file_key, extension,
      auto_category, noise_reduction, latitude, longitude, amount, expense_category, replied,
      fire_at, repeat_rule, snoozed_until, notified, completed_at, description, encrypted_description, encrypted_label, money_json, encrypted_meta, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [targetId, entry.type, label, bodyText, entry.is_private || 0, encryptedBody, entry.file_path, entry.file_key || null,
     entry.extension, entry.auto_category, entry.noise_reduction, entry.latitude, entry.longitude,
     entry.amount, entry.expense_category, entry.replied ?? 1, entry.fire_at, entry.repeat_rule,
     entry.snoozed_until, entry.notified || 0, entry.completed_at || null, entry.description || null, encryptedDescription, encryptedLabel, entry.money_json || null, encryptedMeta,
     entry.created_at || Date.now(), Date.now()]
  );
  // Same rule as insertEntry() in db.js: private/vault entries are excluded from entries_fts
  // and label_history entirely, not just their body — indexing even the label would leak a
  // vault item's existence/title into ordinary, no-PIN search and autocomplete.
  if (!entry.is_private) {
    await db.run(`INSERT INTO entries_fts (id, label, body_text) VALUES (?,?,?)`, [targetId, label, [bodyText, entry.description].filter(Boolean).join(' ')]);
    await db.run(
      `INSERT INTO label_history (type, label) VALUES (?,?)
       ON CONFLICT(type, label) DO UPDATE SET use_count = use_count + 1`,
      [entry.type, label]
    );
  }
  for (const tagName of entry.tags || []) {
    await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [tagName]);
    const tagRow = (await db.query(`SELECT id FROM tags WHERE name = ?`, [tagName])).values[0];
    await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [targetId, tagRow.id]);
  }
  summary.added += 1;
}

async function restoreTagsAndSettings(db, src, categories, summary) {
  if (categories.includes('tags')) {
    for (const t of src.tags || []) {
      await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [t.name]);
      summary.tagsAdded += 1;
    }
  }
  if (categories.includes('app_settings')) {
    for (const [key, value] of Object.entries(src.settings || {})) {
      await db.run(
        `INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [key, value]
      );
    }
    summary.settingsRestored = true;
  }
}

// opts: {
//   passphrase, mode: 'append' | 'overwrite', categories,
//   takeSafetyBackup: bool, confirmedDestructive: bool (required if mode='overwrite' && !takeSafetyBackup),
//   sourcePin: string|null (append, when the archive's Vault key is not this device's: the PIN that was set when it was made),
//   currentPrivateKey: CryptoKey|null (this device's Vault key while unlocked, for re-encrypting),
//   Vault part (Decision 255): a result { ok: false, reason: vault_pin_needed | vault_pin_wrong | vault_locked | vault_not_set_up | vault_old_format }
//   comes back before anything is changed; vault_pin_* carries `vaultWrap` so a typed PIN can be checked.
//   format 1: archiveObj          format 2: file (the picked File) + header (from readBackupHeader) + onProgress({done,total}) + onPhase(text)
// }
async function restoreBackup(db, opts) {
  initFiles(db);
  if (opts.file && opts.header) return restoreFormat2(db, opts);
  const { passphrase, archiveObj, mode, categories, takeSafetyBackup, confirmedDestructive } = opts;

  const payload = await decryptBackupPayload(passphrase, archiveObj); // proves validity before anything destructive

  const plan = await planVaultRestore(db, {
    mode, categories, hasEntries: payload.entries.some((e) => e._category === 'private_vault'),
    wrap: payload.privateVaultWrap, sourcePin: opts.sourcePin, currentKey: opts.currentPrivateKey
  });
  if (!plan.ok) return { ok: false, reason: plan.reason, vaultWrap: plan.wrap };
  opts._vault = plan;

  if (mode === 'overwrite') {
    if (!takeSafetyBackup && !confirmedDestructive) {
      return { ok: false, reason: 'destructive_confirmation_required' };
    }
    if (takeSafetyBackup) {
      const safety = await createBackup(db, { passphrase, categories: ALL_CATEGORIES, hint: 'safety-backup' });
      if (!safety.ok) return { ok: false, reason: 'safety_backup_failed', detail: safety };
    }
  }

  const required = estimateRestoreSize(payload, categories);
  const { availableBytes } = await getStorageEstimate();
  if (availableBytes !== null && required > availableBytes) {
    return { ok: false, reason: 'insufficient_storage', requiredBytes: required, availableBytes };
  }

  const summary = { added: 0, skippedExactDup: 0, restoredLabeled: 0, tagsAdded: 0, settingsRestored: false };

  if (mode === 'overwrite') { await wipeCategories(db, categories); await applyVaultPlan(db, plan, summary); }

  for (const entry of payload.entries.filter((e) => categories.includes(e._category))) {
    const target = await planEntryTarget(db, entry, mode, summary);
    if (!target) continue;
    prepareRestoredFile(entry);
    if (entry.fileData && entry.is_private && entry.rawFile) { // Vault file: written as stored (Decision 212)
      const t = await vaultFileTarget(entry, opts);
      await writeRawBase64(t.path, entry.fileData);
      entry.file_path = t.path;
      entry.file_key = t.fileKey;
    } else if (entry.fileData) {
      const saved = await saveBase64(entry.fileData);
      entry.file_path = saved.path;
      entry.file_key = saved.fileKey;
    }
    await insertRestoredEntry(db, entry, target.targetId, target.label, opts, summary);
  }

  await restoreTagsAndSettings(db, payload, categories, summary);
  return { ok: true, summary };
}

// Format 2: one pass, one entry at a time. Overwrite reads the whole file once first, so a damaged file is found
// before anything is deleted.
async function restoreFormat2(db, opts) {
  initFiles(db);
  const { file, header, passphrase, mode, categories, takeSafetyBackup, confirmedDestructive, onProgress, onPhase } = opts;

  let key, head, cur;
  try {
    ({ key } = await deriveAesKey(passphrase, header.salt, header.kdfIterations));
    cur = openV2(file, key);
    await cur.skipHeader();
    head = await cur.nextRecord(); // fails to decrypt on a wrong passkey: nothing is touched
    if (!head || head.t !== 'head') throw new Error('no head record');
  } catch {
    return { ok: false, reason: 'wrong_passkey_or_damaged_file' };
  }

  const plan = await planVaultRestore(db, {
    mode, categories, hasEntries: (head.sizeByCategory?.private_vault || 0) > 0,
    wrap: head.privateVaultWrap, sourcePin: opts.sourcePin, currentKey: opts.currentPrivateKey
  });
  if (!plan.ok) return { ok: false, reason: plan.reason, vaultWrap: plan.wrap }; // nothing has been touched
  opts._vault = plan;

  if (mode === 'overwrite') {
    if (!takeSafetyBackup && !confirmedDestructive) return { ok: false, reason: 'destructive_confirmation_required' };
    onPhase?.('Checking the backup file…');
    let intact = false;
    try { intact = await verifyV2(file, key); } catch { intact = false; }
    if (!intact) return { ok: false, reason: 'backup_damaged' };
    if (takeSafetyBackup) {
      const safety = await createBackup(db, {
        passphrase, categories: ALL_CATEGORIES, hint: 'safety-backup',
        onProgress: ({ done, total }) => onPhase?.(`Saving a safety backup, ${done + 1} of ${total}…`)
      });
      if (!safety.ok) return { ok: false, reason: 'safety_backup_failed', detail: safety };
    }
  }

  const required = categories.filter((c) => ENTRY_CATEGORIES[c]).reduce((a, c) => a + (head.sizeByCategory?.[c] || 0), 0);
  const { availableBytes } = await getStorageEstimate();
  if (availableBytes !== null && required > availableBytes) {
    return { ok: false, reason: 'insufficient_storage', requiredBytes: required, availableBytes };
  }

  const summary = { added: 0, skippedExactDup: 0, restoredLabeled: 0, tagsAdded: 0, settingsRestored: false };
  if (mode === 'overwrite') {
    onPhase?.('Replacing current data…');
    await wipeCategories(db, categories, ({ done, total }) => onPhase?.(`Replacing current data, ${done} of ${total}…`));
    await applyVaultPlan(db, plan, summary);
  }

  let seen = 0;
  let end = null;
  try {
    for (;;) {
      const rec = await cur.nextRecord();
      if (!rec) break;
      if (rec.t === 'end') { end = rec; break; }
      if (rec.t !== 'entry') throw new Error('unexpected record');
      const entry = rec.entry;
      const lines = rec.nBody + rec.nFile;
      seen += 1;
      onProgress?.({ done: seen, total: head.entryCount || seen });
      if (!categories.includes(entry._category)) { await cur.skip(lines); continue; }
      const target = await planEntryTarget(db, entry, mode, summary);
      if (!target) { await cur.skip(lines); continue; }

      if (rec.nBody > 0) {
        let body = '';
        for (let i = 0; i < rec.nBody; i++) body += DEC_T.decode(await cur.nextBytes());
        entry.encrypted_body = body;
      }
      prepareRestoredFile(entry);
      if (rec.hasFile && entry.is_private) { // Vault file: written as stored, its key re-wrapped when the Vault key differs (Decision 212)
        const t = await vaultFileTarget(entry, opts);
        const w = await beginRawFile(t.path);
        try {
          for (let c = 0; c < rec.nFile; c++) await w.append(await cur.nextBytes());
          await w.finish();
          entry.file_path = t.path;
          entry.file_key = t.fileKey;
        } catch (err) { await w.abort(); throw err; }
      } else if (rec.hasFile) {
        const w = await beginFile(); // encrypted for this device as it streams in
        try {
          for (let c = 0; c < rec.nFile; c++) await w.append(await cur.nextBytes());
          const saved = await w.finish();
          entry.file_path = saved.path;
          entry.file_key = saved.fileKey;
        } catch (err) { await w.abort(); throw err; }
      }
      await insertRestoredEntry(db, entry, target.targetId, target.label, opts, summary);
    }
  } catch (err) {
    return { ok: false, reason: 'backup_damaged', detail: String(err?.message || err), summary };
  }
  if (!end || end.entries !== seen) return { ok: false, reason: 'backup_incomplete', summary };

  await restoreTagsAndSettings(db, head, categories, summary);
  return { ok: true, summary };
}

// ---------------------------------------------------------------------------
// Extract to device storage — no DB import, raw files + sidecar only.
// ---------------------------------------------------------------------------
async function extractCategoryToStorage(payload, category, destDir = 'Download/Arkly-Restore') {
  const entries = payload.entries.filter((e) => e._category === category && e.fileData);
  const written = [];
  for (const e of entries) {
    const ext = e.extension || (e.file_path || '').split('.').pop() || 'bin';
    const fileName = `${destDir}/${e.id}.${ext}`;
    await Filesystem.writeFile({ path: fileName, directory: Directory.ExternalStorage, data: e.fileData, recursive: true });
    const sidecar = { id: e.id, label: e.label, type: e.type, tags: e.tags || [], created_at: e.created_at, category };
    await Filesystem.writeFile({
      path: `${destDir}/${e.id}.json`, directory: Directory.ExternalStorage,
      data: JSON.stringify(sidecar), encoding: 'utf8'
    });
    written.push(fileName);
  }
  return written;
}

export {
  ALL_CATEGORIES, ENTRY_CATEGORIES, FILE_BEARING_CATEGORIES,
  buildBackupPayload, estimateBackupSize, createBackup,
  listPhoneBackups, deletePhoneBackup, savePhoneBackupToDownloads, getPhoneBackupFile, RESTORE_FROM_LIST_MAX,
  openBackupFile, readBackupHeader, decryptBackupPayload, estimateRestoreSize, restoreBackup,
  extractCategoryToStorage, getStorageEstimate, backupFileName
};
