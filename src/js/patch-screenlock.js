#!/usr/bin/env node
// Patches MainActivity.java to dispatch a 'dumpzone-screen-off' DOM event into the WebView
// whenever Android's screen turns off (Intent.ACTION_SCREEN_OFF).
//
// Why this exists: the "lock when the phone screen locks" toggle (Decision 74) needs a signal
// appStateChange can't provide — Android pauses the Activity identically whether the screen turned
// off or the person switched to another app, so there's no way to tell the two apart from
// Capacitor's JS-side lifecycle events alone. ACTION_SCREEN_OFF is a separate, system-wide
// broadcast that only fires on an actual screen-off, independent of which Activity (if any) has
// focus — but it can only be received by a receiver registered in code (it's one of the broadcasts
// Android has never allowed to be declared in the manifest), which means this has to be native.
//
// Deliberately not a full Capacitor plugin: a plugin needs its own Gradle module, registration,
// and `cap sync` discovery — much more moving parts than this one narrow signal needs. Instead,
// MainActivity dispatches a plain DOM event straight into the WebView via evaluateJavascript();
// src/js/app.js listens for it with a normal window.addEventListener('dumpzone-screen-off', ...).
//
// Why a script, not a checked-in file: android/ is not committed (see patch-manifest.js's own
// comment for why) — CI runs `npx cap add android` fresh every time. Idempotent, and handles
// MainActivity.java in any of three states, since patch-mainactivity.js's own step may or may not
// be enabled (currently disabled — Decision 63):
//   1. Stock empty class (`class MainActivity extends BridgeActivity {}`) — inserts a fresh
//      onCreate() containing just this patch's registration code.
//   2. Already has an onCreate() (e.g. patch-mainactivity.js's FLAG_SECURE patch applied) — inserts
//      this patch's registration line into the existing method, right after the super() call.
//   3. Already patched by this script — no-op.
const fs = require('fs');
const path = require('path');

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === 'MainActivity.java') {
      return full;
    }
  }
  return null;
}

const JAVA_ROOT = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java');
const MARKER = 'dumpzone-screen-off'; // also the DOM event name itself — one string, one meaning

if (!fs.existsSync(JAVA_ROOT)) {
  console.error(`patch-screenlock.js: ${JAVA_ROOT} not found — did "cap add android" run first?`);
  process.exit(1);
}

const filePath = findMainActivity(JAVA_ROOT);
if (!filePath) {
  console.error('patch-screenlock.js: no MainActivity.java found under android/app/src/main/java — aborting.');
  process.exit(1);
}

let java = fs.readFileSync(filePath, 'utf8');

if (java.includes(MARKER)) {
  console.log('patch-screenlock.js: already present, nothing to do.');
  process.exit(0);
}

const IMPORTS = [
  'import android.content.BroadcastReceiver;',
  'import android.content.Context;',
  'import android.content.Intent;',
  'import android.content.IntentFilter;',
  'import android.os.Bundle;',
].join('\n');

const FIELD =
  '    private final BroadcastReceiver dumpzoneScreenOffReceiver = new BroadcastReceiver() {\n' +
  '        @Override\n' +
  '        public void onReceive(Context context, Intent intent) {\n' +
  '            // dumpzone-screen-off (patch-screenlock.js) — posted to the WebView\'s own thread,\n' +
  '            // matching how Capacitor plugins dispatch their own JS callbacks.\n' +
  '            getBridge().getWebView().post(() ->\n' +
  '                getBridge().getWebView().evaluateJavascript(\n' +
  '                    "window.dispatchEvent(new Event(\'dumpzone-screen-off\'))", null));\n' +
  '        }\n' +
  '    };\n';

const REGISTER_LINE =
  // No RECEIVER_EXPORTED/RECEIVER_NOT_EXPORTED flag: Android 13+ requires one for a
  // context-registered receiver only when targeting API 33+ (this project targets 34) AND the
  // filter isn't restricted to protected system broadcasts. ACTION_SCREEN_OFF is one — only the
  // OS can ever send it — so it's exempt; the plain two-arg registerReceiver() is correct as-is.
  // Flagged here explicitly since omitting the newer overload could otherwise look like an
  // oversight rather than a deliberate, documented exemption.
  '        registerReceiver(dumpzoneScreenOffReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));\n';
const UNREGISTER_METHOD =
  '\n' +
  '    @Override\n' +
  '    public void onDestroy() {\n' +
  '        unregisterReceiver(dumpzoneScreenOffReceiver);\n' +
  '        super.onDestroy();\n' +
  '    }\n';

// Imports: add any not already present, right after the package declaration.
const missingImports = IMPORTS.split('\n').filter((line) => !java.includes(line));
if (missingImports.length) {
  java = java.replace(/^(package [^;]+;\n)/, `$1\n${missingImports.join('\n')}\n`);
}

if (/class MainActivity extends BridgeActivity\s*\{\s*\}/.test(java)) {
  // State 1: stock empty class — insert field, a fresh onCreate(), and onDestroy() together.
  java = java.replace(
    /class MainActivity extends BridgeActivity\s*\{\s*\}/,
    [
      'class MainActivity extends BridgeActivity {',
      FIELD,
      '    @Override',
      '    public void onCreate(Bundle savedInstanceState) {',
      '        super.onCreate(savedInstanceState);',
      REGISTER_LINE.replace(/\n$/, ''),
      '    }',
      UNREGISTER_METHOD,
      '}',
    ].join('\n')
  );
} else if (/public void onCreate\(Bundle savedInstanceState\)\s*\{/.test(java)) {
  // State 2: an onCreate() already exists (e.g. FLAG_SECURE patch) — add the field once, insert
  // the registration right after the existing super() call, and add onDestroy() if missing.
  java = java.replace(
    /class MainActivity extends BridgeActivity\s*\{/,
    `class MainActivity extends BridgeActivity {\n${FIELD}`
  );
  java = java.replace(
    /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/,
    `$1${REGISTER_LINE}`
  );
  if (!java.includes('onDestroy')) {
    java = java.replace(/\}\s*$/, `${UNREGISTER_METHOD}}\n`);
  }
} else {
  console.error('patch-screenlock.js: MainActivity.java is not in a recognized shape (neither stock nor a known onCreate() pattern) — aborting rather than guessing where to insert.');
  process.exit(1);
}

if (!java.includes(MARKER)) {
  console.error('patch-screenlock.js: replacement did not apply — aborting rather than shipping an unpatched file silently.');
  process.exit(1);
}

fs.writeFileSync(filePath, java, 'utf8');
console.log(`patch-screenlock.js: added screen-off receiver to ${filePath}`);
