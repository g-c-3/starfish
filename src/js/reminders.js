// reminders.js — completion rules for reminder entries (Decision 92). Pure functions, no I/O.
//
// A reminder is inactive (greyed out) when:
//   - the owner marked it done (completed_at set), or
//   - it does not repeat and its time has passed (it has fired).
// A repeating reminder is only ever inactive through completed_at: it keeps recurring until marked done.

const REPEAT_LABELS = { daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly' };

// 'done' | 'fired' | 'upcoming'
function reminderStatus(row, now = Date.now()) {
  if (row.completed_at) return 'done';
  if (!row.repeat_rule && row.fire_at && row.fire_at <= now) return 'fired';
  return 'upcoming';
}

const isReminderInactive = (row, now = Date.now()) => reminderStatus(row, now) !== 'upcoming';
const repeatLabel = (rule) => REPEAT_LABELS[rule] || 'Does not repeat';

export { reminderStatus, isReminderInactive, repeatLabel, REPEAT_LABELS };
