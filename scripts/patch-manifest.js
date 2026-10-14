#!/usr/bin/env node
// Patches android/app/src/main/AndroidManifest.xml with the permissions Arkly needs.
//
// Why this exists: android/ is not committed to the repo (build-android.yml runs
// `npx cap add android` fresh whenever the folder is missing — currently every run).
// That means any permission manually added to a real AndroidManifest.xml would be
// silently thrown away the next time CI runs, since it starts from a vanilla platform
// every time. This script makes the permission list a checked-in, version-controlled
// fact instead of a manual edit that has nowhere to persist. Runs in CI, no terminal
// access needed from the person maintaining the app.
//
// Idempotent: safe to run against an already-patched manifest (skips permissions
// already present), and safe to run whether android/ was freshly generated or,
// in future, committed.
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

// See docs/android-notes/native-setup.md §3 for what each permission is for.
// FOREGROUND_SERVICE + FOREGROUND_SERVICE_MICROPHONE: required by cap-voice-rec's own
// declared foreground service (foregroundServiceType="microphone" — confirmed by reading
// its shipped AndroidManifest.xml). Neither permission is self-declared by that plugin,
// and Android 14+ (Capacitor 6's default targetSdkVersion is 34) throws a SecurityException
// / MissingForegroundServiceTypeException at startForeground() if a typed foreground
// service's matching permission isn't declared — a native crash, same class as Decision 47.
const REQUIRED_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.ACCESS_FINE_LOCATION',
  // Android 12+ requires COARSE to be declared alongside FINE for a runtime location request;
  // @capacitor/geolocation's own manifest is empty and declares neither.
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.READ_EXTERNAL_STORAGE',
  // File explorer (Decision 207): All files access on Android 11+, the legacy pair below it. The person grants it once in Android's settings.
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.INTERNET',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  // Exact reminder delivery (Decision 101). Without one of these, @capacitor/local-notifications 6.x falls back to an
  // inexact alarm that Doze and battery saving can hold for minutes. USE_EXACT_ALARM is granted at install on
  // Android 13+; SCHEDULE_EXACT_ALARM covers Android 12. Still a normal banner notification, no alarm screen.
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SCHEDULE_EXACT_ALARM',
  // Lets the in-app update hand the downloaded APK to the system installer (Decision 164). Android still asks the owner
  // once to allow installs from this app.
  'android.permission.REQUEST_INSTALL_PACKAGES',
];

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`patch-manifest.js: ${MANIFEST_PATH} not found — did "cap add android" run first?`);
  process.exit(1);
}

let xml = fs.readFileSync(MANIFEST_PATH, 'utf8');

const missing = REQUIRED_PERMISSIONS.filter((p) => !xml.includes(p));

if (missing.length === 0) {
  console.log('patch-manifest.js: all required permissions already present.');
} else {
  // Insert right after the opening <manifest ...> tag's closing '>', not the first '>'
  // in the file (an XML declaration's "?>" would match that instead if present).
  const manifestTagStart = xml.indexOf('<manifest');
  if (manifestTagStart === -1) {
    console.error('patch-manifest.js: no <manifest> tag found — unexpected file content, aborting.');
    process.exit(1);
  }
  const insertAt = xml.indexOf('>', manifestTagStart) + 1;
  const block = '\n' + missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n');
  xml = xml.slice(0, insertAt) + block + xml.slice(insertAt);
  console.log(`patch-manifest.js: inserted ${missing.length} permission(s): ${missing.join(', ')}`);
}

// Decision 158: no OS backup copy of app data. The database key never leaves this device, so a restored file would be unreadable.
if (/android:allowBackup="true"/.test(xml)) {
  xml = xml.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
  console.log('patch-manifest.js: allowBackup set to false.');
} else if (!/android:allowBackup=/.test(xml)) {
  xml = xml.replace('<application', '<application android:allowBackup="false"');
  console.log('patch-manifest.js: allowBackup=false added.');
}

fs.writeFileSync(MANIFEST_PATH, xml, 'utf8');
