// When an automatic backup is due (Decision 278). Pure date arithmetic: no storage, no plugin, no network.
// An automatic backup runs when the app is open (it needs the backup passkey, which is never stored), so the time setting
// means "not before this time of day": the first open at or after the next scheduled time finds the backup due.
const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const DEFAULT_TIME = '02:00';

function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  return m ? [Math.min(+m[1], 23), Math.min(+m[2], 59)] : [2, 0];
}

// 0 when there has been no backup yet (due at once); else the next scheduled moment after `lastMs`:
// the next occurrence of the time of day, plus the rest of the period for weekly and monthly.
function nextDueAt(lastMs, frequency, time) {
  if (!lastMs) return 0;
  const [h, m] = parseTime(time);
  const d = new Date(lastMs);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= lastMs) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + ((PERIOD_DAYS[frequency] || PERIOD_DAYS.weekly) - 1));
  return d.getTime();
}

const isDue = (lastMs, frequency, time, now = Date.now()) => now >= nextDueAt(lastMs, frequency, time);

export { isDue, nextDueAt, PERIOD_DAYS, DEFAULT_TIME };
