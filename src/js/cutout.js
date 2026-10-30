// cutout.js — passes the display cutout's side insets to the page as --cut-l and --cut-r (Decision 336). DOM only.
// window.ArklyCutout comes from patch-cutout.js; without it both stay 0 and nothing changes. The rules that use them are in cutout.css.
import '../css/cutout.css';

const root = document.documentElement;
let last = '';

function read() {
  try {
    if (!window.ArklyCutout) return;
    const [l, , r] = String(window.ArklyCutout.insets()).split(',').map((v) => Math.max(0, Math.round(Number(v) || 0)));
    const key = `${l},${r}`;
    if (key === last) return;
    last = key;
    root.style.setProperty('--cut-l', `${l}px`);
    root.style.setProperty('--cut-r', `${r}px`);
  } catch { /* insets stay as they were */ }
}

// The window's insets are not ready on the first frame and lag behind a rotation, so read again shortly after each.
const readSoon = () => { read(); setTimeout(read, 250); setTimeout(read, 900); };
readSoon();
setTimeout(read, 2500);
window.addEventListener('resize', readSoon);
window.addEventListener('orientationchange', readSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden) readSoon(); });
