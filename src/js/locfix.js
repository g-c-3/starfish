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
  <g class="lf-rot">
  <g class="lf-rings"><circle cx="160" cy="160" r="140"/><circle cx="160" cy="160" r="93.3"/><circle cx="160" cy="160" r="46.7"/></g>
  <line class="lf-axis" x1="20" y1="160" x2="300" y2="160"/><line class="lf-axis" x1="160" y1="20" x2="160" y2="300"/>
  <g class="lf-sweep"><path d="M160 160 L160 20 A140 140 0 0 1 281.2 90 Z"/></g>
  <circle class="lf-acc" cx="160" cy="160" r="0"/>
  <g class="lf-trail"></g>
  </g>
  <circle class="lf-halo" cx="160" cy="160" r="11"/><circle class="lf-pin" cx="160" cy="160" r="5"/>
  <text class="lf-n" x="160" y="14" dominant-baseline="central">N</text><text class="lf-dir" x="306" y="160" dominant-baseline="central">E</text><text class="lf-dir" x="160" y="306" dominant-baseline="central">S</text><text class="lf-dir" x="14" y="160" dominant-baseline="central">W</text><text class="lf-scale" x="312" y="312" text-anchor="end"></text>
</svg>`;

// Rotation of the screen from the device's natural position, 0, 90, 180 or 270. The orientation reading is in the device's own frame, so
// the screen's up edge is the device's top edge only at 0 (Decision 460).
function screenAngle() {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

// Heading (radians clockwise from north) of where the phone points, from an absolute orientation reading.
// Lying flat that is the screen's up edge; held upright, the back. The two horizontal directions are summed, so it holds in between.
function compassHeading(alpha, beta, gamma, angle = 0) {
  const r = Math.PI / 180, a = alpha * r, b = beta * r, g = gamma * r;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g);
  const topE = -sa * cb, topN = ca * cb; // the device's top edge, east and north parts
  const rightE = ca * cg - sa * sb * sg, rightN = sa * cg + ca * sb * sg; // the device's right edge
  const [upE, upN] = angle === 90 ? [rightE, rightN] : angle === 180 ? [-topE, -topN] : angle === 270 ? [-rightE, -rightN] : [topE, topN];
  const east = upE + (-sg * ca - cg * sb * sa);
  const north = upN + (-sg * sa + cg * sb * ca);
  return Math.atan2(east, north);
}

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
    const rot = q('.lf-rot'), nEl = q('.lf-n'), dirEls = [[q('.lf-n'), 0], ...[...el.querySelectorAll('.lf-dir')].map((t, i) => [t, (i + 1) * Math.PI / 2])]; // N, E, S, W

    // North follows the phone's magnetometer: the plot turns so N sits where north is. No sensor reading = north stays at the top.
    // The first readings after the sensor starts can be far off while it settles, so the plot turns only once about 0.7 s of readings
    // agree (Decision 460); until then the letters are dimmed. Read on the phone only, nothing stored or sent (Decision 349).
    let hx = 0, hy = 0, haveHeading = false, frame = 0;
    const recent = []; // [time, sin, cos] of the readings of the last second, until the heading is trusted
    box.classList.add('lf-wait');
    function drawNorth() {
      frame = 0;
      const h = Math.atan2(hx, hy); // phone heading, radians clockwise from north
      rot.setAttribute('transform', `rotate(${(-h * 180 / Math.PI).toFixed(1)} 160 160)`);
      for (const [t, a] of dirEls) { // each letter sits where its direction is: bearing a, seen from a phone heading h
        t.setAttribute('x', (160 + 146 * Math.sin(a - h)).toFixed(1));
        t.setAttribute('y', (160 - 146 * Math.cos(a - h)).toFixed(1));
      }
    }
    function onOrient(e) {
      if (done || e.alpha == null || e.beta == null || e.gamma == null) return;
      if (e.type === 'deviceorientation' && !e.absolute) return; // a relative reading has no north
      const h = compassHeading(e.alpha, e.beta, e.gamma, screenAngle());
      if (!haveHeading) {
        const now = performance.now();
        recent.push([now, Math.sin(h), Math.cos(h)]);
        while (recent.length && now - recent[0][0] > 1000) recent.shift();
        const sx = recent.reduce((s, q) => s + q[1], 0), sy = recent.reduce((s, q) => s + q[2], 0);
        if (recent.length < 5 || now - recent[0][0] < 700 || Math.hypot(sx, sy) / recent.length < 0.985) return; // still settling (spread beyond about 10°)
        hx = sx / recent.length; hy = sy / recent.length; haveHeading = true; box.classList.remove('lf-wait');
      } else {
        hx += (Math.sin(h) - hx) * 0.15; hy += (Math.cos(h) - hy) * 0.15; // smoothed on the circle, so 359° to 1° does not swing round
      }
      if (!frame) frame = requestAnimationFrame(drawNorth);
    }
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);

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
      window.removeEventListener('deviceorientationabsolute', onOrient, true);
      window.removeEventListener('deviceorientation', onOrient, true);
      if (frame) cancelAnimationFrame(frame);
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
