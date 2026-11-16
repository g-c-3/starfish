// odsfmt.js — a number format code and its ods number style (Decision 495). Pure: no document.
// toOdf(code) -> { tag, parts } where tag is number-style, percentage-style, date-style, time-style or text-style and each part is
// { n: 'number' | 'text' | 'year' | 'month' | 'day' | 'day-of-week' | 'hours' | 'minutes' | 'seconds' | 'am-pm' | 'text-content', … }.
// fromOdf(tag, parts) -> the code, or null when a part is not one this module writes. One section only; anything else is refused.

export class FormatError extends Error { constructor() { super('That format code cannot be written to an ods yet.'); this.office = true; } }

const DT = /^(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P)/i;

function lit(code) { // text pieces and the rest, quotes and escapes resolved
  const out = []; let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"') { const j = code.indexOf('"', i + 1); if (j < 0) throw new FormatError(); out.push({ t: code.slice(i + 1, j) }); i = j + 1; }
    else if (ch === '\\') { if (i + 1 >= code.length) throw new FormatError(); out.push({ t: code[i + 1] }); i += 2; }
    else { out.push({ c: ch }); i++; }
  }
  return out;
}

export function toOdf(code) {
  const k = String(code).trim();
  if (k === '@') return { tag: 'text-style', parts: [{ n: 'text-content' }] };
  if (k.includes(';')) throw new FormatError();
  const items = lit(k);
  const raw = items.map((x) => (x.c !== undefined ? x.c : '')).join('');
  const isDate = /[ydhs]|am\/pm|a\/p|m/i.test(raw);
  const parts = [];
  const text = (t) => { const last = parts[parts.length - 1]; if (last && last.n === 'text') last.t += t; else parts.push({ n: 'text', t }); };
  if (isDate) {
    let time = false; let i = 0; let tag = 'date-style';
    const flat = []; // literals stay as items, letters are matched as tokens
    while (i < items.length) {
      if (items[i].t !== undefined) { flat.push({ lit: items[i].t }); i++; continue; }
      const rest = items.slice(i).map((x) => (x.c !== undefined ? x.c : '\u0000')).join('');
      const m = DT.exec(rest);
      if (m) { flat.push({ tok: m[1].toLowerCase(), raw: m[1] }); i += m[1].length; continue; }
      const ch = items[i].c; if (/[A-Za-z0-9]/.test(ch)) throw new FormatError(); flat.push({ lit: ch }); i++;
    }
    flat.forEach((f, idx) => {
      if (f.lit !== undefined) { text(f.lit); return; }
      const t = f.tok;
      if (t === 'yyyy' || t === 'yy') parts.push({ n: 'year', long: t === 'yyyy' });
      else if (t === 'dddd' || t === 'ddd') parts.push({ n: 'day-of-week', long: t === 'dddd' });
      else if (t === 'dd' || t === 'd') parts.push({ n: 'day', long: t === 'dd' });
      else if (t === 'hh' || t === 'h') { time = true; parts.push({ n: 'hours', long: t === 'hh' }); }
      else if (t === 'ss' || t === 's') { time = true; parts.push({ n: 'seconds', long: t === 'ss' }); }
      else if (t === 'am/pm' || t === 'a/p') { time = true; parts.push({ n: 'am-pm' }); }
      else { // m: minutes next to hours or seconds, else a month
        const prev = flat.slice(0, idx).reverse().find((x) => x.tok); const next = flat.slice(idx + 1).find((x) => x.tok);
        const minute = (prev && /^h/.test(prev.tok)) || (next && /^s/.test(next.tok));
        if (minute && (t === 'm' || t === 'mm')) { time = true; parts.push({ n: 'minutes', long: t === 'mm' }); }
        else if (t === 'mmmm' || t === 'mmm') parts.push({ n: 'month', long: t === 'mmmm', text: true });
        else parts.push({ n: 'month', long: t === 'mm', text: false });
      }
    });
    if (time && !parts.some((p) => ['year', 'month', 'day', 'day-of-week'].includes(p.n))) tag = 'time-style';
    if (!parts.some((p) => p.n !== 'text')) throw new FormatError();
    return { tag, parts };
  }
  // a number: [prefix] integer [.decimals] [suffix]; a % in the prefix or suffix makes it a percentage
  const flat = items.map((x) => (x.c !== undefined ? x.c : '\u0001')).join('');
  const m = /^([^#0,.]*)([#,]*0[0,]*)(\.0*)?([^#0,.]*)$/.exec(flat);
  if (!m) throw new FormatError();
  const pre = items.slice(0, m[1].length); const post = items.slice(m[1].length + m[2].length + (m[3] ? m[3].length : 0));
  let pct = false;
  const side = (arr) => { const out = []; for (const x of arr) { if (x.c === '%') { pct = true; continue; } if (x.c !== undefined && /[A-Za-z0-9_*?@\[\]]/.test(x.c)) throw new FormatError(); const t = x.t !== undefined ? x.t : x.c; const l = out[out.length - 1]; if (l) l.t += t; else out.push({ n: 'text', t }); } return out; };
  const pp = side(pre); const ps = side(post);
  const num = { n: 'number', dec: m[3] ? m[3].length - 1 : 0, min: m[2].replace(/[#,]/g, '').length, group: m[2].includes(',') };
  if (pct) return { tag: 'percentage-style', parts: [...pp, num, ...ps, { n: 'text', t: '%' }] };
  return { tag: 'number-style', parts: [...pp, num, ...ps] };
}

export function fromOdf(tag, parts) {
  let out = ''; let pct = false;
  for (const p of parts) {
    if (p.n === 'text') { const t = p.t; if (t === '%' && tag === 'percentage-style') { pct = true; continue; } out += /^[-/:. ,]*$/.test(t) ? t : `"${t.replace(/"/g, '')}"`; }
    else if (p.n === 'number') out += (p.group ? '#,##' : '') + '0'.repeat(Math.max(1, p.min || 1)) + (p.dec ? `.${'0'.repeat(p.dec)}` : '');
    else if (p.n === 'year') out += p.long ? 'yyyy' : 'yy';
    else if (p.n === 'month') out += p.text ? (p.long ? 'mmmm' : 'mmm') : p.long ? 'mm' : 'm';
    else if (p.n === 'day') out += p.long ? 'dd' : 'd';
    else if (p.n === 'day-of-week') out += p.long ? 'dddd' : 'ddd';
    else if (p.n === 'hours') out += p.long ? 'hh' : 'h';
    else if (p.n === 'minutes') out += p.long ? 'mm' : 'm';
    else if (p.n === 'seconds') out += p.long ? 'ss' : 's';
    else if (p.n === 'am-pm') out += 'AM/PM';
    else if (p.n === 'text-content') out += '@';
    else return null;
  }
  return pct ? `${out}%` : out;
}
