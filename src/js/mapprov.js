// mapprov.js — optional map providers (up to two) for saved Location entries (Decisions 345, 346, 348). Off until the person sets one.
// The only code that fetches map data. It fetches only after a tap of Show map (or Load more detail) in a Home location's detail,
// never on open and never in the background, and only the tiles in view. The provider sees those tile numbers (roughly the place) and
// the phone's address. Tiles viewed are saved with the location (maptiles.js) and shown later with no network. The template and key
// live in the app's settings on this phone; neither is in any backup.
import '../css/mapprov.css';
import { cachedTile, storeTile, clearAllTiles, countTiles } from './maptiles.js';

// Slot 1 keeps the original keys. Slot 2 is optional. Neither is in any backup.
const KEYS = [{ tpl: 'map_provider_template', key: 'map_provider_key' }, { tpl: 'map_provider2_template', key: 'map_provider2_key' }];
const TILE = 256, MIN_Z = 3, MAX_Z = 19, START_Z = 16;

// Prefill only. Templates and sign-up pages change; the person checks the provider's own documentation.
const PRESETS = [
  { id: 'maptiler', name: 'MapTiler', site: 'maptiler.com', where: 'Account > API keys', tpl: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}' },
  { id: 'stadia', name: 'Stadia Maps', site: 'stadiamaps.com', where: 'Dashboard > Manage properties > API key', tpl: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key={key}' },
  { id: 'thunderforest', name: 'Thunderforest', site: 'thunderforest.com', where: 'Account > API keys', tpl: 'https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={key}' },
  { id: 'geoapify', name: 'Geoapify', site: 'geoapify.com', where: 'Projects > API keys', tpl: 'https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey={key}' },
  { id: 'mapbox', name: 'Mapbox', site: 'mapbox.com', where: 'Account > Tokens (public token)', tpl: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}' },
];

// The providers that are set, in slot order: [{ slot, tpl, key }].
export async function loadProviders(metaGet) {
  const out = [];
  for (let i = 0; i < KEYS.length; i++) {
    const tpl = (await metaGet(KEYS[i].tpl, '')) || '';
    const key = (await metaGet(KEYS[i].key, '')) || '';
    if (tpl) out.push({ slot: i + 1, tpl, key });
  }
  return out;
}

export function validateTemplate(tpl, key) {
  if (!/^https:\/\//i.test(tpl)) return 'The template must start with https://';
  for (const t of ['{z}', '{x}', '{y}']) if (!tpl.includes(t)) return `The template needs ${t}`;
  if (tpl.includes('{key}') && !key) return 'This template uses {key}: enter the key';
  return '';
}

export function tileUrl(tpl, key, z, x, y) {
  return tpl.split('{z}').join(String(z)).split('{x}').join(String(x)).split('{y}').join(String(y)).split('{key}').join(encodeURIComponent(key));
}

// Slippy-map position of a point at zoom z, in tile units.
export function tilePos(lat, lng, z) {
  const n = 2 ** z, r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

// Provider dialog: two providers, the second optional. register({ finish }) / register(null) lets a lock or Back close it.
// Resolves true when saved or removed.
export function openProviderDialog({ metaGet, metaSet, toast, register, db }) {
  return new Promise(async (resolve) => {
    const cur = await loadProviders(metaGet);
    const el = document.createElement('div');
    el.id = 'map-provider-dialog';
    el.className = 'modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    const section = (n) => `<section class="mp-sec">
      <h4 class="mp-h">${n === 1 ? 'Provider 1' : 'Provider 2 (optional)'}</h4>
      <label class="mp-l">Provider<select class="mp-preset"><option value="">Custom</option>${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
      <p class="mp-reg"></p>
      <label class="mp-l">Tile URL template<input type="url" class="mp-tpl" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${n === 1 ? 'https://…/{z}/{x}/{y}.png?key={key}' : 'Leave empty for none'}"></label>
      <label class="mp-l">Key<input type="password" class="mp-key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Only if the template has {key}"></label>
    </section>`;
    el.innerHTML = `<div class="modal-box mp-box">
      <h3>Map providers</h3>
      <p class="mp-note">Optional, off by default. Arkly uses a provider only when you tap Show map on a saved location. Each tap asks the provider you choose for the tiles in view, so that provider sees the tile numbers (about where the place is) and your phone’s address. Tiles you view are saved on this phone with that location, so its map shows later with no provider and no connection; check your provider’s terms on saving tiles. A second provider is optional; each keeps its own saved tiles. Saved maps and the keys are not in a backup. Vault locations never use a provider.</p>
      ${section(1)}${section(2)}
      <p class="mp-err" aria-live="polite"></p>
      <button type="button" class="mp-save">Save</button>
      <button type="button" class="secondary-btn mp-remove">Remove all providers</button>
      <button type="button" class="secondary-btn mp-clear">Delete all saved maps</button>
      <button type="button" class="secondary-btn mp-cancel">Cancel</button>
    </div>`;
    const q = (s) => el.querySelector(s);
    const err = q('.mp-err');
    const secs = [...el.querySelectorAll('.mp-sec')].map((s, i) => {
      const o = { preset: s.querySelector('.mp-preset'), reg: s.querySelector('.mp-reg'), tpl: s.querySelector('.mp-tpl'), key: s.querySelector('.mp-key') };
      const c = cur.find((p) => p.slot === i + 1);
      if (c) { o.tpl.value = c.tpl; o.key.value = c.key; const m = PRESETS.find((p) => p.tpl === c.tpl); if (m) o.preset.value = m.id; }
      const paintReg = () => {
        const p = PRESETS.find((x) => x.id === o.preset.value);
        o.reg.textContent = p ? `Register at ${p.site} (free plan available; check its current terms). Key: ${p.where}. Then paste the key below.` : 'Any provider that serves 256 px image tiles by {z}/{x}/{y} works. Register with it, create a key and paste its tile URL.';
      };
      o.preset.onchange = () => { const p = PRESETS.find((x) => x.id === o.preset.value); if (p) o.tpl.value = p.tpl; paintReg(); };
      paintReg();
      return o;
    });
    let done = false;
    const finish = (v) => { if (done) return; done = true; el.remove(); if (register) register(null); resolve(v); };
    q('.mp-cancel').onclick = () => finish(false);
    const clr = q('.mp-clear');
    let armed = false;
    countTiles(db).then((n) => { if (!n) clr.disabled = true; }).catch(() => {});
    clr.onclick = async () => {
      if (!armed) { armed = true; clr.textContent = 'Tap again to delete all saved maps'; return; }
      try { await clearAllTiles(db); toast('Saved maps deleted'); clr.disabled = true; } catch { toast('Could not delete saved maps'); }
      armed = false; clr.textContent = 'Delete all saved maps';
    };
    q('.mp-remove').onclick = async () => {
      for (const k of KEYS) { await metaSet(k.tpl, ''); await metaSet(k.key, ''); }
      toast('Map providers removed'); finish(true);
    };
    q('.mp-save').onclick = async () => {
      const v = secs.map((o) => ({ tpl: o.tpl.value.trim(), key: o.key.value.trim() }));
      let bad = validateTemplate(v[0].tpl, v[0].key);
      if (bad) { err.textContent = `Provider 1: ${bad}`; return; }
      const two = !!(v[1].tpl || v[1].key); // empty second provider = none
      if (two) { bad = validateTemplate(v[1].tpl, v[1].key); if (bad) { err.textContent = `Provider 2: ${bad}`; return; } }
      await metaSet(KEYS[0].tpl, v[0].tpl); await metaSet(KEYS[0].key, v[0].key);
      await metaSet(KEYS[1].tpl, two ? v[1].tpl : ''); await metaSet(KEYS[1].key, two ? v[1].key : '');
      toast(two ? 'Map providers saved' : 'Map provider saved');
      finish(true);
    };
    if (register) register({ finish: () => finish(false) });
    document.body.appendChild(el);
  });
}

async function fetchDataUrl(url) {
  const res = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`http ${res.status}`); // an error image (wrong key) is shown, never saved
  const blob = await res.blob();
  if (!/^image\//.test(blob.type)) throw new Error('not an image');
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
}

// Fills `host` (a box sized by CSS; the zoom text goes to onZoom) with the map, centred on the point. Pinch zooms between 3 and 19, continuously.
// Tiles come from the saved copy first; the provider is asked only while `online` is true (after the person's tap); each tile fetched
// is saved with the location, in the table of `slot` (1 or 2, one per provider). Returns { goOnline(provider) }.
export function renderMap(host, { lat, lng }, { db, entryId, provider, online, onZoom, slot = 1 }) {
  const st = { zf: START_Z, provider: provider || null, online: !!online, noStore: false, builtZ: null, token: 0 };
  host.textContent = '';
  host.classList.add('mp-host');
  const mosaic = document.createElement('div'); mosaic.className = 'mp-mosaic';
  const pin = document.createElement('div'); pin.className = 'mp-pin';
  host.append(mosaic, pin);

  function paintLabel() {
    if (onZoom) onZoom(`Current zoom: ${st.zf.toFixed(1)}${st.noStore ? ' · not saved' : ''}`); // shown by the caller, outside the map
  }

  async function loadTile(img, z, tx, ty, token) {
    const c = await cachedTile(db, entryId, z, tx, ty, slot).catch(() => null);
    if (c) { if (token === st.token) img.src = c; return; }
    if (!st.online || !st.provider) { img.classList.add('mp-blank'); return; }
    const url = tileUrl(st.provider.tpl, st.provider.key, z, tx, ty);
    try {
      const data = await fetchDataUrl(url);
      await storeTile(db, entryId, lat, lng, z, tx, ty, data, slot);
      if (token === st.token) img.src = data;
    } catch (e) {
      if (token !== st.token) return;
      img.src = url; // shown straight from the provider; saved only when the provider allows reading it
      if (e instanceof TypeError && !st.noStore) { st.noStore = true; paintLabel(); }
    }
  }

  function draw() {
    const w = host.clientWidth || 320, h = host.clientHeight || 160;
    const zi = Math.max(MIN_Z, Math.min(MAX_Z, Math.floor(st.zf + 1e-6)));
    const n = 2 ** zi, p = tilePos(lat, lng, zi), ix = Math.floor(p.x), iy = Math.floor(p.y);
    const px = (p.x - (ix - 2)) * TILE, py = (p.y - (iy - 1)) * TILE; // the point inside the 5 x 3 mosaic
    mosaic.style.left = `${w / 2 - px}px`; mosaic.style.top = `${h / 2 - py}px`;
    mosaic.style.transformOrigin = `${px}px ${py}px`;
    mosaic.style.transform = `scale(${2 ** (st.zf - zi)})`;
    if (st.builtZ !== zi) {
      st.builtZ = zi; st.token++;
      mosaic.textContent = '';
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ty = iy + dy;
          if (ty < 0 || ty >= n) continue;
          const img = document.createElement('img');
          img.width = TILE; img.height = TILE; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.draggable = false;
          img.style.left = `${(dx + 2) * TILE}px`; img.style.top = `${(dy + 1) * TILE}px`;
          mosaic.appendChild(img);
          loadTile(img, zi, (((ix + dx) % n) + n) % n, ty, st.token);
        }
      }
    }
    paintLabel();
  }

  // Two-finger pinch: the zoom follows the finger distance.
  const ptrs = new Map();
  let d0 = 0, z0 = 0;
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  host.addEventListener('pointerdown', (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { host.setPointerCapture(e.pointerId); } catch { /* the gesture still works */ }
    if (ptrs.size === 2) { d0 = dist() || 1; z0 = st.zf; }
  });
  host.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size !== 2) return;
    st.zf = Math.max(MIN_Z, Math.min(MAX_Z, z0 + Math.log2(dist() / d0)));
    draw();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size === 2) { d0 = dist() || 1; z0 = st.zf; } };
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (st.builtZ !== null) draw(); }).observe(host); // placed again if the box is sized after the first draw
  draw();
  return { goOnline(prov) { st.provider = prov; st.online = true; st.builtZ = null; draw(); } };
}
