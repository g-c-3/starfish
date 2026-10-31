#!/usr/bin/env node
// The phone's "turn on location" dialog for Location capture (Decision 340): window.ArklyLocation, a WebView JavaScript interface like
// patch-nav.js. android/ is never committed, so CI writes it here.
//
// Copies scripts/java/ArklyLocationBridge.java next to MainActivity.java (package filled in), registers it in onCreate() (the bridge
// registers its activity-result launcher there, before the activity starts) and adds the Play services location library to
// android/app/build.gradle (the location plugin already ships it; the app module needs it on its own compile path).
// No permission. Needs the onCreate() that patch-screenlock.js guarantees, so it runs after it. Idempotent.
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

const ROOT = path.join(__dirname, '..', 'android', 'app');
const JAVA_ROOT = process.env.PATCH_JAVA_ROOT || path.join(ROOT, 'src', 'main', 'java');
const GRADLE = process.env.PATCH_GRADLE || path.join(ROOT, 'build.gradle');
const TEMPLATE = path.join(__dirname, 'java', 'ArklyLocationBridge.java');

const die = (msg) => { console.error(`patch-location.js: ${msg}`); process.exit(1); };
if (!fs.existsSync(JAVA_ROOT)) die(`${JAVA_ROOT} not found — did "cap add android" run first?`);
if (!fs.existsSync(GRADLE)) die(`${GRADLE} not found.`);
if (!fs.existsSync(TEMPLATE)) die(`${TEMPLATE} not found.`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');

let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');
const src = fs.readFileSync(TEMPLATE, 'utf8').split('__PACKAGE__').join(pkg);
if (src.includes('__PACKAGE__')) die('a placeholder was not filled — aborting.');
const bridgePath = path.join(path.dirname(mainPath), 'ArklyLocationBridge.java');
fs.writeFileSync(bridgePath, src, 'utf8');

if (!main.includes('ArklyLocation')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklyLocationBridge(this), "ArklyLocation");\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklyLocation')) die('registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}

const MARK = '// arkly-location';
let gradle = fs.readFileSync(GRADLE, 'utf8');
if (!gradle.includes(MARK)) {
  const depRe = /^dependencies\s*\{\s*\n/m;
  if (!depRe.test(gradle)) die('no top-level dependencies block in build.gradle — aborting.');
  gradle = gradle.replace(depRe, (m) => `${m}    implementation 'com.google.android.gms:play-services-location:21.3.0' ${MARK}\n`);
  fs.writeFileSync(GRADLE, gradle, 'utf8');
}
console.log(`patch-location.js: wrote ${bridgePath}, registered ArklyLocation, Gradle library in place.`);
