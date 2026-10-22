// vault.js — Private Vault: Text/Voice/Image/PDF/Reminder/Location/Money/Files, all under is_private=1, all under the
// vault's own PIN (independent of the app-open password and the backup passkey — three credentials,
// still independent, per ARCHITECTURE.md §3). Nothing here ever writes decrypted bytes back to disk;
// file content only ever exists in memory (a Blob URL, revoked when the caller is done with it).
//
// Reuses crypto.js's existing encryptPrivateNote/decryptPrivateNote unchanged — a note's plaintext
// is still just its text (so pre-vault private notes need zero migration); a file-bearing vault
// entry's plaintext is a small JSON envelope instead. Same key, same AES-GCM call, same everything —
// only what gets encrypted differs by type.

import { insertEntry, VAULT_PLACEHOLDER_LABEL } from './db.js';
import { encryptPrivateNote, decryptPrivateNote, fieldAad, isBoundField } from './crypto.js';
import * as Money from './money.js';
import { initFiles, saveVaultBase64, readVaultBase64, vaultFileSize, removeFile, writeText, readText, removePath, listPaths } from './files.js';

const VAULT_TYPES = ['note', 'voice', 'image', 'pdf', 'reminder', 'location', 'money', 'file']; // mirrors the Home capture cards, in card order

// ---------------------------------------------------------------------------
// Content bundling — what actually goes inside encrypted_body, by type.
// ---------------------------------------------------------------------------
// Location content: { latitude, longitude } as JSON (Decision 142). null when missing or out of range.
function validLocation(loc) {
  const ok = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
  return loc && ok(loc.latitude, 90) && ok(loc.longitude, 180) ? { latitude: loc.latitude, longitude: loc.longitude } : null;
}

function buildVaultPlaintext(type, { text, fileData, ocrText, money, location } = {}) {
  // 'money' is the Money details JSON (money.js toJson), checked here so a bad object never gets encrypted.
  // 'reminder' keeps its note in encrypted_description; its body is empty (Decision 140).
  if (type === 'money') {
    const r = Money.normalize(money);
    if (!r.ok) throw new Error(r.error);
    return Money.toJson(r.value);
  }
  if (type === 'location') {
    const v = validLocation(location);
    if (!v) throw new Error('Location needs a latitude within ±90 and a longitude within ±180.');
    return JSON.stringify(v);
  }
  if (type === 'note' || type === 'reminder') return text || '';
  if (type === 'voice' || type === 'file') return JSON.stringify({ fileData });
  if (type === 'image' || type === 'pdf') return JSON.stringify({ fileData, ocrText: ocrText || '' });
  throw new Error(`Type not supported in Private Vault: ${type}`);
}

function parseVaultPlaintext(type, plaintext) {
  if (type === 'money') return { money: Money.fromJson(plaintext) }; // null when unreadable
  if (type === 'location') { // null when unreadable
    try { return { location: validLocation(JSON.parse(plaintext)) }; } catch { return { location: null }; }
  }
  if (type === 'note' || type === 'reminder') return { text: plaintext };
  return JSON.parse(plaintext); // {fileData} or {fileData, ocrText}
}

// ---------------------------------------------------------------------------
// Save — text types keep their content in encrypted_body. File types (voice, image, pdf, file) keep it on disk in the Home
// format, the file key wrapped under the Vault key (Decision 212): file_path and file_key set, encrypted_body NULL, size and
// OCR text in encrypted_meta. Rows from before that decision keep their bytes in encrypted_body and are still read.
// ---------------------------------------------------------------------------
async function saveVaultEntry(db, privateSessionKey, { type, label, tags = [], description = '', extension = null, autoCategory = null, fireAt = null, repeatRule = null, ...content }) {
  if (!VAULT_TYPES.includes(type)) throw new Error(`Type not supported in Private Vault: ${type}`);
  const onDisk = VAULT_FILE_TYPES.includes(type);
  let file = null; // { path, fileKey }
  if (onDisk) {
    initFiles(db);
    if (content.storedFile) file = content.storedFile; // a Home file whose key Move has re-wrapped: no bytes written
    else if (content.fileData) file = await saveVaultBase64(privateSessionKey, content.fileData);
    else throw new Error('This entry has no file.');
  }
  const id = crypto.randomUUID(); // before any field is encrypted: each is bound to it (Decision 257)
  const encryptedBody = onDisk ? null : await encryptPrivateNote(privateSessionKey, buildVaultPlaintext(type, content), fieldAad(id, 'body'));

  // insertEntry() already skips entries_fts/label_history for is_private=1 (db.js) — that's the
  // point: a vault item's existence/label must never surface in ordinary, no-PIN search or
  // autocomplete. Vault's own search/autocomplete comes from the in-memory index below instead.
  try {
  await insertEntry(db, {
    id, type, label: VAULT_PLACEHOLDER_LABEL, body_text: null, is_private: 1, encrypted_body: encryptedBody,
    encrypted_label: await encryptPrivateNote(privateSessionKey, label, fieldAad(id, 'label')), // Decision 145: the label is encrypted like the body
    file_path: file ? file.path : null, file_key: file ? file.fileKey : null, extension, auto_category: autoCategory,
    fire_at: fireAt, repeat_rule: repeatRule, // reminders: schedule columns are plaintext, the notification needs them while locked (Decision 140)
    // Description is encrypted like the body: label is the only plaintext a Vault row carries.
    encrypted_description: description ? await encryptPrivateNote(privateSessionKey, description, fieldAad(id, 'desc')) : null
  });
  if (file) await writeFileMeta(db, privateSessionKey, id, { file_path: file.path, file_key: file.fileKey }, content.ocrText || '');
  } catch (err) {
    if (file && !content.storedFile) await removeFile({ file_path: file.path }); // nothing points at it
    throw err;
  }

  for (const tagName of tags.slice(0, 2)) { // MAX_TAGS (Decision 90)
    await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [tagName]);
    const tagRow = (await db.query(`SELECT id FROM tags WHERE name=?`, [tagName])).values[0];
    await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [id, tagRow.id]);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Labels (Decision 145). A Vault row stores a placeholder in `label` and the real label in `encrypted_label`.
// Rows from before this change carry a plaintext label until the next unlock rewrites them.
// ---------------------------------------------------------------------------
const UNREADABLE_LABEL = 'Unreadable item';

async function vaultRowLabel(privateSessionKey, row) {
  if (!row.encrypted_label) return row.label; // not migrated yet
  try { return await decryptPrivateNote(privateSessionKey, row.encrypted_label, fieldAad(row.id, 'label')); } catch { return UNREADABLE_LABEL; }
}

// Encrypts every Vault label still in plaintext, trashed rows included. Safe to repeat or to be cut short.
async function migrateVaultLabels(db, privateSessionKey) {
  const rows = (await db.query(`SELECT id, label FROM entries WHERE is_private=1 AND encrypted_label IS NULL`)).values || [];
  for (const row of rows) {
    const enc = await encryptPrivateNote(privateSessionKey, row.label, fieldAad(row.id, 'label'));
    await db.run(`UPDATE entries SET encrypted_label=?, label=? WHERE id=? AND encrypted_label IS NULL`, [enc, VAULT_PLACEHOLDER_LABEL, row.id]);
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Load — decrypt on demand, never cache decrypted content beyond the in-memory index below.
// ---------------------------------------------------------------------------
async function loadVaultEntryContent(db, privateSessionKey, entryId, { withFile = true } = {}) {
  const row = (await db.query(`SELECT * FROM entries WHERE id=? AND is_private=1`, [entryId])).values[0];
  if (!row) throw new Error('Vault entry not found');
  if (row.file_path && VAULT_FILE_TYPES.includes(row.type)) { // on disk (Decision 212); withFile false skips reading the bytes
    initFiles(db);
    const meta = await fileEntryMeta(db, privateSessionKey, { ...row, body_len: 0 });
    const fileData = withFile ? await readVaultBase64(privateSessionKey, row) : null;
    return { row: { ...row, label: await vaultRowLabel(privateSessionKey, row) }, content: { fileData, ocrText: (meta && meta.o) || '' } };
  }
  const plaintext = await decryptPrivateNote(privateSessionKey, row.encrypted_body, fieldAad(row.id, 'body'));
  return { row: { ...row, label: await vaultRowLabel(privateSessionKey, row) }, content: parseVaultPlaintext(row.type, plaintext) };
}

// Edit of a file entry's content (Decision 212): a new file replaces the stored one (the old file is removed after the row
// points at the new one); OCR text alone only rewrites the meta.
async function updateVaultFileContent(db, privateSessionKey, entryId, { fileData, ocrText }) {
  initFiles(db);
  const row = (await db.query(`SELECT * FROM entries WHERE id=? AND is_private=1`, [entryId])).values[0];
  if (!row) throw new Error('Vault entry not found');
  const meta = await fileEntryMeta(db, privateSessionKey, row);
  const ocr = ocrText !== undefined ? ocrText : (meta && meta.o) || '';
  if (fileData === undefined) { await writeFileMeta(db, privateSessionKey, entryId, row, ocr); await db.run(`UPDATE entries SET updated_at=? WHERE id=?`, [Date.now(), entryId]); return; }
  const saved = await saveVaultBase64(privateSessionKey, fileData);
  try {
    await db.run(`UPDATE entries SET file_path=?, file_key=?, updated_at=? WHERE id=?`, [saved.path, saved.fileKey, Date.now(), entryId]);
    await writeFileMeta(db, privateSessionKey, entryId, { file_path: saved.path, file_key: saved.fileKey }, ocr);
  } catch (err) { await removeFile({ file_path: saved.path }); throw err; }
  await removeFile(row);
}

// Caller must URL.revokeObjectURL() the result when done — this Blob only ever exists in memory.
function base64ToBlobUrl(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

// Search text for a Money entry. Memory only, like the rest of the index: the plaintext label is generic.
function moneySearchText(d) {
  return [Money.summary(d), d.person, d.category, d.method, ...(d.repayments || []).flatMap((r) => [r.method, r.note])]
    .filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// In-memory index — built on unlock, updated per entry afterwards, dropped on lock. Persisted only as two blobs encrypted
// under the Vault key (Decision 253): the index (labels, descriptions, sizes, Money and Location details) and the text of notes
// and file OCR. Rows stay the source of truth: an entry whose stored fingerprint differs from its row is rebuilt from the row.
// Also powers: vault-only label autocomplete (deliberately not the shared label_history table,
// which would leak vault labels into the main app's non-vault suggestions) and per-item size for
// the multi-select screen.
// ---------------------------------------------------------------------------
let vaultIndexCache = null;

// One index entry from one database row (decrypts under the Vault key). `rid` is the row's rowid: it keeps
// the cache in database order when one entry is added back, so a per-entry update lists like a full rebuild.
const VAULT_FILE_TYPES = ['voice', 'image', 'pdf', 'file']; // the types whose body holds file bytes (Decision 156)

// Index rows leave the file bytes out: file types return NULL for encrypted_body plus its length, so the bridge never
// carries a file just to list it. Small types (text, money, location, reminder) still return their body.
const VAULT_INDEX_SQL = `SELECT rowid AS rid, id, type, label, file_path, file_key, encrypted_label, encrypted_description, extension, created_at,
  fire_at, repeat_rule, completed_at, snoozed_until, is_private, deleted_at, encrypted_meta, LENGTH(encrypted_body) AS body_len,
  CASE WHEN type IN ('voice','image','pdf','file') THEN NULL ELSE encrypted_body END AS encrypted_body
  FROM entries`;

// Persisted index (Decision 253). Fingerprint of a row's encrypted fields: the last 20 characters of each stored value, which hold
// the random IV of its AES-GCM call, so any re-encryption changes it. The same string is made in SQL (no bodies cross the
// bridge) and in JS (rowFp); the two must stay equal.
const INDEX_BLOB_KEY = 'vault_index_blob', TEXT_BLOB_KEY = 'vault_text_blob'; // meta rows; not in APP_SETTINGS_KEYS, so never in a backup
const FP_TAIL = 20, SAVE_DELAY_MS = 1500, REBUILD_BULK_MIN = 50, NOTICE_MIN = 10;
const FP_SQL = `substr(CAST(IFNULL(encrypted_label,'') AS TEXT),-${FP_TAIL}) || '|' || substr(CAST(IFNULL(encrypted_description,'') AS TEXT),-${FP_TAIL}) || '|' ||
  CASE WHEN type IN ('voice','image','pdf','file') THEN substr(CAST(IFNULL(encrypted_meta,'') AS TEXT),-${FP_TAIL}) ELSE substr(CAST(IFNULL(encrypted_body,'') AS TEXT),-${FP_TAIL}) END`;
const VAULT_LIGHT_SQL = `SELECT rowid AS rid, id, type, extension, file_path, created_at, fire_at, repeat_rule, completed_at, snoozed_until, deleted_at, ${FP_SQL} AS fp FROM entries`;
const tail = (v) => String(v ?? '').slice(-FP_TAIL);
const labelFp = (row) => tail(row.encrypted_label); // the Vault Trash list has no other encrypted column
function rowFp(row) {
  return `${tail(row.encrypted_label)}|${tail(row.encrypted_description)}|${tail(VAULT_FILE_TYPES.includes(row.type) ? row.encrypted_meta : row.encrypted_body)}`;
}

let indexKey = null, indexDb = null;       // the Vault key and database the blobs are written with; cleared on lock
let vaultTexts = new Map();                // id -> { fp, t }: note text and file OCR text, filled lazily
let textsLoaded = false, textsLoading = null;
let trashLabels = new Map();               // id -> { fp, l }: labels of trashed Vault rows, so the Vault Trash lists without decrypting
let indexDirty = false, textsDirty = false, saveTimer = null, writeChain = Promise.resolve();

const blobAad = (metaKey) => `blob|${metaKey}`; // the two index blobs are bound to their meta key (Decision 257)
async function readBlob(db, key, metaKey) {
  try {
    const r = ((await db.query(`SELECT value FROM meta WHERE key=?`, [metaKey])).values || [])[0];
    if (!r || !r.value) return null;
    const b = JSON.parse(await decryptPrivateNote(key, r.value, blobAad(metaKey)));
    return b && b.v === 1 ? b : null;
  } catch { return null; } // missing, wrong key or damaged: rebuilt from the rows
}
function writeBlob(db, key, metaKey, json) { // serialised: the last write wins, none overlaps
  writeChain = writeChain.then(async () => {
    try {
      await db.run(`INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [metaKey, await encryptPrivateNote(key, json, blobAad(metaKey))]);
    } catch { /* the blob is a cache; the next unlock rebuilds it */ }
  });
  return writeChain;
}
function indexBlobJson() {
  const e = {}, t = {};
  for (const x of vaultIndexCache || []) e[x.id] = { fp: x.fp, l: x.label, d: x.description || '', s: x.sizeBytes || 0, m: x.money || undefined, loc: x.location || undefined };
  for (const [id, v] of trashLabels) t[id] = v;
  return JSON.stringify({ v: 1, e, t });
}
function textBlobJson() {
  const e = {};
  for (const [id, v] of vaultTexts) e[id] = v.t ? { fp: v.fp, t: v.t } : { fp: v.fp };
  return JSON.stringify({ v: 1, e });
}
function scheduleSave() {
  if (!indexKey || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flushBlobs(); }, SAVE_DELAY_MS);
}
function flushBlobs() { // serialises now, so a lock right after cannot lose a change; encryption and the write finish after
  if (!indexKey || !indexDb) return;
  if (indexDirty && vaultIndexCache) { indexDirty = false; writeBlob(indexDb, indexKey, INDEX_BLOB_KEY, indexBlobJson()); }
  if (textsDirty && textsLoaded) { textsDirty = false; writeBlob(indexDb, indexKey, TEXT_BLOB_KEY, textBlobJson()); }
}
function markIndexDirty() { indexDirty = true; scheduleSave(); }

// Size and OCR text of a file entry without decrypting the file. Valid only while it decrypts under the current key and
// its recorded body length still matches; otherwise it is rebuilt from the body and written back. Never throws.
// A file on disk (Decision 212) keeps { v: 2, s: size, o: OCR text } in encrypted_meta; a missing or unreadable one is rebuilt
// with the size and no OCR text.
async function writeFileMeta(db, key, id, row, ocrText) {
  const meta = { v: 2, s: await vaultFileSize(key, row), o: ocrText || '' };
  await db.run(`UPDATE entries SET encrypted_meta=? WHERE id=?`, [await encryptPrivateNote(key, JSON.stringify(meta), fieldAad(id, 'meta')), id]);
  return meta;
}
async function fileEntryMeta(db, privateSessionKey, row) {
  if (row.file_path) {
    if (row.encrypted_meta) { // never rewritten when it fails to open: it holds the OCR text and a wrong key must not replace it
      try { const m = JSON.parse(await decryptPrivateNote(privateSessionKey, row.encrypted_meta, fieldAad(row.id, 'meta'))); if (m && m.v === 2) return m; } catch { /* unreadable */ }
      return null;
    }
    try { initFiles(db); return await writeFileMeta(db, privateSessionKey, row.id, row, ''); } catch { return null; } // no meta yet: made now; missing file: listed, no size
  }
  if (row.encrypted_meta) {
    try {
      const m = JSON.parse(await decryptPrivateNote(privateSessionKey, row.encrypted_meta, fieldAad(row.id, 'meta')));
      if (m && m.v === 1 && m.bl === row.body_len) return m;
    } catch { /* wrong key or damaged: rebuild below */ }
  }
  try {
    const full = ((await db.query(`SELECT encrypted_body FROM entries WHERE id=?`, [row.id])).values || [])[0];
    const content = parseVaultPlaintext(row.type, await decryptPrivateNote(privateSessionKey, full.encrypted_body, fieldAad(row.id, 'body')));
    const meta = { v: 1, bl: row.body_len, o: content.ocrText || '', s: content.fileData ? Math.ceil(content.fileData.length * 0.75) : 0 }; // base64 → raw byte estimate
    try {
      await db.run(`UPDATE entries SET encrypted_meta=? WHERE id=?`, [await encryptPrivateNote(privateSessionKey, JSON.stringify(meta), fieldAad(row.id, 'meta')), row.id]);
    } catch { /* the index still works without the cache */ }
    return meta;
  } catch {
    return null; // corrupted or undecryptable entry: still listed (so it can be deleted), just not searchable
  }
}

// Field binding (Decision 257). A field with no mark is re-encrypted bound to its row id and field name; the row keeps its
// timestamps. A file row's body is not in this read and stays as it is until the entry is edited. A field that does not open
// is left untouched. Returns the row as it now stands, so its fingerprint is taken from the new values.
const BOUND_FLAG_KEY = 'vault_bound_v2'; // meta row: the forced pass at unlock has run; not in APP_SETTINGS_KEYS, so never in a backup
const BOUND_FIELDS = [['encrypted_label', 'label'], ['encrypted_description', 'desc'], ['encrypted_meta', 'meta'], ['encrypted_body', 'body']];
async function upgradeRow(db, key, row) {
  const set = {};
  for (const [col, name] of BOUND_FIELDS) {
    const v = row[col];
    if (!v || isBoundField(v) || (col === 'encrypted_body' && VAULT_FILE_TYPES.includes(row.type))) continue;
    try { set[col] = await encryptPrivateNote(key, await decryptPrivateNote(key, v), fieldAad(row.id, name)); } catch { /* unreadable: left as it is */ }
  }
  const cols = Object.keys(set);
  if (!cols.length) return row;
  try {
    await db.run(`UPDATE entries SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, [...cols.map((c) => set[c]), row.id]);
  } catch { return row; }
  return { ...row, ...set };
}

// One index entry from a full row (VAULT_INDEX_SQL). Notes and file OCR text go to `vaultTexts`, not into the entry (Decision 253).
async function indexEntryFromRow(db, privateSessionKey, row, tagsByEntry = null) {
  row = await upgradeRow(db, privateSessionKey, row);
  const tags = tagsByEntry ? (tagsByEntry.get(row.id) || []) : ((await db.query(
    `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id=t.id WHERE et.entry_id=?`, [row.id]
  )).values || []).map((t) => t.name);
  let text = '', sizeBytes = 0, description = '', money = null, location = null;
  const label = await vaultRowLabel(privateSessionKey, row);
  try {
    if (row.encrypted_description) description = await decryptPrivateNote(privateSessionKey, row.encrypted_description, fieldAad(row.id, 'desc'));
  } catch { description = ''; }
  const isFile = VAULT_FILE_TYPES.includes(row.type);
  let fp = rowFp(row);
  if (isFile) {
    const meta = await fileEntryMeta(db, privateSessionKey, row);
    if (meta) { text = meta.o || ''; sizeBytes = meta.s || 0; }
    if (!row.encrypted_meta) { // the meta was just made: the fingerprint is read again, as the row now holds it
      try { fp = ((await db.query(`SELECT ${FP_SQL} AS fp FROM entries WHERE id=?`, [row.id])).values || [])[0]?.fp ?? fp; } catch { /* a later unlock rebuilds this entry once */ }
    }
  } else {
    try {
      const plaintext = await decryptPrivateNote(privateSessionKey, row.encrypted_body, fieldAad(row.id, 'body'));
      if (row.type === 'note') {
        text = plaintext;
        sizeBytes = new Blob([plaintext]).size;
      } else if (row.type === 'money') {
        money = parseVaultPlaintext('money', plaintext).money;
        sizeBytes = new Blob([plaintext]).size;
      } else if (row.type === 'location') {
        location = parseVaultPlaintext('location', plaintext).location;
        sizeBytes = new Blob([plaintext]).size;
      }
    } catch {
      text = ''; // corrupted/undecryptable entry: still listed, just not searchable
    }
  }
  if (row.type === 'note' || isFile) vaultTexts.set(row.id, { fp, t: text });
  return { id: row.id, rid: row.rid, type: row.type, label, extension: row.extension || null, filePath: row.file_path || null, tags, description, sizeBytes, money, location, createdAt: row.created_at,
    fire_at: row.fire_at, repeat_rule: row.repeat_rule, completed_at: row.completed_at, snoozed_until: row.snoozed_until, fp };
}

// An entry from the stored index and the light row: no decryption. The schedule columns always come from the row, as a
// notification action can change them while the Vault is locked.
function indexEntryFromCache(row, c, tags) {
  return { id: row.id, rid: row.rid, type: row.type, label: c.l, extension: row.extension || null, filePath: row.file_path || null, tags, description: c.d || '', sizeBytes: c.s || 0,
    money: c.m || null, location: c.loc || null, createdAt: row.created_at,
    fire_at: row.fire_at, repeat_rule: row.repeat_rule, completed_at: row.completed_at, snoozed_until: row.snoozed_until, fp: row.fp };
}

// Build on unlock (and after a restore or a reminder change that names no entry). Also runs the label migration.
// Reads the light rows (no bodies), then the stored index: an entry whose fingerprint matches is taken from it, any other is rebuilt
// from its row (Decision 253). Rows are the truth; a missing, unreadable or stale index only costs the rebuild.
// onProgress({ done, total }) is called only while NOTICE_MIN or more entries are being rebuilt, so the caller can say so.
async function buildVaultIndex(db, privateSessionKey, onProgress = null) {
  await migrateVaultLabels(db, privateSessionKey);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  indexKey = privateSessionKey; indexDb = db;
  vaultTexts = new Map(); textsLoaded = false; textsLoading = null; textsDirty = false;
  const rows = (await db.query(`${VAULT_LIGHT_SQL} WHERE is_private=1 ORDER BY rowid`)).values || [];
  const live = rows.filter((r) => !r.deleted_at), trashed = rows.filter((r) => r.deleted_at);
  const tagsByEntry = new Map();
  const tagRows = (await db.query(
    `SELECT et.entry_id AS entry_id, t.name AS name FROM entry_tags et JOIN tags t ON t.id=et.tag_id
     WHERE et.entry_id IN (SELECT id FROM entries WHERE is_private=1 AND deleted_at IS NULL)`
  )).values || [];
  for (const t of tagRows) {
    if (!tagsByEntry.has(t.entry_id)) tagsByEntry.set(t.entry_id, []);
    tagsByEntry.get(t.entry_id).push(t.name);
  }
  const stored = await readBlob(db, privateSessionKey, INDEX_BLOB_KEY);
  const cached = (stored && stored.e) || {}, cachedTrash = (stored && stored.t) || {};
  const boundDone = ((await db.query(`SELECT value FROM meta WHERE key=?`, [BOUND_FLAG_KEY])).values || [])[0]?.value === '1';
  const stale = live.filter((r) => !boundDone || !(cached[r.id] && cached[r.id].fp === r.fp)); // until the forced pass has run, every entry is rebuilt (and bound) once
  const staleIds = new Set(stale.map((r) => r.id));
  let full = null; // one bulk read when many entries are rebuilt, one read each otherwise
  if (stale.length > REBUILD_BULK_MIN) full = new Map(((await db.query(`${VAULT_INDEX_SQL} WHERE is_private=1 AND deleted_at IS NULL`)).values || []).map((r) => [r.id, r]));
  const total = onProgress && stale.length >= NOTICE_MIN ? stale.length : 0;
  let done = 0;
  if (total) onProgress({ done, total });
  const index = [];
  for (const r of live) {
    if (!staleIds.has(r.id)) { index.push(indexEntryFromCache(r, cached[r.id], tagsByEntry.get(r.id) || [])); continue; }
    const row = full ? full.get(r.id) : ((await db.query(`${VAULT_INDEX_SQL} WHERE id=?`, [r.id])).values || [])[0];
    if (!row) continue; // removed since the light read
    index.push(await indexEntryFromRow(db, privateSessionKey, row, tagsByEntry));
    if (total) onProgress({ done: ++done, total });
  }
  const labels = new Map();
  let trashChanged = Object.keys(cachedTrash).length !== trashed.length;
  for (const r of trashed) {
    const c = cachedTrash[r.id];
    let lfp = r.fp.split('|')[0];
    if (!boundDone) { // a trashed row is bound too
      const fr = ((await db.query(`${VAULT_INDEX_SQL} WHERE id=?`, [r.id])).values || [])[0];
      if (fr) lfp = labelFp(await upgradeRow(db, privateSessionKey, fr));
    }
    if (c && c.fp === lfp) { labels.set(r.id, c); continue; }
    trashChanged = true;
    const row = ((await db.query(`SELECT id, label, encrypted_label FROM entries WHERE id=?`, [r.id])).values || [])[0];
    if (row) labels.set(r.id, { fp: lfp, l: await vaultRowLabel(privateSessionKey, row) });
  }
  trashLabels = labels;
  vaultIndexCache = index;
  if (!boundDone) { try { await db.run(`INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [BOUND_FLAG_KEY, '1']); } catch { /* the pass runs again at the next unlock */ } }
  const liveIds = new Set(live.map((r) => r.id));
  if (!stored || stale.length || trashChanged || Object.keys(cached).some((id) => !liveIds.has(id))) markIndexDirty();
  return index;
}

// Pure cache edits (no database): replace the entry with the same id, or insert it at its rowid position.
function upsertIndexEntry(index, entry) {
  const at = index.findIndex((e) => e.id === entry.id);
  if (at >= 0) { index[at] = entry; return index; }
  let pos = index.length;
  while (pos > 0 && (index[pos - 1].rid ?? 0) > (entry.rid ?? 0)) pos--;
  index.splice(pos, 0, entry);
  return index;
}
function removeIndexEntry(index, id) {
  const at = index.findIndex((e) => e.id === id);
  if (at >= 0) index.splice(at, 1);
  if (vaultTexts.delete(id)) textsDirty = true;
  return index;
}

// Per-entry update after add, edit, trash, restore or delete: reads only the named rows. A row that is now
// a live Vault row is added or replaced; anything else (trashed, deleted, not a Vault row) is removed.
// No index yet (the Vault was never built this unlock) falls back to a full build.
async function refreshVaultIndexEntries(db, privateSessionKey, ids) {
  if (!vaultIndexCache) return buildVaultIndex(db, privateSessionKey);
  for (const id of ids) {
    const row = ((await db.query(`${VAULT_INDEX_SQL} WHERE id=?`, [id])).values || [])[0];
    const before = vaultIndexCache.find((e) => e.id === id);
    if (row && row.is_private === 1 && !row.deleted_at) {
      upsertIndexEntry(vaultIndexCache, await indexEntryFromRow(db, privateSessionKey, row));
      trashLabels.delete(id);
      if (vaultTexts.has(id)) textsDirty = true;
    } else {
      if (row && row.is_private === 1) trashLabels.set(id, { fp: labelFp(row), l: before ? before.label : await vaultRowLabel(privateSessionKey, row) }); // trashed: kept for the Vault Trash
      else trashLabels.delete(id);
      removeIndexEntry(vaultIndexCache, id);
    }
  }
  markIndexDirty();
  return vaultIndexCache;
}

// Label of a trashed Vault row for the Vault Trash list: from the stored labels when the row is unchanged, else decrypted (and kept).
async function vaultTrashLabel(privateSessionKey, row) {
  const fp = labelFp(row), c = trashLabels.get(row.id);
  if (c && c.fp === fp) return c.l;
  const l = await vaultRowLabel(privateSessionKey, row);
  trashLabels.set(row.id, { fp, l });
  markIndexDirty();
  return l;
}

function getVaultIndex() {
  return vaultIndexCache;
}

// Called on vault lock (auto-lock timeout or manual) — mirrors privateSessionKey's own clearing. Pending changes are serialised
// first; their encryption and write finish after the key is dropped from here.
function clearVaultIndex() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  flushBlobs();
  vaultIndexCache = null; vaultTexts = new Map(); trashLabels = new Map();
  textsLoaded = false; textsLoading = null; indexDirty = false; textsDirty = false;
  indexKey = null; indexDb = null;
}

// ---------------------------------------------------------------------------
// Search (Decision 253). Name search is synchronous and runs over strings held in memory: lower case, accents folded.
// Ranked: label, then tags and extension, then description and Money or Location details. Body search (note text, file OCR text)
// is separate and lazy: the text is loaded on the first body search of an unlock.
// ---------------------------------------------------------------------------
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const searchKeys = new WeakMap(); // entry object -> its normalised strings; a replaced entry drops its keys
function keysOf(e) {
  let k = searchKeys.get(e);
  if (!k) {
    const fields = e.money ? moneySearchText(e.money) : e.location ? `${e.location.latitude.toFixed(6)} ${e.location.longitude.toFixed(6)}` : '';
    k = { l: norm(e.label), t: `${e.tags.map(norm).join('\n')}\n${norm(e.extension)}`, d: norm(`${e.description || ''} ${fields}`) };
    searchKeys.set(e, k);
  }
  return k;
}

function searchVaultIndex(term) {
  if (!vaultIndexCache) return [];
  const t = norm(term);
  if (!t) return [];
  const byLabel = [], byTag = [], byField = [];
  for (const e of vaultIndexCache) {
    const k = keysOf(e);
    if (k.l.includes(t)) byLabel.push(e);
    else if (k.t.includes(t)) byTag.push(e);
    else if (k.d.includes(t)) byField.push(e);
  }
  return [...byLabel, ...byTag, ...byField];
}

// Notes and file OCR text for body search: from the stored text blob where the fingerprint matches, else read from the row.
// Written back when anything changed. Never blocks unlock.
async function ensureVaultTexts(db, key) {
  if (textsLoaded) return;
  if (textsLoading) return textsLoading;
  const index = vaultIndexCache;
  textsLoading = (async () => {
    const stored = await readBlob(db, key, TEXT_BLOB_KEY);
    const cached = (stored && stored.e) || {};
    let changed = !stored;
    for (const e of index) {
      if (e.type !== 'note' && !VAULT_FILE_TYPES.includes(e.type)) continue;
      const have = vaultTexts.get(e.id);
      if (have && have.fp === e.fp) continue;
      const c = cached[e.id];
      if (c && c.fp === e.fp) { vaultTexts.set(e.id, { fp: e.fp, t: c.t || '' }); continue; }
      changed = true;
      let t = '';
      try {
        if (e.type === 'note') {
          const r = ((await db.query(`SELECT encrypted_body FROM entries WHERE id=?`, [e.id])).values || [])[0];
          t = r ? await decryptPrivateNote(key, r.encrypted_body, fieldAad(e.id, 'body')) : '';
        } else {
          const r = ((await db.query(`${VAULT_INDEX_SQL} WHERE id=?`, [e.id])).values || [])[0];
          const m = r ? await fileEntryMeta(db, key, r) : null;
          t = (m && m.o) || '';
        }
      } catch { t = ''; }
      vaultTexts.set(e.id, { fp: e.fp, t });
    }
    if (Object.keys(cached).some((id) => !vaultTexts.has(id))) changed = true;
    if (indexKey !== key || vaultIndexCache !== index) return; // locked or rebuilt while reading: nothing is kept
    textsLoaded = true;
    if (changed) { textsDirty = true; scheduleSave(); }
  })();
  try { await textsLoading; } finally { textsLoading = null; }
}

// Entries whose note text or file OCR text holds the term, not already in `exclude` (a Set of ids from the name search).
async function searchVaultBodies(db, key, term, exclude = new Set()) {
  if (!vaultIndexCache) return [];
  const t = norm(term);
  if (!t) return [];
  const index = vaultIndexCache;
  await ensureVaultTexts(db, key);
  if (vaultIndexCache !== index) return [];
  return index.filter((e) => !exclude.has(e.id) && norm((vaultTexts.get(e.id) || {}).t).includes(t));
}

// ---------------------------------------------------------------------------
// Encrypted thumbnails (Decision 254). One small file per Vault image in `vthumbs/`, named by the SHA-256 of the entry id, holding
// { p: the image's file_path, d: JPEG data URL } under the Vault key. A thumbnail whose `p` differs from the row's is stale (the image
// was replaced) and is made again. Not in backups. Names are not kept in a table: the sweep removes any file no Vault image maps to.
// ---------------------------------------------------------------------------
const THUMB_DIR = 'vthumbs';
async function thumbPath(id) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)));
  return `${THUMB_DIR}/${[...h].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
// -> data URL, or null when there is none, it is stale, or it does not open under this key.
async function getVaultThumb(db, key, entry) {
  try {
    initFiles(db);
    const t = JSON.parse(await decryptPrivateNote(key, await readText(await thumbPath(entry.id))));
    return t && t.p === (entry.filePath || null) && typeof t.d === 'string' ? t.d : null;
  } catch { return null; }
}
async function putVaultThumb(db, key, entry, dataUrl) {
  try {
    initFiles(db);
    await writeText(await thumbPath(entry.id), await encryptPrivateNote(key, JSON.stringify({ p: entry.filePath || null, d: dataUrl })));
  } catch { /* a thumbnail is a cache; it is made again when missing */ }
}
// Removes thumbnails of images that no longer exist (deleted, purged, moved to Home, wiped by a restore). Trashed images keep theirs.
async function sweepVaultThumbs(db) {
  try {
    initFiles(db);
    const names = await listPaths(THUMB_DIR);
    if (!names.length) return 0;
    const ids = ((await db.query(`SELECT id FROM entries WHERE is_private=1 AND type='image'`)).values || []).map((r) => r.id);
    const keep = new Set(await Promise.all(ids.map(async (id) => (await thumbPath(id)).slice(THUMB_DIR.length + 1))));
    let removed = 0;
    for (const n of names) if (!keep.has(n)) { await removePath(`${THUMB_DIR}/${n}`); removed++; }
    return removed;
  } catch { return 0; }
}

function vaultLabelSuggestions(type, partial) {
  if (!vaultIndexCache) return [];
  const p = partial.toLowerCase();
  const counts = new Map();
  for (const e of vaultIndexCache) {
    if (e.type === type && e.label.toLowerCase().includes(p)) counts.set(e.label, (counts.get(e.label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

export {
  VAULT_TYPES, buildVaultPlaintext, parseVaultPlaintext, vaultRowLabel, migrateVaultLabels,
  saveVaultEntry, loadVaultEntryContent, updateVaultFileContent, base64ToBlobUrl,
  buildVaultIndex, refreshVaultIndexEntries, upsertIndexEntry, removeIndexEntry, getVaultIndex, clearVaultIndex, searchVaultIndex, searchVaultBodies, vaultTrashLabel, getVaultThumb, putVaultThumb, sweepVaultThumbs, vaultLabelSuggestions
};
