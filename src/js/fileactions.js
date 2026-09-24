// fileactions.js — the five per-entry actions (ARCHITECTURE.md §5). Download-for-append and its
// import screen are the substantial new pieces here; they reuse backup.js's exact
// buildBackupPayload/encryptBackup/decryptBackupPayload/restoreBackup pipeline scoped to one entry
// at a time, rather than inventing a second encryption/dedup scheme to keep in sync with the first.
//
// Zip library: @zip.js/zip.js — chosen over JSZip (Decision 33): JSZip's last release was 2022 and
// its maintenance score has since gone to zero, while zip.js ships regular releases, has zero
// dependencies, and is TypeScript-typed. Both work fine in a plain browser/WebView context; only one
// of them is still actually maintained.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import {
  ENTRY_CATEGORIES, FILE_BEARING_CATEGORIES,
  buildBackupPayload, decryptBackupPayload, restoreBackup, backupFileName
} from './backup.js';
import { encryptBackup } from './crypto.js';
import { loadVaultEntryContent, saveVaultEntry, base64ToBlobUrl, buildVaultPlaintext } from './vault.js';

// Not a secret, not meant to be one — see ARCHITECTURE.md §5 point 2. Every Dumpzone install embeds
// this same value, so a default-encrypted export is only ever obfuscated against casual viewing,
// never protected against another copy of this app. The UI must say so; this constant doesn't.
const APP_DEFAULT_PASSPHRASE = 'dumpzone-v1-default-export-key-not-a-secret-do-not-rely-on-this';

const ZIP_ENTRY_NAME = 'dumpzone-entry.json';

async function getEntryCategory(db, entryId) {
  const row = (await db.query(`SELECT * FROM entries WHERE id=?`, [entryId])).values[0];
  if (!row) throw new Error('Entry not found');
  const cat = Object.keys(ENTRY_CATEGORIES).find((c) => ENTRY_CATEGORIES[c](row));
  return { row, cat };
}

function sanitizeFilename(label) {
  return (label || 'untitled').replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 80);
}

// ---------------------------------------------------------------------------
// Action 2 — Download for append. One entry, wrapped in the exact same archive format a full
// backup uses, scoped via buildBackupPayload's entryIds filter — see backup.js.
// ---------------------------------------------------------------------------
// opts: { passphrase?: string, pin?: string } — exactly one applies, chosen by whether the entry is
// in the Private Vault (row.is_private, any type): vault entries require `pin`, no toggle, same as
// before this pivot generalized "private notes" to "any vault type"; anything else uses `passphrase`
// if given, else the app-level default. Passing both or neither for the wrong kind is a caller error.
async function downloadForAppend(db, entryId, opts = {}) {
  const { row, cat } = await getEntryCategory(db, entryId);
  let chosenPassphrase, mode;

  if (row.is_private) {
    if (!opts.pin) throw new Error('Private Vault entries require the vault PIN — no default/optional path');
    chosenPassphrase = opts.pin;
    mode = 'pin';
  } else if (opts.passphrase) {
    chosenPassphrase = opts.passphrase;
    mode = 'passkey';
  } else {
    chosenPassphrase = APP_DEFAULT_PASSPHRASE;
    mode = 'default';
  }

  const payload = await buildBackupPayload(db, [cat], [entryId]);
  const archive = await encryptBackup(chosenPassphrase, JSON.stringify(payload), '');
  archive.mode = mode; // unencrypted, alongside the existing salt/hint fields — tells import what to prompt for

  const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
  await zipWriter.add(ZIP_ENTRY_NAME, new TextReader(JSON.stringify(archive)));
  const blob = await zipWriter.close();

  // Uses the same backup_/append_<letters>_<timestamp>.dz naming as full backups (Decision 55),
  // scoped to this one entry's category — trades the old label-based filename (which made two
  // exports of the same entry, or two entries with the same label, unambiguous at a glance) for a
  // consistent, predictable format across every exported file. Two exports of the same category
  // within the same second would collide on name; accepted as a rare edge case, not solved here.
  const fileName = backupFileName('append', [cat]);
  const base64 = await blobToBase64(blob);
  await Filesystem.writeFile({ path: fileName, directory: Directory.Cache, data: base64, recursive: true });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

  return { path: fileName, uri, mode };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// "Append files from download" — multi-select import, one shared dedup engine (backup.js's
// restoreBackup) regardless of whether the source is a full backup or a batch of these zips.
// Always append mode — this screen has no overwrite option, matching its "additive" framing in
// ARCHITECTURE.md §5; overwrite stays exclusive to the dedicated local/Drive restore flows.
// ---------------------------------------------------------------------------
// files: FileList/array of browser File objects (from <input type="file" multiple accept=".dz,.zip">)
// getters: { passphraseGetter(hint), pinGetter() } — called only for zips whose mode needs them;
// a 'default'-mode zip never prompts. Both may return null to skip that one file.
async function importAppendZips(db, files, getters) {
  const report = { filesProcessed: 0, added: 0, skippedExactDup: 0, restoredLabeled: 0, errors: [] };

  for (const file of Array.from(files)) {
    try {
      const zipReader = new ZipReader(new BlobReader(file));
      const entries = await zipReader.getEntries();
      const jsonEntry = entries.find((e) => e.filename === ZIP_ENTRY_NAME);
      if (!jsonEntry) throw new Error('Not a Dumpzone export (missing dumpzone-entry.json)');
      const archiveText = await jsonEntry.getData(new TextWriter());
      await zipReader.close();
      const archive = JSON.parse(archiveText);

      let passphrase;
      if (archive.mode === 'default') passphrase = APP_DEFAULT_PASSPHRASE;
      else if (archive.mode === 'pin') passphrase = await getters.pinGetter();
      else passphrase = await getters.passphraseGetter(archive.hint);
      if (!passphrase) { report.errors.push({ file: file.name, error: 'skipped — no passphrase supplied' }); continue; }

      const payload = await decryptBackupPayload(passphrase, archive); // throws on wrong passphrase/PIN
      const result = await restoreBackup(db, {
        passphrase, archiveObj: archive, mode: 'append', categories: payload.categories
      });
      report.filesProcessed += 1;
      if (result.ok) {
        report.added += result.summary.added;
        report.skippedExactDup += result.summary.skippedExactDup;
        report.restoredLabeled += result.summary.restoredLabeled;
      } else {
        report.errors.push({ file: file.name, error: result.reason });
      }
    } catch (err) {
      report.errors.push({ file: file.name, error: err.message || String(err) });
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Action 1 — Share. Works identically for vault and non-vault entries (pivot: user convenience over
// restriction — content is decrypted only into memory first for vault items, never written to disk
// unencrypted; a one-time notice in the UI should say sharing/downloading a vault item means it
// leaves the vault's encryption boundary as plaintext from that point on, same as Download below).
// ---------------------------------------------------------------------------
async function shareEntry(db, entryId, { privateSessionKey = null } = {}) {
  const { row, cat } = await getEntryCategory(db, entryId);

  if (row.is_private) {
    if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before sharing');
    const { content } = await loadVaultEntryContent(db, privateSessionKey, entryId);
    if (row.type === 'note') {
      await Share.share({ text: content.text, title: row.label });
    } else {
      const blobUrl = base64ToBlobUrl(content.fileData, mimeTypeFor(row));
      try { await Share.share({ url: blobUrl, title: row.label }); }
      finally { URL.revokeObjectURL(blobUrl); }
    }
    return;
  }

  if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
    const { uri } = await Filesystem.getUri({ path: row.file_path, directory: Directory.Data });
    await Share.share({ url: uri, title: row.label });
  } else {
    await Share.share({ text: row.body_text || row.label, title: row.label });
  }
}

function mimeTypeFor(row) {
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
  return byExt[row.extension] || (row.type === 'image' ? 'image/jpeg' : row.type === 'pdf' ? 'application/pdf'
    : row.type === 'voice' ? 'audio/mp4' : 'application/octet-stream');
}

// Extra convenience alongside Share/Download now that both work for vault items too (not a
// replacement for either anymore) — quick clipboard copy for vault note text specifically.
async function copyPrivateNote(plaintext, clearAfterMs = 45000) {
  await navigator.clipboard.writeText(plaintext);
  setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === plaintext) await navigator.clipboard.writeText(''); // don't clobber whatever they copied since
    } catch { /* clipboard read can be denied by the OS — nothing to do about it from here */ }
  }, clearAfterMs);
}

// ---------------------------------------------------------------------------
// Action 3 — Download (plain). Unencrypted, filename is the entry's label, not its UUID. Works for
// vault entries too (pivot) — decrypted into memory first, written out as plain bytes only at the
// point the person explicitly asked for a plaintext copy outside the vault.
// ---------------------------------------------------------------------------
async function downloadPlain(db, entryId, { privateSessionKey = null } = {}) {
  const { row, cat } = await getEntryCategory(db, entryId);
  const ext = row.extension ? `.${row.extension}` : (row.type === 'note' ? '.txt' : '');

  if (row.is_private) {
    if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before downloading');
    const { content } = await loadVaultEntryContent(db, privateSessionKey, entryId);
    const fileName = `${sanitizeFilename(row.label)}${ext}`;
    if (row.type === 'note') {
      await Filesystem.writeFile({ path: fileName, directory: Directory.Documents, data: content.text, encoding: 'utf8', recursive: true });
    } else {
      await Filesystem.writeFile({ path: fileName, directory: Directory.Documents, data: content.fileData, recursive: true });
    }
    return fileName;
  }

  const fileName = `${sanitizeFilename(row.label)}${ext}`;
  if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
    const { data } = await Filesystem.readFile({ path: row.file_path, directory: Directory.Data });
    await Filesystem.writeFile({ path: fileName, directory: Directory.Documents, data, recursive: true });
  } else {
    await Filesystem.writeFile({
      path: fileName, directory: Directory.Documents, data: row.body_text || '', encoding: 'utf8', recursive: true
    });
  }
  return fileName;
}

// ---------------------------------------------------------------------------
// Action 4 — Edit. Reminders must reschedule their notification, not just update the row silently.
// Vault entries of ANY type require the session already PIN-unlocked to edit content (label/tags-only
// edits don't need the session — they're never encrypted in the first place).
// ---------------------------------------------------------------------------
async function editEntry(db, entryId, fields, { privateSessionKey = null, rescheduleReminder = null } = {}) {
  const { row, cat } = await getEntryCategory(db, entryId);
  const contentFieldsChanged = fields.text !== undefined || fields.fileData !== undefined || fields.ocrText !== undefined;

  if (row.is_private && contentFieldsChanged) {
    if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before editing');
    const { content: existing } = await loadVaultEntryContent(db, privateSessionKey, entryId);
    const merged = { ...existing, ...fields }; // partial edits (e.g. just a corrected OCR text) keep the rest
    const plaintext = buildVaultPlaintext(row.type, merged);
    const { encryptPrivateNote } = await import('./crypto.js');
    const encryptedBody = await encryptPrivateNote(privateSessionKey, plaintext);
    await db.run(`UPDATE entries SET encrypted_body=?, updated_at=? WHERE id=?`, [encryptedBody, Date.now(), entryId]);
  }

  const updates = { updated_at: Date.now() };
  if (fields.label !== undefined) updates.label = fields.label;
  // Non-vault notes: accept the same `fields.text` name the vault side uses, mapped to the
  // body_text column here — was previously only accepting `fields.body_text`, a mismatch that
  // meant calling this consistently from one UI would silently no-op whichever side didn't match.
  if (!row.is_private && cat === 'notes' && fields.text !== undefined) updates.body_text = fields.text;
  // Expense/reminder-specific fields — these were previously never actually written to the row at
  // all (only checked, further down, to decide whether to call rescheduleReminder), so editing a
  // reminder's time or an expense's amount silently did nothing before this fix.
  for (const key of ['amount', 'expense_category', 'fire_at', 'repeat_rule']) {
    if (fields[key] !== undefined) updates[key] = fields[key];
  }

  const setClause = Object.keys(updates).map((k) => `${k}=?`).join(', ');
  await db.run(`UPDATE entries SET ${setClause} WHERE id=?`, [...Object.values(updates), entryId]);

  // entries_fts/label_history only exist for non-vault entries in the first place (db.js/vault.js
  // both deliberately skip them for is_private=1) — so only touch them for non-vault label edits.
  if (!row.is_private && updates.label !== undefined) {
    await db.run(`UPDATE entries_fts SET label=? WHERE id=?`, [updates.label, entryId]);
  }
  if (!row.is_private && updates.body_text !== undefined) {
    await db.run(`UPDATE entries_fts SET body_text=? WHERE id=?`, [updates.body_text, entryId]);
  }
  if (cat === 'reminders' && (fields.fire_at !== undefined || fields.repeat_rule !== undefined) && rescheduleReminder) {
    await rescheduleReminder({ ...row, ...updates, id: entryId }); // caller supplies notifications.js's scheduleReminder
  }
}

// ---------------------------------------------------------------------------
// Action 5 — Delete. Already exists as db.js's softDelete(); re-exported here only so every
// per-file action is reachable from one module, not because the logic lives here. Works identically
// for vault and non-vault — vault items land in the vault's own trash bin, same 30-day rule, just
// filtered by is_private (see db.js's listTrash()) rather than a second table.
// ---------------------------------------------------------------------------
export { softDelete as deleteEntry } from './db.js';

// ---------------------------------------------------------------------------
// "Select files" screen support — groups entries by category with a size next to each, so a
// category can be selected as a whole or picked apart item by item. Bulk actions (Share, Download,
// Download for append, Delete — Edit stays per-item only, bulk-editing doesn't make sense) just
// loop the same four functions above; nothing new to keep in sync with them.
// ---------------------------------------------------------------------------
async function getSelectableEntries(db, { vaultIndex = null } = {}) {
  const rows = (await db.query(`SELECT * FROM entries WHERE deleted_at IS NULL AND is_private=0`)).values || [];
  const groups = {};
  for (const row of rows) {
    const cat = Object.keys(ENTRY_CATEGORIES).find((c) => c !== 'private_vault' && ENTRY_CATEGORIES[c](row));
    if (!cat) continue;
    let sizeBytes = 0;
    if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
      try { sizeBytes = (await Filesystem.stat({ path: row.file_path, directory: Directory.Data })).size; }
      catch { sizeBytes = 0; } // file missing/unreadable — still list the entry, just with an unknown size
    } else if (row.body_text) {
      sizeBytes = new Blob([row.body_text]).size;
    }
    (groups[cat] = groups[cat] || []).push({ id: row.id, label: row.label, type: row.type, sizeBytes });
  }
  // Vault items come from the already-decrypted in-memory index (vault.js) — never re-decrypt here
  // just to compute a size that index already has.
  if (vaultIndex) {
    groups.private_vault = vaultIndex.map((e) => ({ id: e.id, label: e.label, type: e.type, sizeBytes: e.sizeBytes }));
  }
  return groups;
}

// action: 'share' | 'download' | 'download_append' | 'delete'. Runs sequentially, not in parallel —
// Share in particular opens one native share sheet per item since Capacitor's Share plugin has no
// multi-file share of its own; a known UX limitation for large selections, not something to paper
// over with an invented multi-file bundle format.
async function runBulkAction(db, action, entryIds, opts = {}) {
  const results = [];
  for (const id of entryIds) {
    try {
      if (action === 'share') await shareEntry(db, id, opts);
      else if (action === 'download') await downloadPlain(db, id, opts);
      else if (action === 'download_append') await downloadForAppend(db, id, opts);
      else if (action === 'delete') { const { softDelete } = await import('./db.js'); await softDelete(db, id); }
      else throw new Error(`Unknown bulk action: ${action}`);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err.message || String(err) });
    }
  }
  return results;
}

export {
  APP_DEFAULT_PASSPHRASE,
  downloadForAppend, importAppendZips,
  shareEntry, copyPrivateNote,
  downloadPlain, editEntry,
  getSelectableEntries, runBulkAction
};
