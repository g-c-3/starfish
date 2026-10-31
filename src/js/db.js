// db.js — SQLite schema & init for Arkly
// Uses @capacitor-community/sqlite. All data is local-only.

import { plainNoteText } from './notestyle.js';

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `

-- ===== Credentials =====
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_password_hash TEXT,            -- NULL = no app-open password set (optional, "quick access")
  app_password_salt TEXT,
  app_password_hint TEXT,
  private_pin_hash TEXT,
  private_pin_salt TEXT,
  private_pin_hint TEXT,
  auto_lock_minutes INTEGER DEFAULT 5,       -- app-level lock timeout
  vault_auto_lock_minutes INTEGER DEFAULT 5, -- Private Vault's own, independent timeout — separate lock, separate timer
  biometric_app_enabled INTEGER DEFAULT 0,   -- fingerprint/face as an alternative to the app-open password (Decision 50)
  biometric_vault_enabled INTEGER DEFAULT 0, -- same, for the Vault PIN — independent toggle, independent of the above
  app_lock_idle_enabled INTEGER DEFAULT 1,        -- three independent lock triggers per lock (Decision 74)
  app_lock_background_enabled INTEGER DEFAULT 1,
  app_lock_screenoff_enabled INTEGER DEFAULT 0,   -- needs the native listener in android-notes §14; off until confirmed on device
  vault_lock_idle_enabled INTEGER DEFAULT 1,
  vault_lock_background_enabled INTEGER DEFAULT 1,
  vault_lock_screenoff_enabled INTEGER DEFAULT 0,
  last_backup_at INTEGER,
  last_drive_backup_at INTEGER
);

-- ===== Entries (unified timeline) =====
-- type: 'note' | 'voice' | 'image' | 'pdf' | 'file' | 'expense' | 'reminder'
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,               -- uuid
  type TEXT NOT NULL,
  label TEXT NOT NULL,               -- required for every entry
  body_text TEXT,                    -- typed note body / OCR text / null for voice+file. NULL when is_private=1 (see below)
  is_private INTEGER DEFAULT 0,      -- Private Vault flag — any type (note/voice/image/pdf/file), not notes-only
  encrypted_body BLOB,               -- Private Vault only (AES ciphertext). Shape depends on type — see vault.js:
                                      --   note: plaintext is the note text itself (unchanged from pre-vault format)
                                      --   voice/file: plaintext is JSON {fileData} (base64)
                                      --   image/pdf: plaintext is JSON {fileData, ocrText} (base64 + OCR text, both encrypted together)
  file_path TEXT,                    -- voice/image/pdf/file: files/<random name>, encrypted (Home Decision 161, Vault Decision 212).
                                      -- A Vault row from before Decision 212 has NULL here and its bytes inside encrypted_body.
  extension TEXT,                    -- generic files
  file_key TEXT,                     -- per-file key: wrapped under the master key (Home, Decision 161) or the Vault key (Vault, Decision 212); NULL on Home = plain file from before per-file encryption
  auto_category TEXT,                -- generic files: Documents/Audio/Archives/Other
  noise_reduction INTEGER,           -- voice only
  latitude REAL,
  longitude REAL,
  description TEXT,                  -- optional free text (Decision 91). NULL for Vault entries — see encrypted_description
  encrypted_description BLOB,        -- Private Vault only: description encrypted under the Vault key
  encrypted_label BLOB,              -- Private Vault only (Decision 145): the label under the Vault key; label then holds VAULT_PLACEHOLDER_LABEL
  encrypted_meta BLOB,               -- Private Vault file types only (Decision 156): {size, OCR text, body length} under the Vault key; derived from encrypted_body, rebuilt when missing or stale

  -- expense-specific
  amount REAL,
  expense_category TEXT,
  replied INTEGER DEFAULT 1,         -- 0 if user never answered "what for?"

  -- reminder-specific
  fire_at INTEGER,                   -- epoch ms
  repeat_rule TEXT,                  -- null | 'daily' | 'weekly' | 'monthly'
  snoozed_until INTEGER,
  notified INTEGER DEFAULT 0,
  completed_at INTEGER,              -- owner marked the reminder done (Decision 92); NULL = not marked

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                 -- soft delete; purge after 30 days
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);
CREATE INDEX IF NOT EXISTS idx_entries_fire_at ON entries(fire_at);

-- ===== Full-text search (label always indexed; body only for non-private, non-voice, non-file) =====
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  id UNINDEXED,
  label,
  body_text
);

-- ===== Tags (many-to-many) =====
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (entry_id, tag_id),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- ===== Previously used labels (autocomplete, per type) =====
CREATE TABLE IF NOT EXISTS label_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  use_count INTEGER DEFAULT 1,
  UNIQUE(type, label)
);

-- ===== Widget inbox (Decision 266): captures made from the home-screen widget wait here until the app is unlocked =====
CREATE TABLE IF NOT EXISTS widget_inbox (
  id TEXT PRIMARY KEY,               -- becomes the entry id
  type TEXT NOT NULL,                -- 'note' | 'voice' | 'image' | 'money'
  label TEXT NOT NULL,
  description TEXT,
  body_text TEXT,
  money_json TEXT,
  extension TEXT,                    -- voice/image/pdf/file type
  file_path TEXT,                    -- files/<random name>, encrypted like any Home file
  file_key TEXT,
  fire_at INTEGER,                   -- reminder (scheduled when saved, Decision 267)
  repeat_rule TEXT,
  latitude REAL,                     -- location
  longitude REAL,
  created_at INTEGER NOT NULL
);

-- ===== App meta (schema version, ad state, digest cache, etc.) =====
-- ===== Map tiles saved with a Home location (Decision 346); data is a data: URL; not in backups =====
CREATE TABLE IF NOT EXISTS location_tiles (
  entry_id TEXT NOT NULL,
  z INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  lat REAL NOT NULL,                 -- the location's coordinates when saved; a changed location drops its tiles
  lng REAL NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (entry_id, z, x, y)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const DB_NAME = 'arkly.db'; // the package id changed with the rename (Decision 273), so this is a fresh install's database; data arrives by restoring a backup
let _sqlite = null;

// Decision 158: random 256-bit key, held by the plugin in Keystore-backed storage. Never derived from a password.
function randomKey() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function ensureSecret() {
  if (!(await _sqlite.isSecretStored()).result) await _sqlite.setEncryptionSecret(randomKey());
}

async function getEncryptionStatus() {
  return !!(await _sqlite.isDatabaseEncrypted(DB_NAME)).result;
}

// Row count per user table (FTS shadow tables skipped); compared before and after conversion.
async function tableCounts(conn) {
  const names = ((await conn.query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'entries_fts%' ORDER BY name`)).values || []).map((r) => r.name);
  const out = {};
  for (const n of names) out[n] = ((await conn.query(`SELECT COUNT(*) AS n FROM "${n}"`)).values || [{ n: -1 }])[0].n;
  return out;
}

const ENC_FLAG = 'dz_enc_pending';
const ENC_RESULT = 'dz_enc_result';

// Conversion runs at the next start, before any connection exists (Decision 158).
function requestEncryption() {
  localStorage.setItem(ENC_FLAG, '1');
}

function getEncryptionResult() {
  try { return JSON.parse(localStorage.getItem(ENC_RESULT) || 'null'); } catch (e) { return null; }
}

// One attempt per request: the flag is cleared first, so a hang cannot repeat on the next launch.
async function convertAtStartup() {
  localStorage.removeItem(ENC_FLAG);
  localStorage.setItem(ENC_RESULT, JSON.stringify({ state: 'running' }));
  let result;
  try {
    const plain = await _sqlite.createConnection(DB_NAME, false, 'no-encryption', SCHEMA_VERSION, false);
    await plain.open();
    const before = await tableCounts(plain);
    await plain.close();
    await _sqlite.closeConnection(DB_NAME, false);
    await ensureSecret();
    const enc = await _sqlite.createConnection(DB_NAME, true, 'encryption', SCHEMA_VERSION, false);
    await enc.open();
    const after = await tableCounts(enc);
    await enc.close();
    await _sqlite.closeConnection(DB_NAME, false);
    const same = Object.keys(before).every((k) => before[k] === after[k]);
    const encrypted = (await _sqlite.isDatabaseEncrypted(DB_NAME)).result;
    result = { state: same && encrypted ? 'done' : 'unconfirmed', same, encrypted };
  } catch (e) {
    try { await _sqlite.closeConnection(DB_NAME, false); } catch (x) { /* not open */ }
    result = { state: 'failed', error: e.message || String(e) };
  }
  localStorage.setItem(ENC_RESULT, JSON.stringify(result));
}

async function initDb(sqlite) {
  _sqlite = sqlite;
  // A page reload leaves native connections open; close any the page no longer holds.
  try { await sqlite.checkConnectionsConsistency(); } catch (e) { /* none open */ }
  const exists = (await sqlite.isDatabase(DB_NAME)).result;
  let encrypted = exists && (await sqlite.isDatabaseEncrypted(DB_NAME)).result;
  if (localStorage.getItem(ENC_FLAG) && exists && !encrypted) {
    await convertAtStartup();
    encrypted = (await sqlite.isDatabaseEncrypted(DB_NAME)).result;
  } else {
    localStorage.removeItem(ENC_FLAG);
  }
  // Decision 158: a new install starts encrypted; an existing plain file stays plain until requestEncryption() runs at the next start.
  const useKey = !exists || encrypted;
  if (!exists) await ensureSecret();
  if (encrypted && !(await sqlite.isSecretStored()).result) {
    throw new Error('The database is encrypted but its key is missing on this device. Clear app data, then restore a backup.');
  }
  const db = await sqlite.createConnection(DB_NAME, useKey, useKey ? 'secret' : 'no-encryption', SCHEMA_VERSION, false);
  await db.open();
  await db.execute(SCHEMA_SQL);

  // Decision 106: the index used to be contentless (content=''), where every column reads back NULL — so the join
  // on entries_fts.id in searchEntries() matched nothing, and the UPDATE/DELETE ... WHERE id=? calls hit nothing.
  // It now stores its columns. An existing contentless table is dropped and rebuilt once from entries; private
  // entries stay out of it (see insertEntry).
  const ftsDef = ((await db.query(`SELECT sql FROM sqlite_master WHERE name='entries_fts'`)).values || [])[0];
  if (ftsDef && /content\s*=\s*''/.test(ftsDef.sql || '')) {
    await db.execute(`DROP TABLE entries_fts`);
    await db.execute(`CREATE VIRTUAL TABLE entries_fts USING fts5(id UNINDEXED, label, body_text)`);
    await db.execute(`INSERT INTO entries_fts (id, label, body_text)
      SELECT id, label, TRIM(COALESCE(body_text, '') || ' ' || COALESCE(description, '')) FROM entries WHERE is_private = 0`);
  }

  // First real migration this app has needed: CREATE TABLE IF NOT EXISTS only helps fresh
  // installs — an existing on-device DB from before a column was added never gets it, since the
  // table already exists and the whole CREATE statement is skipped. ensureColumn() checks first
  // and ALTERs only if missing, so it's safe to call unconditionally on every boot, on both a
  // fresh DB (columns already there from SCHEMA_SQL, no-ops) and an existing one (adds them
  // once, then no-ops from then on). Reuse this for any future column addition instead of only
  // editing SCHEMA_SQL — see Decision 50.
  await ensureColumn(db, 'entries', 'completed_at', 'INTEGER');
  await ensureColumn(db, 'entries', 'description', 'TEXT');
  await ensureColumn(db, 'entries', 'encrypted_description', 'BLOB');
  await ensureColumn(db, 'entries', 'encrypted_label', 'BLOB');
  await ensureColumn(db, 'entries', 'encrypted_meta', 'BLOB');
  await ensureColumn(db, 'entries', 'file_key', 'TEXT');
  // Money details as JSON text (Decision 124). Home only; Vault Money keeps the same JSON inside encrypted_body.
  await ensureColumn(db, 'entries', 'money_json', 'TEXT');
  // Widget "More" captures (Decision 267): the table already exists on installs from Decision 266.
  await ensureColumn(db, 'widget_inbox', 'fire_at', 'INTEGER');
  await ensureColumn(db, 'widget_inbox', 'repeat_rule', 'TEXT');
  await ensureColumn(db, 'widget_inbox', 'latitude', 'REAL');
  await ensureColumn(db, 'widget_inbox', 'longitude', 'REAL');
  // PBKDF2 count each credential hash was made with (Decision 172). NULL = 210000, the count before it was stored.
  await ensureColumn(db, 'credentials', 'app_password_iter', 'INTEGER');
  await ensureColumn(db, 'credentials', 'private_pin_iter', 'INTEGER');
  // The Vault master key wrapped under the PIN (Decision 195). Replaces private_pin_hash/salt/iter, which are no longer written.
  await ensureColumn(db, 'credentials', 'vault_wrap', 'TEXT');
  await ensureColumn(db, 'credentials', 'biometric_app_enabled', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'credentials', 'biometric_vault_enabled', 'INTEGER DEFAULT 0');
  // Three independent lock triggers per lock (Decision 74), replacing "idle timer + always-on
  // background lock" with separate on/off switches for each. Idle and background default to 1
  // (matches prior, always-on behavior — no surprise change for existing installs). Screen-off is
  // brand new (needs a native listener, see android-notes §14) and defaults to 0 until confirmed
  // working on a real device — nothing before this could ever have relied on it being on.
  await ensureColumn(db, 'credentials', 'app_lock_idle_enabled', 'INTEGER DEFAULT 1');
  await ensureColumn(db, 'credentials', 'app_lock_background_enabled', 'INTEGER DEFAULT 1');
  await ensureColumn(db, 'credentials', 'app_lock_screenoff_enabled', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'credentials', 'vault_lock_idle_enabled', 'INTEGER DEFAULT 1');
  await ensureColumn(db, 'credentials', 'vault_lock_background_enabled', 'INTEGER DEFAULT 1');
  await ensureColumn(db, 'credentials', 'vault_lock_screenoff_enabled', 'INTEGER DEFAULT 0');

  const versionRow = await db.query(`SELECT value FROM meta WHERE key='schema_version'`);
  if (!versionRow.values || versionRow.values.length === 0) {
    await db.run(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
  }
  return db;
}

async function ensureColumn(db, table, column, columnDefSql) {
  const info = await db.query(`PRAGMA table_info(${table})`);
  const exists = (info.values || []).some((c) => c.name === column);
  if (!exists) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDefSql}`);
}

// What `label` holds for a Vault row; the real label is in encrypted_label (Decision 145).
const VAULT_PLACEHOLDER_LABEL = 'Vault item';

// Insert an entry and keep the FTS index in sync.
// Private note bodies must NOT be passed as body_text — pass encryptedBody instead and leave body_text null.
async function insertEntry(db, entry) {
  const {
    id, type, label, body_text = null, is_private = 0, encrypted_body = null,
    file_path = null, file_key = null, extension = null, auto_category = null, noise_reduction = null,
    latitude = null, longitude = null, amount = null, expense_category = null,
    replied = 1, fire_at = null, repeat_rule = null, description = null, encrypted_description = null, encrypted_label = null, money_json = null,
    created_at = null // kept when a widget capture moves to Home (Decision 266)
  } = entry;
  const now = created_at || Date.now();

  await db.run(
    `INSERT INTO entries (id, type, label, body_text, is_private, encrypted_body, file_path, file_key,
      extension, auto_category, noise_reduction, latitude, longitude, amount, expense_category,
      replied, fire_at, repeat_rule, description, encrypted_description, encrypted_label, money_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, type, label, body_text, is_private, encrypted_body, file_path, file_key, extension, auto_category,
     noise_reduction, latitude, longitude, amount, expense_category, replied, fire_at, repeat_rule,
     description, encrypted_description, encrypted_label, money_json, now, now]
  );

  // Private Vault entries are excluded from BOTH the searchable index and label autocomplete —
  // not just the body. Indexing even the label would let its existence/title leak into ordinary,
  // no-PIN search results; feeding label_history would let it surface as an autocomplete suggestion
  // in the normal (non-vault) capture bar. Vault search/autocomplete instead comes from the
  // in-memory index vault.js builds fresh on unlock — see vault.js's buildVaultIndex().
  if (!is_private) {
    // The description is searchable alongside the body, in the same FTS column (contentless table, so no new column).
    await db.run(`INSERT INTO entries_fts (id, label, body_text) VALUES (?,?,?)`, [id, label, [plainNoteText(body_text), description].filter(Boolean).join(' ')]);
    await db.run(
      `INSERT INTO label_history (type, label) VALUES (?,?)
       ON CONFLICT(type, label) DO UPDATE SET use_count = use_count + 1`,
      [type, label]
    );
  }
}

// Typed text -> safe FTS5 query: each word quoted (so '.', '-', quotes are not syntax) and matched as a word prefix.
// Raw text made names like "photo.png" a syntax error and "1001" miss "1001073062".
function toFtsQuery(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

async function searchEntries(db, queryText, opts = {}) {
  const limit = opts.limit || 50;
  const terms = String(queryText || '').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  // 1. Ranked word-prefix matches (label weighted above body).
  let ranked = [];
  try {
    ranked = (await db.query(
      `SELECT e.*, bm25(entries_fts, 2.0, 1.0) AS rank
       FROM entries_fts
       JOIN entries e ON e.id = entries_fts.id
       WHERE entries_fts MATCH ? AND e.deleted_at IS NULL
       ORDER BY rank LIMIT ?`,
      [toFtsQuery(queryText), limit]
    )).values || [];
  } catch { /* unreadable query: fall through to the substring pass */ }
  // 2. Substring matches anywhere in label, body or description, like the Vault's search ("1073" finds "1001073062.png").
  //    Private entries are excluded, as they are from the index.
  const like = (t) => `%${t.replace(/[\\%_]/g, '\\$&')}%`;
  // The words only: a note's style data (notestyle.js) starts at the first line break plus three U+2063.
  const words = `CASE WHEN INSTR(COALESCE(body_text,''), CHAR(10, 8291, 8291, 8291)) > 0 THEN SUBSTR(body_text, 1, INSTR(body_text, CHAR(10, 8291, 8291, 8291)) - 1) ELSE COALESCE(body_text,'') END`;
  const clause = `(COALESCE(label,'') || ' ' || ${words} || ' ' || COALESCE(description,'')) LIKE ? ESCAPE '\\'`;
  const sub = (await db.query(
    `SELECT * FROM entries WHERE is_private = 0 AND deleted_at IS NULL AND ${terms.map(() => clause).join(' AND ')}
     ORDER BY created_at DESC LIMIT ?`,
    [...terms.map(like), limit]
  )).values || [];
  const seen = new Set(ranked.map((r) => r.id));
  return ranked.concat(sub.filter((r) => !seen.has(r.id))).slice(0, limit);
}

async function softDelete(db, id) {
  await db.run(`UPDATE entries SET deleted_at = ? WHERE id = ?`, [Date.now(), id]);
  // A deleted reminder must not still fire from its scheduled notification (Decision 92).
  const row = ((await db.query(`SELECT type FROM entries WHERE id = ?`, [id])).values || [])[0];
  if (row && row.type === 'reminder') {
    try { (await import('./notifications.js')).cancelReminder(id); } catch { /* notification plugin unavailable — nothing scheduled */ }
  }
}

// Two independent bins share this same deleted_at/is_private pair rather than needing a second set
// of columns or tables: "the vault's bin" is just WHERE is_private=1, "the main bin" is WHERE is_private=0.
// Same 30-day rule for both (Decision — one soft-delete/purge policy, applied per-bin by this filter).
async function listTrash(db, { isPrivate = false } = {}) {
  // Vault file bytes sit in encrypted_body, so a Vault listing names its columns and leaves the body out (Decision 193).
  const cols = isPrivate ? 'id, type, label, encrypted_label, extension, auto_category, created_at, deleted_at, is_private' : '*';
  const rows = await db.query(
    `SELECT ${cols} FROM entries WHERE deleted_at IS NOT NULL AND is_private = ? ORDER BY deleted_at DESC`,
    [isPrivate ? 1 : 0]
  );
  return rows.values || [];
}

async function restoreFromTrash(db, id) {
  await db.run(`UPDATE entries SET deleted_at = NULL WHERE id = ?`, [id]);
  // Put a still-pending reminder back on the schedule.
  const kind = ((await db.query(`SELECT type FROM entries WHERE id = ?`, [id])).values || [])[0];
  const row = kind && kind.type === 'reminder' ? ((await db.query(`SELECT * FROM entries WHERE id = ?`, [id])).values || [])[0] : null; // whole row only for a reminder: a Vault file's body is large (Decision 193)
  if (row && row.type === 'reminder') { // Vault reminders too: the notification text is generic (Decision 140)
    const { reminderStatus } = await import('./reminders.js');
    if (reminderStatus(row) === 'upcoming') {
      try { await (await import('./notifications.js')).scheduleReminder(row); } catch { /* scheduling failed — entry is restored regardless */ }
    }
  }
}

// User-triggered "delete permanently" from within a trash bin — same cascade-safe deletion
// purgeOldTrash already does, just invoked on demand for one id instead of everything past 30 days.
async function permanentlyDeleteEntry(db, id) {
  const row = ((await db.query(`SELECT file_path FROM entries WHERE id = ?`, [id])).values || [])[0];
  await db.run(`DELETE FROM entries_fts WHERE id = ?`, [id]);
  await db.run(`DELETE FROM entry_tags WHERE entry_id = ?`, [id]); // explicit — see purgeOldTrash's own note
  await db.run(`DELETE FROM location_tiles WHERE entry_id = ?`, [id]); // saved map tiles go with the location (Decision 346)
  await db.run(`DELETE FROM entries WHERE id = ?`, [id]);
  if (row?.file_path) { // the file goes with its entry (Decision 162); after the row, so a failed delete never orphans an entry
    try { const files = await import('./files.js'); files.initFiles(db); await files.removeFile(row); } catch { /* file already gone */ }
  }
}

async function purgeOldTrash(db) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = await db.query(`SELECT id FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]);
  for (const row of (rows.values || [])) {
    await permanentlyDeleteEntry(db, row.id); // same cascade-safe deletion as a manual "delete permanently"
  }
}

// Powers the shared tag-picker UI: every existing tag, most-used first, so it reads as chips to select
// rather than a field the user has to retype into. Creating a brand-new tag is a separate INSERT (see
// applyTags in app.js) that this same query will then pick up on the next call.
async function listAllTags(db) {
  const rows = await db.query(
    `SELECT t.id, t.name, COUNT(et.entry_id) AS use_count
     FROM tags t
     LEFT JOIN entry_tags et ON et.tag_id = t.id
     GROUP BY t.id
     ORDER BY use_count DESC, t.name ASC`
  );
  return rows.values || [];
}

// Powers label autocomplete (Phase 8, ARCHITECTURE §7) — previously used labels for one entry
// type, most-used first, meant to be shown as tap-to-select suggestions at capture time rather
// than retyped from scratch. Vault entries never reach label_history at all (insertEntry's
// is_private guard), so this can never leak a vault label into a non-vault suggestion list.
async function listLabelHistory(db, type, limit = 8) {
  const rows = await db.query(
    `SELECT label, use_count FROM label_history WHERE type = ? ORDER BY use_count DESC, label ASC LIMIT ?`,
    [type, limit]
  );
  return rows.values || [];
}

// Tags offered as chips in the Save dialog. Scoped: the main dialog only ever lists tags used by
// non-private entries, the Vault dialog only tags used by private ones, so a Vault tag name never
// shows up outside the Vault. Tags no live entry uses are not listed. Most-used first.
async function listTagsForScope(db, isPrivate) {
  const rows = await db.query(
    `SELECT t.name AS name, COUNT(*) AS use_count
     FROM tags t
     JOIN entry_tags et ON et.tag_id = t.id
     JOIN entries e ON e.id = et.entry_id
     WHERE e.is_private = ? AND e.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY use_count DESC, t.name ASC`,
    [isPrivate ? 1 : 0]
  );
  return (rows.values || []).map((r) => r.name);
}

const MAX_TAGS = 2; // Decision 90 — an entry holds at most two tags

export {
  MAX_TAGS, listTagsForScope,
  initDb, getEncryptionStatus, requestEncryption, getEncryptionResult, insertEntry, searchEntries, softDelete, VAULT_PLACEHOLDER_LABEL,
  listTrash, restoreFromTrash, permanentlyDeleteEntry, purgeOldTrash,
  listAllTags, listLabelHistory, SCHEMA_SQL
};
