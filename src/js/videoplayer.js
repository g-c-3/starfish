// videoplayer.js — one set of video controls for the Gallery viewer and the Phone viewer (Decision 324). DOM only.
// attachVideoPlayer(stage, video, { onFail, onActivity }) draws the controls over `stage` and returns { destroy }.
// Full screen also asks window.ArklyScreen (patch-screen.js, Decisions 326, 328) to hide the system bars and turn a wide video to landscape,
// and asks the WebView for its fullscreen overlay (patch-fullscreen.js, Decision 334), which draws into the camera area; a refusal keeps the window-filling mode.
// The native controls stay off; every control is a plain element over the video.
import '../css/videoplayer.css';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_MS = 3000, SKIP = 10;
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H8.8l4.6-4.6L12 5l-7 7 7 7 1.4-1.4L8.8 13H20z"/></svg><b>10</b>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M4 11h11.2l-4.6-4.6L12 5l7 7-7 7-1.4-1.4 4.6-4.6H4z"/></svg><b>10</b>',
  loop: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm12.6 1.4L17 12l-1.4 1.6 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4L12.4 15l1.4-1.4-1.4-1.6 1.4-1.4 1.4 1.4 1.4-1.4z"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zm16 0v6h-2V6h-4V4zM4 20v-6h2v4h4v2zm16 0h-6v-2h4v-4h2z"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path d="M10 4v6H4V8h4V4zm4 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z"/></svg>'
};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
export const clockText = (s) => {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

export function attachVideoPlayer(stage, video, { onFail, onActivity } = {}) {
  video.controls = false;
  video.removeAttribute('controls');
  video.classList.add('vp-video');

  const layer = el('div', 'vp-layer');
  const hud = el('div', 'vp-hud');
  const centre = el('div', 'vp-centre vp-ctl');
  const bBack = el('button', 'vp-skip', ICON.back), bBig = el('button', 'vp-big', ICON.play), bFwd = el('button', 'vp-skip', ICON.fwd);
  bBack.setAttribute('aria-label', 'Back 10 seconds'); bFwd.setAttribute('aria-label', 'Forward 10 seconds'); bBig.setAttribute('aria-label', 'Play');
  centre.append(bBack, bBig, bFwd);
  const bar = el('div', 'vp-bar vp-ctl');
  const tCur = el('span', 'vp-time', '0:00'), tLeft = el('span', 'vp-time vp-left', '-0:00');
  const seek = el('input', 'vp-seek');
  seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.setAttribute('aria-label', 'Seek');
  const row1 = el('div', 'vp-row'); row1.append(tCur, seek, tLeft);
  const bSpeed = el('button', 'vp-tool', '1×'), bLoop = el('button', 'vp-tool', ICON.loop), bMute = el('button', 'vp-tool', ICON.vol);
  const bFit = el('button', 'vp-tool', 'Fit'), bFull = el('button', 'vp-tool', ICON.full);
  bSpeed.setAttribute('aria-label', 'Speed'); bLoop.setAttribute('aria-label', 'Loop'); bMute.setAttribute('aria-label', 'Mute'); bFit.setAttribute('aria-label', 'Fit or fill'); bFull.setAttribute('aria-label', 'Full screen');
  const row2 = el('div', 'vp-row vp-tools'); row2.append(bSpeed, bLoop, bMute, bFit, bFull);
  bar.append(row1, row2);
  layer.append(hud, centre, bar);
  stage.appendChild(layer);

  let shown = true, hideT = null, hudT = null, seeking = false, full = false, speedI = 2, dead = false;
  const touch = () => { if (onActivity) onActivity(); };

  // ---- Show and hide ----
  function schedule() {
    clearTimeout(hideT);
    if (video.paused || video.ended || seeking) return;
    hideT = setTimeout(() => show(false), HIDE_MS);
  }
  function show(on) {
    shown = on;
    layer.classList.toggle('vp-hide', !on);
    if (on) schedule(); else clearTimeout(hideT);
  }
  const flash = (text) => { hud.textContent = text; hud.classList.add('on'); clearTimeout(hudT); hudT = setTimeout(() => hud.classList.remove('on'), 800); };

  // ---- State ----
  function paintPlay() {
    const ended = video.ended;
    bBig.innerHTML = ended ? ICON.replay : video.paused ? ICON.play : ICON.pause;
    bBig.setAttribute('aria-label', ended ? 'Replay' : video.paused ? 'Play' : 'Pause');
    if (video.paused || ended) show(true); else schedule();
  }
  function paintTime() {
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    tCur.textContent = clockText(video.currentTime);
    tLeft.textContent = '-' + clockText(Math.max(0, dur - video.currentTime));
    if (!seeking && dur) seek.value = String(Math.round((video.currentTime / dur) * 1000));
  }
  function paintVol() {
    const off = video.muted || video.volume === 0;
    bMute.innerHTML = off ? ICON.mute : ICON.vol;
    bMute.classList.toggle('on', off);
  }
  const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); return () => t.removeEventListener(ev, fn, opt); };
  const offs = [
    on(video, 'play', paintPlay), on(video, 'pause', paintPlay), on(video, 'ended', paintPlay),
    on(video, 'timeupdate', paintTime), on(video, 'loadedmetadata', paintTime), on(video, 'durationchange', paintTime),
    on(video, 'volumechange', paintVol),
    on(video, 'error', () => { if (!dead && onFail) onFail('Could not play this video here'); })
  ];

  // ---- Actions ----
  const toggle = () => { if (video.ended) { video.currentTime = 0; } if (video.paused || video.ended) video.play().catch(() => {}); else video.pause(); };
  const skip = (s) => {
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.max(0, Math.min(dur || 1e9, video.currentTime + s));
    flash(`${s > 0 ? '+' : '−'}${SKIP} s`);
  };
  bBig.onclick = () => { touch(); toggle(); };
  bBack.onclick = () => { touch(); skip(-SKIP); schedule(); };
  bFwd.onclick = () => { touch(); skip(SKIP); schedule(); };
  bSpeed.onclick = () => { touch(); speedI = (speedI + 1) % SPEEDS.length; video.playbackRate = SPEEDS[speedI]; bSpeed.textContent = `${SPEEDS[speedI]}×`; schedule(); };
  bLoop.onclick = () => { touch(); video.loop = !video.loop; bLoop.classList.toggle('on', video.loop); flash(video.loop ? 'Loop on' : 'Loop off'); schedule(); };
  bMute.onclick = () => { touch(); video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.5; schedule(); };
  bFit.onclick = () => { touch(); const fill = video.classList.toggle('vp-fill'); bFit.textContent = fill ? 'Fill' : 'Fit'; schedule(); };
  seek.addEventListener('input', () => {
    touch();
    seeking = true;
    clearTimeout(hideT);
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    if (dur) { video.currentTime = (Number(seek.value) / 1000) * dur; tCur.textContent = clockText(video.currentTime); tLeft.textContent = '-' + clockText(dur - video.currentTime); }
  });
  const seekDone = () => { seeking = false; schedule(); };
  seek.addEventListener('change', seekDone);
  seek.addEventListener('pointerup', seekDone);
  seek.addEventListener('pointercancel', seekDone);

  const native = (on) => { try { if (window.ArklyScreen) window.ArklyScreen.immersive(on, on && video.videoWidth > video.videoHeight); } catch { /* no native bridge: the window-filling mode stays */ } };
  // ---- Overlay (Decision 334): the stage in the WebView's own fullscreen window. Only when the bridge exists; a refusal changes nothing. ----
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  let overlay = false;
  function overlayOn() {
    try {
      if (!window.ArklyScreen || !stage.requestFullscreen) return;
      const p = stage.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch { /* the window-filling mode stays */ }
  }
  function overlayOff() {
    overlay = false;
    try {
      if (!fsEl() || !document.exitFullscreen) return;
      const p = document.exitFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch { /* already closed */ }
  }
  offs.push(on(document, 'fullscreenchange', () => {
    if (fsEl() === stage) overlay = true;
    else if (overlay) { overlay = false; if (full) exitFull(); }
  }));
  // ---- Full screen: the window-filling mode, plus the native bars-hidden mode when the bridge exists; wide video asks for landscape ----
  function enterFull() {
    full = true;
    stage.classList.add('vp-full');
    document.body.classList.add('vp-fs');
    bFull.innerHTML = ICON.exit;
    native(true);
    overlayOn();
  }
  function exitFull() {
    if (!full) return;
    full = false;
    stage.classList.remove('vp-full');
    document.body.classList.remove('vp-fs');
    bFull.innerHTML = ICON.full;
    overlayOff();
    native(false);
  }
  bFull.onclick = () => { touch(); if (full) exitFull(); else enterFull(); schedule(); };

  // ---- Gestures on the picture: tap shows or hides, double tap skips, vertical drag on the right half sets the volume ----
  let g = null, lastTap = 0, lastX = 0;
  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.vp-ctl')) return;
    touch();
    const r = stage.getBoundingClientRect();
    g = { x: e.clientX, y: e.clientY, t: Date.now(), right: e.clientX - r.left > r.width / 2, vol: null, v0: video.muted ? 0 : video.volume, h: r.height };
  });
  layer.addEventListener('pointermove', (e) => {
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.vol === null && Math.hypot(dx, dy) > 12) g.vol = g.right && Math.abs(dy) > Math.abs(dx) * 1.5;
    if (g.vol) {
      const v = Math.max(0, Math.min(1, g.v0 - dy / (g.h * 0.6)));
      video.muted = false;
      video.volume = v;
      flash(`Volume ${Math.round(v * 100)}%`);
    }
  });
  const gEnd = (e) => {
    if (!g) return;
    const was = g; g = null;
    if (e.type === 'pointercancel' || was.vol !== null) return;
    if (Date.now() - was.t > 400) return;
    const now = Date.now();
    if (now - lastTap < 300 && Math.abs(was.x - lastX) < 80) {
      lastTap = 0;
      skip(was.right ? SKIP : -SKIP);
      show(true);
      return;
    }
    lastTap = now; lastX = was.x;
    show(!shown);
  };
  layer.addEventListener('pointerup', gEnd);
  layer.addEventListener('pointercancel', gEnd);
  // Touches on the controls must not reach the viewer's swipe to the next item.
  for (const t of ['touchstart', 'touchmove', 'touchend']) for (const c of [centre, bar]) c.addEventListener(t, (e) => e.stopPropagation(), { passive: true });

  paintPlay(); paintTime(); paintVol();
  return {
    destroy() {
      dead = true;
      clearTimeout(hideT); clearTimeout(hudT);
      exitFull();
      offs.forEach((f) => f());
      layer.remove();
      video.classList.remove('vp-video', 'vp-fill');
    }
  };
}
