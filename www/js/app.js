// app.js — bootstraps the app: auth gate -> ad gate -> main UI.
// This is a scaffold showing the control flow and key logic (expense follow-up timeout,
// capture-to-intent pipeline, digest). Wire up to your actual DOM/UI framework of choice.

import { initDb, insertEntry, searchEntries, softDelete, purgeOldTrash, listAllTags } from './db.js';
import { hashPassword, verifyPassword, deriveAesKey, encryptPrivateNote } from './crypto.js';
import { detectIntent, suggestLabel } from './intents.js';
import { scheduleReminder, requestPermissions, registerActionTypes } from './notifications.js';
import { runDailyAdGateIfDue } from './ads.js';
import { ALL_CATEGORIES, createBackup, restoreBackup } from './backup.js';
import {
  ensureSignedIn, signOut, backupToDrive, listDriveBackups, previewDriveBackup,
  restoreFromDrive, checkAndRunAutoBackupIfDue
} from './gdrive.js';

const EXPENSE_FOLLOWUP_TIMEOUT_MS = 15000; // "what did you spend for?" — auto-save uncategorized if unanswered

const CATEGORY_LABELS = {
  notes: 'Notes', private_notes: 'Private Notes', voice: 'Voice', images: 'Images', pdfs: 'PDFs',
  files: 'Files', expenses: 'Expenses', reminders: 'Reminders', tags: 'Tags', app_settings: 'App Settings'
};

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
  await checkAutoBackupOnOpen(); // after unlock, after main UI — never blocks getting into the app
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

// ---- Backup & Restore UI (local — Phase 6) ----
function renderCategoryCheckboxes(containerId, idPrefix) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = ALL_CATEGORIES.map((cat) => `
    <label>
      <input type="checkbox" class="${idPrefix}-cat" value="${cat}" checked />
      ${CATEGORY_LABELS[cat] || cat}
    </label>
  `).join('');
}

function getCheckedCategories(idPrefix) {
  return Array.from(document.querySelectorAll(`.${idPrefix}-cat:checked`)).map((el) => el.value);
}

async function handleBackupNow() {
  const statusEl = document.getElementById('backup-status');
  const passphrase = document.getElementById('backup-passphrase').value;
  const hint = document.getElementById('backup-hint').value;
  const categories = getCheckedCategories('backup');
  if (!passphrase) { statusEl.textContent = 'Enter a backup passkey first.'; return; }
  if (categories.length === 0) { statusEl.textContent = 'Select at least one category.'; return; }

  statusEl.textContent = 'Checking storage…';
  const result = await createBackup(db, { passphrase, hint, categories });
  if (!result.ok && result.reason === 'insufficient_storage') {
    statusEl.textContent = `Not enough space: needs ~${formatBytes(result.requiredBytes)}, ` +
      `${formatBytes(result.availableBytes)} available.`;
    return;
  }
  statusEl.textContent = result.ok
    ? `Saved as ${result.path}.`
    : `Backup failed: ${result.reason || 'unknown error'}.`;
}

// Shared by both local restore and Drive restore — shows the overwrite warning dialog when needed,
// resolves to { proceed, takeSafetyBackup } once the person decides.
function confirmOverwriteIfNeeded(mode) {
  if (mode !== 'overwrite') return Promise.resolve({ proceed: true, takeSafetyBackup: false });
  return new Promise((resolve) => {
    const dialog = document.getElementById('overwrite-confirm-dialog');
    const safetyCheckbox = document.getElementById('safety-backup-checkbox');
    dialog.classList.remove('hidden');
    const cleanup = () => {
      dialog.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };
    const confirmBtn = document.getElementById('overwrite-confirm-btn');
    const cancelBtn = document.getElementById('overwrite-cancel-btn');
    const onConfirm = () => { cleanup(); resolve({ proceed: true, takeSafetyBackup: safetyCheckbox.checked }); };
    const onCancel = () => { cleanup(); resolve({ proceed: false }); };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

async function handleLocalRestore() {
  const statusEl = document.getElementById('restore-status');
  const fileInput = document.getElementById('restore-file-input');
  const passphrase = document.getElementById('restore-passphrase').value;
  const categories = getCheckedCategories('restore');
  const mode = document.querySelector('input[name="restore-mode"]:checked').value;

  if (!fileInput.files[0]) { statusEl.textContent = 'Choose a backup file first.'; return; }
  if (!passphrase) { statusEl.textContent = 'Enter the backup passkey.'; return; }
  if (categories.length === 0) { statusEl.textContent = 'Select at least one category.'; return; }

  const { proceed, takeSafetyBackup } = await confirmOverwriteIfNeeded(mode);
  if (!proceed) { statusEl.textContent = 'Restore cancelled.'; return; }

  statusEl.textContent = 'Reading file…';
  // Read via the browser File API directly rather than @capacitor/filesystem — a picked file's
  // content:// URI isn't a plain Filesystem path, and restoreBackup() accepts a parsed archiveObj
  // either way, so there's nothing Filesystem-specific to gain here.
  const text = await fileInput.files[0].text();
  let archiveObj;
  try { archiveObj = JSON.parse(text); } catch { statusEl.textContent = 'Not a valid backup file.'; return; }

  statusEl.textContent = 'Restoring…';
  const result = await restoreBackup(db, {
    passphrase, archiveObj, mode, categories, takeSafetyBackup, confirmedDestructive: true
  });
  statusEl.textContent = result.ok
    ? `Done — added ${result.summary.added}, skipped ${result.summary.skippedExactDup} exact duplicates, ` +
      `${result.summary.restoredLabeled} restored under "(Restored)".`
    : `Restore failed: ${result.reason || 'unknown error'}.`;
}

function formatBytes(n) {
  if (n === null || n === undefined) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Google Drive backup UI (optional, opt-in — Phase 13) ----
async function refreshDriveConnectionView() {
  const disconnectedView = document.getElementById('drive-disconnected-view');
  const connectedView = document.getElementById('drive-connected-view');
  const auth = await ensureSignedIn({ silent: true }); // never prompts here — just checks cached consent
  disconnectedView.classList.toggle('hidden', auth.ok);
  connectedView.classList.toggle('hidden', !auth.ok);
  if (!auth.ok) return;

  document.getElementById('drive-account-email').textContent = auth.email;
  document.getElementById('auto-backup-toggle').checked = (await metaGet('auto_backup_enabled', 'false')) === 'true';
  document.getElementById('auto-backup-frequency').value = await metaGet('auto_backup_frequency', 'weekly');
  await renderDriveBackupList(auth.accessToken);
}

async function renderDriveBackupList(accessToken) {
  const listEl = document.getElementById('drive-backup-list');
  const backups = await listDriveBackups(accessToken);
  if (backups.length === 0) { listEl.textContent = 'No backups on Drive yet.'; return; }
  listEl.innerHTML = backups.map((b) => `
    <div class="drive-backup-row">
      <span>${b.name} — ${new Date(b.createdTime).toLocaleDateString()}</span>
      <button class="drive-restore-btn" data-file-id="${b.id}">Restore</button>
    </div>
  `).join('');
  listEl.querySelectorAll('.drive-restore-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDriveRestore(btn.dataset.fileId, accessToken));
  });
}

async function handleDriveRestore(fileId, accessToken) {
  const statusEl = document.getElementById('drive-backup-status');
  const passphrase = prompt('Backup passkey for this Drive backup:'); // one-off, not stored anywhere
  if (!passphrase) return;

  let preview;
  try { preview = await previewDriveBackup(accessToken, fileId, passphrase); }
  catch { statusEl.textContent = 'Wrong passkey or corrupted backup.'; return; }

  const categories = preview.categories; // restore everything the backup contains, same as opening a local file with all boxes checked
  const mode = confirm(
    `This backup has: ${categories.map((c) => CATEGORY_LABELS[c] || c).join(', ')}. ` +
    `Click OK to Append (safe, adds to existing data), Cancel to choose Overwrite instead.`
  ) ? 'append' : 'overwrite';

  const { proceed, takeSafetyBackup } = await confirmOverwriteIfNeeded(mode);
  if (!proceed) { statusEl.textContent = 'Restore cancelled.'; return; }

  statusEl.textContent = 'Restoring from Drive…';
  const result = await restoreFromDrive(db, {
    accessToken, fileId, passphrase, mode, categories, takeSafetyBackup, confirmedDestructive: true
  });
  statusEl.textContent = result.ok
    ? `Done — added ${result.summary.added}, skipped ${result.summary.skippedExactDup} exact duplicates.`
    : `Restore failed: ${result.reason || 'unknown error'}.`;
}

async function handleDriveBackupNow() {
  const statusEl = document.getElementById('drive-backup-status');
  const passphrase = prompt('Backup passkey (never stored — needed for this upload only):');
  if (!passphrase) return;
  statusEl.textContent = 'Checking Drive storage…';
  const result = await backupToDrive(db, { passphrase, categories: ALL_CATEGORIES });
  if (!result.ok && result.reason === 'insufficient_drive_storage') {
    statusEl.textContent = `Not enough Drive space: needs ~${formatBytes(result.requiredBytes)}, ` +
      `${formatBytes(result.availableBytes)} available.`;
    return;
  }
  statusEl.textContent = result.ok ? `Uploaded ${result.name}.` : `Upload failed: ${result.reason}.`;
  if (result.ok) await refreshDriveConnectionView();
}

// Runs once per app open/resume, after unlock. Never silent about needing the passkey (Decision 32) —
// the passkey is never stored, so a due auto-backup shows a one-tap banner instead of failing quietly
// or trying to cache the passkey across sessions.
async function checkAutoBackupOnOpen() {
  const banner = document.getElementById('auto-backup-due-banner');
  const result = await checkAndRunAutoBackupIfDue(db, {
    categories: ALL_CATEGORIES,
    passphraseGetter: () => new Promise((resolve) => {
      banner.classList.remove('hidden');
      const input = document.getElementById('auto-backup-passphrase-input');
      const runBtn = document.getElementById('auto-backup-run-btn');
      const skipBtn = document.getElementById('auto-backup-skip-btn');
      const cleanup = () => {
        banner.classList.add('hidden');
        runBtn.removeEventListener('click', onRun);
        skipBtn.removeEventListener('click', onSkip);
      };
      const onRun = () => { const v = input.value; cleanup(); resolve(v || null); };
      const onSkip = () => { cleanup(); resolve(null); };
      runBtn.addEventListener('click', onRun);
      skipBtn.addEventListener('click', onSkip);
    })
  });
  // Surface anything other than a clean run or an expected skip in drive-backup-status, even though
  // that panel likely isn't open right now — better found later than lost entirely.
  if (!result.ok || (result.ok && !result.skipped)) {
    const statusEl = document.getElementById('drive-backup-status');
    if (!result.ok) statusEl.textContent = `Auto-backup failed: ${result.reason || 'unknown error'}.`;
    else if (result.fileId) statusEl.textContent = `Auto-backup uploaded ${result.name}.`;
  }
}

window.Dumpzone = {
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

  // Backup & Restore (local) wiring
  renderCategoryCheckboxes('backup-categories', 'backup');
  renderCategoryCheckboxes('restore-categories', 'restore');
  document.getElementById('backup-now-btn').addEventListener('click', handleBackupNow);
  document.getElementById('restore-btn').addEventListener('click', handleLocalRestore);

  // Google Drive backup wiring — off by default, nothing here runs until the person opts in
  document.getElementById('drive-connect-btn').addEventListener('click', async () => {
    await ensureSignedIn({ silent: false }); // shows Google's own sign-in UI on first connect
    await refreshDriveConnectionView();
  });
  document.getElementById('drive-disconnect-btn').addEventListener('click', async () => {
    await signOut();
    await metaSet('auto_backup_enabled', 'false'); // disconnecting implies no more unattended uploads
    await refreshDriveConnectionView();
  });
  document.getElementById('drive-backup-now-btn').addEventListener('click', handleDriveBackupNow);
  document.getElementById('auto-backup-toggle').addEventListener('change', (e) => metaSet('auto_backup_enabled', e.target.checked ? 'true' : 'false'));
  document.getElementById('auto-backup-frequency').addEventListener('change', (e) => metaSet('auto_backup_frequency', e.target.value));
  await refreshDriveConnectionView(); // silent — reflects existing connection state, never prompts on load
});
