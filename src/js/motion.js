// Screen motion (Decisions 385 to 402). Watches the `hidden` class and acts after the change, so app logic sees the final state at once.
// One recipe for everything that opens or closes, the category one: the old page leaves (fade plus a short slide), then the new page arrives.
// Two pages never overlap, and nothing is a full-width slide. A file or the explorer opening over a page is the same: the page under it
// leaves, the file arrives; on close the file leaves, the page returns. Only transform and opacity animate.
import '../css/motion.css';

const LAYERS = '#editor-screen, #viewer-screen, #explorer-screen, #phone-screen, #explorer-viewer'; // every file or page that opens over another
const DIALOGS = '.modal-overlay';
// Pages by depth. A page that appears while another of the same parent goes away is a pair: deeper = forward, shallower = back.
const DEPTH = {
  'first-run-setup': -1, 'lock-screen': -1, 'main-screen': 0, 'vault-screen': 1,
  'home-tab': 0, 'settings-tab': 1,
  'vault-locked-view': 0, 'vault-pin-setup-view': 0, 'vault-content': 1,
  'home-main': 0, 'folder-view': 1, 'trash-view': 1,
  'vault-main': 0, 'vault-trash-view': 1, 'vault-settings-view': 1, 'vault-folder-view': 1,
};
const NO_EXIT = new Set(['vault-content']); // Vault content is never shown through an exit: a Vault lock hides it at once
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const hasHidden = (cls) => !!cls && /(^|\s)hidden(\s|$)/.test(cls);
const FAILSAFE_MS = 700;
let running = 0;
let lastY = 0; // where the page was scrolled before a change: the page that leaves stays where it was seen
window.addEventListener('scroll', () => { lastY = window.scrollY; }, { passive: true });

// Where each page sits while it is on view. A page that leaves is put back exactly there: the new page may start higher or lower
// (Settings, Vault settings), and placing the old one at the new one's top made it jump at the start of every swap.
const rects = new Map();
function leadOf(el) { // the first block that sits in the page flow: its top margin can collapse through the page
  for (const c of el.children) {
    if (!c.getClientRects().length) continue;
    const pos = getComputedStyle(c).position;
    if (pos === 'absolute' || pos === 'fixed') continue;
    return c;
  }
  return null;
}
function snap() {
  if (document.hidden) return;
  for (const id in DEPTH) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden') || el.closest('.mx-in, .mx-out, .mx-u-in, .mx-u-out') || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect(), lead = leadOf(el);
    rects.set(id, { top: r.top + window.scrollY, left: r.left, width: r.width, lead, leadTop: lead ? lead.getBoundingClientRect().top + window.scrollY : 0 });
  }
}
setInterval(snap, 150);
document.addEventListener('pointerdown', snap, true); // the last look before a tap changes the page
window.addEventListener('resize', snap);

const ALL = ['mx-in', 'mx-out', 'mx-view', 'mx-after', 'mx-from-r', 'mx-from-l', 'mx-to-r', 'mx-to-l', 'mx-u-in', 'mx-u-out'];

function play(el, cls, cleanup) {
  el.classList.remove(...ALL);
  void el.offsetWidth; // restart on a quick re-toggle
  el.classList.add(...cls);
  running++; root.classList.add('mx-x'); // the page never scrolls sideways while a slide runs
  let over = false;
  const end = (e) => {
    if (over || (e && e.target !== el)) return;
    over = true;
    el.removeEventListener('animationend', end);
    el.classList.remove(...cls);
    el.style.animationPlayState = ''; // never left paused
    if (cleanup) cleanup();
    if (--running <= 0) { running = 0; root.classList.remove('mx-x'); }
  };
  el.addEventListener('animationend', end);
  setTimeout(() => end(), FAILSAFE_MS);
}

function locked() { // a lock must never be delayed or shown through an exit
  const lock = document.getElementById('lock-screen');
  return document.hidden || (lock && !lock.classList.contains('hidden'));
}

// The page a layer opens over: the screen on view, or, for the explorer's file viewer, the explorer's own page.
function under(layer) {
  const list = layer.id === 'explorer-viewer'
    ? Array.from(layer.parentElement ? layer.parentElement.children : [])
    : Array.from(document.querySelectorAll('.screen'));
  return list.filter((u) => u instanceof HTMLElement && u !== layer && !u.classList.contains('hidden') && !u.classList.contains('mx-out'));
}

function layerOrDialog(el, was, now) {
  const layer = el.matches(LAYERS), dialog = !layer && el.matches(DIALOGS);
  if (!layer && !dialog) return false;
  const pane = layer && el.classList.contains('np-pane'); // the editor beside the Notes list (Decision 458): nothing under it leaves or returns
  if (was && !now) { // shown
    el.classList.remove('mx-out');
    if (layer) {
      try { el.style.setProperty('--mx-d', getComputedStyle(el).display); } catch { /* default applies */ }
      if (locked()) return true;
      if (pane) { play(el, ['mx-in', 'mx-view', 'mx-from-r']); return true; }
      const list = under(el); // the page under leaves and stays gone until the file has arrived
      list.forEach((u) => { u.classList.remove(...ALL); u.classList.add('mx-u-out'); });
      play(el, ['mx-in', 'mx-view', 'mx-from-r', 'mx-after'], () => list.forEach((u) => u.classList.remove('mx-u-out')));
    }
  } else if (!was && now && !locked()) { // hidden: stays painted while it leaves
    if (!el.style.getPropertyValue('--mx-d')) el.style.setProperty('--mx-d', 'flex');
    if (layer && !pane) under(el).forEach((u) => play(u, ['mx-u-in'])); // the page under returns once the file has left
    play(el, layer ? ['mx-out', 'mx-view', 'mx-to-r'] : ['mx-out']);
  }
  return true;
}

new MutationObserver((records) => {
  if (reduced.matches) return;
  // One net change per element for the whole batch. showScreen() hides every screen and shows the target again in one go: read record
  // by record, a screen that stayed on view looked as if it had just arrived, faded in from nothing, and hid the Settings page leaving inside it.
  const first = new Map();
  for (const r of records) if (r.target instanceof HTMLElement && !first.has(r.target)) first.set(r.target, r.oldValue);
  const shown = [], gone = [];
  for (const [el, oldValue] of first) {
    const was = hasHidden(oldValue), now = el.classList.contains('hidden');
    if (was === now || layerOrDialog(el, was, now)) continue;
    if (!(el.id in DEPTH)) continue;
    (was && !now ? shown : gone).push(el);
  }
  for (const inc of shown) {
    const out = gone.find((g) => g.parentElement === inc.parentElement && g.classList.contains('hidden'));
    const back = !!out && DEPTH[inc.id] < DEPTH[out.id];
    inc.classList.remove('mx-out');
    const pair = !!out && !NO_EXIT.has(out.id) && !locked() && !!inc.offsetParent;
    const box = pair ? inc.getBoundingClientRect() : null; // measured before the arriving page gets its starting offset, or the old page would start displaced
    play(inc, ['mx-in', 'mx-view', back ? 'mx-from-l' : 'mx-from-r'].concat(pair ? ['mx-after'] : []));
    if (pair) {
      inc.style.animationPlayState = 'paused'; // both start together, once the old page has been painted
      // The old page leaves over the viewport, exactly where it was seen. It is fixed, so a tall page (Settings) no longer stretches the
      // document: the new page is in view at once instead of sitting scrolled away until the animation ends.
      out.style.setProperty('--mx-d', 'block');
      const st = out.style;
      const seen = rects.get(out.id) || { top: box.top + window.scrollY, left: box.left, width: box.width, lead: null, leadTop: 0 };
      const clear = () => { st.position = ''; st.top = ''; st.left = ''; st.width = ''; st.maxHeight = ''; st.overflow = ''; st.animationPlayState = ''; };
      st.position = 'fixed';
      st.top = seen.top - lastY + 'px';
      st.left = seen.left + 'px';
      st.width = seen.width + 'px';
      play(out, ['mx-out', 'mx-view', back ? 'mx-to-r' : 'mx-to-l'], clear);
      st.animationPlayState = 'paused'; // first frame held until the page has been painted where it is
      if (seen.lead && seen.lead.isConnected) {
        // Out of the page flow, the first block's top margin no longer collapses through the page and would push everything down.
        // Put the page back so that block sits exactly where it was seen.
        const dy = (seen.leadTop - lastY) - seen.lead.getBoundingClientRect().top;
        if (Math.abs(dy) >= 0.5) st.top = seen.top - lastY + dy + 'px';
      }
      // Only what is in view is painted: a tall page (Settings) would otherwise stall while its layer is built, and reappear half faded.
      st.maxHeight = Math.max(0, window.innerHeight - parseFloat(st.top) + 8) + 'px';
      st.overflow = 'hidden';
      requestAnimationFrame(() => requestAnimationFrame(() => { st.animationPlayState = ''; inc.style.animationPlayState = ''; }));
    }
  }
}).observe(root, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

// ---- Inside the file explorer (Decision 395) ----
// Every change of what the explorer shows (storage list, folder, Trash, archive, pick, resolve) replaces the children of #explorer-body.
// One observer there gives them all the same recipe: the old list leaves (a ghost kept over the same place), the new one arrives.
// Deeper = forward, shallower or back to an earlier view = back. Filtering, sorting and refreshing the same folder change nothing: no motion.
(function explorerMotion() {
  const body = document.getElementById('explorer-body');
  const screenEl = document.getElementById('explorer-screen');
  const crumbsEl = document.getElementById('explorer-crumbs');
  const titleEl = document.getElementById('explorer-title');
  if (!body || !screenEl || !crumbsEl || !titleEl) return;
  const DX = 44, OUT_MS = 170, IN_MS = 300, GAP_MS = 110;
  const SETTLE = 'cubic-bezier(0.22, 0.61, 0.36, 1)', LEAVE = 'cubic-bezier(0.4, 0, 0.7, 0.2)';
  let scrolled = 0, depth0 = 0, sig0 = '', hist = [];
  const toolsEl = document.getElementById('explorer-tools');
  body.addEventListener('scroll', () => { scrolled = body.scrollTop; }, { passive: true });

  // Where the list and the two toolbars (path, filter and sort) sit while on view. Going back to the storage list hides both toolbars, which
  // moves the list up about 40 px: the old list must leave from where it was seen, not from where the new layout puts the list.
  // Layout offsets, not screen rectangles: a slide in progress must not distort what is remembered. The three are children of the fixed screen.
  const rectOf = (e) => (!e || e.classList.contains('hidden') || !e.getClientRects().length ? null : { top: e.offsetTop, left: e.offsetLeft, width: e.offsetWidth, height: e.offsetHeight });
  let seen = null;
  function look() {
    if (document.hidden || screenEl.classList.contains('hidden') || screenEl.matches('.mx-in, .mx-out')) return;
    seen = { body: rectOf(body), crumbs: rectOf(crumbsEl), tools: rectOf(toolsEl) };
  }
  setInterval(look, 150);
  document.addEventListener('pointerdown', look, true);

  const busy = (anim) => { // keeps sideways overflow clipped while a slide runs
    root.classList.add('mx-x'); running++;
    const done = () => { if (--running <= 0) { running = 0; root.classList.remove('mx-x'); } };
    anim.finished.then(done, done);
  };

  new MutationObserver((records) => {
    const removed = [];
    for (const r of records) for (const n of r.removedNodes) if (n.nodeType === 1) removed.push(n);
    const depth = crumbsEl.classList.contains('hidden') ? 0 : crumbsEl.querySelectorAll('.crumb').length;
    const sig = `${titleEl.textContent}|${depth}`;
    const changed = sig !== sig0;
    let back = false;
    if (changed) {
      back = depth !== depth0 ? depth < depth0 : hist.length > 1 && hist[hist.length - 2] === sig;
      if (back) hist.pop(); else hist.push(sig);
      depth0 = depth; sig0 = sig;
    }
    if (!changed || !removed.length || reduced.matches || locked()) return;
    if (screenEl.classList.contains('hidden') || screenEl.matches('.mx-in, .mx-out')) return; // the explorer itself is opening or closing
    const sign = back ? 1 : -1; // the old list leaves to the left going deeper, to the right going back
    const was = seen && seen.body ? seen : { body: rectOf(body), crumbs: null, tools: null };
    if (!was.body) return;
    const pieces = [was.body, was.crumbs, was.tools].filter(Boolean);
    const gTop = Math.min(...pieces.map((r) => r.top)), gLeft = Math.min(...pieces.map((r) => r.left));
    const gRight = Math.max(...pieces.map((r) => r.left + r.width)), gBottom = was.body.top + was.body.height;
    const ghost = document.createElement('div'), inner = document.createElement('div');
    Object.assign(ghost.style, { position: 'fixed', top: gTop + 'px', left: gLeft + 'px', width: gRight - gLeft + 'px', height: gBottom - gTop + 'px', overflow: 'hidden', pointerEvents: 'none', zIndex: '2' });
    const place = (n, r) => Object.assign(n.style, { position: 'absolute', top: r.top - gTop + 'px', left: r.left - gLeft + 'px', width: r.width + 'px' });
    // A toolbar that is gone now leaves with the list, as a copy of how it looked.
    for (const [bar, r] of [[crumbsEl, was.crumbs], [toolsEl, was.tools]]) {
      if (!r || !bar.classList.contains('hidden')) continue;
      const copy = bar.cloneNode(true);
      copy.removeAttribute('id'); copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      copy.classList.remove('hidden');
      place(copy, r); copy.style.height = r.height + 'px';
      ghost.appendChild(copy);
    }
    place(inner, was.body); // same padding as the body, and the list stays where it was seen
    inner.style.cssText += `; box-sizing: border-box; height: ${was.body.height}px; overflow: hidden; padding: ${getComputedStyle(body).padding};`;
    const track = document.createElement('div');
    track.style.cssText = `transform: translateY(${-scrolled}px);`;
    removed.forEach((n) => track.appendChild(n));
    inner.appendChild(track);
    ghost.appendChild(inner);
    screenEl.appendChild(ghost);
    // A toolbar that appears now fades in with the new list instead of popping in.
    for (const [bar, r] of [[crumbsEl, was.crumbs], [toolsEl, was.tools]]) {
      if (r || bar.classList.contains('hidden')) continue;
      busy(bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: IN_MS, delay: GAP_MS, easing: SETTLE, fill: 'backwards' }));
    }
    const out = ghost.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, offset: 0.65 },
      { opacity: 0, transform: `translate3d(${sign * DX}px, 0, 0)` },
    ], { duration: OUT_MS, easing: LEAVE, fill: 'forwards' });
    busy(out);
    out.finished.then(() => ghost.remove(), () => ghost.remove());
    body.getAnimations().forEach((a) => a.cancel());
    const arrive = body.animate([
      { opacity: 0, transform: `translate3d(${-sign * DX}px, 0, 0)` },
      { opacity: 1, offset: 0.55 },
      { opacity: 1, transform: 'none' },
    ], { duration: IN_MS, delay: GAP_MS, easing: SETTLE, fill: 'backwards' });
    busy(arrive);
  }).observe(body, { childList: true });
})();

// ---- A new row in a list (Decision 402) ----
// A list redrawn with one or two ids it did not hold, while the rest stayed, has gained rows: they arrive with the one recipe's soft
// landing (fade, no slide). Opening another folder, a tab swap or a filter changes the whole set, so it never matches. Class only.
(function rowMotion() {
  const LISTS = ['folder-list', 'vault-folder-list'];
  const known = new Map();
  const idsOf = (list) => new Set(Array.from(list.querySelectorAll('.entry-row[data-id]'), (r) => r.dataset.id));
  const animating = (list) => { for (let n = list; n; n = n.parentElement) if (n.getAnimations && n.getAnimations().length) return true; return false; };
  for (const id of LISTS) {
    const list = document.getElementById(id);
    if (!list) continue;
    known.set(list, idsOf(list));
    new MutationObserver(() => {
      const now = idsOf(list), prev = known.get(list) || new Set();
      known.set(list, now);
      const fresh = Array.from(now).filter((x) => !prev.has(x));
      if (!fresh.length || fresh.length > 2 || now.size - fresh.length < 1) return; // a first draw, or a different set
      if (reduced.matches || locked() || !list.getClientRects().length || list.closest('.hidden, .mx-in, .mx-out, .mx-u-in, .mx-u-out') || animating(list)) return;
      for (const rid of fresh) {
        const row = Array.from(list.querySelectorAll('.entry-row[data-id]')).find((r) => r.dataset.id === rid);
        if (!row) continue;
        row.classList.add('mx-row');
        const done = (e) => { if (e && e.target !== row) return; row.classList.remove('mx-row'); row.removeEventListener('animationend', done); };
        row.addEventListener('animationend', done);
        setTimeout(() => done(), FAILSAFE_MS);
      }
    }).observe(list, { childList: true, subtree: true });
  }
})();

// ---- Edge swipe back on a layer (Decision 401) ----
// Where Back is a button (window.ArklyNav, Decision 287) a swipe from the left edge goes back, by the same path as the system Back and
// with the same exit recipe. With gesture navigation the system already owns the edge, so nothing is added there. No drag follows the
// finger: the layer leaves by the recipe, so there is no jump between a dragged position and the exit.
(function edgeBack() {
  const EDGE = 28, MIN_DX = 64, MAX_DY = 48, MAX_MS = 600;
  const OPEN = ['#editor-screen', '#viewer-screen', '#explorer-screen', '#explorer-viewer', '#phone-screen'];
  let t = null;
  const buttons = () => { try { return !!window.ArklyNav && window.ArklyNav.mode() === 'buttons'; } catch { return false; } };
  const shown = (el) => !!el && !el.classList.contains('hidden') && el.getClientRects().length > 0 && !el.matches('.mx-in, .mx-out');
  const layerOpen = () => OPEN.some((s) => shown(document.querySelector(s)));
  const dialogOpen = () => !!document.querySelector('.modal-overlay:not(.hidden)');
  document.addEventListener('touchstart', (e) => {
    t = null;
    const p = e.touches[0];
    if (e.touches.length !== 1 || p.clientX > EDGE || !buttons() || locked() || dialogOpen() || !layerOpen()) return;
    t = { x: p.clientX, y: p.clientY, at: performance.now() };
  }, { passive: true, capture: true });
  document.addEventListener('touchend', (e) => {
    const s = t; t = null;
    const p = e.changedTouches[0];
    if (!s || !p || performance.now() - s.at > MAX_MS) return;
    if (p.clientX - s.x >= MIN_DX && Math.abs(p.clientY - s.y) <= MAX_DY && !dialogOpen() && layerOpen() && typeof window.ArklyBack === 'function') window.ArklyBack();
  }, { passive: true, capture: true });
  document.addEventListener('touchcancel', () => { t = null; }, { passive: true, capture: true });
})();
