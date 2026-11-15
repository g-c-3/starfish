// Spreadsheet edit engine, xlsx (Decision 488). Works on the sheet XML in place: a changed cell is written, every other byte of the
// package is kept. No screen here; the editor view of Phase 120 maps grid cells to (sheet, row, column).
// Text is written as an inline string (no shared string table to keep in step). A formula is never written or recalculated here:
// a cell with a formula can be overwritten by a value, a shared or array formula start cannot, and the workbook is marked to
// recalculate when another app opens it, because stored results of formulas that read a changed cell are then out of date.
// Rows, columns and sheets (Decision 490): inserted, deleted or renamed here, with every formula, merge and name that points at them
// rewritten (xlsxrefs.js). A sheet with pictures, comments, tables, filters, validation, conditional formats, links or array formulas,
// and a workbook with pivot tables or a reference over several sheets, is refused with a plain message instead of being half changed.
import { unzipSync, zipSync } from 'fflate';
import { SHEET_ROW_MAX, SHEET_COL_MAX, colName } from './office-read.js';
import { mapRefs, mapRange, structFn, translateRefs, removeSheetRefs, renamePrefix, has3D } from './xlsxrefs.js';

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

  // ---- rows, columns and sheets (Decision 490) ----
  let wbChanged = false; let relChanged = false; const extra = new Map(); const extraDirty = new Set(); // hidden sheets are parsed only when a formula in them must follow
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const allSheets = () => {
    const outl = [];
    for (const el of kids(kid(wbRoot, 'sheets'), 'sheet')) {
      let pth = null; for (const a of el.attributes) if (a.localName === 'id' && a.value in target) pth = target[a.value];
      if (pth && files[pth]) outl.push({ name: el.getAttribute('name') || 'Sheet', path: pth, el, si: sheets.findIndex((x) => x.path === pth) });
    }
    return outl;
  };
  const docOf = (e) => { if (e.si >= 0) return part(e.si).doc; if (!extra.has(e.path)) extra.set(e.path, parseX(dec(files[e.path]))); return extra.get(e.path); };
  const touch = (e) => { if (e.si >= 0) dirty.add(e.si); else extraDirty.add(e.path); };
  const formulaEls = (doc) => ['f', 'formula', 'formula1', 'formula2'].flatMap((t) => [...doc.getElementsByTagNameNS(S, t)]);
  const unent = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const ent = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // every formula of the workbook: in sheets, validation and conditional formats, defined names and chart series
  const rewriteAll = (fn) => {
    for (const e of allSheets()) {
      const doc = docOf(e); let ch = false;
      for (const x of formulaEls(doc)) { const t = x.textContent; if (!t) continue; const n = fn(t, e.name); if (n !== t) { x.textContent = n; ch = true; } }
      if (ch) touch(e);
    }
    for (const dn of wbRoot.getElementsByTagNameNS(S, 'definedName')) { const t = dn.textContent; const n = fn(t, null); if (n !== t) { dn.textContent = n; wbChanged = true; } }
    for (const pth of Object.keys(files)) {
      if (!/^xl\/charts\/[^/]+\.xml$/.test(pth)) continue;
      const xml = dec(files[pth]);
      const nx = xml.replace(/(<(?:\w+:)?f>)([^<]*)(<\/(?:\w+:)?f>)/g, (all, a, t, z) => { const n = ent(fn(unent(t), null)); return n === t ? all : a + n + z; });
      if (nx !== xml) files[pth] = enc(nx);
    }
  };
  const no3D = () => {
    for (const e of allSheets()) for (const x of formulaEls(docOf(e))) if (has3D(x.textContent)) throw new EditError('A formula here refers to several sheets at once; rows, columns and sheets cannot be changed in this file yet.');
    for (const dn of wbRoot.getElementsByTagNameNS(S, 'definedName')) if (has3D(dn.textContent)) throw new EditError('A name here refers to several sheets at once; rows, columns and sheets cannot be changed in this file yet.');
    if (Object.keys(files).some((k) => /^xl\/(pivotTables|pivotCache)\//.test(k))) throw new EditError('This workbook has pivot tables; rows, columns and sheets cannot be changed here yet.');
  };
  // shared formulas are written out cell by cell, so a change between the cells of one cannot make them disagree
  const expandShared = () => {
    for (const e of allSheets()) {
      const doc = docOf(e); const sd = kid(doc.documentElement, 'sheetData'); if (!sd) continue;
      const fs = [...sd.getElementsByTagNameNS(S, 'f')].filter((f) => f.getAttribute('t') === 'shared'); if (!fs.length) continue;
      const pos = new Map(); const master = new Map();
      for (const row of rowsOf(sd)) for (const c of cellsOf(row.el)) { const f = kid(c.el, 'f'); if (f && f.getAttribute('t') === 'shared') pos.set(f, { r: row.no, c: c.no }); }
      for (const f of fs) if (f.textContent && f.getAttribute('si') !== null) master.set(f.getAttribute('si'), { text: f.textContent, ...pos.get(f) });
      for (const f of fs) {
        const m = master.get(f.getAttribute('si')); const q = pos.get(f);
        if (!f.textContent && m && q) f.textContent = translateRefs(m.text, q.r - m.r, q.c - m.c);
        f.removeAttribute('t'); f.removeAttribute('si'); f.removeAttribute('ref');
      }
      touch(e);
    }
  };
  const SHEET_HAS = [['drawing', 'pictures or charts'], ['legacyDrawing', 'comments'], ['tableParts', 'tables'], ['conditionalFormatting', 'conditional formatting'], ['dataValidations', 'data validation'], ['hyperlinks', 'links'], ['autoFilter', 'a filter'], ['rowBreaks', 'page breaks'], ['colBreaks', 'page breaks']];
  const ready = (si) => {
    const { root, sd } = part(si);
    for (const [tag, what] of SHEET_HAS) if (kid(root, tag)) throw new EditError(`This sheet has ${what}; its rows and columns cannot be changed here yet.`);
    if ([...sd.getElementsByTagNameNS(S, 'f')].some((f) => f.getAttribute('t') === 'array')) throw new EditError('This sheet has array formulas; its rows and columns cannot be changed here yet.');
    no3D();
  };
  // merges and the used range follow a change; a merge left with one cell, or none, is dropped
  const refText = (txt, name, op) => mapRefs(txt, name, structFn(op));
  const follow = (root, name, op) => {
    const mc = kid(root, 'mergeCells');
    if (mc) {
      for (const m of kids(mc, 'mergeCell')) { const t = refText(m.getAttribute('ref') || '', name, op); if (t.includes('#REF!') || !t.includes(':') || t.split(':')[0] === t.split(':')[1]) m.remove(); else m.setAttribute('ref', t); }
      const left = kids(mc, 'mergeCell').length; if (left) mc.setAttribute('count', String(left)); else mc.remove();
    }
    const dim = kid(root, 'dimension'); if (dim) { const t = refText(dim.getAttribute('ref') || '', name, op); dim.setAttribute('ref', t.includes('#REF!') ? 'A1' : t); }
  };
  const moveAxis = (si, axis, at, n, del) => {
    if (!(Number.isInteger(at) && Number.isInteger(n) && at >= 0 && n >= 1 && at < (axis === 'r' ? SHEET_ROW_MAX : SHEET_COL_MAX))) throw new EditError(axis === 'r' ? 'That row is not on the sheet.' : 'That column is not on the sheet.');
    ready(si); expandShared();
    const name = sheets[si].name; const { root, sd } = part(si); const op = { sheet: name, axis, at, n, del };
    if (axis === 'r') {
      for (const row of rowsOf(sd)) {
        if (del && row.no >= at && row.no < at + n) { row.el.remove(); continue; }
        if (row.no >= at) { const no = del ? row.no - n : row.no + n; row.el.setAttribute('r', String(no + 1)); for (const c of cellsOf(row.el)) c.el.setAttribute('r', `${colName(c.no)}${no + 1}`); }
      }
    } else {
      for (const row of rowsOf(sd)) {
        row.el.removeAttribute('spans');
        for (const c of cellsOf(row.el)) {
          if (del && c.no >= at && c.no < at + n) { c.el.remove(); continue; }
          if (c.no >= at) c.el.setAttribute('r', `${colName(del ? c.no - n : c.no + n)}${row.no + 1}`);
        }
      }
      const cols = kid(root, 'cols');
      if (cols) {
        for (const c of kids(cols, 'col')) { const m = mapRange(Number(c.getAttribute('min')) - 1, Number(c.getAttribute('max')) - 1, op); if (!m) c.remove(); else { c.setAttribute('min', String(m[0] + 1)); c.setAttribute('max', String(m[1] + 1)); } }
        if (!kids(cols, 'col').length) cols.remove();
      }
    }
    follow(root, name, op);
    rewriteAll((t, own) => mapRefs(t, own, structFn(op)));
    dirty.add(si); chainDirty = true;
  };

  const goodName = (name, except) => {
    const nm = String(name === null || name === undefined ? '' : name).trim();
    if (!nm) throw new EditError('A sheet needs a name.');
    if (nm.length > 31) throw new EditError('A sheet name can have at most 31 characters.');
    if (/[:\\/?*[\]]/.test(nm)) throw new EditError('A sheet name cannot contain : \\ / ? * [ ]');
    if (/^'|'$/.test(nm)) throw new EditError('A sheet name cannot start or end with an apostrophe.');
    if (/^history$/i.test(nm)) throw new EditError('That sheet name is reserved.');
    if (allSheets().some((x) => x !== except && same(x.name, nm))) throw new EditError('Another sheet already has that name.');
    return nm;
  };
  const shown = (si) => { const e = allSheets().find((x) => x.si === si); if (!e) throw new EditError('That sheet is not there any more.'); return e; };
  const renameSheet = (si, name) => {
    const e = shown(si); const nn = goodName(name, e); if (nn === e.name) return;
    no3D(); const old = e.name;
    rewriteAll((t) => renamePrefix(t, old, nn));
    e.el.setAttribute('name', nn); sheets[si].name = nn; wbChanged = true;
  };
  const addSheet = (name) => {
    if (!relDoc) throw new EditError('This workbook cannot get a new sheet here.');
    const nn = goodName(name, null);
    let k = sheets.length + 1; while (files[`xl/worksheets/sheet${k}.xml`]) k++;
    const pth = `xl/worksheets/sheet${k}.xml`;
    files[pth] = enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${S}"><sheetData/></worksheet>`);
    let n = 0; for (const r of relDoc.documentElement.children) { const m = /^rId(\d+)$/.exec(r.getAttribute('Id') || ''); if (m) n = Math.max(n, Number(m[1])); }
    const rid = `rId${n + 1}`; const RELNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const rel = relDoc.createElementNS(relDoc.documentElement.namespaceURI, 'Relationship');
    rel.setAttribute('Id', rid); rel.setAttribute('Type', `${RELNS}/worksheet`); rel.setAttribute('Target', `worksheets/sheet${k}.xml`); relDoc.documentElement.appendChild(rel);
    let id = 0; for (const x of kids(kid(wbRoot, 'sheets'), 'sheet')) id = Math.max(id, Number(x.getAttribute('sheetId')) || 0);
    const el = wbDoc.createElementNS(S, 'sheet'); el.setAttribute('name', nn); el.setAttribute('sheetId', String(id + 1)); el.setAttributeNS(RELNS, 'r:id', rid);
    kid(wbRoot, 'sheets').appendChild(el);
    target[rid] = pth; sheets.push({ name: nn, path: pth });
    if (files['[Content_Types].xml']) files['[Content_Types].xml'] = enc(dec(files['[Content_Types].xml']).replace('</Types>', `<Override PartName="/${pth}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
    wbChanged = true; relChanged = true;
    return sheets.length - 1;
  };
  const deleteSheet = (si) => {
    const ents = allSheets(); const e = ents.find((x) => x.si === si); if (!e) throw new EditError('That sheet is not there any more.');
    if (sheets.length < 2) throw new EditError('A workbook needs at least one sheet.');
    if (files[e.path.replace(/([^/]+)$/, '_rels/$1.rels')]) throw new EditError('This sheet has pictures, comments, tables or links; it cannot be deleted here yet.');
    no3D(); const idx = ents.indexOf(e); const gone = e.name; let rid = null;
    for (const a of e.el.attributes) if (a.localName === 'id') rid = a.value;
    rewriteAll((t) => removeSheetRefs(t, gone));
    for (const dn of [...wbRoot.getElementsByTagNameNS(S, 'definedName')]) { const l = dn.getAttribute('localSheetId'); if (l === null) continue; const q = Number(l); if (q === idx) dn.remove(); else if (q > idx) dn.setAttribute('localSheetId', String(q - 1)); }
    e.el.remove();
    for (const r of [...relDoc.documentElement.children]) if (r.getAttribute('Id') === rid) r.remove();
    delete target[rid]; delete files[e.path]; extra.delete(e.path); extraDirty.delete(e.path);
    if (files['[Content_Types].xml']) files['[Content_Types].xml'] = enc(dec(files['[Content_Types].xml']).replace(new RegExp(`<Override[^>]*PartName="/${e.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), ''));
    const keep = [...cache.entries()]; const keepDirty = [...dirty]; cache.clear(); dirty.clear();
    for (const [q, v] of keep) if (q !== si) cache.set(q > si ? q - 1 : q, v);
    for (const q of keepDirty) if (q !== si) dirty.add(q > si ? q - 1 : q);
    sheets.splice(si, 1);
    const bv = kid(wbRoot, 'bookViews'); const wv = bv && kid(bv, 'workbookView'); if (wv) { wv.setAttribute('activeTab', '0'); wv.setAttribute('firstSheet', '0'); }
    wbChanged = true; relChanged = true; chainDirty = true;
  };
  const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ser = (d) => enc(decl + new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/, ''));
  const snapshot = () => {
    const all = { ...files };
    for (const si of dirty) all[sheets[si].path] = ser(cache.get(si).doc);
    for (const pth of extraDirty) all[pth] = ser(extra.get(pth));
    if ((dirty.size || extraDirty.size || wbChanged) && anyFormula()) { markCalc(); wbChanged = true; }
    if (wbChanged) all[WB] = ser(wbDoc);
    if (relChanged) all[WB_RELS] = ser(relDoc);
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
  return {
    names: () => sheets.map((x) => x.name), cell, locked, setCell, merges, snapshot, toBytes,
    insertRows: (si, at, n = 1) => moveAxis(si, 'r', at, n, false), deleteRows: (si, at, n = 1) => moveAxis(si, 'r', at, n, true),
    insertCols: (si, at, n = 1) => moveAxis(si, 'c', at, n, false), deleteCols: (si, at, n = 1) => moveAxis(si, 'c', at, n, true),
    renameSheet, addSheet, deleteSheet,
    dirty: () => dirty.size > 0 || extraDirty.size > 0 || wbChanged || relChanged
  };
}
