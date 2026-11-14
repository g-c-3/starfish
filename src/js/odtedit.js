// odtedit.js — the odt editing engine, step 3 of Phase 119 (Decision 475); table rows and columns (Decision 477), lists (Decision 480). Same operations and offsets as docedit.js, on `content.xml`.
// A paragraph (`text:p`, `text:h`) is read as runs (bare text, or one `text:span` with a style name) and zero-width marks (bookmarks); only a
// paragraph that is changed is rebuilt, every other node and every other part of the zip is kept as it was (Decision 453). A paragraph that holds
// anything else (a link, a field, a note, a frame, a nested span) is locked: shown, never edited. Offsets count the characters of its plain text
// (`text:s` counts its spaces, `text:tab` and `text:line-break` one character each).
import { zipSync } from 'fflate';

const NS = {
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
};
const MAIN = 'content.xml';
const STORED = /^mimetype$|\.(png|jpe?g|gif|webp|zip|mp[34]|docx|xlsx|pptx|odt|ods|odp)$/i;
const MARKS = new Set(['bookmark', 'bookmark-start', 'bookmark-end', 'soft-page-break']);
const FORMATS = { b: 1, i: 1, u: 1, strike: 1 };
const is = (n, name, ns = NS.text) => !!n && n.nodeType === 1 && n.namespaceURI === ns && n.localName === name;
const isPara = (n) => is(n, 'p') || is(n, 'h');
const sname = (n) => n.getAttributeNS(NS.text, 'style-name') || null;

// runs ({ run, style, text }) and marks ({ mark }) of a paragraph, in order; null when it holds anything else
function parse(p) {
  const out = [];
  const add = (style, text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.run && last.style === style) last.text += text; else out.push({ run: true, style, text });
  };
  const walk = (node, style, inSpan) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { add(style, c.data); continue; }
      if (c.nodeType !== 1 || c.namespaceURI !== NS.text) return false;
      const n = c.localName;
      if (n === 's') { const k = Number(c.getAttributeNS(NS.text, 'c') || 1); if (!(k >= 1 && k <= 10000)) return false; add(style, ' '.repeat(k)); }
      else if (n === 'tab') add(style, '\t');
      else if (n === 'line-break') add(style, '\n');
      else if (MARKS.has(n)) out.push({ mark: c });
      else if (n === 'span' && !inSpan) { if (!walk(c, sname(c), true)) return false; }
      else return false;
    }
    return true;
  };
  return walk(p, null, false) ? out : null;
}
const total = (items) => items.reduce((n, it) => n + (it.run ? it.text.length : 0), 0);
// cut the run that holds `offset` strictly inside it into two
function cut(items, offset) {
  let pos = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k]; if (!it.run) continue;
    const len = it.text.length;
    if (offset > pos && offset < pos + len) { items.splice(k + 1, 0, { run: true, style: it.style, text: it.text.slice(offset - pos) }); it.text = it.text.slice(0, offset - pos); return; }
    pos += len;
  }
}

export function openOdt(files, EditError) {
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(files[MAIN]), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new EditError('This file could not be read for editing.');
  const root = doc.documentElement;
  const officeKid = (name) => [...root.children].find((c) => is(c, name, NS.office)) || null;
  const bodyEl = officeKid('body');
  const body = bodyEl && [...bodyEl.children].find((c) => is(c, 'text', NS.office));
  if (!body) throw new EditError('This is not a valid file of this type.');

  // text styles of the file (automatic styles), to read a format and to derive a changed one
  let autoEl = officeKid('automatic-styles');
  const autos = new Map(); const taken = new Set();
  if (autoEl) for (const s of autoEl.children) if (is(s, 'style', NS.style)) {
    const n = s.getAttributeNS(NS.style, 'name'); taken.add(n);
    if (s.getAttributeNS(NS.style, 'family') === 'text') autos.set(n, s);
  }
  let seq = 0; const cache = new Map();
  const tprops = (st) => [...st.children].find((c) => is(c, 'text-properties', NS.style)) || null;
  const SET = {
    b: (on) => [['fo', 'font-weight', on ? 'bold' : 'normal'], ['style', 'font-weight-asian', on ? 'bold' : 'normal'], ['style', 'font-weight-complex', on ? 'bold' : 'normal']],
    i: (on) => [['fo', 'font-style', on ? 'italic' : 'normal'], ['style', 'font-style-asian', on ? 'italic' : 'normal'], ['style', 'font-style-complex', on ? 'italic' : 'normal']],
    u: (on) => (on
      ? [['style', 'text-underline-style', 'solid'], ['style', 'text-underline-type', 'single'], ['style', 'text-underline-width', 'auto'], ['style', 'text-underline-color', 'font-color']]
      : [['style', 'text-underline-style', 'none'], ['style', 'text-underline-type', null], ['style', 'text-underline-width', null], ['style', 'text-underline-color', null]]),
    strike: (on) => (on
      ? [['style', 'text-line-through-style', 'solid'], ['style', 'text-line-through-type', 'single']]
      : [['style', 'text-line-through-style', 'none'], ['style', 'text-line-through-type', null]])
  };
  // the style name for `base` with `prop` on or off: a copy of the automatic style, or a new one under a common style
  const styleFor = (base, prop, on) => {
    const key = `${base || ''}|${prop}|${on}`; if (cache.has(key)) return cache.get(key);
    const src = base ? autos.get(base) : null; let st;
    if (src) st = src.cloneNode(true);
    else { st = doc.createElementNS(NS.style, 'style:style'); st.setAttributeNS(NS.style, 'style:family', 'text'); if (base) st.setAttributeNS(NS.style, 'style:parent-style-name', base); }
    let name; do { name = `ArklyT${++seq}`; } while (taken.has(name));
    taken.add(name); st.setAttributeNS(NS.style, 'style:name', name);
    let tp = tprops(st); if (!tp) { tp = doc.createElementNS(NS.style, 'style:text-properties'); st.appendChild(tp); }
    for (const [pre, n, v] of SET[prop](on)) { if (v === null) tp.removeAttributeNS(NS[pre], n); else tp.setAttributeNS(NS[pre], `${pre}:${n}`, v); }
    if (!autoEl) { autoEl = doc.createElementNS(NS.office, 'office:automatic-styles'); root.insertBefore(autoEl, bodyEl); }
    autoEl.appendChild(st); autos.set(name, st); cache.set(key, name); return name;
  };
  // true, false, or null when the style chain says nothing about `prop`
  const READ = {
    b: (tp) => { const v = tp.getAttributeNS(NS.fo, 'font-weight'); return v ? v === 'bold' || Number(v) >= 600 : null; },
    i: (tp) => { const v = tp.getAttributeNS(NS.fo, 'font-style'); return v ? v === 'italic' || v === 'oblique' : null; },
    u: (tp) => { const v = tp.getAttributeNS(NS.style, 'text-underline-style'); return v ? v !== 'none' : null; },
    strike: (tp) => { const v = tp.getAttributeNS(NS.style, 'text-line-through-style'); return v ? v !== 'none' : null; }
  };
  const styleOn = (name, prop) => {
    for (let k = 0; name && k < 8; k++) {
      const st = autos.get(name); if (!st) return false;
      const tp = tprops(st); const v = tp ? READ[prop](tp) : null; if (v !== null) return v;
      name = st.getAttributeNS(NS.style, 'parent-style-name');
    }
    return false;
  };

  const paragraphs = () => [...body.getElementsByTagName('*')].filter((x) => isPara(x));
  const editable = (p) => parse(p) !== null;
  const textOf = (p) => { const it = parse(p); return it ? it.filter((x) => x.run).map((x) => x.text).join('') : null; };
  const lockCheck = (p) => { if (!p || parse(p) === null) throw new EditError('This paragraph holds a picture, field, link or note mark and cannot be edited here.'); };
  const clamp = (p, a, b) => { const n = textOf(p).length; return [Math.max(0, Math.min(a, n)), Math.max(0, Math.min(b, n))]; };

  const el = (name) => doc.createElementNS(NS.text, `text:${name}`);
  // the paragraph's children rewritten from runs and marks: empty runs go, neighbours with one style join
  function build(p, items) {
    const list = [];
    for (const it of items) {
      if (it.run) { if (!it.text) continue; const l = list[list.length - 1]; if (l && l.run && l.style === it.style) { l.text += it.text; continue; } list.push({ ...it }); }
      else list.push(it);
    }
    while (p.firstChild) p.removeChild(p.firstChild);
    const fill = (parent, text) => {
      let buf = ''; const flush = () => { if (buf) { parent.appendChild(doc.createTextNode(buf)); buf = ''; } };
      let i = 0;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\t') { flush(); parent.appendChild(el('tab')); i++; }
        else if (ch === '\n') { flush(); parent.appendChild(el('line-break')); i++; }
        else if (ch === ' ') { // a space after a character stays plain; every other space is a text:s
          let n = 0; while (text[i + n] === ' ') n++; i += n;
          if (buf) { buf += ' '; n--; }
          if (n > 0) { flush(); const s = el('s'); if (n > 1) s.setAttributeNS(NS.text, 'text:c', String(n)); parent.appendChild(s); }
        } else { buf += ch; i++; }
      }
      flush();
    };
    for (const it of list) {
      if (!it.run) { p.appendChild(it.mark); continue; }
      if (it.style) { const sp = el('span'); sp.setAttributeNS(NS.text, 'text:style-name', it.style); fill(sp, it.text); p.appendChild(sp); } else fill(p, it.text);
    }
  }

  // replace [from, to) of the paragraph's text by `insert` (the first affected run keeps its style)
  const replace = (p, from, to, insert = '') => {
    lockCheck(p); [from, to] = clamp(p, from, to); if (to < from) to = from;
    const items = parse(p); let pos = 0; let target = null; let at = 0;
    for (const it of items) {
      if (!it.run) continue;
      const len = it.text.length; const s = Math.max(from - pos, 0); const e = Math.min(to - pos, len);
      if (e > s) { if (!target) { target = it; at = s; } it.text = it.text.slice(0, s) + it.text.slice(e); }
      pos += len;
    }
    if (target) { target.text = target.text.slice(0, at) + insert + target.text.slice(at); build(p, items); return from + insert.length; }
    if (!insert) return from;
    // nothing was removed: add to the run that ends here, else the one that holds or starts here, else a new run
    pos = 0; let host = null; let idx = 0; let atEnd = false;
    for (const it of items) {
      if (!it.run) continue;
      const end = pos + it.text.length;
      if (end === from && it.text.length) { host = it; idx = it.text.length; atEnd = true; }
      else if (!atEnd && !host && pos <= from && from < end) { host = it; idx = from - pos; }
      pos = end;
    }
    if (host) host.text = host.text.slice(0, idx) + insert + host.text.slice(idx); else items.push({ run: true, style: null, text: insert });
    build(p, items); return from + insert.length;
  };
  // set or clear bold, italic, underline or strikethrough on [from, to)
  const format = (p, from, to, prop, on) => {
    lockCheck(p); if (!FORMATS[prop]) throw new EditError('That format is not available.');
    [from, to] = clamp(p, from, to); if (to <= from) return;
    const items = parse(p); cut(items, from); cut(items, to); let pos = 0;
    for (const it of items) {
      if (!it.run) continue;
      const len = it.text.length;
      if (len && pos >= from && pos + len <= to) it.style = styleFor(it.style, prop, on);
      pos += len;
    }
    build(p, items);
  };
  const hasFormat = (p, from, to, prop) => {
    lockCheck(p); [from, to] = clamp(p, from, to); let pos = 0; let any = false;
    for (const it of parse(p)) {
      if (!it.run) continue;
      const len = it.text.length;
      if (len && pos < to && pos + len > from) { if (!styleOn(it.style, prop)) return false; any = true; }
      pos += len;
    }
    return any;
  };
  // Enter: split at `offset`; the new paragraph has the same style, and a list paragraph starts a new item
  const split = (p, offset) => {
    lockCheck(p); [offset] = clamp(p, offset, offset);
    const items = parse(p); cut(items, offset);
    let pos = 0; let idx = items.length;
    for (let k = 0; k < items.length; k++) { const it = items[k]; if (!it.run) continue; if (pos >= offset && it.text.length) { idx = k; break; } pos += it.text.length; }
    const np = p.cloneNode(false); const holder = p.parentNode;
    if (is(holder, 'list-item')) { const ni = holder.cloneNode(false); ni.removeAttributeNS(NS.text, 'start-value'); ni.appendChild(np); holder.after(ni); } else p.after(np);
    build(p, items.slice(0, idx)); build(np, items.slice(idx));
    return np;
  };
  // the paragraph that follows `p` (next sibling, or the only paragraph of the next list item)
  const next = (p) => {
    const s = p.nextElementSibling; if (s) return isPara(s) ? s : null;
    const it = p.parentNode; const ni = is(it, 'list-item') ? it.nextElementSibling : null;
    return is(ni, 'list-item') && ni.children.length === 1 && isPara(ni.firstElementChild) ? ni.firstElementChild : null;
  };
  const drop = (p) => { const h = p.parentNode; if (is(h, 'list-item') && h.children.length === 1) h.remove(); else p.remove(); };
  // Backspace at the start: the next paragraph's text joins this one
  const mergeNext = (p) => {
    lockCheck(p); const nx = next(p); if (!nx) return false; lockCheck(nx);
    build(p, parse(p).concat(parse(nx))); drop(nx); return true;
  };
  const remove = (p) => drop(p);

  // ---- table rows and columns (Decision 477): merged cells, repeated rows and rows of different widths are refused ----
  const TNS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const tis = (n, name) => is(n, name, TNS);
  const TABLE_ERR = 'This table cannot be changed here.';
  const rep = (n, a) => { const v = n.getAttributeNS(TNS, a); return v === null || v === '' ? 1 : Number(v); };
  const gather = (tbl, one, groups) => { const out = []; const walk = (parent) => { for (const c of parent.children) { if (tis(c, one)) out.push(c); else if (groups.some((g) => tis(c, g))) walk(c); } }; walk(tbl); return out; };
  const rowsOf = (tbl) => gather(tbl, 'table-row', ['table-rows', 'table-header-rows', 'table-row-group']);
  const colsOf = (tbl) => gather(tbl, 'table-column', ['table-columns', 'table-header-columns', 'table-column-group']);
  const cellsOf = (row) => [...row.children].filter((c) => tis(c, 'table-cell'));
  const where = (p) => {
    let cell = null; for (let n = p && p.parentNode; n; n = n.parentNode) if (tis(n, 'table-cell')) { cell = n; break; }
    const row = cell && cell.parentNode; let tbl = row; while (tbl && !tis(tbl, 'table')) tbl = tbl.parentNode;
    if (!cell || !tis(row, 'table-row') || !tbl) throw new EditError('Put the cursor in a table cell first.');
    const rows = rowsOf(tbl); const cols = colsOf(tbl);
    if (!rows.includes(row)) throw new EditError(TABLE_ERR);
    let nCols = 0; for (const c of cols) { const k = rep(c, 'number-columns-repeated'); if (!(k >= 1 && k <= 200)) throw new EditError(TABLE_ERR); nCols += k; }
    for (const r of rows) {
      if (rep(r, 'number-rows-repeated') > 1) throw new EditError(TABLE_ERR);
      let n = 0;
      for (const c of r.children) {
        if (tis(c, 'covered-table-cell') || rep(c, 'number-columns-spanned') > 1 || rep(c, 'number-rows-spanned') > 1) throw new EditError('This table has merged cells; rows and columns cannot be changed here.');
        if (!tis(c, 'table-cell')) throw new EditError(TABLE_ERR);
        const k = rep(c, 'number-columns-repeated'); if (!(k >= 1 && k <= 100)) throw new EditError(TABLE_ERR); n += k;
      }
      if (n !== nCols) throw new EditError(TABLE_ERR);
    }
    let ci = 0; for (const c of cellsOf(row)) { if (c === cell) break; ci += rep(c, 'number-columns-repeated'); }
    return { cell, row, tbl, rows, nCols, ri: rows.indexOf(row), ci };
  };
  const cellOf = (p) => { const w = where(p); return { ri: w.ri, ci: w.ci, rows: w.rows.length, cols: w.nCols }; };
  // a repeated cell or column becomes that many separate ones (the same table)
  const spread = (nodes, attr) => { for (const n of nodes) { const k = rep(n, attr); if (k > 1) { n.removeAttributeNS(TNS, attr); for (let i = 1; i < k; i++) n.after(n.cloneNode(true)); } } };
  const spreadRow = (row) => spread(cellsOf(row), 'number-columns-repeated');
  // a copied cell cut to its first paragraph, emptied; stored values go; returns that paragraph
  const blank = (cell) => {
    const blocks = [...cell.children]; const first = blocks[0];
    if (!isPara(first)) throw new EditError(TABLE_ERR);
    for (const b of blocks.slice(1)) cell.removeChild(b);
    while (first.firstChild) first.removeChild(first.firstChild);
    for (const a of [...cell.attributes]) if ((a.namespaceURI === NS.office && /value|currency/.test(a.localName)) || (a.namespaceURI === TNS && a.localName === 'formula')) cell.removeAttributeNS(a.namespaceURI, a.localName);
    return first;
  };
  const firstP = (cell) => (cell && isPara(cell.firstElementChild) ? cell.firstElementChild : null);
  const cellAt = (row, idx) => { let k = 0; for (const c of cellsOf(row)) { k += rep(c, 'number-columns-repeated'); if (idx < k) return c; } return null; };
  // a new row beside the paragraph's row (a header row stays in its group); returns the new first paragraph of each cell
  const insertRow = (p, after = true) => {
    const w = where(p); const nr = w.row.cloneNode(true); spreadRow(nr);
    const out = cellsOf(nr).map(blank);
    if (after) w.row.after(nr); else w.row.before(nr);
    return out;
  };
  const deleteRow = (p) => {
    const w = where(p); if (w.rows.length < 2) throw new EditError('A table keeps at least one row.');
    const near = w.rows[w.ri + 1] || w.rows[w.ri - 1]; const group = w.row.parentNode;
    w.row.remove(); if (group !== w.tbl && !group.children.length) group.remove();
    return firstP(cellAt(near, Math.min(w.ci, w.nCols - 1)));
  };
  // a new column beside the paragraph's column; returns the new first paragraph of each row
  const insertColumn = (p, after = true) => {
    const w = where(p); spread(colsOf(w.tbl), 'number-columns-repeated'); for (const r of w.rows) spreadRow(r);
    const col = colsOf(w.tbl)[w.ci]; const nc = col.cloneNode(true); if (after) col.after(nc); else col.before(nc);
    const out = [];
    for (const r of w.rows) { const cell = cellsOf(r)[w.ci]; const cl = cell.cloneNode(true); out.push(blank(cl)); if (after) cell.after(cl); else cell.before(cl); }
    return out;
  };
  const deleteColumn = (p) => {
    const w = where(p); if (w.nCols < 2) throw new EditError('A table keeps at least one column.');
    spread(colsOf(w.tbl), 'number-columns-repeated'); for (const r of w.rows) spreadRow(r);
    colsOf(w.tbl)[w.ci].remove(); for (const r of w.rows) cellsOf(r)[w.ci].remove();
    const cells = cellsOf(w.row); return firstP(cells[Math.min(w.ci, cells.length - 1)]);
  };


  // ---- lists (Decision 480): a level is a nested text:list; the list styles used here are added to the automatic styles when missing ----
  const enc = (s) => new TextEncoder().encode(s);
  const listStyles = new Map();
  if (autoEl) for (const s of autoEl.children) if (is(s, 'list-style')) { const n = s.getAttributeNS(NS.style, 'name'); listStyles.set(n, s); taken.add(n); }
  const ensureAuto = () => { if (!autoEl) { autoEl = doc.createElementNS(NS.office, 'office:automatic-styles'); root.insertBefore(autoEl, bodyEl); } return autoEl; };
  const styleKind = (st) => { const f = st && st.firstElementChild; return f && f.localName === 'list-level-style-bullet' ? 'bullet' : f && f.localName === 'list-level-style-number' ? 'number' : null; };
  const listKind = (L) => { for (let n = L; is(n, 'list');) { const nm = sname(n); if (nm) return styleKind(listStyles.get(nm)); const it = n.parentNode; n = is(it, 'list-item') ? it.parentNode : null; } return null; };
  const LIST_NAME = { bullet: 'ArklyLB', number: 'ArklyLN' };
  const listStyleFor = (kind) => {
    const name = LIST_NAME[kind]; if (listStyles.has(name)) return name;
    let x = `<text:list-style xmlns:text="${NS.text}" xmlns:style="${NS.style}" xmlns:fo="${NS.fo}" style:name="${name}">`;
    for (let i = 1; i <= 10; i++) {
      const at = `${(1.27 * i).toFixed(2)}cm`;
      const pos = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${at}" fo:text-indent="-0.635cm" fo:margin-left="${at}"/></style:list-level-properties>`;
      x += kind === 'bullet'
        ? `<text:list-level-style-bullet text:level="${i}" text:bullet-char="${['\u2022', '\u25E6', '\u25AA'][(i - 1) % 3]}">${pos}</text:list-level-style-bullet>`
        : `<text:list-level-style-number text:level="${i}" style:num-suffix="." style:num-format="${['1', 'a', 'i'][(i - 1) % 3]}">${pos}</text:list-level-style-number>`;
    }
    const node = doc.importNode(new DOMParser().parseFromString(`${x}</text:list-style>`, 'application/xml').documentElement, true);
    ensureAuto().appendChild(node); listStyles.set(name, node); taken.add(name); return name;
  };
  const itemOf = (p) => (is(p.parentNode, 'list-item') && p.parentNode.firstElementChild === p ? p.parentNode : null);
  const nestedIn = (item) => (is(item.lastElementChild, 'list') ? item.lastElementChild : null);
  const depthOf = (L) => { let d = 0; for (let n = L; n; n = n.parentNode) if (is(n, 'list')) d++; return d; };
  const NOT_FIRST = 'Move it to the first level first.';
  // a paragraph that is alone in its item of a top-level list becomes a plain paragraph; the items below it stay a list that goes on counting
  const plainOk = (p) => { const I = itemOf(p); return !!I && I.children.length === 1 && is(I.parentNode, 'list') && !is(I.parentNode.parentNode, 'list-item'); };
  const lift = (p) => {
    const I = p.parentNode; const L = I.parentNode; const sib = [...L.children]; const below = sib.slice(sib.indexOf(I) + 1);
    if (below.length) { const L2 = L.cloneNode(false); if (listKind(L) === 'number') L2.setAttributeNS(NS.text, 'text:continue-numbering', 'true'); for (const b of below) L2.appendChild(b); L.after(L2); }
    L.after(p); I.remove(); if (!L.children.length) L.remove();
  };
  // bullets, numbers or no list for the paragraphs; returns how many changed
  const setList = (paras, kind) => {
    if (kind !== 'bullet' && kind !== 'number' && kind !== 'none') throw new EditError('That list kind is not available.');
    if (paras.some((p) => is(p.parentNode, 'list-header'))) throw new EditError('A list header cannot be changed here.');
    const inItem = paras.filter((p) => is(p.parentNode, 'list-item'));
    if (kind === 'none') { if (inItem.some((p) => !plainOk(p))) throw new EditError(NOT_FIRST); for (const p of inItem) lift(p); return inItem.length; }
    if (inItem.some((p) => listKind(p.parentNode.parentNode) !== kind && !plainOk(p))) throw new EditError(NOT_FIRST);
    const style = listStyleFor(kind); let n = 0;
    for (const p of paras) {
      if (is(p.parentNode, 'list-item')) { if (listKind(p.parentNode.parentNode) === kind) continue; lift(p); }
      const prev = p.previousElementSibling; let L;
      if (is(prev, 'list') && listKind(prev) === kind) L = prev; else { L = el('list'); L.setAttributeNS(NS.text, 'text:style-name', style); p.before(L); }
      const item = el('list-item'); L.appendChild(item); item.appendChild(p); n++;
    }
    return n;
  };
  const deeper = (p) => {
    const I = itemOf(p); const prev = I && I.previousElementSibling; if (!I || !is(I.parentNode, 'list') || !is(prev, 'list-item') || depthOf(I.parentNode) >= 8) return false;
    let N = nestedIn(prev); if (!N) { N = el('list'); prev.appendChild(N); } N.appendChild(I); return true;
  };
  const shallower = (p) => { // the items after it stay one level deeper, as children of it
    const I = itemOf(p); if (!I) return false; const N = I.parentNode; const P = N.parentNode;
    if (!is(N, 'list') || !is(P, 'list-item') || !is(P.parentNode, 'list')) return false;
    const all = [...N.children]; const follow = all.slice(all.indexOf(I) + 1);
    if (follow.length) { let T = nestedIn(I); if (!T) { T = el('list'); I.appendChild(T); } for (const f of follow) T.appendChild(f); }
    P.after(I); if (!N.children.length) N.remove(); return true;
  };
  // one level deeper (delta 1) or shallower (-1); returns how many changed (a run of items is moved last first when going shallower, so it moves together)
  const shiftLevel = (paras, delta) => {
    let n = 0; for (const p of delta > 0 ? paras : [...paras].reverse()) if (delta > 0 ? deeper(p) : shallower(p)) n++;
    return n;
  };
  // every part of the file as it now stands (the reader can read this)
  const snapshot = () => ({ ...files, [MAIN]: enc(`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '')}`) });

  const toBytes = () => {
    const all = snapshot(); const out = {};
    for (const k of Object.keys(all)) out[k] = [all[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { paragraphs, editable, textOf, next, setList, shiftLevel, snapshot, cellOf, insertRow, deleteRow, insertColumn, deleteColumn, replace, format, hasFormat, split, mergeNext, remove, toBytes, doc };
}
