// reminders.js — completion rules for reminder entries (Decision 92). Pure functions, no I/O.
//
// A reminder is inactive (greyed out) when:
//   - the owner marked it done (completed_at set), or
//   - it does not repeat and its time has passed (it has fired).
// A repeating reminder is only ever inactive through completed_at: it keeps recurring until marked done.
// A snoozed reminder (snoozed_until in the future, Decision 99) stays active until the snooze time passes.

const REPEAT_LABELS = { daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly' };

// 'done' | 'snoozed' | 'fired' | 'upcoming'
function reminderStatus(row, now = Date.now()) {
  if (row.completed_at) return 'done';
  if (row.snoozed_until && row.snoozed_until > now) return 'snoozed';
  if (!row.repeat_rule && row.fire_at && row.fire_at <= now) return 'fired';
  return 'upcoming';
}

const isReminderInactive = (row, now = Date.now()) => ['done', 'fired'].includes(reminderStatus(row, now));
const isReminderActive = (row, now = Date.now()) => !isReminderInactive(row, now);
const repeatLabel = (rule) => REPEAT_LABELS[rule] || 'Does not repeat';

export { reminderStatus, isReminderInactive, isReminderActive, repeatLabel, REPEAT_LABELS };
