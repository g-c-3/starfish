// move.js — Move between Home and Vault (Decision 181). Step 1: Text, Location, Money.
// Order: write the copy, read it back and compare, then delete the original permanently.
// Any failure removes the copy and leaves the original as it was.

import { insertEntry, permanentlyDeleteEntry } from './db.js';
import { saveVaultEntry, loadVaultEntryContent } from './vault.js';
import { decryptPrivateNote } from './crypto.js';
import * as Money from './money.js';

export const MOVE_TYPES = ['note', 'location', 'money']; // legacy 'expense' rows get no Move
export const canMove = (type) => MOVE_TYPES.includes(type);

const first = (res) => (res && res.values && res.values[0]) || null;
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
  if (row.type === 'location') {
    if (row.latitude == null || row.longitude == null) throw new Error('This entry has no coordinates.');
    return { location: { latitude: row.latitude, longitude: row.longitude } };
  }
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
  let copyId = null;
  try {
    copyId = await saveVaultEntry(db, key, { type: row.type, label: row.label, tags, description: row.description || '', ...content });
    await db.run(`UPDATE entries SET created_at=?, updated_at=? WHERE id=?`, [row.created_at, row.updated_at, copyId]);

    const back = await loadVaultEntryContent(db, key, copyId);
    const wantDescription = row.description || '';
    const gotDescription = back.row.encrypted_description ? await decryptPrivateNote(key, back.row.encrypted_description) : '';
    let sameContent;
    if (row.type === 'note') sameContent = back.content.text === content.text;
    else if (row.type === 'location') sameContent = !!back.content.location && back.content.location.latitude === content.location.latitude && back.content.location.longitude === content.location.longitude;
    else {
      const want = Money.normalize(content.money);
      sameContent = want.ok && !!back.content.money && Money.toJson(back.content.money) === Money.toJson(want.value);
    }
    if (!sameContent || back.row.label !== row.label || gotDescription !== wantDescription
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
  else if (row.type === 'location') {
    if (!content.location) throw new Error('This entry has no readable coordinates.');
    fields.latitude = content.location.latitude;
    fields.longitude = content.location.longitude;
  } else {
    if (!content.money) throw new Error('This entry has no readable amount.');
    fields.money_json = Money.toJson(content.money);
  }

  const copyId = crypto.randomUUID();
  let inserted = false;
  try {
    await insertEntry(db, { id: copyId, type: row.type, label, description: description || null, ...fields });
    inserted = true;
    await db.run(`UPDATE entries SET created_at=?, updated_at=? WHERE id=?`, [row.created_at, row.updated_at, copyId]);
    await attachTags(db, copyId, tags);

    const back = first(await db.query(`SELECT * FROM entries WHERE id=? AND is_private=0`, [copyId]));
    const sameFields = !!back && Object.keys(fields).every((k) => back[k] === fields[k]);
    if (!sameFields || back.label !== label || (back.description || '') !== description
      || back.created_at !== row.created_at || !same(await tagNames(db, copyId), tags)) {
      throw new Error('The copy did not match.');
    }
    await permanentlyDeleteEntry(db, id);
  } catch (err) {
    if (inserted) await removeCopy(db, copyId, { type: row.type, label });
    throw err;
  }
  return copyId;
}
