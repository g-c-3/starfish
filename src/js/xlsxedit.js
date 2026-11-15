// Spreadsheet edit engine, xlsx (Decision 488). Works on the sheet XML in place: a changed cell is written, every other byte of the
// package is kept. No screen here; the editor view of Phase 120 maps grid cells to (sheet, row, column).
// Text is written as an inline string (no shared string table to keep in step). A formula is never written or recalculated here:
// a cell with a formula can be overwritten by a value, a shared or array formula start cannot, and the workbook is marked to
// recalculate when another app opens it, because stored results of formulas that read a changed cell are then out of date.
import { unzipSync, zipSync } from 'fflate';
import { SHEET_ROW_MAX, SHEET_COL_MAX, colName } from './office-read.js';

const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XMLNS = 'http://www.w3.org/XML/1998/namespace';
const STORED = /\.(png|jpe?g|gif|webp|zip|mp[34]|docx|xlsx|pptx)$/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const WB = 'xl/workbook.xml';
const WB_RELS = 'xl/_rels/workbook.xml.rels';
const AFTER_CALC = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTags', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'];

export class EditError extends Error { constructor(m) { super(m); this.office = true; } }

const isS = (n, name) => !!n && n.nodeType === 1 && n.namespaceURI === S && n.localName === name;
const kids = (n, name) => (n ? [...n.children].filter((c) => isS(c, name)) : []);
const kid = (n, name) => kids(n, name)[0] || null;
const dec = (b) => new TextDecoder('utf-8').decode(b);
const enc = (s) => new TextEncoder().encode(s);
const parseX = (s) => new DOMParser().parseFromString(s, 'application/xml');
const colIndex = (ref) => { const m = /^([A-Z]+)/i.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const rowOfRef = (ref) => { const m = /(\d+)$/.exec(ref || ''); return m ? Number(m[1]) - 1 : -1; };
const norm = (base, target) => { // a relationship target as a path in the package
  if (target[0] === '/') return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
};

export function openXlsx(bytes) {
  const files = unzipSync(bytes);
  if (!files[WB]) throw new EditError('This is not a valid file of this type.');
  const wbDoc = parseX(dec(files[WB]));
  if (wbDoc.getElementsByTagName('parsererror').length) throw new EditError('This file could not be read for editing.');
  const wbRoot = wbDoc.documentElement;
  const relDoc = files[WB_RELS] ? parseX(dec(files[WB_RELS])) : null;
  const target = {};
  if (relDoc) for (const r of relDoc.documentElement.children) target[r.getAttribute('Id')] = norm(WB, r.getAttribute('Target') || '');

  // shared strings, as the reader takes them: the text of plain and rich runs, not the phonetic ones
  const sst = [];
  if (files['xl/sharedStrings.xml']) {
    const sd = parseX(dec(files['xl/sharedStrings.xml']));
    for (const si of kids(sd.documentElement, 'si')) {
      let s = ''; const walk = (n) => { for (const c of n.children) { if (isS(c, 't')) s += c.textContent; else if (isS(c, 'r')) walk(c); } };
      walk(si); sst.push(s);
    }
  }

  // the sheets the reader shows, in its order (hidden ones left out)
  const sheets = [];
  for (const s of kids(kid(wbRoot, 'sheets'), 'sheet')) {
    const st = s.getAttribute('state'); if (st === 'hidden' || st === 'veryHidden') continue;
    let path = null; for (const a of s.attributes) if (a.localName === 'id' && a.value in target) path = target[a.value];
    if (path && files[path]) sheets.push({ name: s.getAttribute('name') || 'Sheet', path });
  }
  if (!sheets.length) throw new EditError('This workbook has no sheets to edit.');

  const cache = new Map(); const dirty = new Set(); let chainDirty = false;
  const part = (si) => {
    const sh = sheets[si]; if (!sh) throw new EditError('That sheet is not there any more.');
    if (!cache.has(si)) {
      const doc = parseX(dec(files[sh.path]));
      const root = doc.documentElement; const sd = kid(root, 'sheetData');
      if (doc.getElementsByTagName('parsererror').length || !sd) throw new EditError('This sheet could not be read for editing.');
      cache.set(si, { doc, root, sd });
    }
    return cache.get(si);
  };

  // rows and cells carry their own numbers, or follow the one before, as the reader counts them
  const rowsOf = (sd) => { let no = -1; return kids(sd, 'row').map((el) => { const r = el.getAttribute('r'); no = r ? Number(r) - 1 : no + 1; return { el, no }; }); };
  const cellsOf = (row) => { let no = -1; return kids(row, 'c').map((el) => { const r = el.getAttribute('r'); no = r ? colIndex(r) : no + 1; return { el, no }; }); };
  const find = (sd, r, c) => { const row = rowsOf(sd).find((x) => x.no === r); const cell = row && cellsOf(row.el).find((x) => x.no === c); return { row: row ? row.el : null, cell: cell ? cell.el : null }; };
  const merges = (si) => kids(kid(part(si).root, 'mergeCells'), 'mergeCell').map((m) => {
    const [a, b] = (m.getAttribute('ref') || '').split(':'); const r0 = rowOfRef(a); const c0 = colIndex(a); const r1 = b ? rowOfRef(b) : r0; const c1 = b ? colIndex(b) : c0;
    return { r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1 };
  });
  const check = (si, r, c) => {
    if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0)) throw new EditError('That cell is not on the sheet.');
    if (r >= SHEET_ROW_MAX || c >= SHEET_COL_MAX) throw new EditError(`Cells beyond row ${SHEET_ROW_MAX} or column ${colName(SHEET_COL_MAX - 1)} cannot be edited here.`);
    for (const m of merges(si)) if (r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c)) throw new EditError('This cell is part of a merged cell; edit its top left cell.');
  };

  // what a cell holds: the value to edit (the raw number, the text) and whether it is a formula
  const cell = (si, r, c) => {
    const { sd } = part(si); const { cell: el } = find(sd, r, c);
    if (!el) return { kind: 'empty', raw: '', formula: null, style: 0 };
    const t = el.getAttribute('t'); const v = kid(el, 'v'); const f = kid(el, 'f'); const style = Number(el.getAttribute('s') || 0);
    let kind = 'empty'; let raw = '';
    if (t === 'inlineStr') { kind = 'text'; raw = [...(kid(el, 'is') || el).getElementsByTagNameNS(S, 't')].map((x) => x.textContent).join(''); }
    else if (v) {
      const x = v.textContent;
      if (t === 's') { kind = 'text'; raw = sst[Number(x)] ?? ''; }
      else if (t === 'b') { kind = 'bool'; raw = x === '1' ? 'TRUE' : 'FALSE'; }
      else if (t === 'e') { kind = 'error'; raw = x; }
      else if (t === 'str') { kind = 'text'; raw = x; }
      else { kind = 'number'; raw = x; }
    }
    return { kind, raw, formula: f ? f.textContent : null, style };
  };
  // why a cell cannot be written, or null
  const locked = (si, r, c) => {
    try { check(si, r, c); } catch (e) { return e.message; }
    const { sd } = part(si); const { cell: el } = find(sd, r, c); const f = el && kid(el, 'f');
    if (f && (f.getAttribute('t') === 'array' || (f.getAttribute('t') === 'shared' && f.getAttribute('ref')))) return 'This cell starts a shared or array formula and cannot be changed here.';
    return null;
  };

  const place = (si, r, c) => { // the cell element at (r, c), made in its place when missing
    const { sd } = part(si); const doc = sd.ownerDocument;
    let { row, cell: el } = find(sd, r, c); if (el) return el;
    if (!row) {
      row = doc.createElementNS(S, 'row'); row.setAttribute('r', String(r + 1));
      const after = rowsOf(sd).find((x) => x.no > r); if (after) sd.insertBefore(row, after.el); else sd.appendChild(row);
    }
    row.removeAttribute('spans'); // it listed the columns the row used to have
    el = doc.createElementNS(S, 'c'); el.setAttribute('r', `${colName(c)}${r + 1}`);
    const next = cellsOf(row).find((x) => x.no > c); if (next) row.insertBefore(el, next.el); else row.appendChild(el);
    return el;
  };
  const empty = (el) => { for (const ch of [...el.children]) if (isS(ch, 'v') || isS(ch, 'is') || isS(ch, 'f')) ch.remove(); el.removeAttribute('t'); };
  const mark = (si, hadFormula) => { dirty.add(si); if (hadFormula) chainDirty = true; };

  // write what was typed: a number, TRUE or FALSE, or text (a leading ' keeps a number as text); empty clears the cell
  const setCell = (si, r, c, input) => {
    const why = locked(si, r, c); if (why) throw new EditError(why);
    const text = String(input === null || input === undefined ? '' : input);
    if (/^\s*=/.test(text) && text.trim().length > 1) throw new EditError('Formulas cannot be entered here yet.');
    const { sd } = part(si); const cur = find(sd, r, c).cell; const had = !!(cur && kid(cur, 'f'));
    if (text === '') { if (!cur) return; empty(cur); if (!cur.getAttribute('s') && !cur.children.length) cur.remove(); mark(si, had); return; }
    const el = place(si, r, c); const doc = sd.ownerDocument; empty(el);
    const mkv = (v) => { const x = doc.createElementNS(S, 'v'); x.textContent = v; el.appendChild(x); };
    const t = text.trim();
    if (text[0] !== "'" && NUMBER.test(t) && Number.isFinite(Number(t))) mkv(String(Number(t)));
    else if (text[0] !== "'" && /^(true|false)$/i.test(t)) { el.setAttribute('t', 'b'); mkv(/^true$/i.test(t) ? '1' : '0'); }
    else {
      const s = text[0] === "'" ? text.slice(1) : text;
      el.setAttribute('t', 'inlineStr'); const is = doc.createElementNS(S, 'is'); const x = doc.createElementNS(S, 't'); x.textContent = s;
      if (/^\s|\s$|\s\s|\n/.test(s)) x.setAttributeNS(XMLNS, 'xml:space', 'preserve');
      is.appendChild(x); el.appendChild(is);
    }
    mark(si, had);
  };

  const anyFormula = () => sheets.some((sh, i) => (cache.has(i) ? [...cache.get(i).doc.getElementsByTagNameNS(S, 'f')].length > 0 : /<(\w+:)?f[\s>/]/.test(dec(files[sh.path]))));
  const markCalc = () => { // stored results of formulas that read a changed cell are out of date: the next app to open the file recalculates
    let cp = kid(wbRoot, 'calcPr');
    if (!cp) {
      cp = wbDoc.createElementNS(S, 'calcPr');
      const before = [...wbRoot.children].find((c) => c.namespaceURI === S && AFTER_CALC.includes(c.localName));
      if (before) wbRoot.insertBefore(cp, before); else wbRoot.appendChild(cp);
    }
    cp.setAttribute('fullCalcOnLoad', '1');
  };
  const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ser = (d) => enc(decl + new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/, ''));
  const snapshot = () => {
    const all = { ...files };
    for (const si of dirty) all[sheets[si].path] = ser(cache.get(si).doc);
    if (dirty.size && anyFormula()) { markCalc(); all[WB] = ser(wbDoc); }
    if (chainDirty) {
      delete all['xl/calcChain.xml'];
      if (all['[Content_Types].xml']) all['[Content_Types].xml'] = enc(dec(all['[Content_Types].xml']).replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
      if (relDoc) { const rd = parseX(new XMLSerializer().serializeToString(relDoc)); for (const r of [...rd.documentElement.children]) if (/\/calcChain$/.test(r.getAttribute('Type') || '')) r.remove(); all[WB_RELS] = ser(rd); }
    }
    return all;
  };
  const toBytes = () => {
    const all = snapshot(); const out = {};
    for (const k of Object.keys(all)) out[k] = [all[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { names: () => sheets.map((s) => s.name), cell, locked, setCell, merges, snapshot, toBytes, dirty: () => dirty.size > 0 };
}
