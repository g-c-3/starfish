// Spreadsheet edit engine, ods (Decision 493, Phase 120 step 5a). Works on `content.xml` in place: a changed cell is written, every other part
// of the zip is kept as it was. Same shape as xlsxedit.js (names, cell, locked, setCell, merges, snapshot, toBytes, dirty) so the editor view takes either.
// Repeated rows and cells (`number-rows-repeated`, `number-columns-repeated`) are split only where a cell is written. Formulas (Decision 494):
// a formula in the ods syntax (`of:=SUM([.A1:.A3])`) is turned into the A1 text the calculator of xlsxcalc.js reads, and back; every formula is
// calculated again after a change and its result stored beside it. A formula the calculator does not understand keeps its stored result.
// Formats, rows, columns and sheets for ods are the next step.
import { unzipSync, zipSync } from 'fflate';
import { SHEET_ROW_MAX, SHEET_COL_MAX, colName } from './office-read.js';
import { parse, run, CalcError } from './xlsxcalc.js';

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  calcext: 'urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0'
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
      REF_ODS.lastIndex = i; const m = REF_ODS.exec(s); if (!m) return null;
      const p1 = m[1] ? `${quoteName(unquote(m[1]))}!` : ''; const p2 = m[3] ? unquote(m[3]) : null;
      if (p2 !== null && m[1] && unquote(m[1]) !== p2) return null; // a range over two sheets
      out += p1 + m[2] + (m[4] ? `:${m[4]}` : ''); i = REF_ODS.lastIndex; continue;
    }
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
  const everyTable = kids(book, 'table'); // the hidden ones too: a formula may read them

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
  const putValue = (el, v) => { // a result stored beside its formula
    const was = vt(el); const kept = (was === 'percentage' || was === 'currency') && typeof v === 'number';
    wipe(el, kept, true);
    if (v !== null && typeof v === 'object') { setType(el, 'string'); if (root.hasAttribute('xmlns:calcext')) el.setAttributeNS(NS.calcext, 'calcext:value-type', 'error'); addP(el, v.err); }
    else if (typeof v === 'boolean') { setType(el, 'boolean'); el.setAttributeNS(NS.office, 'office:boolean-value', v ? 'true' : 'false'); addP(el, v ? 'TRUE' : 'FALSE'); }
    else if (typeof v === 'string') { setType(el, 'string'); for (const line of v.split('\n')) addP(el, line); }
    else { const x = String(v === null ? 0 : v); setType(el, kept ? was : 'float'); el.setAttributeNS(NS.office, 'office:value', x); addP(el, x); }
  };
  const apply = (plan) => { // returns the cells changed, by sheet shown
    const out = [];
    for (const ch of plan.changes) { putValue(ch.el, ch.v); dirty = true; const si = tables.indexOf(everyTable[ch.ti]); if (si >= 0) out.push({ si, r: ch.r, c: ch.c }); }
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
      const v = String(Number(trimmed)); setType(el, keep ? was : 'float'); el.setAttributeNS(NS.office, 'office:value', v); addP(el, v);
    } else if (text[0] !== "'" && /^(true|false)$/i.test(trimmed)) {
      const b = /^true$/i.test(trimmed); setType(el, 'boolean'); el.setAttributeNS(NS.office, 'office:boolean-value', b ? 'true' : 'false'); addP(el, b ? 'TRUE' : 'FALSE');
    } else {
      const s = text[0] === "'" ? text.slice(1) : text;
      setType(el, 'string'); for (const line of s.split('\n')) addP(el, line);
    }
    dirty = true; return settle(si, r, c);
  };

  const ser = () => enc('<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''));
  const snapshot = () => { const all = { ...files }; if (dirty) all['content.xml'] = ser(); return all; };
  const toBytes = () => {
    const all = snapshot(); const out = {};
    if (all.mimetype) out.mimetype = [all.mimetype, { level: 0 }]; // first, not compressed
    for (const k of Object.keys(all)) if (k !== 'mimetype') out[k] = [all[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { kind: 'ods', names: () => tables.map((t, k) => t.getAttributeNS(NS.table, 'name') || `Sheet ${k + 1}`), cell, locked, setCell, merges, snapshot, toBytes, dirty: () => dirty };
}
