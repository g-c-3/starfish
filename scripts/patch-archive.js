#!/usr/bin/env node
// Adds native archive extraction to the File explorer (Decisions 220, 221): window.ArklyArchive, a WebView JavaScript interface
// like patch-explorer.js. android/ is never committed, so CI writes it here.
//
// 1. Copies scripts/java/ArklyArchiveBridge.java next to MainActivity.java (package filled in) and registers it in onCreate().
// 2. Adds the extraction libraries to android/app/build.gradle (Gradle fetches them in CI; the app itself never goes online):
//    commons-compress + xz (7z, tar, gz, bz2, xz), zip4j (zip, with passwords), junrar (rar, RAR 4 and earlier).
// 1b. Copies scripts/java/ArklyPackBridge.java (compress to zip or 7z, Decision 295) the same way and registers it as ArklyPack.
//    It uses the libraries below: zip4j writes the zip (password), commons-compress and xz write the 7z.
// 3. Adds packaging excludes for the licence files these libraries share, so the merge step does not fail on duplicates.
// Runs after patch-explorer.js. Idempotent: the bridge file is rewritten; the registration and Gradle lines are added once.
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
const TEMPLATE = path.join(__dirname, 'java', 'ArklyArchiveBridge.java');
const PACK_TEMPLATE = path.join(__dirname, 'java', 'ArklyPackBridge.java');

const die = (msg) => { console.error(`patch-archive.js: ${msg}`); process.exit(1); };
if (!fs.existsSync(JAVA_ROOT)) die(`${JAVA_ROOT} not found — did "cap add android" run first?`);
if (!fs.existsSync(GRADLE)) die(`${GRADLE} not found.`);
if (!fs.existsSync(TEMPLATE)) die(`${TEMPLATE} not found.`);
if (!fs.existsSync(PACK_TEMPLATE)) die(`${PACK_TEMPLATE} not found.`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');

// ---- 1. bridge and registration ----
let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');
const bridgePath = path.join(path.dirname(mainPath), 'ArklyArchiveBridge.java');
fs.writeFileSync(bridgePath, fs.readFileSync(TEMPLATE, 'utf8').replace('__PACKAGE__', pkg), 'utf8');

if (!main.includes('ArklyArchive')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklyArchiveBridge(this), "ArklyArchive");\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklyArchive')) die('registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}

// ---- 1b. compress bridge and registration ----
const packPath = path.join(path.dirname(mainPath), 'ArklyPackBridge.java');
fs.writeFileSync(packPath, fs.readFileSync(PACK_TEMPLATE, 'utf8').replace('__PACKAGE__', pkg), 'utf8');
main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes('ArklyPack')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklyPackBridge(this), "ArklyPack");\n';
  const re = /(getBridge\(\)\.getWebView\(\)\.addJavascriptInterface\(new ArklyArchiveBridge\(this\), "ArklyArchive"\);\n)/;
  if (!re.test(main)) die('ArklyArchive registration not found — aborting.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('ArklyPack')) die('compress registration did not apply — aborting.');
  fs.writeFileSync(mainPath, main, 'utf8');
}

// ---- 2 and 3. Gradle ----
const MARK = '// arkly-archive';
let gradle = fs.readFileSync(GRADLE, 'utf8');
if (!gradle.includes(MARK)) {
  const DEPS = [
    "    implementation 'org.apache.commons:commons-compress:1.26.2' " + MARK,
    "    implementation 'org.tukaani:xz:1.9' " + MARK,
    "    implementation 'net.lingala.zip4j:zip4j:2.11.5' " + MARK,
    "    implementation 'com.github.junrar:junrar:7.5.5' " + MARK,
  ].join('\n');
  const depRe = /^dependencies\s*\{\s*\n/m;
  if (!depRe.test(gradle)) die('no top-level dependencies block in build.gradle — aborting.');
  gradle = gradle.replace(depRe, (m) => `${m}${DEPS}\n`);
  const pack = [
    `    packagingOptions { ${MARK}`,
    '        resources {',
    "            excludes += ['META-INF/LICENSE*', 'META-INF/NOTICE*', 'META-INF/DEPENDENCIES', 'META-INF/INDEX.LIST']",
    '        }',
    '    }',
  ].join('\n');
  const andRe = /^android\s*\{\s*\n/m;
  if (!andRe.test(gradle)) die('no android block in build.gradle — aborting.');
  gradle = gradle.replace(andRe, (m) => `${m}${pack}\n`);
  fs.writeFileSync(GRADLE, gradle, 'utf8');
}
console.log(`patch-archive.js: wrote ${bridgePath} and ${packPath}, registered ArklyArchive and ArklyPack, Gradle libraries and packaging excludes in place.`);
