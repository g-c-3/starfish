// textrender.js — the rendered view of Markdown and HTML files (Decision 466).
// Markdown: parsed here and built with DOM calls, never innerHTML; raw HTML in it shows as text. HTML: cleaned, then shown in a sandboxed
// frame with a content policy that allows nothing but inline style and data: images. Scripts never run; remote content never loads;
// links do not open (the app makes no other network calls). Pictures that are not data: show as [image: description].
import '../css/textrender.css';

export const RENDER_MAX = 1024 * 1024; // characters; a larger file stays source only
const LINE_MAX = 20000; // an inline run longer than this stays plain text
export const canRender = (name) => /\.(md|markdown|mdown|html?|xhtml)$/i.test(name || '');
const isHtml = (name) => /\.(html?|xhtml)$/i.test(name || '');
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const txt = (s) => document.createTextNode(s);

// ---- Markdown ----
const INL = /\\(?<esc>[\\`*_{}\[\]()#+\-.!~|>])|(?<ticks>`+)(?<code>[\s\S]*?[^`])\k<ticks>(?!`)|!\[(?<ialt>[^\]]*)\]\((?<isrc>[^)\s]*)(?:\s+"[^"]*")?\)|\[(?<ltext>(?:[^\[\]]|\[[^\]]*\])*)\]\((?<lurl>[^)\s]*)(?:\s+"[^"]*")?\)|<(?<auto>https?:\/\/[^>\s]+)>|(?<bare>https?:\/\/[^\s<]*[^\s<.,;:!?)\]])|(?<sm>\*\*|__)(?=\S)(?<strong>[\s\S]*?\S)\k<sm>|(?<em1>[*_])(?=\S)(?<em>[\s\S]*?\S)\k<em1>|~~(?=\S)(?<del>[\s\S]*?\S)~~|(?<br> {2,}\n|\\\n)/g;

function inline(src, parent, depth = 0) {
  if (src.length > LINE_MAX || depth > 6) { parent.appendChild(txt(src)); return; }
  const re = new RegExp(INL.source, 'g'); let last = 0; let m;
  while ((m = re.exec(src))) {
    const g = m.groups;
    if ((g.em || g.strong) && m[0][0] === '_' && m.index > 0 && /\w/.test(src[m.index - 1])) { re.lastIndex = m.index + 1; continue; } // snake_case stays text
    if (m.index > last) parent.appendChild(txt(src.slice(last, m.index)));
    last = re.lastIndex;
    if (g.esc !== undefined) parent.appendChild(txt(g.esc));
    else if (g.code !== undefined) { const c = g.code; parent.appendChild(el('code', '', c.length > 2 && c[0] === ' ' && c.at(-1) === ' ' ? c.slice(1, -1) : c)); }
    else if (g.ialt !== undefined) parent.appendChild(el('span', 'tr-img', `[image: ${g.ialt || 'picture'}]`));
    else if (g.ltext !== undefined) { const a = el('span', 'tr-a'); a.title = g.lurl; inline(g.ltext, a, depth + 1); parent.appendChild(a); }
    else if (g.auto !== undefined || g.bare !== undefined) { const u = g.auto || g.bare; const a = el('span', 'tr-a', u); a.title = u; parent.appendChild(a); }
    else if (g.strong !== undefined) { const s = el('strong'); inline(g.strong, s, depth + 1); parent.appendChild(s); }
    else if (g.em !== undefined) { const s = el('em'); inline(g.em, s, depth + 1); parent.appendChild(s); }
    else if (g.del !== undefined) { const s = el('del'); inline(g.del, s, depth + 1); parent.appendChild(s); }
    else if (g.br !== undefined) parent.appendChild(el('br'));
  }
  if (last < src.length) parent.appendChild(txt(src.slice(last)));
}

const LI = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const HR = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEAD = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const QUOTE = /^ {0,3}>/;
const TDELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const starts = (l) => FENCE.test(l) || HEAD.test(l) || HR.test(l) || QUOTE.test(l) || LI.test(l);
const cells = (l) => { let s = l.trim(); if (s[0] === '|') s = s.slice(1); if (s.at(-1) === '|' && s.at(-2) !== '\\') s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')); };

function blocks(lines, parent, depth) {
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i]; let m;
    if (!ln.trim()) { i++; continue; }
    if ((m = FENCE.exec(ln))) {
      const f = m[1]; const close = new RegExp(`^ {0,3}${f[0] === '`' ? '`' : '~'}{${f.length},}\\s*$`); const buf = []; i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++; const pre = el('pre'); pre.appendChild(el('code', '', buf.join('\n'))); parent.appendChild(pre); continue;
    }
    if ((m = HEAD.exec(ln))) { const h = el(`h${m[1].length}`); inline(m[2], h); parent.appendChild(h); i++; continue; }
    if (HR.test(ln)) { parent.appendChild(el('hr')); i++; continue; }
    if (QUOTE.test(ln)) {
      const buf = []; while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      const q = el('blockquote'); if (depth < 8) blocks(buf, q, depth + 1); else q.textContent = buf.join('\n'); parent.appendChild(q); continue;
    }
    if (ln.includes('|') && i + 1 < lines.length && TDELIM.test(lines[i + 1]) && lines[i + 1].includes('-') && (lines[i + 1].includes('|') || cells(ln).length > 1)) {
      const head = cells(ln); const al = cells(lines[i + 1]).map((c) => (c[0] === ':' && c.at(-1) === ':' ? 'center' : c.at(-1) === ':' ? 'right' : c[0] === ':' ? 'left' : ''));
      i += 2; const t = el('table'); const th = el('thead'); const tr = el('tr');
      head.forEach((c, k) => { const x = el('th'); if (al[k]) x.style.textAlign = al[k]; inline(c, x); tr.appendChild(x); }); th.appendChild(tr); t.appendChild(th);
      const tb = el('tbody'); let rows = 0;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && rows < 5000) {
        const r = el('tr'); const cs = cells(lines[i++]); rows++;
        for (let k = 0; k < head.length; k++) { const x = el('td'); if (al[k]) x.style.textAlign = al[k]; inline(cs[k] || '', x); r.appendChild(x); }
        tb.appendChild(r);
      }
      t.appendChild(tb); const sc = el('div', 'tr-tscroll'); sc.appendChild(t); parent.appendChild(sc); continue;
    }
    if (LI.test(ln)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i]; const mm = LI.exec(l);
        if (mm && !HR.test(l)) { items.push({ indent: mm[1].length, ord: /\d/.test(mm[2]), start: parseInt(mm[2], 10), text: [mm[3]] }); i++; }
        else if (l.trim() && /^\s+\S/.test(l) && items.length) { items.at(-1).text.push(l.trim()); i++; }
        else if (!l.trim() && i + 1 < lines.length && (LI.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1])) && items.length) i++;
        else break;
      }
      const mk = (it) => { const l = el(it.ord ? 'ol' : 'ul'); if (it.ord && it.start > 1) l.start = it.start; return l; };
      const root = mk(items[0]); parent.appendChild(root); const stack = [{ indent: items[0].indent, list: root }];
      for (const it of items) {
        while (stack.length > 1 && it.indent < stack.at(-1).indent) stack.pop();
        if (it.indent > stack.at(-1).indent && stack.length < 8) {
          const host = stack.at(-1).list.lastElementChild;
          if (host) { const nl = mk(it); host.appendChild(nl); stack.push({ indent: it.indent, list: nl }); }
        }
        const li = el('li'); let t = it.text.join('\n'); const tk = /^\[([ xX])\]\s+/.exec(t);
        if (tk) { li.className = 'tr-task'; li.appendChild(el('span', 'tr-box', tk[1] === ' ' ? '\u2610' : '\u2611')); t = t.slice(tk[0].length); }
        inline(t, li); stack.at(-1).list.appendChild(li);
      }
      continue;
    }
    if (/^( {4}|\t)/.test(ln)) {
      const buf = []; while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) buf.push(lines[i++].replace(/^( {4}|\t)/, ''));
      while (buf.length && !buf.at(-1).trim()) buf.pop(); const pre = el('pre'); pre.appendChild(el('code', '', buf.join('\n'))); parent.appendChild(pre); continue;
    }
    const buf = [ln.replace(/^\s+/, '')]; i++; let level = 0;
    while (i < lines.length && lines[i].trim()) {
      const se = /^ {0,3}(=+|-+)\s*$/.exec(lines[i]);
      if (se) { level = se[1][0] === '=' ? 1 : 2; i++; break; }
      if (starts(lines[i])) break;
      buf.push(lines[i++].replace(/^\s+/, ''));
    }
    const p = el(level ? `h${level}` : 'p'); inline(buf.join('\n'), p); parent.appendChild(p);
  }
}

export function renderMarkdown(text) {
  const root = el('div', 'tr-md');
  let t = text.replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
  if (fm) { const pre = el('pre', 'tr-fm'); pre.appendChild(el('code', '', fm[1])); root.appendChild(pre); t = t.slice(fm[0].length); }
  blocks(t.split('\n'), root, 0);
  return root;
}

// ---- HTML ----
const DROP = 'script,iframe,frame,frameset,object,embed,applet,link,base,meta,noembed,portal,template,audio,video,source,track,canvas,use';
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'data', 'background', 'action', 'formaction', 'xlink:href', 'ping', 'cite', 'longdesc', 'usemap', 'manifest', 'codebase', 'icon']);
const POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
const cssClean = (s) => s.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?data:)[^)]*\)/gi, 'none');

// the text of an HTML file -> a complete, inert document
export function cleanHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc.querySelectorAll(DROP).forEach((n) => n.remove());
  for (const n of doc.querySelectorAll('*')) {
    for (const a of [...n.attributes]) {
      const k = a.name.toLowerCase();
      if (k.startsWith('on') || k === 'target' || k === 'srcdoc' || k === 'ping') n.removeAttribute(a.name);
      else if (URL_ATTRS.has(k) && !/^\s*data:image\//i.test(a.value)) n.removeAttribute(a.name);
      else if (k === 'style') { if (/@import|expression\s*\(/i.test(a.value) || /url\(\s*(?!['"]?data:)/i.test(a.value)) n.setAttribute('style', cssClean(a.value)); }
    }
    if (n.localName === 'style') n.textContent = cssClean(n.textContent);
  }
  for (const im of [...doc.querySelectorAll('img,image,input[type=image]')]) {
    if (!im.getAttribute('src') && !im.getAttribute('href')) { const s = doc.createElement('span'); s.textContent = `[image: ${im.getAttribute('alt') || 'picture'}]`; im.replaceWith(s); }
  }
  const head = doc.head;
  const base = doc.createElement('style'); base.textContent = 'html{background:#fff;color:#111;color-scheme:light;font-family:sans-serif;line-height:1.45}img,svg,video{max-width:100%;height:auto}a{cursor:default}';
  const m1 = doc.createElement('meta'); m1.setAttribute('http-equiv', 'Content-Security-Policy'); m1.setAttribute('content', POLICY);
  const m2 = doc.createElement('meta'); m2.setAttribute('charset', 'utf-8');
  const m3 = doc.createElement('meta'); m3.setAttribute('name', 'viewport'); m3.setAttribute('content', 'width=device-width, initial-scale=1');
  head.prepend(m1, m2, m3, base);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

// ---- the switch ----
// opts: { wrap (the .ev-text-wrap), host (the code view), name, getText(), addTool(icon, title, fn) -> button, onSwap(rendered), ui }
// The two views fade by the one recipe, opacity only, as the editor panels (Decision 438): the old one leaves, the new one arrives after
// the gap. Returns null when the file is too large to render.
export function mountRender(opts) {
  const { wrap, host, name, getText, addTool, onSwap, ui } = opts;
  if (getText().length > RENDER_MAX) return null;
  let pane = null; let rendered = false; let size = 16; let timer = 0; let gone = false;
  const fadeOut = (n) => { n.classList.add('tr-fade', 'hidden', 'mx-out'); setTimeout(() => n.classList.remove('mx-out'), 200); };
  const fadeIn = (n) => { n.classList.add('tr-fade', 'mx-after'); n.classList.remove('hidden', 'mx-out'); };
  const build = () => {
    const p = el('div', `tr-pane ${isHtml(name) ? 'tr-html' : 'tr-mdpane'} hidden`);
    if (isHtml(name)) {
      const f = document.createElement('iframe'); f.className = 'tr-frame'; f.setAttribute('sandbox', ''); f.setAttribute('referrerpolicy', 'no-referrer'); f.title = 'Rendered page';
      f.srcdoc = cleanHtml(getText()); p.appendChild(f);
    } else {
      p.style.setProperty('--tr-size', `${size}px`); p.appendChild(renderMarkdown(getText()));
    }
    return p;
  };
  const btn = addTool('eye', 'View rendered', () => {
    if (gone) return; if (ui && ui.onActivity) ui.onActivity();
    rendered = !rendered;
    if (rendered) {
      if (pane) pane.remove(); pane = build(); wrap.appendChild(pane); // rebuilt each time: an edited file shows its current text
      void pane.offsetWidth; fadeOut(host); fadeIn(pane);
    } else { fadeOut(pane); fadeIn(host); }
    btn.classList.toggle('on', rendered); btn.title = rendered ? 'View source' : 'View rendered'; btn.setAttribute('aria-label', btn.title);
    onSwap(rendered);
  });
  // two fingers change the size of a rendered Markdown page, as in the source view (a framed HTML page keeps its own)
  const onStart = (e) => { if (e.touches.length === 2 && pane && !isHtml(name)) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), s: size }; };
  let pinch = null; let raf = 0;
  const onMove = (e) => {
    if (!pinch || e.touches.length !== 2) return; e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    size = Math.max(10, Math.min(42, pinch.s * (d / pinch.d)));
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pane) pane.style.setProperty('--tr-size', `${size}px`); });
  };
  const onEnd = (e) => { if (e.touches.length < 2) pinch = null; };
  wrap.addEventListener('touchstart', onStart, { passive: true }); wrap.addEventListener('touchmove', onMove, { passive: false });
  wrap.addEventListener('touchend', onEnd, { passive: true }); wrap.addEventListener('touchcancel', onEnd, { passive: true });
  return {
    button: btn, get rendered() { return rendered; },
    destroy() {
      gone = true; clearTimeout(timer); if (raf) cancelAnimationFrame(raf);
      wrap.removeEventListener('touchstart', onStart); wrap.removeEventListener('touchmove', onMove); wrap.removeEventListener('touchend', onEnd); wrap.removeEventListener('touchcancel', onEnd);
      if (pane) { const f = pane.querySelector('iframe'); if (f) f.srcdoc = ''; pane.remove(); pane = null; }
    }
  };
}
