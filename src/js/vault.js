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
import { encryptPrivateNote, decryptPrivateNote } from './crypto.js';
import * as Money from './money.js';

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
// Save — file_path always NULL for vault entries; bytes live only inside encrypted_body.
// ---------------------------------------------------------------------------
async function saveVaultEntry(db, privateSessionKey, { type, label, tags = [], description = '', extension = null, autoCategory = null, fireAt = null, repeatRule = null, ...content }) {
  if (!VAULT_TYPES.includes(type)) throw new Error(`Type not supported in Private Vault: ${type}`);
  const plaintext = buildVaultPlaintext(type, content);
  const encryptedBody = await encryptPrivateNote(privateSessionKey, plaintext);
  const id = crypto.randomUUID();

  // insertEntry() already skips entries_fts/label_history for is_private=1 (db.js) — that's the
  // point: a vault item's existence/label must never surface in ordinary, no-PIN search or
  // autocomplete. Vault's own search/autocomplete comes from the in-memory index below instead.
  await insertEntry(db, {
    id, type, label: VAULT_PLACEHOLDER_LABEL, body_text: null, is_private: 1, encrypted_body: encryptedBody,
    encrypted_label: await encryptPrivateNote(privateSessionKey, label), // Decision 145: the label is encrypted like the body
    file_path: null, extension, auto_category: autoCategory,
    fire_at: fireAt, repeat_rule: repeatRule, // reminders: schedule columns are plaintext, the notification needs them while locked (Decision 140)
    // Description is encrypted like the body: label is the only plaintext a Vault row carries.
    encrypted_description: description ? await encryptPrivateNote(privateSessionKey, description) : null
  });

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
  try { return await decryptPrivateNote(privateSessionKey, row.encrypted_label); } catch { return UNREADABLE_LABEL; }
}

// Encrypts every Vault label still in plaintext, trashed rows included. Safe to repeat or to be cut short.
async function migrateVaultLabels(db, privateSessionKey) {
  const rows = (await db.query(`SELECT id, label FROM entries WHERE is_private=1 AND encrypted_label IS NULL`)).values || [];
  for (const row of rows) {
    const enc = await encryptPrivateNote(privateSessionKey, row.label);
    await db.run(`UPDATE entries SET encrypted_label=?, label=? WHERE id=? AND encrypted_label IS NULL`, [enc, VAULT_PLACEHOLDER_LABEL, row.id]);
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Load — decrypt on demand, never cache decrypted content beyond the in-memory index below.
// ---------------------------------------------------------------------------
async function loadVaultEntryContent(db, privateSessionKey, entryId) {
  const row = (await db.query(`SELECT * FROM entries WHERE id=? AND is_private=1`, [entryId])).values[0];
  if (!row) throw new Error('Vault entry not found');
  const plaintext = await decryptPrivateNote(privateSessionKey, row.encrypted_body);
  return { row: { ...row, label: await vaultRowLabel(privateSessionKey, row) }, content: parseVaultPlaintext(row.type, plaintext) };
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
// In-memory search index — built fresh on vault unlock, updated per entry afterwards, discarded on vault lock. Never persisted,
// never written to disk even encrypted (Decision: simplicity + zero index-drift risk beats the
// performance a persistent index would buy at this scale — see conversation/DECISIONS.md).
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
const VAULT_INDEX_SQL = `SELECT rowid AS rid, id, type, label, encrypted_label, encrypted_description, extension, created_at,
  fire_at, repeat_rule, completed_at, snoozed_until, is_private, deleted_at, encrypted_meta, LENGTH(encrypted_body) AS body_len,
  CASE WHEN type IN ('voice','image','pdf','file') THEN NULL ELSE encrypted_body END AS encrypted_body
  FROM entries`;

// Size and OCR text of a file entry without decrypting the file. Valid only while it decrypts under the current key and
// its recorded body length still matches; otherwise it is rebuilt from the body and written back. Never throws.
async function fileEntryMeta(db, privateSessionKey, row) {
  if (row.encrypted_meta) {
    try {
      const m = JSON.parse(await decryptPrivateNote(privateSessionKey, row.encrypted_meta));
      if (m && m.v === 1 && m.bl === row.body_len) return m;
    } catch { /* wrong key or damaged: rebuild below */ }
  }
  try {
    const full = ((await db.query(`SELECT encrypted_body FROM entries WHERE id=?`, [row.id])).values || [])[0];
    const content = parseVaultPlaintext(row.type, await decryptPrivateNote(privateSessionKey, full.encrypted_body));
    const meta = { v: 1, bl: row.body_len, o: content.ocrText || '', s: content.fileData ? Math.ceil(content.fileData.length * 0.75) : 0 }; // base64 → raw byte estimate
    try {
      await db.run(`UPDATE entries SET encrypted_meta=? WHERE id=?`, [await encryptPrivateNote(privateSessionKey, JSON.stringify(meta)), row.id]);
    } catch { /* the index still works without the cache */ }
    return meta;
  } catch {
    return null; // corrupted or undecryptable entry: still listed (so it can be deleted), just not searchable
  }
}

async function indexEntryFromRow(db, privateSessionKey, row, tagsByEntry = null) {
  const tags = tagsByEntry ? (tagsByEntry.get(row.id) || []) : ((await db.query(
    `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id=t.id WHERE et.entry_id=?`, [row.id]
  )).values || []).map((t) => t.name);
  let searchableText = '', sizeBytes = 0, description = '', money = null, location = null;
  const label = await vaultRowLabel(privateSessionKey, row);
  try {
    if (row.encrypted_description) description = await decryptPrivateNote(privateSessionKey, row.encrypted_description);
  } catch { description = ''; }
  if (VAULT_FILE_TYPES.includes(row.type)) {
    const meta = await fileEntryMeta(db, privateSessionKey, row);
    if (meta) { searchableText = meta.o || ''; sizeBytes = meta.s || 0; }
  } else {
    try {
      const plaintext = await decryptPrivateNote(privateSessionKey, row.encrypted_body);
      if (row.type === 'note') {
        searchableText = plaintext;
        sizeBytes = new Blob([plaintext]).size;
      } else if (row.type === 'money') {
        money = parseVaultPlaintext('money', plaintext).money;
        searchableText = money ? moneySearchText(money) : '';
        sizeBytes = new Blob([plaintext]).size;
      } else if (row.type === 'location') {
        location = parseVaultPlaintext('location', plaintext).location;
        searchableText = location ? `${location.latitude.toFixed(6)} ${location.longitude.toFixed(6)}` : '';
        sizeBytes = new Blob([plaintext]).size;
      }
    } catch {
      searchableText = ''; // corrupted/undecryptable entry: still listed, just not searchable
    }
  }
  return { id: row.id, rid: row.rid, type: row.type, label, extension: row.extension || null, tags, description, searchableText, sizeBytes, money, location, createdAt: row.created_at,
    fire_at: row.fire_at, repeat_rule: row.repeat_rule, completed_at: row.completed_at, snoozed_until: row.snoozed_until };
}

// Full build: on unlock (and after a restore or a reminder change that names no entry). Also runs the label migration.
// Tags for every Vault row come from one query, not one per entry.
async function buildVaultIndex(db, privateSessionKey) {
  await migrateVaultLabels(db, privateSessionKey);
  const rows = (await db.query(`${VAULT_INDEX_SQL} WHERE is_private=1 AND deleted_at IS NULL ORDER BY rowid`)).values || [];
  const tagsByEntry = new Map();
  const tagRows = (await db.query(
    `SELECT et.entry_id AS entry_id, t.name AS name FROM entry_tags et JOIN tags t ON t.id=et.tag_id
     WHERE et.entry_id IN (SELECT id FROM entries WHERE is_private=1 AND deleted_at IS NULL)`
  )).values || [];
  for (const t of tagRows) {
    if (!tagsByEntry.has(t.entry_id)) tagsByEntry.set(t.entry_id, []);
    tagsByEntry.get(t.entry_id).push(t.name);
  }
  const index = [];
  for (const row of rows) index.push(await indexEntryFromRow(db, privateSessionKey, row, tagsByEntry));
  vaultIndexCache = index;
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
  return index;
}

// Per-entry update after add, edit, trash, restore or delete: reads only the named rows. A row that is now
// a live Vault row is added or replaced; anything else (trashed, deleted, not a Vault row) is removed.
// No index yet (the Vault was never built this unlock) falls back to a full build.
async function refreshVaultIndexEntries(db, privateSessionKey, ids) {
  if (!vaultIndexCache) return buildVaultIndex(db, privateSessionKey);
  for (const id of ids) {
    const row = ((await db.query(`${VAULT_INDEX_SQL} WHERE id=?`, [id])).values || [])[0];
    if (row && row.is_private === 1 && !row.deleted_at) {
      upsertIndexEntry(vaultIndexCache, await indexEntryFromRow(db, privateSessionKey, row));
    } else {
      removeIndexEntry(vaultIndexCache, id);
    }
  }
  return vaultIndexCache;
}

function getVaultIndex() {
  return vaultIndexCache;
}

// Called on vault lock (auto-lock timeout or manual) — mirrors privateSessionKey's own clearing.
function clearVaultIndex() {
  vaultIndexCache = null;
}

function searchVaultIndex(term) {
  if (!vaultIndexCache) return [];
  const t = term.toLowerCase();
  return vaultIndexCache.filter((e) =>
    e.label.toLowerCase().includes(t) ||
    e.tags.some((tag) => tag.toLowerCase().includes(t)) ||
    (e.description || '').toLowerCase().includes(t) ||
    e.searchableText.toLowerCase().includes(t)
  );
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
  saveVaultEntry, loadVaultEntryContent, base64ToBlobUrl,
  buildVaultIndex, refreshVaultIndexEntries, upsertIndexEntry, removeIndexEntry, getVaultIndex, clearVaultIndex, searchVaultIndex, vaultLabelSuggestions
};
