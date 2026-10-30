// cutout.js — gives the native window the app's background colour, so the strip beside the camera matches the app (Decision 336). DOM only.
// window.ArklyCutout comes from patch-cutout.js; without it nothing happens. Re-sent on start, on a theme change and on resume.
const root = document.documentElement;
let last = '';

function toHex(rgb) {
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(rgb || '');
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return null;
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

function sync() {
  try {
    if (!window.ArklyCutout || !document.body) return;
    const hex = toHex(getComputedStyle(document.body).backgroundColor);
    if (!hex || hex === last) return;
    last = hex;
    window.ArklyCutout.background(hex);
  } catch { /* the window keeps its colour */ }
}

const syncSoon = () => { sync(); setTimeout(sync, 300); setTimeout(sync, 1500); };
syncSoon();
new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncSoon); } catch { /* no media query events */ }
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(); });
