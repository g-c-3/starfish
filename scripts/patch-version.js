#!/usr/bin/env node
// Patches android/app/build.gradle's versionCode/versionName after `cap add android`.
//
// Why this exists: android/ is never committed (Decision 49) — the Capacitor CLI's template
// always ships versionCode 1 / versionName "1.0", unconditionally, every time it's regenerated.
// Nothing in the build previously touched either value, so every APK looked identical regardless
// of what actually changed, with no way to tell them apart on-device.
//
// versionCode comes from the CI run number N: always a strictly increasing integer, supplied by
// GitHub Actions with no manual step and no chance of forgetting to bump it (Android requires
// versionCode to increase for the package manager to treat an install as an upgrade rather than
// a conflict). versionName is derived from the same N (Decision 282), so a build installed on a
// device can always be identified from Settings > Apps > Arkly without checking CI logs:
//   major = 1 + floor(N / 10000), minor = floor(N / 1000) % 10, patch = N % 1000 as three digits
//   N=674 -> 1.0.674, N=999 -> 1.0.999, N=1000 -> 1.1.000, N=9999 -> 1.9.999, N=10000 -> 2.0.000
// package.json's "version" is no longer read. update-check.js reads the same scale back.
//
// Not idempotent by design, unlike patch-manifest.js — it's meant to overwrite the version every
// run, not skip once already set.
const fs = require('fs');
const path = require('path');

const GRADLE_PATH = path.join(__dirname, '..', 'android', 'app', 'build.gradle');

function versionNameFor(n) {
  const major = 1 + Math.floor(n / 10000);
  const minor = Math.floor(n / 1000) % 10;
  const patch = String(n % 1000).padStart(3, '0');
  return `${major}.${minor}.${patch}`;
}
if (require.main !== module) { module.exports = { versionNameFor }; return; }

const runNumber = process.env.GITHUB_RUN_NUMBER;
if (!runNumber || !/^\d+$/.test(runNumber) || parseInt(runNumber, 10) < 1) {
  console.error('patch-version.js: GITHUB_RUN_NUMBER missing or not a positive integer — refusing to guess a version code.');
  process.exit(1);
}

if (!fs.existsSync(GRADLE_PATH)) {
  console.error(`patch-version.js: ${GRADLE_PATH} not found — did "cap add android" run first?`);
  process.exit(1);
}

const versionCode = parseInt(runNumber, 10);
const versionName = versionNameFor(versionCode);

let gradle = fs.readFileSync(GRADLE_PATH, 'utf8');
const before = gradle;

gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);

if (gradle === before) {
  console.error('patch-version.js: no versionCode/versionName pattern matched in build.gradle — template may have changed, aborting rather than silently shipping 1.0 again.');
  process.exit(1);
}

fs.writeFileSync(GRADLE_PATH, gradle, 'utf8');
console.log(`patch-version.js: versionCode=${versionCode}, versionName="${versionName}"`);

// Exposes versionName to later CI steps (e.g. the GitHub Release step in build-android.yml) so the
// release tag and the installed app's own version string are always built from this one value —
// not recomputed a second time and risking drift. No-op outside Actions (GITHUB_ENV unset).
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `APP_VERSION_NAME=${versionName}\n`);
}
