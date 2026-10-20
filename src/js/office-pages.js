// office-pages.js — splits a Word model into page sheets from the breaks the file already holds (Decision 242).
// Sources: saved page markers (lastRenderedPageBreak), explicit page breaks, page-break-before and section breaks.
// A file with no saved page marker is laid out by measuring (paginateAuto, Decision 243); the measuring itself is done by the caller.

import { formatNum } from './office-read.js';

const fnRefs = (blocks, out) => { // footnote numbers referenced in these blocks, in order
  for (const b of blocks) {
    if (b.t === 'table') { for (const r of b.rows) for (const c of r) fnRefs(c.blocks, out); } else for (const r of b.runs) if (r.fn !== undefined && !out.includes(r.fn)) out.push(r.fn);
  }
  return out;
};

export function hasSavedBreaks(model) { // lastRenderedPageBreak markers: written by Word at every page of a saved file
  return model.blocks.some((b) => (b.t === 'table' ? (b.rowBrk || []).some(Boolean) : b.runs.some((r) => r.lrb)));
}

export function paginate(model) {
  if (!hasSavedBreaks(model)) return null;
  const secs = model.sections && model.sections.length ? model.sections : null;
  const pages = []; let cur = []; let curSec = 0; let startSec = 0; let saved = false;
  const add = (b) => { if (!cur.length) startSec = curSec; cur.push(b); };
  const brk = () => { if (cur.length) { pages.push({ blocks: cur, sec: startSec }); cur = []; } };
  const mark = () => { brk(); saved = true; };

  const addTable = (b) => {
    const rb = b.rowBrk || [];
    if (rb[0] && cur.length) mark();
    let from = 0;
    for (let k = 1; k < b.rows.length; k++) {
      if (!rb[k] || b.rows[k].some((c) => c.vm === 'cont')) continue; // never inside a vertically merged group
      add({ ...b, rows: b.rows.slice(from, k), rowBrk: undefined }); mark(); from = k;
    }
    add(from === 0 ? b : { ...b, rows: b.rows.slice(from), rowBrk: undefined });
  };

  const addParagraph = (b) => {
    if (b.pr && b.pr.pb && cur.length) mark();
    if (!b.runs.some((r) => r.lrb || r.pb)) { add(b); return; }
    const segs = [[]];
    for (const r of b.runs) { if (r.lrb || r.pb) segs.push([]); else segs[segs.length - 1].push(r); }
    let seen = false; // an earlier part with content is on a previous page
    const last = segs.reduce((m, s, i) => (s.length ? i : m), -1);
    segs.forEach((seg, i) => {
      if (i > 0) mark();
      if (!seg.length) return;
      const pr = { ...b.pr };
      if (i < last) pr.sa = 0;
      if (seen) { pr.sb = 0; pr.first = 0; pr.pb = false; }
      add({ ...b, runs: seg, pr, list: seen ? null : b.list, cont: seen });
      seen = true;
    });
  };

  for (const b of model.blocks) {
    if (b.t === 'table') addTable(b); else addParagraph(b);
    if (b.sectEnd !== undefined) { // the section ends here; the next one says how it starts
      curSec = Math.min(curSec + 1, secs ? secs.length - 1 : 0);
      const nx = secs && secs[curSec];
      if (nx && nx.type !== 'continuous') mark();
    }
  }
  brk();
  if (!saved || !pages.length) return null;

  // numbering: a section may restart or change the format; SECTIONPAGES counts the pages of the section
  const note = model.storedPages > 1 && model.storedPages !== pages.length
    ? `Page breaks follow the file: ${pages.length} pages shown, ${model.storedPages} saved. Fonts can move a break.` : '';
  return number(pages, secs, note);
}

function number(pages, secs, note) {
  const secPages = {}; for (const p of pages) secPages[p.sec] = (secPages[p.sec] || 0) + 1;
  let n = 0; let prev = -1; let inSec = 0;
  for (const p of pages) {
    const sec = secs ? secs[p.sec] : null;
    if (p.sec !== prev) { inSec = 0; prev = p.sec; if (sec && sec.pgStart !== null) n = sec.pgStart - 1; }
    n++; inSec++;
    p.n = n; p.first = inSec === 1; p.label = formatNum(n, sec && sec.pgFmt); p.secPages = secPages[p.sec]; p.fns = fnRefs(p.blocks, []);
  }
  return { sheets: pages, total: pages.length, note };
}

// ---- measured breaks (Decision 243) ----
export const MAX_SHEETS = 800;
const isText = (r) => typeof r.text === 'string' && !r.img && !r.chart;
export function sliceRuns(runs, from, to) { // the runs between two text offsets; a line break belongs to the line it ends
  const out = []; let acc = 0;
  for (const r of runs) {
    if (isText(r)) {
      const a = Math.max(from, acc); const z = Math.min(to, acc + r.text.length);
      if (z > a) out.push(a === acc && z === acc + r.text.length ? r : { ...r, text: r.text.slice(a - acc, z - acc) });
      acc += r.text.length;
    } else if (r.br ? (acc > from || from === 0) && acc <= to : acc >= from && acc < to) out.push(r);
  }
  return out;
}
export function sliceBlock(b, from, to, more) {
  if (from === 0 && to === Infinity) return b;
  const first = from === 0; const pr = { ...b.pr };
  if (more) pr.sa = 0;
  if (!first) { pr.sb = 0; pr.first = 0; pr.pb = false; }
  return { ...b, runs: sliceRuns(b.runs, from, to), pr, list: first ? b.list : null, cont: !first || !!b.cont };
}
const keepNext = (b) => b.t !== 'table' && !!(b.pr && b.pr.kn);

// env.measure(blocks, page) -> [{ top, bottom, lh, rows? }] in one flow coordinate; env.cut(i, limit) -> { offset, bottom }:
// the most text of block i that ends above limit. Rules: space is whatever the flow measured; keep with next; keep lines together;
// widow and orphan control (two lines each side, a paragraph under four lines is not split); table rows are not split.
export function paginateAuto(model, env) {
  const secs = model.sections && model.sections.length ? model.sections : null;
  const items = []; let sec = 0; let hb = false;
  for (const b of model.blocks) {
    if (b.t === 'table') { items.push({ b, hb, sec }); hb = false; } else {
      const segs = [[]];
      for (const r of b.runs) { if (r.pb) segs.push([]); else if (!r.lrb) segs[segs.length - 1].push(r); }
      if (b.pr && b.pr.pb) hb = true;
      if (segs.length === 1) { items.push({ b, hb, sec }); hb = false; } else {
        const last = segs.reduce((m, g, i) => (g.length ? i : m), -1); let seen = false;
        segs.forEach((g, i) => {
          if (i > 0) hb = true;
          if (!g.length) return;
          const pr = { ...b.pr }; if (i < last) pr.sa = 0; if (seen) { pr.sb = 0; pr.first = 0; pr.pb = false; }
          items.push({ b: { ...b, runs: g, pr, list: seen ? null : b.list, cont: seen }, hb, sec }); hb = false; seen = true;
        });
      }
    }
    if (b.sectEnd !== undefined) sec = Math.min(sec + 1, secs ? secs.length - 1 : 0);
  }
  const pages = []; let cur = []; let startSec = 0; let usedH = 0;
  const newPage = () => { if (cur.length) { pages.push({ blocks: cur.map((e) => e.b), sec: startSec }); cur = []; } };
  for (let k = 0; k <= (secs ? secs.length - 1 : 0); k++) {
    const grp = items.filter((x) => x.sec === k);
    if (!grp.length) continue;
    const cont = k > 0 && secs && secs[k].type === 'continuous';
    if (!cont) newPage();
    const page = (secs ? secs[k] : { page: model.page }).page;
    const hc = Math.max(120, page.h - page.t - page.b);
    const m = env.measure(grp.map((x) => x.b), page);
    let pageStart = 0;
    const add = (b, gi, part) => { if (!cur.length) startSec = k; cur.push({ b, gi, part }); };
    const breakBefore = () => { // new page; trailing keep-with-next blocks of this section travel with what follows
      const carry = [];
      while (cur.length > 1 && keepNext(cur[cur.length - 1].b) && cur[cur.length - 1].gi >= 0 && !cur[cur.length - 1].part) carry.unshift(cur.pop());
      newPage();
      for (const e of carry) { cur.push(e); }
      if (carry.length) { startSec = k; pageStart = m[carry[0].gi].top; }
    };
    for (let i = 0; i < grp.length; i++) {
      const b = grp[i].b; const mi = m[i];
      if (grp[i].hb && cur.length) newPage();
      let from = 0; let top = mi.top;
      if (i === 0 && cur.length) pageStart = mi.top - usedH;
      for (let guard = 0; guard < 4000; guard++) {
        if (!cur.length) pageStart = top;
        const limit = pageStart + hc;
        if (b.t === 'table') {
          const rows = mi.rows || []; const tail = (f, t) => (f === 0 && t >= b.rows.length ? b : { ...b, rows: b.rows.slice(f, t), rowBrk: undefined });
          if (!rows.length || mi.bottom <= limit + 0.5) { add(tail(from, b.rows.length), i, false); break; }
          const merged = (r) => b.rows[r] && b.rows[r].some((c) => c.vm === 'cont');
          let e = from; while (e < rows.length && rows[e].bottom <= limit + 0.5) e++;
          while (e > from && merged(e)) e--;
          if (e === from) { if (cur.length) { breakBefore(); continue; } e = from + 1; while (merged(e)) e++; }
          add(tail(from, e), i, e < b.rows.length);
          if (e >= b.rows.length) break;
          newPage(); from = e; top = rows[e].top; continue;
        }
        if (mi.bottom <= limit + 0.5) { add(sliceBlock(b, from, Infinity, false), i, from > 0); break; }
        const lh = mi.lh || 16; const lines = Math.round((mi.bottom - top) / lh);
        const whole = cur.length && ((b.pr && b.pr.kl) || lines < 4);
        if (whole) { breakBefore(); continue; }
        let r = env.cut(i, limit);
        if (cur.length && Math.floor((r.bottom - top) / lh + 0.01) < 2) { breakBefore(); continue; }
        if (Math.round((mi.bottom - r.bottom) / lh) < 2) {
          if (Math.floor((r.bottom - top) / lh + 0.01) > 2) r = env.cut(i, limit - lh);
          else if (cur.length) { breakBefore(); continue; }
        }
        if (r.offset <= from) { if (cur.length) { breakBefore(); continue; } add(sliceBlock(b, from, Infinity, false), i, from > 0); break; }
        add(sliceBlock(b, from, r.offset, true), i, true);
        newPage(); from = r.offset; top = r.bottom;
      }
      if (pages.length > MAX_SHEETS) return null;
    }
    usedH = cur.length ? m[grp.length - 1].bottom - pageStart : 0;
  }
  newPage();
  if (!pages.length) return null;
  const n = pages.length; const stored = model.storedPages;
  return number(pages, secs, `Page breaks are estimated from the text${stored > 1 && stored !== n ? `: ${n} pages shown, ${stored} saved` : ''}. Word may place them differently.`);
}

// header or footer blocks for one sheet: first-page set, even-page set, otherwise the default
export function pickHF(model, sheet, kind) {
  const sec = model.sections[sheet.sec]; const set = sec[kind];
  if (sec.titlePg && sheet.first) return set.first || [];
  if (model.evenOdd && sheet.n % 2 === 0) return set.even || [];
  return set.default || [];
}
