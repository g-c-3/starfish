// dategroup.js — soft date separators for lists (Decision 350). Pure date arithmetic on the phone's clock; nothing leaves the device.
// A label depends only on an item's day and today. Weeks start on Sunday. Priority, newest first:
// Today, Yesterday, This Week, Last Week, This Month, Last Month, then "Month Year".
// A broader label with no days of its own joins the group that holds its oldest day (e.g. "This Month/This Week/Today" on the 1st, when it is a Sunday).
// Last Week is dropped when this week starts on the 1st: that week is the end of last month, so it reads Last Month.
// Upcoming reminders read the same way mirrored forward (Decision 363): Today, Tomorrow, This Week, Next Week, This Month, Next Month, then "Month Year";
// a broader label with no days of its own beyond a group joins it ("This Week/Tomorrow" on a Friday); Next Week is dropped when this week ends on the month's last day.
import '../css/dategroup.css';

const DAY = 86400000;
const dayNo = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); // a local calendar day as a number

function context(now) {
  const t = new Date(now);
  const today = dayNo(t);
  const ws = today - t.getDay();
  const mStart = dayNo(new Date(t.getFullYear(), t.getMonth(), 1));
  const lmStart = dayNo(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  return { today, ws, mStart, lmStart, lwKept: ws !== mStart };
}

function bucket(d, c) {
  if (d >= c.today) return 'today';
  if (d === c.today - 1) return 'yesterday';
  if (d >= c.ws) return 'week';
  if (c.lwKept && d >= c.ws - 7) return 'lastweek';
  if (d >= c.mStart) return 'month';
  if (d >= c.lmStart) return 'lastmonth';
  return 'older';
}

const NAME = { today: 'Today', yesterday: 'Yesterday', week: 'This Week', lastweek: 'Last Week', month: 'This Month', lastmonth: 'Last Month' };

// The separator text for a timestamp (ms); '' when it has none.
export function dayLabel(ms, now = Date.now()) {
  if (!ms) return '';
  const c = context(now);
  const d = Math.min(dayNo(new Date(ms)), c.today); // a date ahead of today reads as Today
  const b = bucket(d, c);
  if (b === 'older') return new Date(ms).toLocaleDateString('en', { month: 'long', year: 'numeric' });
  const parts = [];
  if (d >= c.mStart && bucket(c.mStart, c) === b && b !== 'month') parts.push('This Month');
  if (d >= c.ws && bucket(c.ws, c) === b && b !== 'week') parts.push('This Week');
  parts.push(NAME[b]);
  return parts.join('/');
}


// ---- Upcoming: the same idea looking forward ----
function upContext(now) {
  const t = new Date(now);
  const today = dayNo(t);
  const we = today + (6 - t.getDay()); // the Saturday that ends this week
  const mEnd = dayNo(new Date(t.getFullYear(), t.getMonth() + 1, 0));
  const nmEnd = dayNo(new Date(t.getFullYear(), t.getMonth() + 2, 0));
  return { today, we, mEnd, nmEnd, nwKept: we !== mEnd };
}
function upBucket(d, c) {
  if (d <= c.today) return 'today';
  if (d === c.today + 1) return 'tomorrow';
  if (d <= c.we) return 'week';
  if (c.nwKept && d <= c.we + 7) return 'nextweek';
  if (d <= c.mEnd) return 'month';
  if (d <= c.nmEnd) return 'nextmonth';
  return 'later';
}
const UP_NAME = { today: 'Today', tomorrow: 'Tomorrow', week: 'This Week', nextweek: 'Next Week', month: 'This Month', nextmonth: 'Next Month' };

// The separator text for the time (ms) an upcoming item is due; '' when it has none. A time already past reads as Today.
export function upcomingLabel(ms, now = Date.now()) {
  if (!ms) return '';
  const c = upContext(now);
  const d = dayNo(new Date(ms));
  const b = upBucket(d, c);
  if (b === 'later') return new Date(ms).toLocaleDateString('en', { month: 'long', year: 'numeric' });
  const parts = [];
  if (b !== 'month' && upBucket(c.mEnd, c) === b) parts.push('This Month');
  if (b !== 'week' && upBucket(c.we, c) === b) parts.push('This Week');
  parts.push(UP_NAME[b]);
  return parts.join('/');
}

export const separatorHtml = (label) => `<div class="date-sep" role="presentation">${label}</div>`;

// itemHtml for each item, with a separator wherever the label changes. dateOf null (a list not in date order) = no separators.
export function groupedHtml(items, dateOf, itemHtml, now = Date.now(), label = dayLabel) {
  let prev = null, out = '';
  for (const it of items) {
    if (dateOf) {
      const l = label(dateOf(it), now);
      if (l && l !== prev) { out += separatorHtml(l); prev = l; }
    }
    out += itemHtml(it);
  }
  return out;
}
