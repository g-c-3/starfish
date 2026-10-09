// encbench.js — Decision 158 measurement only. Scratch databases, never dumpzone.db.
// Compares plain vs SQLCipher open/insert/FTS5 timing and tests plain-to-encrypted conversion.

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { SCHEMA_SQL } from './db.js';

const ROWS = 500;
const QUERIES = 50;
const NAMES = ['dzbench_plain.db', 'dzbench_enc.db', 'dzbench_conv.db', 'dzbench_conv2.db'];
const TIMEOUT_MS = 30000;
const sqlite = new SQLiteConnection(CapacitorSQLite);

const ms = (t) => Math.round(performance.now() - t);

async function wipe(name) {
  try { await CapacitorSQLite.deleteDatabase({ database: name, readonly: false }); } catch (e) { /* absent */ }
}

// deleteDatabase alone can leave an encrypted file behind; open it with the stored key and delete it.
async function purge(name) {
  for (const [enc, mode] of [[true, 'secret'], [false, 'no-encryption']]) {
    try {
      const c = await sqlite.createConnection(name, enc, mode, 1, false);
      await c.open();
      await c.delete();
      try { await sqlite.closeConnection(name, false); } catch (e) { /* closed by delete */ }
      return;
    } catch (e) {
      try { await sqlite.closeConnection(name, false); } catch (x) { /* not open */ }
    }
  }
  await wipe(name);
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

const within = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS))]);

// Real schema (FTS5 table included) plus optional large blob, converted plain -> encrypted.
async function runConversion(name, blobMB) {
  const r = { name, blobMB };
  const plain = await sqlite.createConnection(name, false, 'no-encryption', 1, false);
  await plain.open();
  await plain.execute(SCHEMA_SQL);
  await plain.execute('CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(id UNINDEXED, label, body_text)');
  const set = [];
  for (let i = 1; i <= 50; i++) {
    set.push({ statement: 'INSERT INTO entries (id, type, label, body_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', values: [`id${i}`, 'note', `row ${i}`, `body ${i}`, Date.now(), Date.now()] });
    set.push({ statement: 'INSERT INTO entries_fts (id, label, body_text) VALUES (?, ?, ?)', values: [`id${i}`, `row ${i}`, `body ${i}`] });
  }
  if (blobMB) set.push({ statement: 'INSERT INTO entries (id, type, label, file_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', values: ['big', 'file', 'big', 'x'.repeat(blobMB * 1024 * 1024), Date.now(), Date.now()] });
  await plain.executeSet(set, true);
  await plain.close();
  await sqlite.closeConnection(name, false);
  const t = performance.now();
  try {
    const enc = await within(sqlite.createConnection(name, true, 'encryption', 1, false));
    await within(enc.open());
    r.convertMs = ms(t);
    const n = await within(enc.query('SELECT COUNT(*) AS n FROM entries'));
    const f = await within(enc.query("SELECT COUNT(*) AS n FROM entries_fts WHERE entries_fts MATCH 'row*'"));
    r.entries = n.values[0].n;
    r.ftsHits = f.values[0].n;
    await enc.close();
    await sqlite.closeConnection(name, false);
    r.encryptedAfter = (await sqlite.isDatabaseEncrypted(name)).result;
  } catch (e) {
    r.error = e.message || String(e);
  }
  await purge(name);
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
    for (const n of NAMES.slice(2)) await purge(n);
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
    for (const [n, mb] of [[NAMES[2], 0], [NAMES[3], 10]]) {
      try {
        const v = await runConversion(n, mb);
        log(v.error
          ? `conversion (schema, ${mb} MB blob): failed — ${v.error}`
          : `conversion (schema, ${mb} MB blob): ${v.convertMs} ms, entries ${v.entries}, fts hits ${v.ftsHits}, encrypted ${v.encryptedAfter}`);
      } catch (e) {
        log(`conversion (schema, ${mb} MB blob): failed — ${e.message || e}`);
      }
    }
  } catch (e) {
    log(`failed — ${e.message || e}`);
  } finally {
    for (const n of NAMES) await wipe(n);
    for (const n of NAMES.slice(2)) await purge(n);
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
