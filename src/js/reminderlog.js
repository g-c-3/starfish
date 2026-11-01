// reminderlog.js — the completion log for repeating reminders (Decision 357).
// One row per closed occurrence: the entry, the time it was due, the time it was closed. A one-off needs no row: its own
// completed_at or fire_at says it. Rows go with their reminder (permanent delete, Overwrite) and travel inside its backup record.
import { lastOccurrenceAtOrBefore } from './reminders.js';

// Logs the occurrence a Done tap closes: the latest one due at or before `closedAt`. Nothing is written when the series
// has not reached its first time, or that occurrence is already logged.
async function logClosedOccurrence(db, row, closedAt) {
  if (!row || !row.repeat_rule) return false;
  const due = lastOccurrenceAtOrBefore(row.fire_at, row.repeat_rule, closedAt);
  if (due === null) return false;
  await db.run(`INSERT OR IGNORE INTO reminder_log (entry_id, due_at, closed_at) VALUES (?,?,?)`, [row.id, due, closedAt]);
  return true;
}

async function loadReminderLog(db) {
  return (await db.query(`SELECT entry_id, due_at, closed_at FROM reminder_log ORDER BY closed_at`)).values || [];
}

async function readReminderLog(db, entryId) {
  return ((await db.query(`SELECT due_at, closed_at FROM reminder_log WHERE entry_id = ? ORDER BY closed_at`, [entryId])).values || [])
    .map((r) => ({ due_at: r.due_at, closed_at: r.closed_at }));
}

async function removeReminderLog(db, entryId) {
  await db.run(`DELETE FROM reminder_log WHERE entry_id = ?`, [entryId]);
}

// Restore: the rows a backup record carries, under the id the entry was stored with.
async function restoreReminderLog(db, entryId, list) {
  if (!Array.isArray(list)) return;
  for (const l of list) {
    if (!Number.isFinite(l?.due_at) || !Number.isFinite(l?.closed_at)) continue;
    await db.run(`INSERT OR IGNORE INTO reminder_log (entry_id, due_at, closed_at) VALUES (?,?,?)`, [entryId, l.due_at, l.closed_at]);
  }
}

export { logClosedOccurrence, loadReminderLog, readReminderLog, removeReminderLog, restoreReminderLog };
