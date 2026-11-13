// docedit.js — the docx editing engine, step 1 of Phase 119 (Decision 473); `openDoc` hands an odt to odtedit.js (Decision 475). It changes the original document.xml in place and writes the zip
// back with every other part byte for byte, so styles, numbering, headers, pictures and anything not edited are kept as they were (Decision 453).
// No screen yet: the editor view builds on these operations. Offsets count the characters of a paragraph's plain text (tab and line break
// are one character each). A paragraph that holds anything but plain text runs (a picture, a field, a footnote mark, a drawing) is locked:
// `editable(p)` is false and every operation refuses it.
import { unzipSync, zipSync } from 'fflate';
import { openOdt } from './odtedit.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAIN = 'word/document.xml';
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
const FORMATS = { b: 'b', i: 'i', u: 'u', strike: 'strike' };
const STORED = /\.(png|jpe?g|gif|webp|zip|mp[34]|docx|xlsx|pptx)$/i;
const isW = (n, name) => n && n.nodeType === 1 && n.namespaceURI === W && n.localName === name;
const kids = (n, name) => [...n.children].filter((c) => isW(c, name));
const kid = (n, name) => (n ? kids(n, name)[0] || null : null);
const mk = (doc, name) => doc.createElementNS(W, `w:${name}`);
export class EditError extends Error { constructor(m) { super(m); this.office = true; } }

// text of a simple run, or null when the run holds anything else
function runText(r) {
  let s = '';
  for (const c of r.children) {
    if (isW(c, 'rPr')) continue;
    if (isW(c, 't')) s += c.textContent;
    else if (isW(c, 'tab')) s += '\t';
    else if (isW(c, 'br') && !c.getAttributeNS(W, 'type')) s += '\n';
    else return null;
  }
  return s;
}
const SKIP_P = new Set(['pPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr']);

export function openDoc(bytes) {
  const files = unzipSync(bytes);
  if (!files[MAIN] && files['content.xml']) return openOdt(files, EditError); // an OpenDocument text (Decision 475)
  if (!files[MAIN]) throw new EditError('This is not a valid file of this type.');
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(files[MAIN]), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new EditError('This file could not be read for editing.');
  const body = [...doc.getElementsByTagNameNS(W, 'body')][0];
  if (!body) throw new EditError('This is not a valid file of this type.');

  const paragraphs = () => [...body.getElementsByTagNameNS(W, 'p')];
  // the runs of a paragraph that carry its text, in order; null when the paragraph is locked
  const runsOf = (p) => {
    const out = [];
    for (const c of p.children) {
      if (SKIP_P.has(c.localName) && c.namespaceURI === W) continue;
      if (!isW(c, 'r')) return null;
      const t = runText(c); if (t === null) return null;
      out.push({ r: c, text: t });
    }
    return out;
  };
  const editable = (p) => runsOf(p) !== null;
  const textOf = (p) => { const rs = runsOf(p); return rs ? rs.map((x) => x.text).join('') : null; };
  const setRunText = (r, text) => {
    for (const c of [...r.children]) if (!isW(c, 'rPr')) r.removeChild(c);
    let buf = '';
    const flush = () => { if (buf) { const t = mk(doc, 't'); t.textContent = buf; if (/^\s|\s$|\s\s/.test(buf)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); r.appendChild(t); buf = ''; } };
    for (const ch of text) { if (ch === '\t') { flush(); r.appendChild(mk(doc, 'tab')); } else if (ch === '\n') { flush(); r.appendChild(mk(doc, 'br')); } else buf += ch; }
    flush();
  };
  // cut the run at `at` characters: the part after it becomes a new run (same properties) placed next; returns that new run, or null at an edge
  const splitRun = (entry, at) => {
    if (at <= 0 || at >= entry.text.length) return null;
    const second = entry.r.cloneNode(true);
    setRunText(entry.r, entry.text.slice(0, at)); setRunText(second, entry.text.slice(at));
    entry.r.after(second); return { r: second, text: entry.text.slice(at) };
  };
  // make sure there is a run boundary at `offset`; returns the runs list afterwards
  const boundary = (p, offset) => {
    let rs = runsOf(p); let pos = 0;
    for (let k = 0; k < rs.length; k++) {
      const len = rs[k].text.length;
      if (offset > pos && offset < pos + len) { splitRun(rs[k], offset - pos); break; }
      pos += len;
    }
    return runsOf(p);
  };
  const lockCheck = (p) => { if (!p || !editable(p)) throw new EditError('This paragraph holds a picture, field or note mark and cannot be edited here.'); };
  const clamp = (p, from, to) => { const n = textOf(p).length; return [Math.max(0, Math.min(from, n)), Math.max(0, Math.min(to, n))]; };

  // replace [from, to) of the paragraph's text by `insert` (the first affected run keeps its properties)
  const replace = (p, from, to, insert = '') => {
    lockCheck(p); [from, to] = clamp(p, from, to); if (to < from) to = from;
    let rs = boundary(p, from); rs = boundary(p, to);
    let pos = 0; let target = null; let at = -1;
    for (let k = 0; k < rs.length; k++) { const len = rs[k].text.length; if (pos >= from && pos + len <= to && len) { if (!target) { target = rs[k]; at = k; } else rs[k].r.remove(); } pos += len; }
    if (target) { setRunText(target.r, insert); if (!insert) target.r.remove(); return from + insert.length; }
    if (!insert) return from;
    // nothing was removed: add to the run that ends here, else the one that starts here, else a new run
    rs = runsOf(p); pos = 0; let host = null; let before = true;
    for (const e of rs) { const end = pos + e.text.length; if (end === from && e.text.length) { host = e; before = true; } if (!host && pos === from) { host = e; before = false; } pos = end; }
    if (host) { setRunText(host.r, before ? host.text + insert : insert + host.text); return from + insert.length; }
    const r = mk(doc, 'r'); setRunText(r, insert); p.appendChild(r); return from + insert.length;
  };
  // set or clear bold, italic, underline or strikethrough on [from, to)
  const format = (p, from, to, prop, on) => {
    lockCheck(p); if (!FORMATS[prop]) throw new EditError('That format is not available.');
    [from, to] = clamp(p, from, to); if (to <= from) return;
    boundary(p, from); const rs = boundary(p, to); let pos = 0;
    for (const e of rs) {
      const len = e.text.length;
      if (len && pos >= from && pos + len <= to) {
        let rpr = kid(e.r, 'rPr'); if (!rpr) { rpr = mk(doc, 'rPr'); e.r.insertBefore(rpr, e.r.firstChild); }
        const old = kid(rpr, prop); if (old) rpr.removeChild(old);
        if (on) {
          const n = mk(doc, prop); if (prop === 'u') n.setAttributeNS(W, 'w:val', 'single');
          const ix = RPR_ORDER.indexOf(prop); let ref = null;
          for (const c of rpr.children) { if (RPR_ORDER.indexOf(c.localName) > ix) { ref = c; break; } }
          rpr.insertBefore(n, ref);
        }
        if (!rpr.children.length) e.r.removeChild(rpr);
      }
      pos += len;
    }
  };
  const hasFormat = (p, from, to, prop) => {
    lockCheck(p); [from, to] = clamp(p, from, to); let pos = 0; let any = false;
    for (const e of runsOf(p)) { const len = e.text.length; if (len && pos < to && pos + len > from) { const n = kid(kid(e.r, 'rPr'), prop); const off = n && /^(0|false|none)$/i.test(n.getAttributeNS(W, 'val') || ''); if (!n || off) return false; any = true; } pos += len; }
    return any;
  };
  // Enter: split at `offset`; the new paragraph takes the same properties, and a section end moves to it (it is now the last)
  const split = (p, offset) => {
    lockCheck(p); [offset] = clamp(p, offset, offset); boundary(p, offset);
    const rs = runsOf(p); const np = p.cloneNode(false); const ppr = kid(p, 'pPr');
    if (ppr) { np.appendChild(ppr.cloneNode(true)); const sp = kid(ppr, 'sectPr'); if (sp) ppr.removeChild(sp); } // a section end moves to the last of the two
    let pos = 0; for (const e of rs) { if (pos >= offset && e.text.length) np.appendChild(e.r); pos += e.text.length; }
    p.after(np); return np;
  };
  // Backspace at the start: the next paragraph's text joins this one
  const mergeNext = (p) => {
    lockCheck(p); const nx = p.nextElementSibling; if (!isW(nx, 'p')) return false; lockCheck(nx);
    const sp = kid(kid(nx, 'pPr'), 'sectPr');
    if (sp) { // the section end comes along, unless this paragraph ends one too
      if (kid(kid(p, 'pPr'), 'sectPr')) throw new EditError('Two sections end here; the paragraphs cannot be joined.');
      let ppr = kid(p, 'pPr'); if (!ppr) { ppr = mk(doc, 'pPr'); p.insertBefore(ppr, p.firstChild); }
      ppr.appendChild(sp);
    }
    for (const e of runsOf(nx)) p.appendChild(e.r); nx.remove(); return true;
  };
  const next = (p) => { const s = p.nextElementSibling; return isW(s, 'p') ? s : null; }; // the paragraph that follows p, if it is the next sibling
  const remove = (p) => { if (kid(kid(p, 'pPr'), 'sectPr')) throw new EditError('A section ends here; the paragraph cannot be removed.'); p.remove(); };

  // ---- table rows and columns (Decision 476): tables with merged cells, or with rows of different widths, are refused ----
  const TABLE_ERR = 'This table cannot be changed here.';
  const where = (p) => {
    let tc = null; for (let n = p && p.parentNode; n; n = n.parentNode) if (isW(n, 'tc')) { tc = n; break; }
    if (!tc || !isW(tc.parentNode, 'tr') || !isW(tc.parentNode.parentNode, 'tbl')) throw new EditError('Put the cursor in a table cell first.');
    const tr = tc.parentNode; const tbl = tr.parentNode; const rows = kids(tbl, 'tr'); const cols = kids(tr, 'tc').length;
    for (const r of rows) {
      const trpr = kid(r, 'trPr');
      if (kid(trpr, 'gridBefore') || kid(trpr, 'gridAfter') || kids(r, 'tc').length !== cols) throw new EditError(TABLE_ERR);
      for (const c of r.children) {
        if (isW(c, 'tc')) { const pr = kid(c, 'tcPr'); const gs = kid(pr, 'gridSpan'); if ((gs && Number(gs.getAttributeNS(W, 'val') || 1) > 1) || kid(pr, 'vMerge')) throw new EditError('This table has merged cells; rows and columns cannot be changed here.'); }
        else if (!isW(c, 'trPr') && !isW(c, 'tblPrEx')) throw new EditError(TABLE_ERR);
      }
    }
    return { tc, tr, tbl, rows, rows_n: rows.length, cols, ri: rows.indexOf(tr), ci: kids(tr, 'tc').indexOf(tc) };
  };
  const cellOf = (p) => { const w = where(p); return { ri: w.ri, ci: w.ci, rows: w.rows_n, cols: w.cols }; };
  // a copy of a cell with only its first paragraph, emptied (its properties kept); returns that paragraph
  const blank = (tc) => {
    const blocks = [...tc.children].filter((c) => !isW(c, 'tcPr')); const first = blocks[0];
    if (!isW(first, 'p')) throw new EditError(TABLE_ERR);
    for (const b of blocks.slice(1)) tc.removeChild(b);
    for (const c of [...first.children]) if (!isW(c, 'pPr')) first.removeChild(c);
    const ppr = kid(first, 'pPr'); const sp = kid(ppr, 'sectPr'); if (sp) ppr.removeChild(sp);
    return first;
  };
  const firstP = (tc) => (tc ? [...tc.children].find((c) => isW(c, 'p')) || null : null);
  // table width in twentieths of a point follows the grid when it is fixed that way
  const widen = (tbl, by) => { const tw = kid(kid(tbl, 'tblPr'), 'tblW'); if (tw && tw.getAttributeNS(W, 'type') === 'dxa' && by) tw.setAttributeNS(W, 'w:w', String(Math.max(0, Number(tw.getAttributeNS(W, 'w') || 0) + by))); };
  const gridW = (g) => Number(g && g.getAttributeNS(W, 'w') || 0);
  // a new row beside the paragraph's row; returns the new first paragraph of each cell
  const insertRow = (p, after = true) => {
    const { tr } = where(p); const nr = tr.cloneNode(true);
    const trpr = kid(nr, 'trPr'); if (trpr) { for (const h of kids(trpr, 'tblHeader')) trpr.removeChild(h); if (!trpr.children.length) nr.removeChild(trpr); }
    const out = kids(nr, 'tc').map(blank);
    if (after) tr.after(nr); else tr.before(nr);
    return out;
  };
  // removes the row; returns the paragraph to put the caret in (same column, the next row or else the previous)
  const deleteRow = (p) => {
    const w = where(p); if (w.rows_n < 2) throw new EditError('A table keeps at least one row.');
    const near = w.rows[w.ri + 1] || w.rows[w.ri - 1]; const cells = kids(near, 'tc');
    w.tr.remove(); return firstP(cells[Math.min(w.ci, cells.length - 1)]);
  };
  // a new column beside the paragraph's column; returns the new first paragraph of each row
  const insertColumn = (p, after = true) => {
    const w = where(p); const grid = kid(w.tbl, 'tblGrid'); const gc = grid ? kids(grid, 'gridCol') : [];
    if (gc.length && gc.length !== w.cols) throw new EditError(TABLE_ERR);
    const out = [];
    for (const r of w.rows) { const tc = kids(r, 'tc')[w.ci]; const nc = tc.cloneNode(true); out.push(blank(nc)); if (after) tc.after(nc); else tc.before(nc); }
    if (gc.length) { const g = gc[w.ci].cloneNode(true); if (after) gc[w.ci].after(g); else gc[w.ci].before(g); widen(w.tbl, gridW(g)); }
    return out;
  };
  const deleteColumn = (p) => {
    const w = where(p); if (w.cols < 2) throw new EditError('A table keeps at least one column.');
    const grid = kid(w.tbl, 'tblGrid'); const gc = grid ? kids(grid, 'gridCol') : [];
    if (gc.length && gc.length !== w.cols) throw new EditError(TABLE_ERR);
    let focus = null;
    for (const r of w.rows) {
      const cells = kids(r, 'tc'); const tc = cells[w.ci];
      if (r === w.tr) focus = firstP(cells[w.ci + 1] || cells[w.ci - 1]);
      r.removeChild(tc);
    }
    if (gc.length) { widen(w.tbl, -gridW(gc[w.ci])); grid.removeChild(gc[w.ci]); }
    return focus;
  };

  const toBytes = () => {
    const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const xml = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
    const out = {};
    for (const k of Object.keys(files)) out[k] = [k === MAIN ? new TextEncoder().encode(decl + xml) : files[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { paragraphs, editable, textOf, runsOf, next, cellOf, insertRow, deleteRow, insertColumn, deleteColumn, replace, format, hasFormat, split, mergeNext, remove, toBytes, doc };
}
