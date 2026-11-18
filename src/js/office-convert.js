// office-convert.js — an old binary file (doc, xls, ppt), as the readers of Phase 110 found it, written as .docx, .xlsx or .pptx (Phase 122, Decision 505).
// Each function takes the reader's model and returns { bytes, warnings }; warnings say what the copy does not carry. No file is read or written here.
import { zipSync, strToU8 } from 'fflate';
import { BUILTIN_FMT, colName } from './office-read.js';
import { openPptx } from './pptxedit.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
const rels = (list) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const ct = (defaults, overrides) => `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('')}${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
const RELS_T = 'application/vnd.openxmlformats-package.relationships+xml';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';

// ---- doc -> docx: lists (numbering.xml), paragraphs (alignment, indents, spacing, heading level) of runs with their character formatting, and tables (cells, spans, merges, borders, shading) (bold, italic, underline, strike, caps, size, font, colour, highlight, super and subscript); tabs and line breaks kept ----
export function docToDocx(model) {
  const warnings = [];
  const rpr = (r) => { // the character formatting of a run, in the order the schema wants
    const x = [];
    if (r.font && r.font !== 'Calibri') x.push(`<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`);
    if (r.b) x.push('<w:b/>'); if (r.i) x.push('<w:i/>'); if (r.caps) x.push('<w:caps/>'); if (r.sc) x.push('<w:smallCaps/>'); if (r.s) x.push('<w:strike/>');
    if (r.color) x.push(`<w:color w:val="${esc(r.color)}"/>`);
    if (r.size && Math.abs(r.size - 15) > 0.2) { const hp = Math.max(2, Math.round((r.size * 3) / 2)); x.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`); }
    if (r.u) x.push('<w:u w:val="single"/>');
    if (r.bg) x.push(`<w:shd w:val="clear" w:color="auto" w:fill="${esc(r.bg)}"/>`);
    if (r.sup) x.push('<w:vertAlign w:val="superscript"/>'); else if (r.sub) x.push('<w:vertAlign w:val="subscript"/>');
    return x.length ? `<w:rPr>${x.join('')}</w:rPr>` : '';
  };
  const run = (text, r) => { const pr = rpr(r); return text.split('\t').map((part, i) => `${i ? `<w:r>${pr}<w:tab/></w:r>` : ''}${part ? `<w:r>${pr}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : ''}`).join(''); };
  const ppr = (q, ls) => { // paragraph formatting in the order the schema wants: list, spacing, indents, alignment, outline level
    const x = []; const tw = (px) => Math.round(px * 15);
    if (ls && ls.ilfo) x.push(`<w:numPr><w:ilvl w:val="${ls.level || 0}"/><w:numId w:val="${ls.ilfo}"/></w:numPr>`);
    if (q.sb !== undefined || q.sa !== undefined || q.line) {
      let a = ''; if (q.sb !== undefined) a += ` w:before="${tw(q.sb)}"`; if (q.sa !== undefined) a += ` w:after="${tw(q.sa)}"`;
      if (q.line) a += q.line.mult ? ` w:line="${Math.round(q.line.mult * 240)}" w:lineRule="auto"` : ` w:line="${tw(q.line.px)}" w:lineRule="${q.line.atLeast ? 'atLeast' : 'exact'}"`;
      x.push(`<w:spacing${a}/>`);
    }
    if (q.l !== undefined || q.r !== undefined || q.first !== undefined) {
      let a = ''; if (q.l !== undefined) a += ` w:left="${tw(q.l)}"`; if (q.r !== undefined) a += ` w:right="${tw(q.r)}"`;
      if (q.first < 0) a += ` w:hanging="${tw(-q.first)}"`; else if (q.first > 0) a += ` w:firstLine="${tw(q.first)}"`;
      x.push(`<w:ind${a}/>`);
    }
    if (q.align) x.push(`<w:jc w:val="${q.align === 'justify' ? 'both' : q.align}"/>`);
    if (q.outline) x.push(`<w:outlineLvl w:val="${q.outline - 1}"/>`);
    return x.length ? `<w:pPr>${x.join('')}</w:pPr>` : '';
  };
  const bdr = (tag, b) => (b ? (b.none ? `<w:${tag} w:val="nil"/>` : `<w:${tag} w:val="${b.style === 'solid' ? 'single' : b.style}" w:sz="${Math.max(2, Math.min(96, Math.round((b.w / (4 / 3)) * 8)))}" w:space="0" w:color="${b.color || 'auto'}"/>`) : '');
  const pics = new Map(); // inline pictures: the model's media path -> the package's rId and file name
  const picRun = (r) => {
    const m = (model.media || {})[r.img]; if (!m || !(r.w > 0) || !(r.h > 0)) return '';
    if (!pics.has(r.img)) pics.set(r.img, { id: `rIdP${pics.size + 1}`, name: `image${pics.size + 1}.${r.img.slice(r.img.lastIndexOf('.') + 1)}`, bytes: m.bytes });
    const cx = Math.round(r.w * 9525); const cy = Math.round(r.h * 9525); const n = pics.size + 100;
    return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${pics.get(r.img).id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const para = (b) => {
    const inner = (b.runs || []).map((r) => (r.br ? '<w:r><w:br/></w:r>' : r.img ? picRun(r) : run(r.text || '', r))).join('');
    const pPr = ppr({ ...(b.pr || {}), ...(b.level && !(b.pr && b.pr.outline) ? { outline: b.level } : {}) }, b.list);
    return inner || pPr ? `<w:p>${pPr}${inner}</w:p>` : '<w:p/>';
  };
  const table = (b) => {
    const side = (o) => ['t', 'l', 'b', 'r', 'h', 'v'].map((k) => bdr({ t: 'top', l: 'left', b: 'bottom', r: 'right', h: 'insideH', v: 'insideV' }[k], (o || {})[k])).join('');
    const tbl = side(b.borders); const grid = (b.grid || []).map((g) => `<w:gridCol w:w="${Math.round(g * 15)}"/>`).join('');
    const rows = b.rows.map((row) => `<w:tr>${row.map((c) => {
      const tcb = c.borders ? ['t', 'l', 'b', 'r'].map((k) => bdr({ t: 'top', l: 'left', b: 'bottom', r: 'right' }[k], c.borders[k])).join('') : '';
      const pr = `${c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ''}${c.vm ? (c.vm === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : ''}${tcb ? `<w:tcBorders>${tcb}</w:tcBorders>` : ''}${c.bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.bg}"/>` : ''}${c.valign ? `<w:vAlign w:val="${c.valign}"/>` : ''}`;
      const body = (c.blocks || []).map((x) => (x.t === 'p' ? para(x) : '')).join('') || '<w:p/>';
      return `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${body}</w:tc>`;
    }).join('')}</w:tr>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${tbl ? `<w:tblBorders>${tbl}</w:tblBorders>` : ''}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
  };
  const flow = (model.blocks || []).filter((b) => b.t === 'p' || b.t === 'table');
  const paras = flow.map((b, i) => (b.t === 'table' ? `${table(b)}${!flow[i + 1] || flow[i + 1].t === 'table' ? '<w:p/>' : ''}` : para(b))); // a table is followed by a paragraph, as Word needs
  if (!paras.length) paras.push('<w:p/>');
  const pg = model.page || { w: 816, h: 1056, t: 96, r: 96, b: 96, l: 96 }; const tw = (px) => Math.round(px * 15);
  const sect = `<w:sectPr><w:pgSz w:w="${tw(pg.w)}" w:h="${tw(pg.h)}"/><w:pgMar w:top="${tw(pg.t)}" w:right="${tw(pg.r)}" w:bottom="${tw(pg.b)}" w:left="${tw(pg.l)}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  if (model.truncated) warnings.push('The document is long; only its first part is in the copy.');
  warnings.push('Floating and other pictures, headers, footers and page layout of the old file are not carried; the copy holds its text with its character, paragraph and list formatting, its tables and its inline JPEG, PNG and bitmap pictures.');
  const defs = model.numDefs || {}; const nums = Object.keys(defs).filter((id) => paras.some((x) => x.includes(`<w:numId w:val="${id}"/>`)));
  const numbering = nums.length ? `${XML}<w:numbering ${W}>${nums.map((id) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${defs[id].map((lv, k) => { // one abstract list per list override, 9 levels
    if (!lv) return '';
    const ind = lv.l !== undefined ? `<w:pPr><w:ind w:left="${tw(lv.l)}"${lv.first < 0 ? ` w:hanging="${tw(-lv.first)}"` : lv.first > 0 ? ` w:firstLine="${tw(lv.first)}"` : ''}/></w:pPr>` : '';
    return `<w:lvl w:ilvl="${k}"><w:start w:val="${lv.start}"/><w:numFmt w:val="${lv.fmt}"/><w:lvlText w:val="${esc(lv.text)}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
  }).join('')}</w:abstractNum>`).join('')}${nums.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('')}</w:numbering>` : null;
  const bytes = zip({
    '[Content_Types].xml': ct([['rels', RELS_T], ['xml', 'application/xml'], ...[...new Set([...pics.values()].map((x) => x.name.slice(x.name.lastIndexOf('.') + 1)))].map((e) => [e, { jpg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp' }[e]])], [['/word/document.xml', `${WML}.document.main+xml`], ['/word/styles.xml', `${WML}.styles+xml`], ...(numbering ? [['/word/numbering.xml', `${WML}.numbering+xml`]] : [])]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': `${XML}<w:document ${W}><w:body>${paras.join('')}${sect}</w:body></w:document>`,
    'word/styles.xml': `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`,
    ...(numbering ? { 'word/numbering.xml': numbering } : {}),
    ...Object.fromEntries([...pics.values()].map((x) => [`word/media/${x.name}`, x.bytes])),
    'word/_rels/document.xml.rels': rels([['rId1', 'styles', 'styles.xml'], ...(numbering ? [['rId2', 'numbering', 'numbering.xml']] : []), ...[...pics.values()].map((x) => [x.id, 'image', `media/${x.name}`])])
  });
  return { bytes, warnings };
}

// ---- xls -> xlsx: values (numbers as stored), number formats, fonts, fills, borders, alignment, widths, merges, freeze ----
export function xlsToXlsx(wb) {
  const warnings = [];
  const idOfCode = new Map(Object.entries(BUILTIN_FMT).map(([id, code]) => [code, Number(id)]));
  const customFmts = []; // codes with ids from 164
  const fmtId = (code) => { if (!code || code === 'General') return 0; if (idOfCode.has(code)) return idOfCode.get(code); let i = customFmts.indexOf(code); if (i < 0) { customFmts.push(code); i = customFmts.length - 1; } return 164 + i; };
  const fonts = []; const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']; const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const pool = (list, x) => { let i = list.indexOf(x); if (i < 0) { list.push(x); i = list.length - 1; } return i; };
  const rgb = (h) => `FF${String(h).toUpperCase()}`;
  const fontX = (f) => `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}${f.s ? '<strike/>' : ''}${f.u ? '<u/>' : ''}<sz val="${f.size || 11}"/>${f.color ? `<color rgb="${rgb(f.color)}"/>` : ''}<name val="${esc(f.name || 'Calibri')}"/></font>`;
  const sideX = (tag, s) => (s ? `<${tag} style="${s.style}"><color rgb="${rgb(s.color || '000000')}"/></${tag}>` : `<${tag}/>`);
  pool(fonts, fontX({ name: 'Calibri', size: 11 }));
  const xfMap = new Map(); const xfList = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfOf = (si) => {
    if (!si) return 0; if (xfMap.has(si)) return xfMap.get(si);
    const x = wb.xfs[si]; if (!x) return 0;
    const nf = fmtId(x.code); const fo = pool(fonts, fontX(x.font)); const fi = x.fill ? pool(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(x.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const bd = x.border ? pool(borders, `<border>${sideX('left', x.border.l)}${sideX('right', x.border.r)}${sideX('top', x.border.t)}${sideX('bottom', x.border.b)}<diagonal/></border>`) : 0;
    const al = [x.h && x.h !== 'general' ? `horizontal="${x.h}"` : '', x.v && x.v !== 'bottom' ? `vertical="${x.v}"` : '', x.wrap ? 'wrapText="1"' : '', x.indent ? `indent="${x.indent}"` : ''].filter(Boolean).join(' ');
    const base = `numFmtId="${nf}" fontId="${fo}" fillId="${fi}" borderId="${bd}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"`;
    xfList.push(al ? `<xf ${base} applyAlignment="1"><alignment ${al}/></xf>` : `<xf ${base}/>`);
    xfMap.set(si, xfList.length - 1); return xfList.length - 1;
  };
  const sst = []; const sstIx = new Map();
  const sid = (s) => { if (!sstIx.has(s)) { sstIx.set(s, sst.length); sst.push(s); } return sstIx.get(s); };
  const ERR = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);
  const sheets = wb.names.map((name, i) => {
    const m = wb.load(i); if (m.truncated) warnings.push(`Sheet "${name}" is large; only its first part is in the copy.`); if (m.hasDrawing) warnings.push(`Charts and pictures of sheet "${name}" are not carried.`);
    const rows = []; for (let r = 0; r < m.rows.length; r++) {
      const row = m.rows[r]; const cells = [];
      if (row) for (let c = 0; c < row.length; c++) {
        const cell = row[c]; if (!cell) continue; const s = xfOf(cell.s); const ref = `${colName(c)}${r + 1}`; const sa = s ? ` s="${s}"` : '';
        if (cell.k === 'n' && typeof cell.n === 'number' && Number.isFinite(cell.n)) cells.push(`<c r="${ref}"${sa}><v>${cell.n}</v></c>`);
        else if (cell.k === 'b' && (cell.v === 'TRUE' || cell.v === 'FALSE')) cells.push(`<c r="${ref}"${sa} t="b"><v>${cell.v === 'TRUE' ? 1 : 0}</v></c>`);
        else if (cell.k === 'b' && ERR.has(cell.v)) cells.push(`<c r="${ref}"${sa} t="e"><v>${esc(cell.v)}</v></c>`);
        else if (cell.v === '' || cell.v === undefined) cells.push(`<c r="${ref}"${sa}/>`);
        else cells.push(`<c r="${ref}"${sa} t="s"><v>${sid(String(cell.v))}</v></c>`);
      }
      const h = m.rowH && m.rowH[r]; const ha = h === 0 ? ' hidden="1"' : h ? ` ht="${Math.round(h * 0.75 * 100) / 100}" customHeight="1"` : '';
      if (cells.length || ha) rows.push(`<row r="${r + 1}"${ha}>${cells.join('')}</row>`);
    }
    const cols = Object.keys(m.colW || {}).map(Number).sort((a, b) => a - b).map((c) => { const px = m.colW[c]; return `<col min="${c + 1}" max="${c + 1}" width="${px ? Math.round(Math.max(0, (px - 5) / 7) * 100) / 100 : 0}" customWidth="1"${px ? '' : ' hidden="1"'}/>`; });
    const fz = m.freeze && (m.freeze.rows || m.freeze.cols) ? `<pane${m.freeze.cols ? ` xSplit="${m.freeze.cols}"` : ''}${m.freeze.rows ? ` ySplit="${m.freeze.rows}"` : ''} topLeftCell="${colName(m.freeze.cols || 0)}${(m.freeze.rows || 0) + 1}" activePane="${m.freeze.rows && m.freeze.cols ? 'bottomRight' : m.freeze.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
    const mg = (m.merges || []).map((g) => `<mergeCell ref="${colName(g.c)}${g.r + 1}:${colName(g.c + g.cs - 1)}${g.r + g.rs}"/>`);
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView${i === 0 ? ' tabSelected="1"' : ''}${m.grid === false ? ' showGridLines="0"' : ''} workbookViewId="0">${fz}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols.length ? `<cols>${cols.join('')}</cols>` : ''}<sheetData>${rows.join('')}</sheetData>${mg.length ? `<mergeCells count="${mg.length}">${mg.join('')}</mergeCells>` : ''}</worksheet>`;
  });
  warnings.push('Formulas of the old file become their last stored values; charts and pictures are not carried.');
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${customFmts.length ? `<numFmts count="${customFmts.length}">${customFmts.map((c, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfList.length}">${xfList.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const strings = `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  const files = {
    '[Content_Types].xml': ct([['rels', RELS_T], ['xml', 'application/xml']], [['/xl/workbook.xml', `${SML}.sheet.main+xml`], ...sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, `${SML}.worksheet+xml`]), ['/xl/styles.xml', `${SML}.styles+xml`], ['/xl/sharedStrings.xml', `${SML}.sharedStrings+xml`]]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${wb.is1904 ? ' date1904="1"' : ''}/><bookViews><workbookView/></bookViews><sheets>${wb.names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([...sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]), [`rId${sheets.length + 1}`, 'styles', 'styles.xml'], [`rId${sheets.length + 2}`, 'sharedStrings', 'sharedStrings.xml']]),
    'xl/styles.xml': styles, 'xl/sharedStrings.xml': strings
  };
  sheets.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = x; });
  return { bytes: zip(files), warnings: [...new Set(warnings)] };
}

// ---- ppt -> pptx: one master, one layout (title and content), a notes master, a slide per slide with its title and body text, notes through the slide editor ----
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const NSP = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const phSp = (id, name, ph, xfrm, text) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const emu = (px) => Math.round(px * 9525);

export function pptToPptx(model) {
  const warnings = ['Layout, shapes and pictures of the old file are not carried; each slide holds its text.'];
  const W = emu(model.size.w); const H = emu(model.size.h);
  const xf = (x, y, w, h) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
  const slides = []; const notes = [];
  for (let i = 0; i < model.count; i++) {
    const s = model.load(i); let id = 1;
    const shapes = (s.items || []).filter((it) => it.t === 'shape' && it.text && it.text.paras && it.text.paras.length).map((it) => {
      id += 1; const title = it.role === 'title';
      const ps = it.text.paras.map((p) => {
        const run = p.runs && p.runs[0] ? p.runs[0] : { text: '', size: p.size || 24 }; const sz = Math.max(100, Math.round((run.size || p.size || 24) * 0.75 * 100));
        const algn = p.algn === 'center' ? 'ctr' : p.algn === 'right' ? 'r' : 'l';
        const bu = p.bullet ? `<a:buChar char="${esc(p.bullet.text || '\u2022')}"/>` : '<a:buNone/>';
        return `<a:p><a:pPr algn="${algn}" marL="${p.bullet ? emu(p.marL || 24) : 0}" indent="${p.bullet ? emu(p.indent || -24) : 0}">${bu}</a:pPr><a:r><a:rPr lang="en-US" sz="${sz}" dirty="0"/><a:t>${esc(p.runs ? p.runs.map((r) => r.text).join('') : '')}</a:t></a:r></a:p>`;
      }).join('');
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${title ? 'Title' : 'Content'} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${title ? 'type="title"' : 'idx="1"'}/></p:nvPr></p:nvSpPr><p:spPr>${xf(emu(it.x), emu(it.y), emu(it.w), emu(it.h))}</p:spPr><p:txBody><a:bodyPr${it.text.anchor === 'ctr' ? ' anchor="ctr"' : ''}><a:normAutofit/></a:bodyPr><a:lstStyle/>${ps}</p:txBody></p:sp>`;
    });
    slides.push(`${XML}<p:sld ${NSP}><p:cSld><p:spTree>${GRP}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    notes.push(s.notes || '');
  }
  if (!slides.length) throw new Error('This presentation has no slides to copy.');
  const tx = xf(Math.round(W * 0.06), Math.round(H * 0.05), Math.round(W * 0.88), Math.round(H * 0.2)); const bx = xf(Math.round(W * 0.06), Math.round(H * 0.28), Math.round(W * 0.88), Math.round(H * 0.66));
  const master = `${XML}<p:sldMaster ${NSP}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}${phSp(2, 'Title 1', 'type="title"', tx, 'Click to edit Master title style')}${phSp(3, 'Text Placeholder 2', 'type="body" idx="1"', bx, 'Click to edit Master text styles')}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4000"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="0" indent="0" algn="l"><a:buNone/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `${XML}<p:sldLayout ${NSP} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${GRP}${phSp(2, 'Title 1', 'type="title"', '', 'Click to edit Master title style')}${phSp(3, 'Content Placeholder 2', 'idx="1"', '', 'Click to edit Master text styles')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const notesMaster = `${XML}<p:notesMaster ${NSP}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
  const files = {
    '[Content_Types].xml': ct([['rels', RELS_T], ['xml', 'application/xml']], [['/ppt/presentation.xml', `${PML}.presentation.main+xml`], ['/ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`], ['/ppt/slideLayouts/slideLayout1.xml', `${PML}.slideLayout+xml`], ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'], ['/ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'], ['/ppt/notesMasters/notesMaster1.xml', `${PML}.notesMaster+xml`], ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, `${PML}.slide+xml`])]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `${XML}<p:presentation ${NSP}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 4}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'notesMaster', 'notesMasters/notesMaster1.xml'], ['rId3', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 4}`, 'slide', `slides/slide${i + 1}.xml`])]),
    'ppt/slideMasters/slideMaster1.xml': master, 'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': layout, 'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/notesMasters/notesMaster1.xml': notesMaster, 'ppt/notesMasters/_rels/notesMaster1.xml.rels': rels([['rId1', 'theme', '../theme/theme2.xml']]),
    'ppt/theme/theme1.xml': THEME, 'ppt/theme/theme2.xml': THEME
  };
  slides.forEach((x, i) => { files[`ppt/slides/slide${i + 1}.xml`] = x; files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]); });
  let bytes = zip(files);
  if (notes.some((n) => n.trim())) { // notes are written by the slide editor, which makes the notes parts
    try { const eng = openPptx(bytes); notes.forEach((n, i) => { if (n.trim()) eng.setNotes(i, n); }); bytes = eng.toBytes(); } catch { warnings.push('The notes of the old file could not be carried.'); }
  }
  return { bytes, warnings };
}
