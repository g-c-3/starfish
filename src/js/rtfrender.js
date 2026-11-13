// rtfrender.js — Rich Text (RTF) to a readable page (Decision 472). Text, paragraphs, bold, italic, underline, strikethrough, size, alignment,
// accents and symbols, and simple tables are kept. Fonts, colours, lists' numbering, pictures and headers are not: a picture shows as [picture].
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'footnote', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'fldinst', 'pntxtb', 'pntxta', 'private', 'shpinst', 'shprslt', 'objdata', 'bkmkstart', 'bkmkend', 'revtbl', 'userprops', 'pgptbl', 'mmathPr', 'wgrffmtfilter', 'falt', 'panose', 'fname']);
const SYM = { bullet: '\u2022', endash: '\u2013', emdash: '\u2014', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', tab: '\u00a0\u00a0\u00a0\u00a0', emspace: '\u2003', enspace: '\u2002', qmspace: '\u2005' };
const CP = { 437: 'ibm866', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 10000: 'macintosh', 65001: 'utf-8' };
const decoder = (cp) => { try { return new TextDecoder(CP[cp] || 'windows-1252'); } catch { return new TextDecoder('windows-1252'); } };

export function renderRtf(src) {
  const root = el('div', 'tr-md tr-rtf');
  let cp = 1252; let dc = decoder(cp);
  let st = { b: false, i: false, u: false, s: false, fs: 0, skip: false, uc: 1, align: '' };
  const stack = []; let skipN = 0; let pend = [];
  let box = root; let p = null; let buf = ''; let bufKey = '';
  let table = null; let tbody = null; let row = null; let cell = null; let inRow = false; let any = false;
  const key = () => `${+st.b}${+st.i}${+st.u}${+st.s}${st.fs}`;
  const ensureP = () => {
    if (p) return p;
    if (!inRow && table) { table = null; tbody = null; box = root; }
    p = el('p'); if (st.align) p.style.textAlign = st.align; box.appendChild(p); return p;
  };
  const flush = () => {
    if (!buf) return;
    const target = ensureP(); let node = document.createTextNode(buf); any = true;
    const k = bufKey; const fs = Number(k.slice(4)) || 0; // the style that was current when the text was buffered
    const wrap = (tag, on) => { if (on) { const w = el(tag); w.appendChild(node); node = w; } };
    wrap('del', k[3] === '1'); wrap('u', k[2] === '1'); wrap('em', k[1] === '1'); wrap('strong', k[0] === '1');
    if (fs && fs !== 24) { const w = el('span'); w.style.fontSize = `${Math.max(0.7, Math.min(3, fs / 24)).toFixed(2)}em`; w.appendChild(node); node = w; }
    target.appendChild(node); buf = '';
  };
  const put = (t) => { if (st.skip) return; const k = key(); if (buf && k !== bufKey) flush(); bufKey = k; buf += t; };
  const hex = () => { if (pend.length) { const t = dc.decode(new Uint8Array(pend)); pend = []; put(t); } };
  const endPara = () => { flush(); if (!p && !st.skip) { ensureP().appendChild(el('br')); } p = null; };
  let i = 0; const n = src.length; let groupStart = false;
  while (i < n) {
    const c = src[i];
    if (c === '{') { hex(); flush(); stack.push({ ...st }); i++; groupStart = true; continue; }
    if (c === '}') { hex(); flush(); if (stack.length) st = stack.pop(); i++; groupStart = false; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') {
      hex();
      if (skipN > 0) { skipN--; i++; groupStart = false; continue; }
      let j = i; while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;
      put(src.slice(i, j)); i = j; groupStart = false; continue;
    }
    // a control
    const nx = src[i + 1];
    if (nx === "'") {
      const h = src.slice(i + 2, i + 4); i += 4;
      if (skipN > 0) { skipN--; groupStart = false; continue; }
      const v = parseInt(h, 16); if (!Number.isNaN(v)) pend.push(v); groupStart = false; continue;
    }
    hex();
    if (nx === '\\' || nx === '{' || nx === '}') { if (skipN > 0) skipN--; else put(nx); i += 2; groupStart = false; continue; }
    if (nx === '*') { if (groupStart) st.skip = true; i += 2; groupStart = false; continue; }
    if (nx === '~') { put('\u00a0'); i += 2; groupStart = false; continue; }
    if (nx === '-' || nx === '_') { put(nx === '_' ? '\u2011' : '\u00ad'); i += 2; groupStart = false; continue; }
    const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
    if (!m) { i += 2; groupStart = false; continue; }
    i += m[0].length; const w = m[1]; const v = m[2] === undefined ? null : Number(m[2]);
    if (groupStart && SKIP.has(w)) st.skip = true;
    if (groupStart && w === 'pict') { if (!st.skip) { ensureP().appendChild(el('span', 'tr-img', '[picture]')); any = true; } st.skip = true; }
    groupStart = false;
    switch (w) {
      case 'ansicpg': cp = v; dc = decoder(cp); break;
      case 'mac': cp = 10000; dc = decoder(cp); break;
      case 'uc': st.uc = v === null ? 1 : v; break;
      case 'u': { flush(); const code = v < 0 ? v + 65536 : v; put(String.fromCharCode(code)); skipN = st.uc; break; }
      case 'par': case 'sect': endPara(); break;
      case 'line': flush(); if (!st.skip) { ensureP().appendChild(el('br')); } break;
      case 'pard': flush(); st.align = ''; break;
      case 'plain': flush(); st.b = st.i = st.u = st.s = false; st.fs = 0; break;
      case 'b': flush(); st.b = v !== 0; break;
      case 'i': flush(); st.i = v !== 0; break;
      case 'ul': case 'uld': case 'uldb': case 'ulw': flush(); st.u = v !== 0; break;
      case 'ulnone': flush(); st.u = false; break;
      case 'strike': case 'striked': flush(); st.s = v !== 0; break;
      case 'fs': flush(); st.fs = v || 0; break;
      case 'ql': st.align = ''; break;
      case 'qc': st.align = 'center'; break;
      case 'qr': st.align = 'right'; break;
      case 'qj': st.align = 'justify'; break;
      case 'trowd': { flush(); if (!table) { table = el('table'); tbody = el('tbody'); table.appendChild(tbody); const sc = el('div', 'tr-tscroll'); sc.appendChild(table); root.appendChild(sc); } row = el('tr'); cell = el('td'); box = cell; inRow = true; p = null; break; }
      case 'cell': { flush(); if (cell && row) { if (!cell.firstChild) cell.appendChild(document.createTextNode('\u00a0')); row.appendChild(cell); cell = el('td'); box = cell; p = null; } break; }
      case 'row': { flush(); if (row && tbody) tbody.appendChild(row); row = null; cell = null; inRow = false; box = root; p = null; break; }
      default:
        if (SYM[w] !== undefined && !st.skip) put(SYM[w]);
    }
  }
  hex(); flush();
  if (!any) root.appendChild(el('p', 'tr-img', 'This file has no readable text.'));
  return root;
}
