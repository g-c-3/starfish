// office-pdf.js — a drawn page of the viewer as a JPEG, and a deck as a PDF copy (Decision 577). Offline: the page is drawn by the
// browser itself from the viewer's own DOM (an SVG image with the page inside), its fonts and pictures inlined; nothing is sent anywhere.
import { imagesToPdf } from './pdfpages.js';

const bytesCache = new Map(); // url -> data URL, so a font or picture used by many pages is read once
const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function dataUrlOf(url) {
  if (url.startsWith('data:')) return url;
  if (bytesCache.has(url)) return bytesCache.get(url);
  let blob;
  try { blob = await (await fetch(url)).blob(); } catch { // a file: address is not fetched; the same read through XHR
    blob = await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'blob'; x.onload = () => res(x.response); x.onerror = () => rej(new Error('read')); x.send(); });
  }
  const d = await toDataUrl(blob);
  if (!url.startsWith('blob:')) bytesCache.set(url, d); // a blob address ends with its page
  return d;
}

// the font-face rules of the page's style sheets, with the face (family, weight, style) each one is
function fontRules() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.type !== 5) continue; // CSSFontFaceRule
      const fam = (r.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim().toLowerCase();
      const w = (r.style.getPropertyValue('font-weight') || '400').trim().split(/\s+/).map(Number);
      const src = /url\(["']?([^"')]+)["']?\)/.exec(r.style.getPropertyValue('src') || '');
      if (!fam || !src) continue;
      out.push({ fam, lo: w[0] || 400, hi: w[1] || w[0] || 400, italic: /italic|oblique/i.test(r.style.getPropertyValue('font-style') || ''), url: new URL(src[1], r.parentStyleSheet && r.parentStyleSheet.href ? r.parentStyleSheet.href : location.href).href, range: r.style.getPropertyValue('unicode-range') || '' });
    }
  }
  return out;
}

// the @font-face text for the faces the page really uses: per family, weight and style the nearest face, all its subsets
async function fontCss(node) {
  const used = new Set();
  for (const e of [node, ...node.querySelectorAll('*')]) {
    if (e.closest && e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
    const cs = getComputedStyle(e);
    for (const f of cs.fontFamily.split(',')) used.add(`${f.replace(/["']/g, '').trim().toLowerCase()}|${Number(cs.fontWeight) || 400}|${cs.fontStyle === 'normal' ? 0 : 1}`);
  }
  const rules = fontRules(); const chosen = new Set();
  for (const key of used) {
    const [fam, w, it] = key.split('|'); const same = rules.filter((r) => r.fam === fam); if (!same.length) continue;
    const styled = same.filter((r) => r.italic === (it === '1')); const pool = styled.length ? styled : same;
    const dist = (r) => (Number(w) >= r.lo && Number(w) <= r.hi ? 0 : Math.min(Math.abs(Number(w) - r.lo), Math.abs(Number(w) - r.hi)));
    const best = Math.min(...pool.map(dist)); for (const r of pool) if (dist(r) === best) chosen.add(r);
  }
  let css = '';
  for (const r of chosen) {
    try { css += `@font-face{font-family:"${r.fam}";font-weight:${r.lo} ${r.hi};font-style:${r.italic ? 'italic' : 'normal'};src:url(${await dataUrlOf(r.url)});${r.range ? `unicode-range:${r.range};` : ''}}`; } catch { /* a face that cannot be read: the page falls back */ }
  }
  return css;
}

// a copy of the node with every element's computed style written on it, its pictures inlined
async function inlined(node) {
  const clone = node.cloneNode(true); const a = [node, ...node.querySelectorAll('*')]; const b = [clone, ...clone.querySelectorAll('*')];
  const jobs = [];
  for (let i = 0; i < a.length; i++) {
    const src = a[i]; const dst = b[i];
    if (src.closest && src.closest('svg') && src.tagName.toLowerCase() !== 'svg') continue; // the drawing inside a chart carries its own attributes
    const cs = getComputedStyle(src); let t = ''; // custom properties are left out: their values are already resolved in the others
    for (const p of cs) { if (p.startsWith('--') || p.startsWith('animation') || p.startsWith('transition')) continue; t += `${p}:${cs.getPropertyValue(p)};`; }
    dst.setAttribute('style', `${t}animation:none;transition:none;`);
    if (src.tagName === 'IMG' && src.src) jobs.push(dataUrlOf(src.src).then((d) => { dst.setAttribute('src', d); }));
    const bg = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage || '');
    if (bg) jobs.push(dataUrlOf(bg[1]).then((d) => { dst.style.backgroundImage = `url("${d}")`; }));
  }
  await Promise.all(jobs);
  clone.style.position = 'relative'; clone.style.left = '0px'; clone.style.top = '0px'; clone.style.margin = '0px'; clone.style.transform = 'none';
  return clone;
}

// node: a laid-out element in the document, w by h pixels; the page as the text of an SVG image
export async function nodeToSvg(node, w, h) {
  const [clone, fonts] = await Promise.all([inlined(node), fontCss(node)]);
  const xml = new XMLSerializer().serializeToString(clone);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><style>${fonts}</style></defs><foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`;
}

// node: a laid-out element in the document, w by h pixels; the JPEG bytes of it at `scale` times that size
export async function nodeToJpeg(node, w, h, scale = 2, quality = 0.88) {
  const svg = await nodeToSvg(node, w, h);
  // a data address, not a blob one: the browser keeps the canvas clean (exportable) only for a picture with no origin of its own
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    const img = new Image(); img.src = url; await img.decode();
    // the fonts inside the picture load when it is first drawn, and text in a face still loading is not drawn: a small first drawing, a short wait, then the real one
    const warm = document.createElement('canvas'); warm.width = 16; warm.height = 9; warm.getContext('2d').drawImage(img, 0, 0, 16, 9);
    await new Promise((r) => setTimeout(r, 120));
    const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('The page could not be drawn.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally { /* nothing to release: a data address */ }
}

// count pages, each drawn when its turn comes (draw(i) -> { bytes } of a JPEG); onProgress(done, count); isCancelled() stops it
export async function pagesToPdf(count, draw, { onProgress, isCancelled } = {}) {
  const lazy = Array.from({ length: count }, (_, i) => async () => {
    if (isCancelled && isCancelled()) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    if (onProgress) onProgress(i + 1, count);
    return { kind: 'jpg', bytes: await draw(i) };
  });
  return (await imagesToPdf(lazy)).bytes;
}
