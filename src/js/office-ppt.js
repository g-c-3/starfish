// office-ppt.js — view-only reader for ppt, the PowerPoint 97 to 2003 format (Decisions 451, 456, 515, 516, 517, 518, 519). Follows the newest edit
// of the "PowerPoint Document" stream to the slide list and the slide objects, and returns each slide's shapes (position, fill, line,
// text) and notes as the same model as readPptx. Text runs carry their style (character runs and paragraph runs of the style atom,
// master text styles by level, fonts, bullets, alignment, indents, spacing); a title or body that overflows its box is scaled down.
// Pictures (JPEG, PNG, bitmap) come from the picture store of the drawing group and the "Pictures" stream. The slide background (its own, else its master's, else the scheme's) and the master's own shapes (not its placeholders) are drawn behind the slide's shapes. The model carries a notice of what is not shown.
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
const T_PH = 0x0bc3; const T_PPDGG = 0x040b; const T_BSE = 0xf007;
const T_STYLE = 0x0fa1; const T_RULER = 0x0fa6; const T_MSTYLE = 0x0fa3; const T_ENV = 0x03f2; const T_FONTS = 0x07d5; const T_FONT = 0x0fb7;
const BODYT = [1, 5, 7, 8];
const ARRAY_PROPS = new Set([0x145, 0x146, 0x155, 0x156, 0x157, 0x158]); // vertices, segments, handles, guides, inscribe, connection sites
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
  const fonts = []; const envStyles = new Map(); const bse = [];
  function collectBse(from, to, depth) { for (const r of recs(from, to)) { if (r.type === T_BSE) bse.push(r); else if (r.ver === 15 && depth < 6) collectBse(r.o, r.e, depth + 1); } }
  for (const r of recs(doc.o, doc.e)) {
    if (r.type === T_ENV) { // the font collection and the default text styles
      for (const c of recs(r.o, r.e)) {
        if (c.type === T_FONTS) { for (const f of recs(c.o, c.e)) if (f.type === T_FONT && f.len >= 64) { let n = ''; for (let k = 0; k < 32; k++) { const ch = dv.getUint16(f.o + k * 2, true); if (!ch) break; n += String.fromCharCode(ch); } fonts.push(n); } }
        else if (c.type === T_MSTYLE) masterStyle(c, envStyles);
      }
    } else if (r.type === T_PPDGG) collectBse(r.o, r.e, 0);
    else if (r.type === T_DOCATOM && r.len >= 8) { W = Math.round(u32(r.o) / 6) || 960; H = Math.round(u32(r.o + 4) / 6) || 720; }
    else if (r.type === T_SLWT) {
      const inst = dv.getUint16(r.at, true) >> 4;
      if (inst !== 0 && inst !== 1 && inst !== 2) continue;
      let cur = null; let type = 4;
      for (const c of recs(r.o, r.e)) {
        if (c.type === T_PERSIST && c.len >= 16) { cur = { ref: u32(c.o), slideId: u32(c.o + 12), texts: [] }; lists[inst].push(cur); type = 4; }
        else if (c.type === T_HEADER && c.len >= 4) type = u32(c.o);
        else if ((c.type === T_CHARS || c.type === T_BYTES) && cur) cur.texts.push({ type, text: decode(c) });
        else if (c.type === T_STYLE && cur && cur.texts.length) cur.texts[cur.texts.length - 1].style = c;
        else if (c.type === T_RULER && cur && cur.texts.length) cur.texts[cur.texts.length - 1].ruler = c;
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


  // ---- text styles: the paragraph and character runs of a text (style atom), the master styles by text type and level, the ruler ----
  const i16 = (o) => dv.getInt16(o, true); const u16 = (o) => dv.getUint16(o, true);
  function readPF(p) { // one paragraph property block: the mask, then the fields it names in a fixed order; margins are 1/576 inch
    const m = u32(p); p += 4; const v = {};
    if (m & 0x0f) { const f = u16(p); p += 2; if (m & 1) v.bu = !!(f & 1); }
    if (m & 0x80) { v.ch = u16(p); p += 2; }
    if (m & 0x10) { v.bf = u16(p); p += 2; }
    if (m & 0x40) { v.bus = i16(p); p += 2; }
    if (m & 0x20) { v.buc = u32(p); p += 4; }
    if (m & 0x800) { v.al = u16(p); p += 2; }
    if (m & 0x1000) { v.ln = i16(p); p += 2; }
    if (m & 0x2000) { v.sb = i16(p); p += 2; }
    if (m & 0x4000) { v.sa = i16(p); p += 2; }
    if (m & 0x100) { v.ml = i16(p); p += 2; }
    if (m & 0x400) { v.ind = i16(p); p += 2; }
    if (m & 0x8000) p += 2;
    if (m & 0x100000) p += 2 + u16(p) * 4;
    if (m & 0x10000) p += 2;
    if (m & 0xe0000) p += 2;
    if (m & 0x200000) p += 2;
    return { v, p };
  }
  function readCF(p) { // one character property block
    const m = u32(p); p += 4; const v = {};
    if (m & 0x3fff) { const f = u16(p); p += 2; if (m & 1) v.b = !!(f & 1); if (m & 2) v.i = !!(f & 2); if (m & 4) v.u = !!(f & 4); }
    if (m & 0x10000) { v.face = u16(p); p += 2; }
    if (m & 0x200000) p += 2;
    if (m & 0x400000) p += 2;
    if (m & 0x800000) p += 2;
    if (m & 0x20000) { v.sz = u16(p); p += 2; }
    if (m & 0x40000) { v.col = u32(p); p += 4; }
    if (m & 0x80000) { v.pos = i16(p); p += 2; }
    return { v, p };
  }
  function styleRuns(a, len) { // the style atom of a text: paragraph runs, then character runs; each run counts its characters, the last one includes the paragraph mark
    try {
      const pf = []; const cf = []; let p = a.o; let n = 0; let st = 0;
      while (n < len + 1 && p + 10 <= a.e && pf.length < 5000) { const c = u32(p); const lvl = u16(p + 4); const r = readPF(p + 6); pf.push({ n: c, s: st, lvl: Math.min(lvl, 4), v: r.v }); st += c; n += c; p = r.p; if (!c) break; }
      n = 0; st = 0;
      while (n < len + 1 && p + 8 <= a.e && cf.length < 5000) { const c = u32(p); const r = readCF(p + 4); cf.push({ n: c, s: st, v: r.v }); st += c; n += c; p = r.p; if (!c) break; }
      return { pf, cf };
    } catch { return null; }
  }
  function readRuler(a) { // per-level text start and first-line margins of a text box; a block that does not end where its record does is ignored
    try {
      let p = a.o; const m = u32(p); p += 4; const L = []; const I = [];
      if (m & 1) p += 2; if (m & 2) p += 2; if (m & 4) p += 2 + u16(p) * 4;
      for (let k = 0; k < 5; k++) if (m & (8 << k)) { L[k] = i16(p); p += 2; }
      for (let k = 0; k < 5; k++) if (m & (0x100 << k)) { I[k] = i16(p); p += 2; }
      return p === a.e ? { L, I } : null;
    } catch { return null; }
  }
  function masterStyle(r, map) { // a master text style atom: five levels of paragraph and character properties for one text type
    try {
      const inst = u16(r.at) >> 4; let p = r.o; const n = u16(p); p += 2; const lv = [];
      for (let k = 0; k < Math.min(n, 5); k++) { if (inst >= 5) p += 2; const a = readPF(p); const c = readCF(a.p); p = c.p; lv.push({ pf: a.v, cf: c.v }); }
      if (lv.length) map.set(inst, lv);
    } catch { /* a style this reader cannot follow: defaults apply */ }
  }
  const masterStyles = new Map();
  const stylesOf = (off) => { // the text styles of a master container, by text type
    if (off === undefined) return new Map();
    if (!masterStyles.has(off)) { const m = new Map(); if (off + 8 <= ps.length) for (const r of recs(off + 8, off + 8 + u32(off + 4))) if (r.type === T_MSTYLE) masterStyle(r, m); masterStyles.set(off, m); }
    return masterStyles.get(off);
  };
  const BULLETS = { 0x6c: '\u25cf', 0x6e: '\u25a0', 0x71: '\u2751', 0x76: '\u2756', 0xa7: '\u25aa', 0xd8: '\u27a2', 0xfc: '\u2713', 0xb7: '\u2022', 0x9f: '\u2022', 0x6f: '\u25a1', 0xa8: '\u25a1' };
  const bulletOf = (ch, face) => { const sym = /wingdings|symbol|webdings/i.test(face || ''); if (sym) return BULLETS[ch & 0xff] || '\u2022'; return ch ? String.fromCharCode(ch) : '\u2022'; };

  // ---- pictures: the picture store entries of the drawing group point into the "Pictures" stream (or carry the picture); JPEG, PNG and bitmap are read ----
  const picS = ole.stream('Pictures'); const blips = new Map(); let picBytes = 0;
  const blipAt = (buf, o) => { // one picture block: header, id (16 bytes, 32 when the instance says two), tag, data
    if (!buf || o < 0 || o + 8 > buf.length) return null;
    const bv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const inst = bv.getUint16(o, true) >> 4; const type = bv.getUint16(o + 2, true); const len = bv.getUint32(o + 4, true);
    if (o + 8 + len > buf.length) return null;
    const two = { 0xf01d: [0x46b, 0x6e3], 0xf01e: [0x6e1], 0xf01f: [0x7a9] }[type]; if (!two) return null;
    const at = o + 8 + (two.includes(inst) ? 32 : 16) + 1; const end = o + 8 + len; if (at >= end) return null;
    const data = buf.subarray(at, end);
    if (type === 0xf01d) return { bytes: data, mime: 'image/jpeg', ext: 'jpg' };
    if (type === 0xf01e) return { bytes: data, mime: 'image/png', ext: 'png' };
    if (data.length < 40) return null; // a bitmap without its file header: one is put in front
    const d2 = new DataView(data.buffer, data.byteOffset, data.byteLength); const hs = d2.getUint32(0, true); const bpp = d2.getUint16(14, true);
    const used = d2.getUint32(32, true); const pal = bpp <= 8 ? (used || 1 << bpp) * 4 : (d2.getUint32(16, true) === 3 && hs === 40 ? 12 : 0);
    const out = new Uint8Array(14 + data.length); const ov = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x4d; ov.setUint32(2, out.length, true); ov.setUint32(10, 14 + hs + pal, true); out.set(data, 14);
    return { bytes: out, mime: 'image/bmp', ext: 'bmp' };
  };
  const blipOf = (idx) => { // the picture of a shape's picture index (1-based into the store)
    if (blips.has(idx)) return blips.get(idx);
    let im = null;
    try {
      const e = bse[idx - 1];
      if (e && e.len >= 36) {
        const nameLen = ps[e.o + 33];
        im = e.len > 36 + nameLen ? blipAt(ps, e.o + 36 + nameLen) : blipAt(picS, u32(e.o + 28));
        if (im) { picBytes += im.bytes.length; if (picBytes > 40 * 1024 * 1024) im = null; }
      }
    } catch { im = null; }
    blips.set(idx, im); return im;
  };

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
  function shapeItems(s, media, out) {
    const so = persist.get(s.ref);
    if (so === undefined || so + 8 > ps.length || dv.getUint16(so + 2, true) !== T_SLIDE) return null;
    const soE = so + 8 + u32(so + 4);
    let drawing = null; let masterId = 0; let objFlag = 1;
    for (const r of recs(so + 8, soE)) { if (r.type === T_PPDRAW) drawing = r; else if (r.type === 0x03ef && r.len >= 16) { masterId = u32(r.o + 12); if (r.len >= 22) objFlag = dv.getUint16(r.o + 20, true) & 1; } }
    if (!drawing) return null;
    const mref = masterRef.get(masterId) !== undefined ? masterRef.get(masterId) : lists[1][0] && lists[1][0].ref; // the slide's master: a persist reference, resolved to its offset
    const moff = mref !== undefined ? persist.get(mref) : undefined;
    let scheme = schemeOf(so) || schemeOf(moff);
    const textsOf = (from, to, depth, out) => { // the texts a shape holds: its own, or placeholder references into the slide list
      let type = 4;
      for (const r of recs(from, to)) {
        if ((r.ver === 15 || r.type === T_CLIENTTEXT || r.type === T_CLIENTDATA) && depth < 8) textsOf(r.o, r.e, depth + 1, out);
        else if (r.type === T_REF && r.len >= 4) { const t = s.texts[u32(r.o)]; if (t) { t.ph = true; out.push(t); } }
        else if (r.type === T_HEADER && r.len >= 4) type = u32(r.o);
        else if (r.type === T_CHARS || r.type === T_BYTES) out.push({ type, text: decode(r) });
        else if ((r.type === T_STYLE || r.type === T_RULER) && out.length) { const last = out[out.length - 1]; const k = r.type === T_STYLE ? 'style' : 'ruler'; if (!last[k]) last[k] = r; }
      }
      return out;
    };
    const mstyles = stylesOf(moff);
    const levelsOf = (type) => mstyles.get(type) || mstyles.get(type === 0 || type === 6 ? 0 : BODYT.includes(type) ? 1 : 4) || envStyles.get(type) || envStyles.get(type === 0 || type === 6 ? 0 : BODYT.includes(type) ? 1 : 4) || [];
    const txColor = (v, dflt) => { // a text colour: RGB (index byte 0xfe), or an index into the scheme
      if (v === undefined) return dflt; const idx = v >>> 24;
      if (idx === 0xfe) return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
      if (idx < 8 && scheme) return scheme[idx] || dflt; return dflt;
    };
    const wholeLen = (d) => d.n + d.s;
    const spanAt = (runs, i) => { for (const r of runs) if (i >= r.s && i < r.s + r.n) return r; return runs[runs.length - 1] || null; };
    const styled = (t, defPt) => { // the paragraphs of one text: paragraph properties from the master level, the ruler, then the text's own run; runs split at character-run edges
      const raw = t.text; const sr = t.style ? styleRuns(t.style, raw.length) : null; const lv = levelsOf(t.type); const ru = t.ruler ? readRuler(t.ruler) : null;
      const pfs = sr && sr.pf.length ? sr.pf : [{ n: raw.length + 1, s: 0, lvl: 0, v: {} }]; const cfs = sr && sr.cf.length ? sr.cf : [{ n: raw.length + 1, s: 0, v: {} }];
      const out = []; let st = 0;
      const mkPara = (a, b) => {
        const pr = spanAt(pfs, a); const ml = lv[pr.lvl] || {}; const rv = ru ? { ...(ru.L[pr.lvl] !== undefined ? { ml: ru.L[pr.lvl] } : {}), ...(ru.I[pr.lvl] !== undefined ? { ind: ru.I[pr.lvl] } : {}) } : {};
        const pf = { ...ml.pf, ...rv, ...pr.v };
        const runs = [];
        for (const c of cfs) {
          const x = Math.max(a, c.s); const y = Math.min(b, c.s + c.n); if (y <= x) continue;
          const cf = { ...(ml.cf || {}), ...c.v }; const pt = cf.sz || defPt;
          const base = { size: Math.round(pt * PX_PT), b: !!cf.b, i: !!cf.i, u: !!cf.u, font: fonts[cf.face] || fonts[0] || 'Arial', color: { hex: txColor(cf.col, (scheme && scheme[1]) || '000000'), a: 1 }, ...(cf.pos > 0 ? { sup: true } : cf.pos < 0 ? { sub: true } : {}) };
          raw.slice(x, y).split('\v').forEach((piece, k) => {
            if (k) runs.push({ br: true });
            const tx = piece.replace(/\x09/g, '    ').replace(/[\x00-\x08\x0b\x0e-\x1f]/g, ''); if (tx) runs.push({ ...base, text: tx });
          });
        }
        const first = runs.find((r) => !r.br); const size = first ? first.size : Math.round(((ml.cf && ml.cf.sz) || defPt) * PX_PT);
        const hasBu = pf.bu !== undefined ? pf.bu : BODYT.includes(t.type); const bulletOn = hasBu && !!first;
        const left = pf.ml !== undefined ? pf.ml / 6 : hasBu ? 24 : 0; const firstLine = pf.ind !== undefined ? pf.ind / 6 : hasBu ? 0 : left;
        const sp = (v) => (v === undefined ? undefined : v >= 0 ? (v ? { pct: v / 100 } : undefined) : v <= -3 ? { px: -v / 6 } : undefined);
        const bullet = bulletOn ? { text: bulletOf(pf.ch, fonts[pf.bf]), color: pf.buc !== undefined ? { hex: txColor(pf.buc, '000000'), a: 1 } : first.color, ...(pf.bus > 0 ? { size: pf.bus / 100 } : {}) } : null;
        return { algn: [, 'center', 'right', 'justify'][pf.al] || (t.type === 6 && pf.al === undefined ? 'center' : 'left'), marL: left, indent: firstLine - left, sb: sp(pf.sb), sa: sp(pf.sa), ln: sp(pf.ln), bullet, runs, size };
      };
      for (let i = 0; i <= raw.length; i++) if (i === raw.length || raw[i] === '\r') { out.push(mkPara(st, i)); st = i + 1; }
      while (out.length && !out[out.length - 1].runs.length) out.pop();
      return out;
    };
    void wholeLen;
    const fitScale = (paras, w, h) => { // a title or body that overflows its box is scaled down, as the editor's shrink on overflow does
      const est = (k) => { let sum = 0; for (const p of paras) { const sz = p.size * k; const n = p.runs.reduce((c, r) => c + (r.text ? r.text.length : 0), 0); const cpl = Math.max(1, Math.floor(Math.max(20, w - p.marL) / (sz * 0.5))); const lh = p.ln ? (p.ln.pct !== undefined ? p.ln.pct * 1.2 : p.ln.px / sz) : 1.2; sum += Math.max(1, Math.ceil(n / cpl)) * sz * lh + (p.sb ? (p.sb.px !== undefined ? p.sb.px : p.sb.pct * sz) : 0) + (p.sa ? (p.sa.px !== undefined ? p.sa.px : p.sa.pct * sz) : 0); } return sum; };
      let k = 1; while (k > 0.5 && est(k) > h - 4) k = Math.round((k - 0.05) * 100) / 100; return k;
    };
    const ROOT = { cl: 0, ct: 0, sx: 1 / 6, sy: 1 / 6 };
    const place = (a, xf) => ({ x: (a.l - xf.cl) * xf.sx, y: (a.t - xf.ct) * xf.sy, w: (a.r - a.l) * xf.sx, h: (a.b - a.t) * xf.sy });
    const used = new Set(); let skipPh = false;
    const shapeOf = (from, to) => { // one shape container: { sp, props, anchor, group, texts }
      const o = { type: 0, flags: 0, props: {}, anchor: null, group: null, texts: [], isPh: false, cx: {} };
      for (const r of recs(from, to)) {
        if (r.type === T_SPREC && r.len >= 8) { o.type = dv.getUint16(r.at, true) >> 4; o.flags = u32(r.o + 4); }
        else if (r.type === T_OPT) {
          const n = dv.getUint16(r.at, true) >> 4; let q = r.o + n * 6; // complex values follow the entries, in entry order
          for (let k = 0; k < n && r.o + k * 6 + 6 <= r.e; k++) {
            const idw = dv.getUint16(r.o + k * 6, true); const v = dv.getInt32(r.o + k * 6 + 2, true); o.props[idw & 0x3fff] = v;
            if (idw & 0x8000) { const hd = ARRAY_PROPS.has(idw & 0x3fff) ? 6 : 0; if (v >= 0 && q + hd + v <= r.e) o.cx[idw & 0x3fff] = { o: q, len: v }; q += hd + Math.max(0, v); } // an array has a 6 byte header before its elements, not counted in its size
          }
        }
        else if (r.type === T_CANCHOR && r.len === 8) o.anchor = { t: dv.getInt16(r.o, true), l: dv.getInt16(r.o + 2, true), r: dv.getInt16(r.o + 4, true), b: dv.getInt16(r.o + 6, true) };
        else if (r.type === T_CANCHOR && r.len >= 16) o.anchor = { t: dv.getInt32(r.o, true), l: dv.getInt32(r.o + 4, true), r: dv.getInt32(r.o + 8, true), b: dv.getInt32(r.o + 12, true) };
        else if (r.type === T_CHANCHOR && r.len >= 16) o.anchor = { l: dv.getInt32(r.o, true), t: dv.getInt32(r.o + 4, true), r: dv.getInt32(r.o + 8, true), b: dv.getInt32(r.o + 12, true) };
        else if (r.type === T_GRPREC && r.len >= 16) o.group = { l: dv.getInt32(r.o, true), t: dv.getInt32(r.o + 4, true), r: dv.getInt32(r.o + 8, true), b: dv.getInt32(r.o + 12, true) };
        else if (r.type === T_CLIENTTEXT || r.type === T_CLIENTDATA) { textsOf(r.o, r.e, 0, o.texts); if (r.type === T_CLIENTDATA) for (const c of recs(r.o, r.e)) if (c.type === T_PH) o.isPh = true; }
      }
      return o;
    };
    const freeform = (sh) => { // a free-form outline from the vertex array and the segment array, as one path in the shape's own units
      const P = sh.props; const V = sh.cx[0x145]; const S = sh.cx[0x146]; if (!V || !S) return null;
      try {
        const arr = (c) => { const n = u16(c.o); const es = n ? Math.floor(c.len / n) : 0; return { n, es, at: c.o + 6 }; };
        const va = arr(V); const sa = arr(S); if (!(va.n > 0 && (va.es === 8 || va.es === 4) && sa.es === 2) || va.n > 20000) return null;
        const pts = []; for (let i = 0; i < va.n; i++) pts.push(va.es === 8 ? [dv.getInt32(va.at + i * 8, true), dv.getInt32(va.at + i * 8 + 4, true)] : [dv.getInt16(va.at + i * 4, true), dv.getInt16(va.at + i * 4 + 2, true)]);
        if (pts.some((q) => q[0] < (va.es === 8 ? -0x40000000 : -32000) || q[1] < (va.es === 8 ? -0x40000000 : -32000))) return null; // coordinates that are formula references (guides) are not evaluated
        let gl = P[0x140] !== undefined ? P[0x140] : 0; let gt = P[0x141] !== undefined ? P[0x141] : 0; let gr = P[0x142] !== undefined ? P[0x142] : 21600; let gb = P[0x143] !== undefined ? P[0x143] : 21600;
        if (!(gr > gl && gb > gt)) { gl = Math.min(...pts.map((q) => q[0])); gr = Math.max(...pts.map((q) => q[0])); gt = Math.min(...pts.map((q) => q[1])); gb = Math.max(...pts.map((q) => q[1])); } // no coordinate space given: the vertices' own extent
        const w = gr - gl; const h = gb - gt; if (!(w > 0 && h > 0)) return null;
        const pt = (i) => { const q = pts[i]; if (!q) throw new Error('vertex'); return `${q[0] - gl} ${q[1] - gt}`; };
        let d = ''; let vi = 0; let nf = false;
        for (let i = 0; i < sa.n; i++) {
          const v = u16(sa.at + i * 2); const t = (v >> 13) & 7; const cnt = v & 0xff;
          if (t === 0) for (let k = 0; k < cnt; k++) d += `L${pt(vi++)}`; // line to, cnt points
          else if (t === 1) for (let k = 0; k < cnt; k++) { d += `C${pt(vi)} ${pt(vi + 1)} ${pt(vi + 2)}`; vi += 3; }
          else if (t === 2) d += `M${pt(vi++)}`;
          else if (t === 3) d += 'Z';
          else if (t === 4) break;
          else if (t === 5) { const code = (v >> 8) & 0x1f; if (code === 10) nf = true; else if (code === 11) { /* no line: drawn by the line property */ } else if (code === 12) for (let k = 0; k < cnt; k++) d += `L${pt(vi++)}`; else return null; }
          else return null;
        }
        return d ? { w, h, d, nf } : null;
      } catch { return null; }
    };
    const item = (sh, xf) => {
      if (!sh.anchor || (sh.flags & 0x08)) return null; // no box, or a deleted shape
      const bx = place(sh.anchor, xf); const isLn = GEOM[sh.type] === 'line' && !sh.cx[0x145]; if (!(bx.w > 0 && bx.h > 0) && !(isLn && bx.w >= 0 && bx.h >= 0 && bx.w + bx.h > 0)) return null;
      const P = sh.props; const has = (id, mask) => P[id] !== undefined && (P[id] & mask) === mask;
      const fill = has(0x1bf, 0x100010) && P[0x1bf] & 0x10 ? { hex: colorOf(P[0x181] !== undefined ? P[0x181] : 0xffffff, scheme), a: 1 } : null;
      const lined = P[0x1ff] !== undefined && (P[0x1ff] & 0x080000) && (P[0x1ff] & 0x08);
      const dash = P[0x1ce]; const line = lined ? { w: Math.max(1, (P[0x1cb] !== undefined ? P[0x1cb] : 9525) / 9525), color: { hex: colorOf(P[0x1c0] !== undefined ? P[0x1c0] : 0, scheme), a: 1 }, dash: dash >= 6 ? 'dotted' : dash >= 2 ? 'dashed' : 'solid' } : null;
      const bid = P[0x104];
      if (bid > 0 && (sh.type === 75 || (!sh.texts.length && !fill))) { // a picture frame: the picture, its crop (fractions of the picture, 16.16) and its line
        const im = blipOf(bid); if (!im) return null;
        const path = `pic${bid}.${im.ext}`; media[path] = { bytes: im.bytes, mime: im.mime };
        const cr = (id) => (P[id] ? Math.max(0, Math.min(95, (P[id] / 65536) * 100)) : 0);
        return { t: 'pic', ...bx, rot: P[0x04] ? P[0x04] / 65536 : 0, ...(sh.flags & 0x40 ? { fh: true } : {}), ...(sh.flags & 0x80 ? { fv: true } : {}), path, line, crop: { l: cr(0x102), t: cr(0x100), r: cr(0x103), b: cr(0x101) } };
      }
      const texts = sh.texts.filter((t) => { const k = t.text; return k && k.replace(/[\x00-\x08\x0e-\x1f\r\v\n\x09 ]/g, ''); });
      let text = null; let role;
      if (texts.length) {
        const head = texts[0]; const isTitle = head.type === 0 || head.type === 6; const isBody = BODYT.includes(head.type);
        const ins = (id, d) => (P[id] !== undefined ? P[id] : d) / 9525;
        const paras = []; for (const t of texts) paras.push(...styled(t, isTitle ? 40 : isBody ? 28 : 18));
        const an = P[0x87]; text = { anchor: an === 1 || an === 4 ? 'ctr' : an === 2 || an === 5 ? 'b' : an === 0 || an === 3 ? 't' : isTitle ? 'ctr' : 't', l: ins(0x81, 91440), r: ins(0x83, 91440), t: ins(0x82, 45720), b: ins(0x84, 45720), wrap: P[0x85] !== 2, scale: 1, paras };
        if (isTitle || isBody || texts.some((t) => t.ph)) text.scale = fitScale(paras, bx.w - text.l - text.r, bx.h - text.t - text.b);
        if (isTitle) role = 'title'; else if (isBody) role = 'body';
      }
      const cust = sh.cx[0x145] ? freeform(sh) : null; const geom = GEOM[sh.type] || (sh.cx[0x145] && !cust ? 'rect' : undefined); // a formula-based outline is drawn as its box
      if (!text && !fill && !line) return null;
      if (!geom && !cust && !text) return null; // a shape this reader cannot draw, with nothing to say, is left out
      return { ...(role ? { role } : {}), t: 'shape', ...bx, rot: P[0x04] ? P[0x04] / 65536 : 0, ...(sh.flags & 0x40 ? { fh: true } : {}), ...(sh.flags & 0x80 ? { fv: true } : {}), geom: geom || 'rect', adj: sh.type === 2 && P[0x147] !== undefined ? Math.round((P[0x147] / 21600) * 100000) : null, ...(cust ? { cust } : {}), fill, line, text };
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
          if (skipPh && sh.isPh) continue; // a master's placeholders are layout, not drawing
          const it = item(sh, xf); if (it) out.push(it);
        } else if (r.ver === 15 && r.type >= 0xf000) walk(r.o, r.e, xf, out, top);
      }
    };
    const bgOf = (rec) => { // the background shape of a drawing: a shape container beside the group, flagged as background
      const find = (from, to, d) => {
        for (const r of recs(from, to)) {
          if (r.type === T_SP && r.ver === 15) { const sh = shapeOf(r.o, r.e); if (sh.flags & 0x400) return sh; }
          else if (r.ver === 15 && r.type >= 0xf000 && r.type !== T_SPGR && d < 3) { const x = find(r.o, r.e, d + 1); if (x) return x; }
        }
        return null;
      };
      return find(rec.o, rec.e, 0);
    };
    const fillOf = (sh, sc) => { // a solid or two-colour linear fill
      if (!sh) return null; const P = sh.props; if (P[0x181] === undefined && P[0x180] === undefined) return null;
      const t = P[0x180] || 0; const c1 = colorOf(P[0x181] !== undefined ? P[0x181] : 0xffffff, sc);
      if (t >= 4 && t <= 7) { const c2 = colorOf(P[0x183] !== undefined ? P[0x183] : 0xffffff, sc); const a = P[0x18b] !== undefined ? P[0x18b] / 65536 : 0; return { grad: [{ c: { hex: c1, a: 1 }, pos: 0 }, { c: { hex: c2, a: 1 }, pos: 100 }], ang: ((180 - a) % 360 + 360) % 360 }; }
      return { hex: c1, a: 1 };
    };
    const items = []; const own = scheme;
    let bg = null;
    try {
      let mdraw = null; let mscheme = null;
      if (moff !== undefined && moff + 8 <= ps.length) { for (const r of recs(moff + 8, moff + 8 + u32(moff + 4))) if (r.type === T_PPDRAW) mdraw = r; mscheme = schemeOf(moff); }
      bg = fillOf(bgOf(drawing), own);
      if (!bg && mdraw) bg = fillOf(bgOf(mdraw), mscheme || own);
      if (mdraw && objFlag) { scheme = mscheme || own; skipPh = true; try { walk(mdraw.o, mdraw.e, ROOT, items, true); } catch { items.length = 0; } skipPh = false; scheme = own; } // the master's own shapes, behind the slide's
      walk(drawing.o, drawing.e, ROOT, items, true);
    } catch { return null; }
    if (!bg && own) bg = { hex: own[0], a: 1 };
    if (out) out.bg = bg;
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
    const media = {}; const out = {}; const real = shapeItems(s, media, out);
    if (real && real.length) return { w: W, h: H, bg: out.bg || { hex: 'FFFFFF', a: 1 }, items: real, media, notes: notesOf.get(s.slideId) || '' };
    const texts = slideTexts(s); // a slide without a readable drawing: its texts laid out by size
    const items = real ? [...real] : []; // the master's shapes stay behind the laid-out texts
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
    return { w: W, h: H, bg: out.bg || { hex: 'FFFFFF', a: 1 }, items, media, notes: notesOf.get(s.slideId) || '' };
  }
  return { kind: 'pptx', count: slides.length, load, size: { w: W, h: H }, notice: 'Shapes with their position, fill, line and styled text, JPEG, PNG and bitmap pictures, and solid or two-colour backgrounds with the shapes of the master: other pictures, picture backgrounds and other fills of this old PowerPoint file are not shown.' };
}
