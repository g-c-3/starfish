// phonegallery.js — Gallery > Phone and the camera hand-off (Decision 316). Reads the phone's photos and videos through the
// native window.ArklyMedia bridge (read-only) and returns the ones the person picks; app.js saves them. Nothing is cached on disk.
import { Capacitor } from '@capacitor/core';
import { clampCols, applyCols, attachGridPinch, pinchBlocked } from './gallerygrid.js';
import '../css/phonegallery.css';

const PAGE = 300, THUMB_PX = 240;
const bridge = () => (typeof window !== 'undefined' ? window.ArklyMedia : null);
const access = () => (typeof window !== 'undefined' ? window.ArklyExplorer : null);
const hasAccess = () => { try { return !!access()?.hasAllFilesAccess(); } catch { return false; } };
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export const mediaAvailable = () => !!bridge();
export const mediaAccess = () => hasAccess();
export const requestMediaAccess = () => { try { access()?.requestAllFilesAccess(); } catch { /* the Allow button stays */ } };
export const mediaSrc = (path) => Capacitor.convertFileSrc('file://' + path);

// Camera: opens the phone's own camera app. since() lists what it added to DCIM after that moment.
export function openCamera() { try { return !!bridge()?.openCamera(); } catch { return false; } }
export const cameraSince = () => { try { return Number(bridge().launchedAt()) || 0; } catch { return 0; } };
export const newCameraMedia = (sinceSec) => { try { return parse(bridge().since(sinceSec), []); } catch { return []; } };

const extOf = (name, mime) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
  if (m) return m[1].toLowerCase();
  return String(mime || '').split('/')[1]?.split(';')[0].replace('quicktime', 'mov').replace('jpeg', 'jpg') || 'jpg';
};

// Streams one phone file into `sink(bytes)` in the pieces the WebView delivers, so a long 4K video is never held whole in memory or
// turned into one base64 string (Decision 319). Returns the byte count.
export async function streamPhoneFile(item, sink) {
  const res = await fetch(mediaSrc(item.path));
  if (!res.ok) throw new Error(`${item.name}: HTTP ${res.status}`);
  let total = 0;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) { total += value.length; await sink(value); }
    }
  } else {
    const bytes = new Uint8Array(await res.arrayBuffer());
    total = bytes.length;
    await sink(bytes);
  }
  return total;
}

export const phoneExtension = (item) => extOf(item.name, item.mime);

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const clock = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(ms) {
  const d = new Date(ms), now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const opts = d.getFullYear() === now.getFullYear() ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

// openPhoneGallery({ isVault, cols, onCols, onPick(items) -> Promise<boolean>, leaving, onActivity, onClose })
// onPick resolves true once the items are saved: the screen then closes. false keeps it open with the selection.
// Returns { finish, back, isVault }.
export function openPhoneGallery({ isVault = false, cols = 4, onCols, onPick, leaving, onActivity, onClose } = {}) {
  const screen = el('div');
  screen.id = 'phone-screen';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-label', 'Phone gallery');
  const head = el('div', 'ph-head');
  const title = el('h2', '', 'Phone');
  const selBtn = el('button', 'secondary-btn', 'Select');
  head.append(title, selBtn);
  const chips = el('div', 'ph-chips');
  const body = el('div', 'ph-body');
  screen.append(head, chips, body);
  document.body.appendChild(screen);

  const st = { items: [], total: 0, bucket: '', gen: 0, loading: false, sel: new Set(), selecting: false, viewer: null, lastDay: '', grid: null, gate: null, cols: clampCols(cols) };
  let closed = false, observer = null, moreEl = null;
  const queue = [];
  let pumping = false;
  applyCols(body, st.cols);

  const touch = () => { if (onActivity) onActivity(); };

  // ---- Thumbnails: one native call at a time, only for tiles near the screen. ----
  function pump() {
    if (pumping) return;
    pumping = true;
    const step = () => {
      if (closed) { pumping = false; return; }
      let tile;
      while ((tile = queue.shift())) if (tile.isConnected && tile.dataset.vis === '1' && !tile.dataset.done) break;
      if (!tile) { pumping = false; return; }
      const it = st.items[Number(tile.dataset.i)];
      tile.dataset.done = '1';
      let url = '';
      try { url = bridge().thumb(it.id, !!it.video, THUMB_PX); } catch { url = ''; }
      if (url) { const img = el('img'); img.alt = ''; img.src = url; tile.prepend(img); }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = e.target;
      t.dataset.vis = e.isIntersecting ? '1' : '0';
      if (e.isIntersecting && !t.dataset.done) queue.push(t);
    }
    pump();
  }, { root: body, rootMargin: '500px 0px' });

  // ---- Rendering ----
  function addItems(items) {
    for (const it of items) {
      const idx = st.items.length;
      st.items.push(it);
      const dk = dayKey(it.taken);
      if (dk !== st.lastDay || !st.grid) {
        st.lastDay = dk;
        const h = el('div', 'ph-day');
        h.dataset.day = dk;
        h.append(el('span', '', dayLabel(it.taken)), el('span', 'ph-daysel', 'Select all'));
        st.grid = el('div', 'ph-grid');
        st.grid.dataset.day = dk;
        body.insertBefore(h, moreEl);
        body.insertBefore(st.grid, moreEl);
      }
      const tile = el('button', 'ph-tile');
      tile.type = 'button';
      tile.dataset.i = String(idx);
      tile.setAttribute('aria-label', it.name);
      if (it.video) tile.append(el('span', 'ph-dur', clock(it.dur)));
      st.grid.appendChild(tile);
      observer.observe(tile);
    }
  }

  async function loadPage() {
    if (st.loading || closed) return;
    const b = bridge();
    if (!b) return;
    st.loading = true;
    const gen = st.gen;
    const res = parse(b.list(st.bucket, st.items.length, PAGE), { error: 'unreadable' });
    st.loading = false;
    if (gen !== st.gen || closed) return;
    if (res.error) { body.replaceChildren(el('div', 'ph-msg', `Could not read the phone's media: ${res.error}`)); return; }
    st.total = res.total || 0;
    if (!st.items.length && !res.items.length) { body.replaceChildren(el('div', 'ph-msg', 'No photos or videos here.')); return; }
    addItems(res.items);
    paintMore();
  }

  function paintMore() {
    if (moreEl) moreEl.remove();
    moreEl = null;
    if (st.items.length < st.total) {
      moreEl = el('div', 'ph-more', `${st.items.length} of ${st.total}`);
      body.appendChild(moreEl);
      moreObs.observe(moreEl);
    }
  }
  const moreObs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadPage(); }, { root: body, rootMargin: '800px 0px' });

  function reset() {
    st.gen++;
    st.items = []; st.total = 0; st.lastDay = ''; st.grid = null; st.loading = false;
    queue.length = 0;
    clearSel();
    observer.disconnect(); moreObs.disconnect();
    moreEl = null;
    body.replaceChildren();
    body.scrollTop = 0;
    loadPage();
  }

  function paintChips(albums) {
    chips.replaceChildren();
    const all = el('button', 'ph-chip' + (st.bucket === '' ? ' on' : ''), 'All');
    all.type = 'button';
    all.onclick = () => pickBucket('');
    chips.appendChild(all);
    albums.sort((a, b) => (/^camera$/i.test(b.name) - /^camera$/i.test(a.name)) || b.count - a.count);
    for (const a of albums) {
      const c = el('button', 'ph-chip' + (st.bucket === a.id ? ' on' : ''), `${a.name} · ${a.count}`);
      c.type = 'button';
      c.onclick = () => pickBucket(a.id);
      chips.appendChild(c);
    }
  }
  let albumCache = [];
  function pickBucket(id) { if (st.bucket === id) return; st.bucket = id; paintChips(albumCache); reset(); }

  // ---- Selection ----
  function paintHead() {
    head.replaceChildren();
    if (st.selecting) {
      const x = el('button', 'secondary-btn', 'Cancel');
      x.onclick = clearSel;
      const t = el('h2', '', `${st.sel.size} selected`);
      const add = el('button', 'ph-add', 'Add to Gallery');
      add.disabled = st.sel.size === 0;
      add.onclick = submit;
      head.append(x, t, add);
    } else {
      head.append(title, selBtn);
    }
    body.classList.toggle('selecting', st.selecting);
  }
  function paintTile(t) { t.classList.toggle('on', st.sel.has(Number(t.dataset.i))); }
  function clearSel() {
    st.sel.clear(); st.selecting = false;
    body.querySelectorAll('.ph-tile.on').forEach((t) => t.classList.remove('on'));
    paintHead();
  }
  function toggle(i) {
    if (st.sel.has(i)) st.sel.delete(i); else st.sel.add(i);
    st.selecting = true;
    const t = body.querySelector(`.ph-tile[data-i="${i}"]`);
    if (t) paintTile(t);
    paintHead();
  }
  selBtn.onclick = () => { st.selecting = true; paintHead(); };

  async function submit() {
    if (!st.sel.size || !onPick) return;
    const items = [...st.sel].sort((a, b) => a - b).map((i) => st.items[i]);
    const saved = await onPick(items);
    if (saved && !closed) finish();
  }

  // ---- Tap, long-press, swipe ----
  let press = null;
  body.addEventListener('touchstart', (e) => {
    const tile = e.target.closest('.ph-tile');
    if (!tile || e.touches.length !== 1) { press = null; return; }
    touch();
    const t0 = e.touches[0];
    press = { tile, x: t0.clientX, y: t0.clientY, long: false, timer: setTimeout(() => { if (press) { press.long = true; toggle(Number(tile.dataset.i)); } }, 450) };
  }, { passive: true });
  body.addEventListener('touchmove', (e) => {
    if (!press) return;
    const t0 = e.touches[0];
    if (Math.hypot(t0.clientX - press.x, t0.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  }, { passive: true });
  const endPress = () => { if (press) clearTimeout(press.timer); };
  body.addEventListener('touchend', endPress, { passive: true });
  body.addEventListener('touchcancel', () => { endPress(); press = null; }, { passive: true });
  body.addEventListener('contextmenu', (e) => { if (e.target.closest('.ph-tile')) e.preventDefault(); });
  body.addEventListener('click', (e) => {
    if (pinchBlocked()) return;
    const h = e.target.closest('.ph-daysel');
    if (h) {
      const day = h.parentElement.dataset.day;
      const tiles = [...body.querySelectorAll(`.ph-grid[data-day="${day}"] .ph-tile`)];
      const all = tiles.every((t) => st.sel.has(Number(t.dataset.i)));
      for (const t of tiles) { const i = Number(t.dataset.i); if (all) st.sel.delete(i); else st.sel.add(i); paintTile(t); }
      paintHead();
      return;
    }
    const tile = e.target.closest('.ph-tile');
    if (!tile) return;
    if (press?.long) { press = null; return; } // the long press already toggled it
    const i = Number(tile.dataset.i);
    if (st.selecting) toggle(i); else openViewer(i);
  });

  attachGridPinch(body, {
    grid: () => (st.items.length ? body : null),
    getCols: () => st.cols,
    onCols: (n) => { st.cols = n; if (onCols) onCols(n); touch(); }
  });

  // ---- Viewer: one photo or video, swipe for the next ----
  function openViewer(i) {
    closeViewer();
    const it = st.items[i];
    if (!it) return;
    const v = el('div', 'ph-view');
    const top = el('div', 'ph-view-top');
    const x = el('button', 'ph-x', 'Close');
    x.onclick = closeViewer;
    const name = el('span', '', '');
    const add = el('button', '', 'Add');
    add.onclick = async () => {
      const saved = onPick ? await onPick([st.items[st.viewer.i]]) : false;
      if (saved && !closed) finish();
    };
    top.append(x, name, add);
    const stage = el('div', 'ph-view-stage');
    v.append(top, stage);
    screen.appendChild(v);
    st.viewer = { el: v, stage, name, i };
    showViewer(i);
    let x0 = null;
    stage.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 70) showViewer(st.viewer.i + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }
  function showViewer(i) {
    const vw = st.viewer;
    if (!vw || i < 0 || i >= st.items.length) return;
    vw.i = i;
    const it = st.items[i];
    vw.stage.replaceChildren();
    const m = el(it.video ? 'video' : 'img');
    if (it.video) { m.controls = true; m.playsInline = true; }
    m.src = mediaSrc(it.path);
    vw.stage.appendChild(m);
    vw.name.textContent = `${i + 1} of ${st.total || st.items.length} · ${it.name}`;
    if (i >= st.items.length - 3 && st.items.length < st.total) loadPage();
  }
  function closeViewer() {
    if (!st.viewer) return;
    st.viewer.stage.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
    st.viewer.el.remove();
    st.viewer = null;
  }

  // ---- Access gate ----
  let poll = null;
  function showGate() {
    body.replaceChildren();
    chips.classList.add('hidden');
    const msg = el('div', 'ph-msg', 'To show the photos and videos on this phone, Arkly needs All files access. This is the same permission the File explorer uses. Nothing leaves the phone.');
    const b = el('button', '', 'Allow');
    b.type = 'button';
    b.onclick = () => { if (leaving) leaving(); requestMediaAccess(); };
    msg.appendChild(b);
    body.appendChild(msg);
    poll = setInterval(() => { if (hasAccess()) { clearInterval(poll); poll = null; start(); } }, 800);
  }

  function start() {
    chips.classList.remove('hidden');
    body.replaceChildren();
    albumCache = parse(bridge().albums(), []);
    paintChips(albumCache);
    loadPage();
  }

  function finish() {
    if (closed) return;
    closed = true;
    if (poll) clearInterval(poll);
    closeViewer();
    observer.disconnect(); moreObs.disconnect();
    queue.length = 0;
    st.items = [];
    screen.remove();
    if (onClose) onClose();
  }
  function back() {
    if (st.viewer) { closeViewer(); return; }
    if (st.selecting) { clearSel(); return; }
    finish();
  }

  if (!bridge()) { body.replaceChildren(el('div', 'ph-msg', 'The phone gallery is not available in this build.')); chips.classList.add('hidden'); }
  else if (!hasAccess()) showGate();
  else start();
  return { finish, back, isVault };
}
