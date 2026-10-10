// pdfmark-ui.js — mark-up and form fill on the in-app PDF viewer (Decision 166). DOM only.
// Marks are kept in memory as fractions of the displayed page; nothing is stored until Save writes a new PDF through pdfmark.js.
// pdf-lib loads when Mark up is tapped, not when the viewer opens.

import '../css/pdfmark.css';
import { COLORS, HIGHLIGHT_COLORS, INK_COLORS, STAMPS, HIGHLIGHT_OPACITY, MAX_MARKS, TEXT_SIZE, STAMP_SIZE, PEN_WIDTH, STAMP_PAD } from './pdfmarkconst.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (name) => { const c = COLORS[name] || COLORS.black; return `rgb(${c.map((n) => Math.round(n * 255)).join(',')})`; };
const ICON_PEN = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/></svg>';
const TOOLS = [['highlight', 'Highlight'], ['text', 'Text'], ['draw', 'Draw'], ['stamp', 'Stamp']];

// ctx: { isVault, loadBytes(), save(bytes, { replace }) -> label, askText, askYesNo, askDiscard, toast, onActivity, closeViewer }
function mountMarkup(body, view, ctx) {
  const toolsEl = body.querySelector('.pdf-tools');
  const openBtn = document.createElement('button');
  openBtn.type = 'button'; openBtn.className = 'pdf-mark-btn';
  openBtn.setAttribute('aria-label', 'Mark up'); openBtn.title = 'Mark up';
  openBtn.innerHTML = ICON_PEN;
  (toolsEl || body).append(openBtn);

  let st = null;      // the open mark-up session, or null
  let starting = false, saving = false, destroyed = false;

  const dirty = () => !!st && (st.marks.length > 0 || Object.keys(st.form).length > 0);

  // ---- layers: one per page, kept for the whole session and redrawn at the page's current size ----
  function renderLayer(L) {
    const w = L.el.clientWidth, h = L.el.clientHeight;
    if (!w || !h) return;
    L.root.style.setProperty('--pw', `${w}px`);
    L.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let svg = '', html = '';
    for (const m of st.marks) {
      if (m.page !== L.n) continue;
      if (m.kind === 'highlight') svg += `<rect x="${m.x * w}" y="${m.y * h}" width="${m.w * w}" height="${m.h * h}" fill="${css(m.color)}" fill-opacity="${HIGHLIGHT_OPACITY}"/>`;
      else if (m.kind === 'draw') svg += `<polyline points="${m.pts.map((p) => `${(p[0] * w).toFixed(1)},${(p[1] * h).toFixed(1)}`).join(' ')}" fill="none" stroke="${css(m.color)}" stroke-width="${Math.max(1, m.width * w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      else if (m.kind === 'text') html += `<div class="pdf-mk-text" style="left:${m.x * 100}%;top:${m.y * 100}%;font-size:calc(var(--pw) * ${m.fs});color:${css(m.color)}">${esc(m.text)}</div>`;
      else if (m.kind === 'stamp') html += `<div class="pdf-mk-stamp" style="left:${m.x * 100}%;top:${m.y * 100}%;font-size:calc(var(--pw) * ${m.fs});color:${css(m.color)};border-color:${css(m.color)};padding:${STAMP_PAD}em">${esc(String(m.label).toUpperCase())}</div>`;
    }
    L.svg.innerHTML = svg;
    L.items.innerHTML = html;
  }
  const layerOf = (n) => st.layers[n - 1];

  function buildLayers() {
    const els = view.pageEls();
    st.layers = els.map((el, i) => {
      const root = document.createElement('div');
      root.className = 'pdf-mark-layer';
      root.innerHTML = '<svg class="pdf-mk-svg" preserveAspectRatio="none" aria-hidden="true"></svg><div class="pdf-mk-items"></div>';
      el.append(root);
      const L = { n: i + 1, el, root, svg: root.querySelector('svg'), items: root.querySelector('.pdf-mk-items') };
      L.ro = new ResizeObserver(() => renderLayer(L));
      L.ro.observe(el);
      bindLayer(L);
      return L;
    });
  }
  function dropLayers() {
    for (const L of st.layers || []) { L.ro.disconnect(); L.root.remove(); }
  }

  // ---- placing marks ----
  const point = (L, e) => {
    const r = L.el.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  function addMark(m) {
    if (st.marks.length >= MAX_MARKS) { ctx.toast(`Limit of ${MAX_MARKS} marks reached. Save, then continue on the copy.`); return false; }
    st.marks.push(m);
    renderLayer(layerOf(m.page));
    paintBar();
    return true;
  }

  function bindLayer(L) {
    let drag = null, live = null;
    const stop = () => { if (live) live.remove(); drag = null; live = null; };
    L.root.addEventListener('pointerdown', (e) => {
      if (!st || (st.tool !== 'highlight' && st.tool !== 'draw')) return;
      if (drag) { stop(); return; } // a second finger: leave the stroke, the pinch handler takes over
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ctx.onActivity();
      const p = point(L, e);
      drag = { id: e.pointerId, a: p, pts: [p] };
      L.root.setPointerCapture?.(e.pointerId);
      live = document.createElementNS('http://www.w3.org/2000/svg', st.tool === 'draw' ? 'polyline' : 'rect');
      if (st.tool === 'draw') { live.setAttribute('fill', 'none'); live.setAttribute('stroke', css(st.ink)); live.setAttribute('stroke-width', String(Math.max(1, PEN_WIDTH * L.el.clientWidth))); live.setAttribute('stroke-linecap', 'round'); live.setAttribute('stroke-linejoin', 'round'); }
      else { live.setAttribute('fill', css(st.hl)); live.setAttribute('fill-opacity', String(HIGHLIGHT_OPACITY)); }
      L.svg.append(live);
    });
    L.root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = point(L, e), w = L.el.clientWidth, h = L.el.clientHeight;
      if (st.tool === 'draw') {
        const last = drag.pts[drag.pts.length - 1];
        if (Math.hypot((p[0] - last[0]) * w, (p[1] - last[1]) * h) < 2) return;
        drag.pts.push(p);
        live.setAttribute('points', drag.pts.map((q) => `${(q[0] * w).toFixed(1)},${(q[1] * h).toFixed(1)}`).join(' '));
      } else {
        live.setAttribute('x', String(Math.min(drag.a[0], p[0]) * w)); live.setAttribute('y', String(Math.min(drag.a[1], p[1]) * h));
        live.setAttribute('width', String(Math.abs(p[0] - drag.a[0]) * w)); live.setAttribute('height', String(Math.abs(p[1] - drag.a[1]) * h));
      }
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = point(L, e), d = drag;
      stop();
      if (e.type === 'pointercancel') return;
      if (st.tool === 'draw') {
        addMark({ page: L.n, kind: 'draw', pts: d.pts.length ? d.pts : [p], width: PEN_WIDTH, color: st.ink });
      } else {
        const x = Math.min(d.a[0], p[0]), y = Math.min(d.a[1], p[1]), w = Math.abs(p[0] - d.a[0]), h = Math.abs(p[1] - d.a[1]);
        if (w * L.el.clientWidth >= 6 && h * L.el.clientHeight >= 4) addMark({ page: L.n, kind: 'highlight', x, y, w, h, color: st.hl });
      }
    };
    L.root.addEventListener('pointerup', end);
    L.root.addEventListener('pointercancel', end);
    L.root.addEventListener('click', async (e) => {
      if (!st || (st.tool !== 'text' && st.tool !== 'stamp')) return;
      ctx.onActivity();
      const [u, v] = point(L, e);
      if (st.tool === 'stamp') { addMark({ page: L.n, kind: 'stamp', x: Math.min(u, 0.8), y: Math.min(v, 0.95), label: st.stamp, fs: STAMP_SIZE, color: st.ink }); return; }
      const text = await ctx.askText({ title: 'Add text', placeholder: 'Text', ok: 'Add', isVault: ctx.isVault });
      if (text && text.trim() && st) addMark({ page: L.n, kind: 'text', x: Math.min(u, 0.95), y: Math.min(v, 0.97), text: text.trim(), fs: TEXT_SIZE, color: st.ink });
    });
  }

  // ---- bar ----
  function paintBar() {
    if (!st) return;
    const bar = st.bar;
    const palette = st.tool === 'highlight' ? HIGHLIGHT_COLORS : (st.tool === 'draw' || st.tool === 'text' || st.tool === 'stamp') ? INK_COLORS : [];
    const current = st.tool === 'highlight' ? st.hl : st.ink;
    bar.innerHTML = `<div class="pdf-mk-row">${TOOLS.map(([k, l]) => `<button type="button" data-tool="${k}" class="pdf-mk-tool${st.tool === k ? ' on' : ''}">${l}</button>`).join('')}</div>
      ${palette.length ? `<div class="pdf-mk-row pdf-mk-sub">${palette.map((c) => `<button type="button" data-color="${c}" class="pdf-mk-dot${c === current ? ' on' : ''}" style="background:${css(c)}" aria-label="${c}"></button>`).join('')}${st.tool === 'stamp' ? STAMPS.map((s) => `<button type="button" data-stamp="${s}" class="pdf-mk-chip${s === st.stamp ? ' on' : ''}">${s}</button>`).join('') : ''}</div>` : ''}
      <div class="pdf-mk-row"><button type="button" data-act="undo" ${st.marks.length ? '' : 'disabled'}>Undo</button>${st.fields.length ? `<button type="button" data-act="form">Form${Object.keys(st.form).length ? ' •' : ''}</button>` : ''}<button type="button" data-act="save" class="pdf-mk-save" ${dirty() ? '' : 'disabled'}>Save</button><button type="button" data-act="close">Close</button></div>
      ${st.tool === 'draw' || st.tool === 'highlight' ? '<div class="pdf-mk-hint">Drawing is on: tap the tool again to scroll.</div>' : st.tool === 'text' ? '<div class="pdf-mk-hint">Tap the page where the text goes.</div>' : st.tool === 'stamp' ? '<div class="pdf-mk-hint">Pick a stamp, then tap the page.</div>' : ''}`;
    for (const L of st.layers) L.root.classList.toggle('active', st.tool !== null);
    for (const L of st.layers) L.root.classList.toggle('capture', st.tool === 'highlight' || st.tool === 'draw');
  }

  async function onBar(e) {
    const b = e.target.closest('button');
    if (!b || !st || b.disabled) return;
    ctx.onActivity();
    if (b.dataset.tool) { st.tool = st.tool === b.dataset.tool ? null : b.dataset.tool; paintBar(); return; }
    if (b.dataset.color) { if (st.tool === 'highlight') st.hl = b.dataset.color; else st.ink = b.dataset.color; paintBar(); return; }
    if (b.dataset.stamp) { st.stamp = b.dataset.stamp; paintBar(); return; }
    const act = b.dataset.act;
    if (act === 'undo') { const m = st.marks.pop(); if (m) renderLayer(layerOf(m.page)); paintBar(); }
    else if (act === 'form') openForm();
    else if (act === 'save') await save();
    else if (act === 'close') await leave();
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

  // ---- start, save, leave ----
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
      st = { src: bytes, marks: [], form: {}, fields: info.fields.filter((f) => !f.readOnly), xfa: info.xfa, tool: null, hl: 'yellow', ink: 'blue', stamp: STAMPS[0], bar, layers: [], formEl: null };
      body.append(bar);
      body.classList.add('pdf-marking');
      bar.addEventListener('click', onBar);
      buildLayers();
      paintBar();
    } catch (err) {
      ctx.toast(err && err.code === 'encrypted' ? err.message : `Could not start mark-up: ${String((err && err.message) || err)}`);
    } finally { starting = false; }
  }

  function end() {
    if (!st) return;
    dropLayers();
    st.formEl?.remove();
    st.bar.remove();
    body.classList.remove('pdf-marking');
    st.src = null; st.marks = []; st.form = {};
    st = null;
  }

  // Close asks Discard when there are unsaved marks. Resolves true when the session ended.
  async function leave() {
    if (!st) return true;
    if (dirty() && !(await ctx.askDiscard())) return false;
    end();
    return true;
  }

  async function save() {
    if (!st || saving || !dirty()) return;
    if (st.formEl) closeForm();
    const choice = await ctx.askYesNo({ title: 'Save mark-up', text: 'A new copy keeps the original unchanged.', yes: 'Save new copy', no: 'Replace original', explicitNo: true });
    if (!choice || !st) return;
    const replace = choice === 'no';
    if (replace && !(await ctx.askYesNo({ title: 'Replace the original?', text: 'The original PDF is deleted for good and cannot be restored. Its date is not kept.', yes: 'Replace', no: 'Keep original' }))) return;
    if (!st) return;
    saving = true;
    ctx.toast('Saving…', true);
    try {
      const { applyMarkup } = await import('./pdfmark.js');
      const r = await applyMarkup(st.src.slice(), st.marks, st.form);
      const label = await ctx.save(r.bytes, { replace });
      const notes = [];
      if (r.textChanged) notes.push('some characters could not be drawn and became “?”');
      if (r.failedFields.length) notes.push(`${r.failedFields.length} form field${r.failedFields.length > 1 ? 's' : ''} not saved`);
      ctx.toast(replace ? `Original replaced: ${label}` : `Saved as ${label}`);
      if (notes.length) setTimeout(() => ctx.toast(`Note: ${notes.join('; ')}.`), 2500);
      end();
      if (replace) ctx.closeViewer();
    } catch (err) {
      ctx.toast(`Could not save: ${String((err && err.message) || err)}`);
    } finally { saving = false; }
  }

  openBtn.onclick = () => { if (st) { leave(); } else start(); };

  return {
    // Back: closes the form, then asks to leave mark-up. Resolves true when it handled the press.
    async closeTop() {
      if (!st) return false;
      if (st.formEl) { closeForm(); return true; }
      await leave();
      return true;
    },
    isActive: () => !!st,
    destroy() { destroyed = true; end(); openBtn.remove(); }
  };
}

export { mountMarkup };
