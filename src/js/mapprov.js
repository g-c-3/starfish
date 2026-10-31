// mapprov.js — optional map provider for saved Location entries (Decision 345). Off until the person sets one.
// The only code that fetches map data. It runs on a tap of Show map in a Home location's detail, never on open and never in the
// background. Each tap requests 9 image tiles from the provider the person chose: the tile numbers (roughly the place) and the
// phone's address reach that provider. The template and key live in the app's settings on this phone; neither is in any backup.
import '../css/mapprov.css';

const K_TPL = 'map_provider_template', K_KEY = 'map_provider_key';
const TILE = 256, MIN_Z = 3, MAX_Z = 19, START_Z = 16;

// Prefill only. Templates and sign-up pages change; the person checks the provider's own documentation.
const PRESETS = [
  { id: 'maptiler', name: 'MapTiler', site: 'maptiler.com', where: 'Account > API keys', tpl: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}' },
  { id: 'stadia', name: 'Stadia Maps', site: 'stadiamaps.com', where: 'Dashboard > Manage properties > API key', tpl: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png?api_key={key}' },
  { id: 'thunderforest', name: 'Thunderforest', site: 'thunderforest.com', where: 'Account > API keys', tpl: 'https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={key}' },
  { id: 'geoapify', name: 'Geoapify', site: 'geoapify.com', where: 'Projects > API keys', tpl: 'https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey={key}' },
  { id: 'mapbox', name: 'Mapbox', site: 'mapbox.com', where: 'Account > Tokens (public token)', tpl: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}' },
];

export async function loadProvider(metaGet) {
  const tpl = (await metaGet(K_TPL, '')) || '';
  const key = (await metaGet(K_KEY, '')) || '';
  return tpl ? { tpl, key } : null;
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

// Provider dialog. register({ finish }) / register(null) lets a lock or Back close it. Resolves true when saved or removed.
export function openProviderDialog({ metaGet, metaSet, toast, register }) {
  return new Promise(async (resolve) => {
    const cur = await loadProvider(metaGet);
    const el = document.createElement('div');
    el.id = 'map-provider-dialog';
    el.className = 'modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="modal-box mp-box">
      <h3>Map provider</h3>
      <p class="mp-note">Optional, off by default. Arkly uses it only when you tap Show map on a saved location. Each tap asks the provider you choose for 9 map tiles, so that provider sees the tile numbers (about where the place is) and your phone’s address. The key stays on this phone and is never in a backup. Vault locations never use it.</p>
      <label class="mp-l">Provider<select class="mp-preset"><option value="">Custom</option>${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
      <p class="mp-reg"></p>
      <label class="mp-l">Tile URL template<input type="url" class="mp-tpl" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/{z}/{x}/{y}.png?key={key}"></label>
      <label class="mp-l">Key<input type="password" class="mp-key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Only if the template has {key}"></label>
      <p class="mp-err" aria-live="polite"></p>
      <button type="button" class="mp-save">Save</button>
      <button type="button" class="secondary-btn mp-remove">Remove provider</button>
      <button type="button" class="secondary-btn mp-cancel">Cancel</button>
    </div>`;
    const q = (s) => el.querySelector(s);
    const preset = q('.mp-preset'), reg = q('.mp-reg'), tplEl = q('.mp-tpl'), keyEl = q('.mp-key'), err = q('.mp-err');
    if (cur) { tplEl.value = cur.tpl; keyEl.value = cur.key; const m = PRESETS.find((p) => p.tpl === cur.tpl); if (m) preset.value = m.id; }
    const paintReg = () => {
      const p = PRESETS.find((x) => x.id === preset.value);
      reg.textContent = p ? `Register at ${p.site} (free plan available; check its current terms). Key: ${p.where}. Then paste the key below.` : 'Any provider that serves 256 px image tiles by {z}/{x}/{y} works. Register with it, create a key and paste its tile URL.';
    };
    preset.onchange = () => { const p = PRESETS.find((x) => x.id === preset.value); if (p) tplEl.value = p.tpl; paintReg(); };
    paintReg();
    let done = false;
    const finish = (v) => { if (done) return; done = true; el.remove(); if (register) register(null); resolve(v); };
    q('.mp-cancel').onclick = () => finish(false);
    q('.mp-remove').onclick = async () => { await metaSet(K_TPL, ''); await metaSet(K_KEY, ''); toast('Map provider removed'); finish(true); };
    q('.mp-save').onclick = async () => {
      const tpl = tplEl.value.trim(), key = keyEl.value.trim();
      const bad = validateTemplate(tpl, key);
      if (bad) { err.textContent = bad; return; }
      await metaSet(K_TPL, tpl); await metaSet(K_KEY, key);
      toast('Map provider saved');
      finish(true);
    };
    if (register) register({ finish: () => finish(false) });
    document.body.appendChild(el);
  });
}

// Draws a 3 x 3 tile mosaic centred on the point, with zoom buttons. Nothing is fetched until this is called.
export function renderMap(box, { lat, lng }, provider) {
  let z = START_Z;
  box.textContent = '';
  const view = document.createElement('div');
  view.className = 'mp-view';
  const mosaic = document.createElement('div');
  mosaic.className = 'mp-mosaic';
  const pin = document.createElement('div');
  pin.className = 'mp-pin';
  view.append(mosaic, pin);
  const bar = document.createElement('div');
  bar.className = 'mp-bar';
  const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'secondary-btn'; minus.textContent = '−'; minus.setAttribute('aria-label', 'Zoom out');
  const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'secondary-btn'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Zoom in');
  const msg = document.createElement('span'); msg.className = 'mp-msg';
  bar.append(minus, msg, plus);
  const credit = document.createElement('div');
  credit.className = 'mp-credit';
  credit.textContent = 'Map data and tiles come from your provider; its attribution terms apply.';
  box.append(view, bar, credit);

  function draw() {
    const w = Math.min(box.clientWidth || 320, 2 * TILE - 8), h = 260;
    view.style.width = `${w}px`; view.style.height = `${h}px`;
    const n = 2 ** z, p = tilePos(lat, lng, z), ix = Math.floor(p.x), iy = Math.floor(p.y);
    mosaic.textContent = '';
    mosaic.style.left = `${w / 2 - (p.x - (ix - 1)) * TILE}px`;
    mosaic.style.top = `${h / 2 - (p.y - (iy - 1)) * TILE}px`;
    pin.style.left = `${w / 2}px`; pin.style.top = `${h / 2}px`;
    let loaded = 0, failed = 0;
    msg.textContent = `Zoom ${z}`;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const img = document.createElement('img');
        img.width = TILE; img.height = TILE; img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.style.left = `${(dx + 1) * TILE}px`; img.style.top = `${(dy + 1) * TILE}px`;
        img.onload = () => { loaded++; };
        img.onerror = () => { failed++; if (failed === 9) msg.textContent = 'Tiles did not load. Check the template, key and connection.'; };
        const tx = ((ix + dx) % n + n) % n, ty = iy + dy;
        if (ty < 0 || ty >= n) { failed++; continue; }
        img.src = tileUrl(provider.tpl, provider.key, z, tx, ty);
        mosaic.appendChild(img);
      }
    }
  }
  minus.onclick = () => { if (z > MIN_Z) { z--; draw(); } };
  plus.onclick = () => { if (z < MAX_Z) { z++; draw(); } };
  draw();
}
