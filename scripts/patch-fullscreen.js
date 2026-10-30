#!/usr/bin/env node
// Lets the page's element.requestFullscreen() show video in a window of its own, with the display cutout filled (Decision 334).
// android/ is never committed, so CI writes it here.
//
// Copies scripts/java/ArklyFullscreenClient.java next to MainActivity.java (package filled in) and, in onCreate(), replaces the
// WebView's Capacitor chrome client with it (it extends Capacitor's, so file chooser and permissions behave as before).
// No Gradle change, no permission. Needs the onCreate() that patch-screenlock.js guarantees, so it runs after it. Idempotent.
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
const TEMPLATE = path.join(__dirname, 'java', 'ArklyFullscreenClient.java');

const die = (msg) => { console.error(`patch-fullscreen.js: ${msg}`); process.exit(1); };
if (!fs.existsSync(JAVA_ROOT)) die(`${JAVA_ROOT} not found — did "cap add android" run first?`);
if (!fs.existsSync(TEMPLATE)) die(`${TEMPLATE} not found.`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');

let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');
const src = fs.readFileSync(TEMPLATE, 'utf8').split('__PACKAGE__').join(pkg);
if (src.includes('__PACKAGE__')) die('a placeholder was not filled — aborting.');
const clientPath = path.join(path.dirname(mainPath), 'ArklyFullscreenClient.java');
fs.writeFileSync(clientPath, src, 'utf8');

if (!main.includes('ArklyFullscreenClient')) {
  const LINE = '        getBridge().getWebView().setWebChromeClient(new ArklyFullscreenClient(getBridge(), this));\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklyFullscreenClient')) die('registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}
console.log(`patch-fullscreen.js: wrote ${clientPath} and set the WebView chrome client.`);
