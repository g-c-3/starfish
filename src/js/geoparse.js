// Pasted coordinates and map links → latitude/longitude (Decisions 116, 117).
// parseCoordinates is offline. resolveShortLink is the only network step and runs only when the person asks.

const NUM = '-?\\d+(?:\\.\\d+)?';
const URL_RE = /https?:\/\/[^\s<>"']+/i;
const PAIR_RE = new RegExp(`^\\s*(${NUM})\\s*(?:,|;|\\s)\\s*(${NUM})\\s*$`);
const HEMI_RE = /^\s*(\d+(?:\.\d+)?)\s*°?\s*([NSns])\s*(?:,|;|\s)\s*(\d+(?:\.\d+)?)\s*°?\s*([EWew])\s*$/;
const QUERY_KEYS = ['q', 'query', 'll', 'sll', 'center', 'destination', 'daddr'];

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function validate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Not a valid number.';
  if (Math.abs(lat) > 90) return 'Latitude must be between -90 and 90. Check the order: latitude first.';
  if (Math.abs(lng) > 180) return 'Longitude must be between -180 and 180.';
  return null;
}

function result(lat, lng, extra = {}) {
  const err = validate(lat, lng);
  return err ? { ok: false, error: err } : { ok: true, lat, lng, ...extra };
}

export function isShortLink(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return h === 'maps.app.goo.gl' || (h === 'goo.gl' && u.pathname.startsWith('/maps'));
  } catch { return false; }
}

function isAllowedHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return isShortLink(url) || h === 'google.com' || h.endsWith('.google.com') || /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h);
  } catch { return false; }
}

// Coordinates inside a map URL. Place pin (!3d!4d) beats the view centre (@), which beats query parameters.
export function parseFromUrl(url) {
  const d = safeDecode(url);
  let m = d.match(new RegExp(`!3d(${NUM})!4d(${NUM})`));
  if (!m) m = d.match(new RegExp(`@(${NUM}),(${NUM})`));
  if (!m) {
    try {
      const sp = new URL(url).searchParams;
      for (const k of QUERY_KEYS) {
        const v = sp.get(k);
        const q = v && v.match(new RegExp(`^\\s*(${NUM})\\s*,\\s*(${NUM})\\s*$`));
        if (q) { m = q; break; }
      }
    } catch { /* not a parseable URL */ }
  }
  if (!m) return null;
  const nm = d.match(/\/maps\/place\/([^/@?]+)/);
  const name = nm ? nm[1].replace(/\+/g, ' ').trim() : '';
  return result(Number(m[1]), Number(m[2]), { name: /^[\d.,\s-]+$/.test(name) ? '' : name, source: 'link' });
}

export function parseCoordinates(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, empty: true };
  const geo = t.match(new RegExp(`^geo:(${NUM}),(${NUM})`, 'i'));
  if (geo) return result(Number(geo[1]), Number(geo[2]), { name: '', source: 'link' });
  const um = t.match(URL_RE);
  if (um) {
    const url = um[0].replace(/[.,;)]+$/, '');
    if (isShortLink(url)) return { ok: false, short: true, url };
    return parseFromUrl(url) || { ok: false, error: 'No coordinates found in this link.' };
  }
  let m = t.match(HEMI_RE);
  if (m) return result((m[2].toUpperCase() === 'S' ? -1 : 1) * Number(m[1]), (m[4].toUpperCase() === 'W' ? -1 : 1) * Number(m[3]), { name: '', source: 'pair' });
  m = t.match(PAIR_RE);
  if (m) return result(Number(m[1]), Number(m[2]), { name: '', source: 'pair' });
  return { ok: false, error: 'Enter latitude and longitude, like 11.2416, 76.9632, or paste a Google Maps link.' };
}

function header(headers, name) {
  if (!headers) return '';
  const k = Object.keys(headers).find((x) => x.toLowerCase() === name);
  return k ? String(headers[k]) : '';
}

// Follows a short link's redirects one hop at a time and stops at the first hop that carries coordinates,
// so the destination page itself is never fetched. httpGet(url) must not follow redirects itself.
// Only https Google hosts are contacted; any other redirect target aborts.
export async function resolveShortLink(url, httpGet, maxHops = 5) {
  let current = url;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (!isAllowedHost(current)) return { ok: false, error: 'The link points outside Google Maps.' };
    let res;
    try { res = await httpGet(current); } catch { return { ok: false, error: 'Could not reach Google. Check the connection.' }; }
    const loc = header(res && res.headers, 'location');
    if (res && res.status >= 300 && res.status < 400 && loc) {
      let next;
      try { next = new URL(loc, current).href; } catch { return { ok: false, error: 'Could not read the link.' }; }
      const parsed = parseFromUrl(next);
      if (parsed) return parsed;
      current = next;
      continue;
    }
    return parseFromUrl((res && res.url) || current) || { ok: false, error: 'No coordinates found behind this link.' };
  }
  return { ok: false, error: 'The link redirects too many times.' };
}
