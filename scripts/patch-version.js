#!/usr/bin/env node
// Patches android/app/build.gradle's versionCode/versionName after `cap add android`.
//
// Why this exists: android/ is never committed (Decision 49) — the Capacitor CLI's template
// always ships versionCode 1 / versionName "1.0", unconditionally, every time it's regenerated.
// Nothing in the build previously touched either value, so every APK looked identical regardless
// of what actually changed, with no way to tell them apart on-device.
//
// versionCode comes from the CI run number: always a strictly increasing integer, supplied by
// GitHub Actions with no manual step and no chance of forgetting to bump it (Android requires
// versionCode to increase for the package manager to treat an install as an upgrade rather than
// a conflict). versionName combines package.json's "version" (bump that by hand for real
// releases — it's the human-meaningful part) with the same run number, so a build installed on a
// device can always be identified from Settings > Apps > Dumpzone without checking CI logs.
//
// Not idempotent by design, unlike patch-manifest.js — it's meant to overwrite the version every
// run, not skip once already set.
const fs = require('fs');
const path = require('path');

const GRADLE_PATH = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

const runNumber = process.env.GITHUB_RUN_NUMBER;
if (!runNumber) {
  console.error('patch-version.js: GITHUB_RUN_NUMBER not set — refusing to guess a version code.');
  process.exit(1);
}

if (!fs.existsSync(GRADLE_PATH)) {
  console.error(`patch-version.js: ${GRADLE_PATH} not found — did "cap add android" run first?`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const baseVersion = pkg.version || '0.0.0';

const versionCode = parseInt(runNumber, 10);
const versionName = `${baseVersion}+${runNumber}`;

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
