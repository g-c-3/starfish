// Spreadsheet edit engine, ods (Decision 493, Phase 120 step 5a). Works on `content.xml` in place: a changed cell is written, every other part
// of the zip is kept as it was. Same shape as xlsxedit.js (names, cell, locked, setCell, merges, snapshot, toBytes, dirty) so the editor view takes either.
// Repeated rows and cells (`number-rows-repeated`, `number-columns-repeated`) are split only where a cell is written. A workbook that holds formulas
// is not changed here yet (the stored results would go out of date); formulas, formats, rows, columns and sheets for ods are the next step.
import { unzipSync, zipSync } from 'fflate';
import { SHEET_ROW_MAX, SHEET_COL_MAX, colName } from './office-read.js';

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
  const hasFormulas = [...doc.getElementsByTagNameNS(NS.table, 'table-cell')].some((c) => c.hasAttributeNS(NS.table, 'formula'));

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
    return { kind, raw, formula: f ? f.replace(/^of:=?/, '') : null, style: 0 };
  };
  const cell = (si, r, c) => {
    const row = rowAt(tbl(si), r, false); const el = row && cellAt(row, c, false);
    return el && is(el, 'table-cell') ? describe(el) : { kind: 'empty', raw: '', formula: null, style: 0 };
  };
  const locked = (si, r, c) => {
    try { check(si, r, c); } catch (e) { return e.message; }
    const x = cell(si, r, c);
    if (x.formula !== null) return 'This cell holds a formula; formulas in an ods cannot be changed here yet.';
    if (hasFormulas) return 'This workbook has formulas, and an ods is not recalculated here yet: a change could leave its totals out of date.';
    return null;
  };

  const VALUE = [['office', 'value-type'], ['office', 'value'], ['office', 'boolean-value'], ['office', 'string-value'], ['office', 'date-value'], ['office', 'time-value'], ['calcext', 'value-type']];
  const wipe = (el, keepKind) => { // the value of a cell removed; a percent or currency kind and the currency stay
    for (const [p, n] of VALUE) el.removeAttributeNS(NS[p], n);
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

  // write what was typed: a number, TRUE or FALSE, or text (a leading ' keeps a number as text); empty clears the cell
  const setCell = (si, r, c, input) => {
    const why = locked(si, r, c); if (why) throw new EditError(why);
    const text = String(input === null || input === undefined ? '' : input);
    if (/^\s*=/.test(text) && text.trim().length > 1) throw new EditError('Formulas in an ods cannot be entered here yet.');
    const t = tbl(si); const old = cell(si, r, c);
    if (text === '' && old.kind === 'empty') return [];
    ensureCols(t, c);
    const row = rowAt(t, r, true); const el = cellAt(row, c, true);
    const was = vt(el);
    const trimmed = text.trim();
    if (text === '') { wipe(el, false); dirty = true; return [{ si, r, c }]; }
    const keep = (was === 'percentage' || was === 'currency') && text[0] !== "'" && NUMBER.test(trimmed);
    wipe(el, keep);
    if (text[0] !== "'" && NUMBER.test(trimmed) && Number.isFinite(Number(trimmed))) {
      const v = String(Number(trimmed)); setType(el, keep ? was : 'float'); el.setAttributeNS(NS.office, 'office:value', v); addP(el, v);
    } else if (text[0] !== "'" && /^(true|false)$/i.test(trimmed)) {
      const b = /^true$/i.test(trimmed); setType(el, 'boolean'); el.setAttributeNS(NS.office, 'office:boolean-value', b ? 'true' : 'false'); addP(el, b ? 'TRUE' : 'FALSE');
    } else {
      const s = text[0] === "'" ? text.slice(1) : text;
      setType(el, 'string'); for (const line of s.split('\n')) addP(el, line);
    }
    dirty = true; return [{ si, r, c }];
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
