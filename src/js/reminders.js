// reminders.js — completion rules for reminder entries (Decision 92). Pure functions, no I/O.
//
// A reminder is inactive (greyed out) when:
//   - the owner marked it done (completed_at set), or
//   - it does not repeat and its time has passed (it has fired).
// A repeating reminder is never inactive through Done or time (Decision 108): Done clears this time's notification and
// snooze, and it keeps recurring. It stops by editing Repeat to none, or by deleting it.
// A snoozed reminder (snoozed_until in the future, Decision 99) stays active until the snooze time passes.

const REPEAT_LABELS = { daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly' };

// 'done' | 'snoozed' | 'fired' | 'upcoming'
function reminderStatus(row, now = Date.now()) {
  if (row.completed_at) return 'done';
  if (row.snoozed_until && row.snoozed_until > now) return 'snoozed';
  if (!row.repeat_rule && row.fire_at && row.fire_at <= now) return 'fired';
  return 'upcoming';
}

// The first `count` occurrences strictly after `after`, stepping from the original time. Daily and weekly keep the
// local clock time across clock changes; monthly keeps the original day of month, clamped to short months.
function nextOccurrences(fireAt, rule, after, count) {
  const start = new Date(fireAt);
  const out = [];
  for (let n = 0; out.length < count && n < 5000; n++) {
    const d = new Date(start);
    if (rule === 'daily') d.setDate(start.getDate() + n);
    else if (rule === 'weekly') d.setDate(start.getDate() + 7 * n);
    else if (rule === 'monthly') {
      d.setDate(1);
      d.setMonth(start.getMonth() + n);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(start.getDate(), last));
    } else return out;
    if (d.getTime() > after) out.push(d.getTime());
  }
  return out;
}

// When a reminder is next due: its own time, or for a repeating one the next occurrence from now.
function reminderNextDue(row, now = Date.now()) {
  if (!row.repeat_rule || !row.fire_at || row.fire_at > now) return row.fire_at;
  return nextOccurrences(row.fire_at, row.repeat_rule, now, 1)[0] || row.fire_at;
}

const isReminderInactive = (row, now = Date.now()) => ['done', 'fired'].includes(reminderStatus(row, now));
const isReminderActive = (row, now = Date.now()) => !isReminderInactive(row, now);
const repeatLabel = (rule) => REPEAT_LABELS[rule] || 'Does not repeat';

export { nextOccurrences, reminderNextDue, reminderStatus, isReminderInactive, isReminderActive, repeatLabel, REPEAT_LABELS };
