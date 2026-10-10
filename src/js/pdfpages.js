// pdfpages.js — page tools: rotate, delete, reorder, extract, split, merge, image to PDF (Decision 167). Pure: bytes in, bytes out, no DOM, no storage.
// Output is always a new file built from copied pages. Outline, form fields and document metadata of the source are not carried over.
// Page links and annotations on a copied page stay with it.

import { PDFDocument, EncryptedPDFError, degrees } from 'pdf-lib';

const MAX_PAGES = 2000;       // pages in one output
const MAX_IMAGES = 200;       // images in one image to PDF
const A4 = [595.28, 841.89];  // points, portrait

const fail = (code, message) => Object.assign(new Error(message), { code });

// Loads a PDF for page work. Rejects with { code: 'encrypted' } for a password-protected file.
async function loadSource(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError || /encrypt/i.test(String(err && err.message))) throw fail('encrypted', 'Page tools need a PDF without a password. This one opens for reading only.');
    throw err;
  }
}

const turnsToDeg = (t) => (((t % 4) + 4) % 4) * 90;
const angleOf = (page) => (((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360;
const blank = () => PDFDocument.create({ updateMetadata: false });

// { pages, rotations } — rotations are the pages' own angles (0, 90, 180, 270).
async function inspectPages(bytes) {
  const doc = await loadSource(bytes);
  return { pages: doc.getPageCount(), rotations: doc.getPages().map(angleOf) };
}

// plan: [{ src, turn }] in output order. `src` is a 0-based page of the source, `turn` the clockwise quarter turns added (0 to 3).
// A page left out of the plan is deleted; a page listed twice is copied twice. Returns { bytes, pages }.
async function applyPagePlan(bytes, plan) {
  if (!Array.isArray(plan) || !plan.length) throw fail('empty', 'No pages left to save.');
  if (plan.length > MAX_PAGES) throw fail('limit', `Too many pages (limit ${MAX_PAGES}).`);
  const src = await loadSource(bytes);
  const n = src.getPageCount();
  for (const p of plan) if (!Number.isInteger(p.src) || p.src < 0 || p.src >= n) throw fail('range', 'A page in the plan is not in the PDF.');
  const out = await blank();
  const copies = await out.copyPages(src, plan.map((p) => p.src));
  copies.forEach((page, i) => {
    const turn = turnsToDeg(plan[i].turn || 0);
    if (turn) page.setRotation(degrees((angleOf(page) + turn) % 360));
    out.addPage(page);
  });
  return { bytes: await out.save(), pages: plan.length };
}

// Selected pages (0-based, in the order given) as one new PDF.
const extractPages = (bytes, indices) => applyPagePlan(bytes, indices.map((src) => ({ src, turn: 0 })));

// Text such as "1-3, 5, 7-" to ranges of 1-based pages within `count`: { ranges: [[from, to], ...] } or { error }.
// Ranges keep the order typed and may overlap. "7-" runs to the last page, "-3" from the first.
function parseRanges(text, count) {
  const parts = String(text || '').split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return { error: 'Type page ranges such as 1-3, 5, 7-9.' };
  const ranges = [];
  for (const part of parts) {
    const m = /^(\d*)(?:-(\d*))?$/.exec(part);
    if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return { error: `“${part}” is not a page range.` };
    const dash = part.includes('-');
    const from = m[1] === '' ? 1 : Number(m[1]);
    const to = !dash ? from : (m[2] === '' || m[2] === undefined ? count : Number(m[2]));
    if (from < 1 || to > count || from > to) return { error: `“${part}” is outside pages 1 to ${count}.` };
    ranges.push([from, to]);
  }
  return { ranges };
}

// One new PDF per range (1-based, inclusive). Returns [{ bytes, pages, from, to }].
async function splitPdf(bytes, ranges) {
  if (!ranges.length) throw fail('empty', 'No ranges given.');
  const out = [];
  for (const [from, to] of ranges) {
    const idx = [];
    for (let i = from - 1; i < to; i++) idx.push(i);
    const r = await extractPages(bytes, idx);
    out.push({ bytes: r.bytes, pages: r.pages, from, to });
  }
  return out;
}

// Whole PDFs, in the order given, as one new PDF. Each item is bytes or a function returning bytes (read one at a time, so
// only one source is held). A failure carries `index`, the item that caused it. Returns { bytes, pages }.
async function mergePdfs(list) {
  if (!Array.isArray(list) || list.length < 2) throw fail('empty', 'Pick at least two PDFs to merge.');
  const out = await blank();
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    let src;
    try {
      src = await loadSource(typeof list[i] === 'function' ? await list[i]() : list[i]);
    } catch (err) { throw Object.assign(err, { index: i }); }
    total += src.getPageCount();
    if (total > MAX_PAGES) throw fail('limit', `Too many pages (limit ${MAX_PAGES}).`);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return { bytes: await out.save(), pages: total };
}

// images: [{ bytes, kind: 'jpg' | 'png' }] or functions returning that, one page each, in order. A page is A4 in the image's
// orientation, the image scaled to fill it. A failure carries `index`. Returns { bytes, pages }.
async function imagesToPdf(images) {
  if (!Array.isArray(images) || !images.length) throw fail('empty', 'No images given.');
  if (images.length > MAX_IMAGES) throw fail('limit', `Too many images (limit ${MAX_IMAGES}).`);
  const out = await blank();
  for (let i = 0; i < images.length; i++) {
    try {
      const im = typeof images[i] === 'function' ? await images[i]() : images[i];
      const img = im.kind === 'png' ? await out.embedPng(im.bytes) : await out.embedJpg(im.bytes);
      const landscape = img.width > img.height;
      const [mw, mh] = landscape ? [A4[1], A4[0]] : A4;
      const k = Math.min(mw / img.width, mh / img.height);
      const w = img.width * k, h = img.height * k;
      out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } catch (err) { throw Object.assign(err, { index: i }); }
  }
  return { bytes: await out.save(), pages: images.length };
}

export { MAX_PAGES, MAX_IMAGES, inspectPages, applyPagePlan, extractPages, parseRanges, splitPdf, mergePdfs, imagesToPdf };
