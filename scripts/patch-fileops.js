#!/usr/bin/env node
// Adds native copy and move to the File explorer (Decision 222): window.ArklyFileOps, a WebView JavaScript interface like
// patch-explorer.js and patch-archive.js. android/ is never committed, so CI writes it here.
//
// Copies scripts/java/ArklyFileOpsBridge.java next to MainActivity.java (package filled in) and registers it in onCreate().
// No Gradle change, no permission. Runs after patch-archive.js. Idempotent: the bridge file is rewritten; the registration is
// added once.
const fs = require('fs');
const path = require('path');

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const f = findMainActivity(full); if (f) return f; }
    else if (entry.name === 'MainActivity.java') return full;
  }
  return null;
}

const JAVA_ROOT = process.env.PATCH_JAVA_ROOT || path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java');
const TEMPLATE = path.join(__dirname, 'java', 'ArklyFileOpsBridge.java');

const die = (msg) => { console.error(`patch-fileops.js: ${msg}`); process.exit(1); };
if (!fs.existsSync(JAVA_ROOT)) die(`${JAVA_ROOT} not found — did "cap add android" run first?`);
if (!fs.existsSync(TEMPLATE)) die(`${TEMPLATE} not found.`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');

let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');
const bridgePath = path.join(path.dirname(mainPath), 'ArklyFileOpsBridge.java');
fs.writeFileSync(bridgePath, fs.readFileSync(TEMPLATE, 'utf8').replace('__PACKAGE__', pkg), 'utf8');

if (!main.includes('ArklyFileOps')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklyFileOpsBridge(), "ArklyFileOps");\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklyFileOps')) die('registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}
console.log(`patch-fileops.js: wrote ${bridgePath} and registered ArklyFileOps.`);
