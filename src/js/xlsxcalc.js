// xlsxcalc.js — the formula calculator of the xlsx edit engine (Decision 491). Pure: text in, value out; no document, no network.
// Values: a number, a string, a boolean, null (empty cell) or { err: '#DIV/0!' }. A range is { rng: [[value, …], …] }.
// parse(text) reads a formula without its leading "=" and throws CalcError; `unsupported` is set when a function or a name is not covered.
// run(tree, ctx) gives the value. ctx: { sheet (own sheet name), has(name), cell(sheetName, row, column) }.
import { SHEET_ROW_MAX, SHEET_COL_MAX } from './office-read.js';

export class CalcError extends Error { constructor(m, unsupported = false) { super(m); this.office = true; this.unsupported = unsupported; } }

const E = (e) => ({ err: e });
const isErr = (v) => v !== null && typeof v === 'object' && 'err' in v;
const isRng = (v) => v !== null && typeof v === 'object' && 'rng' in v;
const LIMIT = 200000; // cells in one range
const NUMBER = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;
const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

const TOK = new RegExp(String.raw`\s*(?:("(?:[^"]|"")*")|(#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!))|((?:'(?:[^']|'')+'|[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?\d+:\$?\d+|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})(?![\w(.!\u00C0-\uFFFF])|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][\w.]*)(\()?|(<=|>=|<>|[-+*\/^&=<>%(),]))`, 'y');

const endp = (s) => {
  const m = /^\$?([A-Za-z]{1,3})?\$?(\d+)?$/.exec(s);
  return { c: m[1] ? colNum(m[1].toUpperCase()) : null, r: m[2] ? Number(m[2]) - 1 : null };
};
const refNode = (sheetRaw, body) => {
  const [p, q] = body.split(':'); const a = endp(p); const b = q !== undefined ? endp(q) : a;
  let r0 = a.r; let r1 = b.r; let c0 = a.c; let c1 = b.c;
  if (r0 === null || r1 === null) { r0 = 0; r1 = SHEET_ROW_MAX - 1; } // a whole column
  if (c0 === null || c1 === null) { c0 = 0; c1 = SHEET_COL_MAX - 1; } // a whole row
  if (r0 > r1) [r0, r1] = [r1, r0];
  if (c0 > c1) [c0, c1] = [c1, c0];
  const sheet = sheetRaw ? (sheetRaw[0] === "'" ? sheetRaw.slice(1, -2).replace(/''/g, "'") : sheetRaw.slice(0, -1)) : null;
  const bad = c1 >= 16384 || r1 >= 1048576;
  if (!bad && (r1 - r0 + 1) * (c1 - c0 + 1) > LIMIT) throw new CalcError('A range in this formula is too large.', true);
  return { sheet, r0, r1, c0, c1, bad, text: (sheetRaw || '') + body.toUpperCase() };
};

function lex(s) {
  const out = []; let pos = 0;
  while (pos < s.length) {
    TOK.lastIndex = pos; const m = TOK.exec(s);
    if (!m) { if (/^\s*$/.test(s.slice(pos))) break; throw new CalcError('That formula could not be read.'); }
    pos = TOK.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'str', v: m[1].slice(1, -1).replace(/""/g, '"'), text: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'err', v: m[2], text: m[2] });
    else if (m[4] !== undefined) { const r = refNode(m[3], m[4]); out.push({ k: 'ref', v: r, text: r.text }); }
    else if (m[5] !== undefined) out.push({ k: 'num', v: Number(m[5]), text: m[5] });
    else if (m[6] !== undefined) {
      if (m[7]) { out.push({ k: 'fn', v: m[6].toUpperCase(), text: m[6].toUpperCase() }); out.push({ k: 'op', v: '(', text: '(' }); } else out.push({ k: 'name', v: m[6], text: m[6].toUpperCase() });
    } else out.push({ k: 'op', v: m[8], text: m[8] });
  }
  return out;
}

export function parse(text) {
  const toks = lex(String(text)); let i = 0;
  const bad = () => new CalcError('That formula could not be read.');
  const eat = (v) => { const t = toks[i]; if (t && t.k === 'op' && t.v === v) { i++; return true; } return false; };
  const cmp = () => {
    let l = cat();
    for (;;) { const t = toks[i]; if (t && t.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { i++; l = { op: t.v, l, r: cat() }; } else return l; }
  };
  const cat = () => { let l = add(); while (eat('&')) l = { op: '&', l, r: add() }; return l; };
  const add = () => {
    let l = mul();
    for (;;) { if (eat('+')) l = { op: '+', l, r: mul() }; else if (eat('-')) l = { op: '-', l, r: mul() }; else return l; }
  };
  const mul = () => {
    let l = pow();
    for (;;) { if (eat('*')) l = { op: '*', l, r: pow() }; else if (eat('/')) l = { op: '/', l, r: pow() }; else return l; }
  };
  const pow = () => { let l = un(); while (eat('^')) l = { op: '^', l, r: un() }; return l; };
  const un = () => { if (eat('-')) return { un: true, x: un() }; if (eat('+')) return un(); return pct(); };
  const pct = () => { let x = prim(); while (eat('%')) x = { pct: x }; return x; };
  const prim = () => {
    const t = toks[i++]; if (!t) throw bad();
    if (t.k === 'num') return { n: t.v };
    if (t.k === 'str') return { s: t.v };
    if (t.k === 'err') return { e: t.v };
    if (t.k === 'ref') return { ref: t.v };
    if (t.k === 'name') {
      const u = t.v.toUpperCase(); if (u === 'TRUE') return { b: true }; if (u === 'FALSE') return { b: false };
      throw new CalcError(`The name ${t.v} is not supported here yet.`, true);
    }
    if (t.k === 'fn') {
      if (!Object.prototype.hasOwnProperty.call(FN, t.v)) throw new CalcError(`The function ${t.v} is not supported here yet.`, true);
      if (!eat('(')) throw bad();
      const args = [];
      if (eat(')')) return { fn: t.v, args };
      for (;;) {
        const nx = toks[i]; if (nx && nx.k === 'op' && (nx.v === ',' || nx.v === ')')) args.push({ empty: true }); else args.push(cmp());
        if (eat(',')) continue; if (eat(')')) break; throw bad();
      }
      return { fn: t.v, args };
    }
    if (t.k === 'op' && t.v === '(') { const x = cmp(); if (!eat(')')) throw bad(); return x; }
    throw bad();
  };
  const tree = cmp(); if (i < toks.length) throw bad();
  return { tree, text: toks.map((t) => t.text).join('') };
}

// ---- values ----
const fin = (x) => (Number.isFinite(x) ? Number(x.toPrecision(15)) : E('#NUM!'));
const sc = (v) => { if (!isRng(v)) return v; return v.rng.length === 1 && v.rng[0].length === 1 ? v.rng[0][0] : E('#VALUE!'); };
const num = (v) => {
  if (isErr(v)) return v; if (v === null) return 0; if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'number') return v;
  return NUMBER.test(v) ? Number(v) : E('#VALUE!');
};
const str = (v) => (v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(Number(v.toPrecision(15))) : v);
const truth = (v) => {
  if (isErr(v)) return v; if (v === null) return false; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0;
  if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; return E('#VALUE!');
};
const rank = (v) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);
const compare = (a, b) => {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return Number(a) - Number(b);
};
const roundTo = (x, d, mode) => {
  const m = 10 ** d; const t = Number((Math.abs(x) * m).toPrecision(15));
  const k = mode === 'up' ? Math.ceil(t) : mode === 'down' ? Math.floor(t) : Math.round(t);
  return Math.sign(x) * k / m;
};

// the numbers in the arguments: a range or a cell gives its numbers only; a typed argument is converted
function numbers(a, ev) {
  const out = [];
  for (const n of a) {
    let v = ev(n); if (isErr(v)) return v;
    if (n.ref && !isRng(v)) v = { rng: [[v]] };
    if (isRng(v)) { for (const row of v.rng) for (const x of row) { if (isErr(x)) return x; if (typeof x === 'number') out.push(x); } } else { const x = n.empty ? 0 : num(v); if (isErr(x)) return x; out.push(x); }
  }
  return out;
}
const cells = (a, ev) => { // every value of the arguments, ranges spread
  const out = [];
  for (const n of a) { const v = ev(n); if (isRng(v)) { for (const row of v.rng) out.push(...row); } else out.push(v); }
  return out;
};
const arg = (a, ev, k) => (a[k] ? sc(ev(a[k])) : undefined);
const one = (a, ev, k, f) => { const x = num(arg(a, ev, k)); return isErr(x) ? x : f(x); };
const two = (a, ev, f) => { const x = num(arg(a, ev, 0)); if (isErr(x)) return x; const y = num(arg(a, ev, 1)); return isErr(y) ? y : f(x, y); };
const text1 = (a, ev, f) => { const v = arg(a, ev, 0); return isErr(v) ? v : f(str(v)); };
const slice = (a, ev, f) => { // LEFT, RIGHT: text and a count
  const v = arg(a, ev, 0); if (isErr(v)) return v;
  const n = a[1] ? num(arg(a, ev, 1)) : 1; if (isErr(n)) return n; if (n < 0) return E('#VALUE!');
  return f(str(v), Math.floor(n));
};
const wild = (t) => new RegExp(`^${t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '[\\s\\S]')}$`, 'i');
const matcher = (cr) => {
  let op = '='; let t = cr;
  if (typeof cr === 'string') { const m = /^(<=|>=|<>|<|>|=)([\s\S]*)$/.exec(cr); if (m) { op = m[1]; t = m[2]; } }
  if (typeof t === 'string' && t.trim() !== '' && NUMBER.test(t)) t = Number(t);
  const test = (d) => (op === '=' ? d === 0 : op === '<>' ? d !== 0 : op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0);
  return (x) => {
    if (typeof t === 'number') return typeof x === 'number' ? test(x - t) : op === '<>';
    if (typeof t === 'boolean') return typeof x === 'boolean' ? test(Number(x) - Number(t)) : op === '<>';
    if (t === null) return op === '<>' ? x !== null : x === null;
    if (op === '=' || op === '<>') { const hit = typeof x === 'string' ? wild(t).test(x) : t === '' && x === null; return op === '=' ? hit : !hit; }
    return typeof x === 'string' && test(compare(x, t));
  };
};
const crit = (a, ev, sumIdx) => {
  const rg = ev(a[0]); if (isErr(rg)) return rg; if (!isRng(rg)) return E('#VALUE!');
  const cr = arg(a, ev, 1); if (isErr(cr)) return cr;
  const sr = sumIdx !== null && a[sumIdx] ? ev(a[sumIdx]) : rg; if (isErr(sr)) return sr; if (!isRng(sr)) return E('#VALUE!');
  const mt = matcher(cr); let total = 0; let count = 0;
  rg.rng.forEach((row, i) => row.forEach((x, j) => { if (!mt(x)) return; count++; const y = sr.rng[i] ? sr.rng[i][j] : null; if (typeof y === 'number') total += y; }));
  return { total, count };
};
const logic = (a, ev, any) => {
  let seen = false; let res = !any;
  for (const n of a) {
    let v = ev(n); if (isErr(v)) return v; if (n.ref && !isRng(v)) v = { rng: [[v]] };
    const list = isRng(v) ? v.rng.flat() : [v];
    for (const x of list) {
      if (isErr(x)) return x; if (isRng(v) && (typeof x === 'string' || x === null)) continue;
      const t = truth(x); if (isErr(t)) return t; seen = true; if (any ? t : !t) res = any;
    }
  }
  return seen ? res : E('#VALUE!');
};

const FN = {
  SUM: (a, ev) => { const x = numbers(a, ev); return isErr(x) ? x : fin(x.reduce((p, q) => p + q, 0)); },
  AVERAGE: (a, ev) => { const x = numbers(a, ev); return isErr(x) ? x : x.length ? fin(x.reduce((p, q) => p + q, 0) / x.length) : E('#DIV/0!'); },
  MIN: (a, ev) => { const x = numbers(a, ev); return isErr(x) ? x : x.length ? Math.min(...x) : 0; },
  MAX: (a, ev) => { const x = numbers(a, ev); return isErr(x) ? x : x.length ? Math.max(...x) : 0; },
  PRODUCT: (a, ev) => { const x = numbers(a, ev); return isErr(x) ? x : x.length ? fin(x.reduce((p, q) => p * q, 1)) : 0; },
  COUNT: (a, ev) => { let k = 0; for (const n of a) { const v = ev(n); if (isRng(v)) { for (const row of v.rng) for (const x of row) if (typeof x === 'number') k++; } else if (n.ref ? typeof v === 'number' : !isErr(num(v)) && !n.empty) k++; } return k; },
  COUNTA: (a, ev) => cells(a, ev).filter((x) => x !== null).length,
  ABS: (a, ev) => one(a, ev, 0, Math.abs),
  INT: (a, ev) => one(a, ev, 0, Math.floor),
  SQRT: (a, ev) => one(a, ev, 0, (x) => (x < 0 ? E('#NUM!') : fin(Math.sqrt(x)))),
  ROUND: (a, ev) => two(a, ev, (x, d) => fin(roundTo(x, Math.trunc(d), 'near'))),
  ROUNDUP: (a, ev) => two(a, ev, (x, d) => fin(roundTo(x, Math.trunc(d), 'up'))),
  ROUNDDOWN: (a, ev) => two(a, ev, (x, d) => fin(roundTo(x, Math.trunc(d), 'down'))),
  MOD: (a, ev) => two(a, ev, (x, d) => (d === 0 ? E('#DIV/0!') : fin(x - d * Math.floor(x / d)))),
  POWER: (a, ev) => two(a, ev, (x, y) => (x === 0 && y === 0 ? E('#NUM!') : fin(x ** y))),
  IF: (a, ev) => {
    const c = truth(arg(a, ev, 0)); if (isErr(c)) return c;
    const n = a[c ? 1 : 2]; if (!n) return c; const v = ev(n); return n.empty ? 0 : v;
  },
  IFERROR: (a, ev) => { const x = arg(a, ev, 0); return isErr(x) ? arg(a, ev, 1) : x; },
  AND: (a, ev) => logic(a, ev, false),
  OR: (a, ev) => logic(a, ev, true),
  NOT: (a, ev) => { const t = truth(arg(a, ev, 0)); return isErr(t) ? t : !t; },
  ISNUMBER: (a, ev) => typeof arg(a, ev, 0) === 'number',
  CONCAT: (a, ev) => { const x = cells(a, ev); const e = x.find(isErr); return e || x.map(str).join(''); },
  LEN: (a, ev) => text1(a, ev, (s) => s.length),
  UPPER: (a, ev) => text1(a, ev, (s) => s.toUpperCase()),
  LOWER: (a, ev) => text1(a, ev, (s) => s.toLowerCase()),
  TRIM: (a, ev) => text1(a, ev, (s) => s.replace(/ +/g, ' ').trim()),
  LEFT: (a, ev) => slice(a, ev, (s, n) => s.slice(0, n)),
  RIGHT: (a, ev) => slice(a, ev, (s, n) => (n ? s.slice(-n) : '')),
  MID: (a, ev) => {
    const v = arg(a, ev, 0); if (isErr(v)) return v;
    const st = num(arg(a, ev, 1)); if (isErr(st)) return st; const n = num(arg(a, ev, 2)); if (isErr(n)) return n;
    return st < 1 || n < 0 ? E('#VALUE!') : str(v).slice(Math.floor(st) - 1, Math.floor(st) - 1 + Math.floor(n));
  },
  SUMIF: (a, ev) => { const r = crit(a, ev, 2); return isErr(r) ? r : fin(r.total); },
  COUNTIF: (a, ev) => { const r = crit(a, ev, null); return isErr(r) ? r : r.count; }
};
FN.CONCATENATE = FN.CONCAT;

export const FUNCTIONS = Object.keys(FN);

export function run(tree, ctx) {
  const ev = (n) => {
    if ('n' in n) return n.n; if ('s' in n) return n.s; if ('b' in n) return n.b; if ('e' in n) return E(n.e); if ('empty' in n) return null;
    if (n.ref) {
      const r = n.ref; const sheet = r.sheet || ctx.sheet;
      if (r.bad || !ctx.has(sheet)) return E('#REF!');
      if (r.r0 === r.r1 && r.c0 === r.c1) return ctx.cell(sheet, r.r0, r.c0);
      const rng = []; for (let y = r.r0; y <= r.r1; y++) { const row = []; for (let x = r.c0; x <= r.c1; x++) row.push(ctx.cell(sheet, y, x)); rng.push(row); }
      return { rng };
    }
    if (n.fn) return FN[n.fn](n.args, ev);
    if (n.un) { const x = num(sc(ev(n.x))); return isErr(x) ? x : -x; }
    if (n.pct) { const x = num(sc(ev(n.pct))); return isErr(x) ? x : fin(x / 100); }
    const a = sc(ev(n.l)); if (isErr(a)) return a; const b = sc(ev(n.r)); if (isErr(b)) return b;
    switch (n.op) {
      case '&': return str(a) + str(b);
      case '=': return compare(a, b) === 0;
      case '<>': return compare(a, b) !== 0;
      case '<': return compare(a, b) < 0;
      case '>': return compare(a, b) > 0;
      case '<=': return compare(a, b) <= 0;
      case '>=': return compare(a, b) >= 0;
      default: {
        const x = num(a); if (isErr(x)) return x; const y = num(b); if (isErr(y)) return y;
        if (n.op === '+') return fin(x + y); if (n.op === '-') return fin(x - y); if (n.op === '*') return fin(x * y);
        if (n.op === '/') return y === 0 ? E('#DIV/0!') : fin(x / y);
        return x === 0 && y === 0 ? E('#NUM!') : fin(x ** y);
      }
    }
  };
  const v = sc(ev(tree));
  return typeof v === 'number' ? fin(v) : v;
}
