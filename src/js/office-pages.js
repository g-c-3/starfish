// office-pages.js — splits a Word model into page sheets from the breaks the file already holds (Decision 242).
// Sources: saved page markers (lastRenderedPageBreak), explicit page breaks, page-break-before and section breaks.
// No measuring here: a file that holds none of these gives null and the viewer keeps one continuous sheet.

import { formatNum } from './office-read.js';

const fnRefs = (blocks, out) => { // footnote numbers referenced in these blocks, in order
  for (const b of blocks) {
    if (b.t === 'table') { for (const r of b.rows) for (const c of r) fnRefs(c.blocks, out); } else for (const r of b.runs) if (r.fn !== undefined && !out.includes(r.fn)) out.push(r.fn);
  }
  return out;
};

export function paginate(model) {
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
  const secPages = {}; for (const p of pages) secPages[p.sec] = (secPages[p.sec] || 0) + 1;
  let n = 0; let prev = -1; let inSec = 0;
  for (const p of pages) {
    const sec = secs ? secs[p.sec] : null;
    if (p.sec !== prev) { inSec = 0; prev = p.sec; if (sec && sec.pgStart !== null) n = sec.pgStart - 1; }
    n++; inSec++;
    p.n = n; p.first = inSec === 1; p.label = formatNum(n, sec && sec.pgFmt); p.secPages = secPages[p.sec]; p.fns = fnRefs(p.blocks, []);
  }
  const note = model.storedPages && model.storedPages !== pages.length
    ? `Page breaks follow the file: ${pages.length} pages shown, ${model.storedPages} saved. Fonts can move a break.` : '';
  return { sheets: pages, total: pages.length, note };
}

// header or footer blocks for one sheet: first-page set, even-page set, otherwise the default
export function pickHF(model, sheet, kind) {
  const sec = model.sections[sheet.sec]; const set = sec[kind];
  if (sec.titlePg && sheet.first) return set.first || [];
  if (model.evenOdd && sheet.n % 2 === 0) return set.even || [];
  return set.default || [];
}
