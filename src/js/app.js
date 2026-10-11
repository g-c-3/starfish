// app.js — bootstraps the app: auth gate -> ad gate -> main UI.
// Control flow and key logic: auth gate, capture pipeline, folders, viewers, Money, Vault.

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { initDb, getEncryptionStatus, requestEncryption, getEncryptionResult, insertEntry, searchEntries, softDelete, listTrash, restoreFromTrash, permanentlyDeleteEntry, purgeOldTrash, listAllTags, listLabelHistory, listTagsForScope, MAX_TAGS } from './db.js';
import { hashPassword, verifyPassword, needsRehash, PASSWORD_HASH_ITERATIONS, deriveAesKey } from './crypto.js';
import { detectIntent, suggestLabel } from './intents.js';
import { retireOldChannel, scheduleReminder, refillRepeatingReminders, cancelReminder, cancelSnooze, snoozeReminder, listenForReminderActions, requestPermissions, registerActionTypes } from './notifications.js';
import { reminderStatus, reminderNextDue, isReminderActive, repeatLabel } from './reminders.js';
// ads.js import removed here — no longer called from anywhere (see onUnlocked()). The module
// itself is untouched, kept as Phase 12 scaffolding for a future build.
import { ALL_CATEGORIES, createBackup, restoreBackup, readBackupHeader } from './backup.js';
import {
  ensureSignedIn, signOut, backupToDrive, listDriveBackups, previewDriveBackup,
  restoreFromDrive, checkAndRunAutoBackupIfDue
} from './gdrive.js';
import { getSelectableEntries, runBulkAction, shareEntry, downloadPlain, editEntry } from './fileactions.js';
import * as Money from './money.js';
import { openMoneyForm, openRepayDialog } from './moneyui.js';
import { checkForUpdate } from './update-check.js';
import { downloadAndInstallUpdate, purgeUpdateDownload } from './update-install.js';
import { openStoredFile, openDecryptedFile, purgeOpenCopies } from './fileopen.js';
import { initFiles, migratePlainFiles, saveBase64, readBytes as readEntryBytes } from './files.js';
import { base64ToBytes, pdfErrorMessage } from './pdfmath.js';
import { weakness } from './passcheck.js';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Geolocation } from '@capacitor/geolocation';
import { parseCoordinates, resolveShortLink } from './geoparse.js';
import { VoiceRecorder } from 'cap-voice-rec';
import { isBiometricAvailable, enableBiometric, disableBiometric, unlockWithBiometric } from './biometric.js';
import { setPrivacyScreen } from './privacy-screen.js';
import { setHapticsEnabled, haptic, testHaptics } from './haptics.js';
import { PERIODS, browse, typeCounts, toolbarHtml, bindToolbar } from './browse.js';
import { VAULT_TYPES, vaultRowLabel, saveVaultEntry, loadVaultEntryContent, base64ToBlobUrl, buildVaultIndex, refreshVaultIndexEntries, getVaultIndex, clearVaultIndex, searchVaultIndex, vaultLabelSuggestions } from './vault.js';


const CATEGORY_LABELS = {
  notes: 'Notes', private_vault: 'Private Vault', voice: 'Voice', images: 'Images', pdfs: 'PDFs',
  reminders: 'Reminders', locations: 'Locations', money: 'Money', files: 'Files', expenses: 'Expenses', tags: 'Tags', app_settings: 'App Settings'
};
const VAULT_TYPE_LABELS = { note: 'Text', voice: 'Voice', image: 'Image', pdf: 'PDF', reminder: 'Reminder', location: 'Location', money: 'Money', file: 'Files' };

let db;
let privateSessionKey = null; // set only after vault PIN unlock, cleared on vault lock/background
let vaultBioAutoPrompted = false; // avoids re-triggering the OS biometric prompt on every re-render while still locked — reset whenever the vault (re)locks, so the next fresh "locked" state prompts again
let vaultAutoLockTimer = null;
let appAutoLockTimer = null;
// Set immediately before launching a system picker (file chooser, share sheet, etc.) that we
// expect a result back from. Launching one pauses our Activity exactly the same way backgrounding
// does — appStateChange can't tell "user opened a picker we ourselves triggered" apart from "user
// switched away" (Decision 73) — so this is the one narrow signal that lets registerBackgroundLock
// skip its immediate lock for that specific pause/resume pair, and only that one.
let expectingPickerReturn = false;

// ---- Universal back button (Decisions 65, 82) — hierarchical, not a history or a toggle. Back goes
// up one level inside the section you are in (Home or Vault) and stops at that section's landing
// page; it never jumps between Home and Vault. "Location" is one of 'home' | 'settings' | 'vault';
// recordLocation() is called from inside showScreen()/switchMainTab() themselves, so every caller
// keeps it current. backAction() is the single place that says what Back would do right now (or
// null at a landing page, where the button is dimmed and does nothing).
let currentLocation = 'home';
function recordLocation(loc) {
  currentLocation = loc;
  updateBackButtonState();
}

// ---- Screen visibility — nothing wired this before now; every screen built across every
// session has been unreachable until this existed. One helper, hides all .screen elements,
// shows the one requested. ----
const NAV_SCREENS = { 'main-screen': 'home', 'vault-screen': 'vault' }; // which screens the bottom nav covers, and which tab that maps to by default

// Typed credentials never outlive the screen that took them (Decision 94). Called when either lock engages and
// right after a successful unlock.
function clearSecretInputs(ids = null) {
  const els = ids ? ids.map((id) => document.getElementById(id)) : document.querySelectorAll('input[type="password"]');
  els.forEach((el) => { if (el) el.value = ''; });
}
// When the app last came to the foreground (module load counts: a cold start from a notification button). Used to tell
// a launch caused by a notification button from the person already using the app (Decision 100).
let lastResumeAt = Date.now();
const NOTIFICATION_LAUNCH_WINDOW_MS = 6000;
const VAULT_SECRET_INPUT_IDS = ['vault-pin-input', 'vault-setup-pin-input', 'vault-biometric-confirm-pin'];

function showScreen(id, { tab } = {}) {
  exitSelection();
  if (id === 'lock-screen') { dismissOverlays(false); closeStaticModals(); clearSecretInputs(); document.getElementById('password-hint').textContent = ''; } // an open editor/dialog must never sit above the lock screen; no typed password may remain
  if (id !== 'main-screen' || searchMode === 'vault') closeSearchScreen({ instant: true }); // the layer must not sit over the Vault, the lock screen or Settings
  if (id === 'lock-screen') closeTrash();
  document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');

  // Power button (Decision 61) is present on every screen except the app-open lock screen
  // (Decision 62) — removed there on request; every other screen, including first-run and the
  // Vault's own PIN gate, still shows it.
  document.getElementById('power-close-btn')?.classList.toggle('hidden', id === 'lock-screen');

  // Lock/unlock toggle (Decision 65; disabled-state + first-run exclusion added in Decision 66) —
  // hidden on the app-open lock screen (same as the power button) and on first-run setup — there's
  // no password to lock yet at that point, so showing it there would be actively misleading, not
  // just redundant. The Vault's own locked-gate substate is a third, separate exclusion handled
  // inside refreshVaultGateView() below, since vault-screen doesn't change id when its internal
  // gate/content view toggles.
  document.getElementById('lock-toggle-btn')?.classList.toggle('hidden', id === 'lock-screen' || id === 'first-run-setup');

  if (id === 'vault-screen') recordLocation('vault');

  // Bottom nav only makes sense once the app is unlocked (main-screen/vault-screen) — hidden for
  // first-run, the lock screen, and the ad gate, which have nothing to navigate between yet.
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const navKey = NAV_SCREENS[id];
  // Back stays visible on every screen (Decision 104); Home/Vault tabs only where they navigate.
  nav.classList.remove('hidden');
  nav.classList.toggle('back-only', !navKey);
  // Defaults to Home (e.g. every unlock-success call site just says showScreen('main-screen'), and
  // expects Home) — an explicit tab (from the bottom nav) overrides that default.
  if (id === 'main-screen') switchMainTab(tab || 'home');
  else if (navKey) setActiveNavTab(navKey);
  updateBackButtonState();
}

// Lock/unlock toggle's "disabled" appearance (Decision 66) — only meaningful in the main-app
// context; the Vault always has its own PIN by the time this button is ever shown for it (it's
// hidden on the Vault's own locked/setup gate — see refreshVaultGateView()), so there vaultContext
// just clears any stale disabled state unconditionally rather than re-checking anything. Fired
// without awaiting at each call site (switchMainTab()/refreshVaultGateView()) — this only updates
// a visual/interactive class, nothing downstream depends on it having finished.
async function updateLockButtonDisabledState(vaultContext) {
  const btn = document.getElementById('lock-toggle-btn');
  if (!btn) return;
  if (vaultContext) { btn.classList.remove('disabled'); return; }
  const cred = (await db.query(`SELECT app_password_hash FROM credentials WHERE id=1`)).values[0];
  // Quick access (no app-open password) has nothing for this button to lock — same reasoning
  // app-lock-settings' own description already states ("quick access has nothing to lock back
  // to"), just made visible on the button itself now instead of only in Settings' copy.
  btn.classList.toggle('disabled', !cred?.app_password_hash);
}

// Home/Settings are two panels inside #main-screen (not separate .screen elements — switching
// between them shouldn't re-run bootstrap-style setup) — see Decision 53, replacing the previous
// single long scrolling page of stacked <details> settings sections. Settings stopped being a
// third bottom-nav tab itself (Decision 61) — it's reached via the "App Settings" tile inside Home
// instead, so the nav only ever needs to distinguish Home vs Vault.
function switchMainTab(tab) {
  document.getElementById('home-tab')?.classList.toggle('hidden', tab !== 'home');
  document.getElementById('settings-tab')?.classList.toggle('hidden', tab !== 'settings');
  // Settings is conceptually part of Home now (reached via its tile, not its own nav destination),
  // so the Home nav icon stays highlighted while viewing it rather than nothing being highlighted.
  setActiveNavTab(tab === 'settings' ? 'home' : tab);
  recordLocation(tab === 'settings' ? 'settings' : 'home');
  updateLockButtonDisabledState(false);
}

let moneyMonth = null; // { y, m } month shown in the Money folder header; null means the current month
let vaultMoneyMonth = null; // same for the Vault Money folder (Decision 135)
let openFolderType = null; // which Home folder (card type) is open, or null for the card grid (Decision 81)
function closeFolder() {
  exitSelection();
  openFolderType = null;
  document.getElementById('folder-view')?.classList.add('hidden');
  document.getElementById('home-main')?.classList.remove('hidden');
  updateBackButtonState();
}

// ---- Home overlays (Decision 146): Trash is a folder-like view; Search is a full-screen layer that grows out of its tile. ----
let trashOpen = false;
function closeTrash() {
  if (!trashOpen) return;
  trashOpen = false;
  document.getElementById('trash-view')?.classList.add('hidden');
  document.getElementById('home-main')?.classList.remove('hidden');
  updateBackButtonState();
}
let searchOpen = false;
let searchMode = 'home'; // 'home' or 'vault': one layer, two sources (Decision 147)
let searchRows = []; // module-level so a close or a Vault lock empties it
let searchOriginId = 'open-search-btn';
let searchCloseTimer = null;
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function morphTo(bar, rect) { // the bar's own box, squeezed over `rect`; its content is hidden while it travels
  const to = bar.getBoundingClientRect();
  bar.style.transform = `translate(${rect.left - to.left}px, ${rect.top - to.top}px) scale(${rect.width / to.width}, ${rect.height / to.height})`;
}
function openSearchScreen(fromEl, mode = 'home') {
  const scr = document.getElementById('search-screen'), bar = document.getElementById('search-bar'), input = document.getElementById('search-input');
  if (!scr || !bar || !input || searchOpen) return;
  searchOpen = true;
  searchMode = mode;
  searchOriginId = mode === 'vault' ? 'vault-open-search-btn' : 'open-search-btn';
  input.placeholder = mode === 'vault' ? 'Search the Vault…' : 'Search everything…';
  clearTimeout(searchCloseTimer);
  document.body.classList.add('overlay-open');
  bar.style.transition = 'none';
  bar.style.transform = 'none';
  scr.classList.remove('hidden');
  input.focus({ preventScroll: true }); // inside the tap, so the keyboard rises with the bar
  updateBackButtonState();
  if (!fromEl || reducedMotion()) { scr.classList.add('open'); return; }
  morphTo(bar, fromEl.getBoundingClientRect());
  void bar.offsetWidth; // commits the start frame before the transition is set
  bar.style.transition = 'transform 0.42s cubic-bezier(0.2, 0.85, 0.25, 1)';
  bar.style.transform = 'none';
  scr.classList.add('open');
}
function closeSearchScreen({ instant = false } = {}) {
  if (!searchOpen) return;
  searchOpen = false;
  document.body.classList.remove('overlay-open');
  const scr = document.getElementById('search-screen'), bar = document.getElementById('search-bar'), input = document.getElementById('search-input');
  input?.blur();
  updateBackButtonState();
  const finish = () => {
    scr.classList.add('hidden'); scr.classList.remove('open');
    input.value = '';
    searchRows = [];
    searchMode = 'home';
    document.getElementById('timeline').innerHTML = '';
    document.getElementById('search-toolbar').innerHTML = '';
    bar.style.transition = ''; bar.style.transform = '';
  };
  const tile = document.getElementById(searchOriginId);
  if (instant || reducedMotion() || !tile || !tile.offsetParent) { finish(); return; }
  bar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.6, 1)';
  morphTo(bar, tile.getBoundingClientRect());
  scr.classList.remove('open');
  clearTimeout(searchCloseTimer);
  searchCloseTimer = setTimeout(finish, 320);
}

// Delete permanently with Undo: the row leaves the list at once, the real delete waits for the Undo window (Decision 148).
let pendingPurge = null; // { id, timer }
async function flushPurge() {
  if (!pendingPurge) return;
  const { id, timer } = pendingPurge;
  pendingPurge = null;
  clearTimeout(timer);
  try { await permanentlyDelete(id); } catch { /* already gone */ }
}
let vaultTrashOpen = false;
let vaultTrashRows = []; // decrypted labels live here only while the Vault Trash is open
function closeVaultTrash() {
  vaultTrashRows = [];
  const list = document.getElementById('vault-trash-list'), bar = document.getElementById('vault-trash-toolbar');
  if (list) list.innerHTML = '';
  if (bar) bar.innerHTML = '';
  if (!vaultTrashOpen) return;
  vaultTrashOpen = false;
  document.getElementById('vault-trash-view')?.classList.add('hidden');
  document.getElementById('vault-main')?.classList.remove('hidden');
  updateBackButtonState();
}
let vaultSettingsOpen = false;
function closeVaultSettings() {
  if (!vaultSettingsOpen) return;
  vaultSettingsOpen = false;
  document.getElementById('vault-settings-view')?.classList.add('hidden');
  document.getElementById('vault-main')?.classList.remove('hidden');
  updateBackButtonState();
}
let openVaultFolderType = null; // which Vault folder (card type) is open, or null for the card grid (Decision 85)
function closeVaultFolder() {
  exitSelection();
  openVaultFolderType = null;
  vaultMoneyMonth = null;
  const vms = document.getElementById('vault-money-summary'); // amounts must not stay in the page once the folder closes or the Vault locks
  if (vms) { vms.classList.add('hidden'); vms.innerHTML = ''; }
  document.getElementById('vault-folder-view')?.classList.add('hidden');
  document.getElementById('vault-main')?.classList.remove('hidden');
  updateBackButtonState();
}

// One level up inside the current section, or null when already on its landing page (Decision 82).
//   Home:  Settings -> Home landing; open folder -> Home landing; Home landing -> nothing.
//   Vault: open folder or open Vault Settings card -> Vault landing; Vault landing (or locked gate) -> nothing.
// Static modals and the button that dismisses each one (Decision 104). Listed top-most first by the order Back checks them.
const BACK_MODALS = [
  ['coords-dialog', 'coords-cancel-btn'],
  ['loc-source-dialog', 'loc-source-cancel-btn'],
  ['overwrite-confirm-dialog', 'overwrite-cancel-btn'],
  ['new-chooser-modal', 'new-chooser-cancel-btn'],
  ['auto-backup-due-banner', 'auto-backup-skip-btn'],
  ['select-files-screen', 'select-files-close-btn']
];
function openModalDismiss() {
  for (const [id, btn] of BACK_MODALS) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden')) continue;
    const typed = MODAL_PENDING[id] && document.getElementById(MODAL_PENDING[id]);
    return async () => {
      if (typed && typed.value && !(await askDiscard())) return;
      document.getElementById(btn)?.click();
    };
  }
  return null;
}
// App lock: every static overlay (z-index above the lock screen) is dismissed with its own Cancel/Skip, and the Select files
// list, which can hold Vault item names, is emptied. Without this they stayed on top of the lock screen.
function closeStaticModals() {
  for (const [id, btn] of BACK_MODALS) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) document.getElementById(btn)?.click();
  }
  const groups = document.getElementById('select-files-groups');
  if (groups) groups.innerHTML = '';
}
// Fields that hold typed-but-unused input (Decision 133). A modal's field guards that modal; Settings fields guard leaving Settings.
const MODAL_PENDING = { 'auto-backup-due-banner': 'auto-backup-passphrase-input' };
const SETTINGS_PENDING = ['backup-passphrase', 'backup-hint', 'restore-passphrase', 'restore-file-input', 'currency-custom', 'app-biometric-confirm-password'];
const VAULT_SETTINGS_PENDING = ['vault-biometric-confirm-pin'];
async function leaveIfClean(ids) {
  const fields = ids.map((id) => document.getElementById(id)).filter((el) => el && el.value);
  if (fields.length && !(await askDiscard())) return false;
  fields.forEach((el) => { el.value = ''; });
  return true;
}

// ---- Multi-select inside a folder or a search list: long press a row to start (Decision 122). ----
let selection = null; // { isVault, ids: Set } while selecting, else null
const SELECTABLE_ROOTS = ['folder-list', 'timeline', 'vault-folder-list'];
function paintSelection() {
  const ids = selection ? selection.ids : null;
  for (const rootId of SELECTABLE_ROOTS) {
    document.getElementById(rootId)?.querySelectorAll('.entry-row, .thumb-tile')
      .forEach((el) => el.classList.toggle('is-selected', !!ids && ids.has(el.dataset.id)));
  }
  const count = document.getElementById('sel-count');
  if (count) count.textContent = ids ? `${ids.size} selected` : '';
  document.querySelectorAll('#select-bar .sel-act').forEach((b) => { b.disabled = !ids || ids.size === 0; });
}
function exitSelection() {
  if (!selection) return;
  selection = null;
  document.body.classList.remove('selecting');
  document.getElementById('select-bar')?.classList.add('hidden');
  paintSelection();
  updateBackButtonState();
}

function backAction() {
  if (activeYesNo) return () => activeYesNo.finish(false); // Back answers No; checked before the dialog it sits over
  if (activeText) return () => activeText.finish(null); // Back cancels the text sheet
  if (activeCompose) return () => activeCompose.finish(null); // Back cancels the order sheet
  if (activeMoney) return () => activeMoney.leave(); // Back = Cancel on the Money form and repayment dialog; asks Discard when changed (Decisions 132, 133)
  if (selection) return exitSelection; // Back leaves selection mode first (Decision 122)
  if (activeSaveDialog) return () => activeSaveDialog.requestLeave();
  const modal = openModalDismiss();
  if (modal) return modal;
  if (activeEditor) return () => activeEditor.requestBack();
  if (activeViewer) return () => (activeViewer.back || activeViewer.finish)();
  if (searchOpen) return () => closeSearchScreen();
  if (currentLocation === 'vault') {
    if (vaultTrashOpen) return closeVaultTrash;
    if (vaultSettingsOpen) return async () => { if (await leaveIfClean(VAULT_SETTINGS_PENDING)) closeVaultSettings(); };
    if (openVaultFolderType) return closeVaultFolder;
    return null;
  }
  if (currentLocation === 'settings') return async () => { if (await leaveIfClean(SETTINGS_PENDING)) showScreen('main-screen', { tab: 'home' }); };
  if (trashOpen) return closeTrash;
  if (openFolderType) return closeFolder;
  return null;
}

function updateBackButtonState() {
  document.getElementById('nav-back-btn')?.classList.toggle('disabled', !backAction());
}

function goBack() {
  const action = backAction();
  if (action) action();
  updateBackButtonState();
}

function setActiveNavTab(tab) {
  document.querySelectorAll('#bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === tab));
}

async function bootstrap() {
  // Was reading a `window.sqlitePlugin` global that nothing anywhere ever set — a leftover from
  // the original pre-existing scaffold, never caught because nothing had actually run the app
  // until now. @capacitor-community/sqlite exports these directly; no global needed.
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  db = await initDb(sqlite);
  initFiles(db); // per-file encryption for Home files (Decision 161); the master key lives in this database
  // One-time conversion of plain Home files (Decision 163). Runs before anything can read or restore a file; a no-op once done.
  try {
    let shown = false;
    const res = await migratePlainFiles({ onProgress: ({ done, total }) => { shown = true; toast(`Securing files: ${done + 1} of ${total}`, true); } });
    if (shown) hideToast();
    if (res.failed || res.missing) toast(`${res.failed + res.missing} file(s) could not be secured; will retry at next start.`);
  } catch { /* startup continues; the conversion retries at the next start */ }

  applyAppearance(await getAppearance()); // apply theme before rendering the lock screen

  // Privacy Screen (Decision 64) — applied this early, same as appearance above, so it also
  // covers the lock screen itself, not just the unlocked app. Off by default; persisted the same
  // way as every other on/off setting (metaGet/metaSet).
  setPrivacyScreen((await metaGet('privacy_screen_enabled', 'false')) === 'true');
  setHapticsEnabled((await metaGet('haptics_enabled', 'true')) === 'true'); // on by default (Decision 173)

  await requestPermissions();
  await registerActionTypes();
  // One-time move to the banner channel (Decision 96): drop the old channel, then schedule every live reminder again on the new one.
  if ((await metaGet('reminder_channel', '1')) !== '2') {
    try {
      await retireOldChannel();
      const live = (await db.query(`SELECT * FROM entries WHERE type = 'reminder' AND deleted_at IS NULL AND completed_at IS NULL`)).values || [];
      for (const r of live) if (r.repeat_rule || r.fire_at > Date.now()) await scheduleReminder(r);
      await metaSet('reminder_channel', '2');
    } catch { /* retried on next launch */ }
  }
  // One-time reschedule (Decision 102): notifications built before the native receiver carry the old launch-the-app buttons.
  if ((await metaGet('reminder_actions', '1')) !== '2') {
    try {
      const live = (await db.query(`SELECT * FROM entries WHERE type = 'reminder' AND deleted_at IS NULL AND completed_at IS NULL`)).values || [];
      for (const r of live) if (r.repeat_rule || r.fire_at > Date.now()) await scheduleReminder(r);
      await metaSet('reminder_actions', '2');
    } catch { /* retried on next launch */ }
  }
  // Repeating reminders are scheduled as a window of upcoming occurrences (Decision 106): top it up now and on resume.
  refillRepeating();
  // Snooze / Done tapped while the app was closed or locked: applied before any screen shows, no unlock needed. The poll
  // covers a tap from the shade while the app is open (no resume event fires then).
  await drainQueuedReminderActions();
  setInterval(() => { if (document.visibilityState === 'visible') drainQueuedReminderActions(); }, 4000);
  // Snooze / Done buttons on a reminder notification (Decision 92). Fallback for notifications scheduled before Decision 102: those buttons still launch the app. Needs only the database, so it works while the app is locked.
  listenForReminderActions(async (actionId, entryId) => {
    try {
      const row = ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [entryId])).values || [])[0];
      if (!row) { /* entry gone: nothing to change */ }
      else if (actionId === 'done') await markReminderDone(entryId);
      else if (actionId === 'snooze') {
        await snoozeReminder(row, 10);
        // Persisted so the row shows "Snoozed until" rather than greyed-out "Fired" (Decision 99).
        await db.run(`UPDATE entries SET snoozed_until = ?, updated_at = ? WHERE id = ?`, [Date.now() + 10 * 60 * 1000, Date.now(), entryId]);
      }
      window.dispatchEvent(new Event('arkly-reminders-changed'));
    } catch { /* a failed action leaves the reminder as it was */ }
    // The button launched the app only to deliver the action; send it back where the person was (Decision 100).
    // Skipped when the app was already in use, so tapping a button from the shade over the open app stays put.
    if (Date.now() - lastResumeAt < NOTIFICATION_LAUNCH_WINDOW_MS) { try { await App.minimizeApp(); } catch { /* not supported: app stays open */ } }
  });
  await purgeOldTrash(db); // purges BOTH bins — same 30-day rule, filtered by is_private only when listing
  await registerBackgroundLock();

  await showLockScreen();
}

// Immediate lock on backgrounding, not just the idle timers above. privateSessionKey's own comment
// has said "cleared on vault lock/background" since the pivot, but nothing ever actually listened
// for backgrounding — the vault would stay unlocked indefinitely across app-switches, relying only
// on the idle timer. Fixes that gap; also locks the app-level screen the same way, if a password exists.
//
// expectingPickerReturn (Decision 73) skips this exactly once when the pause was caused by a
// system picker we launched ourselves (file chooser today; any future share-sheet/camera call
// should set the same flag before invoking) rather than the person actually leaving the app —
// Android's Activity lifecycle can't tell the two apart on its own, appStateChange fires isActive:
// false identically either way. Consumed immediately so it only ever covers the one pause it was
// set for, never a later, unrelated backgrounding.
//
// handleLockTrigger() (Decision 74) does the actual locking for both this and the screen-off
// listener below, each gated by its own pair of `*_lock_<trigger>_enabled` columns — independent
// per lock (app/vault) and per trigger (idle/background/screenoff). Note the two triggers overlap
// at the OS level: turning the screen off also pauses the Activity, so appStateChange fires here
// too, regardless of the screenoff-specific toggle's state. With "Lock when backgrounded" on,
// screen-off already locks via this listener; the screenoff toggle only matters when background is
// off but screen-off should still lock — not a bug, just how Android's lifecycle works.
async function registerBackgroundLock() {
  const { App } = await import('@capacitor/app');
  App.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      lastResumeAt = Date.now(); drainQueuedReminderActions(); refillRepeating(); purgeOpenCopies();
      // Back in front on the Vault screen while it is locked: show the gate and offer biometric, as the Vault tab does.
      // The app lock screen hides the Vault screen, so this never races it (Decision 59).
      if (!privateSessionKey && !document.getElementById('vault-screen')?.classList.contains('hidden')) window.refreshVaultGateView?.();
      return;
    } // only act on going TO background, not returning from it
    if (expectingPickerReturn) { expectingPickerReturn = false; return; }
    await handleLockTrigger('background');
  });

  // Fired by native code (android-notes/native-setup.md §14) on Intent.ACTION_SCREEN_OFF — a
  // signal appStateChange alone can't produce, since Android's Activity lifecycle treats "screen
  // turned off" and "switched to another app" identically. Not a Capacitor plugin: MainActivity
  // dispatches this as a plain DOM event via evaluateJavascript() directly into the WebView,
  // avoiding a full plugin-registration/cap-sync setup for one narrow signal.
  window.addEventListener('arkly-screen-off', () => handleLockTrigger('screenoff'));
}

// Shared by both triggers above — trigger is 'background' or 'screenoff', matching the
// `app_lock_<trigger>_enabled` / `vault_lock_<trigger>_enabled` column suffixes exactly (Decision
// 74). Not user input, so building the column name with a template literal is safe here.
async function handleLockTrigger(trigger) {
  const cred = (await db.query(
    `SELECT app_password_hash, app_lock_${trigger}_enabled, vault_lock_${trigger}_enabled FROM credentials WHERE id=1`
  )).values[0];
  if (privateSessionKey && (cred?.[`vault_lock_${trigger}_enabled`] ?? 1)) lockVault();
  if (cred?.app_password_hash && (cred[`app_lock_${trigger}_enabled`] ?? 1)) {
    disarmAppAutoLock();
    showScreen('lock-screen');
  }
}

// Call immediately before any input.click() that opens a system picker (Decision 73). Bounds the
// exception window: if the expected pause never arrives within a few seconds — some OEM file
// choosers don't actually leave the Activity — this stops trusting the flag on its own, rather
// than leaving it armed indefinitely and silently skipping the next unrelated backgrounding too.
function beginPickerLaunch() {
  expectingPickerReturn = true;
  setTimeout(() => { expectingPickerReturn = false; }, 3000);
}

// ---- Auth gate — app-open password is optional ("quick access"); Vault PIN is separate and unaffected ----
async function showLockScreen() {
  const row = await db.query(`SELECT app_password_hash, app_password_salt, app_password_iter FROM credentials WHERE id=1`);

  if (!row.values || row.values.length === 0) {
    window.needsFirstRunSetup = true; // informational only — showScreen() below is what actually does the work
    showScreen('first-run-setup');
    return { firstRun: true };
  }

  const { app_password_hash, app_password_salt, app_password_iter } = row.values[0];
  if (!app_password_hash) {
    await onUnlocked(); // "quick access" — no password was set, skip the lock screen UI entirely
    return { quickAccess: true };
  }

  showScreen('lock-screen');
  window.attemptUnlock = async (password) => {
    const ok = await verifyPassword(password, app_password_hash, app_password_salt, app_password_iter);
    if (ok) { await onUnlocked(); await upgradeCredentialHash('app', password, app_password_hash, app_password_salt, app_password_iter); return { success: true }; }
    return { success: false };
  };

  // Biometric alternative — only offered if enabled for this lock AND actually available right
  // now (checked fresh every time the lock screen shows, not cached: enrollment/hardware state
  // can change between sessions). window.tryBiometricUnlockApp() reuses attemptUnlock() above
  // rather than duplicating the verify step, so there's exactly one path that decides "correct
  // password" either way.
  //
  // The actual auto-trigger does NOT happen here — see the end of the DOMContentLoaded handler
  // below. Session 31 first tried a bare `setTimeout(..., 400)` right at this point, reasoning
  // about Android's window-focus timing; that fix was itself the cause of a worse bug reported
  // after shipping it (app freeze, biometric needing two attempts): the timeout fired
  // independently of — and could land in the middle of — the rest of DOMContentLoaded's own
  // async setup (populating settings from the database, etc.), racing two chains of SQLite calls
  // against each other. Firing only after that setup has fully finished removes the race
  // entirely, which matters more here than the exact delay length.
  const bioRow = (await db.query(`SELECT biometric_app_enabled FROM credentials WHERE id=1`)).values[0];
  window.biometricUnlockAvailable = !!bioRow?.biometric_app_enabled && await isBiometricAvailable();
}

// appPassword/vaultPin: either or both may be null/empty — the app-open password is optional from
// first run (pivot); the vault only exists once its PIN is set, but that can happen later too
// (Settings), not necessarily during first-run setup.
window.completeFirstRunSetup = async ({ appPassword = null, appPasswordHint = '', vaultPin = null, vaultPinHint = '' }) => {
  let passwordHash = null, passwordSalt = null, passwordIter = null;
  if (appPassword) ({ hash: passwordHash, salt: passwordSalt, iterations: passwordIter } = await hashPassword(appPassword));

  let pinHash = null, pinSalt = null, pinIter = null;
  if (vaultPin) ({ hash: pinHash, salt: pinSalt, iterations: pinIter } = await hashPassword(vaultPin));

  await db.run(
    `INSERT INTO credentials (id, app_password_hash, app_password_salt, app_password_hint,
      private_pin_hash, private_pin_salt, private_pin_hint, app_password_iter, private_pin_iter) VALUES (1,?,?,?,?,?,?,?,?)`,
    [passwordHash, passwordSalt, appPasswordHint || null, pinHash, pinSalt, vaultPinHint || null, passwordIter, pinIter]
  );
  await onUnlocked();
};

// Upgrade a hash made with an older PBKDF2 count, right after that same secret was verified (Decision 172). The salt is kept:
// the Vault key derives from the PIN salt, and backups carry it. The UPDATE only applies if the stored hash is still the one that
// was verified, so a change made in between is never overwritten. A failure leaves the old hash valid; it retries at the next unlock.
const CRED_COLS = {
  app: { hash: 'app_password_hash', iter: 'app_password_iter' },
  pin: { hash: 'private_pin_hash', iter: 'private_pin_iter' },
};
async function upgradeCredentialHash(kind, secret, oldHash, salt, iterations) {
  if (!needsRehash(iterations)) return;
  try {
    const c = CRED_COLS[kind];
    const { hash } = await hashPassword(secret, salt, PASSWORD_HASH_ITERATIONS);
    await db.run(`UPDATE credentials SET ${c.hash}=?, ${c.iter}=? WHERE id=1 AND ${c.hash}=?`, [hash, PASSWORD_HASH_ITERATIONS, oldHash]);
  } catch { /* stays at the old count */ }
}

// Settings-time add/remove — independent of first-run, so "quick access" can be turned on or off later.
async function setAppPassword(newPassword, hint = '') {
  const { hash, salt, iterations } = await hashPassword(newPassword);
  await db.run(`UPDATE credentials SET app_password_hash=?, app_password_salt=?, app_password_hint=?, app_password_iter=? WHERE id=1`, [hash, salt, hint, iterations]);
  await disableAppBiometric(); // stored secret (if any) was the old password — stale now, must re-enable explicitly
}
async function removeAppPassword() {
  await db.run(`UPDATE credentials SET app_password_hash=NULL, app_password_salt=NULL, app_password_hint=NULL, app_password_iter=NULL WHERE id=1`);
  await disableAppBiometric(); // nothing left to unlock biometrically
}

// ---- Biometric unlock (optional, alternative to typing the app-open password or Vault PIN —
// off by default, toggled independently per lock. See biometric.js for the plugin wrapper and
// its security notes, and ARCHITECTURE §3/§3b — this never becomes a fourth credential: it only
// ever stores/replays the same password or PIN the person already set, gated by a fresh
// biometric prompt each time. Decision 50. ----
async function getBiometricSettings() {
  const row = (await db.query(`SELECT biometric_app_enabled, biometric_vault_enabled FROM credentials WHERE id=1`)).values[0] || {};
  return {
    available: await isBiometricAvailable(),
    appEnabled: !!row.biometric_app_enabled,
    vaultEnabled: !!row.biometric_vault_enabled,
  };
}

async function enableAppBiometric(currentPassword) {
  const row = (await db.query(`SELECT app_password_hash, app_password_salt, app_password_iter FROM credentials WHERE id=1`)).values[0];
  if (!row?.app_password_hash) return { success: false, reason: 'no-password-set' };
  const ok = await verifyPassword(currentPassword, row.app_password_hash, row.app_password_salt, row.app_password_iter);
  if (!ok) return { success: false, reason: 'wrong-password' };
  await enableBiometric('app', currentPassword); // shows the biometric prompt itself, throws on cancel/failure
  await db.run(`UPDATE credentials SET biometric_app_enabled=1 WHERE id=1`);
  return { success: true };
}
async function disableAppBiometric() {
  await disableBiometric('app');
  await db.run(`UPDATE credentials SET biometric_app_enabled=0 WHERE id=1`);
}

async function enableVaultBiometric(currentPin) {
  const row = (await db.query(`SELECT private_pin_hash, private_pin_salt, private_pin_iter FROM credentials WHERE id=1`)).values[0];
  if (!row?.private_pin_hash) return { success: false, reason: 'no-pin-set' };
  const ok = await verifyPassword(currentPin, row.private_pin_hash, row.private_pin_salt, row.private_pin_iter);
  if (!ok) return { success: false, reason: 'wrong-pin' };
  await enableBiometric('vault', currentPin);
  await db.run(`UPDATE credentials SET biometric_vault_enabled=1 WHERE id=1`);
  return { success: true };
}
async function disableVaultBiometric() {
  await disableBiometric('vault');
  await db.run(`UPDATE credentials SET biometric_vault_enabled=0 WHERE id=1`);
}

// Reuse the exact same verify paths as manual entry (attemptUnlock / unlockVault) rather than a
// second copy of "what counts as correct" — biometric only ever supplies the same input a typed
// entry would have.
async function tryBiometricUnlockApp() {
  const password = await unlockWithBiometric('app');
  if (!password) return { success: false };
  return window.attemptUnlock(password);
}
async function tryBiometricUnlockVault() {
  const pin = await unlockWithBiometric('vault');
  if (!pin) return { success: false };
  return unlockVault(pin);
}
window.getBiometricSettings = getBiometricSettings;
window.enableAppBiometric = enableAppBiometric;
window.disableAppBiometric = disableAppBiometric;
window.enableVaultBiometric = enableVaultBiometric;
window.disableVaultBiometric = disableVaultBiometric;
window.tryBiometricUnlockApp = tryBiometricUnlockApp;
window.tryBiometricUnlockVault = tryBiometricUnlockVault;

async function onUnlocked() {
  showScreen('main-screen');
  await armAppAutoLock(); // no-op if quick access (no password) — nothing to lock back to in that case

  // Ads deliberately NOT wired in this build (explicit product decision — deferred to a future
  // build, Phase 12 stays unstarted in ROADMAP.md). Previously called runDailyAdGateIfDue() here
  // with window.adSdk, which has never actually been set anywhere (no AdMob plugin has been added
  // to package.json) — ads.js's own try/catch handled that undefined reference safely on its own,
  // so removing this isn't fixing a confirmed hang by itself, but it was extra async work sitting
  // in the exact unlock path a freeze was reported on, and it served no purpose with nothing to
  // gate. Removed rather than left calling into a module with nothing behind it.
  //
  // Update check (Decision 71) is NOT run here either, by design (Decision 72) — it's a manual
  // Settings button (handleCheckForUpdateClick()) now, not a background check on every open. With
  // ads still unwired, the app currently makes zero network calls unless that button is tapped.
  await checkAutoBackupOnOpen(); // never blocks getting into the app
  // Actual rendering (digest, on-this-day, timeline) happens via DOMContentLoaded's render*()
  // functions, called once right after bootstrap() resolves — showDigest()/showMainTimeline()
  // themselves are pure data queries with no DOM side effect, so calling them here too would just
  // be discarded results.
}

// ---- Digest (home screen summary) ----
async function showDigest() {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const rows = await db.query(
    `SELECT type, COUNT(*) as cnt, SUM(amount) as total FROM entries
     WHERE created_at >= ? AND deleted_at IS NULL AND is_private=0 GROUP BY type`,
    [startOfDay.getTime()]
  );
  return rows.values || [];
}

// "1 month/year ago you saved..." — pure rule-based date-diff, no automated inference (ARCHITECTURE
// §6). Private entries excluded, same reasoning as showDigest() above — resurfacing a vault item's
// existence/label outside the vault would be exactly the leak Decision 40 already closed elsewhere.
async function onThisDay() {
  const now = new Date();
  const rows = await db.query(
    `SELECT * FROM entries WHERE deleted_at IS NULL AND is_private=0
     AND CAST(strftime('%m', created_at/1000, 'unixepoch') AS INTEGER) = ?
     AND CAST(strftime('%d', created_at/1000, 'unixepoch') AS INTEGER) = ?
     AND created_at < ? ORDER BY created_at DESC`,
    [now.getMonth() + 1, now.getDate(), new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()]
  );
  return rows.values || [];
}

// Recurring backup reminder (ARCHITECTURE §9/§13, Session 40) — a soft in-app nudge, not a push
// notification (kept simple; "soft" in the spec is satisfied by a dismissible banner that never
// blocks anything, same restraint already used for the auto-backup-due banner). Counts whichever
// backup path (local or Google Drive) is more recent — either one produces a usable .dzbackup for
// the "forgot app password" recovery flow this is meant to keep viable (ARCHITECTURE §3), so only
// the most recent of the two matters, not local specifically. Suppressed on an essentially-empty
// install (zero entries, vault included) — a never-backed-up fresh install would otherwise always
// read as "30+ days since last backup" (last = 0) despite having nothing worth losing yet.
const BACKUP_REMINDER_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
async function backupReminderDue() {
  const cred = (await db.query(`SELECT last_backup_at, last_drive_backup_at FROM credentials WHERE id=1`)).values[0] || {};
  const lastAny = Math.max(cred.last_backup_at || 0, cred.last_drive_backup_at || 0);
  const dueByAge = Date.now() - lastAny > BACKUP_REMINDER_THRESHOLD_MS;
  if (!dueByAge) return { due: false, lastAny };
  const countRow = (await db.query(`SELECT COUNT(*) as cnt FROM entries WHERE deleted_at IS NULL`)).values[0];
  return { due: (countRow?.cnt || 0) > 0, lastAny };
}

// Storage usage per category (ARCHITECTURE §6) — reuses fileactions.js's getSelectableEntries()
// rather than re-computing file sizes a second way; that function already does the one Filesystem.stat
// per file this needs.
async function storageBreakdown() {
  const groups = await getSelectableGroups();
  return Object.entries(groups).map(([cat, items]) => ({
    category: cat,
    count: items.length,
    totalBytes: items.reduce((sum, it) => sum + (it.sizeBytes || 0), 0),
    items
  }));
}

// "Your Data" transparency screen (ARCHITECTURE §7) — total entry count + on-device storage
// footprint, distinct from the per-category storage breakdown above (this is about making local-only
// ownership visible/concrete, not about managing space). Excludes Vault entries from the count for
// the same reason showDigest()/onThisDay() do (Decision 40) — the app-open password gates this
// screen, but not the Vault PIN, so a count that included vault items would leak the vault's size to
// anyone with app access but not the PIN. The size is the sum of the same per-entry sizes the Storage
// breakdown shows (Home entries only, same reason), not navigator.storage.estimate(): that reports
// the WebView's own storage and misses files and the database, so it read ~0 B.
async function yourDataSummary() {
  const rows = await db.query(`SELECT COUNT(*) as cnt FROM entries WHERE deleted_at IS NULL AND is_private=0`);
  const entryCount = (rows.values && rows.values[0] && rows.values[0].cnt) || 0;
  let storageBytes = null; // null = unknown (the lookup failed) — caller shows "unknown", not 0
  try {
    const groups = await getSelectableGroups('home');
    storageBytes = Object.values(groups).reduce((sum, items) => sum + items.reduce((n, it) => n + (it.sizeBytes || 0), 0), 0);
  } catch { /* leave unknown */ }
  return { entryCount, storageBytes };
}

// "Clear items older than X days" per category (ARCHITECTURE §6) — soft-deletes, same as any other
// Delete (30-day trash, not permanent), reusing the existing bulk-delete path rather than a new one.
async function clearOldInCategory(category, olderThanDays) {
  const groups = await getSelectableGroups();
  const items = groups[category] || [];
  if (items.length === 0) return { cleared: 0, ids: [] };
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const rows = await db.query(
    `SELECT id FROM entries WHERE id IN (${items.map(() => '?').join(',')}) AND created_at < ?`,
    [...items.map((it) => it.id), cutoff]
  );
  const ids = (rows.values || []).map((r) => r.id);
  if (ids.length === 0) return { cleared: 0, ids: [] };
  await runBulkFileAction('delete', ids);
  return { cleared: ids.length, ids };
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

  // Plain note (or private note) fallback
  return saveNote(rawText, extra);
}

function buildFromHandler(name, data) {
  // pulls the buildEntry() output from the matching handler — kept simple here since
  // intents.js's registerIntentHandler already stores handlers internally.
  if (name === 'reminder') return { type: 'reminder', label: data.label, fire_at: data.fire_at, repeat_rule: null };
}

// ---- Notes (including private notes) ----
async function saveNote(text, { isPrivate = false, label, tags = [], description = '' } = {}) {
  if (isPrivate) {
    // Delegates to the vault's own save path rather than duplicating it — one way to create a
    // private text entry, not two that could quietly drift apart (this was the pre-vault-pivot
    // private-notes path; kept as a thin wrapper so existing callers of saveNote(..., {isPrivate}) don't break).
    return captureToVault({ type: 'note', label: label || text.slice(0, 40), tags, description, text });
  }
  const id = crypto.randomUUID();
  await insertEntry(db, { id, type: 'note', label: label || text.slice(0, 40), body_text: text, description: description || null });
  await applyTags(id, tags);
  return id;
}

async function applyTags(entryId, tagNames) {
  for (const name of tagNames.slice(0, MAX_TAGS)) { // Decision 90
    await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [name]);
    const row = await db.query(`SELECT id FROM tags WHERE name=?`, [name]);
    const tagId = row.values[0].id;
    await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [entryId, tagId]);
  }
}

// ---- Non-text capture (voice/image/pdf/file) — didn't exist at all until now; captureText/saveNote
// only ever handled typed text. Mirrors vault.js's captureToVault() but unencrypted, matching the
// file-storage convention (Directory.Data/files/<32 hex>, encrypted, Decision 161) already established for backup/restore. ----
async function captureFile(type, { label, tags = [], description = '', fileData, extension, autoCategory = null }) {
  const id = crypto.randomUUID();
  const { path: filePath, fileKey } = await saveBase64(fileData); // files/<32 hex>, encrypted; the type stays in extension

  // OCR for image/pdf isn't implemented yet — Phase 5's native plugin wiring (ML Kit/Tesseract) is
  // still just documented, not coded (android-notes/native-setup.md §6). body_text stays null until
  // that lands rather than pretending OCR ran; searching by label/tags still works meanwhile.
  await insertEntry(db, {
    id, type, label: label || `${VAULT_TYPE_LABELS[type] || type} ${new Date().toLocaleDateString()}`,
    file_path: filePath, file_key: fileKey, extension, auto_category: autoCategory, description: description || null
  });
  await applyTags(id, tags);
  return id;
}

// ---- Batch add: one common label + auto-numbering for multi-select Image/PDF/Generic File captures
// (Decision 84). files: array of { fileData (base64), extension }, in selection order.
// Numbering continues from the baseLabel's counter row in label_history, so a later batch picks up
// where the last one stopped ("Invoice 4" after "Invoice 1..3"). Each file is an independent entry.
async function batchAddWithCommonLabel(type, baseLabel, files, tags = [], description = '') {
  const historyRow = await db.query(
    `SELECT use_count FROM label_history WHERE type=? AND label=?`,
    [type, baseLabel]
  );
  const start = (historyRow.values && historyRow.values[0]) ? historyRow.values[0].use_count : 0;
  const labels = files.map((_, i) => `${baseLabel} ${start + i + 1}`);

  // insertEntry() counts every saved label into label_history; numbered variants would crowd the
  // autocomplete hint, so only the ones that weren't already there are removed afterward.
  const placeholders = labels.map(() => '?').join(',');
  const existing = await db.query(
    `SELECT label FROM label_history WHERE type=? AND label IN (${placeholders})`,
    [type, ...labels]
  );
  const preexisting = new Set((existing.values || []).map((r) => r.label));

  const createdIds = [];
  for (let i = 0; i < files.length; i++) {
    createdIds.push(await captureFile(type, {
      label: labels[i], tags, description, fileData: files[i].fileData, extension: files[i].extension
    }));
  }

  for (const label of labels) {
    if (!preexisting.has(label)) await db.run(`DELETE FROM label_history WHERE type=? AND label=?`, [type, label]);
  }
  const n = start + files.length;
  await db.run(
    `INSERT INTO label_history (type, label, use_count) VALUES (?,?,?)
     ON CONFLICT(type, label) DO UPDATE SET use_count = ?`,
    [type, baseLabel, n, n]
  );
  return { ids: createdIds, first: labels[0], last: labels[labels.length - 1] };
}

// ---- Private notes unlock (independent PIN, own derived key) ----
// ---- Private Vault: its own PIN, its own unlock session, its own auto-lock timer — all
// independent of the app-open password (three credentials stay independent, ARCHITECTURE §3) ----
async function setupVaultPin(pin, hint = '') {
  const { hash, salt, iterations } = await hashPassword(pin);
  await db.run(`UPDATE credentials SET private_pin_hash=?, private_pin_salt=?, private_pin_hint=?, private_pin_iter=? WHERE id=1`, [hash, salt, hint, iterations]);
  await disableVaultBiometric(); // stored secret (if any) was the old PIN — stale now, must re-enable explicitly
}

// Full Vault index build with a sticky notice while file records are being built (first unlock after the update, or after a restore).
async function buildVaultIndexWithNotice() {
  let shown = false;
  try {
    return await buildVaultIndex(db, privateSessionKey, ({ done, total }) => { shown = true; toast(`Preparing Vault: ${done} of ${total}`, true); });
  } finally {
    if (shown) hideToast();
  }
}

async function unlockVault(pin) {
  const row = await db.query(`SELECT private_pin_hash, private_pin_salt, private_pin_iter FROM credentials WHERE id=1`);
  if (!row.values[0] || !row.values[0].private_pin_hash) return { setupNeeded: true };
  const { private_pin_hash, private_pin_salt, private_pin_iter } = row.values[0];
  const ok = await verifyPassword(pin, private_pin_hash, private_pin_salt, private_pin_iter);
  if (!ok) return { success: false };
  const { key } = await deriveAesKey(pin, private_pin_salt);
  privateSessionKey = key;
  await buildVaultIndexWithNotice(); // in-memory only — see vault.js
  await loadCurrencySymbol(); // Vault Money rows and search results format with the app symbol (Decision 135)
  armVaultAutoLock();
  await upgradeCredentialHash('pin', pin, private_pin_hash, private_pin_salt, private_pin_iter);
  return { success: true };
}

function lockVault() {
  if (pendingPurge?.isVault) flushPurge(); // the person chose to delete; the Undo toast goes with the lock
  exitSelection();
  dismissOverlays(true);
  clearSecretInputs(VAULT_SECRET_INPUT_IDS);
  privateSessionKey = null;
  clearVaultThumbs();
  clearVaultIndex();
  if (vaultAutoLockTimer) clearTimeout(vaultAutoLockTimer);
  vaultAutoLockTimer = null;
  vaultBioAutoPrompted = false;
  // Previously only the in-memory key was cleared here — #vault-list/#vault-trash-list kept
  // whatever was last rendered into them, fully visible, since nothing hid or cleared that DOM
  // content on lock. Combined with vault-screen having no gate of its own (see Decision 54),
  // this was the actual bug: the vault could appear "already unlocked" indefinitely.
  const trash = document.getElementById('vault-trash-list');
  const folderList = document.getElementById('vault-folder-list');
  if (folderList) folderList.innerHTML = '';
  if (trash) trash.innerHTML = '';
  document.querySelectorAll('#vault-capture-bar .card-count').forEach((c) => { c.textContent = ''; }); // counts must not outlive the key
  if (searchOpen && searchMode === 'vault') closeSearchScreen({ instant: true }); // text, results and rows go with the key
  // The Select files screen is an overlay of its own; with Vault items listed it must not outlive the key.
  const sf = document.getElementById('select-files-screen');
  if (sf && sf.dataset.scope === 'vault') {
    sf.classList.add('hidden');
    document.getElementById('select-files-groups').innerHTML = '';
  }
  closeVaultTrash();
  closeVaultSettings();
  closeVaultFolder(); // next unlock lands on the card grid, not a previously open folder
  if (onVaultLocked) onVaultLocked(); // idle, background and screen-off locks all end here: the gate must show, not the emptied content
}
let onVaultLocked = null; // set once the Vault screen exists: shows the locked gate when the Vault is on view

// Called on unlock and on any vault activity (app.js's vault UI handlers should call this on
// capture/search/browse) — a separate timer from whatever the app-level lock uses, per-spec
// ("separate auto lock after certain time"), read from its own column, not auto_lock_minutes.
// A long backup or restore takes no taps, so the idle timers would fire in the middle of it. Held for the duration.
let idleLockHeld = false;
async function withoutIdleLock(task) {
  const vaultWasArmed = !!vaultAutoLockTimer;
  idleLockHeld = true;
  disarmAppAutoLock();
  if (vaultAutoLockTimer) { clearTimeout(vaultAutoLockTimer); vaultAutoLockTimer = null; }
  try { return await task(); }
  finally {
    idleLockHeld = false;
    await armAppAutoLock();
    if (vaultWasArmed && privateSessionKey) await armVaultAutoLock();
  }
}

async function armVaultAutoLock() {
  if (idleLockHeld) return;
  if (vaultAutoLockTimer) clearTimeout(vaultAutoLockTimer);
  const row = await db.query(`SELECT vault_auto_lock_minutes, vault_lock_idle_enabled FROM credentials WHERE id=1`);
  if (!(row.values[0]?.vault_lock_idle_enabled ?? 1)) return; // idle trigger switched off (Decision 74)
  const minutes = row.values[0]?.vault_auto_lock_minutes ?? 5;
  vaultAutoLockTimer = setTimeout(() => lockVault(), minutes * 60 * 1000);
}

async function setVaultAutoLockMinutes(minutes) {
  await db.run(`UPDATE credentials SET vault_auto_lock_minutes=? WHERE id=1`, [minutes]);
  if (privateSessionKey) armVaultAutoLock(); // re-arm immediately with the new duration if already unlocked
}

// One setter for all six toggles (Decision 74) — lock is 'app'|'vault', trigger is
// 'idle'|'background'|'screenoff', matching the column names exactly. Re-arms the idle timer
// immediately on a live toggle flip so turning "Lock after inactivity" off actually cancels a
// timer already ticking, not just future ones.
async function setLockTriggerEnabled(lock, trigger, enabled) {
  await db.run(`UPDATE credentials SET ${lock}_lock_${trigger}_enabled=? WHERE id=1`, [enabled ? 1 : 0]);
  if (trigger === 'idle') {
    if (lock === 'app') await armAppAutoLock();
    else if (privateSessionKey) await armVaultAutoLock();
  }
}

// ---- App-level idle auto-lock (Phase 9 — the `auto_lock_minutes` column has existed since Session
// 1 but was never actually enforced anywhere until now). No-op when quick access is enabled (no
// app-open password) — there's nothing to lock back to. Reset on generic activity via a single
// document-level listener (registered once in DOMContentLoaded) rather than manually calling this
// from every capture/search/browse function — the vault's equivalent needed several follow-up
// patches for exactly that reason; a delegated listener can't be missed the same way. ----
async function armAppAutoLock() {
  if (idleLockHeld) return;
  if (appAutoLockTimer) clearTimeout(appAutoLockTimer);
  const cred = (await db.query(`SELECT app_password_hash, auto_lock_minutes, app_lock_idle_enabled FROM credentials WHERE id=1`)).values[0];
  if (!cred?.app_password_hash) return; // quick access — nothing to arm
  if (!(cred.app_lock_idle_enabled ?? 1)) return; // idle trigger switched off (Decision 74)
  const minutes = cred.auto_lock_minutes ?? 5;
  appAutoLockTimer = setTimeout(() => { disarmAppAutoLock(); showScreen('lock-screen'); }, minutes * 60 * 1000);
}
function disarmAppAutoLock() {
  if (appAutoLockTimer) clearTimeout(appAutoLockTimer);
  appAutoLockTimer = null;
}
async function setAutoLockMinutes(minutes) {
  await db.run(`UPDATE credentials SET auto_lock_minutes=? WHERE id=1`, [minutes]);
  await armAppAutoLock(); // re-arm immediately with the new duration if currently unlocked with a password set
}

async function showMainTimeline(types = null) {
  const typeClause = types ? ` AND type IN (${types.map(() => '?').join(',')})` : '';
  const sql = `SELECT * FROM entries WHERE deleted_at IS NULL AND is_private=0${typeClause} ORDER BY created_at DESC LIMIT 200`;
  const rows = types ? await db.query(sql, types) : await db.query(sql);
  const entries = rows.values || [];
  // One extra query for all tags at once (GROUP_CONCAT) rather than one per row — same bulk
  // approach vault.js's buildVaultIndex already uses for its own index, just via SQL here instead
  // of a loop since these rows aren't already being iterated for decryption like vault's are.
  if (entries.length > 0) {
    const tagRows = await db.query(
      `SELECT et.entry_id, GROUP_CONCAT(t.name) AS tag_names FROM entry_tags et
       JOIN tags t ON t.id = et.tag_id WHERE et.entry_id IN (${entries.map(() => '?').join(',')})
       GROUP BY et.entry_id`,
      entries.map((e) => e.id)
    );
    const tagMap = new Map((tagRows.values || []).map((r) => [r.entry_id, r.tag_names.split(',')]));
    entries.forEach((e) => { e.tags = tagMap.get(e.id) || []; });
  }
  return entries;
}

// ---- Private Vault: capture + browse — deliberately mirrors captureText/showMainTimeline's shape,
// since spec asks for the vault to be "an exact replica of the home screen function" apart from what
// stays private-at-rest and the Share/Download restriction being lifted (both, same as non-vault). ----
async function captureToVault({ type, label, tags = [], description = '', text, fileData, extension, ocrText, autoCategory, money, location, fireAt = null, repeatRule = null }) {
  if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before capturing');
  armVaultAutoLock(); // any activity resets the vault's own timer, independent of the app-level one
  const id = await saveVaultEntry(db, privateSessionKey, { type, label, tags, description, text, fileData, extension, ocrText, autoCategory, money, location, fireAt, repeatRule });
  await refreshVaultIndexEntries(db, privateSessionKey, [id]); // only the new item, so it is immediately searchable/listed
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
// Extensions extensionForMimeType() can produce for a recording, plus the picked-audio ones.
function audioMimeForExtension(ext) {
  return { aac: 'audio/aac', webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' }[ext] || 'audio/aac';
}
function mimeTypeForVaultRow(row) {
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', aac: 'audio/aac', webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
  return byExt[row.extension] || 'application/octet-stream';
}

// ---- Trash — two independent bins (main + vault), same soft-delete/30-day rule, filtered by
// is_private only (db.js's listTrash/restoreFromTrash/permanentlyDeleteEntry are shared, generic
// functions; nothing vault-specific lives in them). Restore + permanent delete for both, per spec. ----
async function showTrash() { return listTrash(db, { isPrivate: false }); }
async function showVaultTrash() {
  if (!privateSessionKey) throw new Error('Vault locked');
  const rows = await listTrash(db, { isPrivate: true });
  return Promise.all(rows.map(async (r) => ({ ...r, label: await vaultRowLabel(privateSessionKey, r) }))); // stored label is a placeholder (Decision 145)
}
async function restoreEntry(id) {
  await restoreFromTrash(db, id);
  if (privateSessionKey) await refreshVaultIndexEntries(db, privateSessionKey, [id]); // covers the vault-trash case; a Home id changes nothing
}
async function permanentlyDelete(id) {
  await permanentlyDeleteEntry(db, id);
  if (privateSessionKey) await refreshVaultIndexEntries(db, privateSessionKey, [id]);
}
// Vault items specifically need the in-memory index rebuilt after a soft-delete too, or the item
// keeps appearing in browseVault()/searchVault() until the next unlock rebuilds it — the index has
// no other way to learn a row it already cached is now gone. Only that entry is re-read (Phase 17 B).
async function deleteVaultEntry(id) {
  await softDelete(db, id);
  if (privateSessionKey) await refreshVaultIndexEntries(db, privateSessionKey, [id]);
}

// ---- "Select files" multi-select screen — one shared implementation for both main and vault
// (spec: "every single thing in non private will be exactly replicated in private vault") ----
async function getSelectableGroups(scope = 'home') {
  return getSelectableEntries(db, { scope, vaultIndex: scope === 'vault' && privateSessionKey ? getVaultIndex() : null });
}
async function runBulkFileAction(action, entryIds, extraOpts = {}) {
  if (vaultAutoLockTimer) armVaultAutoLock(); // bulk-acting on vault items counts as activity too
  const results = await runBulkAction(db, action, entryIds, { privateSessionKey, ...extraOpts });
  // Same reason as deleteVaultEntry() above: a bulk delete can include vault items, and the
  // in-memory index has no way to notice a row it cached got soft-deleted; the named entries are re-read.
  if (action === 'delete' && privateSessionKey) await refreshVaultIndexEntries(db, privateSessionKey, entryIds);
  return results;
}

// ---- Appearance: dark mode only (stored in the generic `meta` table, no schema change needed;
// falls under the App Settings backup category). Purely cosmetic — never gates any feature or
// data access. Gradient mode removed (Decision 53) — old `gradient_mode`/`gradient_color_1`/
// `gradient_color_2` meta rows from before this session are simply never read again; harmless to
// leave in place, including inside any backup file made before this change. ----
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
  };
}

function applyAppearance({ darkMode }) {
  const root = document.documentElement;
  root.setAttribute('data-theme', darkMode ? 'dark' : 'light');
}

async function setDarkMode(on) {
  await metaSet('dark_mode', on ? 'on' : 'off');
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
  if (!(await confirmStrength('passkey', passphrase))) return;

  statusEl.textContent = 'Checking storage…';
  const result = await withoutIdleLock(() => createBackup(db, {
    passphrase, hint, categories,
    onProgress: ({ done, total }) => { statusEl.textContent = `Backing up ${done + 1} of ${total}…`; }
  }));
  if (!result.ok && result.reason === 'insufficient_storage') {
    statusEl.textContent = `Not enough space: needs ~${formatBytes(result.requiredBytes)}, ` +
      `${formatBytes(result.availableBytes)} available.`;
    return;
  }
  statusEl.textContent = result.ok
    ? `Saved as ${result.path}.${result.skippedFiles ? ` ${result.skippedFiles} missing file(s) were not included.` : ''}`
    : `Backup failed: ${result.reason || 'unknown error'}${result.detail ? ` (${result.detail})` : ''}.`;
  if (result.ok) { document.getElementById('backup-passphrase').value = ''; document.getElementById('backup-hint').value = ''; }
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
  // Read via the browser File API directly rather than @capacitor/filesystem — a picked file's content:// URI isn't a
  // plain Filesystem path. A format 2 file is read in slices as it is restored; only a format 1 file is read whole.
  const file = fileInput.files[0];
  let info;
  try { info = await readBackupHeader(file); } catch { statusEl.textContent = 'Not a valid backup file.'; return; }

  statusEl.textContent = 'Restoring…';
  const common = { passphrase, mode, categories, takeSafetyBackup, confirmedDestructive: true };
  let result;
  try {
    result = await withoutIdleLock(() => restoreBackup(db, info.version === 2
      ? {
        ...common, file, header: info.header,
        onPhase: (text) => { statusEl.textContent = text; },
        onProgress: ({ done, total }) => { statusEl.textContent = `Restoring ${done} of ${total}…`; }
      }
      : { ...common, archiveObj: info.archiveObj }));
  } catch {
    result = { ok: false, reason: 'wrong_passkey_or_damaged_file' }; // format 1: a wrong passkey throws on decrypt
  }
  const REASONS = {
    wrong_passkey_or_damaged_file: 'wrong passkey, or the file is damaged',
    backup_damaged: 'the file is damaged',
    backup_incomplete: 'the file ends early; entries restored so far were kept',
    insufficient_storage: 'not enough free space'
  };
  statusEl.textContent = result.ok
    ? `Done — added ${result.summary.added}, skipped ${result.summary.skippedExactDup} exact duplicates, ` +
      `${result.summary.restoredLabeled} restored under "(Restored)".`
    : `Restore failed: ${REASONS[result.reason] || result.reason || 'unknown error'}.`;
  if (result.ok) {
    document.getElementById('restore-passphrase').value = '';
    fileInput.value = '';
    // The Vault list reads an in-memory index built at unlock (Decision 39); rebuild it so restored
    // Vault entries show without a relock (a full rebuild: many entries changed). Locked Vault: nothing to do, unlock builds it fresh.
    if (privateSessionKey) await buildVaultIndexWithNotice();
    window.dispatchEvent(new Event('arkly-data-restored'));
  } else if (result.summary?.added) { // stopped part-way: what was restored is real, show it
    if (privateSessionKey) await buildVaultIndexWithNotice();
    window.dispatchEvent(new Event('arkly-data-restored'));
  }
}

function formatBytes(n) {
  if (n === null || n === undefined) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Row/icon rendering shared by Home folders, Vault folders and both search lists (Decision 86).
// Icons come from the inline sprite in index.html. All user text is escaped before it reaches innerHTML.
const TYPE_ICON = { note: 'note', voice: 'voice', image: 'image', pdf: 'pdf', reminder: 'reminder', location: 'location', money: 'money', expense: 'money', file: 'file' };
function iconSvg(name, cls = 'ic') { return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function typeLabelFor(type) { return VAULT_TYPE_LABELS[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : ''); }
function formatEntryDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
// actionPrefix: 'main' | 'vault' renders Edit/Share/Download/Delete icon buttons (Decision 134) wired by their existing
// ${prefix}-*-btn classes; null renders a plain (search-result) row.
// Meta line and greyed-out flag for a full entry row (Home folders and search).
let currencySymbol = Money.DEFAULT_SYMBOL; // one symbol for the whole app (Decision 124); meta key currency_symbol
async function loadCurrencySymbol() {
  currencySymbol = Money.cleanSymbol(await metaGet('currency_symbol', Money.DEFAULT_SYMBOL));
  return currencySymbol;
}
// Row line for a Money details object (Home and Vault share it).
function moneyRowMeta(d) {
  const st = Money.status(d);
  const state = st === 'partly returned' ? `${Money.STATUS_LABELS[st]}, ${Money.formatAmount(Money.remaining(d), currencySymbol)} left` : (st ? Money.STATUS_LABELS[st] : '');
  return { meta: [Money.KIND_LABELS[d.kind], Money.formatAmount(d.amount, currencySymbol), state, formatEntryDate(d.at)].filter(Boolean).join(' · '), done: st === 'settled' };
}
function rowMeta(row) {
  if (row.type === 'money' || row.type === 'expense') {
    const d = Money.fromRow(row);
    if (d) return moneyRowMeta(d);
  }
  if (row.type !== 'reminder') return { meta: [typeLabelFor(row.type), formatEntryDate(row.created_at)].filter(Boolean).join(' · '), done: false };
  const st = reminderStatus(row);
  const when = formatEntryDate(reminderNextDue(row));
  const lead = st === 'done' ? 'Done' : st === 'fired' ? 'Fired' : 'Due';
  const timing = st === 'snoozed' ? `Snoozed until ${formatEntryDate(row.snoozed_until)}` : `${lead} ${when}`;
  return { meta: ['Reminder', timing, row.repeat_rule ? repeatLabel(row.repeat_rule).toLowerCase() : ''].filter(Boolean).join(' · '), done: st === 'done' || st === 'fired' };
}
// Files show their extension (PDF, DOCX, ZIP) in place of the folder icon; no extension keeps the icon.
function rowIconHtml(type, ext) {
  const e = type === 'file' ? String(ext || '').replace(/^\./, '').toUpperCase().slice(0, 4) : '';
  return e
    ? `<span class="row-icon ext-badge" data-len="${e.length}">${escapeHtml(e)}</span>`
    : `<span class="row-icon">${iconSvg(TYPE_ICON[type] || 'file')}</span>`;
}
function entryRowHtml({ id, type, label, meta = '', tags = [], done = false, ext = '' }, actionPrefix = null) {
  const btn = (kind, name, extra = '') => `<button class="icon-btn ${actionPrefix}-${kind}-btn${extra}" data-id="${escapeHtml(id)}" aria-label="${name}" title="${name}">${iconSvg(kind === 'delete' ? 'trash' : kind)}</button>`;
  return `
    <div class="entry-row${done ? ' is-done' : ''}" data-type="${escapeHtml(type)}" data-id="${escapeHtml(id)}">
      ${rowIconHtml(type, ext)}
      <span class="row-main">
        <span class="row-title">${escapeHtml(label)}</span>
        <span class="row-meta">${escapeHtml(meta)}</span>
        ${tags && tags.length ? `<span class="row-tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>` : ''}
      </span>
      ${actionPrefix ? `<span class="row-actions">${btn('edit', 'Edit')}${btn('share', 'Share')}${btn('download', 'Download')}${btn('delete', 'Delete', ' warning-text')}</span>` : ''}
    </div>`;
}
function emptyStateHtml(kind = 'folder') {
  return kind === 'search'
    ? `<div class="empty-state">${iconSvg('search')}<strong>No matches</strong><span>Try a different word.</span></div>`
    : `<div class="empty-state">${iconSvg('plus')}<strong>Nothing here yet</strong><span>Tap New to add the first one.</span></div>`;
}

// ---- Toast, Save dialog, text editor (Decision 91). Top-level so a lock can force-close them. ----
let toastTimer = null;
// Save confirmation for a reminder: the chosen time plus how far away it is, so an AM/PM slip is visible at once (Decision 95).
function reminderSetText(ms) {
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const away = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.floor(mins / 1440)} d ${Math.floor((mins % 1440) / 60)} h`;
  const when = new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `Reminder set for ${when} · in ${away}`;
}

// sticky: stays until hideToast() or the next toast (used while a slow step runs, e.g. a GPS fix).
// action: { label, run, isVault } adds a button to the toast and keeps it up longer. Only one toast shows at a time, so a
// newer toast drops an Undo that is still showing.
let undoState = null; // { isVault } while a toast with an action is showing
const UNDO_MS = 6000;
function toast(message, sticky = false, action = null) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('with-action', !!action);
  undoState = action ? { isVault: !!action.isVault } : null;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = async () => { hideToast(); await action.run(); };
    el.appendChild(b);
  }
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(hideToast, action ? UNDO_MS : 3200);
}

// A toast that confirms a successful save, with a short vibration (Decision 173).
function toastSaved(message) { haptic('saved'); toast(message); }
function hideToast() {
  clearTimeout(toastTimer);
  undoState = null;
  document.getElementById('toast')?.classList.add('hidden');
}

// Deleting only moves entries to the 30-day trash, so Undo is a restore. Shown after every delete except "Delete permanently".
let refreshAfterUndo = null; // set once the screens exist: redraws Home, search and the Vault
function offerUndo(ids, { isVault = false, message = null, after = null } = {}) {
  if (!ids.length) return;
  haptic('delete');
  toast(message || (ids.length === 1 ? 'Moved to trash' : `${ids.length} moved to trash`), false, {
    label: 'Undo', isVault,
    run: async () => {
      try {
        for (const id of ids) await restoreFromTrash(db, id); // also puts a pending reminder back on the schedule
        if (privateSessionKey) await refreshVaultIndexEntries(db, privateSessionKey, ids);
        if (refreshAfterUndo) await refreshAfterUndo();
        if (after) await after();
        toast(ids.length === 1 ? 'Restored' : `${ids.length} restored`);
      } catch (err) { toast(`Could not undo: ${err.message || err}`); }
    }
  });
}

let activeSaveDialog = null; // { finish, isVault, requestLeave }
let activeYesNo = null;      // { finish } — the in-app Yes/No dialog
let activeText = null;       // { finish, isVault } — the in-app single-field text sheet
let activeCompose = null;    // { finish, isVault } — the order sheet of Merge PDFs and Make a PDF (Decision 168)
let activeLocSource = null;  // { finish, isVault } — New location: current fix or coordinates
let activeCoords = null;     // { finish, isVault } — paste coordinates / map link dialog
let activeMoney = null;      // { finish, leave, isVault } — Money form or repayment dialog
// Unsaved-work rule (Decision 133): Back and every Cancel ask this before dropping changes. Resolves true to discard.
function askDiscard() {
  return askYesNo({ title: 'Discard changes?', text: 'Your changes have not been saved.', yes: 'Yes, discard', no: 'No, keep editing' });
}
// Everything typed or chosen inside a dialog, as one string. Taken when it opens and compared on leave.
function formState(el) {
  if (!el) return '';
  const vals = Array.from(el.querySelectorAll('input, select, textarea')).map((i) => (i.type === 'checkbox' || i.type === 'radio' ? String(i.checked) : i.value));
  const lists = Array.from(el.querySelectorAll('.rep-list')).map((l) => l.textContent);
  return JSON.stringify([vals, lists]);
}
// Both hooks refresh the Back button, which would otherwise stay dimmed or lit from before the dialog (Decision 132).
// leave() is Back and Cancel: closes at once when nothing changed, else asks Discard.
const moneyHooksFor = (isVault) => ({
  open: (finish) => {
    const dlg = ['money-dialog', 'repay-dialog'].map((id) => document.getElementById(id)).find((d) => d && !d.classList.contains('hidden'));
    const snap = formState(dlg);
    activeMoney = { finish, isVault, leave: async () => { if (formState(dlg) === snap || await askDiscard()) finish(null); } };
    updateBackButtonState();
  },
  close: () => { activeMoney = null; updateBackButtonState(); },
  leave: () => (activeMoney ? activeMoney.leave() : undefined)
});
const moneyHooks = moneyHooksFor(false);
const vaultMoneyHooks = moneyHooksFor(true); // a Vault lock closes this one; an app lock closes both

// Yes/No sheet. Resolves true on Yes, false on No, Back or a lock. One at a time; a second call returns false.
// explicitNo: the No button resolves 'no'; Back or a lock still resolves false, so a dismissal is never read as a choice.
// Advisory check when a secret is set (Decision 170): a weak one is shown with Use it or Change it. Resolves true to go on.
async function confirmStrength(kind, secret) {
  const w = weakness(kind, secret);
  return !w || askYesNo({ title: w.title, text: w.text, yes: 'Use it', no: 'Change it' });
}

function askYesNo({ title = 'Are you sure?', text = '', yes = 'Yes', no = 'No', explicitNo = false } = {}) {
  if (activeYesNo) return Promise.resolve(false);
  return new Promise((resolve) => {
    const dlg = document.getElementById('yesno-dialog');
    document.getElementById('yesno-title').textContent = title;
    document.getElementById('yesno-text').textContent = text;
    document.getElementById('yesno-yes-btn').textContent = yes;
    document.getElementById('yesno-no-btn').textContent = no;
    const finish = (v) => {
      if (!activeYesNo) return;
      activeYesNo = null;
      dlg.classList.add('hidden');
      resolve(v);
    };
    document.getElementById('yesno-yes-btn').onclick = () => finish(true);
    document.getElementById('yesno-no-btn').onclick = () => finish(explicitNo ? 'no' : false);
    activeYesNo = { finish };
    dlg.classList.remove('hidden');
  });
}
// Single-field text sheet. Resolves the typed string, or null on Cancel, Back or a lock. The field is emptied on close.
function askText({ title = '', text = '', placeholder = '', initial = '', password = false, decimal = false, ok = 'OK', cancel = 'Cancel', isVault = false } = {}) {
  if (activeText) return Promise.resolve(null);
  return new Promise((resolve) => {
    const dlg = document.getElementById('text-dialog'), input = document.getElementById('text-input');
    document.getElementById('text-title').textContent = title;
    document.getElementById('text-text').textContent = text;
    document.getElementById('text-ok-btn').textContent = ok;
    document.getElementById('text-cancel-btn').textContent = cancel;
    input.type = password ? 'password' : 'text';
    input.inputMode = decimal ? 'decimal' : 'text';
    input.placeholder = placeholder;
    input.value = initial;
    const finish = (v) => {
      if (!activeText) return;
      activeText = null;
      input.value = '';
      dlg.classList.add('hidden');
      updateBackButtonState();
      resolve(v);
    };
    document.getElementById('text-ok-btn').onclick = () => finish(input.value);
    document.getElementById('text-cancel-btn').onclick = () => finish(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') finish(input.value); };
    activeText = { finish, isVault };
    dlg.classList.remove('hidden');
    updateBackButtonState();
    setTimeout(() => input.focus(), 50);
  });
}
let activeEditor = null;     // { finish, requestBack, isVault }
let activeViewer = null;     // { finish, back, isVault } — entry viewer shell (Decision 92); back honours the viewer's guard
let overlayAbortCount = 0;   // bumped when a lock force-closes overlays, so capture loops stop instead of reopening the editor

// vaultOnly: Vault lock closes only Vault overlays; app lock closes everything. Both resolve null.
function dismissOverlays(vaultOnly = false) {
  if (undoState && (!vaultOnly || undoState.isVault)) hideToast(); // no Undo button on the lock screen or after a Vault lock
  if (activeYesNo) activeYesNo.finish(false);
  if (activeText && (!vaultOnly || activeText.isVault)) activeText.finish(null); // clears the typed value too
  if (activeCompose && (!vaultOnly || activeCompose.isVault)) activeCompose.finish(null);
  if (activeCoords && (!vaultOnly || activeCoords.isVault)) activeCoords.finish(null); // clears the pasted text too
  if (activeLocSource && (!vaultOnly || activeLocSource.isVault)) activeLocSource.finish(null);
  if (activeMoney && (!vaultOnly || activeMoney.isVault)) activeMoney.finish(null); // a Vault lock leaves a Home form alone
  const hadAny = (activeSaveDialog && (!vaultOnly || activeSaveDialog.isVault)) || (activeEditor && (!vaultOnly || activeEditor.isVault)) || (activeViewer && (!vaultOnly || activeViewer.isVault));
  if (hadAny) overlayAbortCount++;
  if (activeSaveDialog && (!vaultOnly || activeSaveDialog.isVault)) activeSaveDialog.finish(null);
  if (activeEditor && (!vaultOnly || activeEditor.isVault)) activeEditor.finish(null);
  if (activeViewer && (!vaultOnly || activeViewer.isVault)) activeViewer.finish();
}

// Resolves { name, tags, description, mode } or null (cancelled). An untouched Save returns the default
// name, no tags, no description. count > 1 shows the naming switch: mode 'own' (each file keeps its own
// name; name is null) or 'number' (one common name, numbered).
function openSaveDialog({ heading = 'Save', defaultName = '', name, tags = [], description = '', isVault = false, count = 1, discardLabel = null, reminder = null } = {}) {
  return new Promise(async (resolve) => {
    const $ = (id) => document.getElementById(id);
    const dlg = $('save-dialog'), nameEl = $('sd-name'), descEl = $('sd-desc'), newTagEl = $('sd-new-tag');
    const chipsEl = $('sd-tag-chips'), countEl = $('sd-tag-count'), modeEl = $('sd-mode');
    let selected = tags.slice(0, MAX_TAGS);
    let known = [];
    try { known = await listTagsForScope(db, isVault); } catch { known = []; }
    let mode = 'own';

    // Reminder block (Decision 92): when + repeat live in the same dialog, so a reminder is saved in one step too.
    const remEl = $('sd-reminder'), whenEl = $('sd-when'), repeatEl = $('sd-repeat');
    const pad = (n) => String(n).padStart(2, '0');
    const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    remEl.classList.toggle('hidden', !reminder);
    if (reminder) {
      const start = reminder.fire_at || (() => { const d = new Date(Date.now() + 60 * 60 * 1000); d.setMinutes(0, 0, 0); return d.getTime(); })();
      whenEl.value = toLocalInput(start);
      repeatEl.value = reminder.repeat_rule || '';
      $('sd-presets').querySelectorAll('button').forEach((b) => { b.onclick = () => {
        const d = new Date();
        if (b.dataset.preset === 'hour') { d.setTime(Date.now() + 60 * 60 * 1000); d.setMinutes(0, 0, 0); }
        else if (b.dataset.preset === 'tonight') { d.setHours(20, 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); }
        else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
        whenEl.value = toLocalInput(d.getTime());
      }; });
    }

    $('sd-heading').textContent = heading;
    descEl.value = description || '';
    newTagEl.value = '';
    $('sd-cancel-btn').textContent = discardLabel || 'Cancel';

    const applyMode = () => {
      modeEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      const own = count > 1 && mode === 'own';
      nameEl.disabled = own;
      nameEl.value = own ? '' : (name ?? defaultName);
      nameEl.placeholder = own ? 'Each file keeps its own name' : defaultName;
    };
    modeEl.classList.toggle('hidden', count <= 1);
    modeEl.querySelectorAll('button').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; applyMode(); }; });
    applyMode();

    const has = (list, t) => list.some((x) => x.toLowerCase() === t.toLowerCase());
    const renderChips = () => {
      const names = [...known, ...selected.filter((t) => !has(known, t))];
      chipsEl.innerHTML = names.map((t) => {
        const on = has(selected, t);
        const off = !on && selected.length >= MAX_TAGS;
        return `<button type="button" class="${on ? 'selected' : ''}${off ? ' disabled' : ''}" data-tag="${escapeHtml(t)}" aria-pressed="${on}">${escapeHtml(t)}</button>`;
      }).join('');
      countEl.textContent = `${selected.length} / ${MAX_TAGS}`;
      chipsEl.querySelectorAll('button').forEach((b) => { b.onclick = () => {
        const t = b.dataset.tag;
        if (has(selected, t)) selected = selected.filter((x) => x.toLowerCase() !== t.toLowerCase());
        else if (selected.length >= MAX_TAGS) { toast(`An entry can have up to ${MAX_TAGS} tags`); return; }
        else selected.push(t);
        renderChips();
      }; });
    };
    renderChips();

    const addTag = () => {
      const t = newTagEl.value.trim();
      if (!t) return true;
      if (has(selected, t)) { newTagEl.value = ''; return true; }
      if (selected.length >= MAX_TAGS) { toast(`An entry can have up to ${MAX_TAGS} tags`); return false; }
      selected.push(known.find((k) => k.toLowerCase() === t.toLowerCase()) || t);
      newTagEl.value = '';
      renderChips();
      return true;
    };
    $('sd-add-tag-btn').onclick = addTag;
    newTagEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } };

    const finish = (result) => {
      dlg.classList.add('hidden');
      document.activeElement?.blur?.();
      activeSaveDialog = null;
      updateBackButtonState();
      resolve(result);
    };
    $('sd-save-btn').onclick = () => {
      addTag(); // a tag typed but not yet added still counts
      const typed = nameEl.value.trim();
      const own = count > 1 && mode === 'own';
      const result = {
        name: own ? null : (typed || defaultName),
        tags: selected.slice(0, MAX_TAGS),
        description: descEl.value.trim(),
        mode: count > 1 ? mode : 'single'
      };
      if (reminder) {
        let fireAt = new Date(whenEl.value).getTime();
        if (isNaN(fireAt)) { toast('Pick a date and time'); return; }
        // The picker works in whole minutes. Unchanged to the minute means unchanged: keep the stored value exactly,
        // so a reminder created from typed text (which may carry seconds) is not treated as rescheduled.
        const unchanged = reminder.fire_at && Math.floor(fireAt / 60000) === Math.floor(reminder.fire_at / 60000);
        if (unchanged) fireAt = reminder.fire_at;
        // A past time is only refused when it is a new choice: re-saving an already-fired reminder unchanged is fine.
        if (!repeatEl.value && fireAt <= Date.now() && !unchanged) { toast('Pick a time in the future'); return; }
        result.fire_at = fireAt;
        result.repeat_rule = repeatEl.value || null;
      }
      finish(result);
    };
    // Capture dialogs (Discard) ask Yes/No before dropping the take; Cancel and Back to editing leave at once.
    // Edit dialogs ask only when a field changed since opening (Decision 133).
    const snap = () => JSON.stringify([nameEl.value, descEl.value, selected, newTagEl.value, whenEl ? whenEl.value : '', repeatEl ? repeatEl.value : '']);
    const startSnap = snap();
    const requestLeave = async () => {
      if (discardLabel === 'Discard') {
        const yes = await askYesNo({ title: 'Discard?', text: 'Nothing will be saved.', yes: 'Yes, discard', no: 'No, keep it' });
        if (yes) finish(null);
        return;
      }
      if (snap() === startSnap || await askDiscard()) finish(null);
    };
    $('sd-cancel-btn').onclick = requestLeave;
    dlg.onclick = (e) => { if (e.target === dlg && !discardLabel) requestLeave(); }; // capture dialogs ignore outside taps so a stray tap can't lose a recording
    activeSaveDialog = { finish, isVault, requestLeave };
    dlg.classList.remove('hidden');
    updateBackButtonState();
  });
}

// Resolves the text on Save, or null on leave. Leaving with unsaved changes needs a second Back within 3 s.
function openTextEditor({ title = 'New note', text = '', isVault = false } = {}) {
  return new Promise((resolve) => {
    const $ = (id) => document.getElementById(id);
    const screen = $('editor-screen'), ta = $('editor-text');
    let dirty = false;
    $('editor-title').textContent = title;
    ta.value = text;
    const updateCount = () => {
      const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      $('editor-count').textContent = `${words} word${words === 1 ? '' : 's'} · ${ta.value.length} characters`;
    };
    updateCount();
    const finish = (result) => {
      screen.classList.add('hidden');
      ta.blur();
      ta.oninput = null;
      activeEditor = null;
      updateBackButtonState();
      resolve(result);
    };
    // Unsaved changes: one Back asks Yes/No (replaces the earlier tap-twice-within-3-seconds rule).
    const requestBack = async () => {
      if (!dirty) { finish(null); return; }
      const yes = await askYesNo({ title: 'Discard changes?', text: 'Your text has not been saved.', yes: 'Yes, discard', no: 'No, keep editing' });
      if (yes && activeEditor) finish(null);
    };
    ta.oninput = () => { dirty = ta.value !== text; updateCount(); };
    $('editor-back-btn').onclick = requestBack;
    $('editor-save-btn').onclick = () => {
      if (!ta.value.trim()) { toast('Nothing to save yet'); return; }
      finish(ta.value);
    };
    activeEditor = { finish, requestBack, isVault };
    screen.classList.remove('hidden');
    updateBackButtonState();
    if (!text) setTimeout(() => ta.focus(), 60);
  });
}

// ---- Image thumbnails and zoom/pan (Phase 16 D, Decision 105) ----
// Thumbnails: longest side THUMB_PX, JPEG. Held only in this map, Home and Vault alike; nothing is written to disk
// (Decision 162: a cached thumbnail would be a plain copy of an encrypted image). lockVault() empties the Vault ones.
const THUMB_PX = 320;
const thumbMem = new Map(); // 'h:<id>' | 'v:<id>' -> data URL
function clearVaultThumbs() { for (const k of [...thumbMem.keys()]) if (k.startsWith('v:')) thumbMem.delete(k); }
let thumbActive = 0;
const thumbQueue = [];
function runThumbJob(job) { // two decodes at a time: full-size photos are large
  return new Promise((resolve, reject) => {
    thumbQueue.push(() => job().then(resolve, reject));
    pumpThumbs();
  });
}
function pumpThumbs() {
  while (thumbActive < 2 && thumbQueue.length) {
    const next = thumbQueue.shift();
    thumbActive++;
    next().finally(() => { thumbActive--; pumpThumbs(); });
  }
}
async function downscaleToDataUrl(blobUrl, maxSide) {
  const img = new Image();
  img.src = blobUrl;
  await img.decode();
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
// Full-size blob URL for an image entry; the caller revokes it.
async function imageBlobUrl(item, isVault) {
  if (isVault) return (await openVaultEntry(item.id)).blobUrl;
  const row = item.file_path ? item : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0];
  if (!row) throw new Error('Image not found');
  return URL.createObjectURL(new Blob([await readEntryBytes(row)], { type: mimeTypeForVaultRow({ extension: row.extension }) }));
}
async function thumbFor(item, isVault) {
  const key = `${isVault ? 'v' : 'h'}:${item.id}`;
  if (thumbMem.has(key)) return thumbMem.get(key);
  let dataUrl;
  const url = await imageBlobUrl(item, isVault);
  try { dataUrl = await downscaleToDataUrl(url, THUMB_PX); } finally { URL.revokeObjectURL(url); }
  if (isVault && !privateSessionKey) throw new Error('Vault locked'); // locked while decoding: keep nothing
  thumbMem.set(key, dataUrl);
  return dataUrl;
}
let thumbObserver = null;
// Fills a grid of .thumb-tile[data-id] as tiles scroll into view.
function loadThumbsInto(container, items, isVault) {
  if (thumbObserver) thumbObserver.disconnect();
  const byId = new Map(items.map((i) => [i.id, i]));
  const load = async (tile) => {
    const item = byId.get(tile.dataset.id);
    if (!item) return;
    try {
      const src = await runThumbJob(async () => (tile.isConnected ? thumbFor(item, isVault) : null));
      if (src && tile.isConnected) tile.innerHTML = `<img src="${src}" alt="" draggable="false">`;
    } catch { /* tile keeps its placeholder */ }
  };
  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { thumbObserver.unobserve(e.target); load(e.target); }
  }, { rootMargin: '200px' });
  container.querySelectorAll('.thumb-tile').forEach((t) => thumbObserver.observe(t));
}
function thumbGridHtml(items) {
  return `<div class="thumb-grid">${items.map((i) => `<button type="button" class="thumb-tile" data-id="${escapeHtml(i.id)}" aria-label="${escapeHtml(i.label)}">${iconSvg('image')}</button>`).join('')}</div>`;
}

// Pinch, drag and double-tap on one image inside a stage. At scale 1 a horizontal drag is a swipe (onSwipe(+1|-1)).
const ZOOM_MAX = 6, ZOOM_DOUBLE = 2.5;
function clampPan(tx, ty, scale, stage, img) {
  const mx = Math.max(0, (img.clientWidth * scale - stage.clientWidth) / 2);
  const my = Math.max(0, (img.clientHeight * scale - stage.clientHeight) / 2);
  return [Math.min(mx, Math.max(-mx, tx)), Math.min(my, Math.max(-my, ty))];
}
function attachZoomPan(stage, img, { onSwipe = null, onActivity = null } = {}) {
  let scale = 1, tx = 0, ty = 0, swipeDx = 0;
  const pts = new Map();
  let pinch = null, lastTap = null, moved = false;
  const apply = (animate = false) => {
    img.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
    img.style.transform = `translate(${tx + swipeDx}px, ${ty}px) scale(${scale})`;
  };
  const rect = () => stage.getBoundingClientRect();
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = () => { const [a, b] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const down = (e) => {
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    moved = false;
    if (pts.size === 2) pinch = { d: dist(), scale, m: mid(), tx, ty };
    if (onActivity) onActivity();
  };
  const move = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 8) moved = true;
    if (pts.size === 2 && pinch) {
      scale = Math.min(ZOOM_MAX, Math.max(1, pinch.scale * (dist() / pinch.d)));
      const m = mid();
      [tx, ty] = clampPan(pinch.tx + (m.x - pinch.m.x), pinch.ty + (m.y - pinch.m.y), scale, stage, img);
      apply();
    } else if (pts.size === 1) {
      if (scale > 1) { [tx, ty] = clampPan(tx + dx, ty + dy, scale, stage, img); apply(); }
      else if (Math.abs(e.clientX - p.sx) > Math.abs(e.clientY - p.sy)) { swipeDx = e.clientX - p.sx; apply(); }
    }
    if (onActivity) onActivity();
  };
  const up = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1 && scale > 1) { const [q] = pts.values(); q.sx = q.x; q.sy = q.y; } // finger left after a pinch: keep panning
    if (pts.size > 0) return;
    if (scale < 1.02) { scale = 1; tx = ty = 0; }
    const dx = swipeDx;
    swipeDx = 0;
    if (scale === 1 && Math.abs(dx) > stage.clientWidth * 0.2 && onSwipe) { apply(false); onSwipe(dx < 0 ? 1 : -1); return; }
    if (!moved) { // a tap: a second one close by is a double tap
      const now = Date.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        if (scale > 1) { scale = 1; tx = ty = 0; }
        else {
          const r = rect();
          scale = ZOOM_DOUBLE;
          [tx, ty] = clampPan((r.left + r.width / 2 - e.clientX) * (scale - 1), (r.top + r.height / 2 - e.clientY) * (scale - 1), scale, stage, img);
        }
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    apply(true);
  };
  const cancel = (e) => { pts.delete(e.pointerId); pinch = null; swipeDx = 0; if (!pts.size) apply(true); };
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', cancel);
  return {
    reset() { scale = 1; tx = ty = 0; swipeDx = 0; pts.clear(); pinch = null; apply(false); },
    scale: () => scale,
    destroy() {
      stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', cancel);
    }
  };
}

// ---- Audio player (Phase 16 C, Decision 103). Shared by the voice viewer and the recorder's review step.
// Plain <audio> on an in-memory blob URL: play/pause, scrub, speed. The caller owns the URL and revokes it.
const PLAYER_SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const ICON_PLAY = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
function formatClock(sec) {
  const s = Math.floor(isFinite(sec) && sec > 0 ? sec : 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// fallbackMs: known length for containers that report none. onActivity: called while playing (keeps idle locks armed).
function createAudioPlayer(container, url, { fallbackMs = 0, onActivity = null } = {}) {
  container.innerHTML = `<div class="audio-player">
    <button type="button" class="play-btn" aria-label="Play">${ICON_PLAY}</button>
    <div class="player-track">
      <input type="range" class="scrub" min="0" max="1000" value="0" step="1" aria-label="Seek">
      <div class="player-times"><span class="p-cur">0:00</span><span class="p-dur">0:00</span></div>
    </div>
    <button type="button" class="speed-btn secondary-btn" aria-label="Playback speed">1×</button>
  </div>`;
  const q = (sel) => container.querySelector(sel);
  const playBtn = q('.play-btn'), scrub = q('.scrub'), cur = q('.p-cur'), dur = q('.p-dur'), speedBtn = q('.speed-btn');
  const audio = new Audio();
  audio.preload = 'metadata';
  let scrubbing = false, speedIdx = 0, dead = false;
  const length = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackMs / 1000);
  const paint = () => {
    const d = length();
    if (!scrubbing) {
      scrub.value = d ? String(Math.min(1000, Math.round((audio.currentTime / d) * 1000))) : '0';
      cur.textContent = formatClock(audio.currentTime);
    }
    dur.textContent = formatClock(d);
  };
  const showPlay = () => { playBtn.innerHTML = ICON_PLAY; playBtn.setAttribute('aria-label', 'Play'); };
  audio.addEventListener('loadedmetadata', () => {
    if (audio.duration === Infinity) { // no length in the container: a far seek makes the browser find it
      const settle = () => { audio.removeEventListener('timeupdate', settle); audio.currentTime = 0; paint(); };
      audio.addEventListener('timeupdate', settle);
      audio.currentTime = 1e101;
    }
    paint();
  });
  audio.addEventListener('durationchange', paint);
  audio.addEventListener('timeupdate', () => { paint(); if (!audio.paused && onActivity) onActivity(); });
  audio.addEventListener('play', () => { playBtn.innerHTML = ICON_PAUSE; playBtn.setAttribute('aria-label', 'Pause'); });
  audio.addEventListener('pause', showPlay);
  audio.addEventListener('ended', () => { showPlay(); paint(); });
  audio.addEventListener('error', () => { if (!dead) toast('Could not play this recording'); });
  audio.src = url;
  paint();

  playBtn.onclick = () => {
    if (!audio.paused) { audio.pause(); return; }
    const d = length();
    if (d && audio.currentTime >= d - 0.05) audio.currentTime = 0; // finished: play from the start
    audio.play().catch(() => toast('Could not play this recording'));
  };
  scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  scrub.addEventListener('pointercancel', () => { scrubbing = false; paint(); });
  scrub.addEventListener('input', () => { cur.textContent = formatClock((Number(scrub.value) / 1000) * length()); });
  scrub.addEventListener('change', () => {
    const d = length();
    if (d) audio.currentTime = (Number(scrub.value) / 1000) * d;
    scrubbing = false;
    paint();
  });
  speedBtn.onclick = () => {
    speedIdx = (speedIdx + 1) % PLAYER_SPEEDS.length;
    audio.defaultPlaybackRate = audio.playbackRate = PLAYER_SPEEDS[speedIdx];
    speedBtn.textContent = `${PLAYER_SPEEDS[speedIdx]}×`;
  };
  return {
    destroy() {
      dead = true;
      try { audio.pause(); } catch { /* already stopped */ }
      audio.removeAttribute('src');
      audio.load();
    }
  };
}

// Reminder completion (Decision 92). Top-level: notification actions call these before the UI exists.
// Done: a one-off is finished and cancelled. A repeating reminder is only done for this time (Decision 108): its
// snooze is cleared and the later occurrences stay scheduled.
async function markReminderDone(id) {
  const row = ((await db.query(`SELECT repeat_rule FROM entries WHERE id = ?`, [id])).values || [])[0];
  if (row && row.repeat_rule) {
    await db.run(`UPDATE entries SET snoozed_until = NULL, updated_at = ? WHERE id = ?`, [Date.now(), id]);
    try { await cancelSnooze(id); } catch { /* no snooze pending */ }
    return;
  }
  await db.run(`UPDATE entries SET completed_at = ?, snoozed_until = NULL, updated_at = ? WHERE id = ?`, [Date.now(), Date.now(), id]);
  try { await cancelReminder(id); } catch { /* nothing scheduled */ }
}
// Re-arms the window for repeating reminders, at most every 6 hours; never blocks the UI.
let lastRefillAt = 0;
async function refillRepeating() {
  if (!db || Date.now() - lastRefillAt < 6 * 60 * 60 * 1000) return;
  lastRefillAt = Date.now();
  try {
    const live = (await db.query(`SELECT * FROM entries WHERE type = 'reminder' AND deleted_at IS NULL AND completed_at IS NULL AND repeat_rule IS NOT NULL`)).values || [];
    await refillRepeatingReminders(live);
  } catch { lastRefillAt = 0; /* retried on the next resume */ }
}
// Snooze / Done taps handled natively with the app closed or locked (Decision 102). The receiver only queues
// {a: action, e: entryId, t: time} under dz_ra:* keys in the Preferences store; the database changes here, in tap order.
const QUEUED_ACTION_PREFIX = 'dz_ra:';
const SNOOZE_MS = 10 * 60 * 1000;
let drainingQueuedActions = false;
async function drainQueuedReminderActions() {
  if (drainingQueuedActions || !db) return;
  drainingQueuedActions = true;
  try {
    const { keys } = await Preferences.keys();
    const mine = keys.filter((k) => k.startsWith(QUEUED_ACTION_PREFIX));
    if (!mine.length) return;
    const items = [];
    for (const key of mine) {
      const { value } = await Preferences.get({ key });
      try { items.push(JSON.parse(value)); } catch { /* unreadable: dropped with the rest below */ }
    }
    items.sort((x, y) => x.t - y.t);
    for (const it of items) {
      if (it.a === 'done') await db.run(`UPDATE entries SET completed_at = CASE WHEN repeat_rule IS NULL THEN ? ELSE NULL END, snoozed_until = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [it.t, it.t, it.e]);
      else if (it.a === 'snooze') await db.run(`UPDATE entries SET snoozed_until = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [it.t + SNOOZE_MS, it.t, it.e]);
    }
    for (const key of mine) await Preferences.remove({ key }); // after the writes: a failure above is retried, same result
    window.dispatchEvent(new Event('arkly-reminders-changed'));
    if (items.some((it) => it.a === 'done')) { lastRefillAt = 0; refillRepeating(); } // re-arm a series a pre-Decision-108 notification cut short
  } catch { /* retried on the next tick */ }
  finally { drainingQueuedActions = false; }
}

async function reopenReminder(id) {
  await db.run(`UPDATE entries SET completed_at = NULL, updated_at = ? WHERE id = ?`, [Date.now(), id]);
  const row = ((await db.query(`SELECT * FROM entries WHERE id = ?`, [id])).values || [])[0];
  if (row && isReminderActive(row)) {
    try { await scheduleReminder(row); } catch { /* scheduling failed — entry still reopened */ }
  }
}

async function getEntryTags(entryId) {
  const r = await db.query(
    `SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? ORDER BY t.name`, [entryId]
  );
  return (r.values || []).map((x) => x.name);
}

// Replaces an entry's tags (max two). Tag rows no entry uses any more stay in `tags` but are never listed.
async function setEntryTags(entryId, names) {
  await db.run(`DELETE FROM entry_tags WHERE entry_id = ?`, [entryId]);
  await applyTags(entryId, names);
}

function defaultNoteName(text) {
  const firstLine = (text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return firstLine.slice(0, 40) || `Note ${new Date().toLocaleDateString()}`;
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
  const passphrase = await askText({ title: 'Backup passkey', text: 'For this Drive backup. Not stored.', password: true, ok: 'Continue' }); // one-off, not stored anywhere
  if (!passphrase) return;

  let preview;
  try { preview = await previewDriveBackup(accessToken, fileId, passphrase); }
  catch { statusEl.textContent = 'Wrong passkey or corrupted backup.'; return; }

  const categories = preview.categories; // restore everything the backup contains, same as opening a local file with all boxes checked
  const choice = await askYesNo({
    title: 'Restore mode',
    text: `This backup has: ${categories.map((c) => CATEGORY_LABELS[c] || c).join(', ')}. Append adds to existing data (safe). Overwrite replaces the selected categories.`,
    yes: 'Append (safe)', no: 'Overwrite…', explicitNo: true
  });
  if (!choice) { statusEl.textContent = 'Restore cancelled.'; return; } // Back or a lock never selects Overwrite
  const mode = choice === true ? 'append' : 'overwrite';

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
  const passphrase = await askText({ title: 'Backup passkey', text: 'Never stored. Needed for this upload only.', password: true, ok: 'Back up' });
  if (!passphrase || !(await confirmStrength('passkey', passphrase))) return;
  statusEl.textContent = 'Checking Drive storage…';
  try {
    const result = await backupToDrive(db, { passphrase, categories: ALL_CATEGORIES });
    if (!result.ok && result.reason === 'insufficient_drive_storage') {
      statusEl.textContent = `Not enough Drive space: needs ~${formatBytes(result.requiredBytes)}, ` +
        `${formatBytes(result.availableBytes)} available.`;
      return;
    }
    statusEl.textContent = result.ok ? `Uploaded ${result.name}.` : `Upload failed: ${result.reason}.`;
    if (result.ok) await refreshDriveConnectionView();
  } catch (err) {
    statusEl.textContent = err.message; // e.g. "Google Drive isn't set up yet..." — same guard as connect
  }
}

// The update token (Decision 164): one value in the encrypted database's meta table. Not in APP_SETTINGS_KEYS, so no
// backup carries it. Read only on the update taps below.
const UPDATE_TOKEN_KEY = 'update_token';
async function getUpdateToken() {
  const r = await db.query(`SELECT value FROM meta WHERE key = ?`, [UPDATE_TOKEN_KEY]);
  return (r.values || [])[0]?.value || null;
}

async function renderUpdateTokenStatus() {
  document.getElementById('update-token-status').textContent = (await getUpdateToken()) ? 'Token saved on this phone.' : 'No token saved.';
}

async function handleSaveUpdateToken() {
  const input = document.getElementById('update-token-input');
  const value = input.value.trim();
  if (!value) return;
  await db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [UPDATE_TOKEN_KEY, value]);
  input.value = '';
  await renderUpdateTokenStatus();
}

async function handleClearUpdateToken() {
  await db.run(`DELETE FROM meta WHERE key = ?`, [UPDATE_TOKEN_KEY]);
  await renderUpdateTokenStatus();
}

// Manual only (Decision 72) — runs when "Check for updates" is tapped in Settings, never on app
// open. Sideloaded APKs can't update themselves, so a match offers a direct download of the new
// APK (Decision 75) rather than the release page — one tap fewer, straight into the OS download
// manager. Same-version and error outcomes are reported inline too, since a button with no
// feedback path reads as broken.
async function handleCheckForUpdateClick() {
  const statusEl = document.getElementById('update-check-status');
  const downloadBtn = document.getElementById('update-download-btn');
  downloadBtn.disabled = true; // enabled only once a newer release is found
  delete downloadBtn.dataset.url;
  statusEl.textContent = 'Checking…';

  let currentVersion;
  try {
    currentVersion = (await App.getInfo()).version;
  } catch (e) {
    statusEl.textContent = 'Could not read the installed version.';
    return;
  }

  const result = await checkForUpdate({ currentVersion, token: await getUpdateToken() });
  if (result.status === 'up_to_date') {
    statusEl.textContent = `You're up to date — ${result.version}.`;
  } else if (result.status === 'update_available') {
    statusEl.textContent = `Update available: ${result.version} (you're on ${currentVersion}).`;
    downloadBtn.dataset.url = result.downloadUrl;
    downloadBtn.disabled = false;
  } else {
    const messages = {
      no_token: 'Save the GitHub access token above first.',
      token_rejected: 'GitHub refused the token. It may be expired or revoked — save a new one.',
      no_apk: 'The latest release has no APK attached.',
      offline: 'Offline — connect and try again.',
      network_error: 'Could not reach GitHub — try again later.',
      unparseable_version: 'Could not compare versions.'
    };
    statusEl.textContent = messages[result.reason] || `Check failed (${result.reason}).`;
  }
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
      const onRun = async () => { const v = input.value; if (v && !(await confirmStrength('passkey', v))) return; cleanup(); resolve(v || null); }; // a declined weak passkey keeps the banner open
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

window.Arkly = {
  bootstrap, captureText, saveNote, batchAddWithCommonLabel,
  search: (q) => searchEntries(db, q),
  softDelete: (id) => softDelete(db, id), restoreEntry, permanentlyDelete, showTrash,
  listAllTags: () => listAllTags(db),
  listLabelHistory: (type) => listLabelHistory(db, type),
  getAppearance, setDarkMode,
  setAppPassword, removeAppPassword, setAutoLockMinutes, setLockTriggerEnabled,
  getBiometricSettings, enableAppBiometric, disableAppBiometric,
  enableVaultBiometric, disableVaultBiometric, tryBiometricUnlockApp, tryBiometricUnlockVault,
  // Private Vault — unlockVault/lockVault replace the old unlockPrivateNotes/lockPrivateNotes names
  // (this pivot generalized "private notes" into the full vault; nothing shipped yet to keep the old
  // names for, so a clean rename rather than an alias).
  setupVaultPin, unlockVault, lockVault, setVaultAutoLockMinutes,
  captureToVault, browseVault, searchVault, openVaultEntry, showVaultTrash,
  vaultLabelSuggestions: (type, partial) => vaultLabelSuggestions(type, partial),
  // Per-file actions — identical set for vault and non-vault (pivot); caller passes privateSessionKey
  // only when acting on a vault item, these functions no-op that param otherwise.
  shareEntry: (id) => shareEntry(db, id, { privateSessionKey }),
  downloadPlain: async (id) => {
    try {
      const path = await downloadPlain(db, id, { privateSessionKey });
      toast(`Downloaded to Documents/${path}`);
    } catch (err) { toast(`Could not download: ${err.message || err}`); }
  },
  editEntry: (id, fields, opts) => editEntry(db, id, fields, { ...opts, privateSessionKey }),
  getSelectableGroups, runBulkFileAction,
  onThisDay, storageBreakdown, clearOldInCategory, yourDataSummary,
  captureFile
};

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrap();
  purgeOpenCopies(); // decrypted Vault copies from an earlier open (Decision 118)
  purgeUpdateDownload(); // the downloaded APK from an earlier update (Decision 164)
  import('@capacitor/filesystem').then(({ Filesystem, Directory }) => Filesystem.rmdir({ path: 'thumbs', directory: Directory.Cache, recursive: true })).catch(() => {}); // plain thumbnails cached by earlier versions (Decision 162)

  // Resets the app-level idle timer on any activity — a single delegated listener rather than
  // calling armAppAutoLock() from every capture/search/browse function individually. Harmless
  // no-op when quick access is enabled or the timer isn't currently armed (armAppAutoLock checks both).
  ['click', 'keydown', 'input'].forEach((evt) => document.addEventListener(evt, () => armAppAutoLock()));

  // Appearance settings UI wiring — populate controls from stored state, then wire changes back.
  const appearance = await getAppearance();
  const darkToggle = document.getElementById('dark-mode-toggle');
  if (darkToggle) {
    darkToggle.checked = appearance.darkMode;
    darkToggle.addEventListener('change', (e) => setDarkMode(e.target.checked));
  }

  // Currency symbol (Decision 130): chips for common symbols, free text for any other. Relabels only.
  (function wireCurrencySettings() {
    const chipsEl = document.getElementById('currency-chips');
    const custom = document.getElementById('currency-custom');
    const status = document.getElementById('currency-status');
    if (!chipsEl || !custom) return;
    const paint = async () => {
      const cur = await loadCurrencySymbol();
      chipsEl.innerHTML = Money.CURRENCIES.map((c) =>
        `<button type="button" data-sym="${c.symbol}" title="${c.name}" class="${c.symbol === cur ? 'selected' : ''}">${c.symbol}</button>`).join('');
      status.textContent = `Current: ${cur}`;
    };
    const apply = async (text) => {
      const sym = String(text ?? '').trim();
      if (!sym || Money.cleanSymbol(sym) !== sym) { status.textContent = 'Use 1 to 5 visible characters.'; return; }
      await metaSet('currency_symbol', sym);
      custom.value = '';
      await paint();
      renderMainTimeline().catch(() => {});
    };
    chipsEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-sym]'); if (b) apply(b.dataset.sym); });
    document.getElementById('currency-apply-btn').addEventListener('click', () => apply(custom.value));
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(custom.value); });
    window.addEventListener('arkly-data-restored', () => paint().catch(() => {}));
    paint().catch(() => {});
  })();

  // Privacy Screen settings UI wiring (Decision 64) — same populate-then-wire shape as dark mode
  // above. bootstrap() already applied whatever was stored before the lock screen even rendered;
  // this only needs to reflect that in the switch and react to future changes.
  const privacyScreenToggle = document.getElementById('privacy-screen-toggle');
  if (privacyScreenToggle) {
    privacyScreenToggle.checked = (await metaGet('privacy_screen_enabled', 'false')) === 'true';
    privacyScreenToggle.addEventListener('change', async (e) => {
      await metaSet('privacy_screen_enabled', e.target.checked ? 'true' : 'false');
      setPrivacyScreen(e.target.checked);
    });
  }

  // Haptic feedback switch (Decision 173): bootstrap applied the stored value; this reflects it and reacts to changes.
  const hapticsToggle = document.getElementById('haptics-toggle');
  if (hapticsToggle) {
    hapticsToggle.checked = (await metaGet('haptics_enabled', 'true')) === 'true';
    hapticsToggle.addEventListener('change', async (e) => {
      await metaSet('haptics_enabled', e.target.checked ? 'true' : 'false');
      setHapticsEnabled(e.target.checked);
      haptic('tick'); // a sample when switching on; nothing when switching off
    });
  }
  const hapticsTestBtn = document.getElementById('haptics-test-btn');
  if (hapticsTestBtn) {
    hapticsTestBtn.addEventListener('click', async () => {
      const out = document.getElementById('haptics-test-status');
      const r = await testHaptics();
      const where = `Platform ${r.platform}, plugin ${r.pluginAvailable ? 'present' : 'missing'}.`;
      const last = r.lastError ? ` Last error from an action: ${r.lastError}.` : '';
      out.textContent = r.ok
        ? `Sent a 300 ms vibration. ${where}${last} If you felt nothing, the phone is blocking it: check the system Vibration and touch feedback settings, Do Not Disturb and Battery saver.`
        : `Vibration failed: ${r.error}. ${where}${last}`;
    });
  }

  // Update-check settings UI wiring (Decision 72; download-direct in Decision 75, fixed in
  // Decision 77) — manual button, no stored setting: a check happens only when tapped, so
  // there's nothing to populate on load, unlike the toggles above.
  //
  // window.location.assign(), not @capacitor/browser's Browser.open() (Decision 77) — Browser.open()
  // opens a Chrome Custom Tab, which stayed stuck mid-download for a binary this size instead of
  // ever finishing (reported: downloads never completed). Capacitor's WebView doesn't know how to
  // render a .apk response itself, so assigning the URL directly hands it off to the OS's actual
  // default-browser app — the real DownloadManager, not a Custom Tab's — which is what completes
  // the download properly. @capacitor/browser is no longer used anywhere else in this codebase;
  // dropped from package.json.
  document.getElementById('check-update-btn').addEventListener('click', handleCheckForUpdateClick);
  // The download is native with the token (Decision 164) — a browser hand-off cannot send it, so Decision 77's
  // window.location.assign() no longer applies to a private repo.
  document.getElementById('update-download-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const assetUrl = btn.dataset.url;
    if (!assetUrl) return;
    const statusEl = document.getElementById('update-check-status');
    btn.disabled = true;
    statusEl.textContent = 'Downloading…';
    try {
      await downloadAndInstallUpdate({ assetUrl, token: await getUpdateToken() });
      statusEl.textContent = 'Downloaded. Follow the installer prompt.';
    } catch (err) {
      statusEl.textContent = err.message;
    }
    btn.disabled = false;
  });
  document.getElementById('update-token-save-btn').addEventListener('click', handleSaveUpdateToken);
  document.getElementById('update-token-clear-btn').addEventListener('click', handleClearUpdateToken);
  renderUpdateTokenStatus();

  // Backup & Restore (local) wiring
  renderCategoryCheckboxes('backup-categories', 'backup');
  renderCategoryCheckboxes('restore-categories', 'restore');
  document.getElementById('backup-now-btn').addEventListener('click', handleBackupNow);
  document.getElementById('restore-btn').addEventListener('click', handleLocalRestore);

  // Google Drive backup wiring — off by default, nothing here runs until the person opts in
  document.getElementById('drive-connect-btn').addEventListener('click', async () => {
    try {
      await ensureSignedIn({ silent: false }); // shows Google's own sign-in UI on first connect
      await refreshDriveConnectionView();
    } catch (err) {
      toast(err.message); // e.g. "Google Drive isn't set up yet..." — the guard in gdrive.js throws
      // a clean JS error now instead of ever reaching the native call that used to crash the app.
    }
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


  // ---- First-run setup / lock screen ----
  document.getElementById('first-run-continue-btn').addEventListener('click', async () => {
    if (!(await confirmStrength('password', document.getElementById('setup-app-password').value))) return;
    if (!(await confirmStrength('pin', document.getElementById('setup-vault-pin').value))) return;
    await window.completeFirstRunSetup({
      appPassword: document.getElementById('setup-app-password').value || null,
      appPasswordHint: document.getElementById('setup-app-password-hint').value,
      vaultPin: document.getElementById('setup-vault-pin').value || null,
      vaultPinHint: document.getElementById('setup-vault-pin-hint').value
    });
  });
  // The status line shows only the latest result: it clears when the lock screen appears (showScreen), when typing
  // starts, and when a new attempt begins, so an old "Wrong password." never sits under a fresh lock.
  const lockStatus = document.getElementById('password-hint');
  document.getElementById('password-input').addEventListener('input', () => { lockStatus.textContent = ''; });
  document.getElementById('unlock-btn').addEventListener('click', async () => {
    lockStatus.textContent = '';
    const result = await window.attemptUnlock(document.getElementById('password-input').value);
    if (result.success) clearSecretInputs(['password-input']);
    else { lockStatus.textContent = 'Wrong password.'; haptic('warning'); }
  });
  const bioUnlockBtn = document.getElementById('biometric-unlock-btn');
  if (bioUnlockBtn) {
    bioUnlockBtn.classList.toggle('hidden', !window.biometricUnlockAvailable);
    bioUnlockBtn.addEventListener('click', async () => {
      lockStatus.textContent = '';
      const result = await window.tryBiometricUnlockApp();
      if (!result.success) lockStatus.textContent = 'Biometric unlock failed — enter your password.';
    });
  }

  // ---- Biometric settings toggles (App lock + Vault sections) — off by default, each requires
  // confirming the real password/PIN once before the plugin will store it (see enableAppBiometric/
  // enableVaultBiometric — this module never trusts a checkbox alone to prove the person knows
  // the credential). ----
  const appBioRow = document.getElementById('app-biometric-row');
  const appBioToggle = document.getElementById('app-biometric-toggle');
  const appBioConfirm = document.getElementById('app-biometric-confirm');
  if (appBioRow) {
    const settings = await getBiometricSettings();
    appBioRow.classList.toggle('hidden', !settings.available);
    appBioToggle.checked = settings.appEnabled;
    appBioToggle.addEventListener('change', async (e) => {
      if (e.target.checked) {
        e.target.checked = false; // only actually flips true once the password below is confirmed
        appBioConfirm.classList.remove('hidden');
      } else {
        await window.disableAppBiometric();
      }
    });
    document.getElementById('app-biometric-confirm-btn').addEventListener('click', async () => {
      const pwInput = document.getElementById('app-biometric-confirm-password');
      const result = await window.enableAppBiometric(pwInput.value);
      pwInput.value = '';
      if (result.success) { appBioToggle.checked = true; appBioConfirm.classList.add('hidden'); }
      else toast('Wrong password.');
    });
  }
  const vaultBioConfirm = document.getElementById('vault-biometric-confirm');
  const vaultBioToggleEl = document.getElementById('vault-biometric-toggle');
  if (vaultBioToggleEl) {
    vaultBioToggleEl.addEventListener('change', async (e) => {
      if (e.target.checked) {
        e.target.checked = false; // only actually flips true once the PIN below is confirmed
        vaultBioConfirm.classList.remove('hidden');
      } else {
        await window.disableVaultBiometric();
        await refreshVaultGateView();
      }
    });
    document.getElementById('vault-biometric-confirm-btn').addEventListener('click', async () => {
      const pinInput = document.getElementById('vault-biometric-confirm-pin');
      const result = await window.enableVaultBiometric(pinInput.value);
      pinInput.value = '';
      if (result.success) { vaultBioConfirm.classList.add('hidden'); await refreshVaultGateView(); }
      else { toast('Wrong PIN.'); haptic('warning'); }
    });
  }

  // ---- Trash (main): a folder with type filter, period and sort (Decision 146) ----
  const trashState = { type: 'all', sort: 'new', period: 'any' };
  const TRASH_SORTS = [['new', 'Recently deleted'], ['old', 'Deleting soonest'], ['az', 'Name A–Z'], ['za', 'Name Z–A'], ['type', 'Type']];
  const browseType = (r) => (r.type === 'expense' ? 'money' : r.type); // legacy expense rows read as Money
  const TRASH_KEEP_MS = 30 * 86400000; // same 30-day rule as db.js purgeOldTrash
  let trashRows = [];
  function drawTrash() {
    const types = typeCounts(trashRows, browseType, VAULT_TYPES);
    if (trashState.type !== 'all' && !types.some((t) => t.type === trashState.type)) trashState.type = 'all';
    const rows = browse(trashRows, { ...trashState, dateOf: (r) => r.deleted_at, nameOf: (r) => r.label, typeOf: browseType, typeOrder: VAULT_TYPES });
    document.getElementById('trash-toolbar').innerHTML = trashRows.length
      ? toolbarHtml({ types, total: trashRows.length, type: trashState.type, labelOf: typeLabelFor, sorts: TRASH_SORTS, sort: trashState.sort, periods: PERIODS, period: trashState.period }) : '';
    document.getElementById('trash-list').innerHTML = rows.map((row) => {
      const left = Math.max(0, Math.ceil((row.deleted_at + TRASH_KEEP_MS - Date.now()) / 86400000));
      const when = new Date(row.deleted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      return `
      <div class="entry-row trash-row${left <= 3 ? ' expiring' : ''}" data-type="${escapeHtml(row.type)}" data-id="${escapeHtml(row.id)}">
        ${rowIconHtml(row.type, row.extension || '')}
        <span class="row-main">
          <span class="row-title">${escapeHtml(row.label)}</span>
          <span class="row-meta">${escapeHtml(typeLabelFor(browseType(row)))} · deleted ${escapeHtml(when)} · <span class="left">${left} ${left === 1 ? 'day' : 'days'} left</span></span>
        </span>
        <span class="row-actions">
          <button class="icon-btn trash-restore-btn" data-id="${escapeHtml(row.id)}" aria-label="Restore" title="Restore">${iconSvg('restore')}</button>
          <button class="icon-btn trash-purge-btn warning-text" data-id="${escapeHtml(row.id)}" aria-label="Delete permanently" title="Delete permanently">${iconSvg('trash')}</button>
        </span>
      </div>`;
    }).join('') || (trashRows.length
      ? emptyStateHtml('search')
      : `<div class="empty-state">${iconSvg('trash')}<strong>Trash is empty</strong><span>Deleted items wait here for 30 days.</span></div>`);
  }
  async function loadTrash() { trashRows = await showTrash(); drawTrash(); }
  async function openTrash() {
    await flushPurge();
    trashOpen = true;
    Object.assign(trashState, { type: 'all', sort: 'new', period: 'any' });
    document.getElementById('home-main').classList.add('hidden');
    document.getElementById('trash-view').classList.remove('hidden');
    updateBackButtonState();
    await loadTrash();
  }
  bindToolbar(document.getElementById('trash-toolbar'), trashState, drawTrash);
  document.getElementById('open-trash-btn').addEventListener('click', openTrash);
  document.getElementById('trash-list').addEventListener('click', async (e) => {
    const restore = e.target.closest('.trash-restore-btn'), purge = e.target.closest('.trash-purge-btn');
    if (restore) {
      const id = restore.dataset.id, was = trashRows.find((r) => r.id === id)?.deleted_at ?? Date.now();
      await window.Arkly.restoreEntry(id);
      await loadTrash();
      renderMainTimeline().catch(() => {});
      toast('Restored', false, { label: 'Undo', isVault: false, run: async () => { // back into the trash with its original deleted date
        try { await softDelete(db, id); await db.run(`UPDATE entries SET deleted_at = ? WHERE id = ?`, [was, id]); await loadTrash(); await renderMainTimeline(); toast('Moved back to trash'); }
        catch (err) { toast(`Could not undo: ${err.message || err}`); }
      } });
    } else if (purge && await askYesNo({ title: 'Delete permanently?', text: 'This cannot be undone.', yes: 'Delete', no: 'Keep' })) {
      await flushPurge();
      const id = purge.dataset.id, row = trashRows.find((r) => r.id === id);
      trashRows = trashRows.filter((r) => r.id !== id);
      drawTrash();
      pendingPurge = { id, isVault: false, timer: setTimeout(flushPurge, UNDO_MS + 300) };
      toast('Deleted permanently', false, { label: 'Undo', isVault: false, run: () => {
        if (pendingPurge?.id !== id) return;
        clearTimeout(pendingPurge.timer); pendingPurge = null;
        if (row) trashRows.push(row);
        drawTrash();
        toast('Kept in trash');
      } });
    }
  });

  // ---- Private Vault ----
  async function refreshVaultGateView({ prompt = true } = {}) {
    const cred = await db.query(`SELECT private_pin_hash FROM credentials WHERE id=1`);
    const needsSetup = !cred.values[0]?.private_pin_hash;
    const unlocked = !needsSetup && !!privateSessionKey;
    const locked = !needsSetup && !unlocked;

    document.getElementById('vault-pin-setup-view').classList.toggle('hidden', !needsSetup);
    document.getElementById('vault-locked-view').classList.toggle('hidden', !locked);
    // The actual content — capture bar, search, tabs, list, trash, auto-lock settings — only
    // shows once genuinely unlocked (privateSessionKey set). This is the fix for the reported
    // bug: previously nothing gated this on lock state at all (see Decision 54).
    document.getElementById('vault-content').classList.toggle('hidden', !unlocked);
    // Lock/unlock toggle (Decision 65) — replaces the old #vault-lock-btn entirely (removed from
    // the vault banner as redundant). Same visibility rule that button had: only makes sense once
    // there's something to lock, hidden on the setup/locked gate. This is the second of the two
    // exclusions the universal button needs — the first (the app-open lock screen) is handled once
    // in showScreen(), but vault-screen doesn't change screen id when its internal gate/content
    // substate toggles, so that exclusion has to live here instead.
    // Only while the Vault is on view: this runs after an await, so a lock from the Vault button has already moved to Home by now,
    // and hiding the shared button there removed Home's lock button (Session 94).
    const vaultOnView = !document.getElementById('vault-screen')?.classList.contains('hidden');
    if (vaultOnView) document.getElementById('lock-toggle-btn')?.classList.toggle('hidden', !unlocked);
    if (unlocked) renderVault(); // counts and any open folder (biometric unlock reaches here too)
    if (vaultOnView) updateLockButtonDisabledState(true); // vault context never shows "disabled" — always has a PIN by the time it's shown

    const settings = await getBiometricSettings();
    // The unlock button belongs on the locked gate (it's how you get in); the enable/disable
    // toggle belongs only once you're actually inside — it configures the vault, it isn't part of
    // getting into it (Session 31 bug: both were shown together on the locked page before this).
    const vaultBioUnlockBtn = document.getElementById('vault-biometric-unlock-btn');
    if (vaultBioUnlockBtn) vaultBioUnlockBtn.classList.toggle('hidden', !locked || !settings.vaultEnabled || !settings.available);
    const vaultBioRow = document.getElementById('vault-biometric-row');
    const vaultBioToggle = document.getElementById('vault-biometric-toggle');
    if (vaultBioRow && vaultBioToggle) {
      vaultBioRow.classList.toggle('hidden', !unlocked || !settings.available);
      vaultBioToggle.checked = settings.vaultEnabled;
    }

    // Default to biometric when it's enabled — same as the app-open lock screen. Guarded so it
    // only fires once per fresh "locked" state, not on every re-render while still locked (e.g.
    // re-visiting the Vault tab after cancelling once shouldn't re-prompt every single time).
    if (prompt && locked && settings.vaultEnabled && settings.available && !vaultBioAutoPrompted) {
      vaultBioAutoPrompted = true;
      const result = await window.tryBiometricUnlockVault();
      if (result.success) await refreshVaultGateView();
    }
  }
  // Exposed the same way window.attemptUnlock/tryBiometricUnlockVault already are — goBack()
  // (top-level, outside this DOMContentLoaded closure) needs to call this when returning to Vault.
  window.refreshVaultGateView = refreshVaultGateView;
  // A lock that fires while the Vault is on view (idle timer, app to background, screen off) used to clear the key and the
  // lists but leave the content showing, with the unlocked icon and no PIN prompt. No biometric prompt here: the app may be
  // in the background; the prompt comes when the app is back in front (appStateChange).
  onVaultLocked = () => {
    if (!document.getElementById('vault-screen')?.classList.contains('hidden')) refreshVaultGateView({ prompt: false });
  };

  document.getElementById('vault-setup-pin-btn').addEventListener('click', async () => {
    if (!(await confirmStrength('pin', document.getElementById('vault-setup-pin-input').value))) return;
    await setupVaultPin(document.getElementById('vault-setup-pin-input').value, document.getElementById('vault-setup-pin-hint-input').value);
    await refreshVaultGateView();
  });
  document.getElementById('vault-unlock-btn').addEventListener('click', async () => {
    const result = await unlockVault(document.getElementById('vault-pin-input').value);
    if (result.success) { clearSecretInputs(VAULT_SECRET_INPUT_IDS); await refreshVaultGateView(); renderVault(); }
    else if (result.setupNeeded) await refreshVaultGateView();
    else { toast('Wrong PIN.'); haptic('warning'); }
  });
  document.getElementById('vault-biometric-unlock-btn')?.addEventListener('click', async () => {
    const result = await window.tryBiometricUnlockVault();
    if (result.success) { await refreshVaultGateView(); renderVault(); }
    else toast('Biometric unlock failed — enter your Vault PIN.');
  });
  // vault-lock-btn removed (Decision 65) — replaced by the universal #lock-toggle-btn, wired
  // further down near the power button, which does exactly what this used to: lockVault() then
  // an immediate synchronous showScreen('main-screen') (Session 31 bug fix preserved — no
  // awaiting an async gate refresh first, which used to delay the actual screen switch).
  // NOTE: no unconditional refreshVaultGateView() call here at initial setup — that used to be a
  // line right here, and it was a real bug (Decision 59): refreshVaultGateView() auto-triggers a
  // biometric attempt for the Vault when enabled (Decision 56), so calling it during cold-start
  // setup — before the user has even reached, let alone tapped, the Vault tab — fired a SECOND
  // biometric prompt racing against the app-lock screen's own one, and could silently unlock the
  // Vault in the background while the person was still looking at the app's lock screen. The nav
  // handler below already calls this fresh every time the Vault tab is actually tapped; nothing
  // needs it to run any earlier than that, since vault-screen itself starts hidden regardless.

  // ---- Bottom nav: Home / Vault — Decision 61 dropped Settings as a third tab; it's reached via
  // the "App Settings" tile inside Home instead (below), same screens/gates otherwise unchanged.
  // Home and Settings are tabs within main-screen; Vault is its own
  // screen with its own gate (Decision 54 — that gate previously lived in Settings, disconnected
  // from vault-screen entirely, so this button skipped it and opened straight into the content). ----
  // Only buttons with a data-nav attribute (Home/Vault) — the universal Back button living in the
  // middle nav slot (Decision 65) is also a <button> inside #bottom-nav but has no data-nav, and
  // is wired separately below with its own, different behavior (goBack(), not "jump to this tab").
  document.querySelectorAll('#bottom-nav button[data-nav]').forEach((btn) => btn.addEventListener('click', async () => {
    const tab = btn.dataset.nav;
    if (tab === 'vault') { closeVaultFolder(); showScreen('vault-screen'); await refreshVaultGateView(); }
    else {
      if (tab === 'home') closeFolder(); // tapping Home always lands on the card grid, not an open folder (Decision 81)
      showScreen('main-screen', { tab });
    }
  }));

  // "App Settings" tile (Decision 61) — the settings-tab panel itself is unchanged, only its entry
  // point moved from a bottom-nav button to this tile. Getting back out again is the universal
  // Back button (Decision 65) — the old dedicated "← Back to Home" link is gone, replaced by it.
  document.getElementById('open-settings-tile').addEventListener('click', () => switchMainTab('settings'));

  // Universal Back button (Decision 65) — middle slot of the bottom nav, present wherever the nav
  // itself is (main-screen/vault-screen; hidden together with it elsewhere, for free, since it's
  // physically inside #bottom-nav rather than a separate always-present element like the power
  // button). Replaces every dedicated "back"/"back to home" element that existed before this.
  // Soft glow on tap (Decision 66): re-added and forced to reflow before re-adding so a rapid
  // second tap restarts the animation rather than the class-already-present no-op it would
  // otherwise be; removed again on animationend so the class doesn't linger as dead state.
  const navBackBtn = document.getElementById('nav-back-btn');
  navBackBtn.addEventListener('click', () => {
    navBackBtn.classList.remove('glow');
    void navBackBtn.offsetWidth; // forces a reflow, so the animation restarts on back-to-back taps
    navBackBtn.classList.add('glow');
    goBack();
  });
  navBackBtn.addEventListener('animationend', () => navBackBtn.classList.remove('glow'));

  // Redraw after an Undo: Home (folder list, counts, totals), Home search and, when unlocked, the Vault.
  refreshAfterUndo = async () => {
    await renderMainTimeline();
    document.getElementById('search-input')?.dispatchEvent(new Event('input'));
    if (privateSessionKey) renderVault();
  };

  // Android Back button and back gesture: the same action as the on-screen Back button, with the same glow. Where that
  // button is disabled (a section's landing page, the lock gate) the app goes to the background, which locks it (Decision 45).
  App.addListener('backButton', () => {
    if (!backAction()) { App.minimizeApp(); return; }
    navBackBtn.classList.remove('glow');
    void navBackBtn.offsetWidth;
    navBackBtn.classList.add('glow');
    goBack();
  });

  // Same glow on the row action buttons (Edit, Share, Download, Delete): one delegated listener covers every list,
  // including rows drawn later. Only the tapped button glows; the row itself stays still (see style.css).
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.row-actions .icon-btn');
    if (!b) return;
    b.classList.remove('glow');
    void b.offsetWidth; // restarts the animation on back-to-back taps
    b.classList.add('glow');
  });
  document.addEventListener('animationend', (e) => { if (e.target.classList?.contains('icon-btn')) e.target.classList.remove('glow'); });

  // Overlays (editor, viewer, Save dialog, modals) cover the page, so while one is open the nav shrinks to just Back
  // above it (CSS: body.overlay-open) and Back dismisses it (Decision 104). Class changes cover every open/close path,
  // including a lock's forced close.
  const syncOverlayChrome = () => {
    const open = !!document.querySelector('#editor-screen:not(.hidden), #viewer-screen:not(.hidden), .modal-overlay:not(.hidden)');
    document.body.classList.toggle('overlay-open', open);
    updateBackButtonState();
  };
  new MutationObserver(syncOverlayChrome).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  syncOverlayChrome();

  // Power button (Decision 61, confirmation removed in Decision 62) — small, fixed, present on
  // every screen except the app-open lock screen (handled in showScreen() above) since it lives
  // outside any .screen element rather than being duplicated into each one. @capacitor/app's own
  // exitApp(), native-Android-only (no equivalent close action exists for a plain web view, so
  // it's a no-op there with a clear message rather than a silent failure). Locking on
  // backgrounding (Decision 45) already covers what happens on next open; this button doesn't
  // need to duplicate that. No confirmation dialog — removed on request; a mistaken tap just
  // re-opens the app same as a mistaken tap of the OS back button would.
  document.getElementById('power-close-btn').addEventListener('click', async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) { toast('Closing only works in the installed app, not this preview.'); return; }
    const { App } = await import('@capacitor/app');
    App.exitApp();
  });

  // Lock/unlock toggle (Decision 65) — same fixed-position pattern as the power button, but
  // context-aware rather than doing one fixed thing: it locks whichever of the app or the Vault is
  // currently what's on screen, decided at click time by checking which is actually visible rather
  // than tracking a separate "which context" flag that could drift out of sync with the DOM.
  // Always shown in its "unlocked" appearance because both places it's visible (Decision 65's two
  // exclusions, in showScreen() and refreshVaultGateView() above) are themselves already-unlocked
  // states — there's no case where this button needs to show a "locked" appearance.
  document.getElementById('lock-toggle-btn').addEventListener('click', async () => {
    // Decided by the screen on view, not by #vault-content's class: that class is only reset when the Vault gate
    // is next shown, so it stayed visible after leaving the Vault and made this button act on the Vault from Home
    // and Settings (Decision 94).
    if (currentLocation === 'vault') {
      lockVault();
      // Immediate, synchronous navigation, same fix Session 31 made for the old vault-lock-btn —
      // no awaiting an async gate refresh first, which would delay the actual screen switch.
      showScreen('main-screen');
      return;
    }
    // Main app: showLockScreen() already contains all the right logic for this (checks whether a
    // password is even set, shows the real lock screen if so, or is a harmless no-op re-entry to
    // Home if it's quick access with nothing to lock) — reusing it here instead of duplicating
    // that branching. First-run setup (no credentials row yet) safely no-ops via the same guard.
    if (document.getElementById('first-run-setup').classList.contains('hidden')) {
      disarmAppAutoLock();
      await showLockScreen();
    }
  });

  // ---- Vault mirrors Home (Decision 85): cards are folders with count badges, each folder has a New
  // button, a universal New asks for a type, and the list under the search box is search results only.
  // Counts and lists read the in-memory index (Decision 39), never the DB. ----
  // Vault Money rows show kind, amount, status and date from the unlocked index; the label is the readable summary, as on Home (Decision 143).
  function vaultRowProps(e) {
    const m = e.type === 'money' && e.money ? moneyRowMeta(e.money) : e.type === 'reminder' ? rowMeta(e) : rowMeta({ type: e.type, created_at: e.createdAt });
    return { id: e.id, type: e.type, label: e.label, tags: e.tags, ext: e.extension, ...m };
  }
  function vaultRowsHtml(items) {
    return items.map((e) => entryRowHtml(vaultRowProps(e), 'vault')).join('') || emptyStateHtml('folder');
  }

  function renderVaultCounts() {
    const byType = {};
    for (const e of browseVault('all')) byType[e.type] = (byType[e.type] || 0) + 1;
    document.querySelectorAll('#vault-capture-bar button[data-vault-type]').forEach((btn) => {
      const n = byType[btn.dataset.vaultType] || 0;
      btn.querySelector('.card-count').textContent = n ? String(n) : '';
    });
  }

  function renderVaultFolderList() {
    const container = document.getElementById('vault-folder-list');
    const items = browseVault(openVaultFolderType);
    if (openVaultFolderType === 'image') { // thumbnail grid, decoded in memory only (Decision 105)
      container.innerHTML = items.length ? thumbGridHtml(items) : emptyStateHtml('folder');
      container.querySelectorAll('.thumb-tile').forEach((t) => t.addEventListener('click', async () => {
        await openImageViewer(items, items.findIndex((i) => i.id === t.dataset.id), true);
        renderVault();
      }));
      loadThumbsInto(container, items, true);
      paintSelection();
      return;
    }
    container.innerHTML = vaultRowsHtml(items);
    container.querySelectorAll('.entry-row').forEach((r) => r.addEventListener('click', async (e) => {
      if (e.target.closest('.row-actions')) return;
      await openEntry(r.dataset.id, true, items.find((i) => i.id === r.dataset.id));
      renderVault();
    }));
    container.querySelectorAll('.vault-share-btn').forEach((b) => b.addEventListener('click', () => window.Arkly.shareEntry(b.dataset.id)));
    container.querySelectorAll('.vault-download-btn').forEach((b) => b.addEventListener('click', () => window.Arkly.downloadPlain(b.dataset.id)));
    container.querySelectorAll('.vault-edit-btn').forEach((b) => b.addEventListener('click', async () => {
      await editEntryUI(items.find((i) => i.id === b.dataset.id), true);
      renderVault();
    }));
    container.querySelectorAll('.vault-delete-btn').forEach((b) => b.addEventListener('click', async () => {
      await deleteVaultEntry(b.dataset.id);
      renderVault();
      offerUndo([b.dataset.id], { isVault: true });
    }));
    paintSelection();
  }

  // Call only while unlocked (browseVault/searchVault throw otherwise).
  function renderVault() {
    renderVaultCounts();
    if (openVaultFolderType) renderVaultFolderList();
    if (searchOpen && searchMode === 'vault') runVaultSearch();
    renderVaultMoneySummary();
  }

  async function startVaultCapture(type) {
    try {
      if (type === 'note') {
        let text = '', d = null;
        const mark = overlayAbortCount;
        while (!d) {
          const res = await openTextEditor({ title: 'New vault note', text, isVault: true });
          if (res === null) return;
          text = res;
          d = await openSaveDialog({ heading: 'Save vault note', defaultName: defaultNoteName(text), isVault: true, discardLabel: 'Back to editing' });
          if (!d && overlayAbortCount !== mark) return;
        }
        await captureToVault({ type: 'note', label: d.name, tags: d.tags, description: d.description, text });
        renderVault();
        toastSaved('Saved to the Vault');
      } else if (type === 'voice') {
        await startVoiceRecordingUI(async ({ recordDataBase64, mimeType }) => {
          try {
            const d = await openSaveDialog({ heading: 'Save recording', defaultName: `Voice ${new Date().toLocaleTimeString()}`, isVault: true, discardLabel: 'Discard' });
            if (!d) { toast('Recording discarded'); return; }
            await captureToVault({ type: 'voice', label: d.name, tags: d.tags, description: d.description, fileData: recordDataBase64, extension: extensionForMimeType(mimeType) });
            renderVault();
            toastSaved('Saved to the Vault');
          } catch (err) { toast(`Could not save: ${err.message || err}`); }
        }, { isVault: true });
      } else if (type === 'money') {
        // Form, then the Save dialog. The name defaults to a generic one: the label is the only plaintext a Vault row carries (Decision 135).
        await loadCurrencySymbol();
        const items = vaultMoneyItems();
        let details = null, d = null;
        const mark = overlayAbortCount;
        while (!d) {
          details = await openMoneyForm({ details, items, symbol: currencySymbol, hooks: vaultMoneyHooks });
          if (!details) return;
          d = await openSaveDialog({ heading: 'Save vault money entry', defaultName: Money.summary(details), isVault: true, discardLabel: 'Back to amount' });
          if (!d && overlayAbortCount !== mark) return; // locked meanwhile
        }
        await captureToVault({ type: 'money', label: d.name, tags: d.tags, description: d.description, money: details });
        renderVault();
        toastSaved('Saved to the Vault');
      } else if (type === 'reminder') {
        // Name, note, when and repeat in one Save dialog, as for Home. The notification says only "Vault Reminder" (Decision 140).
        const d = await openSaveDialog({ heading: 'New vault reminder', defaultName: `Reminder ${new Date().toLocaleTimeString()}`, isVault: true, discardLabel: 'Discard', reminder: {} });
        if (!d) return;
        const id = await captureToVault({ type: 'reminder', label: d.name, tags: d.tags, description: d.description, fireAt: d.fire_at, repeatRule: d.repeat_rule });
        renderVault();
        try {
          await scheduleReminder({ id, label: d.name, fire_at: d.fire_at, repeat_rule: d.repeat_rule, is_private: 1 });
          toastSaved(d.repeat_rule ? 'Vault reminder saved' : reminderSetText(d.fire_at));
        } catch (err) {
          toast(`Vault reminder saved, but its notification could not be scheduled: ${err.message || err}`);
        }
      } else if (type === 'location') {
        // Same chooser, paste dialog and Save dialog as Home. The coordinates go inside the encrypted body (Decision 142).
        const picked = await pickLocation(true);
        if (!picked) return;
        await captureToVault({ type: 'location', label: picked.d.name, tags: picked.d.tags, description: picked.d.description, location: { latitude: picked.lat, longitude: picked.lng } });
        renderVault();
        toastSaved('Saved to the Vault');
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = acceptForType(type);
        input.multiple = true; // same as Home (Decision 84): several files offer keep-each-name or one numbered name
        input.onchange = async () => {
          const picked = Array.from(input.files || []);
          if (!picked.length) return;
          try {
            const files = await readPicked(picked);
            const single = files.length === 1;
            const d = await openSaveDialog({
              heading: single ? `Save ${typeLabelFor(type).toLowerCase()}` : `Save ${files.length} files`,
              defaultName: single ? files[0].name : (VAULT_TYPE_LABELS[type] || type),
              count: files.length, isVault: true, discardLabel: 'Discard'
            });
            if (!d) return;
            const numbered = !single && d.mode === 'number';
            for (let i = 0; i < files.length; i++) {
              const f = files[i];
              await captureToVault({ type, label: single ? d.name : numbered ? `${d.name} ${i + 1}` : f.name, tags: d.tags, description: d.description, fileData: f.fileData, extension: f.extension });
            }
            renderVault();
            toastSaved(single ? 'Saved to the Vault' : `${files.length} files added to the Vault`);
          } catch (err) { toast(`Could not save: ${err.message || err}`); renderVault(); }
        };
        beginPickerLaunch(); // Decision 73 — this file chooser must not be mistaken for backgrounding
        input.click();
      }
    } catch (err) { toast(`Could not save: ${err.message || err}`); }
  }

  async function openVaultFolder(type, btn) {
    openVaultFolderType = type;
    if (type === 'money') { vaultMoneyMonth = null; await loadCurrencySymbol(); } // header starts on the current month
    updateBackButtonState();
    const vTitle = document.getElementById('vault-folder-title');
    vTitle.dataset.vaultType = type;
    vTitle.innerHTML = `<span class="title-ico">${iconSvg(TYPE_ICON[type])}</span><span>${escapeHtml(VAULT_TYPE_LABELS[type])}</span>`;
    document.getElementById('vault-main').classList.add('hidden');
    document.getElementById('vault-folder-view').classList.remove('hidden');
    await showPdfSwitch('vault-pdf-inapp-wrap', 'vault-pdf-inapp-toggle', type);
    renderVault();
  }
  document.querySelectorAll('#vault-capture-bar button[data-vault-type]').forEach((btn) => btn.addEventListener('click', () => openVaultFolder(btn.dataset.vaultType, btn)));
  document.getElementById('vault-folder-new-btn').addEventListener('click', () => startVaultCapture(openVaultFolderType));

  // ---- Vault Trash: a folder with the same toolbar as Home's (Decision 147). Labels are decrypted for display only. ----
  const vaultTrashState = { type: 'all', sort: 'new', period: 'any' };
  function drawVaultTrash() {
    const types = typeCounts(vaultTrashRows, browseType, VAULT_TYPES);
    if (vaultTrashState.type !== 'all' && !types.some((t) => t.type === vaultTrashState.type)) vaultTrashState.type = 'all';
    const rows = browse(vaultTrashRows, { ...vaultTrashState, dateOf: (r) => r.deleted_at, nameOf: (r) => r.label, typeOf: browseType, typeOrder: VAULT_TYPES });
    document.getElementById('vault-trash-toolbar').innerHTML = vaultTrashRows.length
      ? toolbarHtml({ types, total: vaultTrashRows.length, type: vaultTrashState.type, labelOf: typeLabelFor, sorts: TRASH_SORTS, sort: vaultTrashState.sort, periods: PERIODS, period: vaultTrashState.period }) : '';
    document.getElementById('vault-trash-list').innerHTML = rows.map((row) => {
      const left = Math.max(0, Math.ceil((row.deleted_at + TRASH_KEEP_MS - Date.now()) / 86400000));
      const when = new Date(row.deleted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      return `
      <div class="entry-row trash-row${left <= 3 ? ' expiring' : ''}" data-type="${escapeHtml(row.type)}" data-id="${escapeHtml(row.id)}">
        ${rowIconHtml(row.type, row.extension || '')}
        <span class="row-main">
          <span class="row-title">${escapeHtml(row.label)}</span>
          <span class="row-meta">${escapeHtml(typeLabelFor(browseType(row)))} · deleted ${escapeHtml(when)} · <span class="left">${left} ${left === 1 ? 'day' : 'days'} left</span></span>
        </span>
        <span class="row-actions">
          <button class="icon-btn vtrash-restore-btn" data-id="${escapeHtml(row.id)}" aria-label="Restore" title="Restore">${iconSvg('restore')}</button>
          <button class="icon-btn vtrash-purge-btn warning-text" data-id="${escapeHtml(row.id)}" aria-label="Delete permanently" title="Delete permanently">${iconSvg('trash')}</button>
        </span>
      </div>`;
    }).join('') || (vaultTrashRows.length
      ? emptyStateHtml('search')
      : `<div class="empty-state">${iconSvg('trash')}<strong>Vault Trash is empty</strong><span>Deleted Vault items wait here for 30 days.</span></div>`);
  }
  async function loadVaultTrash() {
    if (!privateSessionKey) return;
    vaultTrashRows = await showVaultTrash();
    drawVaultTrash();
  }
  async function openVaultTrash() {
    await flushPurge();
    vaultTrashOpen = true;
    Object.assign(vaultTrashState, { type: 'all', sort: 'new', period: 'any' });
    document.getElementById('vault-main').classList.add('hidden');
    document.getElementById('vault-trash-view').classList.remove('hidden');
    updateBackButtonState();
    await loadVaultTrash();
  }
  bindToolbar(document.getElementById('vault-trash-toolbar'), vaultTrashState, drawVaultTrash);
  document.getElementById('vault-open-trash-btn').addEventListener('click', openVaultTrash);
  document.getElementById('vault-trash-list').addEventListener('click', async (e) => {
    const restore = e.target.closest('.vtrash-restore-btn'), purge = e.target.closest('.vtrash-purge-btn');
    if (restore) {
      const id = restore.dataset.id, was = vaultTrashRows.find((r) => r.id === id)?.deleted_at ?? Date.now();
      await restoreEntry(id);
      await loadVaultTrash();
      renderVault();
      toast('Restored', false, { label: 'Undo', isVault: true, run: async () => {
        try {
          if (!privateSessionKey) return;
          await softDelete(db, id); await db.run(`UPDATE entries SET deleted_at = ? WHERE id = ?`, [was, id]);
          await refreshVaultIndexEntries(db, privateSessionKey, [id]); await loadVaultTrash(); renderVault(); toast('Moved back to trash');
        } catch (err) { toast(`Could not undo: ${err.message || err}`); }
      } });
    } else if (purge && await askYesNo({ title: 'Delete permanently?', text: 'This cannot be undone.', yes: 'Delete', no: 'Keep' })) {
      await flushPurge();
      const id = purge.dataset.id, row = vaultTrashRows.find((r) => r.id === id);
      vaultTrashRows = vaultTrashRows.filter((r) => r.id !== id);
      drawVaultTrash();
      pendingPurge = { id, isVault: true, timer: setTimeout(async () => { await flushPurge(); if (privateSessionKey) renderVault(); }, UNDO_MS + 300) };
      toast('Deleted permanently', false, { label: 'Undo', isVault: true, run: () => {
        if (pendingPurge?.id !== id) return;
        clearTimeout(pendingPurge.timer); pendingPurge = null;
        if (row) vaultTrashRows.push(row);
        drawVaultTrash();
        toast('Kept in trash');
      } });
    }
  });

  // ---- Vault Settings tile: opens the settings card as its own view; Back returns to the landing page ----
  document.getElementById('vault-open-settings-tile').addEventListener('click', () => {
    vaultSettingsOpen = true;
    document.getElementById('vault-main').classList.add('hidden');
    document.getElementById('vault-settings-view').classList.remove('hidden');
    updateBackButtonState();
  });

  // ---- Vault Search: the shared search layer reading the in-memory index (Decision 147) ----
  function runVaultSearch() {
    const term = document.getElementById('search-input').value;
    searchRows = term && privateSessionKey ? searchVault(term) : [];
    drawSearch();
  }
  document.getElementById('vault-open-search-btn').addEventListener('click', (e) => {
    if (!privateSessionKey) return;
    searchRows = [];
    Object.assign(searchState, { type: 'all', sort: 'default', period: 'any' });
    document.getElementById('search-input').value = '';
    openSearchScreen(e.currentTarget, 'vault');
    drawSearch();
  });

  document.getElementById('vault-auto-lock-select').addEventListener('change', (e) => setVaultAutoLockMinutes(Number(e.target.value)));
  document.getElementById('app-auto-lock-select').addEventListener('change', (e) => setAutoLockMinutes(Number(e.target.value)));

  // Three independent lock-trigger toggles, per lock (Decision 74) — six checkboxes total, same
  // populate-then-wire shape as the biometric toggles above. Screen-off defaults unchecked (column
  // default 0) since it needs the native listener in android-notes §14, not yet confirmed on device.
  {
    const row = (await db.query(
      `SELECT app_lock_idle_enabled, app_lock_background_enabled, app_lock_screenoff_enabled,
              vault_lock_idle_enabled, vault_lock_background_enabled, vault_lock_screenoff_enabled
       FROM credentials WHERE id=1`
    )).values[0] || {};
    const wire = (id, lock, trigger, defaultOn) => {
      const el = document.getElementById(id);
      if (!el) return;
      const col = `${lock}_lock_${trigger}_enabled`;
      el.checked = !!(row[col] ?? (defaultOn ? 1 : 0));
      el.addEventListener('change', (e) => setLockTriggerEnabled(lock, trigger, e.target.checked));
    };
    wire('app-lock-idle-toggle', 'app', 'idle', true);
    wire('app-lock-background-toggle', 'app', 'background', true);
    wire('app-lock-screenoff-toggle', 'app', 'screenoff', false);
    wire('vault-lock-idle-toggle', 'vault', 'idle', true);
    wire('vault-lock-background-toggle', 'vault', 'background', true);
    wire('vault-lock-screenoff-toggle', 'vault', 'screenoff', false);
  }

  // ---- Select files (multi-select, shared by main + vault) ----
  let selectedIds = new Set();
  let selectGroups = {};
  const selectState = { type: 'all', sort: 'default' };
  const SELECT_SORTS = [['default', 'Default'], ['az', 'Name A–Z'], ['za', 'Name Z–A'], ['big', 'Largest first'], ['small', 'Smallest first']];
  const selectScope = () => document.getElementById('select-files-screen').dataset.scope || 'home';
  const selectLabel = (c) => (selectScope() === 'vault' ? typeLabelFor(c) : (CATEGORY_LABELS[c] || c));
  function drawSelectFiles() {
    const container = document.getElementById('select-files-groups');
    const total = Object.values(selectGroups).reduce((n, items) => n + items.length, 0);
    if (selectState.type !== 'all' && !selectGroups[selectState.type]) selectState.type = 'all';
    document.getElementById('select-files-toolbar').innerHTML = total
      ? toolbarHtml({ types: Object.entries(selectGroups).map(([cat, items]) => ({ type: cat, count: items.length })), total, type: selectState.type, labelOf: selectLabel, sorts: SELECT_SORTS, sort: selectState.sort }) : '';
    const shown = Object.entries(selectGroups).filter(([cat]) => selectState.type === 'all' || cat === selectState.type)
      .map(([cat, items]) => [cat, browse(items, { sort: selectState.sort, nameOf: (i) => i.label, typeOf: () => cat, sizeOf: (i) => i.sizeBytes || 0 })]);
    container.innerHTML = shown.map(([cat, items]) => `
      <div class="select-files-category" data-cat="${cat}">
        <div class="select-files-category-header">
          <input type="checkbox" class="cat-select-all" data-cat="${cat}"${items.length && items.every((it) => selectedIds.has(it.id)) ? ' checked' : ''} />
          <span>${escapeHtml(selectLabel(cat))} (${items.length})</span>
        </div>
        ${items.map((it) => `
          <div class="select-files-item">
            <label><input type="checkbox" class="item-select" data-id="${escapeHtml(it.id)}"${selectedIds.has(it.id) ? ' checked' : ''} /> ${escapeHtml(it.label)}</label>
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
  }
  bindToolbar(document.getElementById('select-files-toolbar'), selectState, drawSelectFiles);
  async function openSelectFiles(scope = 'home') {
    if (scope === 'vault' && !privateSessionKey) return;
    selectedIds = new Set();
    document.getElementById('select-files-screen').dataset.scope = scope;
    const groups = await getSelectableGroups(scope);
    selectGroups = groups;
    if (scope === 'vault') { // one chip per Vault type, in the usual order
      selectGroups = {};
      const all = groups.private_vault || [];
      for (const t of VAULT_TYPES) { const items = all.filter((i) => i.type === t); if (items.length) selectGroups[t] = items; }
    }
    Object.assign(selectState, { type: 'all', sort: 'default' });
    drawSelectFiles();
    document.getElementById('select-files-screen').classList.remove('hidden');
    updateBackButtonState(); // Back is lit while the dialog is open
  }
  function toggleId(id, on) { if (on) selectedIds.add(id); else selectedIds.delete(id); }

  document.getElementById('select-files-btn').addEventListener('click', () => openSelectFiles('home'));
  document.getElementById('vault-select-files-btn').addEventListener('click', () => openSelectFiles('vault'));
  document.getElementById('select-files-close-btn').addEventListener('click', () => { document.getElementById('select-files-screen').classList.add('hidden'); updateBackButtonState(); });

  async function runSelectedBulk(action) {
    const statusEl = document.getElementById('select-files-status');
    if (selectedIds.size === 0) { statusEl.textContent = 'Nothing selected.'; return; }
    if (action === 'delete' && !(await askYesNo({ title: `Delete ${selectedIds.size} item(s)?`, text: 'They go to trash, not permanent.', yes: 'Delete', no: 'Cancel' }))) return;
    statusEl.textContent = 'Working…';
    const results = await runBulkFileAction(action, [...selectedIds]);
    const failed = results.filter((r) => !r.ok);
    if (action === 'delete' && results.length > failed.length) { const scope = selectScope(); offerUndo(results.filter((r) => r.ok).map((r) => r.id), { isVault: scope === 'vault', after: () => openSelectFiles(scope) }); }
    statusEl.textContent = `Done — ${results.length - failed.length} succeeded, ${failed.length} failed.` +
      (failed.length ? ` (${failed.map((f) => f.error).join('; ')})` : '');
  }
  document.getElementById('select-files-share-btn').addEventListener('click', () => runSelectedBulk('share'));
  document.getElementById('select-files-download-btn').addEventListener('click', () => runSelectedBulk('download'));
  document.getElementById('select-files-delete-btn').addEventListener('click', () => runSelectedBulk('delete'));

  // ---- Reminder capture (Phase 4). Modal: a date/time needs a real picker, not typed text.
  // Resolves { label, fire_at, repeat_rule } or null on cancel. One-time reminders must be future. ----

  // ---- Voice recording (cap-voice-rec) — was previously just a generic file picker for ALL
  // non-text types including voice, meaning "record a voice memo" actually asked you to upload an
  // existing audio file instead of recording one (confirmed real-device bug, Session 24). Now
  // records live via the microphone; file/image/pdf still use a file picker, now with correct
  // accept filters too (also missing before — pdf/image accepted literally any file type).
  function acceptForType(type) {
    if (type === 'image') return 'image/*';
    if (type === 'pdf') return 'application/pdf,.pdf';
    return ''; // 'file' (generic) is intentionally unrestricted
  }
  function extensionForMimeType(mimeType) {
    const map = { 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
    return map[mimeType] || map[mimeType?.split(';')[0]] || 'aac';
  }
  // Recorder screen: ready -> recording -> review (player) -> Save hands the take to onStopped (the Save dialog).
  // Backing out of a take asks twice; a lock discards it, as it drops unsaved editor text (Decision 103).
  async function startVoiceRecordingUI(onStopped, { isVault = false } = {}) {
    // Asked before the screen opens: the system prompt pauses the app, which a lock would treat as backgrounding.
    try {
      const has = await VoiceRecorder.hasAudioRecordingPermission();
      if (!has.value && !(await VoiceRecorder.requestAudioRecordingPermission()).value) { toast('Microphone permission denied'); return; }
    } catch (err) { toast(`Microphone unavailable: ${err.message || err}`); return; }

    let state = 'ready', timer = null, startedAt = 0, taken = null, saved = null, player = null, url = null;
    let bodyEl = null, closeFn = null;
    const dropReview = () => {
      if (player) { player.destroy(); player = null; }
      if (url) { URL.revokeObjectURL(url); url = null; }
    };
    const cleanup = () => {
      const was = state;
      state = 'closed';
      clearInterval(timer);
      dropReview();
      if (was === 'recording') VoiceRecorder.stopRecording().catch(() => {}); // take discarded
    };
    // Back with a take in memory asks Yes/No (replaces the earlier tap-twice rule). Resolves true to leave.
    const guard = async () => {
      if (state === 'ready' || state === 'closed') return true;
      return askYesNo({
        title: 'Discard recording?',
        text: state === 'recording' ? 'Recording is in progress and will be lost.' : 'This recording has not been saved.',
        yes: 'Yes, discard', no: 'No, keep it'
      });
    };
    const tick = () => {
      const el = bodyEl && bodyEl.querySelector('#rec-timer');
      if (el) el.textContent = formatClock((Date.now() - startedAt) / 1000);
    };
    const start = async () => {
      try {
        const r = await VoiceRecorder.startRecording();
        if (!r.value) { toast('Could not start recording'); return; }
      } catch (err) { toast(`Could not start recording: ${err.message || err}`); return; } // e.g. MICROPHONE_BEING_USED
      if (state === 'closed') { VoiceRecorder.stopRecording().catch(() => {}); return; }
      state = 'recording'; startedAt = Date.now();
      timer = setInterval(tick, 250);
      draw();
    };
    const stop = async () => {
      clearInterval(timer);
      state = 'stopping';
      try {
        const res = (await VoiceRecorder.stopRecording()).value; // { recordDataBase64, msDuration, mimeType }
        if (state === 'closed') return;
        taken = { base64: res.recordDataBase64, mimeType: res.mimeType, ms: res.msDuration || (Date.now() - startedAt) };
        url = base64ToBlobUrl(taken.base64, taken.mimeType || 'audio/aac');
        state = 'review';
      } catch (err) {
        if (state === 'closed') return;
        toast(`Recording failed: ${err.message || err}`); // e.g. EMPTY_RECORDING if stopped instantly
        state = 'ready';
      }
      draw();
    };
    function draw() {
      const body = bodyEl;
      if (!body || state === 'closed') return;
      if (state === 'review') {
        body.innerHTML = `
          <div class="detail-hero" data-type="voice">
            <span class="row-icon">${iconSvg('voice')}</span>
            <div class="hero-when">${formatClock(taken.ms / 1000)}</div>
            <div class="hero-sub">Review before saving</div>
          </div>
          <div id="rec-player"></div>
          <div class="detail-actions">
            <button id="rec-save-btn">Save</button>
            <button id="rec-again-btn" class="secondary-btn">Record again</button>
          </div>
          <div class="detail-actions rec-discard"><button id="rec-discard-btn" class="secondary-btn">Discard</button></div>`;
        player = createAudioPlayer(body.querySelector('#rec-player'), url, { fallbackMs: taken.ms });
        body.querySelector('#rec-save-btn').onclick = () => { saved = taken; closeFn(); };
        body.querySelector('#rec-again-btn').onclick = () => { dropReview(); taken = null; state = 'ready'; draw(); };
        body.querySelector('#rec-discard-btn').onclick = () => { toast('Recording discarded'); closeFn(); };
        return;
      }
      const recording = state === 'recording' || state === 'stopping';
      body.innerHTML = `
        <div class="detail-hero rec-hero${recording ? ' live' : ''}" data-type="voice">
          <span class="row-icon">${iconSvg('voice')}</span>
          <div class="hero-when" id="rec-timer">0:00</div>
          <div class="hero-sub">${recording ? 'Recording…' : 'Tap Record to start'}</div>
        </div>
        <div class="detail-actions">
          <button id="rec-main-btn" class="${recording ? 'rec-stop' : ''}"${state === 'stopping' ? ' disabled' : ''}>${recording ? 'Stop' : 'Record'}</button>
        </div>`;
      body.querySelector('#rec-main-btn').onclick = recording ? stop : start;
    }

    await openViewer({
      title: 'Record voice', isVault, guard, onClose: cleanup,
      render: async (body, { close }) => { bodyEl = body; closeFn = close; draw(); }
    });
    if (saved) await onStopped({ recordDataBase64: saved.base64, mimeType: saved.mimeType, msDuration: saved.ms });
  }

  // ---- Main capture bar — mirrors vault-capture-bar's already-working pattern, unencrypted ----
  // Reads picked files to base64 (shared by the Home and Vault pickers).
  const readPicked = (picked) => Promise.all(picked.map((file) => new Promise((res) => {
    const r = new FileReader();
    r.onloadend = () => res({ name: file.name, fileData: r.result.split(',')[1], extension: file.name.split('.').pop() });
    r.readAsDataURL(file);
  })));

  let locationFetching = false; // true while a GPS fix is pending; blocks a second Location capture

  // New location (Decisions 116, 117): choose current fix or pasted coordinates.
  function askLocationSource(isVault = false) {
    const $ = (id) => document.getElementById(id);
    return new Promise((resolve) => {
      const dlg = $('loc-source-dialog');
      const finish = (v) => {
        if (!activeLocSource) return;
        activeLocSource = null;
        dlg.classList.add('hidden');
        resolve(v);
      };
      $('loc-source-current-btn').onclick = () => finish('current');
      $('loc-source-coords-btn').onclick = () => finish('coords');
      $('loc-source-cancel-btn').onclick = () => finish(null);
      activeLocSource = { finish, isVault };
      dlg.classList.remove('hidden');
    });
  }

  // Paste dialog. Parsing is offline and live. A short link needs the person's tap on Verify link, the one network step.
  // Resolves { lat, lng, name, text } on Continue, null on Cancel or lock.
  function openCoordsDialog(text = '', isVault = false) {
    const $ = (id) => document.getElementById(id);
    return new Promise((resolve) => {
      const dlg = $('coords-dialog'), input = $('coords-input'), status = $('coords-status');
      const preview = $('coords-preview'), verify = $('coords-verify'), verifyBtn = $('coords-verify-btn'), cont = $('coords-continue-btn');
      let parsed = null;
      const finish = (v) => {
        if (!activeCoords) return;
        activeCoords = null;
        dlg.classList.add('hidden');
        input.value = '';
        preview.innerHTML = '';
        resolve(v);
      };
      const render = (r, note = '') => {
        parsed = r && r.ok ? r : null;
        verify.classList.toggle('hidden', !(r && r.short));
        preview.classList.toggle('hidden', !parsed);
        cont.disabled = !parsed;
        if (parsed) {
          preview.innerHTML = `<div class="hero-coords">${escapeHtml(formatCoords(parsed.lat, parsed.lng))}</div>${locationPlotSvg(parsed.lat, parsed.lng)}<div class="hero-note">${parsed.name ? `${escapeHtml(parsed.name)}. ` : ''}Grid plot, 30° lines.</div>`;
          status.textContent = note || 'Coordinates found.';
        } else {
          preview.innerHTML = '';
          status.textContent = note || (!r || r.empty ? '' : r.short ? 'Short link: no coordinates inside.' : r.error);
        }
      };
      input.oninput = () => render(parseCoordinates(input.value));
      verifyBtn.onclick = async () => {
        const r = parseCoordinates(input.value);
        if (!r.short) return;
        if (navigator.onLine === false) { status.textContent = 'No internet connection.'; return; }
        verifyBtn.disabled = true;
        status.textContent = 'Contacting Google…';
        const { CapacitorHttp } = await import('@capacitor/core');
        const res = await resolveShortLink(r.url, (u) => CapacitorHttp.get({ url: u, disableRedirects: true, connectTimeout: 8000, readTimeout: 8000 }));
        verifyBtn.disabled = false;
        if (!activeCoords) return; // locked or closed meanwhile
        if (res.ok) render(res, 'Link verified.');
        else render({ ok: false, short: true }, `${res.error} Or open the link in Maps and paste the full link or the coordinates.`);
      };
      cont.onclick = () => { if (parsed) finish({ lat: parsed.lat, lng: parsed.lng, name: parsed.name || '', text: input.value }); };
      const leave = async () => { if (!input.value.trim() || await askDiscard()) finish(null); }; // pasted text counts as unsaved (Decision 133)
      $('coords-cancel-btn').onclick = leave;
      input.value = text;
      activeCoords = { finish, isVault };
      dlg.classList.remove('hidden');
      render(parseCoordinates(text));
      input.focus();
    });
  }

  async function saveLocation(d, latitude, longitude) {
    const id = crypto.randomUUID();
    await insertEntry(db, { id, type: 'location', label: d.name, latitude, longitude, description: d.description || null });
    await applyTags(id, d.tags);
    await renderMainTimeline();
    toastSaved('Location saved');
  }

  // Source chooser, then a GPS fix or pasted coordinates, then the Save dialog. Home and Vault share it (Decision 142).
  // Resolves { d, lat, lng } or null. Nothing is kept if the Vault locks meanwhile.
  async function pickLocation(isVault) {
    const source = await askLocationSource(isVault);
    if (!source) return null;
    const heading = isVault ? 'Save vault location' : 'Save location';
    const fallbackName = `Location ${new Date().toLocaleTimeString()}`;
    if (source === 'current') {
      if (locationFetching) return null; // a fix is already in progress
      locationFetching = true;
      const newBtns = (isVault ? ['vault-folder-new-btn', 'vault-universal-new-btn'] : ['folder-new-btn', 'universal-new-btn']).map((id) => document.getElementById(id)).filter(Boolean);
      newBtns.forEach((b) => { b.disabled = true; });
      toast('Fetching location…', true);
      let coords;
      try {
        await Geolocation.requestPermissions();
        coords = (await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })).coords;
        hideToast();
      } catch (err) {
        toast(`Could not get your location: ${err.message || err}`);
        return null;
      } finally {
        locationFetching = false;
        newBtns.forEach((b) => { b.disabled = false; });
      }
      if (isVault && !privateSessionKey) return null; // the Vault locked during the fix
      const d = await openSaveDialog({ heading, defaultName: fallbackName, isVault, discardLabel: 'Discard' });
      return d ? { d, lat: coords.latitude, lng: coords.longitude } : null;
    }
    // Paste dialog, then the Save dialog. Backing out of the Save dialog returns to the paste dialog with the text kept.
    let text = '', d = null, pick = null;
    const mark = overlayAbortCount;
    while (!d) {
      pick = await openCoordsDialog(text, isVault);
      if (!pick) return null;
      text = pick.text;
      d = await openSaveDialog({ heading, defaultName: pick.name || fallbackName, isVault, discardLabel: 'Back to coordinates' });
      if (!d && overlayAbortCount !== mark) return null; // locked meanwhile
    }
    return { d, lat: pick.lat, lng: pick.lng };
  }

  async function startCapture(type) {
    if (type === 'note') {
      // Editor, then the Save dialog. Backing out of the dialog returns to the editor with the text kept.
      let text = '', d = null;
      const mark = overlayAbortCount;
      while (!d) {
        const res = await openTextEditor({ title: 'New note', text });
        if (res === null) return;
        text = res;
        d = await openSaveDialog({ heading: 'Save note', defaultName: defaultNoteName(text), discardLabel: 'Back to editing' });
        if (!d && overlayAbortCount !== mark) return; // locked meanwhile
      }
      await captureText(text, 'note', { label: d.name, tags: d.tags, description: d.description });
      await renderMainTimeline();
      toastSaved('Note saved');
    } else if (type === 'voice') {
      await startVoiceRecordingUI(async ({ recordDataBase64, mimeType }) => {
        const d = await openSaveDialog({ heading: 'Save recording', defaultName: `Voice ${new Date().toLocaleTimeString()}`, discardLabel: 'Discard' });
        if (!d) { toast('Recording discarded'); return; }
        await captureFile('voice', { label: d.name, tags: d.tags, description: d.description, fileData: recordDataBase64, extension: extensionForMimeType(mimeType) });
        await renderMainTimeline();
        toastSaved('Recording saved');
      });
    } else if (type === 'reminder') {
      const d = await openSaveDialog({ heading: 'New reminder', defaultName: `Reminder ${new Date().toLocaleTimeString()}`, discardLabel: 'Discard', reminder: {} });
      if (!d) return;
      const id = crypto.randomUUID();
      const saved = { label: d.name, fire_at: d.fire_at, repeat_rule: d.repeat_rule };
      await insertEntry(db, { id, type: 'reminder', ...saved, description: d.description || null });
      await applyTags(id, d.tags);
      try {
        await scheduleReminder({ id, ...saved });
        toastSaved(saved.repeat_rule ? 'Reminder saved' : reminderSetText(saved.fire_at));
      } catch (err) {
        toast(`Reminder saved, but its notification could not be scheduled: ${err.message || err}`);
      }
      await renderMainTimeline();
    } else if (type === 'location') {
      // Current GPS fix (Decision 79) or pasted coordinates / map link (Decisions 116, 117). The saved entry stays
      // on-device; Share (row action) is the only step that sends anything out.
      const picked = await pickLocation(false);
      if (picked) await saveLocation(picked.d, picked.lat, picked.lng);
    } else if (type === 'money') {
      // Form, then the Save dialog (name defaults to the readable summary; tags; the description is the note).
      await loadCurrencySymbol();
      const items = await moneyItems();
      let details = null, d = null;
      const mark = overlayAbortCount;
      while (!d) {
        details = await openMoneyForm({ details, items, symbol: currencySymbol, hooks: moneyHooks });
        if (!details) return;
        d = await openSaveDialog({ heading: 'Save money entry', defaultName: Money.summary(details), discardLabel: 'Back to amount' });
        if (!d && overlayAbortCount !== mark) return; // locked meanwhile
      }
      await saveMoneyEntry(details, d);
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = acceptForType(type);
      input.multiple = true; // Decision 84 — more than one file offers batch add
      input.onchange = async () => {
        const picked = Array.from(input.files || []);
        if (!picked.length) return;
        const files = await readPicked(picked);
        const single = files.length === 1;
        // Picked files keep the name they have on the phone (Decision 91). Several files: the dialog
        // offers keep-each-name or one common name, numbered (Decision 84).
        const d = await openSaveDialog({
          heading: single ? `Save ${typeLabelFor(type).toLowerCase()}` : `Save ${files.length} files`,
          defaultName: single ? files[0].name : (VAULT_TYPE_LABELS[type] || type),
          count: files.length, discardLabel: 'Discard'
        });
        if (!d) return;
        if (!single && d.mode === 'number') {
          const { ids, first, last } = await batchAddWithCommonLabel(type, d.name, files, d.tags, d.description);
          toast(`${ids.length} files added: ${first} to ${last}`);
        } else {
          for (const f of files) await captureFile(type, { label: single ? d.name : f.name, tags: d.tags, description: d.description, fileData: f.fileData, extension: f.extension });
          toastSaved(single ? 'Saved' : `${files.length} files added`);
        }
        await renderMainTimeline();
      };
      beginPickerLaunch(); // Decision 73 — this file chooser must not be mistaken for backgrounding
      input.click();
    }
  }

  // ---- Main timeline — showMainTimeline() (app.js) only ever returned rows; nothing rendered
  // them or attached the five per-file actions (built in Phase 7, two sessions ago) to anything.
  // This is that missing render step, mirroring renderVaultList's already-working shape. ----
  // Cards are folders (Decision 81): a card opens the list of that type; Money also lists expenses,
  // the only money-related records there are until Money capture is defined. Vault entries are never
  // counted or listed here (is_private=0), same boundary as the digest.
  const FOLDER_TYPES = {
    note: ['note'], voice: ['voice'], image: ['image'], pdf: ['pdf'], reminder: ['reminder'],
    location: ['location'], money: ['money', 'expense'], file: ['file']
  };

  async function renderFolderCounts() {
    const res = await db.query(`SELECT type, COUNT(*) AS c FROM entries WHERE deleted_at IS NULL AND is_private=0 GROUP BY type`);
    const byType = Object.fromEntries((res.values || []).map((r) => [r.type, r.c]));
    document.querySelectorAll('#capture-bar button[data-type]').forEach((btn) => {
      const n = FOLDER_TYPES[btn.dataset.type].reduce((sum, t) => sum + (byType[t] || 0), 0);
      btn.querySelector('.card-count').textContent = n ? String(n) : '';
    });
  }

  async function renderMainTimeline() {
    await renderFolderCounts();
    await loadCurrencySymbol();
    await renderMoneySummary();
    if (!openFolderType) return;
    const rows = await showMainTimeline(FOLDER_TYPES[openFolderType]);
    if (openFolderType === 'image') { // thumbnail grid (Decision 105)
      const box = document.getElementById('folder-list');
      box.innerHTML = rows.length ? thumbGridHtml(rows) : emptyStateHtml('folder');
      box.querySelectorAll('.thumb-tile').forEach((t) => t.addEventListener('click', async () => {
        await openImageViewer(rows, rows.findIndex((r) => r.id === t.dataset.id), false);
        await renderMainTimeline();
      }));
      loadThumbsInto(box, rows, false);
      paintSelection();
      return;
    }
    document.getElementById('folder-list').innerHTML = rows.map((row) => entryRowHtml({
      id: row.id, type: row.type, label: row.label, tags: row.tags, ext: row.extension, ...rowMeta(row)
    }, 'main')).join('') || emptyStateHtml('folder');

    document.querySelectorAll('#folder-list .entry-row').forEach((r) => r.addEventListener('click', async (e) => {
      if (e.target.closest('.row-actions')) return;
      await openEntry(r.dataset.id, false, rows.find((x) => x.id === r.dataset.id));
      await renderMainTimeline();
    }));
    document.querySelectorAll('.main-share-btn').forEach((b) => b.addEventListener('click', () => window.Arkly.shareEntry(b.dataset.id)));
    document.querySelectorAll('.main-download-btn').forEach((b) => b.addEventListener('click', () => window.Arkly.downloadPlain(b.dataset.id)));
    document.querySelectorAll('.main-edit-btn').forEach((b) => b.addEventListener('click', async () => {
      const row = rows.find((r) => r.id === b.dataset.id);
      await editEntryUI(row, false);
      await renderMainTimeline();
    }));
    document.querySelectorAll('.main-delete-btn').forEach((b) => b.addEventListener('click', async () => {
      await softDelete(db, b.dataset.id); await renderMainTimeline();
      offerUndo([b.dataset.id]);
    }));
    paintSelection();
  }
  // PDF folders carry one switch (shared by Home and the Vault): in-app viewer or the phone's PDF app (Decision 148).
  async function showPdfSwitch(wrapId, toggleId, type) {
    document.getElementById(wrapId).classList.toggle('hidden', type !== 'pdf');
    if (type === 'pdf') document.getElementById(toggleId).checked = (await metaGet('pdf_inapp_viewer', 'on')) === 'on';
  }
  for (const id of ['pdf-inapp-toggle', 'vault-pdf-inapp-toggle']) {
    document.getElementById(id).addEventListener('change', async (e) => {
      await metaSet('pdf_inapp_viewer', e.target.checked ? 'on' : 'off');
      if (id === 'vault-pdf-inapp-toggle') armVaultAutoLock();
    });
  }
  async function openFolder(type, btn) {
    openFolderType = type;
    if (type === 'money') moneyMonth = null; // the month header starts on the current month
    updateBackButtonState();
    const hTitle = document.getElementById('folder-title');
    hTitle.dataset.type = type;
    hTitle.innerHTML = `<span class="title-ico">${iconSvg(TYPE_ICON[type])}</span><span>${escapeHtml(VAULT_TYPE_LABELS[type])}</span>`;
    document.getElementById('home-main').classList.add('hidden');
    document.getElementById('folder-view').classList.remove('hidden');
    await showPdfSwitch('pdf-inapp-wrap', 'pdf-inapp-toggle', type);
    await renderMainTimeline();
  }
  document.querySelectorAll('#capture-bar button[data-type]').forEach((btn) => btn.addEventListener('click', () => openFolder(btn.dataset.type, btn)));
  // A notification Snooze/Done changed a reminder while the app was already open: redraw the list (Decision 99).
  window.addEventListener('arkly-data-restored', () => {
    renderMainTimeline().catch(() => {});
    if (privateSessionKey) renderVault();
  });
    window.addEventListener('arkly-reminders-changed', () => {
      renderMainTimeline().catch(() => {}); renderFolderCounts().catch(() => {});
      if (privateSessionKey) buildVaultIndex(db, privateSessionKey).then(() => renderVault()).catch(() => {}); // Vault rows show the status
    });
  document.getElementById('folder-new-btn').addEventListener('click', () => startCapture(openFolderType));

  // ---- Long-press multi-select (Decision 122): Home folders, Vault folders and both search lists. ----
  (function wireSelection() {
    const LONG_MS = 450, SLOP = 10;
    const arm = () => { if (selection?.isVault) armVaultAutoLock(); };
    function toggleSelected(id) {
      if (!selection) return;
      if (selection.ids.has(id)) selection.ids.delete(id); else selection.ids.add(id);
      arm();
      if (selection.ids.size === 0) { exitSelection(); return; } // deselecting the last item leaves selection mode
      paintSelection();
    }
    for (const [rootId, staticVault] of [['folder-list', false], ['timeline', false], ['vault-folder-list', true]]) {
      const vaultNow = () => (rootId === 'timeline' ? searchMode === 'vault' : staticVault); // the search list serves Home or the Vault
      const root = document.getElementById(rootId);
      if (!root) continue;
      let timer = null, startX = 0, startY = 0, swallow = false;
      const rowOf = (t) => t.closest('.entry-row, .thumb-tile');
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.row-actions') || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const row = rowOf(e.target);
        if (!row) return;
        swallow = false; cancel();
        startX = e.clientX; startY = e.clientY;
        const id = row.dataset.id;
        timer = setTimeout(() => {
          timer = null;
          if (selection && selection.isVault !== vaultNow()) return;
          swallow = true; // the click that follows this press must not open the entry
          if (!selection) {
            selection = { isVault: vaultNow(), ids: new Set() };
            haptic('tick');
            document.body.classList.add('selecting');
            document.getElementById('select-bar')?.classList.remove('hidden');
            updateBackButtonState();
          }
          selection.ids.add(id);
          arm();
          paintSelection();
        }, LONG_MS);
      });
      root.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP) cancel(); });
      const end = () => { cancel(); if (swallow) setTimeout(() => { swallow = false; }, 350); }; // a press that raises no click must not eat the next tap
      root.addEventListener('pointerup', end);
      root.addEventListener('pointercancel', end);
      root.addEventListener('contextmenu', (e) => { if (rowOf(e.target)) e.preventDefault(); });
      root.addEventListener('click', (e) => {
        if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); return; }
        const row = rowOf(e.target);
        if (!selection || !row || e.target.closest('.row-actions')) return;
        e.preventDefault(); e.stopPropagation(); // capture phase: the normal open handler never runs while selecting
        toggleSelected(row.dataset.id);
      }, true);
    }

    document.getElementById('sel-cancel').addEventListener('click', exitSelection);
    document.getElementById('sel-all').addEventListener('click', () => {
      if (!selection) return;
      for (const rootId of SELECTABLE_ROOTS) {
        const root = document.getElementById(rootId);
        if (!root || root.closest('.hidden') || ((rootId === 'timeline' ? searchMode === 'vault' : rootId.startsWith('vault')) !== selection.isVault)) continue; // skip lists on hidden screens
        root.querySelectorAll('.entry-row, .thumb-tile').forEach((el) => selection.ids.add(el.dataset.id));
      }
      arm();
      paintSelection();
    });

    async function runSelection(action) {
      if (!selection || selection.ids.size === 0) return;
      const { isVault } = selection;
      const ids = [...selection.ids];
      arm();
      if (action === 'delete') {
        const ok = await askYesNo({ title: `Delete ${ids.length} item${ids.length > 1 ? 's' : ''}?`, text: 'They go to trash, not permanent.', yes: 'Delete', no: 'Cancel' });
        if (!ok) return;
      }
      const results = await runBulkFileAction(action, ids);
      const failed = results.filter((r) => !r.ok);
      exitSelection();
      if (isVault) renderVault();
      else { await renderMainTimeline(); document.getElementById('search-input')?.dispatchEvent(new Event('input')); }
      const done = results.length - failed.length;
      const verb = action === 'delete' ? 'moved to trash' : action === 'share' ? 'shared' : 'downloaded';
      const msg = failed.length ? `${done} ${verb}, ${failed.length} failed: ${failed[0].error}` : `${done} ${verb}`;
      if (action === 'delete' && done) offerUndo(results.filter((r) => r.ok).map((r) => r.id), { isVault, message: msg });
      else toast(msg);
    }
    // Merge PDFs, or Make a PDF from pictures (Decision 168): the selected items, in an order set on a sheet, become one new PDF.
    async function runMakePdf() {
      if (!selection || selection.ids.size === 0) return;
      const { isVault } = selection;
      const ids = [...selection.ids];
      arm();
      let rows;
      if (isVault) { if (!privateSessionKey) return; const idx = getVaultIndex() || []; rows = ids.map((id) => idx.find((e) => e.id === id)).filter(Boolean); }
      else rows = (await Promise.all(ids.map(async (id) => ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [id])).values || [])[0]))).filter(Boolean);
      const types = new Set(rows.map((r) => r.type));
      const pdfs = types.size === 1 && types.has('pdf'), pics = types.size === 1 && types.has('image');
      if (!pdfs && !pics) { toast('Select PDFs to merge, or pictures to make a PDF.'); return; }
      if (pdfs && rows.length < 2) { toast('Select two or more PDFs to merge.'); return; }
      const compose = await import('./pdfcompose-ui.js');
      const first = rows[0].label || (pdfs ? 'PDF' : 'Pictures');
      const res = await compose.askCompose({
        title: pdfs ? 'Merge PDFs' : 'Make a PDF',
        text: 'Pages follow this order. The originals stay as they are.',
        items: rows.map((r) => ({ id: r.id, label: r.label || (pdfs ? 'PDF' : 'Picture') })),
        name: pdfs ? `${first} (merged)` : (rows.length === 1 ? first : `${first} +${rows.length - 1}`),
        hooks: { open: (finish) => { activeCompose = { finish, isVault }; updateBackButtonState(); }, close: () => { activeCompose = null; updateBackButtonState(); } }
      });
      if (!res) return;
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = res.ids.map((id) => byId.get(id));
      toast('Making PDF…', true);
      try {
        arm();
        const bytesOf = async (row) => (isVault ? base64ToBytes((await loadVaultEntryContent(db, privateSessionKey, row.id)).content.fileData) : readStoredBytes(row));
        const pages = await import('./pdfpages.js');
        const r = pdfs
          ? await pages.mergePdfs(ordered.map((row) => () => bytesOf(row)))
          : await pages.imagesToPdf(ordered.map((row) => async () => ({ bytes: await compose.toJpegBytes(await bytesOf(row)), kind: 'jpg' })));
        await saveComposedPdf(r.bytes, res.name, isVault);
        exitSelection();
        if (isVault) renderVault();
        else { await renderMainTimeline(); document.getElementById('search-input')?.dispatchEvent(new Event('input')); }
        toast(`Saved as ${res.name} (${r.pages} page${r.pages > 1 ? 's' : ''})`);
      } catch (err) {
        const who = err && Number.isInteger(err.index) && ordered[err.index] ? `“${ordered[err.index].label || 'An item'}”` : 'An item';
        toast(err && err.code === 'encrypted' ? `${who} is password-protected. Remove its password first.` : err && Number.isInteger(err.index) ? `${who} could not be read.` : `Could not make the PDF: ${String((err && err.message) || err)}`);
      }
    }
    document.getElementById('sel-pdf').addEventListener('click', runMakePdf);
    document.getElementById('sel-share').addEventListener('click', () => runSelection('share'));
    document.getElementById('sel-download').addEventListener('click', () => runSelection('download'));
    document.getElementById('sel-delete').addEventListener('click', () => runSelection('delete'));
  })();

  updateBackButtonState();

  const newChooser = document.getElementById('new-chooser-modal');
  let newChooserTarget = 'home'; // which section's capture the shared chooser feeds (Decision 85)
  document.getElementById('universal-new-btn').addEventListener('click', () => { newChooserTarget = 'home'; newChooser.classList.remove('hidden'); });
  document.getElementById('vault-universal-new-btn').addEventListener('click', () => { newChooserTarget = 'vault'; newChooser.classList.remove('hidden'); });
  document.getElementById('new-chooser-cancel-btn').addEventListener('click', () => newChooser.classList.add('hidden'));
  document.querySelectorAll('#new-chooser-grid button[data-type]').forEach((btn) => btn.addEventListener('click', () => {
    newChooser.classList.add('hidden');
    if (newChooserTarget === 'vault') startVaultCapture(btn.dataset.type);
    else startCapture(btn.dataset.type);
  }));

  await renderMainTimeline();

  // ---- Digest, on-this-day, storage breakdown (ARCHITECTURE §6) — backend logic (showDigest,
  // onThisDay, storageBreakdown) existed already; none of it was ever rendered until now. ----
  async function renderDigest() {
    document.getElementById('today-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const rows = await showDigest();
    const el = document.getElementById('digest');
    if (rows.length === 0) { el.innerHTML = '<span class="empty-line">Nothing yet today.</span>'; return; }
    el.innerHTML = rows.map((r) => {
      const text = r.total ? `${r.cnt} ${r.type}${r.cnt > 1 ? 's' : ''} ($${r.total.toFixed(2)})` : `${r.cnt} ${r.type}${r.cnt > 1 ? 's' : ''}`;
      return `<span class="chip" data-type="${escapeHtml(r.type)}">${escapeHtml(text)}</span>`;
    }).join('');
  }
  await renderDigest();

  async function renderOnThisDay() {
    const rows = await onThisDay();
    const el = document.getElementById('on-this-day');
    if (rows.length === 0) { el.textContent = ''; return; }
    const yearsAgo = (createdAt) => Math.floor((Date.now() - createdAt) / (365.25 * 24 * 60 * 60 * 1000));
    el.innerHTML = rows.map((r) => {
      const years = yearsAgo(r.created_at);
      return `<p class="mode-description">${years === 0 ? 'Earlier this year' : `${years} year${years > 1 ? 's' : ''} ago`} you saved "${r.label}"</p>`;
    }).join('');
  }
  await renderOnThisDay();

  // Recurring backup reminder (Session 40) — dismiss is in-memory only (a plain click handler
  // hiding the element), not persisted; reappears at the next cold launch same as before, which is
  // the intended "soft nudge" behavior rather than a permanent snooze that could go unnoticed for
  // months.
  async function renderBackupReminder() {
    const banner = document.getElementById('backup-reminder-banner');
    const { due } = await backupReminderDue();
    banner.classList.toggle('hidden', !due);
    if (!due) return;
    banner.innerHTML = `
      <span>It's been over 30 days since your last backup.</span>
      <button id="backup-reminder-btn" class="secondary-btn">Back up now</button>
      <button id="backup-reminder-dismiss-btn" class="link-btn" aria-label="Dismiss">✕</button>
    `;
    document.getElementById('backup-reminder-btn').addEventListener('click', () => {
      const backupSection = document.getElementById('backup-settings');
      switchMainTab('settings');
      backupSection.open = true;
      backupSection.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('backup-reminder-dismiss-btn').addEventListener('click', () => banner.classList.add('hidden'));
  }
  await renderBackupReminder();

  async function renderStorageBreakdown() {
    const breakdown = await storageBreakdown();
    document.getElementById('storage-breakdown-list').innerHTML = breakdown.map((b) => `
      <div class="drive-backup-row">
        <span>${CATEGORY_LABELS[b.category] || b.category}: ${b.count} item${b.count !== 1 ? 's' : ''}, ${formatBytes(b.totalBytes)}</span>
        <button class="clear-old-btn" data-cat="${b.category}">Clear items older than 30 days</button>
      </div>
    `).join('') || 'Nothing captured yet.';
    document.querySelectorAll('.clear-old-btn').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askYesNo({ title: 'Move matching items to trash?', text: 'They stay recoverable for 30 days.', yes: 'Move', no: 'Cancel' }))) return;
      const result = await clearOldInCategory(b.dataset.cat, 30);
      await renderStorageBreakdown(); await renderMainTimeline();
      if (result.cleared) offerUndo(result.ids, { isVault: !!privateSessionKey, message: `${result.cleared} item${result.cleared > 1 ? 's' : ''} moved to trash`, after: renderStorageBreakdown });
      else toast('Nothing older than 30 days.');
    }));
  }
  document.getElementById('storage-breakdown-settings').addEventListener('toggle', (e) => { if (e.target.open) renderStorageBreakdown(); });

  // "Your Data" transparency screen (ARCHITECTURE §7) — recomputed on open, same lazy pattern as
  // storage breakdown above, not on every settings render.
  async function renderYourData() {
    const { entryCount, storageBytes } = await yourDataSummary();
    document.getElementById('your-data-summary').textContent =
      `${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} · ` +
      (storageBytes === null ? 'on-device storage: unknown' : `~${formatBytes(storageBytes)} of data on this device`);
  }
  document.getElementById('your-data-settings').addEventListener('toggle', (e) => { if (e.target.open) renderYourData(); });
  // Export Now jumps straight into the existing Backup & Restore flow (ARCHITECTURE §7) rather than
  // duplicating it — opens that section and scrolls it into view; nothing here builds a second export path.
  document.getElementById('your-data-export-btn').addEventListener('click', () => {
    const backupSection = document.getElementById('backup-settings');
    backupSection.open = true;
    backupSection.scrollIntoView({ behavior: 'smooth' });
  });

  // Database encryption (Decision 158): opt-in, one-way, key held on this device only.
  async function renderDbEnc() {
    const on = await getEncryptionStatus();
    const r = getEncryptionResult();
    const last = !r ? '' : r.state === 'done' ? ' Last attempt: encrypted.'
      : r.state === 'running' ? ' Last attempt did not finish; check the status above.'
      : r.state === 'unconfirmed' ? ' Last attempt could not be confirmed.'
      : ` Last attempt failed: ${r.error || 'unknown error'}.`;
    document.getElementById('db-enc-status').textContent = (on ? 'On — the database file is encrypted.' : 'Off — the database file is not encrypted.') + last;
    document.getElementById('db-enc-btn').classList.toggle('hidden', on);
  }
  document.getElementById('db-enc-settings').addEventListener('toggle', (e) => { if (e.target.open) renderDbEnc(); });
  document.getElementById('db-enc-btn').addEventListener('click', async () => {
    const ok = await askYesNo({
      title: 'Encrypt the database?',
      text: 'The app restarts and converts your main database file. This cannot be undone. Run Export Now first: an interruption mid-conversion could lose data. Keep the app open until it finishes.',
      yes: 'Encrypt', no: 'Cancel'
    });
    if (!ok) return;
    document.getElementById('db-enc-btn').disabled = true;
    requestEncryption();
    toast('Restarting to encrypt…', true);
    setTimeout(() => location.reload(), 800);
  });

  // ---- Shared Edit prompt flow (Phase 7's Edit action — had no UI anywhere until now).
  // isVault: main-timeline rows carry real columns (amount, expense_category, fire_at, body_text);
  // vault items only ever carry {id,label,tags,searchableText,...} from the in-memory index — but
  // vault scope is Text/Voice/Image/PDF/Files only, so the expense/reminder branches below simply
  // never apply to a vault item, not a data gap. Text content for a vault note comes from
  // searchableText, which vault.js's index already stores as the note's own decrypted text. ----
  // Edit button: details dialog (name, tags, description) for every type; text notes go through the editor.
  async function editEntryUI(item, isVault) {
    if (item.type === 'note') return openNote(item, isVault);
    if (item.type === 'money') return editMoney(item, isVault);
    if (item.type === 'reminder') { // schedule columns may have changed since the row was drawn (Snooze, Done)
      const r = ((await db.query(`SELECT fire_at, repeat_rule, completed_at, snoozed_until FROM entries WHERE id = ?`, [item.id])).values || [])[0];
      if (r) item = { ...item, ...r };
    }
    const tags = item.tags || await getEntryTags(item.id);
    const isReminder = item.type === 'reminder'; // Home and Vault
    const d = await openSaveDialog({
      heading: isReminder ? 'Edit reminder' : 'Edit details', name: item.label, defaultName: item.label, tags, description: item.description || '', isVault,
      reminder: isReminder ? { fire_at: item.fire_at, repeat_rule: item.repeat_rule } : null
    });
    if (!d) return;
    const fields = { label: d.name, description: d.description };

    if (item.type === 'expense' && !isVault) {
      const newAmount = await askText({ title: 'New amount', initial: String(item.amount ?? ''), decimal: true });
      if (newAmount !== null && newAmount.trim() !== '' && Number.isFinite(parseFloat(newAmount))) fields.amount = parseFloat(newAmount);
      const newCategory = await askText({ title: 'New category', initial: item.expense_category || '' });
      if (newCategory !== null) fields.expense_category = newCategory;
    } else if (isReminder) {
      const timeChanged = d.fire_at !== item.fire_at || (d.repeat_rule || null) !== (item.repeat_rule || null);
      // A new time reopens a finished reminder and reschedules it. A label-only change reschedules an active one
      // so the notification text stays current; a finished one is left alone.
      if (timeChanged || isReminderActive(item)) {
        fields.fire_at = d.fire_at;
        fields.repeat_rule = d.repeat_rule;
        if (timeChanged) { fields.completed_at = null; fields.snoozed_until = null; }
      }
    }

    try {
      const opts = item.type === 'reminder' ? { rescheduleReminder: scheduleReminder } : {};
      await window.Arkly.editEntry(item.id, fields, opts);
      await setEntryTags(item.id, d.tags);
      if (isVault) await refreshVaultIndexEntries(db, privateSessionKey, [item.id]); // list/search read this in-memory index
      toastSaved(isReminder && fields.fire_at && !fields.repeat_rule && fields.fire_at > Date.now() ? reminderSetText(fields.fire_at) : 'Saved');
    } catch (err) { toast(`Could not save: ${err.message || err}`); }
  }

  // Text note: editor, then the Save dialog prefilled with name, tags and description.
  async function openNote(item, isVault) {
    const tags = item.tags || await getEntryTags(item.id);
    let text = isVault ? (item.searchableText || '') : (item.body_text || ''), d = null;
    const mark = overlayAbortCount;
    while (!d) {
      const res = await openTextEditor({ title: item.label, text, isVault });
      if (res === null) return;
      text = res;
      d = await openSaveDialog({ heading: 'Save changes', name: item.label, defaultName: item.label, tags, description: item.description || '', isVault, discardLabel: 'Back to editing' });
      if (!d && overlayAbortCount !== mark) return;
    }
    try {
      await window.Arkly.editEntry(item.id, { label: d.name, text, description: d.description }, {});
      await setEntryTags(item.id, d.tags);
      if (isVault) await refreshVaultIndexEntries(db, privateSessionKey, [item.id]);
      toastSaved('Saved');
    } catch (err) { toast(`Could not save: ${err.message || err}`); }
  }

  // Entry viewer shell (Decision 92). render(bodyEl, helpers) fills the body; call helpers.refresh() after a change.
  // onClose runs on every close, including a lock's forced close. guard() (optional) is asked on Back only and may refuse.
  function openViewer({ title, isVault = false, render, onEdit, onClose = null, guard = null, entry = null }) {
    return new Promise((resolve) => {
      const $ = (id) => document.getElementById(id);
      const screen = $('viewer-screen'), body = $('viewer-body');
      $('viewer-title').textContent = title;
      const finish = () => {
        if (onClose) { try { onClose(); } catch { /* closing anyway */ } }
        screen.querySelectorAll('.vwr-act').forEach((n) => n.remove());
        screen.classList.add('hidden');
        body.innerHTML = '';
        activeViewer = null;
        updateBackButtonState();
        resolve();
      };
      const back = async () => { if (!guard || await guard()) finish(); };
      const refresh = async () => { await render(body, { refresh, close: finish }); };
      $('viewer-back-btn').onclick = back;
      $('viewer-edit-btn').classList.toggle('hidden', !onEdit);
      $('viewer-edit-btn').onclick = async () => { if (onEdit) { await onEdit(); await refresh(); } };
      // Share, Download and Delete after Edit, the same order as the rows and the image viewer (Decisions 134, 141).
      screen.querySelectorAll('.vwr-act').forEach((n) => n.remove());
      if (entry) {
        const add = (label, icon, extra, run) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = `vwr-act icon-btn${extra}`; b.title = label; b.setAttribute('aria-label', label);
          b.innerHTML = iconSvg(icon); b.onclick = run;
          $('viewer-edit-btn').parentNode.append(b);
        };
        add('Share', 'share', '', () => window.Arkly.shareEntry(entry.id));
        add('Download', 'download', '', () => window.Arkly.downloadPlain(entry.id));
        add('Delete', 'trash', ' warning-text', async () => {
          try { if (isVault) await deleteVaultEntry(entry.id); else await softDelete(db, entry.id); }
          catch (err) { toast(`Could not delete: ${err.message || err}`); return; }
          finish();
          if (refreshAfterUndo) await refreshAfterUndo();
          offerUndo([entry.id], { isVault });
        });
      }
      activeViewer = { finish, back, isVault };
      screen.classList.remove('hidden');
      updateBackButtonState();
      refresh();
    });
  }

  // ---- Money on Home (Decision 126). Details live in money_json; the label is the readable summary and the
  // description is the note, so search finds both. Legacy expense rows are read as Spent (money.js fromRow). ----
  async function moneyItems() {
    const rows = (await db.query(`SELECT type, amount, expense_category, created_at, money_json FROM entries WHERE deleted_at IS NULL AND is_private=0 AND type IN ('money','expense')`)).values || [];
    return rows.map((r) => Money.fromRow(r)).filter(Boolean);
  }

  // Month header and loan totals (Decision 129). Home reads the database; the Vault reads only its unlocked in-memory
  // index and is never mixed with Home (Decision 135). Element ids carry a prefix so the two never collide.
  function paintMoneySummary({ box, items, month, setMonth, rerender, idp }) {
    const t = Money.monthTotals(items, month.y, month.m);
    const l = Money.loanTotals(items);
    const fmt = (n) => Money.formatAmount(n, currencySymbol);
    // Month and year pick separately. The year list is the shown year plus two either side, oldest first; any other year is typed.
    const monthOpts = Array.from({ length: 12 }, (_, i) => `<option value="${i}"${i === month.m ? ' selected' : ''}>${escapeHtml(new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }))}</option>`).join('');
    let yearOpts = '';
    for (let y = month.y - 2; y <= month.y + 2; y++) yearOpts += `<option value="${y}"${y === month.y ? ' selected' : ''}>${y}</option>`;
    box.innerHTML = `
      <div class="ms-head">
        <button type="button" id="${idp}-prev" class="ms-step" aria-label="Previous month">‹</button>
        <select id="${idp}-month" aria-label="Month">${monthOpts}</select>
        <select id="${idp}-year" aria-label="Year">${yearOpts}</select>
        <button type="button" id="${idp}-next" class="ms-step" aria-label="Next month">›</button>
      </div>
      <input id="${idp}-year-input" class="ms-year-input" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Type a year, e.g. 2031" aria-label="Type a year" />
      <div class="ms-grid">
        <div><span>Spent</span><b>${escapeHtml(fmt(t.spent))}</b></div>
        <div><span>Received</span><b>${escapeHtml(fmt(t.received))}</b></div>
        <div><span>Net</span><b class="${t.net < 0 ? 'neg' : ''}">${escapeHtml(fmt(t.net))}</b></div>
      </div>
      <div class="ms-loans">
        <div><span>Owed to you</span><b>${escapeHtml(fmt(l.owedToYou))}</b></div>
        <div><span>You owe</span><b>${escapeHtml(fmt(l.youOwe))}</b></div>
      </div>`;
    box.classList.remove('hidden');
    const el = (n) => document.getElementById(`${idp}-${n}`);
    const pick = async () => {
      setMonth({ y: Number(el('year').value), m: Number(el('month').value) });
      await rerender();
    };
    el('month').onchange = pick;
    const yearInput = el('year-input');
    yearInput.onchange = async () => {
      const v = yearInput.value.trim();
      if (/^\d{4}$/.test(v) && Number(v) >= 1900) setMonth({ y: Number(v), m: month.m });
      await rerender(); // an invalid entry is dropped and the shown year stays
    };
    yearInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); yearInput.blur(); } };
    el('year').onchange = pick;
    const step = (delta) => async () => {
      const d = new Date(month.y, month.m + delta, 1);
      setMonth({ y: d.getFullYear(), m: d.getMonth() });
      await rerender();
    };
    el('prev').onclick = step(-1);
    el('next').onclick = step(1);
  }

  async function renderMoneySummary() {
    const box = document.getElementById('money-summary');
    if (openFolderType !== 'money') { box.classList.add('hidden'); box.innerHTML = ''; return; }
    if (!moneyMonth) { const n = new Date(); moneyMonth = { y: n.getFullYear(), m: n.getMonth() }; }
    paintMoneySummary({ box, items: await moneyItems(), month: moneyMonth, setMonth: (v) => { moneyMonth = v; }, rerender: renderMoneySummary, idp: 'ms' });
  }

  // Vault Money: details come from the unlocked index only (Decision 135).
  function vaultMoneyItems() {
    return (getVaultIndex() || []).filter((e) => e.type === 'money' && e.money).map((e) => e.money);
  }
  function renderVaultMoneySummary() {
    const box = document.getElementById('vault-money-summary');
    if (!box) return;
    if (openVaultFolderType !== 'money' || !privateSessionKey) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    if (!vaultMoneyMonth) { const n = new Date(); vaultMoneyMonth = { y: n.getFullYear(), m: n.getMonth() }; }
    paintMoneySummary({ box, items: vaultMoneyItems(), month: vaultMoneyMonth, setMonth: (v) => { vaultMoneyMonth = v; }, rerender: renderVaultMoneySummary, idp: 'vms' });
  }

  async function saveMoneyEntry(details, d) {
    const id = crypto.randomUUID();
    await insertEntry(db, { id, type: 'money', label: d.name, description: d.description || null, money_json: Money.toJson(details) });
    await applyTags(id, d.tags);
    await renderMainTimeline();
    toastSaved('Saved');
  }

  // Edit: form, then the Save dialog. A name still equal to the old summary follows the new details; a typed name is kept.
  // Vault: details come from the index, the name is never derived from them (the label is plaintext), and the
  // details are written into the encrypted body, not money_json (Decision 135).
  async function editMoney(item, isVault = false) {
    const old = isVault ? item.money : Money.fromRow(item);
    if (!old) { toast('This entry has no readable amount.'); return; }
    await loadCurrencySymbol();
    const items = isVault ? vaultMoneyItems() : await moneyItems();
    const tags = item.tags || await getEntryTags(item.id);
    const autoName = item.label === Money.summary(old);
    let details = old, d = null;
    const mark = overlayAbortCount;
    while (!d) {
      details = await openMoneyForm({ details, items, symbol: currencySymbol, heading: 'Edit money entry', hooks: isVault ? vaultMoneyHooks : moneyHooks });
      if (!details) return;
      const next = Money.summary(details);
      d = await openSaveDialog({ heading: 'Save changes', name: autoName ? next : item.label, defaultName: next, tags, description: item.description || '', isVault, discardLabel: 'Back to amount' });
      if (!d && overlayAbortCount !== mark) return; // locked meanwhile
    }
    try {
      await window.Arkly.editEntry(item.id, isVault
        ? { label: d.name, description: d.description, money: details }
        : { label: d.name, description: d.description, money_json: Money.toJson(details) }, {});
      await setEntryTags(item.id, d.tags);
      if (isVault) await refreshVaultIndexEntries(db, privateSessionKey, [item.id]); // lists, totals and search read this index
      toastSaved('Saved');
    } catch (err) { toast(`Could not save: ${err.message || err}`); }
  }

  async function openMoney(item, isVault = false) {
    const fresh = async () => isVault
      ? ((getVaultIndex() || []).find((e) => e.id === item.id) || item)
      : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0] || item;
    const detailsOf = (row) => (isVault ? row.money : Money.fromRow(row)); // Vault: from the unlocked index (Decision 135)
    await openViewer({
      title: 'Money', isVault, entry: item,
      onEdit: async () => { await editEntryUI(await fresh(), isVault); },
      render: async (body, { refresh }) => {
        const row = await fresh();
        const d = detailsOf(row);
        if (!d) { body.innerHTML = '<p class="screen-sub">This entry has no readable amount.</p>'; return; }
        await loadCurrencySymbol();
        const fmt = (n) => Money.formatAmount(n, currencySymbol);
        const tags = isVault ? (row.tags || []) : await getEntryTags(row.id);
        const loan = Money.isLoan(d);
        const st = Money.status(d);
        const pill = st === 'partly returned' ? 'partly' : st;
        const full = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        const line = (k, v) => (v ? `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>` : '');
        const reps = (d.repayments || []).map((r) => `<div><dt>${escapeHtml(formatEntryDate(r.at))}${r.method ? ` · ${escapeHtml(r.method)}` : ''}${r.note ? ` · ${escapeHtml(r.note)}` : ''}</dt><dd>${escapeHtml(fmt(r.amount))}</dd></div>`).join('');
        body.innerHTML = `
          <div class="detail-hero${st === 'settled' ? ' inactive' : ''}" data-type="money">
            <span class="row-icon">${iconSvg('money')}</span>
            <div class="hero-when">${escapeHtml(fmt(d.amount))}</div>
            <div class="hero-sub">${escapeHtml(row.label)}</div>
            ${loan ? `<span class="status-pill ${pill}">${escapeHtml(Money.STATUS_LABELS[st])}</span>` : ''}
          </div>
          <dl class="detail-list">
            ${line('Kind', Money.KIND_LABELS[d.kind])}
            ${line('Date', full(d.at))}
            ${line('Person', d.person)}
            ${line('Category', d.category)}
            ${line('Payment method', d.method)}
            ${line('Due', d.due ? new Date(d.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')}
            ${loan ? line('Returned', fmt(Money.repaid(d))) + line('Remaining', fmt(Money.remaining(d))) : ''}
            ${line('Description', row.description)}
            ${tags.length ? `<div><dt>Tags</dt><dd class="tag-wrap">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</dd></div>` : ''}
          </dl>
          ${loan ? `<p class="settings-group">Repayments</p><dl class="detail-list">${reps || '<div><dt>None yet</dt><dd></dd></div>'}</dl>` : ''}
          <div class="detail-actions">
            ${loan && st !== 'settled' ? '<button id="mv-repay-btn">Add repayment</button>' : ''}
            <button id="mv-edit-btn" class="secondary-btn">Edit</button>
          </div>`;
        const add = document.getElementById('mv-repay-btn');
        if (add) add.onclick = async () => {
          const cur = detailsOf(await fresh());
          if (!cur) return;
          const next = await openRepayDialog({ details: cur, items: isVault ? vaultMoneyItems() : await moneyItems(), symbol: currencySymbol, hooks: isVault ? vaultMoneyHooks : moneyHooks });
          if (!next) return;
          try {
            await window.Arkly.editEntry(row.id, isVault ? { money: next } : { money_json: Money.toJson(next) }, {});
            if (isVault) await refreshVaultIndexEntries(db, privateSessionKey, [row.id]);
            toast('Repayment added');
          } catch (err) { toast(`Could not save: ${err.message || err}`); }
          await refresh();
        };
        document.getElementById('mv-edit-btn').onclick = async () => { await editEntryUI(await fresh(), isVault); await refresh(); };
      }
    });
  }

  async function openReminder(item, isVault = false) {
    // Vault: the schedule is read from the row (Snooze and Done change it while locked); the note comes from the unlocked index.
    const fresh = async () => {
      const dbRow = ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0];
      if (!dbRow) return item;
      if (!isVault) return dbRow;
      const ix = (getVaultIndex() || []).find((e) => e.id === item.id);
      return { ...dbRow, description: ix ? ix.description : '', tags: ix ? ix.tags : [] };
    };
    await openViewer({
      title: 'Reminder', isVault, entry: item,
      onEdit: async () => { await editEntryUI(await fresh(), isVault); },
      render: async (body, { refresh }) => {
        const row = await fresh();
        const tags = await getEntryTags(row.id);
        const st = reminderStatus(row);
        const stLabel = { upcoming: 'Upcoming', snoozed: 'Snoozed', done: 'Done', fired: 'Fired' }[st];
        const active = st === 'upcoming' || st === 'snoozed';
        const when = new Date(reminderNextDue(row)).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        // A fired one-off can't simply be reopened (its time is past): offer Reschedule instead.
        const canToggle = active || row.completed_at;
        const toggleLabel = active ? (row.repeat_rule ? 'Done for now' : 'Mark done') : 'Reopen';
        body.innerHTML = `
          <div class="detail-hero${active ? '' : ' inactive'}" data-type="reminder">
            <span class="row-icon">${iconSvg('reminder')}</span>
            <div class="hero-when">${escapeHtml(when)}</div>
            <div class="hero-sub">${escapeHtml(row.label)}</div>
            <span class="status-pill ${st}">${stLabel}</span>
          </div>
          <dl class="detail-list">
            ${st === 'snoozed' ? `<div><dt>Snoozed until</dt><dd>${escapeHtml(formatEntryDate(row.snoozed_until))}</dd></div>` : ''}
            <div><dt>Repeat</dt><dd>${escapeHtml(repeatLabel(row.repeat_rule))}</dd></div>
            ${row.description ? `<div><dt>Description</dt><dd>${escapeHtml(row.description)}</dd></div>` : ''}
            ${tags.length ? `<div><dt>Tags</dt><dd class="tag-wrap">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</dd></div>` : ''}
            <div><dt>Created</dt><dd>${escapeHtml(formatEntryDate(row.created_at))}</dd></div>
          </dl>
          <div class="detail-actions">
            ${canToggle ? `<button id="rv-toggle-btn">${toggleLabel}</button>` : ''}
            <button id="rv-edit-btn" class="secondary-btn">Reschedule</button>
          </div>`;
        const t = document.getElementById('rv-toggle-btn');
        if (t) t.onclick = async () => { if (active) { await markReminderDone(row.id); if (row.repeat_rule) toast('Done for now — it will repeat'); } else await reopenReminder(row.id); window.dispatchEvent(new Event('arkly-reminders-changed')); await refresh(); };
        document.getElementById('rv-edit-btn').onclick = async () => { await editEntryUI(await fresh(), isVault); await refresh(); };
      }
    });
  }

  // Location detail (Decision 93): coordinates, a grid plot drawn from them (no map data, no network), copy, hand-off.
  function formatCoords(lat, lng) {
    return `${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(6)}° ${lng >= 0 ? 'E' : 'W'}`;
  }
  function locationPlotSvg(lat, lng) {
    const x = Math.min(354, Math.max(6, lng + 180)), y = Math.min(174, Math.max(6, 90 - lat));
    const v = [];
    for (let lo = -150; lo <= 150; lo += 30) v.push(`<line x1="${lo + 180}" y1="0" x2="${lo + 180}" y2="180"${lo === 0 ? ' class="axis"' : ''}/>`);
    for (let la = -60; la <= 60; la += 30) v.push(`<line x1="0" y1="${90 - la}" x2="360" y2="${90 - la}"${la === 0 ? ' class="axis"' : ''}/>`);
    return `<svg class="loc-plot" viewBox="0 0 360 180" role="img" aria-label="Position on a latitude and longitude grid">
      <rect width="360" height="180" rx="6"/>${v.join('')}
      <circle class="ring" cx="${x}" cy="${y}" r="9"/><circle class="pin" cx="${x}" cy="${y}" r="3.5"/></svg>`;
  }

  // Vault: the coordinates come from the unlocked index (Decision 142); the view is otherwise Home's.
  async function openLocation(item, isVault = false) {
    const fresh = async () => isVault
      ? ((getVaultIndex() || []).find((e) => e.id === item.id) || item)
      : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0] || item;
    await openViewer({
      title: 'Location', isVault, entry: item,
      onEdit: async () => { await editEntryUI(await fresh(), isVault); },
      render: async (body) => {
        const found = await fresh();
        const row = isVault // one shape for both: latitude, longitude, created_at
          ? { ...found, latitude: found.location ? found.location.latitude : null, longitude: found.location ? found.location.longitude : null, created_at: found.createdAt }
          : found;
        const tags = isVault ? (found.tags || []) : await getEntryTags(row.id);
        const has = row.latitude != null && row.longitude != null;
        const coords = has ? formatCoords(row.latitude, row.longitude) : '';
        body.innerHTML = `
          <div class="detail-hero" data-type="location">
            <span class="row-icon">${iconSvg('location')}</span>
            <div class="hero-when hero-coords">${has ? escapeHtml(coords) : 'No coordinates saved'}</div>
            <div class="hero-sub">${escapeHtml(row.label)}</div>
            ${has ? locationPlotSvg(row.latitude, row.longitude) : ''}
            ${has ? '<div class="hero-note">Grid plot, 30° lines. No map data is stored.</div>' : ''}
          </div>
          <dl class="detail-list">
            ${has ? `<div><dt>Decimal</dt><dd>${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}</dd></div>` : ''}
            ${row.description ? `<div><dt>Description</dt><dd>${escapeHtml(row.description)}</dd></div>` : ''}
            ${tags.length ? `<div><dt>Tags</dt><dd class="tag-wrap">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</dd></div>` : ''}
            <div><dt>Saved</dt><dd>${escapeHtml(formatEntryDate(row.created_at))}</dd></div>
          </dl>
          ${has ? `<div class="detail-actions">
            <button id="lv-maps-btn">Open in Maps</button>
            <button id="lv-copy-btn" class="secondary-btn">Copy</button>
          </div>` : ''}`;
        if (!has) return;
        document.getElementById('lv-copy-btn').onclick = async () => {
          try { await navigator.clipboard.writeText(`${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)}`); toast('Coordinates copied'); }
          catch { toast('Could not copy'); }
        };
        // geo: URI hands off to the phone's maps app; nothing is fetched by Arkly. Leaving the app locks it like any background.
        document.getElementById('lv-maps-btn').onclick = () => {
          window.location.assign(`geo:${row.latitude.toFixed(6)},${row.longitude.toFixed(6)}?q=${row.latitude.toFixed(6)},${row.longitude.toFixed(6)}(${encodeURIComponent(row.label)})`);
        };
      }
    });
  }

  // Saved voice entry: player plus details. Vault audio is decrypted on open into an in-memory URL, revoked on close.
  async function openVoice(item, isVault) {
    let url = null, player = null;
    const fresh = async () => isVault
      ? ((getVaultIndex() || []).find((e) => e.id === item.id) || item)
      : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0] || item;
    const source = async () => {
      if (url) return url;
      if (isVault) { url = (await openVaultEntry(item.id)).blobUrl; return url; }
      const row = await fresh();
      url = URL.createObjectURL(new Blob([await readEntryBytes(row)], { type: audioMimeForExtension(row.extension) }));
      return url;
    };
    await openViewer({
      title: 'Voice', isVault, entry: item,
      onEdit: async () => { await editEntryUI(await fresh(), isVault); },
      onClose: () => { if (player) { player.destroy(); player = null; } if (url) { URL.revokeObjectURL(url); url = null; } },
      render: async (body) => {
        const row = await fresh();
        const tags = isVault ? (row.tags || []) : await getEntryTags(row.id);
        const saved = isVault ? row.createdAt : row.created_at;
        body.innerHTML = `
          <div class="detail-hero" data-type="voice">
            <span class="row-icon">${iconSvg('voice')}</span>
            <div class="hero-when hero-coords">${escapeHtml(row.label)}</div>
            <div class="hero-sub">Voice recording</div>
          </div>
          <div id="vv-player"></div>
          <dl class="detail-list">
            ${row.description ? `<div><dt>Description</dt><dd>${escapeHtml(row.description)}</dd></div>` : ''}
            ${tags.length ? `<div><dt>Tags</dt><dd class="tag-wrap">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</dd></div>` : ''}
            <div><dt>Saved</dt><dd>${escapeHtml(formatEntryDate(saved))}</dd></div>
          </dl>`;
        if (player) { player.destroy(); player = null; }
        try {
          player = createAudioPlayer(body.querySelector('#vv-player'), await source(), { onActivity: isVault ? armVaultAutoLock : armAppAutoLock });
        } catch (err) {
          body.querySelector('#vv-player').innerHTML = `<div class="hero-note">Could not open this recording: ${escapeHtml(String(err.message || err))}</div>`;
        }
      }
    });
  }

  // Full-screen image viewer over a list (the folder's images, in grid order): swipe or arrows to move, pinch and
  // double-tap to zoom. One full-size blob URL at a time, revoked on every change and on close or lock (Decision 105).
  async function openImageViewer(list, startIndex, isVault) {
    const items = list.slice();
    let index = Math.max(0, Math.min(startIndex, items.length - 1));
    let url = null, zoom = null, token = 0, openViewerRefresh = () => {};
    const drop = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
    const viewerScreen = document.getElementById('viewer-screen');
    viewerScreen.classList.add('image-mode'); // image fills the screen below the header (Decision 105)
    const fresh = async (item) => isVault
      ? ((getVaultIndex() || []).find((e) => e.id === item.id) || item)
      : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0] || item;
    await openViewer({
      title: items[index]?.label || 'Image', isVault,
      onEdit: async () => { await editEntryUI(await fresh(items[index]), isVault); },
      onClose: () => { token++; viewerScreen.classList.remove('image-mode'); viewerScreen.querySelectorAll('.img-hdr').forEach((n) => n.remove()); if (zoom) { zoom.destroy(); zoom = null; } drop(); },
      render: async (body, { close, refresh }) => {
        openViewerRefresh = refresh;
        if (!items.length) { close(); return; }
        const item = await fresh(items[index]);
        items[index] = item;
        document.getElementById('viewer-title').textContent = item.label || 'Image';
        body.innerHTML = `
          <div class="img-stage"><img class="img-full" alt="" draggable="false">
            <div class="img-loading">Loading…</div>
            ${items.length > 1 ? `<button type="button" class="img-nav img-prev" aria-label="Previous image">‹</button><button type="button" class="img-nav img-next" aria-label="Next image">›</button>` : ''}
          </div>`;
        // Header order in image mode: back, name, Edit (rename), Share, Download, Delete, count. Appended after Edit.
        viewerScreen.querySelectorAll('.img-hdr').forEach((n) => n.remove());
        const editBtn = document.getElementById('viewer-edit-btn');
        const hdr = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const n = t.content.firstChild; editBtn.parentNode.append(n); return n; };
        const shareBtn = hdr(`<button type="button" class="img-hdr icon-btn" aria-label="Share" title="Share">${iconSvg('share')}</button>`);
        const downloadBtn = hdr(`<button type="button" class="img-hdr icon-btn" aria-label="Download" title="Download">${iconSvg('download')}</button>`);
        const deleteBtn = hdr(`<button type="button" class="img-hdr icon-btn warning-text" aria-label="Delete" title="Delete">${iconSvg('trash')}</button>`);
        hdr(`<span class="img-hdr img-count">${index + 1}/${items.length}</span>`);
        const stage = body.querySelector('.img-stage'), img = body.querySelector('.img-full'), loading = body.querySelector('.img-loading');
        const arm = isVault ? armVaultAutoLock : armAppAutoLock;
        const go = (step) => { const n = index + step; if (n < 0 || n >= items.length) { zoom?.reset(); return; } index = n; arm(); render2(); };
        const render2 = () => body.isConnected && openViewerRefresh();
        if (zoom) zoom.destroy();
        zoom = attachZoomPan(stage, img, { onSwipe: go, onActivity: arm });
        for (const [sel, step] of [['.img-prev', -1], ['.img-next', 1]]) {
          const b = body.querySelector(sel);
          if (!b) continue;
          b.addEventListener('pointerdown', (e) => e.stopPropagation()); // arrows are not part of the gesture area
          b.addEventListener('pointerup', (e) => e.stopPropagation());
          b.addEventListener('click', () => go(step));
        }
        shareBtn.onclick = () => window.Arkly.shareEntry(item.id);
        downloadBtn.onclick = () => window.Arkly.downloadPlain(item.id);
        deleteBtn.onclick = async () => {
          if (isVault) await deleteVaultEntry(item.id); else await softDelete(db, item.id);
          offerUndo([item.id], { isVault });
          items.splice(index, 1);
          if (!items.length) { close(); return; }
          index = Math.min(index, items.length - 1);
          openViewerRefresh();
        };
        const mine = ++token;
        drop();
        try {
          const u = await imageBlobUrl(item, isVault);
          if (mine !== token) { URL.revokeObjectURL(u); return; } // moved on or closed while loading
          url = u;
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not display this image')); img.src = u; });
          loading.remove();
        } catch (err) { if (mine === token) loading.textContent = String(err.message || err); }
      }
    });
  }

  // Tapping a Files row hands the file straight to the phone's matching app (Phase 16 G, Decision 118).
  // Vault files are decrypted into cache/open/ for that hand-off; the copy is removed on the next launch or resume.
  let openingFile = false;
  async function openFile(item, isVault) {
    if (openingFile) return; // ignore a second tap while the first is still launching
    openingFile = true;
    try {
      if (isVault) {
        if (!privateSessionKey) throw new Error('Vault locked');
        armVaultAutoLock();
        const { row, content } = await loadVaultEntryContent(db, privateSessionKey, item.id);
        await openDecryptedFile(item.id, row.extension, content.fileData);
      } else {
        const row = item.file_path ? item : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0];
        if (!row) throw new Error('File not found');
        await openStoredFile(row);
      }
    } catch (err) { toast(String(err.message || err)); }
    finally { openingFile = false; }
  }

  // PDF entry: in-app viewer on a bundled pdf.js, loaded on first open (Phase 16 H, Decision 121). Vault bytes are
  // decrypted into memory only and dropped on close or lock. A document that cannot be read offers the phone's app.
  // Stored file as bytes, read through the app's own file URL so a large file is not also held as a base64 string and its
  // decoded copy (Decision 154). Falls back to the base64 read if the URL read fails.
  // files.js keeps that route for the file URL read and decrypts in memory (Decision 161).
  const readStoredBytes = (row) => readEntryBytes(row);

  // Mark-up output (Decision 166): the marked PDF becomes a new entry beside the original (label + " (marked)", same tags
  // and description), or replaces it: the new entry is written first, then the original is deleted for good.
  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function saveMarkedPdf(item, bytes, { replace, isVault, suffix = 'marked' }) {
    let label, tags = [], description = '';
    if (isVault) {
      if (!privateSessionKey) throw new Error('Vault locked');
      const e = (getVaultIndex() || []).find((x) => x.id === item.id) || item;
      label = e.label; tags = e.tags || []; description = e.description || '';
    } else {
      const row = ((await db.query(`SELECT label, description FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0];
      if (!row) throw new Error('The original is no longer there');
      label = row.label; description = row.description || '';
      tags = ((await db.query(`SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ?`, [item.id])).values || []).map((r) => r.name);
    }
    const newLabel = replace ? label : `${label} (${suffix})`;
    const args = { type: 'pdf', label: newLabel, tags, description, fileData: bytesToBase64(bytes), extension: 'pdf' };
    if (isVault) await captureToVault(args); else await captureFile('pdf', args);
    if (replace) await permanentlyDelete(item.id);
    return newLabel;
  }

  // Merge and Make a PDF output (Decision 168): always a new entry, no tags or description (the sources may differ).
  async function saveComposedPdf(bytes, label, isVault) {
    const args = { type: 'pdf', label, tags: [], description: '', fileData: bytesToBase64(bytes), extension: 'pdf' };
    if (isVault) { if (!privateSessionKey) throw new Error('Vault locked'); await captureToVault(args); } else await captureFile('pdf', args);
  }

  async function openPdf(item, isVault) {
    const viewerScreen = document.getElementById('viewer-screen');
    let view = null, tools = null, token = 0, pwResolve = null;
    const arm = isVault ? armVaultAutoLock : armAppAutoLock;
    const fresh = async () => isVault
      ? ((getVaultIndex() || []).find((e) => e.id === item.id) || item)
      : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0] || item;
    // Password prompt (Decision 125): inline in the viewer, typed password kept in memory only, field emptied on use.
    const askPassword = (wasWrong, scroll) => new Promise((resolve) => {
      scroll.innerHTML = `<div class="pdf-msg pdf-pw"><div>${wasWrong ? 'Incorrect password. Try again.' : 'This PDF is password-protected.'}</div>
        <input id="pdf-pw-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Password" aria-label="PDF password">
        <button type="button" id="pdf-pw-go">Open</button>
        <button type="button" id="pdf-pw-cancel" class="secondary-btn">Cancel</button></div>`;
      const input = scroll.querySelector('#pdf-pw-input');
      const done = (value) => {
        if (!pwResolve) return;
        pwResolve = null;
        input.value = '';
        if (value !== null) scroll.innerHTML = '<div class="pdf-msg">Opening…</div>';
        resolve(value);
      };
      pwResolve = done;
      const submit = () => { if (!input.value) return; arm(); done(input.value); };
      scroll.querySelector('#pdf-pw-go').onclick = submit;
      scroll.querySelector('#pdf-pw-cancel').onclick = () => done(null);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      setTimeout(() => input.focus(), 50);
    });
    const clearHeader = () => viewerScreen.querySelectorAll('.pdf-hdr').forEach((n) => n.remove());
    // Mark-up (Decision 166): bytes are read again when it starts, so the viewer's copy (consumed by pdf.js) is not kept.
    const markupCtx = {
      isVault, onActivity: arm, askText, askYesNo, askDiscard, toast,
      // Picture tool (Decision 169): one picture from the phone's picker; resolves null when none is chosen.
      pickImage: () => new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = async () => { const f = input.files && input.files[0]; resolve(f ? new Uint8Array(await f.arrayBuffer()) : null); };
        input.addEventListener('cancel', () => resolve(null));
        beginPickerLaunch();
        input.click();
      }),
      closeViewer: () => { if (activeViewer) activeViewer.finish(); },
      loadBytes: async () => {
        if (isVault) {
          if (!privateSessionKey) throw new Error('Vault locked');
          armVaultAutoLock();
          return base64ToBytes((await loadVaultEntryContent(db, privateSessionKey, item.id)).content.fileData);
        }
        return readStoredBytes(await fresh());
      },
      save: (bytes, opts) => saveMarkedPdf(item, bytes, { ...opts, isVault })
    };
    // Page tools (Decision 167): same save route, always a new copy, label suffix chosen by the tool.
    const pagesCtx = { ...markupCtx, save: (bytes, { suffix }) => saveMarkedPdf(item, bytes, { replace: false, isVault, suffix }) };
    viewerScreen.classList.add('pdf-mode');
    await openViewer({
      title: item.label || 'PDF', isVault,
      onEdit: async () => { await editEntryUI(await fresh(), isVault); },
      guard: async () => !(tools && await tools.closeTop()), // Back closes the form or mark-up, then the Pages panel, then Find, before it leaves the viewer (Decisions 153, 166)
      onClose: () => { token++; if (pwResolve) pwResolve(null); viewerScreen.classList.remove('pdf-mode'); clearHeader(); if (tools) { tools.destroy(); tools = null; } if (view) { view.destroy(); view = null; } },
      render: async (body) => {
        const row = await fresh();
        document.getElementById('viewer-title').textContent = row.label || 'PDF';
        if (view) return; // rename only: keep the open document and its scroll position
        const mine = ++token;
        body.innerHTML = '<div class="pdf-scroll"><div class="pdf-msg">Loading…</div></div>';
        const scroll = body.querySelector('.pdf-scroll');
        let b64 = null, bytes = null, dbRow = null;
        try {
          if (isVault) {
            if (!privateSessionKey) throw new Error('Vault locked');
            armVaultAutoLock();
            const loaded = await loadVaultEntryContent(db, privateSessionKey, item.id);
            b64 = loaded.content.fileData;
          } else {
            dbRow = item.file_path ? item : ((await db.query(`SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL`, [item.id])).values || [])[0];
            if (!dbRow) throw new Error('PDF not found');
            bytes = await readStoredBytes(dbRow);
          }
          if (!bytes) bytes = base64ToBytes(b64); // Vault: the stored entry is base64 inside the encrypted record
          const { createPdfView } = await import('./pdfviewer.js');
          const next = await createPdfView(scroll, bytes, {
            onActivity: arm,
            askPassword: (wasWrong) => askPassword(wasWrong, scroll),
            onPage: (n) => { const c = viewerScreen.querySelector('.pdf-count'); if (c && view) c.textContent = `${n}/${view.pageCount}`; }
          });
          if (mine !== token || !body.isConnected) { next.destroy(); return; } // closed or locked while loading
          view = next;
          clearHeader();
          viewerScreen.querySelector('#viewer-edit-btn').parentNode.append(Object.assign(document.createElement('span'), { className: 'pdf-hdr img-count pdf-count', textContent: `1/${view.pageCount}` }));
          body.insertAdjacentHTML('beforeend', `<div class="pdf-zoom"><button type="button" class="pdf-zin" aria-label="Zoom in">+</button><button type="button" class="pdf-zout" aria-label="Zoom out">−</button></div>`);
          body.querySelector('.pdf-zin').onclick = () => { arm(); view?.zoomIn(); };
          body.querySelector('.pdf-zout').onclick = () => { arm(); view?.zoomOut(); };
          const { mountPdfTools } = await import('./pdftools.js');
          if (mine !== token || !body.isConnected) return; // closed or locked while the tools loaded
          tools = mountPdfTools(body, view, { onActivity: arm });
          try { // mark-up is an extra: if it cannot load, the reading tools stay
            const base = tools;
            const { mountMarkup } = await import('./pdfmark-ui.js');
            if (mine !== token || !body.isConnected) return;
            const mk = mountMarkup(body, view, markupCtx);
            tools = { closeTop: async () => (await mk.closeTop()) || base.closeTop(), destroy: () => { mk.destroy(); base.destroy(); } };
          } catch { /* reading tools only */ }
          try { // page tools are an extra too: if they cannot load, the tools so far stay
            const base = tools;
            const { mountPageTools } = await import('./pdfpages-ui.js');
            if (mine !== token || !body.isConnected) return;
            const pg = mountPageTools(body, view, pagesCtx);
            tools = { closeTop: async () => (await pg.closeTop()) || base.closeTop(), destroy: () => { pg.destroy(); base.destroy(); } };
          } catch { /* tools so far only */ }
        } catch (err) {
          if (mine !== token) return;
          scroll.innerHTML = `<div class="pdf-msg">${escapeHtml(pdfErrorMessage(err))}<button type="button" class="pdf-fallback">Open with app</button></div>`;
          scroll.querySelector('.pdf-fallback').onclick = async () => {
            try {
              if (isVault) { if (!b64) throw new Error('Vault locked'); await openDecryptedFile(item.id, 'pdf', b64); }
              else if (dbRow) await openStoredFile(dbRow);
            } catch (e2) { toast(String(e2.message || e2)); }
          };
        }
      }
    });
  }

  // Tapping a row opens it. Text, reminder, location, voice, image and PDF have viewers; a file opens in the phone's app.
  async function openEntry(id, isVault, known = null) {
    let item = known;
    if (!item) {
      item = isVault
        ? (getVaultIndex() || []).find((e) => e.id === id)
        : ((await db.query(`SELECT * FROM entries WHERE id=? AND deleted_at IS NULL`, [id])).values || [])[0];
    }
    if (!item) return;
    if (item.type === 'note') await openNote(item, isVault);
    else if (item.type === 'money' || (item.type === 'expense' && !isVault)) await openMoney(item, isVault);
    else if (item.type === 'reminder') await openReminder(item, isVault);
    else if (item.type === 'location') await openLocation(item, isVault);
    else if (item.type === 'voice') await openVoice(item, isVault);
    else if (item.type === 'image') await openImageViewer([item], 0, isVault);
    else if (item.type === 'file') await openFile(item, isVault);
    else if (item.type === 'pdf') {
      if ((await metaGet('pdf_inapp_viewer', 'on')) === 'on') await openPdf(item, isVault); // off: the phone's own PDF app (Decision 148)
      else await openFile(item, isVault);
    }
    else toast(`Opening ${typeLabelFor(item.type).toLowerCase()} entries is coming in a later step.`);
  }

  // ---- Search (Decision 146): a full-screen layer that grows out of its tile, with type filter, period and sort ----
  const searchState = { type: 'all', sort: 'default', period: 'any' };
  const SEARCH_SORTS = [['default', 'Best match'], ['new', 'Newest'], ['old', 'Oldest'], ['az', 'Name A–Z'], ['za', 'Name Z–A'], ['type', 'Type']];
  const sDate = (r) => (searchMode === 'vault' ? r.createdAt : r.created_at);
  function drawSearch() {
    const term = document.getElementById('search-input').value;
    const toolbar = document.getElementById('search-toolbar'), timeline = document.getElementById('timeline');
    if (!term) { // entries live in their folders; this list is search results only (Decision 81)
      toolbar.innerHTML = '';
      timeline.innerHTML = `<div class="empty-state">${iconSvg('search')}<strong>Search everything</strong><span>${searchMode === 'vault' ? 'Names, text, tags and notes in the Vault.' : 'Names, text, tags and notes.'}</span></div>`;
      return;
    }
    const types = typeCounts(searchRows, browseType, VAULT_TYPES);
    if (searchState.type !== 'all' && !types.some((t) => t.type === searchState.type)) searchState.type = 'all';
    toolbar.innerHTML = searchRows.length
      ? toolbarHtml({ types, total: searchRows.length, type: searchState.type, labelOf: typeLabelFor, sorts: SEARCH_SORTS, sort: searchState.sort, periods: PERIODS, period: searchState.period }) : '';
    const rows = browse(searchRows, { ...searchState, dateOf: sDate, nameOf: (r) => r.label, typeOf: browseType, typeOrder: VAULT_TYPES });
    const inVault = searchMode === 'vault';
    timeline.innerHTML = rows.map((row) => entryRowHtml(inVault ? vaultRowProps(row) : {
      id: row.id, type: row.type, label: row.label, tags: row.tags, ext: row.extension, ...rowMeta(row)
    })).join('') || emptyStateHtml('search');
    timeline.querySelectorAll('.entry-row').forEach((r) => r.addEventListener('click', async () => {
      await openEntry(r.dataset.id, inVault, rows.find((x) => x.id === r.dataset.id));
      if (inVault && privateSessionKey) renderVault();
    }));
    paintSelection();
  }
  bindToolbar(document.getElementById('search-toolbar'), searchState, drawSearch);
  document.getElementById('search-input').addEventListener('input', async (e) => {
    const term = e.target.value;
    if (searchMode === 'vault') { runVaultSearch(); return; }
    searchRows = [];
    if (term) {
      try { searchRows = await searchEntries(db, term); } catch { /* an unreadable query shows no results */ }
      await loadCurrencySymbol();
    }
    drawSearch();
  });
  document.getElementById('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); }); // Enter lowers the keyboard so the results are all in view
  document.getElementById('open-search-btn').addEventListener('click', (e) => {
    searchRows = [];
    Object.assign(searchState, { type: 'all', sort: 'default', period: 'any' });
    document.getElementById('search-input').value = '';
    drawSearch();
    openSearchScreen(e.currentTarget);
  });
  document.getElementById('search-close-btn').addEventListener('click', () => closeSearchScreen());

  // Auto-biometric on the app-open lock screen (Decision 56/58) — deliberately the very last
  // thing in this handler. Everything above (settings population, all button/tab wiring) is fully
  // done by the time this line runs, so there is no remaining DOMContentLoaded work left for the
  // biometric flow's own database calls to race against. The short delay on top is a buffer for
  // Android's window-focus timing (the original concern) — an estimate, not a measured value.
  if (window.biometricUnlockAvailable) setTimeout(() => window.tryBiometricUnlockApp(), 300);
});