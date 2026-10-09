// encbench.js — Decision 158 measurement only. Scratch databases, never dumpzone.db.
// Compares plain vs SQLCipher open/insert/FTS5 timing and tests plain-to-encrypted conversion.

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const ROWS = 500;
const QUERIES = 50;
const NAMES = ['dzbench_plain.db', 'dzbench_enc.db', 'dzbench_conv.db'];
const sqlite = new SQLiteConnection(CapacitorSQLite);

const ms = (t) => Math.round(performance.now() - t);

async function wipe(name) {
  try { await CapacitorSQLite.deleteDatabase({ database: name, readonly: false }); } catch (e) { /* absent */ }
}

async function drop(db, name) {
  try { await db.delete(); } catch (e) { /* closed below */ }
  try { await sqlite.closeConnection(name, false); } catch (e) { /* already closed */ }
  await wipe(name);
}

async function runCase(name, encrypted) {
  const r = { name, encrypted };
  let t = performance.now();
  const db = await sqlite.createConnection(name, encrypted, encrypted ? 'secret' : 'no-encryption', 1, false);
  await db.open();
  r.openMs = ms(t);
  await db.execute(`CREATE TABLE e (id INTEGER PRIMARY KEY, label TEXT, body TEXT);
    CREATE VIRTUAL TABLE f USING fts5(id UNINDEXED, label, body_text);`);
  const set = [];
  for (let i = 1; i <= ROWS; i++) {
    const body = `note ${i} word${i % 20} alpha beta gamma delta ${i * 7}`;
    set.push({ statement: 'INSERT INTO e (id, label, body) VALUES (?, ?, ?)', values: [i, `label ${i}`, body] });
    set.push({ statement: 'INSERT INTO f (id, label, body_text) VALUES (?, ?, ?)', values: [i, `label ${i}`, body] });
  }
  t = performance.now();
  await db.executeSet(set, true);
  r.insertMs = ms(t);
  let hits = 0;
  t = performance.now();
  for (let i = 0; i < QUERIES; i++) {
    const res = await db.query('SELECT id FROM f WHERE f MATCH ?', [`word${i % 20}*`]);
    hits = (res.values || []).length;
  }
  r.queryMs = ms(t);
  r.lastHits = hits;
  r.fileEncrypted = (await sqlite.isDatabaseEncrypted(name)).result;
  await drop(db, name);
  return r;
}

async function runConversion(name) {
  const r = { name };
  const plain = await sqlite.createConnection(name, false, 'no-encryption', 1, false);
  await plain.open();
  await plain.execute('CREATE TABLE e (id INTEGER PRIMARY KEY, label TEXT);');
  await plain.executeSet(Array.from({ length: 50 }, (_, i) => ({ statement: 'INSERT INTO e (id, label) VALUES (?, ?)', values: [i + 1, `row ${i + 1}`] })), true);
  await plain.close();
  await sqlite.closeConnection(name, false);
  r.plainBefore = !(await sqlite.isDatabaseEncrypted(name)).result;
  const enc = await sqlite.createConnection(name, true, 'encryption', 1, false);
  await enc.open();
  const res = await enc.query('SELECT COUNT(*) AS n FROM e');
  r.rowsAfter = res.values && res.values[0] ? res.values[0].n : null;
  await enc.close();
  await sqlite.closeConnection(name, false);
  r.encryptedAfter = (await sqlite.isDatabaseEncrypted(name)).result;
  await wipe(name);
  return r;
}

function randomKey() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function runBench(out) {
  const log = (s) => { out.textContent += s + '\n'; };
  out.textContent = '';
  let weSetSecret = false;
  try {
    for (const n of NAMES) await wipe(n);
    if (!(await sqlite.isSecretStored()).result) {
      await sqlite.setEncryptionSecret(randomKey());
      weSetSecret = true;
    }
    const plain = await runCase(NAMES[0], false);
    const enc = await runCase(NAMES[1], true);
    log(`${ROWS} rows + FTS, ${QUERIES} searches`);
    for (const c of [plain, enc]) {
      log(`${c.encrypted ? 'encrypted' : 'plain    '}: open ${c.openMs} ms, insert ${c.insertMs} ms, search ${c.queryMs} ms, hits ${c.lastHits}, file encrypted ${c.fileEncrypted}`);
    }
    try {
      const v = await runConversion(NAMES[2]);
      log(`conversion: plain before ${v.plainBefore}, rows after ${v.rowsAfter}, encrypted after ${v.encryptedAfter}`);
    } catch (e) {
      log(`conversion: failed — ${e.message || e}`);
    }
  } catch (e) {
    log(`failed — ${e.message || e}`);
  } finally {
    for (const n of NAMES) await wipe(n);
    if (weSetSecret) { try { await CapacitorSQLite.clearEncryptionSecret(); } catch (e) { log('secret not cleared'); } }
    log('scratch databases removed');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('enc-bench-btn');
  const out = document.getElementById('enc-bench-out');
  if (!btn || !out) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await runBench(out);
    btn.disabled = false;
  });
});
