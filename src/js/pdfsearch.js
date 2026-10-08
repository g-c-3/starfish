// pdfsearch.js — pure helpers for find-in-PDF, outline and page jump (Decision 153). No DOM, no pdf.js: testable in Node.

const MIN_QUERY = 2;       // shorter queries match too much to be useful
const MAX_MATCHES = 2000;  // whole-document cap; the count then reads "2000+"
const MAX_OUTLINE = 500;   // flattened outline entries kept

// Query as matched: whitespace collapsed, trimmed, lower case.
function normalizeQuery(q) {
  return String(q ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Text items of one page, as the strings and line-end flags of items that carry text. The order is the order pdf.js's
// TextLayer lays out its elements (it skips the same marked-content items), so an index here is an index into `textDivs`.
function pageItems(textContent) {
  const strs = [], eols = [];
  for (const it of textContent?.items || []) {
    if (typeof it?.str !== 'string') continue;
    strs.push(it.str);
    eols.push(!!it.hasEOL);
  }
  return { strs, eols };
}

// Matches of the normalized query `q` in one page. Items are joined with a line end counted as a space and whitespace
// collapsed, so a phrase can run across items. Returns [{ a, b }]: first and last item index of each match, in order.
function findInItems({ strs, eols }, q, limit = MAX_MATCHES) {
  if (!q || q.length < MIN_QUERY || limit <= 0) return [];
  let text = '';
  const starts = [], ends = [];
  for (let i = 0; i < strs.length; i++) {
    const low = strs[i].toLowerCase();
    let s = (low.length === strs[i].length ? low : strs[i]).replace(/\s+/g, ' ');
    if (text.endsWith(' ') && s.startsWith(' ')) s = s.slice(1);
    starts.push(text.length);
    text += s;
    ends.push(text.length);
    if (eols[i] && !text.endsWith(' ')) text += ' ';
  }
  const itemAt = (off) => { // first item whose text ends after `off`
    let lo = 0, hi = ends.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] > off) { hit = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return hit;
  };
  const out = [];
  let from = 0;
  for (;;) {
    const p = text.indexOf(q, from);
    if (p === -1) break;
    const a = itemAt(p), b = itemAt(p + q.length - 1);
    if (a !== -1 && b !== -1) out.push({ a, b });
    if (out.length >= limit) break;
    from = p + q.length;
  }
  return out;
}

// Previous or next match index, wrapping. cur -1 means none chosen yet.
function stepMatch(cur, total, dir) {
  if (!(total > 0)) return -1;
  if (cur < 0) return dir > 0 ? 0 : total - 1;
  return (cur + (dir > 0 ? 1 : -1) + total) % total;
}

// Index of the first hit on or after `page` (hits are in page order); 0 when every hit is earlier.
function firstHitFrom(hits, page) {
  const i = hits.findIndex((h) => h.page >= page);
  return i === -1 ? 0 : i;
}

// Page number typed in the jump field -> 1..count, or null when it is not a number.
function clampPage(raw, count) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || !(count >= 1)) return null;
  return Math.min(count, Math.max(1, n));
}

// pdf.js outline tree -> flat list [{ title, depth, dest }] in reading order, capped. Entries are kept even without a
// destination so their children stay; the caller drops those it cannot resolve.
function flattenOutline(items, depth = 0, out = []) {
  for (const it of items || []) {
    if (out.length >= MAX_OUTLINE) break;
    out.push({ title: String(it?.title ?? '').replace(/\s+/g, ' ').trim() || '(untitled)', depth, dest: it?.dest ?? null });
    if (it?.items?.length) flattenOutline(it.items, depth + 1, out);
  }
  return out;
}

export { MIN_QUERY, MAX_MATCHES, MAX_OUTLINE, normalizeQuery, pageItems, findInItems, stepMatch, firstHitFrom, clampPage, flattenOutline };
