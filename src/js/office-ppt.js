// office-ppt.js — view-only reader for ppt, the PowerPoint 97 to 2003 format (Decisions 451, 456, 515). Follows the newest edit
// of the "PowerPoint Document" stream to the slide list and the slide objects, and returns each slide's shapes (position, fill, line,
// text) and notes as the same model as readPptx. Text sizes are fitted to the box; no text styles, pictures or master shapes yet: the
// model carries a notice that says so.
// Password-protected files are refused.

import { OfficeError } from './office-read.js';
import { readOle2, isOle2 } from './ole2.js';

const SLIDE_MAX = 500;
const PX_PT = 4 / 3;
const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];

const T_DOC = 0x03e8; const T_DOCATOM = 0x03e9; const T_SLIDE = 0x03ee; const T_SLWT = 0x0ff0; const T_PERSIST = 0x03f3;
const T_USEREDIT = 0x0ff5; const T_PDIR = 0x1772; const T_HEADER = 0x0f9f; const T_CHARS = 0x0fa0; const T_BYTES = 0x0fa8; const T_REF = 0x0f9e;
const T_CLIENTTEXT = 0xf00d; const T_CLIENTDATA = 0xf011;
const T_PPDRAW = 0x040c; const T_SCHEME = 0x07f0; const T_SPGR = 0xf003; const T_SP = 0xf004; const T_SPREC = 0xf00a; const T_OPT = 0xf00b; const T_GRPREC = 0xf009;
const T_CANCHOR = 0xf010; const T_CHANCHOR = 0xf00f;
const GEOM = { 1: 'rect', 2: 'roundRect', 3: 'ellipse', 4: 'diamond', 5: 'triangle', 6: 'rtTriangle', 7: 'parallelogram', 8: 'trapezoid', 9: 'hexagon', 10: 'octagon', 20: 'line', 32: 'line', 33: 'line', 202: 'rect' };

export function isPpt(bytes) { return isOle2(bytes); }

export function readPpt(bytes) {
  const ole = readOle2(bytes);
  const ps = ole.stream('PowerPoint Document');
  if (!ps || ps.length < 8) throw new OfficeError('This is not a valid file of this type.');
  const dv = new DataView(ps.buffer, ps.byteOffset, ps.byteLength);
  const u32 = (o) => dv.getUint32(o, true);

  function* recs(from, to) {
    let o = from;
    while (o + 8 <= to) {
      const vi = dv.getUint16(o, true); const type = dv.getUint16(o + 2, true); const len = dv.getUint32(o + 4, true);
      const e = o + 8 + len;
      if (e > to) return;
      yield { ver: vi & 15, type, o: o + 8, len, e, at: o };
      o = e;
    }
  }
  const decode = (r) => {
    let s = '';
    if (r.type === T_CHARS) { for (let i = 0; i + 1 < r.len; i += 2) s += String.fromCharCode(ps[r.o + i] | (ps[r.o + i + 1] << 8)); }
    else for (let i = 0; i < r.len; i++) { const c = ps[r.o + i]; s += String.fromCharCode(c >= 0x80 && c < 0xa0 ? CP1252[c - 0x80] : c); }
    return s;
  };

  // ---- the newest edit: user edit atoms chained back to the first save, then the persist directories ----
  const cu = ole.stream('Current User');
  if (cu && cu.length >= 20) {
    const tok = new DataView(cu.buffer, cu.byteOffset, cu.byteLength).getUint32(12, true);
    if (tok === 0xf3d1c4df) throw new OfficeError('This file is password protected. Use Open with app.');
  }
  const persist = new Map();
  let docOff = -1;
  try {
    if (!cu || cu.length < 20) throw new Error('no current user');
    const edits = []; let off = new DataView(cu.buffer, cu.byteOffset, cu.byteLength).getUint32(16, true);
    for (let guard = 0; off && guard < 1000 && off + 36 <= ps.length; guard++) {
      if (dv.getUint16(off + 2, true) !== T_USEREDIT) throw new Error('edit');
      if (u32(off + 4) >= 0x20) throw new OfficeError('This file is password protected. Use Open with app.');
      edits.push({ last: u32(off + 16), dir: u32(off + 20), doc: u32(off + 24) });
      off = u32(off + 16);
    }
    if (!edits.length) throw new Error('no edits');
    for (let i = edits.length - 1; i >= 0; i--) {
      const d = edits[i].dir;
      if (d + 8 > ps.length || dv.getUint16(d + 2, true) !== T_PDIR) throw new Error('directory');
      let p = d + 8; const e = p + u32(d + 4);
      while (p + 4 <= e) {
        const v = u32(p); p += 4;
        const id = v & 0xfffff; const cnt = v >>> 20;
        for (let k = 0; k < cnt && p + 4 <= e; k++, p += 4) persist.set(id + k, u32(p));
      }
    }
    docOff = persist.get(edits[0].doc);
    if (docOff === undefined || dv.getUint16(docOff + 2, true) !== T_DOC) throw new Error('document');
  } catch (e) {
    if (e instanceof OfficeError) throw e;
    // fallback: the last document container among the top-level records
    persist.clear(); docOff = -1;
    for (const r of recs(0, ps.length)) if (r.type === T_DOC) docOff = r.at;
    if (docOff < 0) throw new OfficeError('This file is protected or damaged.');
  }

  // ---- the document container: slide size, slide list, notes list ----
  const doc = { o: docOff + 8, e: docOff + 8 + u32(docOff + 4) };
  if (doc.e > ps.length) throw new OfficeError('This file is protected or damaged.');
  let W = 960; let H = 720;
  const lists = { 0: [], 1: [], 2: [] };
  for (const r of recs(doc.o, doc.e)) {
    if (r.type === T_DOCATOM && r.len >= 8) { W = Math.round(u32(r.o) / 6) || 960; H = Math.round(u32(r.o + 4) / 6) || 720; }
    else if (r.type === T_SLWT) {
      const inst = dv.getUint16(r.at, true) >> 4;
      if (inst !== 0 && inst !== 1 && inst !== 2) continue;
      let cur = null; let type = 4;
      for (const c of recs(r.o, r.e)) {
        if (c.type === T_PERSIST && c.len >= 16) { cur = { ref: u32(c.o), slideId: u32(c.o + 12), texts: [] }; lists[inst].push(cur); type = 4; }
        else if (c.type === T_HEADER && c.len >= 4) type = u32(c.o);
        else if ((c.type === T_CHARS || c.type === T_BYTES) && cur) cur.texts.push({ type, text: decode(c) });
      }
    }
  }
  const slides = lists[0].slice(0, SLIDE_MAX);
  if (!slides.length) throw new OfficeError('This presentation has no slides to show.');
  const notesOf = new Map(lists[2].map((n) => [n.slideId, n.texts.map((t) => t.text.replace(/[\r\v]/g, '\n')).join('\n').trim()]));

  // the texts of one slide in page order: placeholders are references into the slide list, text boxes carry their own text
  function slideTexts(s) {
    const so = persist.get(s.ref);
    if (so === undefined || so + 8 > ps.length || dv.getUint16(so + 2, true) !== T_SLIDE) return s.texts;
    const out = []; const used = new Set();
    const visit = (from, to, depth) => {
      let type = 4;
      for (const r of recs(from, to)) {
        if ((r.ver === 15 || r.type === T_CLIENTTEXT || r.type === T_CLIENTDATA) && depth < 24) visit(r.o, r.e, depth + 1);
        else if (r.type === T_REF && r.len >= 4) { const i = u32(r.o); if (s.texts[i] && !used.has(i)) { out.push(s.texts[i]); used.add(i); } }
        else if (r.type === T_HEADER && r.len >= 4) type = u32(r.o);
        else if (r.type === T_CHARS || r.type === T_BYTES) out.push({ type, text: decode(r) });
      }
    };
    try { visit(so + 8, so + 8 + u32(so + 4), 0); } catch { return s.texts; }
    s.texts.forEach((t, i) => { if (!used.has(i)) out.push(t); });
    return out;
  }


  // ---- shapes: the slide's drawing (Escher records): per shape its box, fill, line and text; boxes are in 1/576 inch, six units to a pixel ----
  const schemeOf = (so) => { // the eight scheme colours of a slide or master container
    if (so === undefined || so + 8 > ps.length) return null;
    for (const r of recs(so + 8, so + 8 + u32(so + 4))) if (r.type === T_SCHEME && r.len >= 32) { const c = []; for (let k = 0; k < 8; k++) c.push([0, 1, 2].map((j) => ps[r.o + k * 4 + j].toString(16).padStart(2, '0')).join('').toUpperCase()); return c; }
    return null;
  };
  const masterRef = new Map(lists[1].map((m) => [m.slideId, m.ref]));
  const colorOf = (v, scheme) => { // an Escher colour: RGB, or an index into the scheme
    const fl = (v >>> 24) & 0xff;
    if (fl & 0x08) { const c = scheme && scheme[v & 7]; return c || '000000'; }
    if (fl & 0x10) return (v & 0xff) === 0xf0 ? 'FFFFFF' : '000000';
    return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const fitPt = (lines, w, h, maxPt) => { // the largest size from maxPt down to 10 at which the lines fit the box
    for (let pt = maxPt; pt > 10; pt -= 2) {
      const px = pt * PX_PT; let n = 0;
      for (const l of lines) n += Math.max(1, Math.ceil((l.length * px * 0.5) / Math.max(20, w - 20)));
      if (n * px * 1.2 <= h - 8) return pt;
    }
    return 10;
  };
  function shapeItems(s) {
    const so = persist.get(s.ref);
    if (so === undefined || so + 8 > ps.length || dv.getUint16(so + 2, true) !== T_SLIDE) return null;
    const soE = so + 8 + u32(so + 4);
    let drawing = null; let masterId = 0;
    for (const r of recs(so + 8, soE)) { if (r.type === T_PPDRAW) drawing = r; else if (r.type === 0x03ef && r.len >= 16) masterId = u32(r.o + 12); }
    if (!drawing) return null;
    const scheme = schemeOf(so) || schemeOf(masterRef.get(masterId) !== undefined ? masterRef.get(masterId) : lists[1][0] && lists[1][0].ref);
    const textsOf = (from, to, depth, out) => { // the texts a shape holds: its own, or placeholder references into the slide list
      let type = 4;
      for (const r of recs(from, to)) {
        if ((r.ver === 15 || r.type === T_CLIENTTEXT || r.type === T_CLIENTDATA) && depth < 8) textsOf(r.o, r.e, depth + 1, out);
        else if (r.type === T_REF && r.len >= 4) { const t = s.texts[u32(r.o)]; if (t) out.push(t); }
        else if (r.type === T_HEADER && r.len >= 4) type = u32(r.o);
        else if (r.type === T_CHARS || r.type === T_BYTES) out.push({ type, text: decode(r) });
      }
      return out;
    };
    const ROOT = { cl: 0, ct: 0, sx: 1 / 6, sy: 1 / 6 };
    const place = (a, xf) => ({ x: (a.l - xf.cl) * xf.sx, y: (a.t - xf.ct) * xf.sy, w: (a.r - a.l) * xf.sx, h: (a.b - a.t) * xf.sy });
    const used = new Set();
    const shapeOf = (from, to) => { // one shape container: { sp, props, anchor, group, texts }
      const o = { type: 0, flags: 0, props: {}, anchor: null, group: null, texts: [] };
      for (const r of recs(from, to)) {
        if (r.type === T_SPREC && r.len >= 8) { o.type = dv.getUint16(r.at, true) >> 4; o.flags = u32(r.o + 4); }
        else if (r.type === T_OPT) { const n = dv.getUint16(r.at, true) >> 4; for (let k = 0; k < n && r.o + k * 6 + 6 <= r.e; k++) o.props[dv.getUint16(r.o + k * 6, true) & 0x3fff] = dv.getInt32(r.o + k * 6 + 2, true); }
        else if (r.type === T_CANCHOR && r.len === 8) o.anchor = { t: dv.getInt16(r.o, true), l: dv.getInt16(r.o + 2, true), r: dv.getInt16(r.o + 4, true), b: dv.getInt16(r.o + 6, true) };
        else if (r.type === T_CANCHOR && r.len >= 16) o.anchor = { t: dv.getInt32(r.o, true), l: dv.getInt32(r.o + 4, true), r: dv.getInt32(r.o + 8, true), b: dv.getInt32(r.o + 12, true) };
        else if (r.type === T_CHANCHOR && r.len >= 16) o.anchor = { l: dv.getInt32(r.o, true), t: dv.getInt32(r.o + 4, true), r: dv.getInt32(r.o + 8, true), b: dv.getInt32(r.o + 12, true) };
        else if (r.type === T_GRPREC && r.len >= 16) o.group = { l: dv.getInt32(r.o, true), t: dv.getInt32(r.o + 4, true), r: dv.getInt32(r.o + 8, true), b: dv.getInt32(r.o + 12, true) };
        else if (r.type === T_CLIENTTEXT || r.type === T_CLIENTDATA) textsOf(r.o, r.e, 0, o.texts);
      }
      return o;
    };
    const item = (sh, xf) => {
      if (!sh.anchor || (sh.flags & 0x08)) return null; // no box, or a deleted shape
      const bx = place(sh.anchor, xf); if (!(bx.w > 0 && bx.h > 0)) return null;
      const P = sh.props; const has = (id, mask) => P[id] !== undefined && (P[id] & mask) === mask;
      const fill = has(0x1bf, 0x100010) && P[0x1bf] & 0x10 ? { hex: colorOf(P[0x181] !== undefined ? P[0x181] : 0xffffff, scheme), a: 1 } : null;
      const lined = P[0x1ff] !== undefined && (P[0x1ff] & 0x080000) && (P[0x1ff] & 0x08);
      const dash = P[0x1ce]; const line = lined ? { w: Math.max(1, (P[0x1cb] !== undefined ? P[0x1cb] : 9525) / 9525), color: { hex: colorOf(P[0x1c0] !== undefined ? P[0x1c0] : 0, scheme), a: 1 }, dash: dash >= 6 ? 'dotted' : dash >= 2 ? 'dashed' : 'solid' } : null;
      const texts = sh.texts.filter((t) => { const k = t.text; return k && k.replace(/[\x00-\x08\x0e-\x1f\r\v\n\x09 ]/g, ''); });
      let text = null; let role;
      if (texts.length) {
        const lines = []; const paras = [];
        const head = texts[0]; const isTitle = head.type === 0 || head.type === 6; const isBody = [1, 5, 7, 8].includes(head.type);
        for (const t of texts) for (const l of clean(t.text)) lines.push({ l, t });
        const pt = fitPt(lines.map((x) => x.l), bx.w, bx.h, isTitle ? 40 : isBody ? 28 : 18);
        for (const x of lines) paras.push(para(x.l, Math.round(pt * PX_PT), x.t.type === 6 ? 'center' : 'left', [1, 5, 7, 8].includes(x.t.type)));
        const ins = (id, d) => (P[id] !== undefined ? P[id] : d) / 9525;
        const an = P[0x87]; text = { anchor: an === 1 || an === 4 ? 'ctr' : an === 2 || an === 5 ? 'b' : an === 0 || an === 3 ? 't' : isTitle ? 'ctr' : 't', l: ins(0x81, 91440), r: ins(0x83, 91440), t: ins(0x82, 45720), b: ins(0x84, 45720), wrap: P[0x85] !== 2, scale: 1, paras };
        if (isTitle) role = 'title'; else if (isBody) role = 'body';
      }
      const geom = GEOM[sh.type];
      if (!text && !fill && !line) return null;
      if (!geom && !text) return null; // a shape this reader cannot draw, with nothing to say, is left out
      return { ...(role ? { role } : {}), t: 'shape', ...bx, rot: P[0x04] ? P[0x04] / 65536 : 0, ...(sh.flags & 0x40 ? { fh: true } : {}), ...(sh.flags & 0x80 ? { fv: true } : {}), geom: geom || 'rect', adj: null, fill, line, text };
    };
    const walk = (from, to, xf, out, top) => { // a group container: its first shape is the group itself, the rest are its children
      let first = true;
      for (const r of recs(from, to)) {
        if (r.type === T_SPGR) {
          let gx = xf; let sub = out;
          const kids = [...recs(r.o, r.e)]; const g0 = kids[0] && kids[0].type === T_SP ? shapeOf(kids[0].o, kids[0].e) : null;
          if (!top && g0 && g0.anchor && g0.group) {
            const bx = place(g0.anchor, xf); const gw = g0.group.r - g0.group.l; const gh = g0.group.b - g0.group.t;
            if (bx.w > 0 && bx.h > 0 && gw > 0 && gh > 0) { gx = { cl: g0.group.l, ct: g0.group.t, sx: bx.w / gw, sy: bx.h / gh }; sub = []; out.push({ t: 'group', ...bx, rot: 0, items: sub }); }
          }
          walk(r.o, r.e, gx, sub, false);
          if (sub !== out && !sub.length) out.pop();
        } else if (r.type === T_SP) {
          if (first && top === false && r.type === T_SP && recs(r.o, r.e) && [...recs(r.o, r.e)].some((x) => x.type === T_GRPREC)) { first = false; continue; } // the group's own shape
          first = false;
          const sh = shapeOf(r.o, r.e); if (sh.flags & 0x04) continue; // the page's patriarch shape
          const it = item(sh, xf); if (it) out.push(it);
        } else if (r.ver === 15 && r.type >= 0xf000) walk(r.o, r.e, xf, out, top);
      }
    };
    const items = [];
    try { walk(drawing.o, drawing.e, ROOT, items, true); } catch { return null; }
    void used;
    return items;
  }

  const BLACK = { hex: '000000', a: 1 };
  const clean = (t) => t.replace(/[\x00-\x08\x0e-\x1f]/g, '').split(/[\r\v\n]/).map((x) => x.replace(/\x09/g, '    ')).filter((x) => x.trim());
  const para = (text, px, algn, bullet) => ({
    algn, marL: bullet ? 24 : 0, indent: bullet ? -24 : 0, bullet: bullet ? { text: '\u2022' } : null,
    runs: [{ text, size: px, b: false, i: false, u: false, font: 'Calibri', color: BLACK }], size: px
  });
  const box = (x, y, w, h, anchor, paras) => ({ t: 'shape', x, y, w, h, rot: 0, geom: 'rect', adj: null, fill: null, line: null, text: { anchor, l: 10, r: 10, t: 5, b: 5, wrap: true, scale: 1, paras } });

  function load(i) {
    const s = slides[i];
    const real = shapeItems(s);
    if (real && real.length) return { w: W, h: H, bg: { hex: 'FFFFFF', a: 1 }, items: real, media: {}, notes: notesOf.get(s.slideId) || '' };
    const texts = slideTexts(s); // a slide without a readable drawing: its texts laid out by size
    const items = [];
    const ti = texts.findIndex((t) => t.type === 0 || t.type === 6);
    const title = ti >= 0 ? texts[ti] : null;
    if (title) {
      const lines = clean(title.text); const chars = lines.join(' ').length;
      const pt = chars > 90 ? 24 : chars > 50 ? 30 : 38;
      items.push({ role: 'title', ...box(Math.round(W * 0.06), Math.round(H * 0.05), Math.round(W * 0.88), Math.round(H * 0.2), 'ctr',
        lines.map((l) => para(l, Math.round(pt * PX_PT), title.type === 6 ? 'center' : 'left', false))) });
    }
    const rest = texts.filter((t, k) => k !== ti);
    const blocks = rest.map((t) => ({ t, lines: clean(t.text) })).filter((b) => b.lines.length);
    if (blocks.length) {
      const chars = blocks.reduce((n, b) => n + b.lines.join(' ').length, 0);
      const pt = chars > 900 ? 12 : chars > 600 ? 14 : chars > 350 ? 18 : chars > 200 ? 22 : 26;
      const paras = [];
      for (const b of blocks) for (const l of b.lines) paras.push(para(l, Math.round(pt * PX_PT), b.t.type === 6 ? 'center' : 'left', [1, 5, 7, 8].includes(b.t.type)));
      const y = title ? Math.round(H * 0.28) : Math.round(H * 0.06);
      items.push({ role: 'body', ...box(Math.round(W * 0.06), y, Math.round(W * 0.88), Math.round(H - y - H * 0.06), 't', paras) });
    }
    return { w: W, h: H, bg: { hex: 'FFFFFF', a: 1 }, items, media: {}, notes: notesOf.get(s.slideId) || '' };
  }
  return { kind: 'pptx', count: slides.length, load, size: { w: W, h: H }, notice: 'Shapes with their position, fill, line and text only: text styles, pictures, master shapes and backgrounds of this old PowerPoint file are not shown.' };
}
