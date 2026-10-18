// office-chart.js — draws a chart model from office-read.js (readChart) as SVG: bar, column, line, area, pie, doughnut,
// scatter, bubble and radar, singly or combined (Decision 233). Values are the ones cached in the file; every string is
// set with textContent. Text uses currentColor, so the caller sets the ink.

import { formatValue } from './office-read.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, parent, text) => {
  const n = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
};
const lumOf = (h) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const inkOn = (hex) => (lumOf(hex) > 0.55 ? '#111111' : '#ffffff');
const hexOf = (c) => (c ? `#${c}` : 'none');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);
const general = (v) => String(parseFloat(Number(v).toPrecision(6)));
const fmt = (v, code) => { if (v === null || v === undefined) return ''; if (!code) return general(v); try { return formatValue(String(v), code, false); } catch { return general(v); } };

function niceScale(lo, hi, want) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, want); const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
}
const ticksOf = (sc) => { const t = []; for (let v = sc.min; v <= sc.max + sc.step * 1e-6; v += sc.step) t.push(Math.abs(v) < sc.step * 1e-9 ? 0 : v); return t; };
function smoothPath(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function chartSvg(m, W, H, ink = 'currentColor') {
  W = Math.max(80, Math.round(W)); H = Math.max(60, Math.round(H));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
  svg.style.display = 'block'; svg.style.maxWidth = '100%'; svg.style.height = 'auto';
  if (ink !== 'currentColor') svg.style.color = ink;
  const fs = Math.max(10, Math.min(16, W / 42));
  const T = (x, y, s, o = {}, parent = svg) => {
    const a = { x, y, 'font-size': o.size || fs, 'text-anchor': o.anchor || 'middle', fill: o.fill || 'currentColor', 'font-family': 'Calibri, Carlito, "Open Sans", sans-serif' };
    if (o.rot) a.transform = `rotate(${o.rot} ${x} ${y})`;
    if (o.bold) a['font-weight'] = '700';
    return sv('text', a, parent, s);
  };
  const line = (x1, y1, x2, y2, op, parent = svg) => sv('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-opacity': op, 'stroke-width': 1 }, parent);

  const groups = m.groups;
  const first = groups[0];
  const polar = first.kind === 'pie' || first.kind === 'doughnut' || first.kind === 'radar';
  const single = groups.length === 1 && first.series.length === 1 ? first.series[0].name : '';
  const title = m.title || (m.autoTitle ? single : '');

  // ---- margins: title, legend ----
  let top = 6; let bottom = 6; let left = 6; let right = 6;
  if (title) { T(W / 2, top + fs * 1.15, clip(title, Math.floor(W / (fs * 0.62))), { size: fs * 1.25 }); top += fs * 2; }
  let legendEntries = [];
  if (m.legend) {
    legendEntries = (first.kind === 'pie' || first.kind === 'doughnut')
      ? (first.series[0].cats.length ? first.series[0].cats : first.series[0].vals.map((_, i) => String(i + 1))).map((n, i) => ({ name: n || String(i + 1), color: first.series[0].pcolors[i] }))
      : groups.flatMap((g) => g.series.map((s) => ({ name: s.name || 'Series', color: s.color })));
  }
  const entW = (e) => Math.min(W * 0.4, e.name.length * fs * 0.58 + fs * 1.9);
  let legendDraw = null;
  if (legendEntries.length) {
    const side = m.legend === 'l' || m.legend === 'r' || m.legend === 'tr';
    if (side) {
      const lw = Math.max(...legendEntries.map(entW)) + 6;
      const lh = fs * 1.5;
      const place = m.legend === 'l' ? 'l' : 'r';
      if (place === 'l') left += lw; else right += lw;
      legendDraw = () => {
        const x = place === 'l' ? 6 : W - lw; const y0 = top + (H - top - bottom - legendEntries.length * lh) / 2;
        legendEntries.slice(0, Math.floor((H - top - bottom) / lh)).forEach((e, i) => {
          sv('rect', { x, y: y0 + i * lh + lh * 0.2, width: fs * 0.8, height: fs * 0.8, fill: hexOf(e.color) }, svg);
          T(x + fs * 1.1, y0 + i * lh + lh * 0.72, clip(e.name, Math.floor((lw - fs * 1.2) / (fs * 0.58))), { anchor: 'start' });
        });
      };
    } else {
      const rowsOf = []; let cur = []; let cw = 0;
      for (const e of legendEntries) { const w = entW(e); if (cur.length && cw + w > W - 16) { rowsOf.push(cur); cur = []; cw = 0; } cur.push(e); cw += w; }
      if (cur.length) rowsOf.push(cur);
      const rh = fs * 1.5; const hgt = Math.min(rowsOf.length, 3) * rh + 4; const atTop = m.legend === 't';
      if (atTop) top += hgt; else bottom += hgt;
      legendDraw = () => {
        const yBase = atTop ? top - hgt : H - bottom;
        rowsOf.slice(0, 3).forEach((row, ri) => {
          let x = (W - row.reduce((a, e) => a + entW(e), 0)) / 2;
          for (const e of row) {
            sv('rect', { x, y: yBase + ri * rh + rh * 0.25, width: fs * 0.8, height: fs * 0.8, fill: hexOf(e.color) }, svg);
            T(x + fs * 1.1, yBase + ri * rh + rh * 0.78, clip(e.name, Math.floor((entW(e) - fs * 1.2) / (fs * 0.58))), { anchor: 'start' });
            x += entW(e);
          }
        });
      };
    }
  }

  // ---- pie, doughnut ----
  if (first.kind === 'pie' || first.kind === 'doughnut') {
    const s = first.series[0];
    const vals = s.vals.map((v) => (v && v > 0 ? v : 0)); const sum = vals.reduce((a, b) => a + b, 0);
    const pw = W - left - right; const ph = H - top - bottom;
    const cx = left + pw / 2; const cy = top + ph / 2; const r = Math.max(10, Math.min(pw, ph) / 2 - 4);
    const lab = s.labels === undefined ? first.labels : s.labels;
    if (sum > 0) {
      let a0 = -Math.PI / 2;
      const hole = first.kind === 'doughnut' ? r * Math.max(0.1, Math.min(0.9, first.hole / 100)) : 0;
      vals.forEach((v, i) => {
        if (!v) return;
        const a1 = a0 + (v / sum) * Math.PI * 2; const col = s.pcolors[i];
        const pt = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
        if (v / sum > 0.9999) {
          const ring = (q) => `M${cx - q},${cy}a${q},${q} 0 1,0 ${2 * q},0a${q},${q} 0 1,0 ${-2 * q},0Z`;
          sv('path', { d: hole ? ring(r) + ring(hole) : ring(r), 'fill-rule': 'evenodd', fill: hexOf(col) }, svg);
        } else {
          const big = a1 - a0 > Math.PI ? 1 : 0;
          const d = hole ? `M${pt(r, a0)}A${r},${r} 0 ${big} 1 ${pt(r, a1)}L${pt(hole, a1)}A${hole},${hole} 0 ${big} 0 ${pt(hole, a0)}Z` : `M${cx},${cy}L${pt(r, a0)}A${r},${r} 0 ${big} 1 ${pt(r, a1)}Z`;
          sv('path', { d, fill: hexOf(col), stroke: '#ffffff', 'stroke-opacity': 0.7, 'stroke-width': 1 }, svg);
        }
        if (lab && (lab.val || lab.pct || lab.cat) && v / sum > 0.04) {
          const am = (a0 + a1) / 2; const rr = hole ? (r + hole) / 2 : r * 0.64;
          const parts = [];
          if (lab.cat && s.cats[i]) parts.push(clip(s.cats[i], 12));
          if (lab.val) parts.push(fmt(s.vals[i], lab.fmt || s.fmt));
          if (lab.pct) parts.push(`${Math.round((v / sum) * 100)}%`);
          T(cx + rr * Math.cos(am), cy + rr * Math.sin(am) + fs * 0.35, parts.join(' '), { fill: inkOn(col), size: fs * 0.9 });
        }
        a0 = a1;
      });
    }
    if (legendDraw) legendDraw();
    return svg;
  }

  // ---- radar ----
  if (first.kind === 'radar') {
    const all = first.series.flatMap((s) => s.vals.filter((v) => v !== null));
    const sc = niceScale(Math.min(0, ...all), Math.max(...all, 1), 4);
    const cats = first.series[0].cats; const n = Math.max(3, ...first.series.map((s) => s.vals.length));
    const pw = W - left - right; const ph = H - top - bottom;
    const cx = left + pw / 2; const cy = top + ph / 2; const r = Math.max(10, Math.min(pw, ph) / 2 - fs * 2);
    const ang = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rad = (v) => ((v - sc.min) / (sc.max - sc.min)) * r;
    for (const t of ticksOf(sc).slice(1)) sv('polygon', { points: Array.from({ length: n }, (_, i) => `${cx + rad(t) * Math.cos(ang(i))},${cy + rad(t) * Math.sin(ang(i))}`).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.18 }, svg);
    for (let i = 0; i < n; i++) { line(cx, cy, cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i)), 0.18); if (cats[i]) T(cx + (r + fs * 0.9) * Math.cos(ang(i)), cy + (r + fs * 0.9) * Math.sin(ang(i)) + fs * 0.35, clip(cats[i], 12), { size: fs * 0.9 }); }
    for (const s of first.series) {
      const pts = s.vals.map((v, i) => `${cx + rad(v ?? sc.min) * Math.cos(ang(i))},${cy + rad(v ?? sc.min) * Math.sin(ang(i))}`).join(' ');
      sv('polygon', { points: pts, fill: 'none', stroke: hexOf(s.color), 'stroke-width': s.w ? Math.min(4, s.w) : 2 }, svg);
    }
    if (legendDraw) legendDraw();
    return svg;
  }

  // ---- cartesian: bar, line, area, scatter, bubble ----
  const horiz = groups.some((g) => g.kind === 'bar' && g.dir === 'bar');
  const xy = groups.some((g) => g.kind === 'scatter' || g.kind === 'bubble');
  const axOf = (g, kind) => g.axIds.map((id) => m.axes[id]).find((a) => a && a.kind === kind) || null;
  const primary = xy ? Object.values(m.axes).find((a) => a.kind === 'val' && (a.pos === 'l' || a.pos === 'r')) || null : axOf(first, 'val'); const catAx = xy ? null : axOf(first, 'cat');
  const secondary = groups.map((g) => axOf(g, 'val')).find((a) => a && primary && a.id !== primary.id) || null;
  const onSecond = (g) => !!secondary && axOf(g, 'val') && axOf(g, 'val').id === secondary.id;
  const cats = (() => { for (const g of groups) for (const s of g.series) if (s.cats.length) return s.cats; return []; })();
  const n = Math.max(1, ...groups.filter((g) => g.kind !== 'scatter' && g.kind !== 'bubble').flatMap((g) => g.series.map((s) => s.vals.length)), cats.length);

  // value extents per axis (primary, secondary), stacking included
  const extent = (list) => {
    let lo = 0; let hi = 0; let seen = false; const stackPos = []; const stackNeg = [];
    for (const g of list) {
      const stacked = (g.kind === 'bar' || g.kind === 'area') && g.grouping !== 'standard' && g.grouping !== 'clustered';
      if (stacked && g.grouping === 'percentStacked') { lo = Math.min(lo, 0); hi = Math.max(hi, 1); seen = true; continue; }
      for (const s of g.series) {
        s.vals.forEach((v, i) => {
          if (v === null) return; seen = true;
          if (stacked) { if (v >= 0) { stackPos[i] = (stackPos[i] || 0) + v; hi = Math.max(hi, stackPos[i]); } else { stackNeg[i] = (stackNeg[i] || 0) + v; lo = Math.min(lo, stackNeg[i]); } }
          else { hi = Math.max(hi, v); lo = Math.min(lo, v); }
        });
      }
    }
    return seen ? [lo, hi] : [0, 1];
  };
  const valGroups = groups.filter((g) => g.kind !== 'scatter' && g.kind !== 'bubble');
  const scaleFor = (list, ax, span) => {
    let [lo, hi] = xy ? [Infinity, -Infinity] : extent(list);
    if (xy) { for (const g of list) for (const s of g.series) for (const v of s.vals) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } if (!Number.isFinite(lo)) { lo = 0; hi = 1; } }
    if (ax && ax.min !== null) lo = ax.min; if (ax && ax.max !== null) hi = ax.max;
    const sc = niceScale(lo, hi, Math.max(3, Math.min(8, Math.round(span / (fs * 3.4)))));
    if (ax && ax.min !== null) sc.min = ax.min; if (ax && ax.max !== null) sc.max = ax.max;
    return sc;
  };
  const percent = (list) => list.length && list.every((g) => g.grouping === 'percentStacked');
  const pw0 = W - left - right; const ph0 = H - top - bottom;
  const mainList = xy ? groups : valGroups.filter((g) => !onSecond(g));
  const secList = valGroups.filter((g) => onSecond(g));
  const vSpan = horiz ? pw0 : ph0;
  const vs = scaleFor(mainList, primary, vSpan);
  const v2 = secList.length ? scaleFor(secList, secondary, vSpan) : null;
  let xs = null;
  if (xy) {
    let lo = Infinity; let hi = -Infinity;
    for (const g of groups) for (const s of g.series) for (const v of s.xs || []) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const xa = Object.values(m.axes).find((a) => a.kind === 'val' && (a.pos === 'b' || a.pos === 't')) || null;
    if (xa && xa.min !== null) lo = xa.min; if (xa && xa.max !== null) hi = xa.max;
    xs = niceScale(lo, hi, Math.max(3, Math.min(8, Math.round(pw0 / (fs * 5)))));
    if (xa && xa.min !== null) xs.min = xa.min; if (xa && xa.max !== null) xs.max = xa.max;
    xs.ax = xa;
  }
  const vFmt = (sc, ax, list) => (ax && ax.fmt) || (percent(list) ? '0%' : (list[0] && list[0].series[0] && list[0].series[0].fmt) || null);
  const vCode = vFmt(vs, primary, mainList); const v2Code = v2 ? vFmt(v2, secondary, secList) : null;
  const vTicks = ticksOf(vs); const v2Ticks = v2 ? ticksOf(v2) : [];
  const widest = (arr, code) => Math.max(1, ...arr.map((t) => fmt(t, code).length));
  const hideV = primary && primary.del; const hideC = catAx && catAx.del;

  // plot rectangle
  const catTitle = horiz ? '' : xy ? (xs.ax && xs.ax.title) : (catAx && catAx.title);
  const valTitle = horiz ? '' : primary && primary.title;
  let catLab = []; let rot = 0; let catH = 0;
  if (!xy && !horiz) {
    catLab = Array.from({ length: n }, (_, i) => cats[i] || '');
    const longest = Math.max(1, ...catLab.map((c) => c.length));
    const slot = (W - left - right) / n;
    rot = !hideC && longest * fs * 0.55 > slot ? -40 : 0;
    catH = hideC ? 4 : rot ? Math.min(H * 0.28, longest * fs * 0.4 + fs * 1.4) : fs * 1.7;
  } else if (xy) catH = fs * 1.7;
  else catH = fs * 1.7;
  const vLabW = (horiz ? Math.max(1, ...Array.from({ length: n }, (_, i) => (cats[i] || '').length)) : widest(vTicks, vCode)) * fs * 0.56 + 8;
  const secW = v2 && !horiz ? widest(v2Ticks, v2Code) * fs * 0.56 + 8 : 0;
  const px0 = left + (hideV && !horiz ? 4 : vLabW) + (valTitle ? fs * 1.5 : 0);
  const px1 = W - right - secW - 4;
  const py0 = top + fs * 0.6;
  const py1 = H - bottom - catH - (catTitle ? fs * 1.5 : 0);
  const pw = Math.max(20, px1 - px0); const ph = Math.max(20, py1 - py0);

  // mapping
  const band = pw / n; const bandV = ph / n;
  const vp = (v, sc) => (horiz ? px0 + ((v - sc.min) / (sc.max - sc.min)) * pw : py1 - ((v - sc.min) / (sc.max - sc.min)) * ph);
  const rev = !!(catAx && catAx.rev);
  const cpos = (i) => (horiz ? (rev ? py0 + (i + 0.5) * bandV : py1 - (i + 0.5) * bandV) : (rev ? px1 - (i + 0.5) * band : px0 + (i + 0.5) * band));
  const xpix = (v) => px0 + ((v - xs.min) / (xs.max - xs.min)) * pw;
  const scFor = (g) => (onSecond(g) ? v2 : vs);

  // gridlines and axes
  if (xy ? (primary ? primary.grid : true) : (primary ? primary.grid : false)) {
    for (const t of vTicks) { if (horiz) line(vp(t, vs), py0, vp(t, vs), py1, 0.16); else line(px0, vp(t, vs), px1, vp(t, vs), 0.16); }
  }
  if (xy && xs.ax && xs.ax.grid) for (const t of ticksOf(xs)) line(xpix(t), py0, xpix(t), py1, 0.16);

  // series
  const bars = valGroups.filter((g) => g.kind === 'bar');
  const labelQueue = [];
  const drawGroup = (g) => {
    const sc = scFor(g);
    const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
    const pct = g.grouping === 'percentStacked';
    const posAcc = []; const negAcc = [];
    const totals = []; if (pct) for (const s of g.series) s.vals.forEach((v, i) => { totals[i] = (totals[i] || 0) + Math.abs(v || 0); });
    const norm = (v, i) => (pct ? (totals[i] ? v / totals[i] : 0) : v);
    g.series.forEach((s, si) => {
      const lab = s.labels === undefined ? g.labels : s.labels;
      const showVal = lab && lab.val;
      if (g.kind === 'bar') {
        const gw = (horiz ? bandV : band) / (1 + g.gap / 100); const bw = stacked ? gw : gw / g.series.length;
        s.vals.forEach((raw, i) => {
          if (raw === null) return; const v = norm(raw, i);
          let a; let b;
          if (stacked) { if (v >= 0) { a = posAcc[i] || 0; b = a + v; posAcc[i] = b; } else { a = negAcc[i] || 0; b = a + v; negAcc[i] = b; } }
          else { a = Math.min(Math.max(0, sc.min), sc.max); b = v; }
          const c = cpos(i); const start = c - gw / 2 + (stacked ? 0 : si * bw);
          const fill = hexOf(s.dpt[i] || s.color);
          if (horiz) { const x1 = vp(a, sc); const x2 = vp(b, sc); sv('rect', { x: Math.min(x1, x2), y: start, width: Math.max(0.5, Math.abs(x2 - x1)), height: Math.max(0.5, bw - 0.5), fill }, svg); if (showVal) labelQueue.push([stacked ? (x1 + x2) / 2 : Math.max(x1, x2) + 3, start + bw / 2 + fs * 0.35, fmt(raw, lab.fmt || s.fmt), stacked ? 'middle' : 'start', stacked ? inkOn(s.dpt[i] || s.color || '808080') : null]); }
          else { const y1 = vp(a, sc); const y2 = vp(b, sc); sv('rect', { x: start, y: Math.min(y1, y2), width: Math.max(0.5, bw - 0.5), height: Math.max(0.5, Math.abs(y2 - y1)), fill }, svg); if (showVal) labelQueue.push([start + bw / 2, stacked ? (y1 + y2) / 2 + fs * 0.35 : Math.min(y1, y2) - 3, fmt(raw, lab.fmt || s.fmt), 'middle', stacked ? inkOn(s.dpt[i] || s.color || '808080') : null]); }
        });
      } else if (g.kind === 'area') {
        const pts = []; const base = [];
        s.vals.forEach((raw, i) => {
          const v = norm(raw === null ? 0 : raw, i); const a = stacked ? posAcc[i] || 0 : 0; const b = a + v; if (stacked) posAcc[i] = b;
          const x = n > 1 ? (rev ? px1 - (i / (n - 1)) * pw : px0 + (i / (n - 1)) * pw) : px0 + pw / 2;
          pts.push([x, vp(b, sc)]); base.push([x, vp(a, sc)]);
        });
        if (pts.length) sv('polygon', { points: [...pts, ...base.reverse()].map((p) => p.join(',')).join(' '), fill: hexOf(s.color), 'fill-opacity': 0.78, stroke: hexOf(s.color), 'stroke-width': 1 }, svg);
      } else if (g.kind === 'line') {
        const segs = []; let cur = [];
        s.vals.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([cpos(i), vp(v, sc), i, v]); });
        if (cur.length) segs.push(cur);
        for (const sg of segs) {
          if (!s.noLine && sg.length > 1) sv('path', { d: s.smooth && sg.length > 2 ? smoothPath(sg) : `M${sg.map((p) => `${p[0]},${p[1]}`).join('L')}`, fill: 'none', stroke: hexOf(s.color), 'stroke-width': s.w ? Math.min(5, s.w) : 2.25, 'stroke-linejoin': 'round' }, svg);
          for (const p of sg) { if (s.marker || s.noLine || sg.length === 1) sv('circle', { cx: p[0], cy: p[1], r: Math.max(2.5, fs * 0.28), fill: hexOf(s.color) }, svg); if (showVal) labelQueue.push([p[0], p[1] - 6, fmt(p[3], lab.fmt || s.fmt), 'middle', null]); }
        }
      }
    });
  };
  for (const g of valGroups.filter((x) => x.kind === 'area')) drawGroup(g);
  for (const g of bars) drawGroup(g);
  for (const g of valGroups.filter((x) => x.kind === 'line')) drawGroup(g);
  for (const g of groups.filter((x) => x.kind === 'scatter' || x.kind === 'bubble')) {
    const bigS = Math.max(1e-9, ...g.series.flatMap((s) => (s.size || []).filter((v) => v !== null)));
    for (const s of g.series) {
      const pts = []; s.vals.forEach((v, i) => { const x = s.xs && s.xs[i] !== null && s.xs[i] !== undefined ? s.xs[i] : i + 1; if (v !== null) pts.push([xpix(x), vp(v, vs), i, v]); });
      if (g.kind === 'scatter' && !s.noLine && !/^(marker|none)$/.test(g.style) && pts.length > 1) sv('path', { d: /smooth/.test(g.style) && pts.length > 2 ? smoothPath(pts) : `M${pts.map((p) => `${p[0]},${p[1]}`).join('L')}`, fill: 'none', stroke: hexOf(s.color), 'stroke-width': s.w ? Math.min(5, s.w) : 2 }, svg);
      for (const p of pts) {
        if (g.kind === 'bubble') sv('circle', { cx: p[0], cy: p[1], r: Math.max(3, Math.sqrt(Math.max(0, (s.size || [])[p[2]] || 0) / bigS) * Math.min(pw, ph) / 9), fill: hexOf(s.color), 'fill-opacity': 0.6, stroke: hexOf(s.color) }, svg);
        else if (s.marker !== false) sv('circle', { cx: p[0], cy: p[1], r: Math.max(2.5, fs * 0.3), fill: hexOf(s.color) }, svg);
      }
    }
  }

  // axis lines and labels
  if (horiz) { line(px0, py0, px0, py1, 0.5); line(px0, py1, px1, py1, 0.5); } else { line(px0, py0, px0, py1, 0.5); line(px0, py1, px1, py1, 0.5); }
  if (!horiz && vs.min < 0 && vs.max > 0) line(px0, vp(0, vs), px1, vp(0, vs), 0.5);
  if (horiz && vs.min < 0 && vs.max > 0) line(vp(0, vs), py0, vp(0, vs), py1, 0.5);
  if (!hideV) {
    for (const t of vTicks) {
      if (horiz) T(vp(t, vs), py1 + fs * 1.2, fmt(t, vCode), { size: fs * 0.92 });
      else T(px0 - 5, vp(t, vs) + fs * 0.32, fmt(t, vCode), { anchor: 'end', size: fs * 0.92 });
    }
    for (const t of v2Ticks) T(px1 + 5, vp(t, v2) + fs * 0.32, fmt(t, v2Code), { anchor: 'start', size: fs * 0.92 });
  }
  if (xy) {
    for (const t of ticksOf(xs)) T(xpix(t), py1 + fs * 1.2, fmt(t, xs.ax && xs.ax.fmt), { size: fs * 0.92 });
  } else if (!hideC) {
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horiz ? ph : pw) / (rot ? fs * 1.1 : Math.max(fs * 2.2, Math.max(1, ...catLab.map((c) => c.length)) * fs * 0.5))))));
    for (let i = 0; i < n; i += step) {
      const c = cats[i] || (cats.length ? '' : String(i + 1));
      if (horiz) T(px0 - 5, cpos(i) + fs * 0.32, clip(c, 18), { anchor: 'end', size: fs * 0.92 });
      else if (rot) T(cpos(i) + 3, py1 + fs * 1.1, clip(c, 22), { anchor: 'end', size: fs * 0.92, rot });
      else T(cpos(i), py1 + fs * 1.2, clip(c, Math.max(4, Math.floor((band * step) / (fs * 0.5)))), { size: fs * 0.92 });
    }
  }
  if (catTitle) T(px0 + pw / 2, H - bottom - fs * 0.3, catTitle, { size: fs });
  if (valTitle) T(left + fs * 0.7, py0 + ph / 2, valTitle, { size: fs, rot: -90 });
  for (const [x, y, s, anchor, fill] of labelQueue) T(x, y, s, { size: fs * 0.88, anchor, fill: fill || 'currentColor' });
  if (legendDraw) legendDraw();
  return svg;
}
