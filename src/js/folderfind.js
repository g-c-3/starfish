// folderfind.js — search inside one category (Decision 351). Pure text and date matching on the phone; nothing leaves the device.
// A year (2026) or a month (oct, October) typed in the box acts as a tag on the saved date; every other word matches name and tags.
import '../css/folderfind.css';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthOf = (w) => {
  if (w.length < 3) return -1;
  const i = MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)) || (w === 'sept' && m === 'september'));
  return i;
};

// "oct 2026 invoice" -> { years: [2026], months: [9], words: ['invoice'], text: 'invoice' }
export function parseFind(term) {
  const years = [], months = [], words = [];
  for (const raw of String(term || '').toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (/^(19|20)\d{2}$/.test(raw)) { years.push(Number(raw)); continue; }
    const m = monthOf(raw);
    if (m >= 0) { months.push(m); continue; }
    words.push(raw);
  }
  return { years, months, words, text: words.join(' ') };
}

export const hasFind = (f) => !!(f.years.length || f.months.length || f.words.length);

// Years and months are alternatives within their own kind and both must hold when both are given.
export function dateMatches(ms, f) {
  if (!f.years.length && !f.months.length) return true;
  if (!ms) return false;
  const d = new Date(ms);
  return (!f.years.length || f.years.includes(d.getFullYear())) && (!f.months.length || f.months.includes(d.getMonth()));
}

// Every word is found in the name or the tags.
export function nameMatches(label, tags, words) {
  if (!words.length) return true;
  const hay = `${label || ''} ${(tags || []).join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
