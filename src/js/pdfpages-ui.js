// pdfpages-ui.js — page tools on the in-app PDF viewer (Decision 167): rotate, delete, reorder, extract, split. DOM only.
// The edit lives in memory as a list of pages (source page + quarter turns); nothing is stored until a button writes a new PDF through pdfpages.js.
// Output is always a new copy. pdf-lib loads when Pages edit is tapped, not when the viewer opens.

import '../css/pdfpages.css';

const MAX_PARTS = 20;
const ICON_PAGES = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="11" height="12" rx="1.5"/><path d="M9 4h9a2 2 0 0 1 2 2v10"/></svg>';

// ctx: { isVault, loadBytes(), save(bytes, { suffix }) -> label, askText, askDiscard, toast, onActivity }
function mountPageTools(body, view, ctx) {
  const toolsEl = body.querySelector('.pdf-tools');
  const openBtn = document.createElement('button');
  openBtn.type = 'button'; openBtn.className = 'pdf-pg-btn';
  openBtn.setAttribute('aria-label', 'Edit pages'); openBtn.title = 'Edit pages';
  openBtn.innerHTML = ICON_PAGES;
  (toolsEl || body).append(openBtn);

  let st = null;
  let starting = false, busy = false, destroyed = false;

  const changed = () => !!st && (st.plan.length !== st.all.length || st.plan.some((p, i) => p !== st.all[i] || p.turn !== 0));
  const selected = () => st.plan.filter((p) => p.sel);
  const spec = (items) => items.map((p) => ({ src: p.src, turn: p.turn }));

  function layout() {
    if (!st) return;
    st.grid.replaceChildren(...st.plan.map((p) => p.card)); // moves the cards, so the thumbnails and their drawing stay
    st.plan.forEach((p, i) => {
      p.card.classList.toggle('sel', !!p.sel);
      p.thumb.style.setProperty('--r', `${p.turn * 90}deg`);
      p.thumb.style.setProperty('--s', String(Math.min(1, 124 / Math.max(p.thumb.offsetWidth || 88, p.thumb.offsetHeight || 124))));
      p.card.querySelector('.pdf-pg-pos').textContent = String(i + 1);
      p.card.querySelector('[data-act="left"]').disabled = i === 0;
      p.card.querySelector('[data-act="right"]').disabled = i === st.plan.length - 1;
    });
    const n = selected().length;
    st.countEl.textContent = `${st.plan.length} of ${st.all.length} pages`;
    st.foot.querySelector('[data-act="save"]').disabled = !changed() || busy;
    const ex = st.foot.querySelector('[data-act="extract"]');
    ex.disabled = !n || busy; ex.textContent = n ? `Extract (${n})` : 'Extract';
    st.foot.querySelector('[data-act="split"]').disabled = busy;
    st.foot.querySelector('[data-act="reset"]').disabled = !changed() && !n;
  }

  function onCard(p, act) {
    ctx.onActivity();
    const i = st.plan.indexOf(p);
    if (act === 'rot-l') p.turn = (p.turn + 3) % 4;
    else if (act === 'rot-r') p.turn = (p.turn + 1) % 4;
    else if (act === 'left' && i > 0) [st.plan[i - 1], st.plan[i]] = [st.plan[i], st.plan[i - 1]];
    else if (act === 'right' && i < st.plan.length - 1) [st.plan[i + 1], st.plan[i]] = [st.plan[i], st.plan[i + 1]];
    else if (act === 'del') {
      if (st.plan.length <= 1) { ctx.toast('At least one page must stay.'); return; }
      st.plan.splice(i, 1); p.sel = false;
    }
    layout();
  }

  // Writes pages as a new PDF and saves it. Returns the label, or null on failure.
  async function produce(items, suffix) {
    busy = true; layout();
    try {
      const bytes = await ctx.loadBytes();
      const { applyPagePlan } = await import('./pdfpages.js');
      const r = await applyPagePlan(bytes, spec(items));
      return await ctx.save(r.bytes, { suffix });
    } catch (err) {
      ctx.toast(err && err.code === 'encrypted' ? err.message : `Could not save: ${String((err && err.message) || err)}`);
      return null;
    } finally { busy = false; layout(); }
  }

  async function onFoot(e) {
    const b = e.target.closest('button');
    if (!b || !st || b.disabled || busy) return;
    ctx.onActivity();
    const act = b.dataset.act;
    if (act === 'close') { await leave(); return; }
    if (act === 'reset') { st.all.forEach((p) => { p.turn = 0; p.sel = false; }); st.plan = st.all.slice(); layout(); return; }
    if (act === 'save') {
      ctx.toast('Saving…', true);
      const label = await produce(st.plan, 'edited');
      if (label) { ctx.toast(`Saved as ${label}`); end(); }
    } else if (act === 'extract') {
      const items = selected();
      ctx.toast('Saving…', true);
      const label = await produce(items, items.length === 1 ? `page ${st.plan.indexOf(items[0]) + 1}` : 'extract');
      if (label) ctx.toast(`Saved as ${label}`);
    } else if (act === 'split') {
      const { parseRanges } = await import('./pdfpages.js');
      const text = await ctx.askText({ title: 'Split pages', text: `Page ranges of the ${st.plan.length} pages shown, in the order shown. Each range becomes its own PDF.`, placeholder: '1-3, 4-6', ok: 'Split', isVault: ctx.isVault });
      if (!text || !st) return;
      const r = parseRanges(text, st.plan.length);
      if (r.error) { ctx.toast(r.error); return; }
      if (r.ranges.length > MAX_PARTS) { ctx.toast(`At most ${MAX_PARTS} parts at a time.`); return; }
      const parts = st.plan.slice();
      let done = 0;
      for (const [from, to] of r.ranges) {
        if (!st) return;
        ctx.toast(`Saving part ${done + 1} of ${r.ranges.length}…`, true);
        if (!(await produce(parts.slice(from - 1, to), `pages ${from}-${to}`))) break;
        done++;
      }
      if (done === r.ranges.length) ctx.toast(`Saved ${done} PDF${done > 1 ? 's' : ''}.`);
      else if (done) ctx.toast(`Saved ${done} of ${r.ranges.length}.`);
    }
  }

  async function start() {
    if (st || starting || destroyed) return;
    starting = true;
    ctx.onActivity();
    try {
      const bytes = await ctx.loadBytes();
      const { inspectPages } = await import('./pdfpages.js');
      const info = await inspectPages(bytes);
      if (destroyed) return;
      const el = document.createElement('div');
      el.className = 'pdf-pg-ed';
      el.innerHTML = `<div class="pdf-pg-head"><strong>Edit pages</strong><span class="pdf-pg-count"></span><button type="button" data-act="close">Close</button></div>
        <div class="pdf-pg-body"><div class="pdf-pg-hint">Tap a page to select it. Saving always makes a new copy.</div><div class="pdf-pg-hold"></div><div class="pdf-pg-grid"></div></div>
        <div class="pdf-pg-foot"><button type="button" data-act="save" class="pdf-pg-save">Save copy</button><button type="button" data-act="extract">Extract</button><button type="button" data-act="split">Split</button><button type="button" data-act="reset">Reset</button></div>`;
      body.append(el);
      const bodyEl = el.querySelector('.pdf-pg-body'), hold = el.querySelector('.pdf-pg-hold'), grid = el.querySelector('.pdf-pg-grid');
      st = { el, grid, foot: el.querySelector('.pdf-pg-foot'), countEl: el.querySelector('.pdf-pg-count'), all: [], plan: [], thumbs: null };
      const pick = (n) => { const p = st && st.all[n - 1]; if (p) { p.sel = !p.sel; layout(); } };
      st.thumbs = view.attachThumbnails(hold, { root: bodyEl, width: 88, onPick: pick });
      const thumbs = Array.from(hold.children);
      for (let i = 0; i < info.pages; i++) {
        const card = document.createElement('div');
        card.className = 'pdf-pg';
        card.innerHTML = `<div class="pdf-pg-stage"></div><div class="pdf-pg-pos"></div>
          <div class="pdf-pg-ctl"><button type="button" data-act="rot-l" aria-label="Rotate left">↺</button><button type="button" data-act="rot-r" aria-label="Rotate right">↻</button>
          <button type="button" data-act="left" aria-label="Move earlier">‹</button><button type="button" data-act="right" aria-label="Move later">›</button><button type="button" data-act="del" aria-label="Delete page">✕</button></div>`;
        const thumb = thumbs[i];
        card.querySelector('.pdf-pg-stage').append(thumb);
        const p = { src: i, turn: 0, sel: false, card, thumb };
        card.querySelector('.pdf-pg-ctl').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled && st && !busy) onCard(p, b.dataset.act); });
        st.all.push(p);
      }
      st.plan = st.all.slice();
      st.foot.addEventListener('click', onFoot);
      el.querySelector('[data-act="close"]').addEventListener('click', onFoot);
      layout();
    } catch (err) {
      ctx.toast(err && err.code === 'encrypted' ? err.message : `Could not open page tools: ${String((err && err.message) || err)}`);
    } finally { starting = false; }
  }

  function end() {
    if (!st) return;
    if (st.thumbs) st.thumbs.destroy();
    st.el.remove();
    st = null;
  }

  // Close asks Discard when there are unsaved edits. Resolves true when the editor closed.
  async function leave() {
    if (!st) return true;
    if (changed() && !(await ctx.askDiscard())) return false;
    end();
    return true;
  }

  openBtn.onclick = () => { if (st) leave(); else start(); };

  return {
    async closeTop() { if (!st) return false; await leave(); return true; },
    isActive: () => !!st,
    destroy() { destroyed = true; end(); openBtn.remove(); }
  };
}

export { mountPageTools };
