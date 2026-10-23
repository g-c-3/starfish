// moneychart.js — the Spent / Received bars under the Money month header (Decision 263). Pure: buckets in, markup out, so it can be
// checked without a page. Buckets come from money.js trendBuckets. Text uses the page's own variables, so light and dark both work.
// Spent is the solid bar and Received the outlined one, so the two read apart without colour. A bar pair is a button: tapping it
// writes that period's two amounts under the chart (readout), which is where the exact figures are.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const W = 300, H = 120, TOP = 6, LABEL = 16;

export function bucketName(b, mode) {
  if (mode === 'week') return b.from === b.to ? `${b.from}` : `${b.from}–${b.to}`;
  return new Date(b.y, b.m, 1).toLocaleDateString(undefined, { month: 'short' });
}

export function bucketReadout(b, mode, fmt) {
  const name = mode === 'week' ? `Days ${bucketName(b, mode)}` : new Date(b.y, b.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `${name}: Spent ${fmt(b.spent)} · Received ${fmt(b.received)}`;
}

export function hasAmounts(buckets) {
  return buckets.some((b) => b.spent > 0 || b.received > 0);
}

// idp: the id prefix of the summary box ('ms' or 'vms'). Returns the whole block: mode switch, bars, legend, readout.
export function chartHtml(buckets, mode, fmt, idp) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.spent, b.received)));
  const plotH = H - TOP - LABEL;
  const group = W / buckets.length;
  const bw = Math.min(26, group * 0.34);
  const bar = (v) => (v > 0 ? Math.max(2, Math.round((v / max) * plotH)) : 0);
  const groups = buckets.map((b, i) => {
    const x0 = i * group + group / 2;
    const hs = bar(b.spent), hr = bar(b.received);
    const base = TOP + plotH;
    return `<g class="mc-g" data-i="${i}" tabindex="0" role="button" aria-label="${esc(bucketReadout(b, mode, fmt))}">`
      + `<rect class="mc-hit" x="${(i * group).toFixed(1)}" y="0" width="${group.toFixed(1)}" height="${H}"/>`
      + `<rect class="mc-spent" x="${(x0 - bw - 1).toFixed(1)}" y="${base - hs}" width="${bw.toFixed(1)}" height="${hs}" rx="3"/>`
      + `<rect class="mc-recv" x="${(x0 + 1).toFixed(1)}" y="${base - hr}" width="${bw.toFixed(1)}" height="${hr}" rx="3"/>`
      + `<text class="mc-lab" x="${x0.toFixed(1)}" y="${H - 3}" text-anchor="middle">${esc(bucketName(b, mode))}</text></g>`;
  }).join('');
  const sw = (m, label) => `<button type="button" id="${idp}-chart-${m}" class="mc-mode${mode === m ? ' on' : ''}" aria-pressed="${mode === m}">${label}</button>`;
  const top = `<div class="mc-top"><div class="mc-modes">${sw('month', '6 months')}${sw('week', 'This month by week')}</div></div>`;
  if (!hasAmounts(buckets)) return `<div class="mc">${top}<div class="mc-readout">No Spent or Received entries in this range.</div></div>`;
  return `<div class="mc">`
    + top
    + `<svg viewBox="0 0 ${W} ${H}" class="mc-svg" role="group" aria-label="Spent and Received by ${mode === 'week' ? 'week' : 'month'}">`
    + `<line class="mc-axis" x1="0" y1="${TOP + plotH}" x2="${W}" y2="${TOP + plotH}"/>${groups}</svg>`
    + `<div class="mc-legend"><span><i class="mc-key mc-spent"></i>Spent</span><span><i class="mc-key mc-recv"></i>Received</span></div>`
    + `<div id="${idp}-chart-readout" class="mc-readout" aria-live="polite">Tap a bar for the amounts.</div></div>`;
}

