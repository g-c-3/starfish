// folderfind.js — search inside one category (Decisions 351, 352). Pure text and date matching on the phone; nothing leaves the device.
// Date tags act on the row's shown date: a year (2026), a month (oct, October), a day beside a month (1 nov, nov 1), a full date
// (01/11/2026, 1-11, 2026-11-01). Every other word must be found in the name or the tags.
import '../css/folderfind.css';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthOf = (w) => {
  if (w.length < 3) return -1;
  return MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)) || (w === 'sept' && m === 'september'));
};
const okDay = (n) => n >= 1 && n <= 31;
const okMonth = (n) => n >= 1 && n <= 12;
const YEAR = /^(19|20)\d{2}$/;

// "1 nov 2026 invoice" -> { years: [2026], months: [10], days: [1], words: ['invoice'], text: 'invoice' }
export function parseFind(term) {
  const toks = String(term || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const years = [], months = [], days = [], words = [];
  const isMonthTok = (t) => !!t && monthOf(t) >= 0;
  toks.forEach((t, i) => {
    let m;
    if (YEAR.test(t)) { years.push(Number(t)); return; }
    if ((m = t.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)) && YEAR.test(m[1]) && okMonth(+m[2]) && okDay(+m[3])) { years.push(+m[1]); months.push(+m[2] - 1); days.push(+m[3]); return; }
    if ((m = t.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}|\d{2}))?$/)) && okDay(+m[1]) && okMonth(+m[2])) {
      days.push(+m[1]); months.push(+m[2] - 1);
      if (m[3]) years.push(m[3].length === 2 ? 2000 + +m[3] : +m[3]);
      return;
    }
    const mo = monthOf(t);
    if (mo >= 0) { months.push(mo); return; }
    if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?$/)) && okDay(+m[1]) && (isMonthTok(toks[i - 1]) || isMonthTok(toks[i + 1]))) { days.push(+m[1]); return; }
    words.push(t);
  });
  return { years, months, days, words, text: words.join(' ') };
}

export const hasFind = (f) => !!(f.years.length || f.months.length || f.days.length || f.words.length);

// Years, months and days are alternatives within their own kind; every kind that is given must hold.
export function dateMatches(ms, f) {
  if (!f.years.length && !f.months.length && !f.days.length) return true;
  if (!ms) return false;
  const d = new Date(ms);
  return (!f.years.length || f.years.includes(d.getFullYear())) && (!f.months.length || f.months.includes(d.getMonth())) && (!f.days.length || f.days.includes(d.getDate()));
}

// Every word is found in the name or the tags.
export function nameMatches(label, tags, words) {
  if (!words.length) return true;
  const hay = `${label || ''} ${(tags || []).join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
