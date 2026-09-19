// app.js — bootstraps the app: auth gate -> ad gate -> main UI.
// This is a scaffold showing the control flow and key logic (expense follow-up timeout,
// capture-to-intent pipeline, digest). Wire up to your actual DOM/UI framework of choice.

import { initDb, insertEntry, searchEntries, softDelete, purgeOldTrash, listAllTags } from './db.js';
import { hashPassword, verifyPassword, deriveAesKey, encryptPrivateNote } from './crypto.js';
import { detectIntent, suggestLabel } from './intents.js';
import { scheduleReminder, requestPermissions, registerActionTypes } from './notifications.js';
import { runDailyAdGateIfDue } from './ads.js';

const EXPENSE_FOLLOWUP_TIMEOUT_MS = 15000; // "what did you spend for?" — auto-save uncategorized if unanswered

let db;
let privateSessionKey = null; // set only after PIN unlock, cleared on lock/background

async function bootstrap() {
  const { CapacitorSQLite, SQLiteConnection } = window.sqlitePlugin || {};
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  db = await initDb(sqlite);

  applyAppearance(await getAppearance()); // apply theme before rendering the lock screen

  await requestPermissions();
  await registerActionTypes();
  await purgeOldTrash(db);

  await showLockScreen();
}

// ---- Auth gate ----
async function showLockScreen() {
  // UI calls this with the typed password
  window.attemptUnlock = async (password) => {
    const row = await db.query(`SELECT app_password_hash, app_password_salt FROM credentials WHERE id=1`);
    if (!row.values || row.values.length === 0) {
      return { firstRun: true }; // no password set yet — route to setup
    }
    const { app_password_hash, app_password_salt } = row.values[0];
    const ok = await verifyPassword(password, app_password_hash, app_password_salt);
    if (ok) {
      await onUnlocked();
      return { success: true };
    }
    return { success: false };
  };
}

async function onUnlocked() {
  const metaStore = {
    get: async (k) => {
      const r = await db.query(`SELECT value FROM meta WHERE key=?`, [k]);
      return r.values && r.values[0] ? r.values[0].value : null;
    },
    set: async (k, v) => db.run(
      `INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [k, v]
    )
  };

  // Ad gate BEFORE main UI — but never blocks if no ad available (see ads.js).
  await runDailyAdGateIfDue(window.adSdk, metaStore);

  await showDigest();
  await showMainTimeline();
}

// ---- Digest (home screen summary) ----
async function showDigest() {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const rows = await db.query(
    `SELECT type, COUNT(*) as cnt, SUM(amount) as total FROM entries
     WHERE created_at >= ? AND deleted_at IS NULL GROUP BY type`,
    [startOfDay.getTime()]
  );
  return rows.values || [];
}

// ---- Capture pipeline: any text-producing input (typed, OCR, voice label) flows through here ----
async function captureText(rawText, sourceType = 'note', extra = {}) {
  const intent = detectIntent(rawText);

  if (intent && intent.handler === 'reminder') {
    const partial = { id: crypto.randomUUID(), ...buildFromHandler('reminder', intent.data) };
    await insertEntry(db, partial);
    await scheduleReminder(partial);
    return partial;
  }

  if (intent && intent.handler === 'expense') {
    const id = crypto.randomUUID();
    const partial = { id, ...buildFromHandler('expense', intent.data) };
    await insertEntry(db, partial);

    if (!intent.data.category) {
      // Ask "what did you spend for?" — if no reply within timeout, it's already saved as uncategorized.
      promptExpenseFollowup(id);
    }
    return partial;
  }

  // Plain note (or private note) fallback
  return saveNote(rawText, extra);
}

function buildFromHandler(name, data) {
  // pulls the buildEntry() output from the matching handler — kept simple here since
  // intents.js's registerIntentHandler already stores handlers internally.
  if (name === 'reminder') return { type: 'reminder', label: data.label, fire_at: data.fire_at, repeat_rule: null };
  if (name === 'expense') return {
    type: 'expense',
    label: data.category ? `Expense: ${data.category}` : 'Expense: uncategorized',
    amount: data.amount,
    expense_category: data.category || 'uncategorized',
    replied: data.replied ? 1 : 0
  };
}

function promptExpenseFollowup(entryId) {
  // UI shows a small inline prompt: "What did you spend this on?"
  // Wire this to your actual UI; below is the timeout-driven fallback contract.
  const timer = setTimeout(async () => {
    // No reply in time — entry already saved as 'uncategorized', nothing further to do.
    // (Left here as an explicit hook in case you want to log a "missed-followup" flag.)
  }, EXPENSE_FOLLOWUP_TIMEOUT_MS);

  window.onExpenseFollowupReply = async (category) => {
    clearTimeout(timer);
    await db.run(
      `UPDATE entries SET expense_category=?, label=?, replied=1, updated_at=? WHERE id=?`,
      [category, `Expense: ${category}`, Date.now(), entryId]
    );
    await db.run(`UPDATE entries_fts SET label=? WHERE id=?`, [`Expense: ${category}`, entryId]);
  };
}

// ---- Notes (including private notes) ----
async function saveNote(text, { isPrivate = false, label, tags = [] } = {}) {
  const id = crypto.randomUUID();
  if (isPrivate) {
    if (!privateSessionKey) throw new Error('Private notes locked — unlock with PIN first');
    const encrypted = await encryptPrivateNote(privateSessionKey, text);
    await insertEntry(db, {
      id, type: 'note', label: label || 'Private note', is_private: 1,
      encrypted_body: encrypted, body_text: null
    });
  } else {
    await insertEntry(db, { id, type: 'note', label: label || text.slice(0, 40), body_text: text });
  }
  await applyTags(id, tags);
  return id;
}

async function applyTags(entryId, tagNames) {
  for (const name of tagNames) {
    await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [name]);
    const row = await db.query(`SELECT id FROM tags WHERE name=?`, [name]);
    const tagId = row.values[0].id;
    await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [entryId, tagId]);
  }
}

// ---- Batch add: one common label + auto-numbering for multi-select Image/PDF/Generic File captures ----
// files: array of { type, file_path, extension?, auto_category?, ocr_text? } already staged by the picker.
// Numbering continues from label_history rather than restarting at 1, so a later batch with the same
// baseLabel picks up where the previous one left off (e.g. "Invoice 4" after an earlier "Invoice 1..3").
async function batchAddWithCommonLabel(type, baseLabel, files, tags = []) {
  const historyRow = await db.query(
    `SELECT use_count FROM label_history WHERE type=? AND label=?`,
    [type, baseLabel]
  );
  let n = (historyRow.values && historyRow.values[0]) ? historyRow.values[0].use_count : 0;

  const createdIds = [];
  for (const file of files) {
    n += 1;
    const id = crypto.randomUUID();
    await insertEntry(db, {
      id, type,
      label: `${baseLabel} ${n}`,
      body_text: file.ocr_text || null,
      file_path: file.file_path,
      extension: file.extension || null,
      auto_category: file.auto_category || null
    });
    await applyTags(id, tags);
    createdIds.push(id);
  }

  // Collapse to one running counter per (type, baseLabel) rather than one row per numbered variant.
  await db.run(
    `INSERT INTO label_history (type, label, use_count) VALUES (?,?,?)
     ON CONFLICT(type, label) DO UPDATE SET use_count = ?`,
    [type, baseLabel, n, n]
  );

  return createdIds; // caller shows: "N files added as '<baseLabel> 1' .. '<baseLabel> N>'"
}

// ---- Private notes unlock (independent PIN, own derived key) ----
async function unlockPrivateNotes(pin) {
  const row = await db.query(`SELECT private_pin_hash, private_pin_salt FROM credentials WHERE id=1`);
  if (!row.values[0] || !row.values[0].private_pin_hash) return { setupNeeded: true };
  const { private_pin_hash, private_pin_salt } = row.values[0];
  const ok = await verifyPassword(pin, private_pin_hash, private_pin_salt);
  if (!ok) return { success: false };
  const { key } = await deriveAesKey(pin, private_pin_salt);
  privateSessionKey = key;
  return { success: true };
}

function lockPrivateNotes() {
  privateSessionKey = null;
}

async function showMainTimeline() {
  // Hand off to your actual UI rendering — timeline query example:
  const rows = await db.query(
    `SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`
  );
  return rows.values || [];
}

// ---- Appearance: dark mode + gradient mode (both stored in the generic `meta` table, no schema
// change needed; both fall under the App Settings backup category). Purely cosmetic — never gates
// any feature or data access. ----
async function metaGet(key, fallback = null) {
  const r = await db.query(`SELECT value FROM meta WHERE key=?`, [key]);
  return (r.values && r.values[0]) ? r.values[0].value : fallback;
}
async function metaSet(key, value) {
  await db.run(
    `INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, value]
  );
}

async function getAppearance() {
  return {
    darkMode: (await metaGet('dark_mode', 'off')) === 'on',
    gradientMode: (await metaGet('gradient_mode', 'off')) === 'on',
    gradientColor1: await metaGet('gradient_color_1', '#488AFF'),
    gradientColor2: await metaGet('gradient_color_2', '#FF6B9D')
  };
}

function applyAppearance({ darkMode, gradientMode, gradientColor1, gradientColor2 }) {
  const root = document.documentElement;
  root.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  root.setAttribute('data-gradient', gradientMode ? 'on' : 'off');
  // Same color for both is valid — collapses to a single-tone glow, not an error case.
  root.style.setProperty('--gradient-1', gradientColor1);
  root.style.setProperty('--gradient-2', gradientColor2);
}

async function setDarkMode(on) {
  await metaSet('dark_mode', on ? 'on' : 'off');
  applyAppearance(await getAppearance());
}

async function setGradientMode(on, color1 = null, color2 = null) {
  await metaSet('gradient_mode', on ? 'on' : 'off');
  if (color1) await metaSet('gradient_color_1', color1);
  if (color2) await metaSet('gradient_color_2', color2); // color2 === color1 is a valid, supported choice
  applyAppearance(await getAppearance());
}

window.Actioner = {
  bootstrap, captureText, saveNote, batchAddWithCommonLabel, unlockPrivateNotes, lockPrivateNotes,
  search: (q) => searchEntries(db, q), softDelete: (id) => softDelete(db, id),
  listAllTags: () => listAllTags(db),
  getAppearance, setDarkMode, setGradientMode
};

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrap();

  // Appearance settings UI wiring — populate controls from stored state, then wire changes back.
  const appearance = await getAppearance();
  const darkToggle = document.getElementById('dark-mode-toggle');
  const gradToggle = document.getElementById('gradient-mode-toggle');
  const gradPickers = document.getElementById('gradient-color-pickers');
  const color1Input = document.getElementById('gradient-color-1');
  const color2Input = document.getElementById('gradient-color-2');

  if (darkToggle) {
    darkToggle.checked = appearance.darkMode;
    darkToggle.addEventListener('change', (e) => setDarkMode(e.target.checked));
  }
  if (gradToggle && gradPickers) {
    gradToggle.checked = appearance.gradientMode;
    gradPickers.classList.toggle('hidden', !appearance.gradientMode);
    gradToggle.addEventListener('change', (e) => {
      gradPickers.classList.toggle('hidden', !e.target.checked);
      setGradientMode(e.target.checked, color1Input.value, color2Input.value);
    });
  }
  if (color1Input && color2Input) {
    color1Input.value = appearance.gradientColor1;
    color2Input.value = appearance.gradientColor2;
    const onColorChange = () => setGradientMode(gradToggle.checked, color1Input.value, color2Input.value);
    color1Input.addEventListener('input', onColorChange);
    color2Input.addEventListener('input', onColorChange); // identical values to color1 are valid, not an error
  }
});
