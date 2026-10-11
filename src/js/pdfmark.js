// pdfmark.js — writes mark-up and form values into a new PDF (Decision 166). Pure: bytes in, bytes out, no DOM, no storage.
// Marks live in the displayed page: x, y and sizes are fractions of the displayed page width and height, origin top-left,
// so they do not depend on zoom. Display rotation, crop box and media box are applied here, once, on export.
// Marks are drawn into the page content (they cannot be edited again after saving). Form fields stay fillable.

import { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, EncryptedPDFError, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from 'pdf-lib';
import { COLORS, STAMPS, HIGHLIGHT_OPACITY, MAX_MARKS, PEN_WIDTH, BASELINE_TEXT, BASELINE_STAMP, STAMP_PAD } from './pdfmarkconst.js';

// Displayed size and origin of a pdf-lib page: crop box when present, then the page rotation.
function pageGeometry(page) {
  const box = page.getCropBox();
  const rot = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  const sideways = rot === 90 || rot === 270;
  return { x0: box.x, y0: box.y, W: box.width, H: box.height, rot, Wd: sideways ? box.height : box.width, Hd: sideways ? box.width : box.height };
}

// Displayed fraction (u, v), origin top-left, to PDF user space.
function toPdf(g, u, v) {
  const dx = u * g.Wd, dy = v * g.Hd;
  let x, y;
  if (g.rot === 0) { x = dx; y = g.H - dy; }
  else if (g.rot === 90) { x = dy; y = dx; }
  else if (g.rot === 180) { x = g.W - dx; y = dy; }
  else { x = g.W - dy; y = g.H - dx; }
  return [g.x0 + x, g.y0 + y];
}

// Text the standard font cannot draw becomes '?', so one odd character does not stop a save.
function safeText(font, text) {
  let out = '', changed = false;
  for (const ch of String(text)) {
    try { font.widthOfTextAtSize(ch, 1); out += ch; } catch { out += '?'; changed = true; }
  }
  return { text: out, changed };
}

const colorOf = (name) => rgb(...(COLORS[name] || COLORS.black));

// Loads a PDF for mark-up. Rejects with { code: 'encrypted' } for a password-protected file.
async function loadForMarkup(bytes) {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError || /encrypt/i.test(String(err && err.message))) throw Object.assign(new Error('Mark-up needs a PDF without a password. This one opens for reading only.'), { code: 'encrypted' });
    throw err;
  }
}

function fieldKind(f) {
  if (f instanceof PDFTextField) return 'text';
  if (f instanceof PDFCheckBox) return 'check';
  if (f instanceof PDFDropdown) return 'choice';
  if (f instanceof PDFRadioGroup) return 'radio';
  if (f instanceof PDFOptionList) return 'list';
  return null; // buttons, signatures: not fillable here
}

// Form fields of a loaded document: [{ name, kind, value, options, readOnly, multiline }].
function listFields(doc) {
  let fields;
  try { fields = doc.getForm().getFields(); } catch { return []; }
  const out = [];
  for (const f of fields) {
    const kind = fieldKind(f);
    if (!kind) continue;
    try {
      const e = { name: f.getName(), kind, readOnly: f.isReadOnly(), value: '', options: [], multiline: false };
      if (kind === 'text') { e.value = f.getText() || ''; e.multiline = f.isMultiline(); }
      else if (kind === 'check') e.value = f.isChecked();
      else { e.options = f.getOptions(); e.value = (f.getSelected ? [].concat(f.getSelected() || []) : [])[0] || ''; }
      out.push(e);
    } catch { /* an unreadable field is left out */ }
  }
  return out;
}

function hasFormXfa(doc) { try { return !!doc.getForm().hasXFA(); } catch { return false; } }

// Applies form values: { [fieldName]: string | boolean }. Returns the names that could not be set.
function applyForm(doc, values, font) {
  const failed = [];
  if (!values || !Object.keys(values).length) return failed;
  const form = doc.getForm();
  for (const [name, val] of Object.entries(values)) {
    try {
      const f = form.getField(name), kind = fieldKind(f);
      if (kind === 'text') f.setText(val === '' ? undefined : safeText(font, val).text);
      else if (kind === 'check') { if (val) f.check(); else f.uncheck(); }
      else if (kind === 'choice' || kind === 'radio' || kind === 'list') { if (val === '') { if (kind !== 'radio') f.clear(); } else f.select(val); }
    } catch { failed.push(name); }
  }
  try { form.updateFieldAppearances(font); } catch { /* fields keep their values; viewers redraw them */ }
  return failed;
}

function drawMarks(doc, marks, font, bold, images) {
  const pages = doc.getPages();
  let changed = false;
  for (const m of marks) {
    const page = pages[m.page - 1];
    if (!page) continue;
    const g = pageGeometry(page);
    const color = colorOf(m.color);
    if (m.kind === 'highlight') {
      const a = toPdf(g, m.x, m.y), b = toPdf(g, m.x + m.w, m.y + m.h);
      page.drawRectangle({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), color, opacity: HIGHLIGHT_OPACITY, borderWidth: 0 });
    } else if (m.kind === 'draw') {
      const pts = m.pts || [];
      const thickness = Math.max(0.5, (m.width || PEN_WIDTH) * g.Wd);
      for (let i = 0; i < pts.length; i++) {
        const a = toPdf(g, pts[i][0], pts[i][1]);
        const b = i + 1 < pts.length ? toPdf(g, pts[i + 1][0], pts[i + 1][1]) : a;
        page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness, color, lineCap: LineCapStyle.Round });
      }
    } else if (m.kind === 'text') {
      const size = Math.max(4, m.fs * g.Wd);
      const lines = String(m.text || '').split('\n');
      lines.forEach((line, i) => {
        const s = safeText(font, line);
        if (s.changed) changed = true;
        if (!s.text) return;
        const p = toPdf(g, m.x, m.y + (size * BASELINE_TEXT + i * size * 1.2) / g.Hd);
        page.drawText(s.text, { x: p[0], y: p[1], size, font, color, rotate: degrees(g.rot) });
      });
    } else if (m.kind === 'sign') {
      // Picture (Decision 169): displayed top-left (x, y), width a fraction of the displayed width, height by the picture's ratio.
      const img = images.get(m.png);
      if (!img) continue;
      const w = m.w * g.Wd, h = w * m.ratio;
      const p = toPdf(g, m.x, m.y + h / g.Hd); // the picture's own bottom-left corner in the displayed page
      page.drawImage(img, { x: p[0], y: p[1], width: w, height: h, rotate: degrees(g.rot) });
    } else if (m.kind === 'stamp') {
      const size = Math.max(4, m.fs * g.Wd);
      const label = safeText(bold, String(m.label || '').toUpperCase());
      if (label.changed) changed = true;
      const pad = size * STAMP_PAD, tw = bold.widthOfTextAtSize(label.text, size);
      const bw = (tw + 2 * pad) / g.Wd, bh = (size + 2 * pad) / g.Hd;
      const c = [[m.x, m.y], [m.x + bw, m.y], [m.x + bw, m.y + bh], [m.x, m.y + bh]].map(([u, v]) => toPdf(g, u, v));
      const thickness = Math.max(0.8, size * 0.1);
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness, color, lineCap: LineCapStyle.Projecting });
      }
      const p = toPdf(g, m.x + pad / g.Wd, m.y + (pad + size * BASELINE_STAMP) / g.Hd);
      page.drawText(label.text, { x: p[0], y: p[1], size, font: bold, color, rotate: degrees(g.rot) });
    }
  }
  return changed;
}

// Returns { bytes, textChanged, failedFields }. `marks` and `formValues` as described above.
async function applyMarkup(bytes, marks, formValues) {
  if ((marks || []).length > MAX_MARKS) throw new Error(`Too many marks (limit ${MAX_MARKS}).`);
  const doc = await loadForMarkup(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const failedFields = applyForm(doc, formValues, font);
  const images = new Map(); // one embedded copy per picture, however many times it is placed
  for (const m of marks || []) if (m.kind === 'sign' && m.png && !images.has(m.png)) images.set(m.png, await doc.embedPng(m.png));
  const textChanged = drawMarks(doc, marks || [], font, bold, images);
  return { bytes: await doc.save(), textChanged, failedFields };
}

// Quick look before mark-up opens: { pages, fields, xfa }. Rejects with code 'encrypted' for a protected file.
async function inspectPdf(bytes) {
  const doc = await loadForMarkup(bytes);
  return { pages: doc.getPageCount(), fields: listFields(doc), xfa: hasFormXfa(doc) };
}

export { COLORS, STAMPS, HIGHLIGHT_OPACITY, MAX_MARKS, pageGeometry, toPdf, safeText, applyMarkup, inspectPdf };
