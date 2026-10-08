// pdfviewer.js — in-app PDF viewer on a bundled pdf.js (Decision 121). Loaded on first PDF open, not at startup.
// Pages are drawn lazily and released when far off screen, so memory stays bounded for long documents.
// Reading tools (Decision 153): text layer (select, copy), find in PDF, go to page, thumbnails, outline. No network:
// the document is read from bytes already on the phone. Search text, results and thumbnails live in memory only.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
import { fitScale, canvasRatio, pageAt, nextZoom, pinchZoom } from './pdfmath.js';
import { openPdfDocument } from './pdfopen.js';
import { pageItems, findInItems, normalizeQuery, stepMatch, firstHitFrom, flattenOutline, MIN_QUERY, MAX_MATCHES } from './pdfsearch.js';

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

// Loads bytes (Uint8Array, consumed) and builds the page stack inside `container`.
// askPassword(wasWrong) -> Promise<string|null> is called only for a protected PDF.
// Returns { pageCount, zoomIn, zoomOut, destroy }. onPage(n) reports the page nearest the top; onActivity() fires on scroll.
async function createPdfView(container, bytes, { onPage = () => {}, onActivity = () => {}, askPassword = async () => null } = {}) {
  ensureWorker();
  const doc = await openPdfDocument(pdfjs, bytes, askPassword);
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const aspect = base.height / base.width;

  container.innerHTML = '<div class="pdf-pages"></div>';
  const pages = container.querySelector('.pdf-pages');
  let zoom = 1, destroyed = false;
  const slots = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.n = String(n);
    pages.append(el);
    slots.push({ n, el, canvas: null, task: null, textLayer: null, layerEl: null, w: 0, h: 0, ratio: aspect });
  }

  const cssWidth = () => fitScale(container.clientWidth, base.width, zoom) * base.width;
  function sizeSlots() {
    const w = cssWidth();
    for (const s of slots) {
      s.w = Math.round(w);
      s.h = Math.round(w * s.ratio);
      s.el.style.width = `${s.w}px`;
      s.el.style.height = `${s.h}px`;
    }
  }

  function release(s) {
    if (s.task) { try { s.task.cancel(); } catch { /* already finished */ } s.task = null; }
    if (s.textLayer) { try { s.textLayer.cancel(); } catch { /* already finished */ } s.textLayer = null; }
    if (s.layerEl) { s.layerEl.remove(); s.layerEl = null; }
    if (s.canvas) { s.canvas.width = 0; s.canvas.height = 0; s.canvas.remove(); s.canvas = null; }
  }

  // ---- Text layer and find (Decision 153) ----
  const textCache = new Map(); // page number -> { strs, eols }; dropped when the search closes
  let hits = [], hitsByPage = new Map(), cur = -1, capped = false, searchToken = 0, reveal = null;

  async function getText(n) {
    let t = textCache.get(n);
    if (!t) {
      const page = n === 1 ? first : await doc.getPage(n);
      t = pageItems(await page.getTextContent());
      textCache.set(n, t);
    }
    return t;
  }
  function hitSpans(s, i) {
    const h = hits[i], divs = s.textLayer?.textDivs;
    if (!h || !divs) return [];
    return divs.slice(h.a, h.b + 1);
  }
  function applyHits(s) {
    for (const i of hitsByPage.get(s.n) || []) {
      for (const d of hitSpans(s, i)) { d.classList.add('pdf-hit'); if (i === cur) d.classList.add('pdf-hit-cur'); }
    }
    if (reveal && reveal.page === s.n) revealHit(s);
  }
  function revealHit(s) {
    const d = hitSpans(s, cur)[0];
    if (!d) return;
    reveal = null;
    const r = d.getBoundingClientRect(), c = container.getBoundingClientRect();
    container.scrollTop += (r.top + r.height / 2) - (c.top + c.height / 2);
    container.scrollLeft += (r.left + r.width / 2) - (c.left + c.width / 2);
  }
  function clearMarks() {
    for (const s of slots) s.textLayer?.textDivs?.forEach((d) => d.classList.remove('pdf-hit', 'pdf-hit-cur'));
  }
  function setCurrent(i) {
    if (cur >= 0) for (const s of slots) if (s.n === hits[cur]?.page) hitSpans(s, cur).forEach((d) => d.classList.remove('pdf-hit-cur'));
    cur = i;
    if (i < 0) return;
    const h = hits[i], s = slots[h.page - 1];
    hitSpans(s, i).forEach((d) => d.classList.add('pdf-hit-cur'));
    reveal = { page: h.page };
    if (s.textLayer?.textDivs?.length) { goToPage(h.page); revealHit(s); } else goToPage(h.page); // revealed once its text layer is drawn
  }
  function goToPage(n) {
    const s = slots[Math.min(slots.length, Math.max(1, n)) - 1];
    if (!s) return;
    container.scrollTop = Math.max(0, s.el.offsetTop - 8);
    onPage(s.n);
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function clearSearch() {
    searchToken++;
    clearMarks();
    hits = []; hitsByPage = new Map(); cur = -1; capped = false; reveal = null;
    textCache.clear();
  }
  // Finds every match, page by page. Resolves { total, capped, index, tooShort } or { cancelled: true } when a newer search or close took over.
  async function search(raw, { onProgress = () => {} } = {}) {
    clearSearch();
    const token = searchToken;
    const q = normalizeQuery(raw);
    if (q.length < MIN_QUERY) return { total: 0, capped: false, index: -1, tooShort: true };
    const found = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (destroyed || token !== searchToken) return { cancelled: true };
      const ms = findInItems(await getText(n), q, MAX_MATCHES - found.length);
      for (const m of ms) found.push({ page: n, a: m.a, b: m.b });
      if (found.length >= MAX_MATCHES) { capped = true; break; }
      if (n % 4 === 0) { onProgress({ page: n, total: found.length }); await frame(); }
    }
    if (destroyed || token !== searchToken) return { cancelled: true };
    hits = found;
    hits.forEach((h, i) => { if (!hitsByPage.has(h.page)) hitsByPage.set(h.page, []); hitsByPage.get(h.page).push(i); });
    if (hits.length) setCurrent(firstHitFrom(hits, currentPage()));
    for (const s of slots) if (s.textLayer) applyHits(s);
    return { total: hits.length, capped, index: cur };
  }
  function stepHit(dir) {
    if (!hits.length) return { total: 0, capped, index: -1 };
    setCurrent(stepMatch(cur, hits.length, dir));
    return { total: hits.length, capped, index: cur };
  }

  async function drawText(s, page, vp) {
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.style.setProperty('--scale-factor', String(vp.scale));
    const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true }), container: layer, viewport: vp });
    s.textLayer = tl; s.layerEl = layer;
    s.el.append(layer);
    try { await tl.render(); } catch { if (s.textLayer === tl) { s.textLayer = null; layer.remove(); s.layerEl = null; } return; } // the page stays readable without a text layer
    if (s.textLayer !== tl || destroyed) return;
    const end = document.createElement('div');
    end.className = 'endOfContent';
    layer.append(end);
    layer.addEventListener('touchstart', () => layer.classList.add('selecting'), { passive: true });
    layer.addEventListener('touchend', () => layer.classList.remove('selecting'), { passive: true });
    layer.addEventListener('touchcancel', () => layer.classList.remove('selecting'), { passive: true });
    applyHits(s);
  }

  let queue = Promise.resolve();
  function draw(s) {
    queue = queue.then(async () => {
      if (destroyed || s.canvas || !s.visible) return;
      try {
        const page = s.n === 1 ? first : await doc.getPage(s.n);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = fitScale(container.clientWidth, base.width, zoom);
        const vp = page.getViewport({ scale });
        const exact = vp1.height / vp1.width;
        if (Math.abs(exact - s.ratio) > 0.001) { s.ratio = exact; s.h = Math.round(s.w * exact); s.el.style.height = `${s.h}px`; }
        const ratio = canvasRatio(vp.width, vp.height, window.devicePixelRatio);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width * ratio);
        canvas.height = Math.floor(vp.height * ratio);
        s.canvas = canvas;
        s.el.append(canvas);
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
        s.task = task;
        await task.promise;
        s.task = null;
        if (destroyed || s.canvas !== canvas || !s.visible) return;
        await drawText(s, page, vp);
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') release(s); // a cancelled render was released on purpose
      }
    });
  }

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = slots[Number(e.target.dataset.n) - 1];
      s.visible = e.isIntersecting;
      if (e.isIntersecting) draw(s); else release(s);
    }
  }, { root: container, rootMargin: '100% 0px' });

  sizeSlots();
  slots.forEach((s) => observer.observe(s.el));

  let raf = 0;
  const onScroll = () => {
    onActivity();
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (destroyed) return;
      onPage(currentPage());
    });
  };
  function currentPage() {
    const tops = slots.map((s) => s.el.offsetTop), heights = slots.map((s) => s.h);
    return pageAt(tops, heights, container.scrollTop + container.clientHeight * 0.3) + 1;
  }
  container.addEventListener('scroll', onScroll, { passive: true });
  onPage(1);

  // anchor: { vx, vy } is a point inside the container (pixels) that stays under the same spot of the page; default is the centre.
  function setZoom(next, anchor = null) {
    if (next === zoom || destroyed) return;
    const vx = anchor ? anchor.vx : container.clientWidth / 2, vy = anchor ? anchor.vy : container.clientHeight / 2;
    const h = container.scrollHeight || 1, w = container.scrollWidth || 1;
    const cy = (container.scrollTop + vy) / h;
    const cx = (container.scrollLeft + vx) / w;
    zoom = next;
    slots.forEach(release);
    sizeSlots();
    container.scrollTop = cy * container.scrollHeight - vy;
    container.scrollLeft = cx * container.scrollWidth - vx;
    slots.forEach((s) => { if (s.visible) draw(s); });
    onPage(currentPage());
  }

  // Pinch to zoom (two fingers). The pages are scaled by a transform while the fingers move, then redrawn sharp at the new zoom on release.
  container.style.touchAction = 'pan-x pan-y'; // the page itself must not pinch-zoom; this handler does
  let pinch = null; // { d0, ratio, vx, vy }
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const stage = () => container.querySelector('.pdf-pages');
  function onTouchStart(e) {
    if (e.touches.length !== 2) return;
    const r = container.getBoundingClientRect();
    pinch = { d0: dist(e.touches) || 1, ratio: 1, vx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, vy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
    const el = stage();
    if (el) el.style.transformOrigin = `${container.scrollLeft + pinch.vx}px ${container.scrollTop + pinch.vy}px`;
  }
  function onTouchMove(e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    onActivity();
    pinch.ratio = pinchZoom(zoom, dist(e.touches) / pinch.d0) / zoom; // shown scale never passes the limits
    const el = stage();
    if (el) el.style.transform = `scale(${pinch.ratio})`;
  }
  function onTouchEnd(e) {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch; pinch = null;
    const el = stage();
    if (el) { el.style.transform = ''; el.style.transformOrigin = ''; }
    if (Math.abs(p.ratio - 1) > 0.03) setZoom(pinchZoom(zoom, p.ratio), { vx: p.vx, vy: p.vy });
  }
  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
  container.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return {
    pageCount: doc.numPages,
    zoomIn: () => setZoom(nextZoom(zoom, 1)),
    zoomOut: () => setZoom(nextZoom(zoom, -1)),
    goToPage,
    currentPage,
    search,
    stepHit,
    clearSearch,
    // Outline entries that point inside the document: [{ title, depth, page }]. Links to outside addresses are not followed.
    async getOutline() {
      const raw = await doc.getOutline().catch(() => null);
      const out = [];
      for (const it of flattenOutline(raw)) {
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await doc.getDestination(dest);
          if (!Array.isArray(dest)) continue;
          const ref = dest[0];
          const idx = ref && typeof ref === 'object' ? await doc.getPageIndex(ref) : (Number.isInteger(ref) ? ref : -1);
          if (idx >= 0 && idx < doc.numPages) out.push({ title: it.title, depth: it.depth, page: idx + 1 });
        } catch { /* unresolvable entry: skipped */ }
      }
      return out;
    },
    // Thumbnail buttons inside `grid`, drawn while near the visible part of `root` and released beyond it.
    attachThumbnails(grid, { root = null, width = 88, onPick = () => {} } = {}) {
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const items = [];
      let dead = false, tq = Promise.resolve();
      const drop = (t) => {
        if (t.task) { try { t.task.cancel(); } catch { /* finished */ } t.task = null; }
        if (t.canvas) { t.canvas.width = 0; t.canvas.height = 0; t.canvas.remove(); t.canvas = null; }
      };
      const paint = (t) => {
        tq = tq.then(async () => {
          if (dead || destroyed || t.canvas || !t.visible) return;
          try {
            const page = await doc.getPage(t.n);
            const v0 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: (width * ratio) / v0.width });
            t.el.style.height = `${Math.round(width * v0.height / v0.width)}px`;
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
            t.canvas = canvas; t.el.prepend(canvas);
            t.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
            await t.task.promise; t.task = null;
          } catch (err) { if (err?.name !== 'RenderingCancelledException') drop(t); }
        });
      };
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const t = items[Number(e.target.dataset.n) - 1];
          t.visible = e.isIntersecting;
          if (e.isIntersecting) paint(t); else drop(t);
        }
      }, { root, rootMargin: '50% 0px' });
      for (let n = 1; n <= doc.numPages; n++) {
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'pdf-thumb'; el.dataset.n = String(n);
        el.setAttribute('aria-label', `Page ${n}`);
        el.style.width = `${width}px`; el.style.height = `${Math.round(width * aspect)}px`;
        el.insertAdjacentHTML('beforeend', `<span class="pdf-thumb-n">${n}</span>`);
        el.onclick = () => onPick(n);
        grid.append(el);
        items.push({ n, el, canvas: null, task: null, visible: false });
        io.observe(el);
      }
      return {
        markCurrent(n) {
          items.forEach((t) => t.el.classList.toggle('current', t.n === n));
          items[n - 1]?.el.scrollIntoView({ block: 'center' });
        },
        destroy() { dead = true; io.disconnect(); items.forEach(drop); grid.innerHTML = ''; }
      };
    },
    destroy() {
      destroyed = true;
      searchToken++;
      textCache.clear();
      observer.disconnect();
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      if (raf) cancelAnimationFrame(raf);
      slots.forEach(release);
      container.innerHTML = '';
      try { doc.destroy(); } catch { /* already gone */ }
    }
  };
}

export { createPdfView };
