// locfix.js — Location capture: the phone's location switch and the live fix sheet (Decisions 340, 341).
// Nothing here goes online: positions come from the phone's own location service, the plot is drawn from them as vectors.
import '../css/locfix.css';
import { Geolocation } from '@capacitor/geolocation';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NICE = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const M_LAT = 110540, M_LNG = 111320;

// true: location is on (or this build has no bridge, and the plugin reports it). false: the person declined.
export async function ensureLocationServices({ beforeLaunch } = {}) {
  const b = window.ArklyLocation;
  if (!b) return true;
  try {
    if (b.isEnabled()) return true;
    let left = false;
    const onVis = () => { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onVis);
    try {
      if (beforeLaunch) beforeLaunch();
      b.request();
      const end = Date.now() + 90000;
      while (Date.now() < end) {
        await sleep(250);
        const s = String(b.state());
        if (s === 'on') return true;
        if (s === 'off') return false;
        if (s === 'settings' && left && !document.hidden) return !!b.isEnabled(); // back from the phone's settings
      }
      return !!b.isEnabled();
    } finally { document.removeEventListener('visibilitychange', onVis); }
  } catch { return true; }
}

const meters = (m) => (m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
export const accWords = (m) => (m < 1000 ? `${Math.max(1, Math.round(m))} ${Math.round(m) <= 1 ? 'meter' : 'meters'}` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
const quality = (m) => (m <= 5 ? ['a', 'Precise'] : m <= 20 ? ['a', 'Good'] : m <= 100 ? ['b', 'Fair'] : m <= 1000 ? ['c', 'Rough'] : ['d', 'Approximate']);
// Metres from a to b: east, north.
const offset = (a, b) => ({ x: (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180) * M_LNG, y: (b.lat - a.lat) * M_LAT });
const dist = (a, b) => { const o = offset(a, b); return Math.hypot(o.x, o.y); };

// Estimate rule (Decision 341). est = { lat, lng, acc } with acc the best accuracy the phone reported, never a computed claim.
//  - overlapping fix at least as good as twice the estimate's accuracy: positions are blended by 1/acc² weights, acc = the better one;
//  - fix that does not overlap and is no worse than three times the estimate (the person moved) or an estimate older than 20 s: replaced;
//  - anything else is only drawn in the trail.
export function fuse(est, fix, now) {
  if (!est) return { lat: fix.lat, lng: fix.lng, acc: fix.acc, t: now };
  const d = dist(est, fix);
  if (d <= est.acc + fix.acc) {
    if (fix.acc > est.acc * 2) return est;
    const w1 = 1 / (est.acc * est.acc), w2 = 1 / (fix.acc * fix.acc), k = w2 / (w1 + w2);
    return { lat: est.lat + (fix.lat - est.lat) * k, lng: est.lng + (fix.lng - est.lng) * k, acc: Math.min(est.acc, fix.acc), t: now };
  }
  if (fix.acc <= est.acc * 3 || now - est.t > 20000) return { lat: fix.lat, lng: fix.lng, acc: fix.acc, t: now };
  return est;
}

const NS = 'http://www.w3.org/2000/svg';
const PLOT = `<svg class="lf-plot" viewBox="0 0 320 320" role="img" aria-label="Your position and its accuracy, drawn to scale">
  <g class="lf-rings"><circle cx="160" cy="160" r="140"/><circle cx="160" cy="160" r="93.3"/><circle cx="160" cy="160" r="46.7"/></g>
  <line class="lf-axis" x1="20" y1="160" x2="300" y2="160"/><line class="lf-axis" x1="160" y1="20" x2="160" y2="300"/>
  <g class="lf-sweep"><path d="M160 160 L160 20 A140 140 0 0 1 281.2 90 Z"/></g>
  <circle class="lf-acc" cx="160" cy="160" r="0"/>
  <g class="lf-trail"></g>
  <circle class="lf-halo" cx="160" cy="160" r="11"/><circle class="lf-pin" cx="160" cy="160" r="5"/>
  <text class="lf-n" x="160" y="15">N</text><text class="lf-scale" x="300" y="154" text-anchor="end"></text>
</svg>`;

// Opens the sheet and resolves { lat, lng, accuracy } when the person taps Use this location, null on Cancel, Back or a lock.
// Throws an Error with a plain message when no fix can be tried (permission or location switch off).
// register({ finish }) / register(null): lets the caller close the sheet on a lock or Back.
export async function openLiveFix({ formatCoords, beforeLaunch, register }) {
  if (beforeLaunch) beforeLaunch();
  let perm = null;
  try { perm = await Geolocation.requestPermissions(); } catch { /* the plugin reports it below */ }
  if (perm && perm.location === 'denied' && perm.coarseLocation === 'denied') {
    throw new Error('Location permission is off for Arkly. Allow it in the phone’s app settings.');
  }
  const approxOnly = !!(perm && perm.location !== 'granted' && perm.coarseLocation === 'granted');
  if (!(await ensureLocationServices({ beforeLaunch }))) throw new Error('Location is off. Turn it on to save your location.');

  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'loc-fix-dialog';
    el.className = 'modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="modal-box lf-box" data-type="location">
      <h3>Current location</h3>
      ${PLOT}
      <div class="lf-acc-line" aria-live="polite">Searching…</div>
      <div class="lf-state"></div>
      <div class="lf-coords"></div>
      <div class="lf-hint"></div>
      <button type="button" class="lf-use" disabled>Use this location</button>
      <button type="button" class="secondary-btn lf-cancel">Cancel</button>
    </div>`;
    const q = (s) => el.querySelector(s);
    const accLine = q('.lf-acc-line'), stateEl = q('.lf-state'), coordsEl = q('.lf-coords'), hintEl = q('.lf-hint');
    const useBtn = q('.lf-use'), accCircle = q('.lf-acc'), trailG = q('.lf-trail'), scaleEl = q('.lf-scale');
    const box = q('.lf-box');

    let est = null, trail = [], lastFixAt = 0, lastBetterAt = 0, errorText = '', watchId = null, done = false;
    const startedAt = Date.now();

    function plot() {
      if (!est) return;
      let need = est.acc;
      for (const p of trail) need = Math.max(need, Math.min(dist(est, p) , est.acc * 6));
      const R = NICE.find((n) => n >= need * 1.15) || NICE[NICE.length - 1];
      const px = 140 / R;
      accCircle.setAttribute('r', String(Math.max(6, Math.min(140, est.acc * px))));
      scaleEl.textContent = `ring ${meters(R)}`;
      trailG.textContent = '';
      trail.forEach((p, i) => {
        const o = offset(est, p);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(160 + o.x * px));
        c.setAttribute('cy', String(160 - o.y * px));
        c.setAttribute('r', '2.4');
        c.setAttribute('opacity', String(0.25 + 0.6 * ((i + 1) / trail.length)));
        trailG.appendChild(c);
      });
    }

    function paint() {
      const now = Date.now();
      if (!est) {
        accLine.textContent = 'Searching…';
        stateEl.textContent = '';
        coordsEl.textContent = '';
        hintEl.textContent = errorText || (now - startedAt > 8000 ? 'No signal yet. Move near a window or outdoors.' : '');
        return;
      }
      const [qc, ql] = quality(est.acc);
      box.dataset.q = qc;
      accLine.textContent = `Accurate to ${accWords(est.acc)}`;
      const improving = now - lastBetterAt < 8000;
      const age = Math.max(0, Math.round((now - lastFixAt) / 1000));
      stateEl.textContent = `${ql} · ${improving ? 'improving' : 'steady'} · updated ${age} s ago`;
      coordsEl.textContent = formatCoords(est.lat, est.lng);
      hintEl.textContent = errorText
        || (approxOnly && est.acc > 500 ? 'Only approximate location is allowed. Allow Precise location for Arkly in the phone’s app settings.' : '')
        || (est.acc > 100 && now - startedAt > 20000 ? 'Move near a window or outdoors for a closer fix.' : '');
    }

    function onFix(pos) {
      if (done || !pos || !pos.coords) return;
      const c = pos.coords;
      const acc = Number.isFinite(c.accuracy) && c.accuracy > 0 ? c.accuracy : 5000;
      const fix = { lat: c.latitude, lng: c.longitude, acc };
      const now = Date.now();
      const before = est ? est.acc : Infinity;
      est = fuse(est, fix, now);
      if (est.acc < before) lastBetterAt = now;
      lastFixAt = now;
      errorText = '';
      trail.push(fix);
      if (trail.length > 24) trail.shift();
      useBtn.disabled = false;
      plot();
      paint();
    }
    function onErr(err) {
      if (done) return;
      const m = String((err && err.message) || err || '');
      errorText = /not enabled|disabled|off/i.test(m) ? 'Location is off. Turn it on to continue.' : /denied|permission/i.test(m) ? 'Location permission is off for Arkly.' : '';
      paint();
    }

    const tick = setInterval(paint, 1000);
    function finish(v) {
      if (done) return;
      done = true;
      clearInterval(tick);
      if (watchId != null) Geolocation.clearWatch({ id: watchId }).catch(() => {});
      el.remove();
      if (register) register(null);
      resolve(v);
    }
    useBtn.onclick = () => { if (est) finish({ lat: est.lat, lng: est.lng, accuracy: est.acc }); };
    q('.lf-cancel').onclick = () => finish(null);
    if (register) register({ finish });

    document.body.appendChild(el);
    paint();
    // A quick coarse fix first (network or cached, under two minutes old), then the high accuracy stream refines it.
    // Three sources at once: the first fix to arrive shows at once and the rest refine it (Decision 344).
    Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 4000, maximumAge: 120000 }).then(onFix).catch(() => {});
    Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }).then(onFix).catch(() => {});
    // timeout is the plugin's delivery delay on Android: 1 s means no batching (60 s held fixes back for a minute).
    Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 1000, minimumUpdateInterval: 1000, maximumAge: 0 }, (pos, err) => { if (err) onErr(err); else onFix(pos); })
      .then((id) => { if (done) Geolocation.clearWatch({ id }).catch(() => {}); else watchId = id; })
      .catch(onErr);
  });
}
