// fileactions.js — the four per-entry actions (ARCHITECTURE.md §5), in UI order: Edit, Share, Download, Delete,
// plus the "Select files" bulk support. Download-for-append and its import screen were removed
// (Decision 83).

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  ENTRY_CATEGORIES, FILE_BEARING_CATEGORIES
} from './backup.js';
import { loadVaultEntryContent, saveVaultEntry, updateVaultFileContent, base64ToBlobUrl, buildVaultPlaintext } from './vault.js';
import { VAULT_PLACEHOLDER_LABEL } from './db.js';
import * as Money from './money.js';
import { initFiles, readBase64, fileSize } from './files.js';
import { plainUriFor, mimeForExtension } from './fileopen.js';
import { repeatLabel } from './reminders.js';

async function getEntryCategory(db, entryId) {
  const row = (await db.query(`SELECT * FROM entries WHERE id=?`, [entryId])).values[0];
  if (!row) throw new Error('Entry not found');
  const cat = Object.keys(ENTRY_CATEGORIES).find((c) => ENTRY_CATEGORIES[c](row));
  return { row, cat };
}

function sanitizeFilename(label) {
  return (label || 'untitled').replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 80);
}

// Every download lands in Download/Arkly on the phone (Decision 278). An existing name gets " (2)", " (3)" … so an earlier copy is never overwritten.
const DOWNLOAD_DIR = 'Download/Arkly';
const DOWNLOAD_ROOT = Directory.ExternalStorage;
async function freeDownloadPath(fileName) {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  for (let n = 1; n < 100; n++) {
    const path = `${DOWNLOAD_DIR}/${n === 1 ? stem : `${stem} (${n})`}${ext}`;
    try { await Filesystem.stat({ path, directory: DOWNLOAD_ROOT }); } // throws when the file does not exist
    catch { return path; }
  }
  return `${DOWNLOAD_DIR}/${stem} (${Date.now()})${ext}`;
}

// Plain-text bodies for entries whose content is not text in the row (Location, Reminder, Money).
const stamp = (ms) => new Date(ms).toLocaleString();
function locationPlainText(row) {
  const lines = [row.label];
  if (row.latitude != null && row.longitude != null) lines.push(`Coordinates: ${row.latitude}, ${row.longitude}`, `Map: ${mapLinkFor(row.latitude, row.longitude)}`);
  lines.push(`Saved: ${stamp(row.created_at)}`);
  if (row.description) lines.push(`Note: ${row.description}`);
  return lines.join('\n');
}
function reminderPlainText(row) {
  const lines = [row.label, `Remind at: ${stamp(row.fire_at)}`, `Repeat: ${repeatLabel(row.repeat_rule)}`];
  lines.push(row.completed_at ? `Done: ${stamp(row.completed_at)}` : 'Status: not done');
  if (row.description) lines.push(`Note: ${row.description}`);
  return lines.join('\n');
}
function moneyRowPlainText(row) {
  const d = Money.fromRow(row);
  return d ? `${moneyPlainText(d)}${row.description ? `\nNote: ${row.description}` : ''}` : row.label;
}
// A Vault entry's note is encrypted in its own column; decrypted here for Share and Download so they match Home (Decision 143).
async function vaultNote(row, key) {
  if (!row.encrypted_description) return '';
  const { decryptPrivateNote, fieldAad } = await import('./crypto.js');
  try { return await decryptPrivateNote(key, row.encrypted_description, fieldAad(row.id, 'desc')); } catch { return ''; }
}
const withNote = (text, note) => (note ? `${text}\nNote: ${note}` : text);
const TEXT_EXPORT_TYPES = new Set(['note', 'location', 'reminder', 'money', 'expense']); // 'expense': legacy rows from before Decision 131

// ---------------------------------------------------------------------------
// Action 1 — Share. Works identically for vault and non-vault entries (pivot: user convenience over
// restriction — content is decrypted only into memory first for vault items, never written to disk
// unencrypted; a one-time notice in the UI should say sharing/downloading a vault item means it
// leaves the vault's encryption boundary as plaintext from that point on, same as Download below).
// ---------------------------------------------------------------------------
async function shareEntry(db, entryId, { privateSessionKey = null } = {}) {
  initFiles(db);
  const { row, cat } = await getEntryCategory(db, entryId);

  if (row.is_private) {
    if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before sharing');
    const loaded = await loadVaultEntryContent(db, privateSessionKey, entryId);
    const content = loaded.content;
    row.label = loaded.row.label; // the stored label is a placeholder (Decision 145)
    if (row.type === 'note') {
      await Share.share({ text: content.text, title: row.label });
    } else if (row.type === 'money') {
      if (!content.money) throw new Error('This entry has no readable amount.');
      await Share.share({ text: withNote(moneyPlainText(content.money), await vaultNote(row, privateSessionKey)), title: row.label });
    } else if (row.type === 'reminder') {
      await Share.share({ text: reminderPlainText({ ...row, description: await vaultNote(row, privateSessionKey) }), title: row.label });
    } else if (row.type === 'location') { // same text as Home: name and map link, built from the decrypted coordinates (Decision 142)
      if (!content.location) throw new Error('This entry has no readable coordinates.');
      await Share.share({ text: withNote(`${row.label}\n${mapLinkFor(content.location.latitude, content.location.longitude)}`, await vaultNote(row, privateSessionKey)), title: row.label });
    } else {
      const blobUrl = base64ToBlobUrl(content.fileData, mimeTypeFor(row));
      try { await Share.share({ url: blobUrl, title: row.label }); }
      finally { URL.revokeObjectURL(blobUrl); }
    }
    return;
  }

  if (row.type === 'location' && row.latitude != null && row.longitude != null) {
    // Plain text with a map link built from the stored coordinates — no network call; the
    // recipient's device resolves the link. Shared only when this action is invoked.
    await Share.share({ text: withNote(`${row.label}\n${mapLinkFor(row.latitude, row.longitude)}`, row.description), title: row.label });
  } else if (row.type === 'reminder') { // name, time, repeat, status and note, as in the Vault (Decision 143)
    await Share.share({ text: reminderPlainText(row), title: row.label });
  } else if (row.type === 'money' || row.type === 'expense') { // full details and the note, as in the Vault (Decision 143)
    await Share.share({ text: moneyRowPlainText(row), title: row.label });
  } else if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
    await Share.share({ url: await plainUriFor(row), title: row.label });
  } else {
    await Share.share({ text: row.body_text || row.label, title: row.label });
  }
}

// Readable text for a Vault Money entry (Share and Download). The plaintext label is generic, so the details come from the decrypted content.
function moneyPlainText(d) {
  const when = (ms) => new Date(ms).toLocaleString();
  const lines = [Money.summary(d), `Date: ${when(d.at)}`];
  if (d.method) lines.push(`Payment method: ${d.method}`);
  if (Money.isLoan(d)) {
    if (d.due) lines.push(`Due: ${new Date(d.due).toLocaleDateString()}`);
    lines.push(`Returned: ${Money.formatPlain(Money.repaid(d))}`, `Remaining: ${Money.formatPlain(Money.remaining(d))}`);
    for (const r of d.repayments || []) lines.push(`Repayment ${Money.formatPlain(r.amount)} on ${when(r.at)}${r.method ? ` (${r.method})` : ''}${r.note ? ` — ${r.note}` : ''}`);
  }
  return lines.join('\n');
}

function mapLinkFor(lat, lng) {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function mimeTypeFor(row) {
  if (row.type === 'image') { const m = mimeForExtension(row.extension); return m === '*/*' ? 'image/jpeg' : m; } // Gallery: images and videos (Decision 306)
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
  initFiles(db);
  const { row, cat } = await getEntryCategory(db, entryId);
  const ext = row.extension ? `.${row.extension}` : (TEXT_EXPORT_TYPES.has(row.type) ? '.txt' : '');
  let base = `${sanitizeFilename(row.label)}${ext}`;
  const text = (path, data) => Filesystem.writeFile({ path, directory: DOWNLOAD_ROOT, data, encoding: 'utf8', recursive: true });

  if (row.is_private) {
    if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before downloading');
    const loaded = await loadVaultEntryContent(db, privateSessionKey, entryId);
    const content = loaded.content;
    row.label = loaded.row.label; // the stored label is a placeholder (Decision 145)
    base = `${sanitizeFilename(row.label)}${ext}`;
    const path = await freeDownloadPath(base);
    if (row.type === 'note') {
      await text(path, content.text);
    } else if (row.type === 'money') {
      if (!content.money) throw new Error('This entry has no readable amount.');
      await text(path, withNote(moneyPlainText(content.money), await vaultNote(row, privateSessionKey)));
    } else if (row.type === 'reminder') {
      await text(path, reminderPlainText({ ...row, description: await vaultNote(row, privateSessionKey) }));
    } else if (row.type === 'location') {
      if (!content.location) throw new Error('This entry has no readable coordinates.');
      await text(path, locationPlainText({ ...row, ...content.location, description: await vaultNote(row, privateSessionKey) }));
    } else {
      await Filesystem.writeFile({ path, directory: DOWNLOAD_ROOT, data: content.fileData, recursive: true });
    }
    return path;
  }

  const path = await freeDownloadPath(base);
  if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
    await Filesystem.writeFile({ path, directory: DOWNLOAD_ROOT, data: await readBase64(row), recursive: true });
  } else if (row.type === 'location') {
    await text(path, locationPlainText(row));
  } else if (row.type === 'reminder') {
    await text(path, reminderPlainText(row));
  } else if (row.type === 'money' || row.type === 'expense') {
    await text(path, moneyRowPlainText(row));
  } else {
    await text(path, row.body_text || '');
  }
  return path;
}

// ---------------------------------------------------------------------------
// Action 4 — Edit. Reminders must reschedule their notification, not just update the row silently.
// Vault entries of ANY type require the session already PIN-unlocked to edit content (label/tags-only
// edits don't need the session — they're never encrypted in the first place).
// ---------------------------------------------------------------------------
async function editEntry(db, entryId, fields, { privateSessionKey = null, rescheduleReminder = null } = {}) {
  const { row, cat } = await getEntryCategory(db, entryId);
  const contentFieldsChanged = fields.text !== undefined || fields.fileData !== undefined || fields.ocrText !== undefined || fields.money !== undefined;

  if (row.is_private && contentFieldsChanged) {
    if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before editing');
    if (row.file_path) { // a file on disk (Decision 212): the stored file is replaced, or only the OCR text in the meta
      await updateVaultFileContent(db, privateSessionKey, entryId, { fileData: fields.fileData, ocrText: fields.ocrText });
    } else {
      const { content: existing } = await loadVaultEntryContent(db, privateSessionKey, entryId);
      const merged = { ...existing, ...fields }; // partial edits (e.g. just a corrected OCR text) keep the rest
      const plaintext = buildVaultPlaintext(row.type, merged);
      const { encryptPrivateNote, fieldAad } = await import('./crypto.js');
      const encryptedBody = await encryptPrivateNote(privateSessionKey, plaintext, fieldAad(entryId, 'body'));
      await db.run(`UPDATE entries SET encrypted_body=?, encrypted_meta=NULL, updated_at=? WHERE id=?`, [encryptedBody, Date.now(), entryId]); // meta is derived from the body (Decision 156)
    }
  }

  const updates = { updated_at: Date.now() };
  if (fields.label !== undefined) {
    if (row.is_private) { // the label is encrypted in the Vault; `label` keeps the placeholder (Decision 145)
      if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before editing');
      const { encryptPrivateNote, fieldAad } = await import('./crypto.js');
      updates.encrypted_label = await encryptPrivateNote(privateSessionKey, fields.label, fieldAad(entryId, 'label'));
      updates.label = VAULT_PLACEHOLDER_LABEL;
    } else {
      updates.label = fields.label;
    }
  }
  if (fields.description !== undefined) {
    if (row.is_private) {
      if (!privateSessionKey) throw new Error('Vault locked — unlock with PIN before editing');
      const { encryptPrivateNote, fieldAad } = await import('./crypto.js');
      updates.encrypted_description = fields.description ? await encryptPrivateNote(privateSessionKey, fields.description, fieldAad(entryId, 'desc')) : null;
    } else {
      updates.description = fields.description || null;
    }
  }
  // Non-vault notes: accept the same `fields.text` name the vault side uses, mapped to the
  // body_text column here — was previously only accepting `fields.body_text`, a mismatch that
  // meant calling this consistently from one UI would silently no-op whichever side didn't match.
  if (!row.is_private && cat === 'notes' && fields.text !== undefined) updates.body_text = fields.text;
  // Expense/reminder-specific fields — these were previously never actually written to the row at
  // all (only checked, further down, to decide whether to call rescheduleReminder), so editing a
  // reminder's time or an expense's amount silently did nothing before this fix.
  for (const key of ['amount', 'expense_category', 'fire_at', 'repeat_rule', 'completed_at', 'snoozed_until', 'money_json']) {
    if (fields[key] !== undefined) updates[key] = fields[key];
  }

  const setClause = Object.keys(updates).map((k) => `${k}=?`).join(', ');
  await db.run(`UPDATE entries SET ${setClause} WHERE id=?`, [...Object.values(updates), entryId]);

  // entries_fts/label_history only exist for non-vault entries in the first place (db.js/vault.js
  // both deliberately skip them for is_private=1) — so only touch them for non-vault label edits.
  if (!row.is_private && updates.label !== undefined) {
    await db.run(`UPDATE entries_fts SET label=? WHERE id=?`, [updates.label, entryId]);
  }
  if (!row.is_private && (updates.body_text !== undefined || updates.description !== undefined)) {
    const body = updates.body_text !== undefined ? updates.body_text : row.body_text;
    const desc = updates.description !== undefined ? updates.description : row.description;
    await db.run(`UPDATE entries_fts SET body_text=? WHERE id=?`, [[body, desc].filter(Boolean).join(' '), entryId]);
  }
  if (row.type === 'reminder' && (fields.fire_at !== undefined || fields.repeat_rule !== undefined) && rescheduleReminder) { // Vault reminders too
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
// Delete — Edit stays per-item only, bulk-editing doesn't make sense) just
// loop the same four functions above; nothing new to keep in sync with them.
// ---------------------------------------------------------------------------
// scope 'home' lists Home entries only; 'vault' lists the unlocked Vault index only (Decision 147). The two are never mixed.
// Bytes an entry stores besides a file or note text: description, Money details, coordinates (two 8-byte values),
// legacy expense fields. Without these Money and Location rows read 0 B.
function rowExtraBytes(row) {
  const text = (v) => (v ? new Blob([String(v)]).size : 0);
  let n = text(row.description) + text(row.money_json) + text(row.expense_category);
  if (Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) n += 16;
  if (Number.isFinite(row.amount)) n += 8;
  return n;
}

async function getSelectableEntries(db, { vaultIndex = null, scope = 'home' } = {}) {
  initFiles(db);
  const rows = scope === 'vault' ? [] : (await db.query(`SELECT * FROM entries WHERE deleted_at IS NULL AND is_private=0`)).values || [];
  const groups = {};
  for (const row of rows) {
    const cat = Object.keys(ENTRY_CATEGORIES).find((c) => c !== 'private_vault' && ENTRY_CATEGORIES[c](row));
    if (!cat) continue;
    let sizeBytes = 0;
    if (FILE_BEARING_CATEGORIES.has(cat) && row.file_path) {
      sizeBytes = await fileSize(row); // 0 when the file is missing or unreadable — the entry is still listed, with an unknown size
    } else if (row.body_text) {
      sizeBytes = new Blob([row.body_text]).size;
    }
    sizeBytes += rowExtraBytes(row);
    (groups[cat] = groups[cat] || []).push({ id: row.id, label: row.label, type: row.type, sizeBytes });
  }
  // Vault items come from the already-decrypted in-memory index (vault.js) — never re-decrypt here
  // just to compute a size that index already has.
  if (scope === 'vault' && vaultIndex) {
    groups.private_vault = vaultIndex.map((e) => ({ id: e.id, label: e.label, type: e.type, sizeBytes: e.sizeBytes }));
  }
  return groups;
}

// action: 'share' | 'download' | 'delete'. Runs sequentially, not in parallel —
// Share in particular opens one native share sheet per item since Capacitor's Share plugin has no
// multi-file share of its own; a known UX limitation for large selections, not something to paper
// over with an invented multi-file bundle format.
async function runBulkAction(db, action, entryIds, opts = {}) {
  const results = [];
  for (const id of entryIds) {
    try {
      if (action === 'share') await shareEntry(db, id, opts);
      else if (action === 'download') await downloadPlain(db, id, opts);
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
  shareEntry, copyPrivateNote,
  downloadPlain, editEntry,
  getSelectableEntries, runBulkAction
};
