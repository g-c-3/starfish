// Widget inbox (Decision 266): captures made from the home-screen widget wait in widget_inbox, never in entries, until the app is
// unlocked. Database only: no DOM, no plugin, no network.
import { insertEntry } from './db.js';
import { removeFile } from './files.js';

async function addToInbox(db, item) {
  const id = item.id || crypto.randomUUID();
  await db.run(
    `INSERT INTO widget_inbox (id, type, label, description, body_text, money_json, extension, file_path, file_key, fire_at, repeat_rule, latitude, longitude, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, item.type, item.label, item.description || null, item.body_text ?? null, item.money_json ?? null,
     item.extension || null, item.file_path || null, item.file_key || null, item.fire_at ?? null, item.repeat_rule || null,
     item.latitude ?? null, item.longitude ?? null, item.created_at || Date.now()]
  );
  return id;
}

async function inboxCount(db) {
  return ((await db.query(`SELECT COUNT(*) AS n FROM widget_inbox`)).values || [])[0]?.n || 0;
}

// Each row goes into entries under its own id and original time, then leaves the inbox. A row already in entries (a crash
// between the two steps) is only deleted. A row that fails stays for the next transfer. Returns how many were moved.
let moving = null;
function transferInbox(db) {
  if (!moving) moving = moveRows(db).finally(() => { moving = null; });
  return moving;
}

async function moveRows(db) {
  const rows = (await db.query(`SELECT * FROM widget_inbox ORDER BY created_at, id`)).values || [];
  let moved = 0;
  for (const r of rows) {
    try {
      const has = ((await db.query(`SELECT 1 AS x FROM entries WHERE id = ?`, [r.id])).values || []).length > 0;
      if (!has) {
        await insertEntry(db, {
          id: r.id, type: r.type, label: r.label, description: r.description, body_text: r.body_text, money_json: r.money_json,
          extension: r.extension, file_path: r.file_path, file_key: r.file_key, fire_at: r.fire_at, repeat_rule: r.repeat_rule,
          latitude: r.latitude, longitude: r.longitude, created_at: r.created_at
        });
      }
      await db.run(`DELETE FROM widget_inbox WHERE id = ?`, [r.id]);
      moved++;
    } catch { /* stays in the inbox */ }
  }
  return moved;
}

// Restore with Overwrite: waiting items and their files are discarded.
async function clearInbox(db) {
  const rows = (await db.query(`SELECT file_path FROM widget_inbox`)).values || [];
  for (const r of rows) await removeFile(r);
  await db.run(`DELETE FROM widget_inbox`);
}

export { addToInbox, inboxCount, transferInbox, clearInbox };
