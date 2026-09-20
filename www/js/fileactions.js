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
  buildBackupPayload, decryptBackupPayload, restoreBackup
} from './backup.js';
import { encryptBackup } from './crypto.js';

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
// opts: { passphrase?: string, pin?: string } — exactly one applies, chosen by the entry's category:
// private notes require `pin` (no toggle, per spec); anything else uses `passphrase` if given, else
// the app-level default. Passing both or neither for the wrong category is a caller error, not
// silently resolved here.
async function downloadForAppend(db, entryId, opts = {}) {
  const { cat } = await getEntryCategory(db, entryId);
  let chosenPassphrase, mode;

  if (cat === 'private_notes') {
    if (!opts.pin) throw new Error('Private notes require the private-notes PIN — no default/optional path');
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

  const label = payload.entries[0]?.label || 'entry';
  const fileName = `${sanitizeFilename(label)}.zip`;
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
// files: FileList/array of browser File objects (from <input type="file" multiple accept=".zip">)
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
// Action 1 — Share. Private notes get Copy-to-clipboard instead, never Share (spec, §5 point 1).
// ---------------------------------------------------------------------------
async function shareEntry(db, entryId) {
  const { row, cat } = await getEntryCategory(db, entryId);
  if (cat === 'private_notes') throw new Error('Private notes use copyPrivateNote(), not shareEntry()');

  if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
    const { uri } = await Filesystem.getUri({ path: row.file_path, directory: Directory.Data });
    await Share.share({ url: uri, title: row.label });
  } else {
    await Share.share({ text: row.body_text || row.label, title: row.label });
  }
}

// One-time notice tracked in meta (see app.js's metaGet/metaSet) — caller checks/sets
// 'private_copy_notice_shown' before calling this; kept here as just the copy+auto-clear mechanics.
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
// Action 3 — Download (plain). Unencrypted, filename is the entry's label, not its UUID. Not for
// private notes (spec, §5 point 3 — they get Copy only, same restriction as Share).
// ---------------------------------------------------------------------------
async function downloadPlain(db, entryId) {
  const { row, cat } = await getEntryCategory(db, entryId);
  if (cat === 'private_notes') throw new Error('Private notes have no plain download — use copyPrivateNote()');

  const ext = row.extension ? `.${row.extension}` : (FILE_BEARING_CATEGORIES.has(cat) ? '' : '.txt');
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
// Private note edits require the session already PIN-unlocked (caller passes the live session key).
// ---------------------------------------------------------------------------
async function editEntry(db, entryId, fields, { privateSessionKey = null, rescheduleReminder = null } = {}) {
  const { row, cat } = await getEntryCategory(db, entryId);
  const updates = { ...fields, updated_at: Date.now() };

  if (cat === 'private_notes' && fields.body_text !== undefined) {
    if (!privateSessionKey) throw new Error('Private notes locked — unlock with PIN before editing');
    const { encryptPrivateNote } = await import('./crypto.js');
    updates.encrypted_body = await encryptPrivateNote(privateSessionKey, fields.body_text);
    delete updates.body_text; // private notes never carry plaintext in body_text
  }

  const setClause = Object.keys(updates).map((k) => `${k}=?`).join(', ');
  await db.run(`UPDATE entries SET ${setClause} WHERE id=?`, [...Object.values(updates), entryId]);

  if (!row.is_private && updates.label !== undefined) {
    await db.run(`UPDATE entries_fts SET label=? WHERE id=?`, [updates.label, entryId]);
  }
  if (cat === 'reminders' && (fields.fire_at !== undefined || fields.repeat_rule !== undefined) && rescheduleReminder) {
    await rescheduleReminder({ ...row, ...updates, id: entryId }); // caller supplies notifications.js's scheduleReminder
  }
}

// ---------------------------------------------------------------------------
// Action 5 — Delete. Already exists as db.js's softDelete(); re-exported here only so every
// per-file action is reachable from one module, not because the logic lives here.
// ---------------------------------------------------------------------------
export { softDelete as deleteEntry } from './db.js';

export {
  APP_DEFAULT_PASSPHRASE,
  downloadForAppend, importAppendZips,
  shareEntry, copyPrivateNote,
  downloadPlain, editEntry
};
