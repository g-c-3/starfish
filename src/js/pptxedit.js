// Slide edit engine, pptx (Decision 497, Phase 121 step 1). Works on the parts of the zip in place: a changed part is written, every other part
// is kept as it was. Text of a shape, notes, and slides (add, duplicate, move, delete). No view here; the editor view comes next.
// A slide that holds a chart, a drawing of a diagram, an embedded object or comments is not duplicated (those parts cannot be shared);
// slides are not reordered where the file has sections. Table cells: text of a cell (Decision 501). A text box (Decision 502) and a picture (Decision 503) can be added.
import { unzipSync, zipSync } from 'fflate';

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types'
};
const RT = (n) => `${NS.r}/${n}`;
const CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const CT_NOTES = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const NO_COPY = /\/(chart|oleObject|package|diagramData|diagramLayout|diagramQuickStyle|diagramColors|comments|tags)$|diagramDrawing$|\/comments$/;
const STORED = /\.(png|jpe?g|gif|webp|zip|mp[34]|mov|wmv|docx|xlsx|pptx)$/i;
const dec = (b) => new TextDecoder('utf-8').decode(b);
const enc = (s) => new TextEncoder().encode(s);
const parseX = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (n, ns, name) => (n ? [...n.children].filter((c) => c.namespaceURI === ns && (!name || c.localName === name)) : []);
const kid = (n, ns, name) => kids(n, ns, name)[0] || null;
const all = (n, ns, name) => [...n.getElementsByTagNameNS(ns, name)];
const dir = (p) => p.slice(0, p.lastIndexOf('/') + 1);
const relsPath = (p) => (p ? `${dir(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels` : '_rels/.rels');
const resolve = (base, target) => { if (target[0] === '/') return target.slice(1); const out = []; for (const x of (dir(base) + target).split('/')) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); } return out.join('/'); };
const relative = (base, path) => { const a = dir(base).split('/').filter(Boolean); const b = path.split('/'); while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); } return `${a.map(() => '..').join('/')}${a.length ? '/' : ''}${b.join('/')}`; };
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export class EditError extends Error { constructor(m) { super(m); this.office = true; } }

export function openPptx(bytes) {
  const files = unzipSync(bytes); for (const k of Object.keys(files)) if (k.endsWith('/')) delete files[k];
  if (!files['[Content_Types].xml'] || !files['_rels/.rels']) throw new EditError('This is not a valid file of this type.');
  const docs = new Map(); const changed = new Set();
  const part = (p) => {
    if (!docs.has(p)) { if (!files[p]) return null; const d = parseX(dec(files[p])); if (d.getElementsByTagName('parsererror').length) throw new EditError('This file could not be read for editing.'); docs.set(p, d); }
    return docs.get(p);
  };
  const touch = (p) => { changed.add(p); };
  const ser = (d) => enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/, ''));
  const bytesOf = (p) => (docs.has(p) && changed.has(p) ? ser(docs.get(p)) : files[p]);
  const relsOf = (p) => {
    const d = part(relsPath(p)); if (!d) return [];
    return kids(d.documentElement, NS.rel, 'Relationship').map((el) => { const ext = el.getAttribute('TargetMode') === 'External'; return { el, id: el.getAttribute('Id'), type: el.getAttribute('Type'), target: el.getAttribute('Target'), ext, path: ext ? null : resolve(p, el.getAttribute('Target')) }; });
  };
  const newRid = (p) => { let n = 0; for (const r of relsOf(p)) { const m = /^rId(\d+)$/.exec(r.id); if (m) n = Math.max(n, Number(m[1])); } return `rId${n + 1}`; };
  const addRel = (p, type, target) => {
    const rp = relsPath(p); let d = part(rp);
    if (!d) { d = parseX(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rel}"/>`); docs.set(rp, d); files[rp] = enc(''); }
    const id = newRid(p); const e = d.createElementNS(NS.rel, 'Relationship'); e.setAttribute('Id', id); e.setAttribute('Type', type); e.setAttribute('Target', target); d.documentElement.appendChild(e); touch(rp); return id;
  };
  const ctDoc = () => part('[Content_Types].xml');
  const addOverride = (p, type) => { const d = ctDoc(); const e = d.createElementNS(NS.ct, 'Override'); e.setAttribute('PartName', `/${p}`); e.setAttribute('ContentType', type); d.documentElement.appendChild(e); touch('[Content_Types].xml'); };
  const dropOverride = (p) => { for (const e of kids(ctDoc().documentElement, NS.ct, 'Override')) if (e.getAttribute('PartName') === `/${p}`) { e.remove(); touch('[Content_Types].xml'); } };
  const reach = (starts) => { const seen = new Set(); const q = [...starts]; while (q.length) { const p = q.pop(); if (seen.has(p) || !files[p]) continue; seen.add(p); for (const r of relsOf(p)) if (!r.ext && r.path) q.push(r.path); } return seen; };
  const drop = (p) => { delete files[p]; docs.delete(p); changed.delete(p); const rp = relsPath(p); delete files[rp]; docs.delete(rp); changed.delete(rp); dropOverride(p); };

  const main = (relsOf('').find((r) => r.type === RT('officeDocument')) || {}).path || 'ppt/presentation.xml';
  const pres = part(main); if (!pres) throw new EditError('This is not a valid file of this type.');
  const sldLst = () => kid(pres.documentElement, NS.p, 'sldIdLst');
  const sections = () => all(pres, '*', 'sectionLst');
  const list = () => { // the slides in order
    const rel = Object.fromEntries(relsOf(main).map((r) => [r.id, r]));
    return kids(sldLst(), NS.p, 'sldId').map((el) => { const r = rel[el.getAttributeNS(NS.r, 'id')]; return { el, id: el.getAttribute('id'), rid: el.getAttributeNS(NS.r, 'id'), path: r && !r.ext ? r.path : null }; }).filter((s) => s.path && files[s.path]);
  };
  if (!list().length) throw new EditError('This presentation has no slides to edit.');
  const slide = (si) => { const s = list()[si]; if (!s) throw new EditError('That slide is not there any more.'); return s; };

  // ---- text ----
  const shapesOf = (root) => { // text shapes in order, groups opened
    const out = []; const walk = (n) => { for (const c of n.children) { if (c.namespaceURI !== NS.p) continue; if (c.localName === 'sp' && kid(c, NS.p, 'txBody')) out.push(c); else if (c.localName === 'grpSp') walk(c); } }; walk(kid(kid(root.documentElement, NS.p, 'cSld'), NS.p, 'spTree')); return out;
  };
  const cNv = (sp) => kid(kid(sp, NS.p, 'nvSpPr'), NS.p, 'cNvPr');
  const phOf = (sp) => kid(kid(kid(sp, NS.p, 'nvSpPr'), NS.p, 'nvPr'), NS.p, 'ph');
  const paraText = (p) => kids(p, NS.a).map((c) => (c.localName === 'br' ? '\n' : c.localName === 'r' || c.localName === 'fld' ? (kid(c, NS.a, 't') ? kid(c, NS.a, 't').textContent : '') : '')).join('');
  const textOf = (sp) => kids(kid(sp, NS.p, 'txBody'), NS.a, 'p').map(paraText).join('\n');
  const info = (sp) => { const ph = phOf(sp); const c = cNv(sp); return { id: c ? c.getAttribute('id') : '', name: c ? c.getAttribute('name') || '' : '', text: textOf(sp), ph: ph ? ph.getAttribute('type') || 'body' : null }; };
  const shapes = (si) => shapesOf(part(slide(si).path)).map(info);
  const find = (si, id) => { const root = part(slide(si).path); const sp = shapesOf(root).find((x) => (cNv(x) ? cNv(x).getAttribute('id') : '') === String(id)); if (!sp) throw new EditError('That shape is not on the slide.'); return { sp, root }; };
  const mkP = (doc, tpl, line) => { // a paragraph with the formatting of a template paragraph
    const p = doc.createElementNS(NS.a, 'a:p'); const pPr = tpl && kid(tpl, NS.a, 'pPr'); if (pPr) p.appendChild(pPr.cloneNode(true));
    const r0 = tpl && kid(tpl, NS.a, 'r'); const rp = r0 && kid(r0, NS.a, 'rPr'); const ep = tpl && kid(tpl, NS.a, 'endParaRPr');
    const mkRPr = () => { const src = rp || ep; const x = doc.createElementNS(NS.a, 'a:rPr'); if (src) { for (const a of src.attributes) x.setAttribute(a.name, a.value); for (const c of src.children) x.appendChild(c.cloneNode(true)); } return x; };
    if (line === '') { if (ep || rp) { const e = doc.createElementNS(NS.a, 'a:endParaRPr'); const s = ep || rp; for (const a of s.attributes) e.setAttribute(a.name, a.value); for (const c of s.children) e.appendChild(c.cloneNode(true)); p.appendChild(e); } else p.appendChild(doc.createElementNS(NS.a, 'a:endParaRPr')); return p; }
    const r = doc.createElementNS(NS.a, 'a:r'); r.appendChild(mkRPr()); const t = doc.createElementNS(NS.a, 'a:t'); t.textContent = line; r.appendChild(t); p.appendChild(r); return p;
  };
  const writeBody = (body, doc, input) => { // returns true when the body changed
    const lines = clean(input === null || input === undefined ? '' : input).replace(/\r\n?/g, '\n').split('\n');
    const old = kids(body, NS.a, 'p').map((el) => ({ el, lines: paraText(el).split('\n') })); const flat = []; old.forEach((o, pi) => o.lines.forEach((l) => flat.push({ pi, l })));
    let pre = 0; while (pre < flat.length && pre < lines.length && flat[pre].l === lines[pre]) pre++;
    let suf = 0; while (suf < flat.length - pre && suf < lines.length - pre && flat[flat.length - 1 - suf].l === lines[lines.length - 1 - suf]) suf++;
    if (pre === flat.length && lines.length === flat.length) return false; // nothing changed
    const keepHead = new Set(); const keepTail = new Set();
    old.forEach((o, pi) => { const idx = flat.map((f, k) => (f.pi === pi ? k : -1)).filter((k) => k >= 0); if (idx.every((k) => k < pre)) keepHead.add(pi); else if (idx.every((k) => k >= flat.length - suf)) keepTail.add(pi); });
    const mid = lines.slice(pre, lines.length - suf); const dropped = old.filter((o, pi) => !keepHead.has(pi) && !keepTail.has(pi));
    const prev = [...keepHead].pop(); const next = [...keepTail][0];
    const tpl = (dropped[0] && dropped[0].el) || (prev !== undefined && old[prev].el) || (next !== undefined && old[next].el) || old[0] && old[0].el || null;
    const out = [...[...keepHead].map((pi) => old[pi].el), ...mid.map((l) => mkP(doc, tpl, l)), ...[...keepTail].map((pi) => old[pi].el)];
    for (const o of old) o.el.remove();
    if (!out.length) out.push(mkP(doc, tpl, ''));
    for (const e of out) body.appendChild(e);
    return true;
  };
  const setText = (si, id, input) => {
    const { sp, root } = find(si, id);
    if (writeBody(kid(sp, NS.p, 'txBody'), root, input)) touch(slide(si).path);
  };

  // ---- table cells (Decision 501): a table is a graphic frame with an a:tbl; a cell is found by its row and column ----
  const framesOf = (root) => { // table frames in order, groups opened
    const out = []; const walk = (n) => { for (const c of n.children) { if (c.namespaceURI !== NS.p) continue; if (c.localName === 'graphicFrame' && all(c, NS.a, 'tbl').length) out.push(c); else if (c.localName === 'grpSp') walk(c); } }; walk(kid(kid(root.documentElement, NS.p, 'cSld'), NS.p, 'spTree')); return out;
  };
  const frameId = (f) => { const c = kid(kid(f, NS.p, 'nvGraphicFramePr'), NS.p, 'cNvPr'); return c ? c.getAttribute('id') : ''; };
  const rowsOf = (f) => kids(all(f, NS.a, 'tbl')[0], NS.a, 'tr');
  const cellText = (tc) => { const b = kid(tc, NS.a, 'txBody'); return b ? kids(b, NS.a, 'p').map(paraText).join('\n') : ''; };
  const isCovered = (tc) => tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1';
  const tables = (si) => framesOf(part(slide(si).path)).map((f) => {
    const c = kid(kid(f, NS.p, 'nvGraphicFramePr'), NS.p, 'cNvPr');
    return { id: frameId(f), name: c ? c.getAttribute('name') || '' : '', rows: rowsOf(f).map((tr) => kids(tr, NS.a, 'tc').map((tc) => ({ text: cellText(tc), covered: isCovered(tc) }))) };
  });
  const setCell = (si, id, row, col, input) => {
    const root = part(slide(si).path); const f = framesOf(root).find((x) => frameId(x) === String(id)); if (!f) throw new EditError('That table is not on the slide.');
    const tr = rowsOf(f)[row]; const tc = tr && kids(tr, NS.a, 'tc')[col]; if (!tc) throw new EditError('That cell is not in the table.');
    if (isCovered(tc)) throw new EditError('This cell is covered by a merged cell; change the merged cell instead.');
    let body = kid(tc, NS.a, 'txBody');
    if (!body) {
      if (clean(input === null || input === undefined ? '' : input) === '') return;
      body = root.createElementNS(NS.a, 'a:txBody'); body.appendChild(root.createElementNS(NS.a, 'a:bodyPr')); body.appendChild(root.createElementNS(NS.a, 'a:lstStyle')); body.appendChild(root.createElementNS(NS.a, 'a:p'));
      const pr = kid(tc, NS.a, 'tcPr'); tc.insertBefore(body, pr || null);
    }
    if (writeBody(body, root, input)) touch(slide(si).path);
  };

  // ---- position and size (Decision 500): px at 96 per inch; a placeholder without its own frame takes the one of its layout, then its master ----
  const xfrmOf = (sp) => kid(kid(sp, NS.p, 'spPr'), NS.a, 'xfrm');
  const readX = (x) => { const o = kid(x, NS.a, 'off'); const e = kid(x, NS.a, 'ext'); if (!o || !e) return null; const v = [o.getAttribute('x'), o.getAttribute('y'), e.getAttribute('cx'), e.getAttribute('cy')].map(Number); return v.every(Number.isFinite) ? { x: v[0] / 9525, y: v[1] / 9525, w: v[2] / 9525, h: v[3] / 9525 } : null; };
  const inherited = (path, sp) => {
    const ph = phOf(sp); if (!ph) return null; const idx = ph.getAttribute('idx'); const ty = ph.getAttribute('type');
    const chain = []; const lay = relsOf(path).find((r) => r.type === RT('slideLayout')); if (lay && lay.path) { chain.push(lay.path); const ms = relsOf(lay.path).find((r) => r.type === RT('slideMaster')); if (ms && ms.path) chain.push(ms.path); }
    for (const p of chain) {
      const d = part(p); if (!d) continue;
      for (const o of all(d, NS.p, 'sp')) { const q = phOf(o); if (!q) continue; if ((idx && q.getAttribute('idx') === idx) || (!idx && (q.getAttribute('type') || 'body') === (ty || 'body'))) { const b = xfrmOf(o) && readX(xfrmOf(o)); if (b) return b; } }
    }
    return null;
  };
  const box = (si, id) => { const { sp } = find(si, id); const x = xfrmOf(sp); return (x && readX(x)) || inherited(slide(si).path, sp); };
  const setBox = (si, id, b) => {
    const { sp } = find(si, id); const v = [b.x, b.y, b.w, b.h].map((n) => Math.round(Number(n) * 9525));
    if (!v.every(Number.isFinite) || v[2] <= 0 || v[3] <= 0) throw new EditError('Width and height must be more than zero.');
    if (sp.parentNode && sp.parentNode.localName === 'grpSp') throw new EditError('This shape is in a group; its place cannot be changed here.');
    const cur = box(si, id); if (cur && [cur.x, cur.y, cur.w, cur.h].map((n) => Math.round(n * 9525)).every((n, i) => n === v[i]) && xfrmOf(sp)) return;
    const doc = sp.ownerDocument; let pr = kid(sp, NS.p, 'spPr');
    if (!pr) { pr = doc.createElementNS(NS.p, 'p:spPr'); sp.insertBefore(pr, kid(sp, NS.p, 'nvSpPr').nextSibling); }
    let x = kid(pr, NS.a, 'xfrm'); if (!x) { x = doc.createElementNS(NS.a, 'a:xfrm'); pr.insertBefore(x, pr.firstChild); }
    let o = kid(x, NS.a, 'off'); if (!o) { o = doc.createElementNS(NS.a, 'a:off'); x.insertBefore(o, x.firstChild); }
    let e = kid(x, NS.a, 'ext'); if (!e) { e = doc.createElementNS(NS.a, 'a:ext'); x.insertBefore(e, o.nextSibling); }
    o.setAttribute('x', String(v[0])); o.setAttribute('y', String(v[1])); e.setAttribute('cx', String(v[2])); e.setAttribute('cy', String(v[3]));
    touch(slide(si).path);
  };

  // ---- add a text box (Decision 502): a text shape with no fill and no line, centred, 60% of the slide wide ----
  const addTextBox = (si, input) => {
    const text = clean(input === null || input === undefined ? '' : input); if (text.trim() === '') throw new EditError('Type some text for the text box.');
    const sl = slide(si); const root = part(sl.path); const tree = kid(kid(root.documentElement, NS.p, 'cSld'), NS.p, 'spTree'); if (!tree) throw new EditError('This slide cannot take a text box.');
    const sz = kid(pres.documentElement, NS.p, 'sldSz'); const W = Number(sz && sz.getAttribute('cx')) || 9144000; const H = Number(sz && sz.getAttribute('cy')) || 6858000;
    let nid = 1; for (const c of all(root, NS.p, 'cNvPr')) nid = Math.max(nid, Number(c.getAttribute('id')) || 0); nid += 1;
    const w = Math.round(W * 0.6); const h = 584200; const x = Math.round((W - w) / 2); const y = Math.round((H - h) / 2);
    const frag = parseX(`<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:nvSpPr><p:cNvPr id="${nid}" name="TextBox ${nid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`).documentElement;
    const sp = root.importNode(frag, true); const ext = kid(tree, NS.p, 'extLst'); tree.insertBefore(sp, ext);
    writeBody(kid(sp, NS.p, 'txBody'), root, text); touch(sl.path); return String(nid);
  };

  // ---- add a picture (Decision 503): img = { bytes, ext, mime, w, h } (the view reads it from the phone); fitted into 60% of the slide, centred ----
  const fit = (W, H, w, h) => { const bw = W * 0.6; const bh = H * 0.6; const r = w / h; const cw = bw / r <= bh ? bw : bh * r; const ch = bw / r <= bh ? bw / r : bh; return { w: Math.round(cw), h: Math.round(ch), x: Math.round((W - cw) / 2), y: Math.round((H - ch) / 2) }; };
  const addPicture = (si, img) => {
    if (!img || !img.bytes || !img.bytes.length || !/^(png|jpe?g|gif)$/i.test(img.ext || '') || !(img.w > 0 && img.h > 0)) throw new EditError('That picture cannot be added.');
    const sl = slide(si); const root = part(sl.path); const tree = kid(kid(root.documentElement, NS.p, 'cSld'), NS.p, 'spTree'); if (!tree) throw new EditError('This slide cannot take a picture.');
    const ext = img.ext.toLowerCase(); const sz = kid(pres.documentElement, NS.p, 'sldSz'); const W = Number(sz && sz.getAttribute('cx')) || 9144000; const H = Number(sz && sz.getAttribute('cy')) || 6858000;
    const mp = `ppt/media/image${nextNum(/^ppt\/media\/image(\d+)\.[a-z0-9]+$/i)}.${ext}`; files[mp] = img.bytes;
    const ct = ctDoc(); if (!kids(ct.documentElement, NS.ct, 'Default').some((e) => (e.getAttribute('Extension') || '').toLowerCase() === ext)) { const e = ct.createElementNS(NS.ct, 'Default'); e.setAttribute('Extension', ext); e.setAttribute('ContentType', img.mime || (ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg')); ct.documentElement.insertBefore(e, ct.documentElement.firstChild); touch('[Content_Types].xml'); }
    const rid = addRel(sl.path, RT('image'), relative(sl.path, mp));
    let nid = 1; for (const c of all(root, NS.p, 'cNvPr')) nid = Math.max(nid, Number(c.getAttribute('id')) || 0); nid += 1;
    const b = fit(W, H, img.w, img.h);
    const frag = parseX(`<p:pic xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><p:nvPicPr><p:cNvPr id="${nid}" name="Picture ${nid}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.w}" cy="${b.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`).documentElement;
    tree.insertBefore(root.importNode(frag, true), kid(tree, NS.p, 'extLst')); touch(sl.path); return String(nid);
  };

  const titleOf = (path) => { const sp = shapesOf(part(path)).find((x) => /^(title|ctrTitle)$/.test((phOf(x) && phOf(x).getAttribute('type')) || '')); return sp ? textOf(sp).replace(/\n/g, ' ') : ''; };
  const slides = () => list().map((s, i) => ({ index: i, id: s.id, part: s.path, title: titleOf(s.path) }));

  // ---- notes ----
  const notesPath = (s) => { const r = relsOf(s.path).find((x) => x.type === RT('notesSlide') && !x.ext); return r && files[r.path] ? r.path : null; };
  const notesBody = (root) => shapesOf(root).find((x) => (phOf(x) && phOf(x).getAttribute('type')) === 'body');
  const notes = (si) => { const np = notesPath(slide(si)); if (!np) return ''; const sp = notesBody(part(np)); return sp ? textOf(sp) : ''; };
  const nextNum = (re) => { let n = 0; for (const k of Object.keys(files)) { const m = re.exec(k); if (m) n = Math.max(n, Number(m[1])); } return n + 1; };
  const setNotes = (si, input) => {
    const s = slide(si); let np = notesPath(s); const text = clean(input === null || input === undefined ? '' : input).replace(/\r\n?/g, '\n');
    if (!np) {
      if (text === '') return;
      const nm = relsOf(main).find((r) => r.type === RT('notesMaster') && !r.ext); if (!nm || !files[nm.path]) throw new EditError('This presentation has no notes pages to write notes on.');
      np = `ppt/notesSlides/notesSlide${nextNum(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)}.xml`;
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
      files[np] = enc(xml); docs.set(np, parseX(xml)); touch(np);
      addOverride(np, CT_NOTES);
      addRel(np, RT('notesMaster'), relative(np, nm.path)); addRel(np, RT('slide'), relative(np, s.path));
      addRel(s.path, RT('notesSlide'), relative(s.path, np));
    }
    const root = part(np); const sp = notesBody(root); if (!sp) throw new EditError('The notes page of this slide has no place for notes.');
    const id = cNv(sp).getAttribute('id'); const body = kid(sp, NS.p, 'txBody');
    const cur = textOf(sp); if (cur === text) return;
    const lines = text.split('\n'); const tpl = kids(body, NS.a, 'p')[0] || null;
    for (const p of kids(body, NS.a, 'p')) p.remove();
    for (const l of lines) body.appendChild(mkP(root, tpl, l));
    void id; touch(np);
  };

  // ---- slides ----
  const sectionIds = (id) => sections().flatMap((s) => all(s, '*', 'sldId').filter((e) => e.getAttribute('id') === String(id)));
  const deleteSlide = (si) => {
    const all_ = list(); if (all_.length < 2) throw new EditError('A presentation needs at least one slide.');
    const s = slide(si);
    for (const o of all_) if (o !== s && relsOf(o.path).some((r) => r.path === s.path)) throw new EditError('Another slide links to this slide, so it cannot be deleted here.');
    const before = reach([s.path]);
    s.el.remove(); touch(main);
    const pr = relsOf(main).find((r) => r.id === s.rid); if (pr) { pr.el.remove(); touch(relsPath(main)); }
    for (const e of sectionIds(s.id)) e.remove();
    const live = reach(relsOf('').filter((r) => !r.ext).map((r) => r.path));
    for (const p of before) if (!live.has(p)) drop(p);
  };
  const duplicateSlide = (si) => {
    const s = slide(si); const rels = relsOf(s.path);
    const bad = rels.find((r) => NO_COPY.test(r.type)); if (bad) throw new EditError('This slide holds a chart, an embedded object or comments, which cannot be copied here.');
    const n = nextNum(/^ppt\/slides\/slide(\d+)\.xml$/); const np = `ppt/slides/slide${n}.xml`;
    files[np] = bytesOf(s.path);
    const sr = part(relsPath(s.path)); if (sr) { files[relsPath(np)] = ser(sr); }
    addOverride(np, CT_SLIDE);
    const nrels = relsOf(np); // the copy's own relationship list, read from the copied part
    const old = nrels.find((r) => r.type === RT('notesSlide') && !r.ext);
    if (old && files[old.path]) {
      const nn = `ppt/notesSlides/notesSlide${nextNum(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)}.xml`;
      files[nn] = bytesOf(old.path); const nr = part(relsPath(old.path)); if (nr) files[relsPath(nn)] = ser(nr);
      addOverride(nn, CT_NOTES);
      for (const r of relsOf(nn)) if (r.type === RT('slide')) { r.el.setAttribute('Target', relative(nn, np)); touch(relsPath(nn)); }
      old.el.setAttribute('Target', relative(np, nn)); touch(relsPath(np));
    }
    let id = 255; for (const e of all(pres, '*', 'sldId')) id = Math.max(id, Number(e.getAttribute('id')) || 0); id += 1;
    const rid = addRel(main, RT('slide'), relative(main, np));
    const el = pres.createElementNS(NS.p, 'p:sldId'); el.setAttribute('id', String(id)); el.setAttributeNS(NS.r, 'r:id', rid); s.el.parentNode.insertBefore(el, s.el.nextSibling);
    for (const e of sectionIds(s.id)) { const c = e.cloneNode(true); c.setAttribute('id', String(id)); e.parentNode.insertBefore(c, e.nextSibling); }
    touch(main); return si + 1;
  };
  const moveSlide = (si, to) => {
    const ls = list(); const s = slide(si);
    if (!(Number.isInteger(to) && to >= 0 && to < ls.length)) throw new EditError('That place is not in the presentation.');
    if (to === si) return si;
    if (sections().length) throw new EditError('This presentation has sections, and slides in sections cannot be reordered here yet.');
    const lst = sldLst(); s.el.remove(); const rest = kids(lst, NS.p, 'sldId');
    lst.insertBefore(s.el, rest[to] || null); touch(main); return to;
  };
  const layouts = () => {
    const out = []; for (const m of relsOf(main).filter((r) => r.type === RT('slideMaster') && !r.ext)) for (const l of relsOf(m.path).filter((r) => r.type === RT('slideLayout') && !r.ext)) {
      const d = part(l.path); const c = d && kid(d.documentElement, NS.p, 'cSld'); out.push({ path: l.path, name: (c && c.getAttribute('name')) || l.path.split('/').pop() });
    }
    return out;
  };
  const addSlide = (layoutIndex, at) => {
    const ls = layouts(); const lay = ls[layoutIndex]; if (!lay) throw new EditError('That layout is not in the presentation.');
    const cur = list(); const pos = at === undefined ? cur.length : at; if (!(Number.isInteger(pos) && pos >= 0 && pos <= cur.length)) throw new EditError('That place is not in the presentation.');
    if (sections().length) throw new EditError('This presentation has sections, and a slide cannot be added here yet.');
    const ld = part(lay.path); let nid = 1; const phs = [];
    for (const sp of shapesOf(ld)) { const ph = phOf(sp); const t = ph && (ph.getAttribute('type') || 'body'); if (ph && !/^(dt|ftr|sldNum)$/.test(t)) phs.push({ ph, name: cNv(sp).getAttribute('name') }); }
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const d = parseX(xml); const tree = kid(kid(d.documentElement, NS.p, 'cSld'), NS.p, 'spTree');
    for (const x of phs) {
      nid++; const sp = d.createElementNS(NS.p, 'p:sp'); const nv = d.createElementNS(NS.p, 'p:nvSpPr'); const c = d.createElementNS(NS.p, 'p:cNvPr'); c.setAttribute('id', String(nid)); c.setAttribute('name', x.name || `Placeholder ${nid}`); nv.appendChild(c);
      const cs = d.createElementNS(NS.p, 'p:cNvSpPr'); const lk = d.createElementNS(NS.a, 'a:spLocks'); lk.setAttribute('noGrp', '1'); cs.appendChild(lk); nv.appendChild(cs);
      const np = d.createElementNS(NS.p, 'p:nvPr'); np.appendChild(x.ph.cloneNode(true)); nv.appendChild(np); sp.appendChild(nv); sp.appendChild(d.createElementNS(NS.p, 'p:spPr'));
      const tb = d.createElementNS(NS.p, 'p:txBody'); tb.appendChild(d.createElementNS(NS.a, 'a:bodyPr')); tb.appendChild(d.createElementNS(NS.a, 'a:lstStyle')); const p = d.createElementNS(NS.a, 'a:p'); const e = d.createElementNS(NS.a, 'a:endParaRPr'); e.setAttribute('lang', 'en-US'); p.appendChild(e); tb.appendChild(p); sp.appendChild(tb); tree.appendChild(sp);
    }
    const n = nextNum(/^ppt\/slides\/slide(\d+)\.xml$/); const sp_ = `ppt/slides/slide${n}.xml`;
    files[sp_] = enc(''); docs.set(sp_, d); touch(sp_);
    addOverride(sp_, CT_SLIDE); addRel(sp_, RT('slideLayout'), relative(sp_, lay.path));
    let id = 255; for (const e of all(pres, '*', 'sldId')) id = Math.max(id, Number(e.getAttribute('id')) || 0); id += 1;
    const rid = addRel(main, RT('slide'), relative(main, sp_));
    const el = pres.createElementNS(NS.p, 'p:sldId'); el.setAttribute('id', String(id)); el.setAttributeNS(NS.r, 'r:id', rid);
    const lst = sldLst(); lst.insertBefore(el, kids(lst, NS.p, 'sldId')[pos] || null); touch(main);
    return pos;
  };

  const snapshot = () => { const out = { ...files }; for (const p of changed) if (docs.has(p)) out[p] = ser(docs.get(p)); return out; };
  const toBytes = () => {
    const snap = snapshot(); const out = {}; const first = '[Content_Types].xml';
    out[first] = [snap[first], { level: 6 }];
    for (const k of Object.keys(snap)) if (k !== first) out[k] = [snap[k], { level: STORED.test(k) ? 0 : 6 }];
    return zipSync(out);
  };
  return { kind: 'pptx', slides, shapes, setText, addTextBox, addPicture, tables, setCell, box, setBox, notes, setNotes, layouts: () => layouts().map((l) => l.name), addSlide, duplicateSlide, moveSlide, deleteSlide, snapshot, toBytes, dirty: () => changed.size > 0 };
}
