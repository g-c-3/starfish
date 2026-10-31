#!/usr/bin/env node
// One fix per second for the live location sheet (Decision 344). @capacitor/geolocation builds its watch request with a fixed
// 10 s interval, so a high accuracy fix reached the page seconds late. This patches the plugin source in node_modules: the interval
// becomes 1 s; the minimum interval and the delivery delay still come from the page's watchPosition options.
//
// Geolocation.java: `new LocationRequest.Builder(10000)` -> `new LocationRequest.Builder(1000)`.
// Idempotent. Fails loudly if the plugin source no longer has the line it expects. To go back, remove this step from build-android.yml.
const fs = require('fs');
const path = require('path');

const FILE = process.env.PATCH_GEOLOCATION_FILE ||
  path.join(__dirname, '..', 'node_modules', '@capacitor', 'geolocation', 'android', 'src', 'main', 'java', 'com', 'capacitorjs', 'plugins', 'geolocation', 'Geolocation.java');
const MARK = 'arkly-geolocation-interval';

const die = (msg) => { console.error(`patch-geolocation.js: ${msg}`); process.exit(1); };
if (!fs.existsSync(FILE)) die(`${FILE} not found — did "npm ci" run, and did the plugin layout change?`);

let src = fs.readFileSync(FILE, 'utf8');
if (src.includes(MARK)) {
  console.log('patch-geolocation.js: Geolocation.java already patched.');
} else {
  const old = 'new LocationRequest.Builder(10000)';
  if (src.split(old).length !== 2) die('Geolocation.java: the 10 s LocationRequest.Builder line was not found exactly once — plugin changed, aborting.');
  src = src.replace(old, `new LocationRequest.Builder(1000) /* ${MARK} */`);
  fs.writeFileSync(FILE, src, 'utf8');
  console.log('patch-geolocation.js: watch interval set to 1 s.');
}
