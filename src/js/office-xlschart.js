// office-xlschart.js — reads the chart stream of an .xls chart object into the chart model of the .xlsx reader (office-read.js
// readChart), which office-chart.js draws (Decision 521). Chart records are read in order; the nesting of begin and end records
// says where a record belongs. Series data is resolved from the sheet cells the series formulas point to, by `range`.

const PAL = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const CHART_PTS = 500; const CHART_SERIES = 40;
const hex = (d, o) => [d[o], d[o + 1], d[o + 2]].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const f64 = (d, o) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);
const ustr = (d, o) => { const n = d[o]; const w = d[o + 1] & 1; let s = ''; for (let i = 0; i < n; i++) { const p = o + 2 + i * (w ? 2 : 1); if (p + (w ? 2 : 1) > d.length) break; s += String.fromCharCode(w ? u16(d, p) : d[p]); } return s; };
const LEGEND = { 0: 'b', 1: 'tr', 2: 't', 3: 'r', 4: 'l' };

export function readXlsChart(recs, range) {
  const stack = []; let last = 0;
  const series = []; const groups = []; const axes = {};
  let cur = null; let curDF = null; let gcur = null; let axCur = null; let curText = null; let legend = null; let title = ''; let ap = 0;
  const axTitle = {};
  const top = () => stack[stack.length - 1];
  for (const r of recs) {
    const id = r.id; const d = r.data;
    if (id === 0x1033) { stack.push(last); continue; } // begin: the record before it opened the container
    if (id === 0x1034) { const t = stack.pop(); if (t === 0x1006) curDF = null; else if (t === 0x101d) axCur = null; else if (t === 0x1003) cur = null; continue; }
    last = id;
    try {
      switch (id) {
        case 0x1003: if (series.length < CHART_SERIES) { cur = { ai: {}, name: null, fill: null, line: null, lineNone: false, marker: null, dpt: {}, labels: undefined, grp: 0, smooth: false }; series.push(cur); } else cur = null; break;
        case 0x1051: if (top() === 0x1003 && cur && d.length >= 8) cur.ai[d[0]] = { rt: d[1], rgce: d.subarray(8, 8 + u16(d, 6)) }; break;
        case 0x100d: { const t = ustr(d, 2); if (top() === 0x1003 && cur) cur.name = t; else if (top() === 0x1025) curText = t; break; }
        case 0x1025: curText = null; break;
        case 0x1027: { const l = u16(d, 0); if (curText !== null) { if (l === 1) title = curText; else axTitle[l] = curText; } break; }
        case 0x1006: curDF = { xi: u16(d, 0) }; break;
        case 0x100a: if (top() === 0x1006 && cur && curDF && u16(d, 8) !== 0) { const c = hex(d, 0); if (curDF.xi === 0xffff) cur.fill = c; else cur.dpt[curDF.xi] = c; } break;
        case 0x1007: if (top() === 0x1006 && cur && curDF && curDF.xi === 0xffff) { if (u16(d, 4) === 5) cur.lineNone = true; else cur.line = hex(d, 0); } break;
        case 0x1009: if (top() === 0x1006 && cur && curDF && curDF.xi === 0xffff) cur.marker = u16(d, 8) !== 0; break;
        case 0x100c: if (top() === 0x1006 && cur && curDF && curDF.xi === 0xffff) { const g = u16(d, 0); cur.labels = { val: !!(g & 1), pct: !!(g & 6), cat: !!(g & 8), fmt: null }; } break;
        case 0x1045: if (cur) cur.grp = u16(d, 0); break;
        case 0x1041: ap++; break;
        case 0x1014: gcur = { kind: null, ap, gap: 150, hole: 50, dir: 'col', grouping: 'standard', style: 'lineMarker' }; groups.push(gcur); break;
        case 0x1017: if (gcur) { const g = u16(d, 4); gcur.kind = 'bar'; gcur.gap = u16(d, 2); gcur.dir = g & 1 ? 'bar' : 'col'; gcur.grouping = g & 4 ? 'percentStacked' : g & 2 ? 'stacked' : 'clustered'; } break;
        case 0x1018: if (gcur) { const g = u16(d, 0); gcur.kind = 'line'; gcur.grouping = g & 2 ? 'percentStacked' : g & 1 ? 'stacked' : 'standard'; } break;
        case 0x101a: if (gcur) { const g = u16(d, 0); gcur.kind = 'area'; gcur.grouping = g & 2 ? 'percentStacked' : g & 1 ? 'stacked' : 'standard'; } break;
        case 0x1019: if (gcur) { gcur.hole = u16(d, 2); gcur.kind = gcur.hole ? 'doughnut' : 'pie'; } break;
        case 0x101b: if (gcur) gcur.kind = d.length >= 6 && u16(d, 4) & 1 ? 'bubble' : 'scatter'; break;
        case 0x103e: case 0x103f: case 0x1040: if (gcur) gcur.kind = 'skip'; break; // radar and surface groups
        case 0x1015: if (d.length >= 17) legend = LEGEND[d[16]] || 'r'; break;
        case 0x101d: axCur = { type: u16(d, 0), ap, grid: false, min: null, max: null, rev: false }; axes[`${ap}:${axCur.type}`] = axCur; break;
        case 0x101f: if (axCur && d.length >= 42) { const g = u16(d, 40); const lo = f64(d, 0); const hi = f64(d, 8); if (!(g & 1) && !(g & 2) && hi > lo) { axCur.min = lo; axCur.max = hi; } else { if (!(g & 1) && lo !== 0) axCur.min = lo; if (!(g & 2) && hi !== 0) axCur.max = hi; } axCur.rev = !!(g & 0x40); } break;
        case 0x1021: if (axCur && u16(d, 0) === 1) axCur.grid = true; break;
        default: break;
      }
    } catch { /* a record this reader cannot follow is skipped */ }
  }
  const ok = groups.filter((g) => g.kind && g.kind !== 'skip');
  if (!ok.length || !series.length) return null;
  const toNum = (c) => (c && c.k === 'n' && c.n !== undefined ? c.n : c && c.v !== '' && c.v !== undefined && !Number.isNaN(Number(c.v)) ? Number(c.v) : null);
  const palette = (i) => PAL[i % 6];
  const grpOf = (s) => (groups[s.grp] && ok.includes(groups[s.grp]) ? groups[s.grp] : ok[0]);
  const built = new Map(ok.map((g) => [g, { ...g, series: [] }]));
  let idx = 0;
  for (const s of series) {
    const g = built.get(grpOf(s)); const kind = g.kind; const isLine = kind === 'line' || kind === 'scatter';
    const cells = (k) => { const a = s.ai[k]; const x = a ? range(a.rgce) : null; return x ? x.slice(0, CHART_PTS) : null; };
    const nameCells = cells(0); const name = nameCells && nameCells.length && nameCells[0].v !== undefined && nameCells[0].v !== '' ? String(nameCells[0].v) : s.name || '';
    const valC = cells(1) || []; const catC = cells(2);
    const xy = kind === 'scatter' || kind === 'bubble';
    const vals = valC.map(toNum);
    let color; if (isLine) color = s.line || s.fill || palette(idx); else color = s.fill || s.line || palette(idx);
    const ser = { name, color, noLine: isLine && s.lineNone, w: null, smooth: false, marker: kind === 'scatter' ? s.marker !== false : !!s.marker, cats: catC ? catC.map((c) => (c && c.v !== undefined ? String(c.v) : '')) : [], vals, fmt: null,
      xs: xy ? (catC || []).map(toNum) : null, size: kind === 'bubble' ? (cells(3) || []).map(toNum) : null, labels: s.labels, dpt: s.dpt };
    if (kind === 'pie' || kind === 'doughnut') ser.pcolors = vals.map((_, i) => s.dpt[i] || palette(i));
    g.series.push(ser); idx++;
  }
  const outGroups = []; const outAxes = {};
  for (const g of ok) {
    const b = built.get(g); if (!b.series.length) continue;
    const xy = b.kind === 'scatter' || b.kind === 'bubble'; const horiz = b.kind === 'bar' && b.dir === 'bar';
    const polar = b.kind === 'pie' || b.kind === 'doughnut';
    const a0 = axes[`${b.ap}:0`]; const a1 = axes[`${b.ap}:1`]; const cid = `c${b.ap}`; const vid = `v${b.ap}`;
    if (!polar) {
      if (!outAxes[vid]) outAxes[vid] = { id: vid, kind: 'val', pos: xy ? 'l' : horiz ? 'b' : 'l', min: a1 ? a1.min : null, max: a1 ? a1.max : null, rev: !!(a1 && a1.rev), del: false, title: axTitle[2] || '', fmt: null, grid: a1 ? a1.grid : true };
      if (!outAxes[cid]) outAxes[cid] = { id: cid, kind: xy ? 'val' : 'cat', pos: xy ? 'b' : horiz ? 'l' : 'b', min: xy && a0 ? a0.min : null, max: xy && a0 ? a0.max : null, rev: !!(a0 && a0.rev && !xy), del: false, title: axTitle[3] || '', fmt: null, grid: !!(a0 && a0.grid) };
    }
    outGroups.push({ kind: b.kind, dir: b.dir, grouping: b.grouping, axIds: polar ? [] : [cid, vid], gap: b.gap, hole: b.hole, style: b.style, labels: null, series: b.series });
  }
  if (!outGroups.length) return null;
  return { title, autoTitle: false, legend, axes: outAxes, groups: outGroups };
}
