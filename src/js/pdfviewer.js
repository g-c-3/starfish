// pdfviewer.js — in-app PDF viewer on a bundled pdf.js (Decision 121). Loaded on first PDF open, not at startup.
// Pages are drawn lazily and released when far off screen, so memory stays bounded for long documents.
// No text layer, no search, no network: the document is read from bytes already on the phone.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
import { fitScale, canvasRatio, pageAt, nextZoom } from './pdfmath.js';
import { openPdfDocument } from './pdfopen.js';

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
    slots.push({ n, el, canvas: null, task: null, w: 0, h: 0, ratio: aspect });
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
    if (s.canvas) { s.canvas.width = 0; s.canvas.height = 0; s.canvas.remove(); s.canvas = null; }
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

  function setZoom(next) {
    if (next === zoom || destroyed) return;
    const h = container.scrollHeight || 1, w = container.scrollWidth || 1;
    const cy = (container.scrollTop + container.clientHeight / 2) / h;
    const cx = (container.scrollLeft + container.clientWidth / 2) / w;
    zoom = next;
    slots.forEach(release);
    sizeSlots();
    container.scrollTop = cy * container.scrollHeight - container.clientHeight / 2;
    container.scrollLeft = cx * container.scrollWidth - container.clientWidth / 2;
    slots.forEach((s) => { if (s.visible) draw(s); });
    onPage(currentPage());
  }

  return {
    pageCount: doc.numPages,
    zoomIn: () => setZoom(nextZoom(zoom, 1)),
    zoomOut: () => setZoom(nextZoom(zoom, -1)),
    destroy() {
      destroyed = true;
      observer.disconnect();
      container.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      slots.forEach(release);
      container.innerHTML = '';
      try { doc.destroy(); } catch { /* already gone */ }
    }
  };
}

export { createPdfView };
