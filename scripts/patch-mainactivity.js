#!/usr/bin/env node
// Patches the generated MainActivity.java to set FLAG_SECURE on the window.
//
// What this buys: the Android recent-apps ("Overview"/task-switcher) preview thumbnail goes
// blank/dark instead of showing a live screenshot of whatever was on screen — same effect as
// Opera's incognito windows, requested directly (Decision 62). FLAG_SECURE is the one Android API
// that does this; there's no separate flag for "just" the recents thumbnail. As an inherent side
// effect of that same single flag, it also blocks screenshots and screen recording of the app
// entirely, system-wide, not just in recents. For a privacy-first, no-cloud app this is treated as
// part of the same feature, not an unwanted side effect — noted here so a future session doesn't
// mistake "screenshots don't work in Dumpzone" for a bug report.
//
// Why a script, not a checked-in file: android/ is not committed (see patch-manifest.js's own
// comment for why) — CI runs `npx cap add android` fresh every time, which generates a stock
// MainActivity.java with no onCreate() override at all (just "class MainActivity extends
// BridgeActivity {}"). This script inserts one. Idempotent: skips if FLAG_SECURE is already
// present, and aborts loudly (rather than silently no-op'ing) if the stock file's shape doesn't
// match what it expects to edit, so a future Capacitor version generating a different template
// gets caught in CI instead of silently shipping an unpatched build.
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

if (!fs.existsSync(JAVA_ROOT)) {
  console.error(`patch-mainactivity.js: ${JAVA_ROOT} not found — did "cap add android" run first?`);
  process.exit(1);
}

const filePath = findMainActivity(JAVA_ROOT);
if (!filePath) {
  console.error('patch-mainactivity.js: no MainActivity.java found under android/app/src/main/java — aborting.');
  process.exit(1);
}

let java = fs.readFileSync(filePath, 'utf8');

if (java.includes('FLAG_SECURE')) {
  console.log('patch-mainactivity.js: FLAG_SECURE already present, nothing to do.');
  process.exit(0);
}

if (!/class MainActivity extends BridgeActivity\s*\{\s*\}/.test(java)) {
  console.error('patch-mainactivity.js: MainActivity.java is not the expected stock one-line class body — aborting rather than guessing where to insert.');
  process.exit(1);
}

// Two imports the patch needs, added right after the package declaration.
java = java.replace(
  /^(package [^;]+;\n)/,
  `$1\nimport android.os.Bundle;\nimport android.view.WindowManager;\n`
);

// Replace the stock empty class body with one overriding onCreate(). Nothing to merge with —
// Capacitor's template ships no onCreate() at all, so this is a straight insertion.
java = java.replace(
  /class MainActivity extends BridgeActivity\s*\{\s*\}/,
  [
    'class MainActivity extends BridgeActivity {',
    '    @Override',
    '    public void onCreate(Bundle savedInstanceState) {',
    '        super.onCreate(savedInstanceState);',
    '        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);',
    '    }',
    '}',
  ].join('\n')
);

if (!java.includes('FLAG_SECURE')) {
  console.error('patch-mainactivity.js: replacement did not apply — aborting rather than shipping an unpatched file silently.');
  process.exit(1);
}

fs.writeFileSync(filePath, java, 'utf8');
console.log(`patch-mainactivity.js: added FLAG_SECURE to ${filePath}`);
