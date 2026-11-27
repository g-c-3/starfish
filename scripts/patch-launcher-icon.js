#!/usr/bin/env node
// Launcher icon choice (Decisions 583, 584): white (default) or dark. android/ is never committed, so CI writes it here.
//
// 1. Makes the dark icon set: runs the icon generator on branding/icon-dark.png in a scratch folder and copies the results into
//    android/app/src/main/res as ic_launcher_dark, ic_launcher_dark_round, ic_launcher_dark_foreground and ic_launcher_dark_background.
//    The white set is the one the "Generate app icons" step makes from resources/icon.png; this script runs after it and never touches it.
// 2. Moves the launcher entry of MainActivity to two activity-alias entries, .LauncherWhite (enabled) and .LauncherDark (disabled).
// 3. Copies scripts/java/ArklyIconBridge.java next to MainActivity.java (package filled in) and registers window.ArklyIcon in onCreate().
// No permission, no Gradle change. Needs the onCreate() that patch-screenlock.js guarantees and the files patch-widget.js writes
// (the bridge refreshes the widget), so it runs after both. Idempotent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAIN_DIR = process.env.PATCH_ANDROID_MAIN || path.join(ROOT, 'android', 'app', 'src', 'main');
const RES = path.join(MAIN_DIR, 'res');
const MANIFEST = path.join(MAIN_DIR, 'AndroidManifest.xml');
const JAVA_ROOT = path.join(MAIN_DIR, 'java');
const DARK_SOURCE = path.join(ROOT, 'branding', 'icon-dark.png');
const TEMPLATE = path.join(__dirname, 'java', 'ArklyIconBridge.java');
const DARK_BACKGROUND = '#121214'; // the dark icon's own colour, so the adaptive icon has no light border

const die = (msg) => { console.error(`patch-launcher-icon.js: ${msg}`); process.exit(1); };
for (const f of [MANIFEST, DARK_SOURCE, TEMPLATE]) if (!fs.existsSync(f)) die(`${f} not found.`);
if (!fs.existsSync(RES)) die(`${RES} not found — did "cap add android" run first?`);

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const f = findMainActivity(full); if (f) return f; }
    else if (entry.name === 'MainActivity.java') return full;
  }
  return null;
}

// ---- 1. the dark icon set
const darkName = (name) => name.replace(/^ic_launcher(_round|_foreground|_background)?(?=\.)/, (m, s) => `ic_launcher_dark${s || ''}`);
if (!fs.existsSync(path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_dark.png'))) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arkly-icon-dark-'));
  fs.mkdirSync(path.join(scratch, 'resources'));
  fs.mkdirSync(path.join(scratch, 'android', 'app', 'src', 'main', 'res'), { recursive: true });
  fs.copyFileSync(DARK_SOURCE, path.join(scratch, 'resources', 'icon.png'));
  const cfg = path.join(ROOT, 'capacitor.config.json');
  if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(scratch, 'capacitor.config.json'));
  try {
    execFileSync('npx', ['--yes', '@capacitor/assets', 'generate', '--android', '--iconBackgroundColor', DARK_BACKGROUND, '--iconBackgroundColorDark', DARK_BACKGROUND],
      { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { die(`the icon generator failed: ${String(err.stderr || err.message).slice(0, 400)}`); }
  const made = path.join(scratch, 'android', 'app', 'src', 'main', 'res');
  let copied = 0;
  for (const dir of fs.readdirSync(made)) {
    if (!dir.startsWith('mipmap-')) continue;
    for (const file of fs.readdirSync(path.join(made, dir))) {
      if (!/^ic_launcher(_round|_foreground|_background)?\.(png|xml)$/.test(file)) continue;
      let body = fs.readFileSync(path.join(made, dir, file));
      if (file.endsWith('.xml')) {
        body = Buffer.from(body.toString('utf8').replace(/@mipmap\/ic_launcher_(background|foreground)/g, '@mipmap/ic_launcher_dark_$1'), 'utf8');
      }
      fs.mkdirSync(path.join(RES, dir), { recursive: true });
      fs.writeFileSync(path.join(RES, dir, darkName(file)), body);
      copied++;
    }
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (!fs.existsSync(path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_dark.png'))) die('the dark icon set was not made — aborting.');
  console.log(`patch-launcher-icon.js: wrote ${copied} dark icon file(s).`);
}

// ---- 2. the two launcher aliases
let xml = fs.readFileSync(MANIFEST, 'utf8');
if (!xml.includes('.LauncherDark')) {
  const actRe = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>[\s\S]*?<\/activity>/;
  const act = xml.match(actRe);
  if (!act) die('MainActivity is not in the manifest — aborting.');
  const filterRe = /[ \t]*<intent-filter>(?:(?!<\/intent-filter>)[\s\S])*android\.intent\.category\.LAUNCHER[\s\S]*?<\/intent-filter>[ \t]*\n?/;
  if (!filterRe.test(act[0])) die('the launcher intent filter of MainActivity was not found — aborting.');
  xml = xml.replace(actRe, act[0].replace(filterRe, ''));
  const alias = (name, enabled, icon) => `
        <activity-alias
            android:name=".${name}"
            android:targetActivity=".MainActivity"
            android:enabled="${enabled}"
            android:exported="true"
            android:icon="@mipmap/${icon}"
            android:roundIcon="@mipmap/${icon}_round"
            android:label="@string/app_name">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity-alias>
`;
  const end = xml.lastIndexOf('</application>');
  if (end === -1) die('no </application> in the manifest — aborting.');
  xml = xml.slice(0, end) + alias('LauncherWhite', 'true', 'ic_launcher') + alias('LauncherDark', 'false', 'ic_launcher_dark') + '    ' + xml.slice(end);
  if (!xml.includes('.LauncherDark') || xml.split('android.intent.category.LAUNCHER').length !== 3) die('the aliases did not apply — aborting.');
  fs.writeFileSync(MANIFEST, xml, 'utf8');
  console.log('patch-launcher-icon.js: moved the launcher entry to .LauncherWhite and .LauncherDark.');
}

// ---- 3. the bridge
if (!fs.existsSync(JAVA_ROOT)) die(`${JAVA_ROOT} not found.`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');
let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');
const src = fs.readFileSync(TEMPLATE, 'utf8').split('__PACKAGE__').join(pkg);
if (src.includes('__PACKAGE__')) die('a placeholder was not filled — aborting.');
const bridgePath = path.join(path.dirname(mainPath), 'ArklyIconBridge.java');
fs.writeFileSync(bridgePath, src, 'utf8');
if (!main.includes('ArklyIcon')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklyIconBridge(this), "ArklyIcon");\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklyIcon')) die('registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}
console.log(`patch-launcher-icon.js: wrote ${bridgePath} and registered ArklyIcon.`);
