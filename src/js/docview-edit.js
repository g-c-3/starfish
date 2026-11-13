// docview-edit.js — the docx editor view, step 2 of Phase 119 (Decision 474). The rendered paragraphs (`.eo-p[data-pi]`, drawn in Reflow)
// become editable in place; each one is mapped to its paragraph in the engine (`docedit.js`) by the index the reader stamped on it.
// Typing, deleting and IME input are left to the browser and then synced: the paragraph's text is compared with the engine's and the
// changed span is applied with `replace`, so the original runs keep their properties. Enter, Backspace at the start and Delete at the
// end are done by the engine and the page together. A paragraph the engine locks, or whose text differs from the engine's, stays read only.
// Contract with the shell mount: mountEditor({ paper, bytes, toast, onActivity, onDirty }) -> { groups, setEditable, dirty, touched,
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

const IC = {
  b: '<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>',
  i: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  u: '<path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/>',
  strike: '<path d="M5 12h14M16 7.5C15 6 13.7 5 12 5c-2 0-3.5 1.2-3.5 3 0 4 7.5 2.5 7.5 6.5 0 1.8-1.7 3.5-4 3.5-1.9 0-3.5-1-4.2-2.7"/>'
};

export function mountEditor({ paper, bytes, toast = () => {}, onActivity = () => {}, onDirty = () => {} }) {
  const eng = openDoc(bytes); // throws an office error for a file that is not a valid document
  const ps = eng.paragraphs();
  const map = new Map(); // paragraph element -> engine paragraph
  let editing = false; let isDirty = false; let was = false; let lastRange = null;

  for (const el of paper.querySelectorAll('.eo-p[data-pi]')) {
    const node = ps[Number(el.dataset.pi)];
    if (!node || !eng.editable(node)) continue;
    if (norm(domText(el)) !== norm(eng.textOf(node))) continue; // not what the engine holds: left read only
    map.set(el, node);
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

  return {
    groups,
    get count() { return map.size; },
    setEditable(on) {
      editing = on;
      for (const el of map.keys()) { if (on) el.contentEditable = 'true'; else el.removeAttribute('contenteditable'); }
    },
    dirty: () => isDirty, touched: () => was,
    markClean() { isDirty = false; onDirty(); },
    bytes: () => eng.toBytes(),
    destroy() {
      paper.removeEventListener('beforeinput', onBefore); paper.removeEventListener('input', onInput);
      paper.removeEventListener('compositionend', onEnd); document.removeEventListener('selectionchange', onSel);
      for (const el of map.keys()) el.removeAttribute('contenteditable');
      map.clear();
    }
  };
}
