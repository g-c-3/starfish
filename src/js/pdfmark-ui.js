// pdfmark-ui.js — edit mode of the in-app PDF viewer: highlight, text, draw, stamp, picture, form fill (Decisions 166, 362). DOM only.
// Marks are kept in memory as fractions of the displayed page and stay there while the viewer is open, whether the edit panel is open or not;
// nothing is written until Save makes a PDF through pdfmark.js. Every mark can be selected, moved, resized, duplicated and deleted.
// pdf-lib loads when Edit is first tapped, not when the viewer opens.

import '../css/pdfmark.css';
import '../css/range.css';
import { COLORS, HIGHLIGHT_COLORS, INK_COLORS, STAMPS, STAMP_SHAPES, STAMP_MAX_LABEL, HIGHLIGHT_OPACITY, MAX_MARKS, TEXT_SIZE, STAMP_SIZE, PEN_WIDTH, FS_MIN, FS_MAX, SIGN_DEFAULT_W, SIGN_W_MIN, SIGN_W_MAX, SIGN_MIN_ALPHA, SIGN_MAX_SIDE, stampGeometry } from './pdfmarkconst.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (name) => { const c = COLORS[name] || COLORS.black; return `rgb(${c.map((n) => Math.round(n * 255)).join(',')})`; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ICON_PEN = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/></svg>';
const TOOLS = [['highlight', 'Highlight'], ['text', 'Text'], ['draw', 'Draw'], ['stamp', 'Stamp'], ['sign', 'Image']];
const TOOL_NAME = Object.fromEntries(TOOLS);
const toolOf = (kind) => kind; // a mark's kind is the name of its tool
const SEL_PAD = 5;
const MAX_UNDO = 100;

// Picture for the Picture tool (Decisions 169, 362): any picture the WebView can decode, camera orientation applied, long side limited, to PNG.
// Returns { png, ratio (height / width), url } — url is for the on-screen preview.
async function buildPicture(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
  try {
    const k = Math.min(1, SIGN_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The picture could not be converted'))), 'image/png'));
    c.width = 0; c.height = 0;
    return { png: new Uint8Array(await blob.arrayBuffer()), ratio: h / w, url: URL.createObjectURL(blob) };
  } finally { if (bmp.close) bmp.close(); }
}

// Width of a label in text sizes, as the stamp font draws it on screen.
let measureCtx = null;
function labelEm(label) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = '700 100px Helvetica, Arial, sans-serif';
  return measureCtx.measureText(label).width / 100;
}
const stampBox = (m) => stampGeometry(m.shape || 'rect', labelEm(String(m.label).toUpperCase()));

const cloneMark = (m) => ({ ...m }); // pts arrays are replaced, never changed in place, so a shallow copy is a true snapshot
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ctx: { isVault, loadBytes(), pickImage() -> bytes | null, save(bytes, { replace }) -> label, askText, askYesNo, toast, onActivity, closeViewer, saveButton }
function mountMarkup(body, view, ctx) {
  const toolsEl = body.querySelector('.pdf-tools');
  const openBtn = document.createElement('button');
  openBtn.type = 'button'; openBtn.className = 'pdf-mark-btn';
  openBtn.setAttribute('aria-label', 'Edit'); openBtn.title = 'Edit';
  openBtn.innerHTML = ICON_PEN;
  (toolsEl || body).append(openBtn);

  let st = null;      // the edit session, or null before Edit is first tapped
  let starting = false, saving = false, destroyed = false, nextId = 1;
  const saveBtn = ctx.saveButton || null;

  const dirty = () => !!st && (st.marks.length > 0 || Object.keys(st.form).length > 0);
  const markById = (id) => (st ? st.marks.find((m) => m.id === id) : null);
  const layerOf = (n) => st.layers[n - 1];
  function syncSave() {
    if (!saveBtn) return;
    const on = dirty();
    saveBtn.classList.toggle('hidden', !on);
    saveBtn.disabled = !on || saving;
  }

  // ---- history: whole-list snapshots, so move, resize, colour and delete all undo the same way ----
  const snapshot = () => st.marks.map(cloneMark);
  function pushUndo(before = null) {
    st.undo.push(before || snapshot());
    if (st.undo.length > MAX_UNDO) st.undo.shift();
    st.redo = [];
  }
  function restore(list) {
    st.marks = list;
    if (st.sel != null && !markById(st.sel)) st.sel = null;
    renderAll(); placeSel(); paintBar();
  }
  function undo() { if (!st || !st.undo.length) return; st.redo.push(snapshot()); restore(st.undo.pop()); }
  function redo() { if (!st || !st.redo.length) return; st.undo.push(snapshot()); restore(st.redo.pop()); }

  // ---- drawing the marks: one layer per page, kept for the whole session and redrawn at the page's current size ----
  function renderLayer(L) {
    const w = L.el.clientWidth, h = L.el.clientHeight;
    if (!w || !h) return;
    L.root.style.setProperty('--pw', `${w}px`);
    L.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let svg = '', html = '', any = false;
    for (const m of st.marks) {
      if (m.page !== L.n) continue;
      any = true;
      const id = `data-id="${m.id}"`;
      if (m.kind === 'highlight') svg += `<rect ${id} x="${m.x * w}" y="${m.y * h}" width="${m.w * w}" height="${m.h * h}" fill="${css(m.color)}" fill-opacity="${HIGHLIGHT_OPACITY}"/>`;
      else if (m.kind === 'draw') svg += `<polyline ${id} points="${m.pts.map((p) => `${(p[0] * w).toFixed(1)},${(p[1] * h).toFixed(1)}`).join(' ')}" fill="none" stroke="${css(m.color)}" stroke-width="${Math.max(1, m.width * w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      else if (m.kind === 'text') html += `<div ${id} class="pdf-mk-text" style="left:${m.x * 100}%;top:${m.y * 100}%;font-size:calc(var(--pw) * ${m.fs});color:${css(m.color)}">${esc(m.text)}</div>`;
      else if (m.kind === 'sign') html += `<img ${id} class="pdf-mk-sign" alt="" src="${m.url}" style="left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${((m.w * m.ratio * w) / h) * 100}%;opacity:${m.alpha == null ? 1 : m.alpha}">`;
      else if (m.kind === 'stamp') {
        const b = stampBox(m);
        const rad = b.ellipse ? '50%' : `${b.radius}em`;
        html += `<div ${id} class="pdf-mk-stamp" style="left:${m.x * 100}%;top:${m.y * 100}%;font-size:calc(var(--pw) * ${m.fs});color:${css(m.color)};width:${b.w}em;height:${b.h}em;border-width:${b.t}em;border-radius:${rad}">${esc(String(m.label).toUpperCase())}</div>`;
      }
    }
    L.svg.innerHTML = svg;
    L.items.innerHTML = html;
    L.had = any;
    if (st.sel != null && markById(st.sel)?.page === L.n) placeSel();
  }
  function renderAll() {
    for (const L of st.layers) { if (!L.had && !st.marks.some((m) => m.page === L.n)) continue; renderLayer(L); }
  }
  let rafRender = 0;
  function renderSoon(L) { if (rafRender) return; rafRender = requestAnimationFrame(() => { rafRender = 0; if (st) renderLayer(L); }); }

  function buildLayers() {
    const els = view.pageEls();
    st.layers = els.map((el, i) => {
      const root = document.createElement('div');
      root.className = 'pdf-mark-layer';
      root.innerHTML = '<svg class="pdf-mk-svg" preserveAspectRatio="none" aria-hidden="true"></svg><div class="pdf-mk-items"></div><div class="pdf-mk-sel hidden"><span class="pdf-mk-h pdf-mk-hl" data-h="l" aria-hidden="true"></span><span class="pdf-mk-h pdf-mk-ht" data-h="t" aria-hidden="true"></span><span class="pdf-mk-h pdf-mk-hb" data-h="br" aria-hidden="true"></span></div>';
      el.append(root);
      const L = { n: i + 1, el, root, svg: root.querySelector('svg'), items: root.querySelector('.pdf-mk-items'), selEl: root.querySelector('.pdf-mk-sel'), had: false };
      L.ro = new ResizeObserver(() => renderLayer(L));
      L.ro.observe(el);
      bindLayer(L);
      bindSel(L);
      return L;
    });
  }
  function dropLayers() {
    for (const L of st.layers || []) { L.ro.disconnect(); L.root.remove(); }
  }

  // ---- selection ----
  function bboxPx(L, m) {
    const node = L.root.querySelector(`[data-id="${m.id}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect(), o = L.root.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }
  function placeSel() {
    if (!st) return;
    for (const L of st.layers) L.selEl.classList.add('hidden');
    const m = st.open && st.sel != null ? markById(st.sel) : null;
    if (!m) return;
    const L = layerOf(m.page), r = bboxPx(L, m);
    if (!r) return;
    const grow = m.kind === 'draw' ? Math.max(1, m.width * L.el.clientWidth) / 2 : 0;
    const e = L.selEl.style;
    e.left = `${r.x - SEL_PAD - grow}px`; e.top = `${r.y - SEL_PAD - grow}px`;
    e.width = `${r.w + 2 * (SEL_PAD + grow)}px`; e.height = `${r.h + 2 * (SEL_PAD + grow)}px`;
    L.selEl.classList.remove('hidden');
  }
  function select(id) {
    st.sel = id;
    const m = id != null ? markById(id) : null;
    if (m) st.tool = toolOf(m.kind); // the panel follows the selected mark
    paintBar(); placeSel();
  }
  function hitTest(L, u, v) {
    const W = L.el.clientWidth, H = L.el.clientHeight, x = u * W, y = v * H;
    const top = st.marks.filter((m) => m.page === L.n).reverse();
    for (const m of [...top.filter((q) => q.kind !== 'highlight'), ...top.filter((q) => q.kind === 'highlight')]) { // highlights sit under everything else
      if (m.kind === 'draw') {
        const tol = Math.max(14, (m.width * W) / 2 + 8), p = m.pts;
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[i + 1] || a;
          if (segDist(x, y, a[0] * W, a[1] * H, b[0] * W, b[1] * H) <= tol) return m;
        }
      } else {
        const r = bboxPx(L, m);
        if (r && x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 6 && y <= r.y + r.h + 6) return m;
      }
    }
    return null;
  }

  // ---- changing a selected mark: move, scale (anchored at its top-left), colour ----
  const topLeft = (m) => (m.kind === 'draw' ? [Math.min(...m.pts.map((p) => p[0])), Math.min(...m.pts.map((p) => p[1]))] : [m.x, m.y]);
  function movedBy(base, dx, dy) {
    if (base.kind === 'draw') return { pts: base.pts.map((p) => [clamp(p[0] + dx, 0, 1), clamp(p[1] + dy, 0, 1)]) };
    return { x: clamp(base.x + dx, 0, 1), y: clamp(base.y + dy, 0, 1) };
  }
  function scaledBy(base, s) {
    if (base.kind === 'text' || base.kind === 'stamp') return { fs: clamp(base.fs * s, FS_MIN, FS_MAX) };
    if (base.kind === 'sign') return { w: clamp(base.w * s, SIGN_W_MIN, SIGN_W_MAX) };
    if (base.kind === 'highlight') return { w: Math.max(0.004, base.w * s), h: Math.max(0.003, base.h * s) };
    const [ox, oy] = topLeft(base); // draw: both axes scale by s, so the stroke keeps its shape
    return { pts: base.pts.map((p) => [ox + (p[0] - ox) * s, oy + (p[1] - oy) * s]) };
  }
  function change(m, patch) { pushUndo(); Object.assign(m, patch); renderLayer(layerOf(m.page)); paintBar(); }
  function scaleSelected(s) { const m = markById(st.sel); if (m) change(m, scaledBy(cloneMark(m), s)); }
  function duplicateSelected() {
    const m = markById(st.sel);
    if (!m || st.marks.length >= MAX_MARKS) return;
    const c = cloneMark(m); c.id = nextId++;
    Object.assign(c, movedBy(c, 0.03, 0.03));
    pushUndo(); st.marks.push(c);
    renderLayer(layerOf(c.page)); select(c.id);
  }
  function deleteSelected() {
    const m = markById(st.sel);
    if (!m) return;
    pushUndo(); st.marks = st.marks.filter((q) => q.id !== m.id); st.sel = null;
    renderLayer(layerOf(m.page)); placeSel(); paintBar();
  }
  async function editSelectedText() {
    const m = markById(st.sel);
    if (!m || (m.kind !== 'text' && m.kind !== 'stamp')) return;
    const cur = m.kind === 'text' ? m.text : m.label;
    const v = await ctx.askText({ title: m.kind === 'text' ? 'Edit text' : 'Stamp text', initial: cur, placeholder: 'Text', ok: 'Done', isVault: ctx.isVault });
    if (!st || v === null || !String(v).trim()) return;
    const t = String(v).trim();
    if (m.kind === 'text') change(m, { text: t }); else change(m, { label: t.slice(0, STAMP_MAX_LABEL) });
  }

  // ---- placing marks ----
  const point = (L, e) => {
    const r = L.el.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  };
  function addMark(m, { pick = true } = {}) {
    if (st.marks.length >= MAX_MARKS) { ctx.toast(`Limit of ${MAX_MARKS} marks reached. Save, then continue on the copy.`); return false; }
    m.id = nextId++;
    pushUndo(); st.marks.push(m);
    renderLayer(layerOf(m.page));
    if (pick) select(m.id); else { paintBar(); }
    return true;
  }
  const isCapture = () => !!st && st.open && (st.tool === 'highlight' || st.tool === 'draw');

  async function onTap(L, u, v) {
    const hit = hitTest(L, u, v);
    if (hit) { select(hit.id); return; }
    if (st.sel != null) select(null);
    const W = L.el.clientWidth, H = L.el.clientHeight;
    if (st.tool === 'text') {
      const text = await ctx.askText({ title: 'Add text', placeholder: 'Text', ok: 'Add', isVault: ctx.isVault });
      if (text && text.trim() && st) addMark({ page: L.n, kind: 'text', x: Math.min(u, 0.95), y: Math.min(v, 0.97), text: text.trim(), fs: TEXT_SIZE, color: st.ink });
    } else if (st.tool === 'stamp') {
      const b = stampGeometry(st.shape, labelEm(String(st.stamp).toUpperCase()));
      const wf = b.w * STAMP_SIZE, hf = (b.h * STAMP_SIZE * W) / H;
      addMark({ page: L.n, kind: 'stamp', x: clamp(u - wf / 2, 0, Math.max(0, 1 - wf)), y: clamp(v - hf / 2, 0, Math.max(0, 1 - hf)), label: st.stamp, shape: st.shape, fs: STAMP_SIZE, color: st.ink });
    } else if (st.tool === 'sign') {
      ctx.toast('Tap Choose Image to add an image'); // images are added only with Choose Image or Change Image (Decision 377)
    }
  }

  function bindLayer(L) {
    let g = null, live = null;
    const stop = () => { if (live) live.remove(); live = null; g = null; };
    const startLive = () => {
      live = document.createElementNS('http://www.w3.org/2000/svg', st.tool === 'draw' ? 'polyline' : 'rect');
      if (st.tool === 'draw') { live.setAttribute('fill', 'none'); live.setAttribute('stroke', css(st.ink)); live.setAttribute('stroke-width', String(Math.max(1, PEN_WIDTH * L.el.clientWidth))); live.setAttribute('stroke-linecap', 'round'); live.setAttribute('stroke-linejoin', 'round'); }
      else { live.setAttribute('fill', css(st.hl)); live.setAttribute('fill-opacity', String(HIGHLIGHT_OPACITY)); }
      L.svg.append(live);
    };
    const paintLive = (p) => {
      const w = L.el.clientWidth, h = L.el.clientHeight;
      if (st.tool === 'draw') live.setAttribute('points', g.pts.map((q) => `${(q[0] * w).toFixed(1)},${(q[1] * h).toFixed(1)}`).join(' '));
      else {
        live.setAttribute('x', String(Math.min(g.a[0], p[0]) * w)); live.setAttribute('y', String(Math.min(g.a[1], p[1]) * h));
        live.setAttribute('width', String(Math.abs(p[0] - g.a[0]) * w)); live.setAttribute('height', String(Math.abs(p[1] - g.a[1]) * h));
      }
    };
    L.root.addEventListener('pointerdown', (e) => {
      if (!st || !st.open || e.target.closest('.pdf-mk-sel')) return;
      if (g) { stop(); return; } // a second finger: leave the stroke, the pinch handler takes over
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ctx.onActivity();
      const p = point(L, e);
      g = { id: e.pointerId, a: p, pts: [p], cx: e.clientX, cy: e.clientY, moved: false };
    });
    L.root.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const p = point(L, e);
      if (st.tool === 'draw') {
        const last = g.pts[g.pts.length - 1], w = L.el.clientWidth, h = L.el.clientHeight;
        if (Math.hypot((p[0] - last[0]) * w, (p[1] - last[1]) * h) >= 2) g.pts.push(p);
      }
      if (!g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) > 8) {
        g.moved = true;
        if (isCapture()) { L.root.setPointerCapture?.(e.pointerId); startLive(); }
      }
      if (g.moved && live) paintLive(p);
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const d = g, p = point(L, e), capture = isCapture();
      stop();
      if (e.type === 'pointercancel') return;
      if (!d.moved) { onTap(L, p[0], p[1]); return; }
      if (!capture) return; // a scroll
      if (st.tool === 'draw') addMark({ page: L.n, kind: 'draw', pts: d.pts.length ? d.pts : [p], width: PEN_WIDTH, color: st.ink }, { pick: false });
      else {
        const x = Math.min(d.a[0], p[0]), y = Math.min(d.a[1], p[1]), w = Math.abs(p[0] - d.a[0]), h = Math.abs(p[1] - d.a[1]);
        if (w * L.el.clientWidth >= 6 && h * L.el.clientHeight >= 4) addMark({ page: L.n, kind: 'highlight', x, y, w, h, color: st.hl }, { pick: false });
      }
    };
    L.root.addEventListener('pointerup', end);
    L.root.addEventListener('pointercancel', end);
  }

  // Resizing from a handle. `box` is the mark's box in pixels on its page at the start of the drag; dx, dy the finger's travel in pixels.
  //   br  the corner: everything scales evenly from the top-left (a highlight by width and height).
  //   l   the left edge: stretches sideways, the right edge stays.   t   the top edge: stretches up or down, the bottom edge stays.
  // Text and stamps keep their shape (the size changes); pictures, highlights and drawings stretch.
  function resizedBy(base, handle, box, dx, dy, W, H) {
    const MIN = 8;
    if (handle === 'br') {
      if (base.kind === 'highlight') return { w: Math.max(0.004, base.w + dx / W), h: Math.max(0.003, base.h + dy / H) };
      return scaledBy(base, Math.max(0.1, ((box.w + dx) * box.w + (box.h + dy) * box.h) / (box.w * box.w + box.h * box.h)));
    }
    if (handle === 'l') {
      const nw = Math.max(MIN, box.w - dx), sx = nw / box.w, xr = box.x + box.w;
      if (base.kind === 'highlight') return { x: (xr - nw) / W, w: nw / W };
      if (base.kind === 'sign') return { x: (xr - nw) / W, w: clamp(nw / W, SIGN_W_MIN, SIGN_W_MAX), ratio: box.h / nw };
      if (base.kind === 'draw') { const xm = Math.max(...base.pts.map((p) => p[0])); return { pts: base.pts.map((p) => [xm - (xm - p[0]) * sx, p[1]]) }; }
      return { fs: clamp(base.fs * sx, FS_MIN, FS_MAX), x: clamp((xr - box.w * sx) / W, 0, 1) };
    }
    const nh = Math.max(MIN, box.h - dy), sy = nh / box.h, yb = box.y + box.h;
    if (base.kind === 'highlight') return { y: (yb - nh) / H, h: nh / H };
    if (base.kind === 'sign') return { y: (yb - nh) / H, ratio: nh / box.w };
    if (base.kind === 'draw') { const ym = Math.max(...base.pts.map((p) => p[1])); return { pts: base.pts.map((p) => [p[0], ym - (ym - p[1]) * sy]) }; }
    return { fs: clamp(base.fs * sy, FS_MIN, FS_MAX), y: clamp((yb - box.h * sy) / H, 0, 1) };
  }

  // Drag the box to move the mark; drag a handle to resize it.
  function bindSel(L) {
    const el = L.selEl;
    let g = null;
    el.addEventListener('pointerdown', (e) => {
      if (!st || !st.open) return;
      const m = markById(st.sel), r = m && bboxPx(L, m);
      if (!m || !r) return;
      e.stopPropagation(); e.preventDefault();
      ctx.onActivity();
      const h = e.target.closest('.pdf-mk-h');
      g = { id: e.pointerId, handle: h ? h.dataset.h : '', cx: e.clientX, cy: e.clientY, base: cloneMark(m), before: snapshot(), box: { x: r.x, y: r.y, w: Math.max(1, r.w), h: Math.max(1, r.h) }, moved: false };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.cx, dy = e.clientY - g.cy;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      const m = markById(st.sel);
      if (!m) return;
      const W = L.el.clientWidth, H = L.el.clientHeight;
      Object.assign(m, g.handle ? resizedBy(g.base, g.handle, g.box, dx, dy, W, H) : movedBy(g.base, dx / W, dy / H));
      renderSoon(L);
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const d = g; g = null;
      if (d.moved) { if (e.type === 'pointercancel') { const m = markById(st.sel); if (m) Object.assign(m, d.base); renderLayer(L); } else { pushUndo(d.before); paintBar(); } }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ---- the panel: tool menu, then the same space holds the chosen tool's options with Undo and Redo ----
  const dot = (c, on) => `<button type="button" data-color="${c}" class="pdf-mk-dot${on ? ' on' : ''}" style="background:${css(c)}" aria-label="${c}"></button>`;
  const chip = (attrs, label, on) => `<button type="button" ${attrs} class="pdf-mk-chip${on ? ' on' : ''}">${esc(label)}</button>`;

  function paintBar() {
    if (!st) return;
    syncSave();
    const bar = st.bar, t = st.tool;
    for (const L of st.layers) {
      L.root.classList.toggle('active', st.open);
      L.root.classList.toggle('capture', isCapture());
    }
    if (!t) {
      const form = st.fields.length ? `<button type="button" data-act="form" class="pdf-mk-tool">Form${Object.keys(st.form).length ? ' •' : ''}</button>` : '';
      bar.innerHTML = `<div class="pdf-mk-menu">
        <div class="pdf-mk-grid"><div class="pdf-mk-line">${TOOLS.slice(0, 3).map(([k, l]) => `<button type="button" data-tool="${k}" class="pdf-mk-tool">${l}</button>`).join('')}</div>
        <div class="pdf-mk-line">${TOOLS.slice(3).map(([k, l]) => `<button type="button" data-tool="${k}" class="pdf-mk-tool">${l}</button>`).join('')}${form}</div></div>
        <div class="pdf-mk-line pdf-mk-closeline"><button type="button" data-act="close" class="pdf-mk-tool pdf-mk-close">Close</button></div></div>`;
      return;
    }
    const m = st.sel != null ? markById(st.sel) : null;
    const palette = t === 'highlight' ? HIGHLIGHT_COLORS : t === 'sign' ? [] : INK_COLORS;
    const current = t === 'highlight' ? st.hl : st.ink;
    const selRow = m ? `<div class="pdf-mk-line pdf-mk-selrow"><button type="button" data-act="smaller">Smaller</button><button type="button" data-act="bigger">Bigger</button>${m.kind === 'text' || m.kind === 'stamp' ? '<button type="button" data-act="edittext">Edit text</button>' : ''}<button type="button" data-act="dup">Duplicate</button><button type="button" data-act="del" class="pdf-mk-del">Delete</button></div>` : '';
    let opts = '';
    if (t === 'stamp') {
      opts += `<div class="pdf-mk-cols pdf-mk-c4">${STAMP_SHAPES.map(([k, l]) => chip(`data-shape="${k}"`, l, k === st.shape)).join('')}</div>`;
      opts += `<div class="pdf-mk-cols pdf-mk-c3">${STAMPS.map((s) => chip(`data-stamp="${esc(s)}"`, s, s === st.stamp)).join('')}${chip('data-act="custom"', STAMPS.includes(st.stamp) ? 'Custom text…' : `“${st.stamp}”`, !STAMPS.includes(st.stamp))}</div>`;
    }
    if (palette.length) opts += `<div class="pdf-mk-line pdf-mk-dots">${palette.map((c) => dot(c, c === current)).join('')}</div>`;
    if (t === 'sign') {
      const a = Math.round((m && m.kind === 'sign' ? (m.alpha == null ? 1 : m.alpha) : st.alpha) * 100), lo = Math.round(SIGN_MIN_ALPHA * 100);
      opts += `<div class="pdf-mk-line">${chip('data-act="pick"', m && m.kind === 'sign' ? 'Change Image' : 'Choose Image', false)}</div>
        <label class="pdf-mk-opacity"><span>Opacity <b>${a}%</b></span><input type="range" class="ark-range" style="--v:${(a - lo) / (100 - lo)}" min="${lo}" max="100" step="5" value="${a}" aria-label="Image opacity"></label>`;
    }
    bar.innerHTML = `<div class="pdf-mk-head"><button type="button" data-act="back" class="pdf-mk-back">‹ Tools</button><strong>${TOOL_NAME[t]}</strong><span class="pdf-mk-gap"></span>
        <button type="button" data-act="undo" ${st.undo.length ? '' : 'disabled'}>Undo</button><button type="button" data-act="redo" ${st.redo.length ? '' : 'disabled'}>Redo</button><button type="button" data-act="close" class="pdf-mk-x" aria-label="Close">✕</button></div>
      <div class="pdf-mk-opts">${selRow}${opts}${m ? '<div class="pdf-mk-hint">Drag to move, drag a handle to resize.</div>' : ''}</div>`;
    const range = bar.querySelector('input[type="range"]');
    if (range) {
      let first = true;
      range.addEventListener('input', () => {
        ctx.onActivity();
        const a = Number(range.value) / 100, sm = markById(st.sel);
        st.alpha = a;
        bar.querySelector('.pdf-mk-opacity b').textContent = `${range.value}%`;
        range.style.setProperty('--v', String((Number(range.value) - Math.round(SIGN_MIN_ALPHA * 100)) / (100 - Math.round(SIGN_MIN_ALPHA * 100))));
        if (sm && sm.kind === 'sign') { if (first) { pushUndo(); first = false; } sm.alpha = a; renderSoon(layerOf(sm.page)); }
      });
      range.addEventListener('change', () => { first = true; });
    }
  }

  function applyColor(c) {
    const m = st.sel != null ? markById(st.sel) : null;
    if (st.tool === 'highlight') st.hl = c; else st.ink = c;
    if (m && m.kind !== 'sign' && (m.kind === 'highlight') === (st.tool === 'highlight')) change(m, { color: c }); else paintBar();
  }
  function applyStamp(patch) {
    Object.assign(st, patch.def);
    const m = st.sel != null ? markById(st.sel) : null;
    if (m && m.kind === 'stamp') change(m, patch.mark); else paintBar();
  }

  async function onBar(e) {
    const b = e.target.closest('button');
    if (!b || !st || b.disabled) return;
    ctx.onActivity();
    if (b.dataset.tool) { st.tool = b.dataset.tool; st.sel = null; paintBar(); placeSel(); return; }
    if (b.dataset.color) { applyColor(b.dataset.color); return; }
    if (b.dataset.shape) { applyStamp({ def: { shape: b.dataset.shape }, mark: { shape: b.dataset.shape } }); return; }
    if (b.dataset.stamp) { applyStamp({ def: { stamp: b.dataset.stamp }, mark: { label: b.dataset.stamp } }); return; }
    const act = b.dataset.act;
    if (act === 'back') { st.tool = null; st.sel = null; paintBar(); placeSel(); }
    else if (act === 'close') setOpen(false);
    else if (act === 'undo') undo();
    else if (act === 'redo') redo();
    else if (act === 'form') openForm();
    else if (act === 'pick') choosePicture();
    else if (act === 'smaller') scaleSelected(1 / 1.15);
    else if (act === 'bigger') scaleSelected(1.15);
    else if (act === 'dup') duplicateSelected();
    else if (act === 'del') deleteSelected();
    else if (act === 'edittext') await editSelectedText();
    else if (act === 'custom') {
      const v = await ctx.askText({ title: 'Stamp text', initial: STAMPS.includes(st.stamp) ? '' : st.stamp, placeholder: 'Text on the stamp', ok: 'Use', isVault: ctx.isVault });
      if (st && v !== null && String(v).trim()) { const t = String(v).trim().slice(0, STAMP_MAX_LABEL); applyStamp({ def: { stamp: t }, mark: { label: t } }); }
    }
  }

  // ---- form fill ----
  function openForm() {
    if (st.formEl) return;
    const el = document.createElement('div');
    el.className = 'pdf-mk-form';
    const rows = st.fields.map((f, i) => {
      const cur = Object.prototype.hasOwnProperty.call(st.form, f.name) ? st.form[f.name] : f.value;
      const id = `pdf-mk-f${i}`, dis = f.readOnly ? ' disabled' : '';
      let input;
      if (f.kind === 'check') input = `<input id="${id}" type="checkbox" data-i="${i}"${cur ? ' checked' : ''}${dis}>`;
      else if (f.kind === 'text') input = f.multiline ? `<textarea id="${id}" data-i="${i}" rows="3" autocomplete="off"${dis}>${esc(cur)}</textarea>` : `<input id="${id}" type="text" data-i="${i}" autocomplete="off" value="${esc(cur)}"${dis}>`;
      else input = `<select id="${id}" data-i="${i}"${dis}><option value=""></option>${f.options.map((o) => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      return `<label class="pdf-mk-field" for="${id}"><span>${esc(f.name)}</span>${input}</label>`;
    }).join('');
    el.innerHTML = `<div class="pdf-mk-form-head"><strong>Form fields</strong><button type="button" class="pdf-mk-form-done">Done</button></div>${st.xfa ? '<div class="pdf-mk-hint">This form uses a format that is not supported here. Only its standard fields are listed.</div>' : ''}<div class="pdf-mk-form-body">${rows}</div>`;
    body.append(el);
    st.formEl = el;
    el.querySelector('.pdf-mk-form-done').onclick = closeForm;
  }
  function closeForm() {
    if (!st || !st.formEl) return false;
    st.fields.forEach((f, i) => {
      if (f.readOnly) return;
      const inp = st.formEl.querySelector(`[data-i="${i}"]`);
      if (!inp) return;
      const val = f.kind === 'check' ? inp.checked : inp.value;
      if (val === f.value || (val === '' && !f.value)) delete st.form[f.name]; else st.form[f.name] = val;
    });
    st.formEl.remove(); st.formEl = null;
    paintBar();
    return true;
  }

  // ---- Image tool (Decision 377): Choose Image adds a new image in the middle of the visible page; with an image selected, Change Image
  // replaces that one. Picked with the phone's picker, kept in memory only. Tapping the page never adds an image. ----
  function visibleSpot() {
    const y = window.innerHeight * 0.4;
    for (const L of st.layers) {
      const r = L.el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return { L, v: clamp((y - r.top) / r.height, 0.15, 0.85) };
    }
    return { L: st.layers[0], v: 0.4 };
  }
  async function choosePicture() {
    if (!st) return;
    const bytes = await ctx.pickImage();
    if (!bytes || !st) return;
    let sig;
    try { sig = await buildPicture(bytes); } catch (err) { ctx.toast(`Could not use that image: ${String((err && err.message) || err)}`); return; }
    if (!st) { URL.revokeObjectURL(sig.url); return; }
    st.urls.push(sig.url); // earlier placements keep the image they were made with
    const m = st.sel != null ? markById(st.sel) : null;
    if (m && m.kind === 'sign') { change(m, { png: sig.png, url: sig.url, ratio: sig.ratio }); return; }
    const { L, v } = visibleSpot(), W = L.el.clientWidth, H = L.el.clientHeight || 1;
    const w = SIGN_DEFAULT_W, hf = (w * sig.ratio * W) / H;
    addMark({ page: L.n, kind: 'sign', x: (1 - w) / 2, y: clamp(v - hf / 2, 0, Math.max(0, 1 - hf)), w, ratio: sig.ratio, png: sig.png, url: sig.url, alpha: st.alpha });
  }

  // ---- start, open and close the panel, save, leave ----
  function setOpen(v) {
    if (!st || st.open === v) return;
    if (!v && st.formEl) closeForm();
    st.open = v;
    if (v) { st.tool = null; st.sel = null; }
    else st.sel = null;
    body.classList.toggle('pdf-marking', v);
    st.bar.classList.toggle('open', v);
    paintBar(); placeSel();
  }

  async function start() {
    if (st || starting || destroyed) return;
    starting = true;
    ctx.onActivity();
    try {
      const bytes = await ctx.loadBytes();
      const { inspectPdf } = await import('./pdfmark.js');
      const info = await inspectPdf(bytes.slice());
      if (destroyed) return;
      const bar = document.createElement('div');
      bar.className = 'pdf-markbar';
      st = { src: bytes, marks: [], undo: [], redo: [], sel: null, open: false, form: {}, fields: info.fields.filter((f) => !f.readOnly), xfa: info.xfa, tool: null, hl: 'yellow', ink: 'blue', stamp: STAMPS[0], shape: 'rect', alpha: 1, bar, layers: [], formEl: null, sig: null, urls: [] };
      body.append(bar);
      bar.addEventListener('click', onBar);
      buildLayers();
      void bar.offsetWidth; // so the panel slides in from its resting place
      setOpen(true);
    } catch (err) {
      ctx.toast(err && err.code === 'encrypted' ? err.message : `Could not start editing: ${String((err && err.message) || err)}`);
    } finally { starting = false; }
  }

  function end() {
    if (!st) return;
    if (rafRender) { cancelAnimationFrame(rafRender); rafRender = 0; }
    dropLayers();
    st.formEl?.remove();
    st.bar.remove();
    body.classList.remove('pdf-marking');
    for (const u of st.urls) URL.revokeObjectURL(u);
    st.src = null; st.marks = []; st.undo = []; st.redo = []; st.form = {}; st.sig = null; st.urls = [];
    st = null;
    syncSave();
  }

  // Resolves true when the edits were written (and the session ended), false when the person backed out or it failed.
  let lastReplaced = false;
  async function save() {
    if (!st || saving || !dirty()) return false;
    if (st.formEl) closeForm();
    const choice = await ctx.askYesNo({ title: 'Save your edits', text: 'Keep the original as it is, or put the edits into it.', yes: 'Save to this PDF', extra: 'Save as a copy', no: 'Cancel' });
    if (!choice || !st) return false;
    const replace = choice === true;
    if (replace && !(await ctx.askYesNo({ title: 'Save to this PDF?', text: 'The edits replace the original PDF, which cannot be restored. Its date is not kept.', yes: 'Save to this PDF', no: 'Cancel' }))) return false;
    if (!st) return false;
    saving = true; syncSave();
    ctx.toast('Saving…', true);
    try {
      const { applyMarkup } = await import('./pdfmark.js');
      const r = await applyMarkup(st.src.slice(), st.marks, st.form);
      const label = await ctx.save(r.bytes, { replace });
      const notes = [];
      if (r.textChanged) notes.push('some characters could not be drawn and became “?”');
      if (r.failedFields.length) notes.push(`${r.failedFields.length} form field${r.failedFields.length > 1 ? 's' : ''} not saved`);
      ctx.toast(replace ? `Saved to ${label}` : `Saved as ${label}`);
      if (notes.length) setTimeout(() => ctx.toast(`Note: ${notes.join('; ')}.`), 2500);
      lastReplaced = replace;
      saving = false;
      end();
      if (replace) ctx.closeViewer();
      return true;
    } catch (err) {
      ctx.toast(`Could not save: ${String((err && err.message) || err)}`);
      return false;
    } finally { saving = false; syncSave(); }
  }

  // Back with unsaved edits. Resolves true when Back must stay, false when the viewer may close.
  async function leavePrompt() {
    const c = await ctx.askYesNo({ title: 'Save your edits?', text: 'They are not in the PDF yet.', yes: 'Discard edits', extra: 'Save…', no: 'Keep editing' });
    if (c === true) { end(); return false; }
    if (c !== 'extra') return true;
    lastReplaced = false;
    const ok = await save();
    return lastReplaced ? true : !ok; // after Save to this PDF the viewer is already closed
  }

  // A tap on the page while the panel is closed: a mark under the finger is selected (the panel opens on it); otherwise the tap folds the tools.
  const onPageTap = (e) => {
    if (!st || st.open || !st.marks.length) return;
    const { x, y } = e.detail;
    for (const L of st.layers) {
      const r = L.el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const hit = hitTest(L, (x - r.left) / r.width, (y - r.top) / r.height);
      if (hit) { e.preventDefault(); setOpen(true); select(hit.id); }
      return;
    }
  };
  body.addEventListener('arkly-pdf-tap', onPageTap);
  openBtn.onclick = () => { if (st) setOpen(!st.open); else start(); };
  if (saveBtn) saveBtn.onclick = () => { ctx.onActivity(); save(); };

  return {
    // Back: closes the form, then the panel (the edits stay), then asks about unsaved edits. Resolves true when it handled the press.
    async closeTop() {
      if (!st) return false;
      if (st.formEl) { closeForm(); return true; }
      if (st.open) { setOpen(false); return true; }
      if (dirty()) return leavePrompt();
      return false;
    },
    isActive: () => !!st && st.open,
    destroy() { destroyed = true; body.removeEventListener('arkly-pdf-tap', onPageTap); end(); openBtn.remove(); if (saveBtn) { saveBtn.onclick = null; saveBtn.classList.add('hidden'); } }
  };
}

export { mountMarkup };
