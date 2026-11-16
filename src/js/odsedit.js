// Spreadsheet edit engine, ods (Decision 493, Phase 120 step 5a). Works on `content.xml` in place: a changed cell is written, every other part
// of the zip is kept as it was. Same shape as xlsxedit.js (names, cell, locked, setCell, merges, snapshot, toBytes, dirty) so the editor view takes either.
// Repeated rows and cells (`number-rows-repeated`, `number-columns-repeated`) are split only where a cell is written. Formulas (Decision 494):
// a formula in the ods syntax (`of:=SUM([.A1:.A3])`) is turned into the A1 text the calculator of xlsxcalc.js reads, and back; every formula is
// calculated again after a change and its result stored beside it. A formula the calculator does not understand keeps its stored result.
// Number formats (Decision 495) are ods number styles written into the automatic styles of content.xml (codes in odsfmt.js).
// Rows, columns and sheets (Decision 496): rows and cells are inserted or cut by their repeat counts, formulas follow through the A1 text and
// xlsxrefs.js; a workbook with things that hold cell addresses this editor does not move (named ranges, validation, filters, pictures,
// charts, array formulas, a merged cell that the change would cut) is refused with a message.
import { unzipSync, zipSync } from 'fflate';
import { SHEET_ROW_MAX, SHEET_COL_MAX, colName, formatValue } from './office-read.js';
import { toOdf, fromOdf } from './odsfmt.js';
import { parse, run, CalcError } from './xlsxcalc.js';
import { mapRefs, structFn, removeSheetRefs, renamePrefix } from './xlsxrefs.js';

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  calcext: 'urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0'
};
const STORED = /^mimetype$|\.(png|jpe?g|gif|webp|zip|mp[34]|docx|xlsx|pptx|odt|ods|odp)$/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const dec = (b) => new TextDecoder('utf-8').decode(b);
const enc = (s) => new TextEncoder().encode(s);
const parseX = (s) => new DOMParser().parseFromString(s, 'application/xml');
const is = (n, name, ns = NS.table) => !!n && n.nodeType === 1 && n.namespaceURI === ns && n.localName === name;
const kids = (n, name, ns = NS.table) => (n ? [...n.children].filter((c) => is(c, name, ns)) : []);
const rep = (n, name) => Math.max(1, Number(n.getAttributeNS(NS.table, name) || 1));
const cellOf = (n) => is(n, 'table-cell') || is(n, 'covered-table-cell');

export class EditError extends Error { constructor(m) { super(m); this.office = true; } }

// ---- the ods formula syntax and the A1 text of the calculator ----
const SHEETP = String.raw`(?:\$?('(?:[^']|'')+'|[^\s.\]'\[:;()]+))?`;
const REF_ODS = new RegExp(String.raw`\[${SHEETP}\.(\$?[A-Za-z]{1,3}\$?\d+)(?::${SHEETP}\.(\$?[A-Za-z]{1,3}\$?\d+))?\]`, 'y');
const REF_A1 = /(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![\w(.!])/y;
const quoteName = (n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
const unquote = (n) => (n[0] === "'" ? n.slice(1, -1).replace(/''/g, "'") : n);
const strEnd = (s, i) => { let j = i + 1; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') j += 2; else return j + 1; } else j++; } return s.length; };
const toA1 = (f) => { // null when anything is not understood
  let s = String(f).replace(/^of:/, ''); if (s[0] !== '=') return null; s = s.slice(1);
  let out = ''; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') { const j = strEnd(s, i); out += s.slice(i, j); i = j; continue; }
    if (ch === '[') {
      if (s.startsWith('[.#REF!]', i)) { out += '#REF!'; i += 8; continue; }
      REF_ODS.lastIndex = i; const m = REF_ODS.exec(s); if (!m) return null;
      const p1 = m[1] ? `${quoteName(unquote(m[1]))}!` : ''; const p2 = m[3] ? unquote(m[3]) : null;
      if (p2 !== null && m[1] && unquote(m[1]) !== p2) return null; // a range over two sheets
      out += p1 + m[2] + (m[4] ? `:${m[4]}` : ''); i = REF_ODS.lastIndex; continue;
    }
    if (ch === '#' && s.startsWith('#REF!', i)) { out += '#REF!'; i += 5; continue; }
    if (ch === "'" || ch === '#') return null;
    out += ch === ';' ? ',' : ch; i++;
  }
  return out;
};
const fromA1 = (t) => {
  let out = ''; let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (ch === '"') { const j = strEnd(t, i); out += t.slice(i, j); i = j; continue; }
    if (t.startsWith('#REF!', i)) { out += '[.#REF!]'; i += 5; continue; }
    if (!/[\w.$]/.test(out[out.length - 1] || ' ')) {
      REF_A1.lastIndex = i; const m = REF_A1.exec(t);
      if (m && m.index === i) { out += `[${m[1] ? `$${m[1]}` : ''}.${m[2]}${m[3] ? `:.${m[3]}` : ''}]`; i = REF_A1.lastIndex; continue; }
    }
    out += ch === ',' ? ';' : ch; i++;
  }
  return `of:=${out}`;
};
const wholeAxis = (n) => !!n.ref && ((n.ref.r0 === 0 && n.ref.r1 === SHEET_ROW_MAX - 1) || (n.ref.c0 === 0 && n.ref.c1 === SHEET_COL_MAX - 1));
const walk = (n, fn) => { fn(n); if (n.l) walk(n.l, fn); if (n.r) walk(n.r, fn); if (n.x) walk(n.x, fn); if (n.pct) walk(n.pct, fn); if (n.args) for (const a of n.args) walk(a, fn); };
const serial = (d, t) => { // a date or a time of the file as a spreadsheet number
  if (d) { const m = /^(-?\d{4,})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d):(\d\d(?:\.\d+)?))?$/.exec(d); if (!m) return null; return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 864e5 + 25569 + (m[4] ? (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6])) / 86400 : 0); }
  const m = /^PT(\d+)H(\d+)M(\d+(?:\.\d+)?)S$/.exec(t || ''); return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / 86400 : null;
};

export function openOds(bytes) {
  const files = unzipSync(bytes);
  if (!files['content.xml']) throw new EditError('This is not a valid file of this type.');
  const doc = parseX(dec(files['content.xml']));
  if (doc.getElementsByTagName('parsererror').length) throw new EditError('This file could not be read for editing.');
  const root = doc.documentElement;
  const body = kids(root, 'body', NS.office)[0]; const book = body && kids(body, 'spreadsheet', NS.office)[0];
  if (!book) throw new EditError('This is not a valid file of this type.');
  const tables = kids(book, 'table').filter((t) => t.getAttributeNS(NS.table, 'display') !== 'false'); // the sheets the reader shows
  if (!tables.length) throw new EditError('This workbook has no sheets to edit.');
  let dirty = false;
  const tbl = (si) => { const t = tables[si]; if (!t) throw new EditError('That sheet is not there any more.'); return t; };
  let everyTable = kids(book, 'table'); // the hidden ones too: a formula may read them

  // rows in document order, whatever groups they sit in; columns declared
  const rowEls = (t) => { const out = []; const walk = (p) => { for (const c of p.children) { if (is(c, 'table-row')) out.push(c); else if (is(c, 'table-rows') || is(c, 'table-header-rows') || is(c, 'table-row-group')) walk(c); } }; walk(t); return out; };
  const colCount = (t) => { let n = 0; const walk = (p) => { for (const c of p.children) { if (is(c, 'table-column')) n += rep(c, 'number-columns-repeated'); else if (is(c, 'table-columns') || is(c, 'table-header-columns') || is(c, 'table-column-group')) walk(c); } }; walk(t); return n; };
  const setRep = (e, name, v) => { if (v > 1) e.setAttributeNS(NS.table, `table:${name}`, String(v)); else e.removeAttributeNS(NS.table, name); };
  const split = (el, name, k, n) => { // the element stands for n repeats; make repeat k its own and return it
    if (n === 1) return el;
    if (k > 0) { const b = el.cloneNode(true); setRep(b, name, k); el.parentNode.insertBefore(b, el); }
    if (n - 1 - k > 0) { const a = el.cloneNode(true); setRep(a, name, n - 1 - k); el.parentNode.insertBefore(a, el.nextSibling); }
    setRep(el, name, 1); return el;
  };
  const newCell = () => doc.createElementNS(NS.table, 'table:table-cell');
  const newRow = () => { const r = doc.createElementNS(NS.table, 'table:table-row'); r.appendChild(newCell()); return r; };

  // the row element for r: null when `make` is false and there is none
  const rowAt = (t, r, make) => {
    let start = 0; const rows = rowEls(t);
    for (const el of rows) { const n = rep(el, 'number-rows-repeated'); if (r < start + n) return make ? split(el, 'number-rows-repeated', r - start, n) : el; start += n; }
    if (!make) return null;
    const last = rows[rows.length - 1]; let host; let after;
    if (last) { host = last.parentNode; after = last.nextSibling; } else { host = t; const cols = [...t.children].filter((c) => /^table-(column|columns|header-columns|column-group)$/.test(c.localName)); after = cols.length ? cols[cols.length - 1].nextSibling : null; }
    if (r > start) { const gap = newRow(); setRep(gap, 'number-rows-repeated', r - start); host.insertBefore(gap, after); }
    const row = newRow(); host.insertBefore(row, after); return row;
  };
  const cellAt = (row, c, make) => {
    let start = 0;
    for (const el of [...row.children].filter(cellOf)) { const n = rep(el, 'number-columns-repeated'); if (c < start + n) return make ? split(el, 'number-columns-repeated', c - start, n) : el; start += n; }
    if (!make) return null;
    if (c > start) { const gap = newCell(); setRep(gap, 'number-columns-repeated', c - start); row.appendChild(gap); }
    const cell = newCell(); row.appendChild(cell); return cell;
  };
  const ensureCols = (t, c) => { // a cell beyond the declared columns needs a column
    const n = colCount(t); if (c < n) return;
    const col = doc.createElementNS(NS.table, 'table:table-column'); setRep(col, 'number-columns-repeated', c + 1 - n);
    const cols = [...t.children].filter((x) => /^table-(column|columns|header-columns|column-group)$/.test(x.localName));
    const last = cols[cols.length - 1]; t.insertBefore(col, last ? last.nextSibling : t.firstChild);
  };

  const merges = (si) => {
    const out = []; let r = 0;
    for (const row of rowEls(tbl(si))) {
      const rr = rep(row, 'number-rows-repeated'); let c = 0;
      for (const cell of [...row.children].filter(cellOf)) {
        const n = rep(cell, 'number-columns-repeated');
        const cs = Number(cell.getAttributeNS(NS.table, 'number-columns-spanned') || 1); const rs = Number(cell.getAttributeNS(NS.table, 'number-rows-spanned') || 1);
        if ((cs > 1 || rs > 1) && is(cell, 'table-cell')) out.push({ r, c, rs, cs });
        c += n;
      }
      r += rr;
    }
    return out;
  };
  const check = (si, r, c) => {
    if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0)) throw new EditError('That cell is not on the sheet.');
    if (r >= SHEET_ROW_MAX || c >= SHEET_COL_MAX) throw new EditError(`Cells beyond row ${SHEET_ROW_MAX} or column ${colName(SHEET_COL_MAX - 1)} cannot be edited here.`);
    for (const m of merges(si)) if (r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c)) throw new EditError('This cell is part of a merged cell; edit its top left cell.');
  };

  // the text of a paragraph, spaces, tabs and line breaks as the file means them
  const pText = (n) => {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (is(c, 's', NS.text)) s += ' '.repeat(Number(c.getAttributeNS(NS.text, 'c') || 1));
      else if (is(c, 'tab', NS.text)) s += '\t';
      else if (is(c, 'line-break', NS.text)) s += '\n';
      else if (c.nodeType === 1) s += pText(c);
    }
    return s;
  };
  const textOf = (el) => kids(el, 'p', NS.text).map(pText).join('\n');
  const vt = (el) => el.getAttributeNS(NS.office, 'value-type');
  const describe = (el) => {
    const t = vt(el); const f = el.getAttributeNS(NS.table, 'formula');
    let kind = 'empty'; let raw = '';
    if (t === 'float' || t === 'percentage' || t === 'currency') { kind = 'number'; raw = el.getAttributeNS(NS.office, 'value') || '0'; }
    else if (t === 'boolean') { kind = 'bool'; raw = el.getAttributeNS(NS.office, 'boolean-value') === 'true' ? 'TRUE' : 'FALSE'; }
    else if (t === 'string') { kind = 'text'; raw = kids(el, 'p', NS.text).length ? textOf(el) : el.getAttributeNS(NS.office, 'string-value') || ''; }
    else if (t === 'date' || t === 'time') { kind = 'text'; raw = textOf(el) || el.getAttributeNS(NS.office, t === 'date' ? 'date-value' : 'time-value') || ''; }
    else if (kids(el, 'p', NS.text).length) { kind = 'text'; raw = textOf(el); }
    return { kind, raw, formula: f ? (toA1(f) || '') : null, style: 0 };
  };
  const cell = (si, r, c) => {
    const row = rowAt(tbl(si), r, false); const el = row && cellAt(row, c, false);
    return el && is(el, 'table-cell') ? describe(el) : { kind: 'empty', raw: '', formula: null, style: 0 };
  };
  const locked = (si, r, c) => {
    try { check(si, r, c); } catch (e) { return e.message; }
    const row = rowAt(tbl(si), r, false); const el = row && cellAt(row, c, false);
    if (el && is(el, 'covered-table-cell')) return 'This cell is covered by an array formula or a merged cell.';
    if (el && el.hasAttributeNS(NS.table, 'number-matrix-columns-spanned')) return 'This cell starts an array formula, which cannot be changed here.';
    return null;
  };

  const VALUE = [['office', 'value-type'], ['office', 'value'], ['office', 'boolean-value'], ['office', 'string-value'], ['office', 'date-value'], ['office', 'time-value'], ['calcext', 'value-type']];
  const wipe = (el, keepKind, keepFormula) => { // the value of a cell removed; a percent or currency kind and the currency stay
    for (const [p, n] of VALUE) el.removeAttributeNS(NS[p], n);
    if (!keepFormula) el.removeAttributeNS(NS.table, 'formula');
    if (!keepKind) el.removeAttributeNS(NS.office, 'currency');
    for (const p of kids(el, 'p', NS.text)) p.remove();
  };
  const setType = (el, t) => {
    el.setAttributeNS(NS.office, 'office:value-type', t);
    if (root.hasAttribute('xmlns:calcext')) el.setAttributeNS(NS.calcext, 'calcext:value-type', t);
  };
  // ---- number formats (Decision 495) ----
  let stylesDoc = null;
  const stylesRoot = () => { if (stylesDoc === null) { stylesDoc = files['styles.xml'] ? parseX(dec(files['styles.xml'])) : false; } return stylesDoc && !stylesDoc.getElementsByTagName('parsererror').length ? stylesDoc.documentElement : null; };
  const autoBox = () => { let a = kids(root, 'automatic-styles', NS.office)[0]; if (!a) { a = doc.createElementNS(NS.office, 'office:automatic-styles'); root.insertBefore(a, body); } return a; };
  const pools = () => [autoBox(), ...[stylesRoot()].filter(Boolean).flatMap((r) => [kids(r, 'automatic-styles', NS.office)[0], kids(r, 'styles', NS.office)[0]].filter(Boolean))];
  const named = (tag, ns, name) => { for (const pl of pools()) for (const e of kids(pl, tag, ns)) if (e.getAttributeNS(NS.style, 'name') === name) return e; return null; };
  const styleNamed = (name) => (name ? named('style', NS.style, name) : null);
  const dataStyleName = (st) => { for (let k = 0; st && k < 6; k++) { const d = st.getAttributeNS(NS.style, 'data-style-name'); if (d) return d; st = styleNamed(st.getAttributeNS(NS.style, 'parent-style-name')); } return ''; };
  const colDefault = (t, c) => { let n = 0; let out = ''; const walk = (pp) => { for (const x of pp.children) { if (is(x, 'table-column')) { const k = rep(x, 'number-columns-repeated'); if (!out && c >= n && c < n + k) out = x.getAttributeNS(NS.table, 'default-cell-style-name') || ''; n += k; } else if (is(x, 'table-columns') || is(x, 'table-header-columns') || is(x, 'table-column-group')) walk(x); } }; walk(t); return out; };
  const dataEl = (name) => { for (const tag of ['number-style', 'percentage-style', 'date-style', 'time-style', 'text-style']) { const e = named(tag, NS.number, name); if (e) return e; } return null; };
  const codeOfStyle = (styleName) => {
    const dn = dataStyleName(styleNamed(styleName)); if (!dn) return 'General';
    const e = dataEl(dn); if (!e) return '';
    const parts = [];
    for (const x of e.children) {
      if (x.namespaceURI !== NS.number) continue; const nm = x.localName; const a = (k) => x.getAttributeNS(NS.number, k);
      if (nm === 'text') parts.push({ n: 'text', t: x.textContent });
      else if (nm === 'number') parts.push({ n: 'number', dec: Number(a('decimal-places') || 0), min: Number(a('min-integer-digits') || 1), group: a('grouping') === 'true' });
      else if (nm === 'year') parts.push({ n: 'year', long: a('style') === 'long' });
      else if (nm === 'month') parts.push({ n: 'month', long: a('style') === 'long', text: a('textual') === 'true' });
      else if (nm === 'day') parts.push({ n: 'day', long: a('style') === 'long' });
      else if (nm === 'day-of-week') parts.push({ n: 'day-of-week', long: a('style') === 'long' });
      else if (nm === 'hours') parts.push({ n: 'hours', long: a('style') === 'long' });
      else if (nm === 'minutes') parts.push({ n: 'minutes', long: a('style') === 'long' });
      else if (nm === 'seconds') parts.push({ n: 'seconds', long: a('style') === 'long' });
      else if (nm === 'am-pm') parts.push({ n: 'am-pm' });
      else if (nm === 'text-content') parts.push({ n: 'text-content' });
      else parts.push({ n: nm });
    }
    return fromOdf(e.localName, parts) ?? '';
  };
  const styleOfCell = (el, t, c) => el.getAttributeNS(NS.table, 'style-name') || colDefault(t, c);
  const shownNumber = (el, t, c, v) => { const code = codeOfStyle(styleOfCell(el, t, c)); const s = code && code !== 'General' && code !== '@' ? formatValue(v, code, false) : ''; return s === '' || s === undefined ? String(v) : String(s); };
  const addP = (el, line) => { // one paragraph; spaces that would collapse, and tabs, are written as the file expects
    const p = doc.createElementNS(NS.text, 'text:p');
    const parts = line.split(/(\t| +)/);
    parts.forEach((x, i) => {
      if (x === '') return;
      if (x === '\t') { p.appendChild(doc.createElementNS(NS.text, 'text:tab')); return; }
      if (/^ +$/.test(x)) {
        const inner = i > 0 && i < parts.length - 1 && parts[i - 1] !== '\t' && parts[i + 1] !== '\t' && parts[i - 1] !== '' && parts[i + 1] !== '';
        let k = x.length;
        if (inner) { p.appendChild(doc.createTextNode(' ')); k -= 1; }
        if (k > 0) { const s = doc.createElementNS(NS.text, 'text:s'); if (k > 1) s.setAttributeNS(NS.text, 'text:c', String(k)); p.appendChild(s); }
        return;
      }
      p.appendChild(doc.createTextNode(x));
    });
    el.appendChild(p);
  };

  // ---- formulas (Decision 494) ----
  const KEY = 16384;
  const has = (el) => el.hasAttributeNS(NS.office, 'value-type') || el.hasAttributeNS(NS.table, 'formula') || kids(el, 'p', NS.text).length > 0;
  const indexOf = (t) => { // the cells with content by position; one entry is shared by the cells a repeat stands for
    const map = new Map(); let r = 0;
    for (const row of rowEls(t)) {
      const rr = rep(row, 'number-rows-repeated'); const cells = [...row.children].filter(cellOf);
      if (!cells.some((x) => is(x, 'table-cell') && has(x))) { r += rr; continue; }
      for (let k = 0; k < rr && r + k < SHEET_ROW_MAX; k++) {
        let c = 0;
        for (const cl of cells) {
          const n = rep(cl, 'number-columns-repeated');
          if (is(cl, 'table-cell') && has(cl)) for (let j = 0; j < n && c + j < SHEET_COL_MAX; j++) map.set((r + k) * KEY + c + j, { el: cl, r: r + k, c: c + j, multi: rr > 1 || n > 1 });
          c += n;
        }
      }
      r += rr;
    }
    return map;
  };
  const parsed = new Map(); // formula text -> { tree, text }, or null when the calculator does not cover it
  const parseF = (t) => { if (!parsed.has(t)) { let p = null; try { p = parse(t); } catch (e) { if (!(e instanceof CalcError)) throw e; } parsed.set(t, p); } return parsed.get(t); };
  const valOf = (el) => { // the value a cell holds, as the calculator takes it
    const t = vt(el);
    if (t === 'float' || t === 'percentage' || t === 'currency') { const x = Number(el.getAttributeNS(NS.office, 'value')); return Number.isFinite(x) ? x : null; }
    if (t === 'boolean') return el.getAttributeNS(NS.office, 'boolean-value') === 'true';
    if (t === 'date' || t === 'time') return serial(el.getAttributeNS(NS.office, 'date-value'), el.getAttributeNS(NS.office, 'time-value'));
    if (t === 'string') { const x = textOf(el) || el.getAttributeNS(NS.office, 'string-value') || ''; return el.getAttributeNS(NS.calcext, 'value-type') === 'error' ? { err: x } : x; }
    return kids(el, 'p', NS.text).length ? textOf(el) : null;
  };
  const near = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : a === b || (a && b && typeof a === 'object' && typeof b === 'object' && a.err === b.err));
  const compute = () => { // every formula calculated again in dependency order; nothing is written here
    const idx = everyTable.map(indexOf); const names = everyTable.map((t) => t.getAttributeNS(NS.table, 'name'));
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    const memo = new Map(); const stack = []; const cyc = new Set(); const formulaOf = (e) => (e.multi ? null : e.el.getAttributeNS(NS.table, 'formula'));
    const val = (ti, r, c) => {
      const e = idx[ti].get(r * KEY + c); if (!e) return null;
      const f = formulaOf(e); const a1 = f ? toA1(f) : null; const p = a1 === null ? null : parseF(a1);
      if (!p || ['date', 'time'].includes(vt(e.el))) return valOf(e.el);
      const key = `${ti}:${r}:${c}`; if (memo.has(key)) return memo.get(key);
      if (stack.includes(key)) { for (const k of stack.slice(stack.indexOf(key))) cyc.add(k); return valOf(e.el); }
      stack.push(key); let v;
      try { v = run(p.tree, ctxFor(ti)); } catch (err) { v = valOf(e.el); }
      stack.pop(); memo.set(key, v); return v;
    };
    const ctxFor = (ti) => ({ sheet: names[ti], has: (n) => names.some((x) => same(x, n)), cell: (n, r, c) => { const k = names.findIndex((x) => same(x, n)); return k >= 0 ? val(k, r, c) : null; } });
    const changes = [];
    idx.forEach((map, ti) => {
      for (const e of map.values()) {
        const f = formulaOf(e); const a1 = f ? toA1(f) : null; if (a1 === null || !parseF(a1) || ['date', 'time'].includes(vt(e.el))) continue;
        const v = val(ti, e.r, e.c); const had = vt(e.el);
        if (!(had && near(v, valOf(e.el)))) changes.push({ ti, r: e.r, c: e.c, el: e.el, v });
      }
    });
    return { changes, cyc, names };
  };
  const putValue = (el, v, tb, c) => { // a result stored beside its formula
    const was = vt(el); const kept = (was === 'percentage' || was === 'currency') && typeof v === 'number';
    wipe(el, kept, true);
    if (v !== null && typeof v === 'object') { setType(el, 'string'); if (root.hasAttribute('xmlns:calcext')) el.setAttributeNS(NS.calcext, 'calcext:value-type', 'error'); addP(el, v.err); }
    else if (typeof v === 'boolean') { setType(el, 'boolean'); el.setAttributeNS(NS.office, 'office:boolean-value', v ? 'true' : 'false'); addP(el, v ? 'TRUE' : 'FALSE'); }
    else if (typeof v === 'string') { setType(el, 'string'); for (const line of v.split('\n')) addP(el, line); }
    else { const x = String(v === null ? 0 : v); setType(el, kept ? was : 'float'); el.setAttributeNS(NS.office, 'office:value', x); addP(el, shownNumber(el, tb, c, Number(x))); }
  };
  const apply = (plan) => { // returns the cells changed, by sheet shown
    const out = [];
    for (const ch of plan.changes) { putValue(ch.el, ch.v, everyTable[ch.ti], ch.c); dirty = true; const si = tables.indexOf(everyTable[ch.ti]); if (si >= 0) out.push({ si, r: ch.r, c: ch.c }); }
    return out;
  };
  const settle = (si, r, c) => { const list = apply(compute()); if (!list.some((x) => x.si === si && x.r === r && x.c === c)) list.push({ si, r, c }); return list; };
  const setFormula = (si, r, c, src) => {
    let p; try { p = parse(src); } catch (e) { if (e instanceof CalcError) throw new EditError(e.message); throw e; }
    const names = everyTable.map((t) => t.getAttributeNS(NS.table, 'name').toLowerCase());
    walk(p.tree, (n) => {
      if (n.ref && n.ref.sheet && !names.includes(n.ref.sheet.toLowerCase())) throw new EditError(`There is no sheet named ${n.ref.sheet}.`);
      if (wholeAxis(n)) throw new EditError('A whole column or row cannot be written into an ods formula yet.');
    });
    const t = tbl(si); ensureCols(t, c);
    const el = cellAt(rowAt(t, r, true), c, true); const before = el.cloneNode(true);
    wipe(el, false, false); el.setAttributeNS(NS.table, 'table:formula', fromA1(p.text));
    const plan = compute(); const key = `${everyTable.indexOf(t)}:${r}:${c}`;
    if (plan.cyc.has(key)) { el.replaceWith(before); throw new EditError('This formula refers to its own cell, directly or through other cells.'); }
    dirty = true; return settle(si, r, c);
  };

  // write what was typed: a number, TRUE or FALSE, a formula (=…), or text (a leading ' keeps a number or a formula as text); empty clears the cell
  const setCell = (si, r, c, input) => {
    const why = locked(si, r, c); if (why) throw new EditError(why);
    const text = String(input === null || input === undefined ? '' : input);
    if (/^\s*=/.test(text) && text.trim().length > 1) return setFormula(si, r, c, text.trim().slice(1));
    const t = tbl(si); const old = cell(si, r, c);
    if (text === '' && old.kind === 'empty' && old.formula === null) return [];
    ensureCols(t, c);
    const row = rowAt(t, r, true); const el = cellAt(row, c, true);
    const was = vt(el);
    const trimmed = text.trim();
    if (text === '') { wipe(el, false, false); dirty = true; return settle(si, r, c); }
    const keep = (was === 'percentage' || was === 'currency') && text[0] !== "'" && NUMBER.test(trimmed);
    wipe(el, keep, false);
    if (text[0] !== "'" && NUMBER.test(trimmed) && Number.isFinite(Number(trimmed))) {
      const v = String(Number(trimmed)); setType(el, keep ? was : 'float'); el.setAttributeNS(NS.office, 'office:value', v); addP(el, shownNumber(el, t, c, Number(v)));
    } else if (text[0] !== "'" && /^(true|false)$/i.test(trimmed)) {
      const b = /^true$/i.test(trimmed); setType(el, 'boolean'); el.setAttributeNS(NS.office, 'office:boolean-value', b ? 'true' : 'false'); addP(el, b ? 'TRUE' : 'FALSE');
    } else {
      const s = text[0] === "'" ? text.slice(1) : text;
      setType(el, 'string'); for (const line of s.split('\n')) addP(el, line);
    }
    dirty = true; return settle(si, r, c);
  };

  const format = (si, r, c) => { // the format code of a cell: General, a code, or '' when the style is one this editor does not read
    const t = tbl(si); const row = rowAt(t, r, false); const el = row && cellAt(row, c, false);
    return codeOfStyle(el ? styleOfCell(el, t, c) : colDefault(t, c));
  };
  const freeName = (base) => { const used = new Set(); for (const pl of pools()) for (const e of pl.children) used.add(e.getAttributeNS(NS.style, 'name')); let k = 1; while (used.has(`${base}${k}`)) k++; return `${base}${k}`; };
  const made = new Map(); // code -> data style name, styles made in this session
  const dataStyleFor = (code, spec) => {
    if (made.has(code)) return made.get(code);
    const name = freeName('NArkly'); const e = doc.createElementNS(NS.number, `number:${spec.tag}`);
    e.setAttributeNS(NS.style, 'style:name', name);
    if (spec.tag === 'date-style' || spec.tag === 'time-style') e.setAttributeNS(NS.number, 'number:automatic-order', 'false');
    for (const p of spec.parts) {
      const mk = (n) => doc.createElementNS(NS.number, `number:${n}`);
      if (p.n === 'text') { const x = mk('text'); x.textContent = p.t; e.appendChild(x); }
      else if (p.n === 'number') { const x = mk('number'); x.setAttributeNS(NS.number, 'number:decimal-places', String(p.dec)); x.setAttributeNS(NS.number, 'number:min-integer-digits', String(p.min)); if (p.group) x.setAttributeNS(NS.number, 'number:grouping', 'true'); e.appendChild(x); }
      else {
        const x = mk(p.n); if (p.long !== undefined) x.setAttributeNS(NS.number, 'number:style', p.long ? 'long' : 'short');
        if (p.n === 'month') x.setAttributeNS(NS.number, 'number:textual', p.text ? 'true' : 'false');
        e.appendChild(x);
      }
    }
    autoBox().appendChild(e); made.set(code, name); return name;
  };
  const cellStyles = new Map(); // base style + data style -> the cell style made for it
  const styleFor = (base, dataName) => {
    const key = `${base}|${dataName}`; if (cellStyles.has(key)) return cellStyles.get(key);
    const src = base ? styleNamed(base) : null; const name = freeName('ceArkly'); let st;
    if (src && src.parentNode === autoBox()) st = src.cloneNode(true); // an automatic style keeps what it holds
    else { st = doc.createElementNS(NS.style, 'style:style'); st.setAttributeNS(NS.style, 'style:family', 'table-cell'); if (base) st.setAttributeNS(NS.style, 'style:parent-style-name', base); }
    st.setAttributeNS(NS.style, 'style:name', name);
    if (dataName) st.setAttributeNS(NS.style, 'style:data-style-name', dataName); else st.removeAttributeNS(NS.style, 'data-style-name');
    autoBox().appendChild(st); cellStyles.set(key, name); return name;
  };
  const setFormat = (si, r, c, code) => {
    check(si, r, c);
    const k = String(code === null || code === undefined ? '' : code).trim();
    if (!k || k.length > 80) throw new EditError('That format code could not be used.');
    const general = k.toLowerCase() === 'general'; const spec = general ? null : toOdf(k);
    const t = tbl(si); ensureCols(t, c);
    if (format(si, r, c) === (general ? 'General' : k)) return;
    const row = rowAt(t, r, true); const el = cellAt(row, c, true);
    if (is(el, 'covered-table-cell')) throw new EditError('This cell is covered by an array formula or a merged cell.');
    const base = styleOfCell(el, t, c);
    if (general && dataStyleName(styleNamed(base)) && !(styleNamed(base) && styleNamed(base).parentNode === autoBox())) throw new EditError('The format of this cell comes from a named style and cannot be reset to General here.');
    el.setAttributeNS(NS.table, 'table:style-name', styleFor(base, spec ? dataStyleFor(k, spec) : ''));
    // the shown text follows: a number is formatted, a date or time cell becomes a number when the format is not one
    const ty = vt(el); const isDate = spec && (spec.tag === 'date-style' || spec.tag === 'time-style');
    let n = null;
    if (ty === 'float' || ty === 'percentage' || ty === 'currency') n = Number(el.getAttributeNS(NS.office, 'value'));
    else if (ty === 'date' || ty === 'time') n = serial(el.getAttributeNS(NS.office, 'date-value'), el.getAttributeNS(NS.office, 'time-value'));
    if (n !== null && Number.isFinite(n)) {
      if ((ty === 'date' || ty === 'time') && !isDate) { for (const a of ['date-value', 'time-value']) el.removeAttributeNS(NS.office, a); setType(el, 'float'); el.setAttributeNS(NS.office, 'office:value', String(n)); }
      if (spec && spec.tag === 'percentage-style' && ty === 'float') setType(el, 'percentage');
      else if (ty === 'percentage' && !(spec && spec.tag === 'percentage-style')) setType(el, 'float');
      for (const p of kids(el, 'p', NS.text)) p.remove();
      const shown = general || k === '@' ? '' : formatValue(n, k, false);
      addP(el, shown === '' || shown === undefined ? String(n) : String(shown));
    }
    dirty = true;
  };

  // ---- rows, columns and sheets (Decision 496) ----
  const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
  const blocker = () => { // why the structure cannot be changed, or null
    const some = (ns, name, deep) => [...doc.getElementsByTagNameNS(ns, name)].some((e) => (deep ? true : e.children.length > 0));
    const filled = (name) => some(NS.table, name, false); const embedded = Object.keys(files).some((k) => /^Object \d+\//.test(k));
    const printed = [...doc.getElementsByTagNameNS(NS.table, 'table')].some((t) => t.hasAttributeNS(NS.table, 'print-ranges'));
    const matrix = [...doc.getElementsByTagNameNS(NS.table, 'table-cell')].some((x) => x.hasAttributeNS(NS.table, 'number-matrix-columns-spanned'));
    if (filled('named-expressions') || filled('database-ranges') || filled('data-pilot-tables') || filled('content-validations') || some(NS.table, 'filter', true) || [...doc.getElementsByTagNameNS(NS.calcext, 'conditional-formats')].length || [...doc.getElementsByTagName('*')].some((e) => e.namespaceURI === DRAW) || embedded || printed) return 'This workbook has named ranges, validation, filters, conditional formats, pictures or charts, which this editor does not move yet, so rows, columns and sheets cannot be changed here.';
    if (matrix) return 'This workbook has array formulas, which this editor does not move yet, so rows, columns and sheets cannot be changed here.';
    for (const t of everyTable) for (const x of t.getElementsByTagNameNS(NS.table, 'table-cell')) { const f = x.getAttributeNS(NS.table, 'formula'); if (f && toA1(f) === null) return 'A formula of this workbook is not one this editor can follow, so rows, columns and sheets cannot be changed here.'; }
    return null;
  };
  const rewriteAll = (fn) => { // every formula, as A1 text, rewritten; the ods text is written only where the text changed
    for (const t of everyTable) {
      const own = t.getAttributeNS(NS.table, 'name');
      for (const x of t.getElementsByTagNameNS(NS.table, 'table-cell')) {
        const f = x.getAttributeNS(NS.table, 'formula'); if (!f) continue;
        const a1 = toA1(f); const nt = fn(a1, own); if (nt !== a1) x.setAttributeNS(NS.table, 'table:formula', fromA1(nt));
      }
    }
  };
  const follow = () => { try { apply(compute()); } catch (e) { /* the change stands; stored results stay */ } };
  const colEls = (t) => { const out = []; const walkc = (pp) => { for (const x of pp.children) { if (is(x, 'table-column')) out.push(x); else if (is(x, 'table-columns') || is(x, 'table-header-columns') || is(x, 'table-column-group')) walkc(x); } }; walkc(t); return out; };
  const shrink = (els, name, at, n) => { let start = 0; for (const el of els) { const k = rep(el, name); const o = Math.min(start + k, at + n) - Math.max(start, at); if (o > 0) { if (o === k) el.remove(); else setRep(el, name, k - o); } start += k; } };
  const total = (els, name) => els.reduce((a, el) => a + rep(el, name), 0);
  const cutCheck = (si, axis, at, n, del) => {
    for (const m of merges(si)) {
      const lo = axis === 'r' ? m.r : m.c; const hi = lo + (axis === 'r' ? m.rs : m.cs) - 1; const e = at + n - 1;
      if (del ? !(e < lo || at > hi) && !(at <= lo && e >= hi) : at > lo && at <= hi) throw new EditError('This change would cut a merged cell; the merged cell is not changed here.');
    }
  };
  const moveAxis = (si, axis, at, n, del) => {
    if (!(Number.isInteger(at) && Number.isInteger(n) && at >= 0 && n >= 1 && at < (axis === 'r' ? SHEET_ROW_MAX : SHEET_COL_MAX))) throw new EditError(axis === 'r' ? 'That row is not on the sheet.' : 'That column is not on the sheet.');
    const why = blocker(); if (why) throw new EditError(why);
    cutCheck(si, axis, at, n, del);
    const t = tbl(si); const name = t.getAttributeNS(NS.table, 'name'); const op = { sheet: name, axis, at, n, del };
    if (axis === 'r') {
      const rows = rowEls(t);
      if (del) shrink(rows, 'number-rows-repeated', at, n);
      else if (at < total(rows, 'number-rows-repeated')) { const el = rowAt(t, at, true); const fresh = newRow(); setRep(fresh, 'number-rows-repeated', n); el.parentNode.insertBefore(fresh, el); }
    } else {
      for (const row of rowEls(t)) {
        const cells = [...row.children].filter(cellOf);
        if (del) shrink(cells, 'number-columns-repeated', at, n);
        else if (at < total(cells, 'number-columns-repeated')) { const el = cellAt(row, at, true); const fresh = newCell(); setRep(fresh, 'number-columns-repeated', n); row.insertBefore(fresh, el); }
      }
      const cols = colEls(t);
      if (del) shrink(cols, 'number-columns-repeated', at, n);
      else if (at < total(cols, 'number-columns-repeated')) {
        let start = 0; for (const el of cols) { const k = rep(el, 'number-columns-repeated'); if (at < start + k) { const own = split(el, 'number-columns-repeated', at - start, k); const fresh = own.cloneNode(true); setRep(fresh, 'number-columns-repeated', n); own.parentNode.insertBefore(fresh, own); break; } start += k; }
      }
    }
    rewriteAll((x, own) => mapRefs(x, own, structFn(op)));
    dirty = true; follow();
  };
  const goodName = (name, except) => {
    const nm = String(name === null || name === undefined ? '' : name).trim();
    if (!nm) throw new EditError('A sheet needs a name.');
    if (nm.length > 31) throw new EditError('A sheet name can have at most 31 characters.');
    if (/[:\\/?*[\]]/.test(nm)) throw new EditError('A sheet name cannot contain : \\ / ? * [ ]');
    if (/^'|'$/.test(nm)) throw new EditError('A sheet name cannot start or end with an apostrophe.');
    if (everyTable.some((x) => x !== except && String(x.getAttributeNS(NS.table, 'name')).toLowerCase() === nm.toLowerCase())) throw new EditError('Another sheet already has that name.');
    return nm;
  };
  const renameSheet = (si, name) => {
    const t = tbl(si); const nn = goodName(name, t); const old = t.getAttributeNS(NS.table, 'name'); if (nn === old) return;
    const why = blocker(); if (why) throw new EditError(why);
    rewriteAll((x) => renamePrefix(x, old, nn));
    t.setAttributeNS(NS.table, 'table:name', nn); dirty = true; follow();
  };
  const addSheet = (name) => {
    const nn = goodName(name, null);
    const t = doc.createElementNS(NS.table, 'table:table'); t.setAttributeNS(NS.table, 'table:name', nn);
    t.appendChild(doc.createElementNS(NS.table, 'table:table-column')); t.appendChild(newRow());
    const last = everyTable[everyTable.length - 1]; last.parentNode.insertBefore(t, last.nextSibling);
    everyTable = kids(book, 'table'); tables.push(t); dirty = true; return tables.length - 1;
  };
  const deleteSheet = (si) => {
    const t = tbl(si); if (tables.length < 2) throw new EditError('A workbook needs at least one sheet.');
    const why = blocker(); if (why) throw new EditError(why);
    const gone = t.getAttributeNS(NS.table, 'name');
    rewriteAll((x) => removeSheetRefs(x, gone));
    t.remove(); tables.splice(si, 1); everyTable = kids(book, 'table'); dirty = true; follow();
  };

  const ser = () => enc('<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));
  const snapshot = () => { const all = { ...files }; if (dirty) all['content.xml'] = ser(); return all; };
  const toBytes = () => {
    const all = snapshot(); const out = {};
    if (all.mimetype) out.mimetype = [all.mimetype, { level: 0 }]; // first, not compressed
    for (const k of Object.keys(all)) if (k !== 'mimetype') out[k] = [all[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { kind: 'ods', names: () => tables.map((t, k) => t.getAttributeNS(NS.table, 'name') || `Sheet ${k + 1}`), cell, locked, setCell, merges, snapshot, toBytes, format, setFormat, dirty: () => dirty,
    insertRows: (si, at, n = 1) => moveAxis(si, 'r', at, n, false), deleteRows: (si, at, n = 1) => moveAxis(si, 'r', at, n, true),
    insertCols: (si, at, n = 1) => moveAxis(si, 'c', at, n, false), deleteCols: (si, at, n = 1) => moveAxis(si, 'c', at, n, true),
    renameSheet, addSheet, deleteSheet };
}
