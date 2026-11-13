// odtedit.js — the odt editing engine, step 3 of Phase 119 (Decision 475). Same operations and offsets as docedit.js, on `content.xml`.
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

  const toBytes = () => {
    const xml = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
    const out = {};
    for (const k of Object.keys(files)) out[k] = [k === MAIN ? new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`) : files[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { paragraphs, editable, textOf, next, replace, format, hasFormat, split, mergeNext, remove, toBytes, doc };
}
