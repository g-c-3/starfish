// floatdock.js — floating progress cards at the top of the screen (Decision 449): one line while a file is being saved, a dashboard with
// Pause, Cancel and Minimise for a compress or an extract (it shrinks to one line and the app stays usable), and an opening card for a big
// file that is still loading. Only transform and opacity animate; a card fades and slides in and out like the toast (Decision 289).
const SHOW_AFTER_MS = 500; // a save or an open that ends sooner never shows a card
const OPEN_MAX = 2; // opening cards at once (loading or waiting for Open)

let root = null, say = () => {};
export const setDockToast = (fn) => { say = fn; };

const mount = () => {
  if (root && root.isConnected) return root;
  root = document.createElement('div'); root.id = 'float-dock'; root.setAttribute('aria-live', 'polite');
  document.body.appendChild(root); return root;
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (cls, text, label, fn) => { const b = el('button', `fd-btn ${cls}`, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.onclick = fn; return b; };
const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = { min: svg('<path d="M5 12h14"/>'), max: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'), x: svg('<path d="M6 6l12 12M18 6L6 18"/>') };

const addCard = (cls) => {
  const c = el('div', `fd-card ${cls}`); mount().appendChild(c);
  void c.offsetWidth; c.classList.add('in'); return c;
};
const dropCard = (c) => {
  if (!c || !c.isConnected) return;
  c.classList.remove('in'); setTimeout(() => c.remove(), 230);
};
const bar = () => {
  const wrap = el('div', 'fd-bar'), fill = el('i', 'fd-fill'); wrap.appendChild(fill);
  return { el: wrap, set(p) { // p: 0..1, or null when the total is not known (a full, dimmed bar)
    wrap.classList.toggle('ind', p == null);
    fill.style.transform = `scaleX(${p == null ? 1 : Math.max(0, Math.min(1, p))})`;
  } };
};
export const sizeText = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const pair = (a, b) => (b >= 1073741824 ? `${(a / 1073741824).toFixed(2)} / ${(b / 1073741824).toFixed(2)} GB` : `${Math.round(a / 1048576)} / ${Math.round(b / 1048576)} MB`);

// ---- Saving: one line, "123 MB / 396 MB", the bar, Cancel at the right end. add(n) counts bytes; check cancelled between pieces.
export function trackSave({ total = 0 } = {}) {
  let done = 0, cancelled = false, closed = false, card = null, onCancel = null, sizes = null, b = null, cancelBtn = null;
  const paint = () => { if (!card) return; if (!cancelled) sizes.textContent = total ? pair(done, total) : sizeText(done); b.set(total ? done / total : null); };
  const timer = setTimeout(() => {
    if (closed) return;
    card = addCard('fd-save'); sizes = el('span', 'fd-size'); b = bar();
    cancelBtn = btn('fd-cancel', 'Cancel', 'Cancel saving', () => { cancelled = true; cancelBtn.disabled = true; sizes.textContent = 'Cancelling…'; onCancel?.(); });
    card.append(sizes, b.el, cancelBtn); paint();
  }, SHOW_AFTER_MS);
  return {
    add(n) { done += n; paint(); },
    get cancelled() { return cancelled; },
    onCancel(fn) { onCancel = fn; },
    end() { closed = true; clearTimeout(timer); dropCard(card); card = null; },
  };
}

// ---- Compress / extract: a dashboard that shrinks to one line. update({ pct, size, detail, paused }).
export function trackJob({ title, onPause, onResume, onCancel, onMinimise } = {}) {
  const card = addCard('fd-job');
  const ic = el('span', 'fd-ic'); ic.innerHTML = svg('<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>');
  const t = el('b', 'fd-title', title), pct = el('span', 'fd-pct', ''), sub = el('div', 'fd-sub', 'Starting…');
  const sizes = el('span', 'fd-size'), short = el('span', 'fd-short'), b = bar(), row = el('div', 'fd-row'); row.append(sizes, b.el);
  let paused = false, minimised = false, cancelling = false;
  const mini = btn('fd-mini', '', 'Minimise', () => { minimised = !minimised; card.classList.toggle('min', minimised); mini.innerHTML = minimised ? ICON.max : ICON.min; mini.setAttribute('aria-label', minimised ? 'Expand' : 'Minimise'); if (minimised) onMinimise?.(); });
  mini.innerHTML = ICON.min;
  const pauseBtn = btn('fd-pause', 'Pause', 'Pause', () => { paused = !paused; paint(); (paused ? onPause : onResume)?.(); });
  const cancelBtn = btn('fd-cancel', 'Cancel', 'Cancel', () => { cancelling = true; cancelBtn.disabled = pauseBtn.disabled = true; sub.textContent = 'Cancelling…'; onCancel?.(); });
  const btns = el('div', 'fd-btns'); btns.append(pauseBtn, cancelBtn);
  const top = el('div', 'fd-top'); top.append(ic, t, short, pct, mini);
  card.append(top, sub, row, btns);
  const paint = () => { pauseBtn.textContent = paused ? 'Resume' : 'Pause'; pauseBtn.setAttribute('aria-label', pauseBtn.textContent); card.classList.toggle('paused', paused); t.textContent = paused ? `${title} · paused` : title; };
  return {
    update({ pct: p = null, size = '', short: sh = '', detail = '', paused: ps } = {}) { // short: what the one-line version shows
      if (ps != null && ps !== paused) { paused = ps; paint(); }
      b.set(p); pct.textContent = p == null ? '' : `${Math.round(p * 100)}%`; sizes.textContent = size; short.textContent = sh;
      if (!cancelling) sub.textContent = detail;
    },
    get minimised() { return minimised; },
    close() { dropCard(card); },
  };
}

// ---- Opening a big file: load first, then open. Card after 0.5 s: name, bar, Cancel. When loaded: the same place -> opens by itself;
// another place -> the card turns to Open. At most two cards; a third asks to close one first.
// start: { name, here() -> place key, load(ctl) -> result, show(result), discard(result) }; resolves when it ended or was dropped.
const opens = new Set();
export function startOpen({ name, here, load, show, discard = () => {} }) {
  if (opens.size >= OPEN_MAX) { say('Close a previous job or file progress to open this.'); return Promise.resolve('busy'); }
  const job = { cancelled: false }; opens.add(job);
  const place = here();
  let card = null, label = null, b = null, pct = null, ready = null;
  const x = () => btn('fd-x', '', 'Close', () => { job.cancelled = true; end(); if (ready) { discard(ready.result); ready.resolve('cancelled'); } });
  const build = () => {
    if (card || !opens.has(job)) return;
    card = addCard('fd-open'); label = el('span', 'fd-name', `Opening ${name}`); b = bar(); pct = el('span', 'fd-pct', '');
    const closeBtn = x(); closeBtn.innerHTML = ICON.x; card.append(label, b.el, pct, closeBtn); b.set(0);
  };
  const end = () => { opens.delete(job); clearTimeout(timer); dropCard(card); card = null; };
  const timer = setTimeout(build, SHOW_AFTER_MS);
  const ctl = {
    progress(f) { if (job.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true }); if (b) { b.set(f); pct.textContent = `${Math.round(f * 100)}%`; } },
  };
  return new Promise((resolve) => {
    Promise.resolve().then(() => load(ctl)).then(async (result) => {
      if (job.cancelled) { discard(result); resolve('cancelled'); return; }
      if (here() === place) { end(); await show(result); resolve('opened'); return; }
      build(); b.set(1); pct.textContent = ''; label.textContent = `${name} is ready`; ready = { result, resolve };
      const open = btn('fd-open-btn', 'Open', 'Open', async () => { ready = null; end(); await show(result); resolve('opened'); });
      card.replaceChild(open, pct);
    }).catch((err) => {
      end();
      if (!err?.cancelled) say(`Could not open it: ${err?.message || err}`);
      resolve(err?.cancelled ? 'cancelled' : 'failed');
    });
  });
}
