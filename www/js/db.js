// db.js — SQLite schema & init for Dumpzone
// Uses @capacitor-community/sqlite. All data is local-only.

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `

-- ===== Credentials =====
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_password_hash TEXT NOT NULL,
  app_password_salt TEXT NOT NULL,
  app_password_hint TEXT,
  private_pin_hash TEXT,
  private_pin_salt TEXT,
  private_pin_hint TEXT,
  auto_lock_minutes INTEGER DEFAULT 5,
  last_backup_at INTEGER
);

-- ===== Entries (unified timeline) =====
-- type: 'note' | 'voice' | 'image' | 'pdf' | 'file' | 'expense' | 'reminder'
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,               -- uuid
  type TEXT NOT NULL,
  label TEXT NOT NULL,               -- required for every entry
  body_text TEXT,                    -- typed note body / OCR text / null for voice+file
  is_private INTEGER DEFAULT 0,      -- notes only
  encrypted_body BLOB,               -- private notes only (AES ciphertext)
  file_path TEXT,                    -- voice/image/pdf/file
  extension TEXT,                    -- generic files
  auto_category TEXT,                -- generic files: Documents/Audio/Archives/Other
  noise_reduction INTEGER,           -- voice only
  latitude REAL,
  longitude REAL,

  -- expense-specific
  amount REAL,
  expense_category TEXT,
  replied INTEGER DEFAULT 1,         -- 0 if user never answered "what for?"

  -- reminder-specific
  fire_at INTEGER,                   -- epoch ms
  repeat_rule TEXT,                  -- null | 'daily' | 'weekly' | 'monthly'
  snoozed_until INTEGER,
  notified INTEGER DEFAULT 0,

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
  body_text,
  content=''
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

-- ===== App meta (schema version, ad state, digest cache, etc.) =====
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

async function initDb(sqlite) {
  const db = await sqlite.createConnection('dumpzone.db', false, 'no-encryption', SCHEMA_VERSION, false);
  await db.open();
  await db.execute(SCHEMA_SQL);

  const versionRow = await db.query(`SELECT value FROM meta WHERE key='schema_version'`);
  if (!versionRow.values || versionRow.values.length === 0) {
    await db.run(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
  }
  return db;
}

// Insert an entry and keep the FTS index in sync.
// Private note bodies must NOT be passed as body_text — pass encryptedBody instead and leave body_text null.
async function insertEntry(db, entry) {
  const {
    id, type, label, body_text = null, is_private = 0, encrypted_body = null,
    file_path = null, extension = null, auto_category = null, noise_reduction = null,
    latitude = null, longitude = null, amount = null, expense_category = null,
    replied = 1, fire_at = null, repeat_rule = null
  } = entry;
  const now = Date.now();

  await db.run(
    `INSERT INTO entries (id, type, label, body_text, is_private, encrypted_body, file_path,
      extension, auto_category, noise_reduction, latitude, longitude, amount, expense_category,
      replied, fire_at, repeat_rule, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, type, label, body_text, is_private, encrypted_body, file_path, extension, auto_category,
     noise_reduction, latitude, longitude, amount, expense_category, replied, fire_at, repeat_rule, now, now]
  );

  // Index label always; index body only if not private and not voice/file (those have no useful body_text anyway)
  const indexableBody = (!is_private && body_text) ? body_text : '';
  await db.run(`INSERT INTO entries_fts (id, label, body_text) VALUES (?,?,?)`, [id, label, indexableBody]);

  // Track label for autocomplete
  await db.run(
    `INSERT INTO label_history (type, label) VALUES (?,?)
     ON CONFLICT(type, label) DO UPDATE SET use_count = use_count + 1`,
    [type, label]
  );
}

async function searchEntries(db, queryText, opts = {}) {
  // Rank label matches above body matches using bm25 weighting (label column weighted higher).
  const rows = await db.query(
    `SELECT e.*, bm25(entries_fts, 2.0, 1.0) AS rank
     FROM entries_fts
     JOIN entries e ON e.id = entries_fts.id
     WHERE entries_fts MATCH ? AND e.deleted_at IS NULL
     ORDER BY rank LIMIT ?`,
    [queryText, opts.limit || 50]
  );
  return rows.values || [];
}

async function softDelete(db, id) {
  await db.run(`UPDATE entries SET deleted_at = ? WHERE id = ?`, [Date.now(), id]);
}

async function purgeOldTrash(db) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rows = await db.query(`SELECT id FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < ?`, [cutoff]);
  for (const row of (rows.values || [])) {
    await db.run(`DELETE FROM entries_fts WHERE id = ?`, [row.id]);
    await db.run(`DELETE FROM entry_tags WHERE entry_id = ?`, [row.id]); // explicit — ON DELETE CASCADE needs
    await db.run(`DELETE FROM entries WHERE id = ?`, [row.id]);          // PRAGMA foreign_keys=ON, not set here
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

export { initDb, insertEntry, searchEntries, softDelete, purgeOldTrash, listAllTags, SCHEMA_SQL };
