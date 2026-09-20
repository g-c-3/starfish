// app.js — bootstraps the app: auth gate -> ad gate -> main UI.
// This is a scaffold showing the control flow and key logic (expense follow-up timeout,
// capture-to-intent pipeline, digest). Wire up to your actual DOM/UI framework of choice.

import { initDb, insertEntry, searchEntries, softDelete, listTrash, restoreFromTrash, permanentlyDeleteEntry, purgeOldTrash, listAllTags } from './db.js';
import { hashPassword, verifyPassword, deriveAesKey } from './crypto.js';
import { detectIntent, suggestLabel } from './intents.js';
import { scheduleReminder, requestPermissions, registerActionTypes } from './notifications.js';
import { runDailyAdGateIfDue } from './ads.js';
import { ALL_CATEGORIES, createBackup, restoreBackup } from './backup.js';
import {
  ensureSignedIn, signOut, backupToDrive, listDriveBackups, previewDriveBackup,
  restoreFromDrive, checkAndRunAutoBackupIfDue
} from './gdrive.js';
import { importAppendZips, getSelectableEntries, runBulkAction, shareEntry, downloadPlain, downloadForAppend, editEntry } from './fileactions.js';
import { VAULT_TYPES, saveVaultEntry, loadVaultEntryContent, base64ToBlobUrl, buildVaultIndex, getVaultIndex, clearVaultIndex, searchVaultIndex, vaultLabelSuggestions } from './vault.js';

const EXPENSE_FOLLOWUP_TIMEOUT_MS = 15000; // "what did you spend for?" — auto-save uncategorized if unanswered

const CATEGORY_LABELS = {
  notes: 'Notes', private_vault: 'Private Vault', voice: 'Voice', images: 'Images', pdfs: 'PDFs',
  files: 'Files', expenses: 'Expenses', reminders: 'Reminders', tags: 'Tags', app_settings: 'App Settings'
};
const VAULT_TYPE_LABELS = { note: 'Text', voice: 'Voice', image: 'Image', pdf: 'PDF', file: 'Files' };

let db;
let privateSessionKey = null; // set only after vault PIN unlock, cleared on vault lock/background
let vaultAutoLockTimer = null;

// ---- Screen visibility — nothing wired this before now; every screen built across every
// session has been unreachable until this existed. One helper, hides all .screen elements,
// shows the one requested. ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

async function bootstrap() {
  const { CapacitorSQLite, SQLiteConnection } = window.sqlitePlugin || {};
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  db = await initDb(sqlite);

  applyAppearance(await getAppearance()); // apply theme before rendering the lock screen

  await requestPermissions();
  await registerActionTypes();
  await purgeOldTrash(db); // purges BOTH bins — same 30-day rule, filtered by is_private only when listing

  await showLockScreen();
}

// ---- Auth gate — app-open password is optional ("quick access"); Vault PIN is separate and unaffected ----
async function showLockScreen() {
  const row = await db.query(`SELECT app_password_hash, app_password_salt FROM credentials WHERE id=1`);

  if (!row.values || row.values.length === 0) {
    window.needsFirstRunSetup = true; // UI renders the setup screen and calls completeFirstRunSetup()
    showScreen('first-run-setup');
    return { firstRun: true };
  }

  const { app_password_hash, app_password_salt } = row.values[0];
  if (!app_password_hash) {
    await onUnlocked(); // "quick access" — no password was set, skip the lock screen UI entirely
    return { quickAccess: true };
  }

  showScreen('lock-screen');
  window.attemptUnlock = async (password) => {
    const ok = await verifyPassword(password, app_password_hash, app_password_salt);
    if (ok) { await onUnlocked(); return { success: true }; }
    return { success: false };
  };
}

// appPassword/vaultPin: either or both may be null/empty — the app-open password is optional from
// first run (pivot); the vault only exists once its PIN is set, but that can happen later too
// (Settings), not necessarily during first-run setup.
window.completeFirstRunSetup = async ({ appPassword = null, appPasswordHint = '', vaultPin = null, vaultPinHint = '' }) => {
  let passwordHash = null, passwordSalt = null;
  if (appPassword) ({ hash: passwordHash, salt: passwordSalt } = await hashPassword(appPassword));

  let pinHash = null, pinSalt = null;
  if (vaultPin) ({ hash: pinHash, salt: pinSalt } = await hashPassword(vaultPin));

  await db.run(
    `INSERT INTO credentials (id, app_password_hash, app_password_salt, app_password_hint,
      private_pin_hash, private_pin_salt, private_pin_hint) VALUES (1,?,?,?,?,?,?)`,
    [passwordHash, passwordSalt, appPasswordHint || null, pinHash, pinSalt, vaultPinHint || null]
  );
  await onUnlocked();
};

// Settings-time add/remove — independent of first-run, so "quick access" can be turned on or off later.
async function setAppPassword(newPassword, hint = '') {
  const { hash, salt } = await hashPassword(newPassword);
  await db.run(`UPDATE credentials SET app_password_hash=?, app_password_salt=?, app_password_hint=? WHERE id=1`, [hash, salt, hint]);
}
async function removeAppPassword() {
  await db.run(`UPDATE credentials SET app_password_hash=NULL, app_password_salt=NULL, app_password_hint=NULL WHERE id=1`);
}

async function onUnlocked() {
  showScreen('main-screen');
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
  if (isPrivate) {
    // Delegates to the vault's own save path rather than duplicating it — one way to create a
    // private text entry, not two that could quietly drift apart (this was the pre-vault-pivot
    // private-notes path; kept as a thin wrapper so existing callers of saveNote(..., {isPrivate}) don't break).
    return captureToVault({ type: 'note', label: label || text.slice(0, 40), tags, text });
  }
  const id = crypto.randomUUID();
  await insertEntry(db, { id, type: 'note', label: label || text.slice(0, 40), body_text: text });
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
// ---- Private Vault: its own PIN, its own unlock session, its own auto-lock timer — all
// independent of the app-open password (three credentials stay independent, ARCHITECTURE §3) ----
async function setupVaultPin(pin, hint = '') {
  const { hash, salt } = await hashPassword(pin);
  await db.run(`UPDATE credentials SET private_pin_hash=?, private_pin_salt=?, private_pin_hint=? WHERE id=1`, [hash, salt, hint]);
}

async function unlockVault(pin) {
  const row = await db.query(`SELECT private_pin_hash, private_pin_salt FROM credentials WHERE id=1`);
  if (!row.values[0] || !row.values[0].private_pin_hash) return { setupNeeded: true };
  const { private_pin_hash, private_pin_salt } = row.values[0];
  const ok = await verifyPassword(pin, private_pin_hash, private_pin_salt);
  if (!ok) return { success: false };
  const { key } = await deriveAesKey(pin, private_pin_salt);
  privateSessionKey = key;
  await buildVaultIndex(db, privateSessionKey); // in-memory only — see vault.js
  armVaultAutoLock();
  return { success: true };
}

function lockVault() {
  privateSessionKey = null;
  clearVaultIndex();
  if (vaultAutoLockTimer) clearTimeout(vaultAutoLockTimer);
  vaultAutoLockTimer = null;
}

// Called on unlock and on any vault activity (app.js's vault UI handlers should call this on
// capture/search/browse) — a separate timer from whatever the app-level lock uses, per-spec
// ("separate auto lock after certain time"), read from its own column, not auto_lock_minutes.
async function armVaultAutoLock() {
  if (vaultAutoLockTimer) clearTimeout(vaultAutoLockTimer);
  const row = await db.query(`SELECT vault_auto_lock_minutes FROM credentials WHERE id=1`);
  const minutes = row.values[0]?.vault_auto_lock_minutes ?? 5;
  vaultAutoLockTimer = setTimeout(() => lockVault(), minutes * 60 * 1000);
}

async function setVaultAutoLockMinutes(minutes) {
  await db.run(`UPDATE credentials SET vault_auto_lock_minutes=? WHERE id=1`, [minutes]);
  if (privateSessionKey) armVaultAutoLock(); // re-arm immediately with the new duration if already unlocked
}

async function showMainTimeline() {
  // Hand off to your actual UI rendering — timeline query example:
  const rows = await db.query(
    `SELECT * FROM entries WHERE deleted_at IS NULL AND is_private=0 ORDER BY created_at DESC LIMIT 100`
  );
  return rows.values || [];
}

// ---- Private Vault: capture + browse — deliberately mirrors captureText/showMainTimeline's shape,
// since spec asks for the vault to be "an exact replica of the home screen function" apart from what
// stays private-at-rest and the Share/Download restriction being lifted (both, same as non-vault). ----
async function captureToVault({ type, label, tags = [], text, fileData, extension, ocrText, autoCategory }) {
  if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before capturing');
  armVaultAutoLock(); // any activity resets the vault's own timer, independent of the app-level one
  const id = await saveVaultEntry(db, privateSessionKey, { type, label, tags, text, fileData, extension, ocrText, autoCategory });
  await buildVaultIndex(db, privateSessionKey); // rebuild so the new item is immediately searchable/listed
  return id;
}

// type: one of VAULT_TYPES, or 'all' for the combined view — mirrors the vault's own tabs (Text/
// Voice/Image/PDF/Files/All). Reads the in-memory index, not the DB directly, since sizes/searchable
// text are already there and re-decrypting per browse would be wasteful.
function browseVault(type = 'all') {
  if (!privateSessionKey) throw new Error('Vault locked');
  armVaultAutoLock();
  const index = getVaultIndex() || [];
  return type === 'all' ? index : index.filter((e) => e.type === type);
}

function searchVault(term) {
  if (!privateSessionKey) throw new Error('Vault locked');
  armVaultAutoLock();
  return searchVaultIndex(term);
}

async function openVaultEntry(entryId) {
  if (!privateSessionKey) throw new Error('Vault locked');
  armVaultAutoLock();
  const { row, content } = await loadVaultEntryContent(db, privateSessionKey, entryId);
  if (row.type === 'note') return { row, text: content.text };
  const blobUrl = base64ToBlobUrl(content.fileData, mimeTypeForVaultRow(row));
  return { row, blobUrl, ocrText: content.ocrText }; // caller must URL.revokeObjectURL(blobUrl) when done
}
function mimeTypeForVaultRow(row) {
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
  return byExt[row.extension] || 'application/octet-stream';
}

// ---- Trash — two independent bins (main + vault), same soft-delete/30-day rule, filtered by
// is_private only (db.js's listTrash/restoreFromTrash/permanentlyDeleteEntry are shared, generic
// functions; nothing vault-specific lives in them). Restore + permanent delete for both, per spec. ----
async function showTrash() { return listTrash(db, { isPrivate: false }); }
async function showVaultTrash() {
  if (!privateSessionKey) throw new Error('Vault locked');
  return listTrash(db, { isPrivate: true });
}
async function restoreEntry(id) {
  await restoreFromTrash(db, id);
  if (privateSessionKey) await buildVaultIndex(db, privateSessionKey); // covers the vault-trash case; harmless no-op otherwise
}
async function permanentlyDelete(id) {
  await permanentlyDeleteEntry(db, id);
  if (privateSessionKey) await buildVaultIndex(db, privateSessionKey);
}
// Vault items specifically need the in-memory index rebuilt after a soft-delete too, or the item
// keeps appearing in browseVault()/searchVault() until the next unlock rebuilds it — the index has
// no other way to learn a row it already cached is now gone.
async function deleteVaultEntry(id) {
  await softDelete(db, id);
  if (privateSessionKey) await buildVaultIndex(db, privateSessionKey);
}

// ---- "Select files" multi-select screen — one shared implementation for both main and vault
// (spec: "every single thing in non private will be exactly replicated in private vault") ----
async function getSelectableGroups() {
  return getSelectableEntries(db, { vaultIndex: privateSessionKey ? getVaultIndex() : null });
}
async function runBulkFileAction(action, entryIds, extraOpts = {}) {
  if (vaultAutoLockTimer) armVaultAutoLock(); // bulk-acting on vault items counts as activity too
  const results = await runBulkAction(db, action, entryIds, { privateSessionKey, ...extraOpts });
  // Same reason as deleteVaultEntry() above: a bulk delete can include vault items, and the
  // in-memory index has no way to notice a row it cached got soft-deleted except a rebuild.
  if (action === 'delete' && privateSessionKey) await buildVaultIndex(db, privateSessionKey);
  return results;
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

// ---- Append files from download (Phase 7) — always append mode, no overwrite option here ----
// prompt()/confirm() again for the one-off passphrase/PIN, same known rough edge as the Drive
// flows (ROADMAP) — a batch of individually-downloaded zips can each need a different passkey or
// the private-notes PIN, so a single upfront input wouldn't cover every file in the selection.
async function handleAppendImport() {
  const statusEl = document.getElementById('append-import-status');
  const fileInput = document.getElementById('append-import-input');
  if (!fileInput.files.length) { statusEl.textContent = 'Choose one or more files first.'; return; }

  statusEl.textContent = 'Importing…';
  const report = await importAppendZips(db, fileInput.files, {
    passphraseGetter: (hint) => Promise.resolve(
      prompt(hint ? `Backup passkey (hint: ${hint}):` : 'Backup passkey:')
    ),
    pinGetter: () => Promise.resolve(prompt('Private-notes PIN for this file:'))
  });

  let msg = `Processed ${report.filesProcessed} of ${fileInput.files.length} — ` +
    `added ${report.added}, skipped ${report.skippedExactDup} duplicates, ${report.restoredLabeled} "(Restored)".`;
  if (report.errors.length > 0) {
    msg += ` ${report.errors.length} failed: ${report.errors.map((e) => `${e.file} (${e.error})`).join('; ')}.`;
  }
  statusEl.textContent = msg;
}

window.Dumpzone = {
  bootstrap, captureText, saveNote, batchAddWithCommonLabel,
  search: (q) => searchEntries(db, q),
  softDelete: (id) => softDelete(db, id), restoreEntry, permanentlyDelete, showTrash,
  listAllTags: () => listAllTags(db),
  getAppearance, setDarkMode, setGradientMode,
  setAppPassword, removeAppPassword,
  // Private Vault — unlockVault/lockVault replace the old unlockPrivateNotes/lockPrivateNotes names
  // (this pivot generalized "private notes" into the full vault; nothing shipped yet to keep the old
  // names for, so a clean rename rather than an alias).
  setupVaultPin, unlockVault, lockVault, setVaultAutoLockMinutes,
  captureToVault, browseVault, searchVault, openVaultEntry, showVaultTrash,
  vaultLabelSuggestions: (type, partial) => vaultLabelSuggestions(type, partial),
  // Per-file actions — identical set for vault and non-vault (pivot); caller passes privateSessionKey
  // only when acting on a vault item, these functions no-op that param otherwise.
  shareEntry: (id) => shareEntry(db, id, { privateSessionKey }),
  downloadPlain: (id) => downloadPlain(db, id, { privateSessionKey }),
  downloadForAppend: (id, opts) => downloadForAppend(db, id, opts),
  editEntry: (id, fields, opts) => editEntry(db, id, fields, { ...opts, privateSessionKey }),
  getSelectableGroups, runBulkFileAction
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

  document.getElementById('append-import-btn').addEventListener('click', handleAppendImport);

  // ---- First-run setup / lock screen ----
  document.getElementById('first-run-continue-btn').addEventListener('click', async () => {
    await window.completeFirstRunSetup({
      appPassword: document.getElementById('setup-app-password').value || null,
      appPasswordHint: document.getElementById('setup-app-password-hint').value,
      vaultPin: document.getElementById('setup-vault-pin').value || null,
      vaultPinHint: document.getElementById('setup-vault-pin-hint').value
    });
  });
  document.getElementById('unlock-btn').addEventListener('click', async () => {
    const result = await window.attemptUnlock(document.getElementById('password-input').value);
    if (!result.success) document.getElementById('password-hint').textContent = 'Wrong password.';
  });

  // ---- Trash (main) ----
  async function renderTrash() {
    const items = await showTrash();
    document.getElementById('trash-list').innerHTML = items.map((row) => `
      <div class="drive-backup-row">
        <span>${row.label} (${row.type})</span>
        <span>
          <button class="restore-btn" data-id="${row.id}">Restore</button>
          <button class="perm-delete-btn warning-text" data-id="${row.id}">Delete permanently</button>
        </span>
      </div>
    `).join('') || 'Trash is empty.';
    document.querySelectorAll('#trash-list .restore-btn').forEach((b) => b.addEventListener('click', async () => {
      await window.restoreEntry(b.dataset.id); await renderTrash();
    }));
    document.querySelectorAll('#trash-list .perm-delete-btn').forEach((b) => b.addEventListener('click', async () => {
      if (confirm('Delete permanently? This cannot be undone.')) { await window.permanentlyDelete(b.dataset.id); await renderTrash(); }
    }));
  }
  document.getElementById('trash-settings').addEventListener('toggle', (e) => { if (e.target.open) renderTrash(); });

  // ---- Private Vault ----
  async function refreshVaultGateView() {
    const cred = await db.query(`SELECT private_pin_hash FROM credentials WHERE id=1`);
    const needsSetup = !cred.values[0]?.private_pin_hash;
    document.getElementById('vault-pin-setup-view').classList.toggle('hidden', !needsSetup);
    document.getElementById('vault-locked-view').classList.toggle('hidden', needsSetup);
  }
  document.getElementById('vault-setup-pin-btn').addEventListener('click', async () => {
    await setupVaultPin(document.getElementById('vault-setup-pin-input').value, document.getElementById('vault-setup-pin-hint-input').value);
    await refreshVaultGateView();
  });
  document.getElementById('vault-unlock-btn').addEventListener('click', async () => {
    const result = await unlockVault(document.getElementById('vault-pin-input').value);
    if (result.success) { showScreen('vault-screen'); await renderVaultList('all'); }
    else if (result.setupNeeded) await refreshVaultGateView();
    else alert('Wrong PIN.');
  });
  document.getElementById('vault-lock-btn').addEventListener('click', () => {
    lockVault();
    showScreen('main-screen');
  });
  await refreshVaultGateView();

  document.querySelectorAll('#vault-tabs .vault-tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('#vault-tabs .vault-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    renderVaultList(tab.dataset.vaultTab);
  }));

  async function renderVaultList(typeOrAll) {
    const items = browseVault(typeOrAll);
    document.getElementById('vault-list').innerHTML = items.map((e) => `
      <div class="drive-backup-row">
        <span>${e.label} (${VAULT_TYPE_LABELS[e.type]}, ${formatBytes(e.sizeBytes)})</span>
        <span>
          <button class="vault-share-btn" data-id="${e.id}">Share</button>
          <button class="vault-download-btn" data-id="${e.id}">Download</button>
          <button class="vault-append-btn" data-id="${e.id}">Download for append</button>
          <button class="vault-delete-btn warning-text" data-id="${e.id}">Delete</button>
        </span>
      </div>
    `).join('') || 'Nothing here yet.';

    document.querySelectorAll('.vault-share-btn').forEach((b) => b.addEventListener('click', () => window.shareEntry(b.dataset.id)));
    document.querySelectorAll('.vault-download-btn').forEach((b) => b.addEventListener('click', () => window.downloadPlain(b.dataset.id)));
    document.querySelectorAll('.vault-append-btn').forEach((b) => b.addEventListener('click', async () => {
      const pin = prompt('Vault PIN (required for Download for append):');
      if (pin) await window.downloadForAppend(b.dataset.id, { pin });
    }));
    document.querySelectorAll('.vault-delete-btn').forEach((b) => b.addEventListener('click', async () => {
      await deleteVaultEntry(b.dataset.id); await renderVaultList(typeOrAll);
    }));
  }

  document.getElementById('vault-search-input').addEventListener('input', (e) => {
    const term = e.target.value;
    const items = term ? searchVault(term) : browseVault('all');
    document.getElementById('vault-list').innerHTML = items.map((e2) => `<div class="drive-backup-row"><span>${e2.label} (${VAULT_TYPE_LABELS[e2.type]})</span></div>`).join('') || 'No matches.';
  });

  document.querySelectorAll('#vault-capture-bar button').forEach((btn) => btn.addEventListener('click', async () => {
    const type = btn.dataset.vaultType;
    if (type === 'note') {
      const text = prompt('Vault note text:');
      if (text) { await captureToVault({ type: 'note', label: text.slice(0, 40), text }); await renderVaultList('all'); }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const fileData = await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.readAsDataURL(file); });
        await captureToVault({ type, label: file.name, fileData, extension: file.name.split('.').pop() });
        await renderVaultList('all');
      };
      input.click();
    }
  }));

  async function renderVaultTrash() {
    const items = await showVaultTrash();
    document.getElementById('vault-trash-list').innerHTML = items.map((row) => `
      <div class="drive-backup-row">
        <span>${row.label} (${VAULT_TYPE_LABELS[row.type]})</span>
        <span>
          <button class="vault-restore-btn" data-id="${row.id}">Restore</button>
          <button class="vault-perm-delete-btn warning-text" data-id="${row.id}">Delete permanently</button>
        </span>
      </div>
    `).join('') || 'Vault trash is empty.';
    document.querySelectorAll('.vault-restore-btn').forEach((b) => b.addEventListener('click', async () => { await restoreEntry(b.dataset.id); await renderVaultTrash(); }));
    document.querySelectorAll('.vault-perm-delete-btn').forEach((b) => b.addEventListener('click', async () => {
      if (confirm('Delete permanently? This cannot be undone.')) { await permanentlyDelete(b.dataset.id); await renderVaultTrash(); }
    }));
  }
  document.getElementById('vault-trash-settings').addEventListener('toggle', (e) => { if (e.target.open) renderVaultTrash(); });

  document.getElementById('vault-auto-lock-select').addEventListener('change', (e) => setVaultAutoLockMinutes(Number(e.target.value)));

  // ---- Select files (multi-select, shared by main + vault) ----
  let selectedIds = new Set();
  async function openSelectFiles() {
    selectedIds = new Set();
    const groups = await getSelectableGroups();
    const container = document.getElementById('select-files-groups');
    container.innerHTML = Object.entries(groups).map(([cat, items]) => `
      <div class="select-files-category" data-cat="${cat}">
        <div class="select-files-category-header">
          <input type="checkbox" class="cat-select-all" data-cat="${cat}" />
          <span>${CATEGORY_LABELS[cat] || cat} (${items.length})</span>
        </div>
        ${items.map((it) => `
          <div class="select-files-item">
            <label><input type="checkbox" class="item-select" data-id="${it.id}" /> ${it.label}</label>
            <span class="file-size">${formatBytes(it.sizeBytes)}</span>
          </div>
        `).join('')}
      </div>
    `).join('') || 'Nothing to select yet.';

    container.querySelectorAll('.cat-select-all').forEach((catBox) => catBox.addEventListener('change', () => {
      const group = container.querySelector(`.select-files-category[data-cat="${catBox.dataset.cat}"]`);
      group.querySelectorAll('.item-select').forEach((cb) => { cb.checked = catBox.checked; toggleId(cb.dataset.id, catBox.checked); });
    }));
    container.querySelectorAll('.item-select').forEach((cb) => cb.addEventListener('change', () => toggleId(cb.dataset.id, cb.checked)));

    document.getElementById('select-files-screen').classList.remove('hidden');
  }
  function toggleId(id, on) { if (on) selectedIds.add(id); else selectedIds.delete(id); }

  document.getElementById('select-files-btn').addEventListener('click', openSelectFiles);
  document.getElementById('vault-select-files-btn').addEventListener('click', openSelectFiles);
  document.getElementById('select-files-close-btn').addEventListener('click', () => document.getElementById('select-files-screen').classList.add('hidden'));

  async function runSelectedBulk(action) {
    const statusEl = document.getElementById('select-files-status');
    if (selectedIds.size === 0) { statusEl.textContent = 'Nothing selected.'; return; }
    if (action === 'delete' && !confirm(`Delete ${selectedIds.size} item(s)? They go to trash, not permanent.`)) return;
    // download_append needs a PIN for any vault items in the selection — prompted once upfront
    // rather than per-item; harmless/unused if nothing selected turns out to be a vault entry.
    let extraOpts = {};
    if (action === 'download_append') {
      const pin = prompt('Vault PIN (only needed if any selected items are in the Vault):');
      extraOpts = { pin: pin || undefined };
    }
    statusEl.textContent = 'Working…';
    const results = await runBulkFileAction(action, [...selectedIds], extraOpts);
    const failed = results.filter((r) => !r.ok);
    statusEl.textContent = `Done — ${results.length - failed.length} succeeded, ${failed.length} failed.` +
      (failed.length ? ` (${failed.map((f) => f.error).join('; ')})` : '');
  }
  document.getElementById('select-files-share-btn').addEventListener('click', () => runSelectedBulk('share'));
  document.getElementById('select-files-download-btn').addEventListener('click', () => runSelectedBulk('download'));
  document.getElementById('select-files-append-btn').addEventListener('click', () => runSelectedBulk('download_append'));
  document.getElementById('select-files-delete-btn').addEventListener('click', () => runSelectedBulk('delete'));
});