// Slide edit engine, odp (Decision 499, Phase 121 step 3). Same operations and the same calls as pptxedit.js, on `content.xml`.
// A changed part is written, every other part of the zip is kept as it was, `mimetype` first and stored.
// A text shape is a frame with a text box, or a drawn shape (custom shape, rectangle, ellipse, circle, polygon); groups are opened
// to the depth the reader opens them. Its id is its place in that order on the slide, counted from 1; office-odf.js counts the same way.
// Notes are the paragraphs of the notes frame of the slide's notes page. A layout is a master page.
// A slide that holds a chart or an embedded object, or an animation, is not duplicated; a slide another slide links to is not deleted.
import { unzipSync, zipSync } from 'fflate';

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  pres: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  xml: 'http://www.w3.org/XML/1998/namespace',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  anim: 'urn:oasis:names:tc:opendocument:xmlns:animation:1.0'
};
const MIME = 'application/vnd.oasis.opendocument.presentation';
const STORED = /^mimetype$|\.(png|jpe?g|gif|webp|zip|mp[34]|mov|wmv|docx|xlsx|pptx|odt|ods|odp)$/i;
const SLIDE_MAX = 500; // what the reader shows (office-odf.js)
const SHAPES = new Set(['custom-shape', 'rect', 'ellipse', 'circle', 'regular-polygon']);
const dec = (b) => new TextDecoder('utf-8').decode(b);
const enc = (s) => new TextEncoder().encode(s);
const is = (n, ns, name) => !!n && n.nodeType === 1 && n.namespaceURI === ns && n.localName === name;
const kids = (n, ns, name) => (n ? [...n.children].filter((c) => c.namespaceURI === ns && (!name || c.localName === name)) : []);
const kid = (n, ns, name) => kids(n, ns, name)[0] || null;
const isPara = (n) => is(n, NS.text, 'p') || is(n, NS.text, 'h');
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export class EditError extends Error { constructor(m) { super(m); this.office = true; } }

// plain text of a paragraph: spaces, tabs and line breaks as written, a field as its shown text, a comment as nothing
function plain(n) {
  let s = '';
  for (const c of n.childNodes) {
    if (c.nodeType === 3) { s += c.data; continue; }
    if (c.nodeType !== 1) continue;
    if (c.namespaceURI === NS.office) continue;
    if (c.namespaceURI === NS.text && c.localName === 's') { const k = Number(c.getAttributeNS(NS.text, 'c') || 1); s += ' '.repeat(k >= 1 && k <= 10000 ? k : 1); } else if (c.namespaceURI === NS.text && c.localName === 'tab') s += '\t';
    else if (c.namespaceURI === NS.text && c.localName === 'line-break') s += '\n';
    else s += plain(c);
  }
  return s;
}

// the paragraphs of a text box or a drawn shape, in order (lists opened); the reader reads the same ones
function parasOf(box, out = []) {
  for (const c of box.children) {
    if (isPara(c)) out.push(c);
    else if (is(c, NS.text, 'list')) for (const it of kids(c, NS.text, 'list-item')) for (const q of it.children) { if (isPara(q)) out.push(q); else if (is(q, NS.text, 'list')) parasOf({ children: [q] }, out); }
  }
  return out;
}

export function openOdp(bytes) {
  let files;
  try { files = unzipSync(bytes); } catch { throw new EditError('This file could not be read for editing.'); }
  for (const k of Object.keys(files)) if (k.endsWith('/')) delete files[k];
  if (!files.mimetype || !files['content.xml'] || dec(files.mimetype).trim() !== MIME) throw new EditError('This is not a valid file of this type.');
  const docs = new Map(); const changed = new Set();
  const part = (p) => {
    if (!docs.has(p)) {
      if (!files[p]) return null;
      const d = new DOMParser().parseFromString(dec(files[p]), 'application/xml');
      if (d.getElementsByTagName('parsererror').length) throw new EditError('This file could not be read for editing.');
      docs.set(p, d);
    }
    return docs.get(p);
  };
  const touch = (p) => { changed.add(p); };
  const ser = (d) => enc('<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/, ''));
  const content = part('content.xml'); const croot = content.documentElement;
  const pres = kid(kid(croot, NS.office, 'body'), NS.office, 'presentation');
  if (!pres) throw new EditError('This is not a valid file of this type.');
  const pages = () => kids(pres, NS.draw, 'page');
  if (pages().length > SLIDE_MAX) throw new EditError('This presentation has more slides than can be edited here.');
  const page = (si) => { const p = pages()[si]; if (!p) throw new EditError('That slide is not in the file.'); return p; };
  const dropIds = (n) => { for (const e of [n, ...n.getElementsByTagName('*')]) { e.removeAttributeNS(NS.xml, 'id'); e.removeAttributeNS(NS.draw, 'id'); } };

  // text shapes of a slide, in the order the reader counts them
  const shapesOf = (pg) => {
    const out = []; let n = 0;
    const walk = (parent, depth) => {
      for (const c of parent.children) {
        if (c.namespaceURI !== NS.draw && c.namespaceURI !== NS.pres) continue;
        const ln = c.localName;
        if (c.namespaceURI === NS.pres) continue; // the notes page
        if (ln === 'g' && depth < 6) { walk(c, depth + 1); continue; }
        if (ln === 'frame') { const tb = kid(c, NS.draw, 'text-box'); if (tb) { n += 1; out.push({ id: String(n), el: c, box: tb }); } } else if (SHAPES.has(ln)) { n += 1; out.push({ id: String(n), el: c, box: c }); }
      }
    };
    walk(pg, 0);
    return out;
  };
  const textOf = (box) => parasOf(box).map((p) => plain(p)).join('\n');
  const nameOf = (s) => s.el.getAttributeNS(NS.draw, 'name') || s.el.getAttributeNS(NS.pres, 'class') || '';
  const shapes = (si) => shapesOf(page(si)).map((s) => ({ id: s.id, name: nameOf(s), text: textOf(s.box), ph: s.el.getAttributeNS(NS.pres, 'class') || null }));
  const findShape = (si, id) => { const s = shapesOf(page(si)).find((x) => x.id === String(id)); if (!s) throw new EditError('That shape is not on the slide.'); return s; };

  // ---- text of a box: changed lines are compared from both ends; a paragraph whose lines are all unchanged is kept as it is ----
  const top = (p) => (is(p.parentNode, NS.text, 'list-item') ? p.parentNode : p);
  const fill = (np, line, spanStyle) => {
    if (!line) return;
    const d = np.ownerDocument; const holder = spanStyle ? d.createElementNS(NS.text, 'text:span') : np;
    if (spanStyle) holder.setAttributeNS(NS.text, 'text:style-name', spanStyle);
    const pieces = line.split('\t');
    pieces.forEach((piece, pi) => {
      if (pi) holder.appendChild(d.createElementNS(NS.text, 'text:tab'));
      const toks = piece.match(/ +|[^ ]+/g) || [];
      toks.forEach((t, ti) => {
        if (t[0] === ' ' && (t.length > 1 || ti === 0 || ti === toks.length - 1)) { const s = d.createElementNS(NS.text, 'text:s'); if (t.length > 1) s.setAttributeNS(NS.text, 'text:c', String(t.length)); holder.appendChild(s); } else holder.appendChild(d.createTextNode(t));
      });
    });
    if (spanStyle) np.appendChild(holder);
  };
  const make = (tpl, line) => {
    const np = tpl.cloneNode(false); dropIds(np);
    const sp = [...tpl.children].find((c) => is(c, NS.text, 'span'));
    fill(np, line, sp ? sp.getAttributeNS(NS.text, 'style-name') : null);
    if (is(tpl.parentNode, NS.text, 'list-item')) { const it = tpl.parentNode.cloneNode(false); dropIds(it); it.removeAttributeNS(NS.text, 'start-value'); it.appendChild(np); return it; }
    return np;
  };
  const unlink = (p) => {
    const c = top(p);
    if (c !== p && [...c.children].some((x) => x !== p)) { p.remove(); return; }
    const list = c.parentNode; c.remove();
    if (c !== p && is(list, NS.text, 'list') && !list.children.length) list.remove();
  };
  const writeBox = (box, text) => {
    const lines = clean(text).replace(/\r\n?/g, '\n').split('\n');
    const ps = parasOf(box);
    if (!ps.length) { if (text === '') return false; for (const l of lines) { const np = box.ownerDocument.createElementNS(NS.text, 'text:p'); fill(np, l, null); box.appendChild(np); } return true; }
    const units = []; let k = 0;
    for (const p of ps) { const ls = plain(p).split('\n'); units.push({ p, s: k, e: k + ls.length }); k += ls.length; }
    const old = ps.map((p) => plain(p)).join('\n').split('\n');
    if (old.length === lines.length && old.every((l, i) => l === lines[i])) return false;
    let a = 0; while (a < old.length && a < lines.length && old[a] === lines[a]) a++;
    let b = 0; while (b < old.length - a && b < lines.length - a && old[old.length - 1 - b] === lines[lines.length - 1 - b]) b++;
    const R = units.filter((u) => u.e > a && u.s < old.length - b);
    if (!R.length) { // lines added at the edge of a paragraph
      const prev = units.filter((u) => u.e <= a).pop(); const next = units.find((u) => u.s >= a); const tpl = (prev || next).p;
      const at = prev ? top(prev.p).nextSibling : top(next.p); const par = prev ? top(prev.p).parentNode : top(next.p).parentNode;
      for (const l of lines.slice(a, lines.length - b)) par.insertBefore(make(tpl, l), at);
      return true;
    }
    const slice = lines.slice(R[0].s, lines.length - (old.length - R[R.length - 1].e));
    if (!slice.length && R.length === units.length) { // everything removed: one empty paragraph stays
      for (const c of [...R[0].p.childNodes]) R[0].p.removeChild(c);
      for (const u of R.slice(1)) unlink(u.p);
      return true;
    }
    const first = top(R[0].p);
    for (const l of slice) first.parentNode.insertBefore(make(R[0].p, l), first);
    for (const u of R) unlink(u.p);
    return true;
  };
  const setText = (si, id, text) => { if (writeBox(findShape(si, id).box, text)) touch('content.xml'); };

  // ---- notes ----
  const notesBox = (pg) => {
    const nt = kid(pg, NS.pres, 'notes');
    const fr = kids(nt, NS.draw, 'frame').find((f) => f.getAttributeNS(NS.pres, 'class') === 'notes');
    return kid(fr, NS.draw, 'text-box');
  };
  const notes = (si) => { const b = notesBox(page(si)); return b ? textOf(b) : ''; };
  const setNotes = (si, text) => {
    const pg = page(si); let box = notesBox(pg); let created = false;
    if (!box) {
      created = true;
      if (text === '') return;
      const d = pg.ownerDocument; let nt = kid(pg, NS.pres, 'notes');
      if (!nt) { nt = d.createElementNS(NS.pres, 'presentation:notes'); pg.appendChild(nt); }
      if (!kids(nt, NS.draw, 'page-thumbnail').length) {
        const th = d.createElementNS(NS.draw, 'draw:page-thumbnail');
        th.setAttributeNS(NS.draw, 'draw:layer', 'layout'); th.setAttributeNS(NS.svg, 'svg:width', '14.848cm'); th.setAttributeNS(NS.svg, 'svg:height', '8.352cm');
        th.setAttributeNS(NS.svg, 'svg:x', '3.075cm'); th.setAttributeNS(NS.svg, 'svg:y', '2.257cm'); th.setAttributeNS(NS.pres, 'presentation:class', 'page');
        nt.appendChild(th);
      }
      const fr = d.createElementNS(NS.draw, 'draw:frame');
      fr.setAttributeNS(NS.draw, 'draw:layer', 'layout'); fr.setAttributeNS(NS.svg, 'svg:width', '16.799cm'); fr.setAttributeNS(NS.svg, 'svg:height', '11.865cm');
      fr.setAttributeNS(NS.svg, 'svg:x', '2.1cm'); fr.setAttributeNS(NS.svg, 'svg:y', '14.109cm'); fr.setAttributeNS(NS.pres, 'presentation:class', 'notes');
      box = d.createElementNS(NS.draw, 'draw:text-box'); fr.appendChild(box); nt.appendChild(fr);
    }
    if (writeBox(box, text) || created) touch('content.xml');
  };

  // ---- slides ----
  const masters = () => {
    const sr = part('styles.xml'); if (!sr) return [];
    return kids(kid(sr.documentElement, NS.office, 'master-styles'), NS.style, 'master-page').map((m) => ({ name: m.getAttributeNS(NS.style, 'name'), label: m.getAttributeNS(NS.style, 'display-name') || m.getAttributeNS(NS.style, 'name') }));
  };
  const layouts = () => masters().map((m) => m.label);
  const unique = () => { const used = new Set(pages().map((p) => p.getAttributeNS(NS.draw, 'name'))); let n = pages().length + 1; while (used.has(`page${n}`)) n++; return `page${n}`; };
  const stats = () => {
    const m = part('meta.xml'); if (!m) return;
    const st = [...m.getElementsByTagNameNS(NS.meta, 'document-statistic')][0];
    if (st && st.hasAttributeNS(NS.meta, 'page-count')) { st.setAttributeNS(NS.meta, 'meta:page-count', String(pages().length)); touch('meta.xml'); }
  };
  const place = (el, pos) => { const ps = pages(); const ref = ps[pos]; if (ref) pres.insertBefore(el, ref); else { const last = ps[ps.length - 1]; pres.insertBefore(el, last ? last.nextSibling : null); } };
  const emptied = (fr) => {
    const tb = kid(fr, NS.draw, 'text-box'); const ps = parasOf(tb); const tpl = ps[0];
    for (const c of [...tb.childNodes]) tb.removeChild(c);
    const np = tpl ? tpl.cloneNode(false) : fr.ownerDocument.createElementNS(NS.text, 'text:p'); dropIds(np); tb.appendChild(np);
  };
  const addSlide = (i, pos) => {
    const m = masters()[i]; if (!m) throw new EditError('That layout is not in the file.');
    const at = Math.max(0, Math.min(Number(pos) || 0, pages().length));
    const donor = pages().find((p) => p.getAttributeNS(NS.draw, 'master-page-name') === m.name);
    const np = content.createElementNS(NS.draw, 'draw:page');
    np.setAttributeNS(NS.draw, 'draw:name', unique()); np.setAttributeNS(NS.draw, 'draw:master-page-name', m.name);
    if (donor) {
      for (const [ns, ln] of [[NS.draw, 'style-name'], [NS.pres, 'presentation-page-layout-name']]) { const v = donor.getAttributeNS(ns, ln); if (v) np.setAttributeNS(ns, `${ns === NS.draw ? 'draw' : 'presentation'}:${ln}`, v); }
      for (const fr of kids(donor, NS.draw, 'frame')) {
        const cls = fr.getAttributeNS(NS.pres, 'class');
        if (!/^(title|subtitle|outline)$/.test(cls) || !kid(fr, NS.draw, 'text-box')) continue;
        const cp = fr.cloneNode(true); dropIds(cp); emptied(cp); np.appendChild(cp);
      }
    }
    place(np, at); touch('content.xml'); stats();
    return at;
  };
  const NO_COPY = ['object', 'object-ole', 'plugin', 'applet', 'floating-frame'];
  const duplicateSlide = (si) => {
    const pg = page(si);
    for (const e of pg.getElementsByTagName('*')) {
      if (e.namespaceURI === NS.draw && NO_COPY.includes(e.localName)) throw new EditError('This slide holds a chart or an embedded object, which cannot be copied here.');
      if (e.namespaceURI === NS.anim) throw new EditError('This slide has animations, which cannot be copied here.');
    }
    const cp = pg.cloneNode(true); dropIds(cp); cp.setAttributeNS(NS.draw, 'draw:name', unique());
    pres.insertBefore(cp, pg.nextSibling); touch('content.xml'); stats();
    return si + 1;
  };
  const moveSlide = (from, to) => {
    const pg = page(from); const n = pages().length; const t = Math.max(0, Math.min(Number(to), n - 1));
    if (t === from) return from;
    pg.remove(); place(pg, t); touch('content.xml');
    return t;
  };
  const deleteSlide = (si) => {
    const pg = page(si); const name = pg.getAttributeNS(NS.draw, 'name');
    if (pages().length < 2) throw new EditError('A presentation needs at least one slide.');
    for (const o of pages()) if (o !== pg) for (const e of [o, ...o.getElementsByTagName('*')]) for (const a of e.attributes) if (a.namespaceURI === NS.xlink && a.localName === 'href' && name && a.value === `#${name}`) throw new EditError('Another slide links to this slide, so it is not deleted here.');
    const refs = new Set(); for (const e of pg.getElementsByTagName('*')) { const h = e.getAttributeNS(NS.xlink, 'href'); if (h && /^Pictures\//.test(h)) refs.add(h); }
    for (const sh of content.getElementsByTagNameNS(NS.pres, 'show')) {
      const l = sh.getAttributeNS(NS.pres, 'pages'); if (l && name) sh.setAttributeNS(NS.pres, 'presentation:pages', l.split(',').filter((x) => x !== name).join(','));
    }
    pg.remove(); touch('content.xml');
    if (refs.size) {
      const text = new XMLSerializer().serializeToString(content) + (files['styles.xml'] ? dec(files['styles.xml']) : '');
      const man = part('META-INF/manifest.xml');
      for (const h of refs) {
        if (text.includes(h) || !files[h]) continue;
        delete files[h]; docs.delete(h); changed.delete(h);
        if (man) { for (const e of kids(man.documentElement, NS.manifest, 'file-entry')) if (e.getAttributeNS(NS.manifest, 'full-path') === h) e.remove(); touch('META-INF/manifest.xml'); }
      }
    }
    stats();
  };

  const snapshot = () => { const out = { ...files }; for (const p of changed) if (docs.has(p)) out[p] = ser(docs.get(p)); return out; };
  const toBytes = () => {
    const snap = snapshot(); const out = {};
    out.mimetype = [snap.mimetype, { level: 0 }];
    for (const k of Object.keys(snap)) if (k !== 'mimetype') out[k] = [snap[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { kind: 'odp', slides: () => pages().length, shapes, setText, notes, setNotes, layouts, addSlide, duplicateSlide, moveSlide, deleteSlide, snapshot, toBytes, dirty: () => changed.size > 0 };
}
