// move.js — Move between Home and Vault (Decision 181). Steps 1 to 3: Text, Location, Money, Reminder, Voice, Image, PDF, Files.
// A file is read whole into memory on the way (no size cap, Decision 184): a crash there leaves the original in place.
// A Reminder's schedule columns move with it; its notification is cancelled and scheduled again by the caller (app.js).
// Order: write the copy, read it back and compare, then delete the original permanently.
// Any failure removes the copy and leaves the original as it was.

import { insertEntry, permanentlyDeleteEntry } from './db.js';
import { saveVaultEntry, loadVaultEntryContent } from './vault.js';
import { decryptPrivateNote, toBase64, fromBase64 } from './crypto.js';
import { initFiles, readBytes, saveBase64, removeFile } from './files.js';
import * as Money from './money.js';

export const MOVE_TYPES = ['note', 'location', 'money', 'reminder', 'voice', 'image', 'pdf', 'file'];
const FILE_TYPES = ['voice', 'image', 'pdf', 'file'];
const OCR_TYPES = ['image', 'pdf']; // legacy 'expense' rows get no Move
export const canMove = (type) => MOVE_TYPES.includes(type);

const first = (res) => (res && res.values && res.values[0]) || null;
const nul = (v) => (v === undefined ? null : v);
const sameSchedule = (a, b) => nul(a.fire_at) === nul(b.fire_at) && nul(a.repeat_rule) === nul(b.repeat_rule)
  && nul(a.completed_at) === nul(b.completed_at) && nul(a.snoozed_until) === nul(b.snoozed_until);
const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function tagNames(db, id) {
  const res = await db.query(`SELECT t.name AS name FROM tags t JOIN entry_tags et ON et.tag_id=t.id WHERE et.entry_id=?`, [id]);
  return (res.values || []).map((r) => r.name);
}

async function attachTags(db, id, names) {
  for (const name of names) {
    await db.run(`INSERT OR IGNORE INTO tags (name) VALUES (?)`, [name]);
    const tag = first(await db.query(`SELECT id FROM tags WHERE name=?`, [name]));
    await db.run(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)`, [id, tag.id]);
  }
}

// A moved-in Vault item must not stay in Home's label suggestions (Decision 40); the same count insertEntry raised is lowered.
async function dropLabelHistory(db, type, label) {
  await db.run(`UPDATE label_history SET use_count = use_count - 1 WHERE type=? AND label=?`, [type, label]);
  await db.run(`DELETE FROM label_history WHERE type=? AND label=? AND use_count <= 0`, [type, label]);
}

// Home row to the content object saveVaultEntry takes.
function homeContent(row) {
  if (row.type === 'note') return { text: row.body_text || '' };
  if (row.type === 'reminder') {
    if (!row.fire_at) throw new Error('This reminder has no time.');
    return { text: '' }; // the note is in the description; the schedule columns are carried separately
  }
  if (row.type === 'location') {
    if (row.latitude == null || row.longitude == null) throw new Error('This entry has no coordinates.');
    return { location: { latitude: row.latitude, longitude: row.longitude } };
  }
  if (FILE_TYPES.includes(row.type)) return {}; // the file is read separately
  const money = Money.fromRow(row);
  if (!money) throw new Error('This entry has no readable amount.');
  return { money };
}

async function removeCopy(db, id, undoLabel = null) {
  try { await permanentlyDeleteEntry(db, id); } catch { /* nothing more to do */ }
  if (undoLabel) { try { await dropLabelHistory(db, undoLabel.type, undoLabel.label); } catch { /* ignore */ } }
}

// Home entry id -> Vault entry id. Needs the Vault key.
export async function moveToVault(db, key, id) {
  if (!key) throw new Error('Vault locked');
  const row = first(await db.query(`SELECT * FROM entries WHERE id=? AND is_private=0 AND deleted_at IS NULL`, [id]));
  if (!row) throw new Error('Entry not found');
  if (!canMove(row.type)) throw new Error('This type cannot be moved yet.');
  const tags = await tagNames(db, id);
  const content = homeContent(row);
  const isFile = FILE_TYPES.includes(row.type);
  let file = {};
  if (isFile) {
    if (!row.file_path) throw new Error('This entry has no file.');
    initFiles(db);
    let bytes;
    try { bytes = await readBytes(row); } catch (err) { throw new Error(`Its file could not be read (${String(err?.message || err).replace(/\.$/, '')}).`); }
    file = { fileData: toBase64(bytes), ocrText: OCR_TYPES.includes(row.type) ? (row.body_text || '') : '' };
  }
  let copyId = null;
  try {
    const schedule = row.type === 'reminder' ? { fireAt: row.fire_at, repeatRule: row.repeat_rule } : {};
    copyId = await saveVaultEntry(db, key, { type: row.type, label: row.label, tags, description: row.description || '', extension: row.extension || null, autoCategory: row.auto_category || null, ...content, ...schedule, ...file });
    await db.run(`UPDATE entries SET created_at=?, updated_at=?, completed_at=?, snoozed_until=? WHERE id=?`,
      [row.created_at, row.updated_at, nul(row.completed_at), nul(row.snoozed_until), copyId]);

    const back = await loadVaultEntryContent(db, key, copyId);
    const wantDescription = row.description || '';
    const gotDescription = back.row.encrypted_description ? await decryptPrivateNote(key, back.row.encrypted_description) : '';
    let sameContent;
    if (row.type === 'note' || row.type === 'reminder') sameContent = back.content.text === content.text;
    else if (isFile) sameContent = back.content.fileData === file.fileData && (!OCR_TYPES.includes(row.type) || (back.content.ocrText || '') === file.ocrText);
    else if (row.type === 'location') sameContent = !!back.content.location && back.content.location.latitude === content.location.latitude && back.content.location.longitude === content.location.longitude;
    else {
      const want = Money.normalize(content.money);
      sameContent = want.ok && !!back.content.money && Money.toJson(back.content.money) === Money.toJson(want.value);
    }
    if (!sameContent || back.row.label !== row.label || gotDescription !== wantDescription
      || !sameSchedule(back.row, row) || nul(back.row.extension) !== nul(row.extension) || nul(back.row.auto_category) !== nul(row.auto_category)
      || back.row.created_at !== row.created_at || !same(await tagNames(db, copyId), tags.slice(0, 2))) {
      throw new Error('The copy did not match.');
    }
    await permanentlyDeleteEntry(db, id);
  } catch (err) {
    if (copyId) await removeCopy(db, copyId);
    throw err;
  }
  try { await dropLabelHistory(db, row.type, row.label); } catch { /* suggestion list only */ }
  return copyId;
}

// Vault entry id -> Home entry id. Needs the Vault key.
export async function moveToHome(db, key, id) {
  if (!key) throw new Error('Vault locked');
  const { row, content } = await loadVaultEntryContent(db, key, id);
  if (row.deleted_at) throw new Error('Entry not found');
  if (!canMove(row.type)) throw new Error('This type cannot be moved yet.');
  const label = row.encrypted_label ? await decryptPrivateNote(key, row.encrypted_label) : row.label; // throws when unreadable: nothing is moved
  const description = row.encrypted_description ? await decryptPrivateNote(key, row.encrypted_description) : '';
  const tags = await tagNames(db, id);

  const fields = {};
  if (row.type === 'note') fields.body_text = content.text;
  else if (row.type === 'reminder') {
    if (!row.fire_at) throw new Error('This reminder has no time.');
    fields.fire_at = row.fire_at;
    fields.repeat_rule = row.repeat_rule || null;
  } else if (row.type === 'location') {
    if (!content.location) throw new Error('This entry has no readable coordinates.');
    fields.latitude = content.location.latitude;
    fields.longitude = content.location.longitude;
  } else if (row.type === 'money') {
    if (!content.money) throw new Error('This entry has no readable amount.');
    fields.money_json = Money.toJson(content.money);
  }

  const isFile = FILE_TYPES.includes(row.type);
  if (isFile && !content.fileData) throw new Error('This entry has no readable file.');
  if (isFile) initFiles(db);
  fields.extension = row.extension || null;
  fields.auto_category = row.auto_category || null;
  if (OCR_TYPES.includes(row.type)) fields.body_text = content.ocrText || null; // text read from the image or PDF, searchable on Home

  const copyId = crypto.randomUUID();
  let inserted = false;
  let saved = null;
  try {
    if (isFile) {
      saved = await saveBase64(content.fileData);
      fields.file_path = saved.path;
      fields.file_key = saved.fileKey;
    }
    await insertEntry(db, { id: copyId, type: row.type, label, description: description || null, ...fields });
    inserted = true;
    await db.run(`UPDATE entries SET created_at=?, updated_at=?, completed_at=?, snoozed_until=? WHERE id=?`,
      [row.created_at, row.updated_at, nul(row.completed_at), nul(row.snoozed_until), copyId]);
    await attachTags(db, copyId, tags);

    const back = first(await db.query(`SELECT * FROM entries WHERE id=? AND is_private=0`, [copyId]));
    let sameFields = !!back && Object.keys(fields).every((k) => nul(back[k]) === nul(fields[k]));
    if (sameFields && isFile) sameFields = sameBytes(await readBytes(back), new Uint8Array(fromBase64(content.fileData)));
    if (!sameFields || !sameSchedule(back, row) || back.label !== label || (back.description || '') !== description
      || back.created_at !== row.created_at || !same(await tagNames(db, copyId), tags)) {
      throw new Error('The copy did not match.');
    }
    await permanentlyDeleteEntry(db, id);
  } catch (err) {
    if (inserted) await removeCopy(db, copyId, { type: row.type, label });
    else if (saved) { try { await removeFile({ file_path: saved.path }); } catch { /* nothing written */ } }
    throw err;
  }
  return copyId;
}
