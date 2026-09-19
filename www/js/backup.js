// backup.js — full & selective backup/restore. No network calls; everything reads/writes
// device storage via @capacitor/filesystem and encrypts via crypto.js (AES-GCM/PBKDF2).
//
// Archive format (single JSON file, AES-GCM encrypted as a whole by crypto.encryptBackup):
//   { schemaVersion, createdAt, categories: [...], entries: [...], tags: [...], settings: {...} }
// entries[].fileData is base64 file bytes for voice/image/pdf/file categories (present only when
// that category was included). This is the SAME schema a per-file "download for append" export
// uses for its single-entry sidecar (see Decision 9) — one shared shape, two write paths.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { encryptBackup, decryptBackup } from './crypto.js';

const SCHEMA_VERSION = 1;
const FILES_DIR = 'files'; // Directory.Data/files/<uuid>.<ext> — where captured file bytes live on-device

// Categories are independent selectable units. Notes/Private Notes are both type='note',
// split by is_private. Tags and App Settings have no per-entry rows.
const ENTRY_CATEGORIES = {
  notes: (e) => e.type === 'note' && !e.is_private,
  private_notes: (e) => e.type === 'note' && e.is_private,
  voice: (e) => e.type === 'voice',
  images: (e) => e.type === 'image',
  pdfs: (e) => e.type === 'pdf',
  files: (e) => e.type === 'file',
  expenses: (e) => e.type === 'expense',
  reminders: (e) => e.type === 'reminder'
};
const FILE_BEARING_CATEGORIES = new Set(['voice', 'images', 'pdfs', 'files']);
const ALL_CATEGORIES = [...Object.keys(ENTRY_CATEGORIES), 'tags', 'app_settings'];

const APP_SETTINGS_KEYS = [
  'dark_mode', 'gradient_mode', 'gradient_color_1', 'gradient_color_2'
]; // non-sensitive only — never credential hashes/salts/hints (Decision 8)

// ---------------------------------------------------------------------------
// Storage sanity checks — navigator.storage.estimate() is the practical in-webview substitute
// for a device free-space API; Capacitor core has no dedicated one. Treated as an estimate,
// not an exact figure, and labeled as such wherever shown.
// ---------------------------------------------------------------------------
async function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { availableBytes: Math.max(0, quota - usage) };
  }
  return { availableBytes: null }; // unknown — caller should not hard-block on null
}

// ---------------------------------------------------------------------------
// Building a backup payload
// ---------------------------------------------------------------------------
async function readFileBase64(filePath) {
  const res = await Filesystem.readFile({ path: filePath, directory: Directory.Data });
  return res.data; // already base64
}

async function buildBackupPayload(db, categories) {
  const wantAll = (name) => categories.includes(name);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    categories: [...categories],
    entries: [],
    tags: [],
    settings: {}
  };

  const entryCategoryNames = Object.keys(ENTRY_CATEGORIES).filter(wantAll);
  if (entryCategoryNames.length > 0) {
    const rows = (await db.query(`SELECT * FROM entries WHERE deleted_at IS NULL`)).values || [];
    for (const row of rows) {
      const cat = entryCategoryNames.find((c) => ENTRY_CATEGORIES[c](row));
      if (!cat) continue;
      const out = { ...row, _category: cat };
      if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
        out.fileData = await readFileBase64(row.file_path); // raw bytes travel with the entry
      }
      const tagRows = (await db.query(
        `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ?`,
        [row.id]
      )).values || [];
      out.tags = tagRows.map((t) => t.name); // entry_tags is a join table, not a column — carried separately
      payload.entries.push(out);
    }
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
// Create + write a backup file
// ---------------------------------------------------------------------------
async function createBackup(db, { passphrase, hint = '', categories = ALL_CATEGORIES, fileName }) {
  const required = await estimateBackupSize(db, categories);
  const { availableBytes } = await getStorageEstimate();
  if (availableBytes !== null && required > availableBytes) {
    return { ok: false, reason: 'insufficient_storage', requiredBytes: required, availableBytes };
  }

  const payload = await buildBackupPayload(db, categories);
  const archive = await encryptBackup(passphrase, JSON.stringify(payload), hint);
  const name = fileName || `dumpzone-backup-${Date.now()}.dzbackup`;

  await Filesystem.writeFile({
    path: name,
    directory: Directory.Documents,
    data: JSON.stringify(archive),
    encoding: 'utf8'
  });

  await db.run(`UPDATE credentials SET last_backup_at = ? WHERE id = 1`, [Date.now()]); // single-row table, not meta

  return { ok: true, path: name, requiredBytes: required };
}

// ---------------------------------------------------------------------------
// Reading + decrypting a backup file (does not touch the DB)
// ---------------------------------------------------------------------------
async function openBackupFile(path, directory = Directory.Documents) {
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
    if (e.fileData) bytes += Math.ceil(e.fileData.length * 0.75); // base64 → raw byte estimate
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------
// opts: {
//   passphrase, archiveObj, mode: 'append' | 'overwrite', categories,
//   takeSafetyBackup: bool, confirmedDestructive: bool (required if mode='overwrite' && !takeSafetyBackup),
//   sourcePin: string|null (only if private_notes selected and encrypted under a different PIN),
//   currentPrivateKey: CryptoKey|null (this device's active PIN-derived key, for re-encrypting)
// }
async function restoreBackup(db, opts) {
  const { passphrase, archiveObj, mode, categories, takeSafetyBackup, confirmedDestructive } = opts;

  const payload = await decryptBackupPayload(passphrase, archiveObj); // proves validity before anything destructive

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

  if (mode === 'overwrite') {
    for (const cat of categories.filter((c) => ENTRY_CATEGORIES[c])) {
      const predicate = ENTRY_CATEGORIES[cat];
      const rows = (await db.query(`SELECT id FROM entries WHERE deleted_at IS NULL`)).values || [];
      for (const row of rows) {
        const full = (await db.query(`SELECT * FROM entries WHERE id=?`, [row.id])).values[0];
        if (predicate(full)) {
          await db.run(`DELETE FROM entries_fts WHERE id=?`, [row.id]);
          await db.run(`DELETE FROM entry_tags WHERE entry_id=?`, [row.id]); // cascade not relied on — see db.js
          await db.run(`DELETE FROM entries WHERE id=?`, [row.id]);
        }
      }
    }
  }

  for (const entry of payload.entries.filter((e) => categories.includes(e._category))) {
    let targetId = entry.id;
    let label = entry.label;

    if (mode === 'append') {
      const existing = (await db.query(`SELECT id FROM entries WHERE id=?`, [entry.id])).values || [];
      if (existing.length > 0) {
        summary.skippedExactDup += 1;
        continue; // exact UUID match — caller can offer "restore anyway" as a forced re-run with a fresh UUID
      }
      const labelMatch = (await db.query(
        `SELECT id FROM entries WHERE label=? AND id != ?`, [entry.label, entry.id]
      )).values || [];
      if (labelMatch.length > 0) {
        targetId = crypto.randomUUID();
        label = `${entry.label} (Restored)`;
        summary.restoredLabeled += 1;
      }
    }

    let bodyText = entry.body_text;
    let encryptedBody = entry.encrypted_body;
    if (entry._category === 'private_notes' && opts.sourcePin && opts.currentPrivateKey) {
      // Cross-device/PIN append: decrypt under the source PIN, re-encrypt under this device's active key
      // so every private note in the live DB ends up under one consistent key (see ARCHITECTURE §4).
      const { decryptPrivateNote, encryptPrivateNote, deriveAesKey } = await import('./crypto.js');
      const { key: sourceKey } = await deriveAesKey(opts.sourcePin, entry._sourcePinSalt);
      const plain = await decryptPrivateNote(sourceKey, entry.encrypted_body);
      encryptedBody = await encryptPrivateNote(opts.currentPrivateKey, plain);
    }

    if (entry.fileData) {
      const ext = entry.extension || (entry.file_path || '').split('.').pop() || 'bin';
      const fileName = `${FILES_DIR}/${targetId}.${ext}`;
      await Filesystem.writeFile({ path: fileName, directory: Directory.Data, data: entry.fileData, recursive: true });
      entry.file_path = fileName;
    }

    await db.run(
      `INSERT INTO entries (id, type, label, body_text, is_private, encrypted_body, file_path, extension,
        auto_category, noise_reduction, latitude, longitude, amount, expense_category, replied,
        fire_at, repeat_rule, snoozed_until, notified, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [targetId, entry.type, label, bodyText, entry.is_private || 0, encryptedBody, entry.file_path,
       entry.extension, entry.auto_category, entry.noise_reduction, entry.latitude, entry.longitude,
       entry.amount, entry.expense_category, entry.replied ?? 1, entry.fire_at, entry.repeat_rule,
       entry.snoozed_until, entry.notified || 0, entry.created_at || Date.now(), Date.now()]
    );
    const indexableBody = (!entry.is_private && bodyText) ? bodyText : '';
    await db.run(`INSERT INTO entries_fts (id, label, body_text) VALUES (?,?,?)`, [targetId, label, indexableBody]);
    await db.run(
      `INSERT INTO label_history (type, label) VALUES (?,?)
       ON CONFLICT(type, label) DO UPDATE SET use_count = use_count + 1`,
      [entry.type, label]
    );
    for (const tagName of entry.tags || []) {
      await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [tagName]);
      const tagRow = (await db.query(`SELECT id FROM tags WHERE name = ?`, [tagName])).values[0];
      await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [targetId, tagRow.id]);
    }
    summary.added += 1;
  }

  if (categories.includes('tags')) {
    for (const t of payload.tags) {
      await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [t.name]);
      summary.tagsAdded += 1;
    }
  }

  if (categories.includes('app_settings')) {
    for (const [key, value] of Object.entries(payload.settings)) {
      await db.run(
        `INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [key, value]
      );
    }
    summary.settingsRestored = true;
  }

  return { ok: true, summary };
}

// ---------------------------------------------------------------------------
// Extract to device storage — no DB import, raw files + sidecar only.
// ---------------------------------------------------------------------------
async function extractCategoryToStorage(payload, category, destDir = 'Dumpzone-Restore') {
  const entries = payload.entries.filter((e) => e._category === category && e.fileData);
  const written = [];
  for (const e of entries) {
    const ext = e.extension || (e.file_path || '').split('.').pop() || 'bin';
    const fileName = `${destDir}/${e.id}.${ext}`;
    await Filesystem.writeFile({ path: fileName, directory: Directory.Documents, data: e.fileData, recursive: true });
    const sidecar = { id: e.id, label: e.label, type: e.type, tags: e.tags || [], created_at: e.created_at, category };
    await Filesystem.writeFile({
      path: `${destDir}/${e.id}.json`, directory: Directory.Documents,
      data: JSON.stringify(sidecar), encoding: 'utf8'
    });
    written.push(fileName);
  }
  return written;
}

export {
  ALL_CATEGORIES, ENTRY_CATEGORIES, FILE_BEARING_CATEGORIES,
  buildBackupPayload, estimateBackupSize, createBackup,
  openBackupFile, decryptBackupPayload, estimateRestoreSize, restoreBackup,
  extractCategoryToStorage, getStorageEstimate
};
