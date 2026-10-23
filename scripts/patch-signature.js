#!/usr/bin/env node
// Adds the startup signature check (Decision 261): window.ArklySignature, a WebView JavaScript interface like patch-fileops.js.
// android/ is never committed, so CI writes it here.
//
// Copies scripts/java/ArklySignatureBridge.java next to MainActivity.java (package and certificate fingerprint filled in) and
// registers it in onCreate(). The fingerprint is the SHA-256 of the release certificate, read from the keystore by the workflow
// into ARKLY_CERT_SHA256 (64 hex characters; a certificate fingerprint is public). No fingerprint, no build: the check is never
// silently left off. No Gradle change, no permission. Runs after the keystore is decoded and before Gradle. Idempotent.
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
const TEMPLATE = path.join(__dirname, 'java', 'ArklySignatureBridge.java');
const FP = (process.env.ARKLY_CERT_SHA256 || '').replace(/:/g, '').trim();

const die = (msg) => { console.error(`patch-signature.js: ${msg}`); process.exit(1); };
if (!/^[0-9A-Fa-f]{64}$/.test(FP)) die('ARKLY_CERT_SHA256 is missing or not 64 hex characters — the certificate fingerprint could not be read from the keystore.');
if (!fs.existsSync(JAVA_ROOT)) die(`${JAVA_ROOT} not found — did "cap add android" run first?`);
if (!fs.existsSync(TEMPLATE)) die(`${TEMPLATE} not found.`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');

let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');
const src = fs.readFileSync(TEMPLATE, 'utf8').split('__PACKAGE__').join(pkg).split('__CERT_SHA256__').join(FP.toLowerCase());
if (src.includes('__CERT_SHA256__') || src.includes('__PACKAGE__')) die('a placeholder was not filled — aborting.');
const bridgePath = path.join(path.dirname(mainPath), 'ArklySignatureBridge.java');
fs.writeFileSync(bridgePath, src, 'utf8');

if (!main.includes('ArklySignature')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklySignatureBridge(this), "ArklySignature");\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklySignature')) die('registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}
console.log(`patch-signature.js: wrote ${bridgePath} and registered ArklySignature.`);
