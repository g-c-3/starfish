// Draws the charts of an .xls with the app's chart code to ch0.svg, ch1.svg ... in the current folder. Usage: node charts.mjs file.xls
// To see them: python3 -c "import cairosvg;cairosvg.svg2png(url='ch0.svg',write_to='ch0.png',background_color='white')"
import fs from 'fs';
import { JSDOM } from 'jsdom';
const SRC = process.env.SRC || '/home/claude/repo/src/js';
globalThis.document = new JSDOM('<!doctype html><body></body>').window.document;
const { readXls } = await import(`${SRC}/office-xls.js`); const { chartSvg } = await import(`${SRC}/office-chart.js`);
const s = readXls(new Uint8Array(fs.readFileSync(process.argv[2]))).load(Number(process.argv[3] || 0)); let k = 0;
for (const o of s.objects) if (o.t === 'chart') {
  let t = chartSvg(o.model, 420, 260, '#222').outerHTML.replace(/ style="[^"]*"/, '').replace(/currentColor/g, '#222').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  t = t.replace(/^(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="#fff"/>'); fs.writeFileSync(`ch${k++}.svg`, t);
}
console.log('charts', k);
