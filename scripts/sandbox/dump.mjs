// Prints what a reader makes of an old file. Usage: node dump.mjs file.ppt|file.xls [sheetOrSlide]
// SRC = the source folder of the app (default /home/claude/repo/src/js).
import fs from 'fs';
const SRC = process.env.SRC || '/home/claude/repo/src/js';
const file = process.argv[2]; const k = Number(process.argv[3] || 0);
const bytes = new Uint8Array(fs.readFileSync(file));
const box = (it) => `@${Math.round(it.x)},${Math.round(it.y)} ${Math.round(it.w)}x${Math.round(it.h)}`;
if (file.endsWith('.ppt')) {
  const { readPpt } = await import(`${SRC}/office-ppt.js`); const m = readPpt(bytes);
  console.log('slides', m.count, 'size', m.size, m.notice ? '\nnotice: ' + m.notice : '');
  const s = m.load(k); console.log('slide', k, 'bg', JSON.stringify(s.bg), 'media', Object.keys(s.media || {}).join(','));
  const walk = (items, d = 0) => { for (const it of items) { const pad = ' '.repeat(d);
    if (it.t === 'group') { console.log(pad + 'group'); walk(it.items, d + 1); continue; }
    if (it.t === 'pic') { console.log(`${pad}pic ${it.path} ${box(it)} rot ${it.rot} crop ${JSON.stringify(it.crop)}`); continue; }
    console.log(`${pad}${it.role || 'shape'} ${it.geom} ${box(it)}${it.cust ? ' custom' : ''}${it.fill ? ' fill ' + (it.fill.hex || 'grad') : ''}${it.line ? ' line ' + it.line.color.hex : ''}${it.fh ? ' flipH' : ''}${it.fv ? ' flipV' : ''}`);
    if (it.text) for (const p of it.text.paras) console.log(`${pad}  ${p.algn} L${p.marL}/${p.indent}${p.bullet ? ' bullet ' + p.bullet.text : ''}: ` + p.runs.map((r) => (r.br ? '<br>' : `${r.text}[${r.size}${r.b ? 'b' : ''}${r.i ? 'i' : ''}${r.u ? 'u' : ''} ${r.font} ${r.color.hex}]`)).join(' | ')); } };
  walk(s.items);
} else if (file.endsWith('.xls')) {
  const { readXls } = await import(`${SRC}/office-xls.js`); const m = readXls(bytes);
  console.log('sheets', m.names.join(', ')); const s = m.load(k);
  console.log('rows', s.rows.length, 'cols', s.ncols, 'hasDrawing', s.hasDrawing, 'objects', s.objects.length);
  for (const o of s.objects) {
    const at = `${JSON.stringify(o.from)} -> ${JSON.stringify(o.to)}`;
    if (o.t === 'chart') { const c = o.model; console.log('chart', at, JSON.stringify(c.title), 'legend', c.legend); for (const g of c.groups) { console.log(' ', g.kind, g.dir, g.grouping); for (const x of g.series) console.log('   ', JSON.stringify(x.name), x.color, JSON.stringify(x.vals), JSON.stringify(x.cats)); } }
    else if (o.t === 'shape') console.log('shape', o.geom, o.fill, JSON.stringify(o.line), JSON.stringify(o.text), at);
    else console.log(o.t, o.path, at);
  }
} else console.log('a .ppt or .xls file');
