// gdrive.js — optional, opt-in Google Drive backup (Decisions 25-29). Same encrypted archive
// format as backup.js (Decision 28); Drive is a second destination, never a replacement for it.
//
// Auth model: drive.file scope only (Decision 26) via @codetrix-studio/capacitor-google-auth.
// No serverAuthCode/refresh-token exchange is implemented here — GoogleAuth.signIn() is called
// fresh, in the foreground, whenever Drive access is needed; the native Android SDK returns
// cached consent silently (no UI) if the user already granted it and their device Google session
// is still valid, so there is no token-store of our own to manage or secure.
//
// Auto-backup is deliberately NOT built on @capacitor/background-runner: that plugin's headless
// JS environment exposes only console/fetch/crypto/timers plus CapacitorDevice, CapacitorKV
// (simple string k/v, not SQLite), CapacitorNotifications, CapacitorGeolocation — no SQLite, no
// Filesystem. It cannot read the entries table or captured files, so it cannot build a backup
// payload at all (confirmed against Capacitor 6 docs, not assumed). Auto-backup instead runs a
// check on app open/resume (see checkAndRunAutoBackupIfDue), fully in the normal foreground
// context where SQLite/Filesystem/network all work exactly as they do everywhere else in the app.

import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import {
  buildBackupPayload, estimateBackupSize, decryptBackupPayload, restoreBackup
} from './backup.js';
import { encryptBackup } from './crypto.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_FOLDER_NAME = 'Dumpzone Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// ---------------------------------------------------------------------------
// Auth — silent when already consented, prompts only the first time.
// ---------------------------------------------------------------------------
async function ensureSignedIn({ silent = false } = {}) {
  try {
    const user = await GoogleAuth.signIn(); // native SDK returns cached consent without UI if valid
    return { ok: true, accessToken: user.authentication.accessToken, email: user.email };
  } catch (err) {
    if (silent) return { ok: false, reason: 'not_signed_in' }; // auto-backup path — never surface a prompt
    throw err; // manual "Connect Google Drive" button — let the caller's UI show the real error
  }
}

async function signOut() {
  await GoogleAuth.signOut();
}

// ---------------------------------------------------------------------------
// Low-level Drive REST helpers
// ---------------------------------------------------------------------------
async function driveFetch(accessToken, path, opts = {}) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(`Drive API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getOrCreateBackupFolder(accessToken) {
  const q = encodeURIComponent(
    `name='${BACKUP_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`
  );
  const found = await driveFetch(accessToken, `/files?q=${q}&fields=files(id,name)`);
  if (found.files && found.files.length > 0) return found.files[0].id;

  const created = await driveFetch(accessToken, '/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME })
  });
  return created.id;
}

// Drive's reported quota. limit is absent/null for unlimited-storage accounts — treat as "no cap".
async function getDriveStorageEstimate(accessToken) {
  const info = await driveFetch(accessToken, '/about?fields=storageQuota');
  const q = info.storageQuota || {};
  if (!q.limit) return { availableBytes: null };
  return { availableBytes: Math.max(0, Number(q.limit) - Number(q.usage || 0)) };
}

// ---------------------------------------------------------------------------
// Backup — same archive format as backup.js's createBackup, uploaded instead of written locally.
// ---------------------------------------------------------------------------
async function backupToDrive(db, { passphrase, hint = '', categories, fileName, silent = false }) {
  const auth = await ensureSignedIn({ silent });
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const required = await estimateBackupSize(db, categories);
  const { availableBytes } = await getDriveStorageEstimate(auth.accessToken);
  if (availableBytes !== null && required > availableBytes) {
    return { ok: false, reason: 'insufficient_drive_storage', requiredBytes: required, availableBytes };
  }

  const payload = await buildBackupPayload(db, categories);
  const archive = await encryptBackup(passphrase, JSON.stringify(payload), hint);
  const name = fileName || `dumpzone-backup-${Date.now()}.dzbackup`;
  const folderId = await getOrCreateBackupFolder(auth.accessToken);

  const boundary = 'dumpzone-boundary';
  const metadata = { name, parents: [folderId], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(archive)}\r\n--${boundary}--`;

  const uploadRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!uploadRes.ok) return { ok: false, reason: 'upload_failed', detail: await uploadRes.text() };
  const uploaded = await uploadRes.json();

  await db.run(`UPDATE credentials SET last_drive_backup_at = ? WHERE id = 1`, [Date.now()]);
  return { ok: true, fileId: uploaded.id, name, requiredBytes: required };
}

async function listDriveBackups(accessToken) {
  const folderId = await getOrCreateBackupFolder(accessToken);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    accessToken, `/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime,size)`
  );
  return res.files || [];
}

async function downloadBackupFromDrive(accessToken, fileId) {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return res.json(); // the encrypted archive object — same shape openBackupFile() returns locally
}

// Read-only peek (categories, timestamp, hint) without restoring anything — mirrors backup.js's
// own open/decrypt split so the UI can show "this backup has: Notes, Images... from 3 days ago"
// before committing to append/overwrite.
async function previewDriveBackup(accessToken, fileId, passphrase) {
  const archiveObj = await downloadBackupFromDrive(accessToken, fileId);
  const payload = await decryptBackupPayload(passphrase, archiveObj);
  return { categories: payload.categories, createdAt: payload.createdAt, hint: archiveObj.hint };
}

// Thin wrapper: fetch the archive from Drive, then hand off to backup.js's own restoreBackup so
// append/overwrite/dedup/tag-restore logic exists in exactly one place regardless of source.
async function restoreFromDrive(db, { accessToken, fileId, ...restoreOpts }) {
  const archiveObj = await downloadBackupFromDrive(accessToken, fileId);
  return restoreBackup(db, { ...restoreOpts, archiveObj });
}

// ---------------------------------------------------------------------------
// Auto-backup — checked on app open/resume, not via OS-level background scheduling (see file header).
// Settings (enabled/frequency) live in the meta table alongside dark_mode etc. (App Settings category);
// last_drive_backup_at lives on credentials, same place last_backup_at (local) already does.
// ---------------------------------------------------------------------------
const FREQUENCY_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };

async function checkAndRunAutoBackupIfDue(db, { passphraseGetter, categories }) {
  const enabledRow = (await db.query(`SELECT value FROM meta WHERE key='auto_backup_enabled'`)).values || [];
  if (enabledRow.length === 0 || enabledRow[0].value !== 'true') return { ok: true, skipped: 'disabled' };

  const freqRow = (await db.query(`SELECT value FROM meta WHERE key='auto_backup_frequency'`)).values || [];
  const frequency = freqRow[0]?.value || 'weekly';
  const interval = FREQUENCY_MS[frequency] || FREQUENCY_MS.weekly;

  const cred = (await db.query(`SELECT last_drive_backup_at FROM credentials WHERE id=1`)).values[0];
  const last = cred?.last_drive_backup_at || 0;
  if (Date.now() - last < interval) return { ok: true, skipped: 'not_due' };

  const passphrase = await passphraseGetter(); // caller supplies the backup passkey from wherever it's held
  if (!passphrase) return { ok: true, skipped: 'no_passphrase' }; // never prompt mid-flow on a passive check

  return backupToDrive(db, { passphrase, categories, hint: 'auto-backup', silent: true });
}

export {
  ensureSignedIn, signOut,
  getDriveStorageEstimate, backupToDrive,
  listDriveBackups, downloadBackupFromDrive, previewDriveBackup, restoreFromDrive,
  checkAndRunAutoBackupIfDue
};
