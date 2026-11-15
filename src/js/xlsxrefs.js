// xlsxrefs.js — formula reference rewriting for the xlsx edit engine (Decision 490). Pure text in, text out; no document.
// A reference is found outside string literals: [Sheet!]A1, A1:B2, $A$1, 1:3, A:C. A reference that a change removes becomes #REF!.
import { colName } from './office-read.js';

const MAX_ROW = 1048576;
const MAX_COL = 16384;
const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*)!";
const CELL = '\\$?[A-Z]{1,3}\\$?\\d+';
const BEFORE = "(?<![A-Za-z0-9_.$'\\]!\\u00C0-\\uFFFF])";
const REF = new RegExp(`${BEFORE}(${SHEET})?(${CELL}(?::${CELL})?|\\$?\\d+:\\$?\\d+|\\$?[A-Z]{1,3}:\\$?[A-Z]{1,3})(?![A-Za-z0-9_(.!\\u00C0-\\uFFFF])`, 'g');
const PREFIX = new RegExp(`${BEFORE}(${SHEET})`, 'g');
const LITERAL = /"(?:[^"]|"")*"/g;

const unq = (p) => (p[0] === "'" ? p.slice(1, -1).replace(/''/g, "'") : p);
const same = (a, b) => a !== null && b !== null && a !== undefined && b !== undefined && String(a).toLowerCase() === String(b).toLowerCase();
export const quoteName = (n) => (/^[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^R\d*C\d*$/i.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

const endp = (s) => {
  const m = /^(\$?)([A-Z]{1,3})?(\$?)(\d+)?$/.exec(s); if (!m) return null;
  const hasC = m[2] !== undefined; const hasR = m[4] !== undefined;
  return { c: hasC ? colNum(m[2]) : null, r: hasR ? Number(m[4]) - 1 : null, ca: hasC && m[1] === '$', ra: hasR && (hasC ? m[3] === '$' : m[1] === '$' || m[3] === '$') };
};
const valid = (e) => !!e && (e.c === null || e.c < MAX_COL) && (e.r === null || (e.r >= 0 && e.r < MAX_ROW));
const out = (e) => `${e.c !== null ? (e.ca ? '$' : '') + colName(e.c) : ''}${e.r !== null ? (e.ra ? '$' : '') + (e.r + 1) : ''}`;

// text with string literals kept as they are; fn gets the code between them
const codeOnly = (text, fn) => {
  let res = ''; let last = 0; LITERAL.lastIndex = 0; let m;
  while ((m = LITERAL.exec(text))) { res += fn(text.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
  return res + fn(text.slice(last));
};

// fn(sheet, a, b) -> undefined (keep), null (#REF!) or { a, b }; sheet is the prefix, else own
export function mapRefs(text, own, fn) {
  if (!text || !/[A-Za-z0-9]/.test(text)) return text;
  return codeOnly(text, (seg) => seg.replace(REF, (all, pre, body) => {
    const parts = body.split(':'); const a = endp(parts[0]); const b = parts[1] !== undefined ? endp(parts[1]) : null;
    if (!valid(a) || (parts[1] !== undefined && !valid(b))) return all;
    if (b && ((a.c === null) !== (b.c === null) || (a.r === null) !== (b.r === null))) return all;
    const res = fn(pre ? unq(pre.slice(0, -1)) : own, a, b);
    if (res === undefined) return all;
    if (res === null) return '#REF!';
    return (pre || '') + out(res.a) + (res.b ? `:${out(res.b)}` : '');
  }));
}

// where a range [lo, hi] of rows or columns goes when n are inserted or deleted at `at` (0-based); null when it is gone
export function mapRange(lo, hi, op) {
  const { at, n } = op; let a; let b;
  if (op.del) {
    a = lo < at ? lo : lo >= at + n ? lo - n : at;
    b = hi < at ? hi : hi >= at + n ? hi - n : at - 1;
    if (b < a) return null;
  } else { a = lo >= at ? lo + n : lo; b = hi >= at ? hi + n : hi; }
  const max = op.axis === 'r' ? MAX_ROW : MAX_COL;
  if (a >= max) return null;
  return [a, Math.min(b, max - 1)];
}

// the reference rewriter for an insert or a delete of rows (axis 'r') or columns (axis 'c') on op.sheet
export const structFn = (op) => (sheet, a, b) => {
  if (!same(sheet, op.sheet)) return undefined;
  const k = op.axis;
  if (a[k] === null) return undefined; // a column range under a row change, and the reverse
  let lo = a[k]; let hi = b ? b[k] : lo; const swap = lo > hi; if (swap) [lo, hi] = [hi, lo];
  const m = mapRange(lo, hi, op); if (!m) return null;
  if (m[0] === lo && m[1] === hi) return undefined;
  return b ? { a: { ...a, [k]: swap ? m[1] : m[0] }, b: { ...b, [k]: swap ? m[0] : m[1] } } : { a: { ...a, [k]: m[0] }, b: null };
};

// a formula moved by (dr, dc): relative parts follow, absolute parts stay (a shared formula written out for one cell)
export const translateRefs = (text, dr, dc) => mapRefs(text, null, (sheet, a, b) => {
  const mv = (e) => { const c = e.c !== null && !e.ca ? e.c + dc : e.c; const r = e.r !== null && !e.ra ? e.r + dr : e.r; return (c !== null && (c < 0 || c >= MAX_COL)) || (r !== null && (r < 0 || r >= MAX_ROW)) ? null : { ...e, c, r }; };
  const na = mv(a); const nb = b ? mv(b) : null; if (!na || (b && !nb)) return null;
  return { a: na, b: nb };
});

// references that name a sheet which is deleted
export const removeSheetRefs = (text, name) => mapRefs(text, null, (sheet) => (same(sheet, name) ? null : undefined));

// the sheet name in front of references, renamed
export const renamePrefix = (text, from, to) => codeOnly(text, (seg) => seg.replace(PREFIX, (all, pre) => (same(unq(pre.slice(0, -1)), from) ? `${quoteName(to)}!` : all)));

// a reference over several sheets (Sheet1:Sheet3!A1) is not rewritten
export const has3D = (text) => /(?:'[^']+'|[A-Za-z_][\w.]*):(?:'[^']+'|[A-Za-z_][\w.]*)!/.test((text || '').replace(LITERAL, ''));
