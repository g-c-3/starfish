// docview-edit.js — the docx editor view, step 2 of Phase 119 (Decision 474); table rows and columns, step 4a (Decision 476); lists, step 4c (Decision 479); pictures, step 4d (Decision 481). The rendered paragraphs (`.eo-p[data-pi]`, drawn in Reflow)
// become editable in place; each one is mapped to its paragraph in the engine (`docedit.js`) by the index the reader stamped on it.
// Typing, deleting and IME input are left to the browser and then synced: the paragraph's text is compared with the engine's and the
// changed span is applied with `replace`, so the original runs keep their properties. Enter, Backspace at the start and Delete at the
// end are done by the engine and the page together. A paragraph the engine locks, or whose text differs from the engine's, stays read only.
// Contract with the shell mount: mountEditor({ paper, bytes, toast, onActivity, onDirty, redraw, pickImage }) (redraw(files, wantedIndexes) -> Map of index -> freshly drawn paragraph, for list markers; pickImage() -> Promise of { bytes, mime, ext, w, h } or null) -> { groups, setEditable, dirty, touched,
// markClean, bytes, count, destroy }.
import { openDoc } from './docedit.js';

const CMD = { b: 'bold', i: 'italic', u: 'underline', strike: 'strikeThrough' };
const isMark = (n) => n.nodeType === 1 && n.classList.contains('eo-mark');
const norm = (s) => s.replace(/\u00a0/g, ' ');
// plain text of a node: a line break is one character, the list marker is not text
function tx(n) {
  if (n.nodeType === 3) return n.data;
  if (n.nodeType === 1) { if (isMark(n)) return ''; if (n.nodeName === 'BR') return '\n'; }
  let s = ''; for (const c of n.childNodes) s += tx(c); return s;
}
const content = (el) => [...el.childNodes].filter((c) => !isMark(c));
// an empty paragraph holds one <br> so that it keeps its height; that is not a line break
function domText(el) { const k = content(el); return k.length === 1 && k[0].nodeName === 'BR' ? '' : tx(el); }
const WALK = { acceptNode: (n) => (n.nodeType === 3 ? 1 : isMark(n) ? 2 : n.nodeName === 'BR' ? 1 : 3) };
// the DOM position of a character offset in a paragraph
function locate(el, off) {
  const w = document.createTreeWalker(el, 5, WALK); let pos = 0; let last = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) { const l = n.data.length; if (off <= pos + l) return { node: n, offset: off - pos }; pos += l; last = n; }
    else { if (off <= pos) return { node: n.parentNode, offset: [...n.parentNode.childNodes].indexOf(n) }; pos += 1; }
  }
  return last ? { node: last, offset: last.data.length } : { node: el, offset: el.childNodes.length };
}
// the character offset of a DOM position in a paragraph
function offsetIn(el, node, off) {
  const r = document.createRange(); r.setStart(el, 0); r.setEnd(node, off);
  const f = r.cloneContents(); const k = [...f.childNodes].filter((c) => !isMark(c));
  return k.length === 1 && k[0].nodeName === 'BR' ? 0 : tx(f).length;
}

// A picture from the phone, read in the page: kept as it is when it is a png, jpeg or gif of at most 2000 px, otherwise redrawn smaller (or as a png)
const MAX_SIDE = 2000;
async function readPicture(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('That picture is too large.');
  let bmp; try { bmp = await createImageBitmap(file); } catch { throw new Error('That picture could not be read.'); }
  let w = bmp.width; let h = bmp.height; let mime = file.type; let bytes;
  if (/^image\/(png|jpeg|gif)$/.test(file.type) && Math.max(w, h) <= MAX_SIDE) bytes = new Uint8Array(await file.arrayBuffer());
  else {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((r) => cv.toBlob(r, mime, 0.88)); if (!blob) throw new Error('That picture could not be read.');
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  if (bmp.close) bmp.close();
  return { bytes, mime, ext: mime === 'image/jpeg' ? 'jpg' : mime === 'image/gif' ? 'gif' : 'png', w, h };
}
const pickFromPhone = () => new Promise((resolve, reject) => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) resolve(null); else readPicture(f).then(resolve, reject); };
  inp.click();
});

const IC = {
  b: '<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>',
  i: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  u: '<path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/>',
  strike: '<path d="M5 12h14M16 7.5C15 6 13.7 5 12 5c-2 0-3.5 1.2-3.5 3 0 4 7.5 2.5 7.5 6.5 0 1.8-1.7 3.5-4 3.5-1.9 0-3.5-1-4.2-2.7"/>'
};

export function mountEditor({ paper, bytes, toast = () => {}, onActivity = () => {}, onDirty = () => {}, redraw = null, pickImage = pickFromPhone }) {
  const eng = openDoc(bytes); // throws an office error for a file that is not a valid document
  const ps = eng.paragraphs();
  const map = new Map(); // paragraph element -> engine paragraph
  let editing = false; let isDirty = false; let was = false; let lastRange = null;

  const used = new Set(); // an odt cell repeated in the file is drawn several times from one paragraph: only the first stays editable
  for (const el of paper.querySelectorAll('.eo-p[data-pi]')) {
    const node = ps[Number(el.dataset.pi)];
    if (!node || used.has(node) || !eng.editable(node)) continue;
    if (norm(domText(el)) !== norm(eng.textOf(node))) continue; // not what the engine holds: left read only
    map.set(el, node); used.add(node);
  }
  const order = () => [...paper.querySelectorAll('.eo-p')].filter((e) => map.has(e));
  const elOf = (n) => { for (let e = n && (n.nodeType === 1 ? n : n.parentNode); e && e !== paper; e = e.parentNode) if (map.has(e)) return e; return null; };
  const dirty = () => { isDirty = true; was = true; onDirty(); };
  const setCaret = (el, off) => {
    const p = locate(el, off); const r = document.createRange(); r.setStart(p.node, p.offset); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); try { el.focus(); } catch { /* not focusable */ }
  };
  const keepHeight = (el) => { if (tx(el) === '') el.appendChild(document.createElement('br')); };

  // the changed span of a paragraph goes to the engine
  const sync = (el) => {
    const node = map.get(el); if (!node) return;
    const old = eng.textOf(node); const now = norm(domText(el));
    if (norm(old) === now) return;
    const o = norm(old); let a = 0; const max = Math.min(o.length, now.length);
    while (a < max && o[a] === now[a]) a++;
    let b = 0; while (b < max - a && o[o.length - 1 - b] === now[now.length - 1 - b]) b++;
    try { eng.replace(node, a, old.length - b, now.slice(a, now.length - b)); dirty(); } catch (e) { toast(e.message); }
  };

  // Enter: split the paragraph in the engine and the page
  const enter = (el, rg) => {
    if (!rg.collapsed) { document.execCommand('delete'); sync(el); rg = window.getSelection().getRangeAt(0); }
    const node = map.get(el); const off = offsetIn(el, rg.startContainer, rg.startOffset);
    let np; try { np = eng.split(node, off); } catch (e) { toast(e.message); return; }
    const r = document.createRange(); r.setStart(rg.startContainer, rg.startOffset); r.setEnd(el, el.childNodes.length);
    const frag = r.extractContents();
    const ne = el.cloneNode(false); ne.removeAttribute('data-pi');
    const mk = [...el.childNodes].find(isMark); if (mk) ne.appendChild(mk.cloneNode(true));
    ne.appendChild(frag); keepHeight(el); keepHeight(ne);
    el.after(ne); if (editing) ne.contentEditable = 'true'; map.set(ne, np);
    dirty(); setCaret(ne, 0);
  };
  // Backspace at the start and Delete at the end: the second paragraph joins the first (only when the engine holds them side by side)
  const join = (a, b) => {
    const na = map.get(a); const nb = map.get(b);
    if (!na || !nb || eng.next(na) !== nb) return;
    let ok; try { ok = eng.mergeNext(na); } catch (e) { toast(e.message); return; }
    if (!ok) return;
    const at = domText(a).length;
    const ka = content(a); if (ka.length === 1 && ka[0].nodeName === 'BR') ka[0].remove();
    if (domText(b) !== '') for (const c of [...b.childNodes]) if (!isMark(c)) a.appendChild(c);
    b.remove(); map.delete(b); keepHeight(a);
    dirty(); setCaret(a, at);
  };

  const onBefore = (e) => {
    if (!editing) return;
    const s = window.getSelection(); if (!s.rangeCount) return;
    const rg = s.getRangeAt(0); const a = elOf(rg.startContainer); const b = elOf(rg.endContainer);
    if (!a && !b) return;
    const t = e.inputType || '';
    if (a !== b) { e.preventDefault(); toast('Select inside one paragraph to change it.'); return; }
    onActivity();
    if (t === 'insertParagraph') { e.preventDefault(); enter(a, rg); return; }
    if (/^delete.*Backward$/.test(t) && rg.collapsed && offsetIn(a, rg.startContainer, rg.startOffset) === 0) {
      e.preventDefault(); const i = order().indexOf(a); if (i > 0) join(order()[i - 1], a); return;
    }
    if (/^delete.*Forward$/.test(t) && rg.collapsed && offsetIn(a, rg.startContainer, rg.startOffset) === domText(a).length) {
      e.preventDefault(); const l = order(); const i = l.indexOf(a); if (i >= 0 && i < l.length - 1) join(a, l[i + 1]); return;
    }
    if (t === 'insertFromPaste' || t === 'insertFromPasteAsQuotation') { // plain text only, on one line
      e.preventDefault();
      const text = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (text) document.execCommand('insertText', false, text.replace(/\r?\n+/g, ' '));
      return;
    }
    if (t === 'insertFromDrop') e.preventDefault();
  };
  const onInput = (e) => { if (!editing || e.isComposing) return; const el = elOf(e.target); if (el) { onActivity(); sync(el); } };
  const onEnd = (e) => { const el = elOf(e.target); if (el && editing) sync(el); };
  const onSel = () => {
    const s = window.getSelection();
    if (s && s.rangeCount) { const r = s.getRangeAt(0); if (elOf(r.startContainer) && elOf(r.endContainer)) lastRange = r.cloneRange(); }
  };
  paper.addEventListener('beforeinput', onBefore);
  paper.addEventListener('input', onInput);
  paper.addEventListener('compositionend', onEnd);
  document.addEventListener('selectionchange', onSel);

  // formats: the engine decides on or off; the page follows the same range
  const targets = () => {
    const rg = lastRange; if (!rg || rg.collapsed) return [];
    const out = [];
    for (const el of order()) {
      if (!rg.intersectsNode(el)) continue;
      const from = el.contains(rg.startContainer) ? offsetIn(el, rg.startContainer, rg.startOffset) : 0;
      const to = el.contains(rg.endContainer) ? offsetIn(el, rg.endContainer, rg.endOffset) : domText(el).length;
      if (to > from) out.push({ el, from, to });
    }
    return out;
  };
  const isOn = (prop) => { const ts = targets(); return ts.length > 0 && ts.every((t) => { try { return eng.hasFormat(map.get(t.el), t.from, t.to, prop); } catch { return false; } }); };
  const toggle = (prop) => {
    const ts = targets();
    if (!ts.length) { toast('Select some text first.'); return; }
    const on = !isOn(prop); const keep = lastRange.cloneRange(); const s = window.getSelection(); let any = false;
    for (const t of ts) {
      try { eng.format(map.get(t.el), t.from, t.to, prop, on); } catch (e) { toast(e.message); continue; }
      any = true;
      const a = locate(t.el, t.from); const z = locate(t.el, t.to); const r = document.createRange();
      r.setStart(a.node, a.offset); r.setEnd(z.node, z.offset); s.removeAllRanges(); s.addRange(r);
      try { t.el.focus({ preventScroll: true }); if (document.queryCommandState(CMD[prop]) !== on) document.execCommand(CMD[prop]); } catch { /* the page keeps its look; the file has the format */ }
    }
    s.removeAllRanges(); s.addRange(keep); lastRange = keep;
    if (any) dirty();
  };
  const fmt = (id, label, prop) => ({ id, label, icon: IC[prop], run: () => toggle(prop), on: () => isOn(prop) });
  const groups = [{ id: 'text', title: 'Text', tools: [fmt('b', 'Bold', 'b'), fmt('i', 'Italic', 'i'), fmt('u', 'Underline', 'u'), fmt('s', 'Strikethrough', 'strike')] }];


  // ---- table rows and columns (Decision 476): the engine changes the file first, then the page follows ----
  const cellInfo = () => {
    const el = lastRange && elOf(lastRange.startContainer); const td = el && el.closest('td');
    return td && paper.contains(td) && map.has(el) ? { el, td, tr: td.parentNode, table: td.closest('table') } : null;
  };
  const blankTd = (src) => { // a copy of a cell holding one empty paragraph
    const td = src.cloneNode(true); const p = td.firstElementChild;
    if (!p || !p.classList.contains('eo-p')) throw new Error('This table cannot be changed here.');
    for (const c of [...td.children]) if (c !== p) td.removeChild(c);
    for (const c of [...p.childNodes]) if (!isMark(c)) p.removeChild(c);
    p.removeAttribute('data-pi'); p.removeAttribute('contenteditable'); p.appendChild(document.createElement('br'));
    return { td, p };
  };
  const adopt = (p, node) => { map.set(p, node); if (editing) p.contentEditable = 'true'; };
  const forget = (root) => { for (const e of root.querySelectorAll('.eo-p')) map.delete(e); };
  const colgroup = (table) => [...table.children].find((x) => x.tagName === 'COLGROUP') || null;
  const resize = (table, col, sign) => { const w = parseFloat(col && col.style.width); const t = parseFloat(table.style.width); if (w && t && table.style.width.endsWith('px')) table.style.width = `${Math.max(0, t + sign * w)}px`; };
  const tableTool = (fn) => () => {
    const c = cellInfo(); const node = c && map.get(c.el);
    if (!c) { toast('Put the cursor in a table cell first.'); return; }
    try {
      const info = eng.cellOf(node);
      if (c.table.rows.length !== info.rows || [...c.table.rows].some((r) => r.cells.length !== info.cols)) throw new Error('This table cannot be changed here.');
      fn(c, node, info); onActivity();
    } catch (e) { toast(e.message || 'This table cannot be changed here.'); }
  };
  const addRow = (after) => tableTool((c, node, info) => {
    const tds = [...c.tr.cells].map(blankTd); const made = eng.insertRow(node, after);
    const nr = c.tr.cloneNode(false);
    tds.forEach((x, i) => { nr.appendChild(x.td); adopt(x.p, made[i]); });
    if (after) c.tr.after(nr); else c.tr.before(nr);
    dirty(); setCaret(tds[Math.min(info.ci, tds.length - 1)].p, 0);
  });
  const dropRow = tableTool((c, node, info) => {
    const rows = [...c.table.rows]; const near = rows[info.ri + 1] || rows[info.ri - 1];
    eng.deleteRow(node); forget(c.tr); c.tr.remove();
    dirty(); const cell = near && near.cells[Math.min(info.ci, near.cells.length - 1)]; const p = cell && cell.querySelector('.eo-p'); if (p) setCaret(p, 0);
  });
  const addColumn = (after) => tableTool((c, node, info) => {
    const rows = [...c.table.rows]; const blanks = rows.map((r) => blankTd(r.cells[info.ci])); const made = eng.insertColumn(node, after);
    rows.forEach((r, i) => { const cell = r.cells[info.ci]; if (after) cell.after(blanks[i].td); else cell.before(blanks[i].td); adopt(blanks[i].p, made[i]); });
    const cg = colgroup(c.table); const at = cg && cg.children[info.ci];
    if (at) { const col = at.cloneNode(true); if (after) at.after(col); else at.before(col); resize(c.table, col, 1); }
    dirty(); const mine = blanks[info.ri].p; setCaret(mine, 0);
  });
  const dropColumn = tableTool((c, node, info) => {
    const rows = [...c.table.rows]; eng.deleteColumn(node);
    const keep = c.tr.cells[info.ci + 1] || c.tr.cells[info.ci - 1];
    for (const r of rows) { const cell = r.cells[info.ci]; forget(cell); cell.remove(); }
    const cg = colgroup(c.table); const at = cg && cg.children[info.ci]; if (at) { resize(c.table, at, -1); at.remove(); }
    dirty(); const p = keep && keep.querySelector('.eo-p'); if (p) setCaret(p, 0);
  });
  const tool = (id, label, icon, run) => ({ id, label, icon, run });
  const TI = {
    rowUp: '<rect x="4" y="11" width="16" height="9" rx="1"/><path d="M12 3v5M9.5 5.5h5"/>',
    rowDown: '<rect x="4" y="4" width="16" height="9" rx="1"/><path d="M12 16v5M9.5 18.5h5"/>',
    rowDel: '<rect x="4" y="5" width="16" height="9" rx="1"/><path d="M8 18l8 3M16 18l-8 3"/>',
    colLeft: '<rect x="11" y="4" width="9" height="16" rx="1"/><path d="M3 12h5M5.5 9.5v5"/>',
    colRight: '<rect x="4" y="4" width="9" height="16" rx="1"/><path d="M16 12h5M18.5 9.5v5"/>',
    colDel: '<rect x="5" y="4" width="9" height="16" rx="1"/><path d="M18 8l3 8M21 8l-3 8"/>'
  };
  groups.push({ id: 'table', title: 'Table', tools: [
    tool('rowUp', 'Row above', TI.rowUp, addRow(false)), tool('rowDown', 'Row below', TI.rowDown, addRow(true)), tool('rowDel', 'Delete row', TI.rowDel, dropRow),
    tool('colLeft', 'Column left', TI.colLeft, addColumn(false)), tool('colRight', 'Column right', TI.colRight, addColumn(true)), tool('colDel', 'Delete column', TI.colDel, dropColumn)
  ] });


  // ---- lists (Decision 479): the engine changes the paragraphs, then the markers and indents on the page are taken from the file as it now stands ----
  const selParas = () => {
    const a = lastRange && elOf(lastRange.startContainer); const b = lastRange && elOf(lastRange.endContainer); if (!a || !b) return null;
    const o = order(); const i = o.indexOf(a); const j = o.indexOf(b); return i < 0 || j < 0 ? null : o.slice(Math.min(i, j), Math.max(i, j) + 1);
  };
  const refreshMarks = (changed) => {
    if (!redraw) return;
    const fresh = eng.paragraphs(); const idx = new Map(fresh.map((n, i) => [n, i])); const byNode = new Map(); const want = new Set();
    for (const [e, n] of map) { byNode.set(n, e); if (idx.has(n) && (changed.includes(e) || [...e.children].some(isMark))) want.add(idx.get(n)); }
    for (const [k, t] of redraw(eng.snapshot(), want)) {
      const e = byNode.get(fresh[k]); if (!e || !t) continue;
      const old = [...e.children].find(isMark); if (old) old.remove();
      const m = [...t.children].find(isMark); if (m) e.insertBefore(m, e.firstChild);
      e.style.marginLeft = t.style.marginLeft; e.style.textIndent = t.style.textIndent;
    }
  };
  const listTool = (fn, none) => () => {
    const els = selParas(); if (!els) { toast('Put the cursor in a paragraph first.'); return; }
    try { if (!fn(els.map((e) => map.get(e)))) { toast(none); return; } refreshMarks(els); dirty(); onActivity(); } catch (e) { toast(e.message || 'This list cannot be changed here.'); }
  };
  const LI = {
    bul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
    num: '<path d="M10 6h10M10 12h10M10 18h10M4 4.5l1.5-1v5M3.5 14.5c0-1 2.5-1 2.5.3 0 1-2.5 2-2.5 3.2h2.7"/>',
    off: '<path d="M9 6h11M9 12h11M9 18h11M3 3l18 18"/>',
    deep: '<path d="M4 6h16M12 12h8M12 18h8M4 10l3 2-3 2z"/>',
    shallow: '<path d="M4 6h16M12 12h8M12 18h8M8 10l-3 2 3 2z"/>'
  };
  if (eng.setList) groups.push({ id: 'list', title: 'List', tools: [
    tool('bullets', 'Bullets', LI.bul, listTool((p) => eng.setList(p, 'bullet'), 'Nothing to change.')),
    tool('numbers', 'Numbers', LI.num, listTool((p) => eng.setList(p, 'number'), 'Nothing to change.')),
    tool('nolist', 'No list', LI.off, listTool((p) => eng.setList(p, 'none'), 'These paragraphs are not in a list of their own.')),
    tool('deeper', 'Deeper', LI.deep, listTool((p) => eng.shiftLevel(p, 1), 'Not in a list, or already at the deepest level.')),
    tool('shallower', 'Shallower', LI.shallow, listTool((p) => eng.shiftLevel(p, -1), 'Not in a list, or already at the first level.'))
  ] });


  // ---- pictures (Decision 481): tap a picture to select it; Insert adds a paragraph with a picture after the caret's paragraph ----
  const picMap = new Map(); // paragraph element -> engine paragraph, for the paragraphs that show pictures (editable or not)
  const imgsOf = (el) => [...el.querySelectorAll('img.eo-img')];
  if (eng.pictures) for (const el of paper.querySelectorAll('.eo-p[data-pi]')) {
    const node = ps[Number(el.dataset.pi)]; const n = imgsOf(el).length;
    if (node && n && eng.pictures(node) === n) picMap.set(el, node); // the page and the file agree on how many
  }
  let selImg = null; const urls = [];
  const selectPic = (im) => { if (selImg) selImg.classList.remove('eo-pic-sel'); selImg = im; if (im) im.classList.add('eo-pic-sel'); };
  const onClick = (e) => { if (!editing) return; const im = e.target && e.target.closest ? e.target.closest('img.eo-img') : null; const el = im && im.closest('.eo-p'); selectPic(el && picMap.has(el) ? im : null); };
  paper.addEventListener('click', onClick);
  const picAt = () => { if (!selImg || !selImg.isConnected) return null; const el = selImg.closest('.eo-p'); const node = el && picMap.get(el); return node ? { el, node, i: imgsOf(el).indexOf(selImg) } : null; };
  const newUrl = (img) => { const u = URL.createObjectURL(new Blob([img.bytes], { type: img.mime })); urls.push(u); return u; };
  const picTool = (fn) => async () => { try { await fn(); onActivity(); } catch (e) { toast(e && e.message ? e.message : 'This picture cannot be changed here.'); } };
  const insertPic = picTool(async () => {
    const at = picAt(); const el = at ? at.el : lastRange && elOf(lastRange.startContainer); const node = el && (map.get(el) || picMap.get(el));
    if (!node) { toast('Put the cursor in a paragraph first.'); return; }
    const img = await pickImage(); if (!img) return;
    const r = eng.insertPictureAfter(node, img);
    const np = document.createElement('p'); np.className = 'eo-p'; const im = document.createElement('img'); im.className = 'eo-img'; im.alt = ''; im.src = newUrl(img); im.style.width = `${r.w}px`; np.appendChild(im);
    el.after(np); picMap.set(np, r.node); dirty(); selectPic(im);
  });
  const replacePic = picTool(async () => {
    const at = picAt(); if (!at) { toast('Tap a picture first.'); return; }
    const img = await pickImage(); if (!img) return;
    const im = selImg; if (!im || !at.el.contains(im)) return;
    const r = eng.replacePicture(at.node, imgsOf(at.el).indexOf(im), img); im.src = newUrl(img); im.style.width = `${r.w}px`; dirty();
  });
  const deletePic = picTool(async () => {
    const at = picAt(); if (!at) { toast('Tap a picture first.'); return; }
    eng.removePicture(at.node, at.i); const im = selImg; selectPic(null); im.remove();
    if (!imgsOf(at.el).length) picMap.delete(at.el);
    if (eng.editable(at.node) && !map.has(at.el) && norm(domText(at.el)) === norm(eng.textOf(at.node))) { keepHeight(at.el); map.set(at.el, at.node); if (editing) at.el.contentEditable = 'true'; } // a paragraph left without a picture can be typed in
    dirty();
  });
  const PI = {
    add: '<rect x="3" y="6" width="14" height="12" rx="1.5"/><circle cx="8" cy="10.5" r="1.4"/><path d="M3 16l4-3 3 2 3-3 4 3M20 3v6M17 6h6"/>',
    swap: '<rect x="3" y="5" width="14" height="12" rx="1.5"/><path d="M3 14l4-3 3 2 3-3 4 3M19 8h3l-1.5-2M22 19h-5l1.5 2"/>',
    del: '<rect x="3" y="5" width="14" height="12" rx="1.5"/><path d="M3 14l4-3 3 2 3-3 4 3M18 18l4 4M22 18l-4 4"/>'
  };
  if (eng.insertPictureAfter) groups.push({ id: 'picture', title: 'Picture', tools: [tool('picAdd', 'Insert picture', PI.add, insertPic), tool('picSwap', 'Replace picture', PI.swap, replacePic), tool('picDel', 'Delete picture', PI.del, deletePic)] });

  return {
    groups,
    get count() { return map.size; },
    setEditable(on) {
      editing = on; if (!on) selectPic(null);
      for (const el of map.keys()) { if (on) el.contentEditable = 'true'; else el.removeAttribute('contenteditable'); }
    },
    dirty: () => isDirty, touched: () => was,
    markClean() { isDirty = false; onDirty(); },
    bytes: () => eng.toBytes(),
    destroy() {
      paper.removeEventListener('beforeinput', onBefore); paper.removeEventListener('input', onInput);
      paper.removeEventListener('compositionend', onEnd); document.removeEventListener('selectionchange', onSel);
      paper.removeEventListener('click', onClick); for (const u of urls) URL.revokeObjectURL(u);
      for (const el of map.keys()) el.removeAttribute('contenteditable');
      map.clear(); picMap.clear();
    }
  };
}
