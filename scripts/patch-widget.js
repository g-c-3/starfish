#!/usr/bin/env node
// Adds the quick-capture widget (Decisions 264-266). android/ is never committed, so CI writes it here.
//
// Writes into android/: ArklyWidgetProvider.java (from scripts/java, package filled in, next to MainActivity.java), the widget
// layout, its provider info, a background shape and a label string, and registers the receiver in AndroidManifest.xml (not exported).
// No intent filter: the buttons use explicit intents. No permission, no Gradle change, no network. Runs after "cap add android".
// Idempotent.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.PATCH_MAIN_ROOT || path.join(ROOT, 'android', 'app', 'src', 'main');
const JAVA_ROOT = path.join(MAIN, 'java');
const RES = path.join(MAIN, 'res');
const MANIFEST = path.join(MAIN, 'AndroidManifest.xml');
const TEMPLATE = path.join(__dirname, 'java', 'ArklyWidgetProvider.java');

const die = (msg) => { console.error(`patch-widget.js: ${msg}`); process.exit(1); };

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const f = findMainActivity(full); if (f) return f; }
    else if (entry.name === 'MainActivity.java') return full;
  }
  return null;
}

for (const p of [JAVA_ROOT, RES, MANIFEST, TEMPLATE]) if (!fs.existsSync(p)) die(`${p} not found — did "cap add android" run first?`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found — aborting.');
const pkg = (fs.readFileSync(mainPath, 'utf8').match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java — aborting.');

function write(rel, text) {
  const file = path.join(RES, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// 1. Provider class
const src = fs.readFileSync(TEMPLATE, 'utf8').split('__PACKAGE__').join(pkg);
if (src.includes('__PACKAGE__')) die('a placeholder was not filled — aborting.');
const providerPath = path.join(path.dirname(mainPath), 'ArklyWidgetProvider.java');
fs.writeFileSync(providerPath, src, 'utf8');

// 2. Resources
write('drawable/arkly_widget_bg.xml', `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#E61A1730" />
    <corners android:radius="22dp" />
</shape>
`);
write('drawable/arkly_widget_btn.xml', `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#33FFFFFF" />
    <corners android:radius="16dp" />
</shape>
`);
const button = (id, label) => `    <TextView
        android:id="@+id/${id}"
        android:layout_width="0dp"
        android:layout_height="match_parent"
        android:layout_weight="1"
        android:layout_margin="4dp"
        android:background="@drawable/arkly_widget_btn"
        android:gravity="center"
        android:text="${label}"
        android:textColor="#FFFFFF"
        android:textSize="14sp"
        android:textStyle="bold" />
`;
write('layout/arkly_widget.xml', `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/arkly_widget_bg"
    android:orientation="horizontal"
    android:padding="6dp">
${button('arkly_w_note', 'Note')}${button('arkly_w_voice', 'Voice')}${button('arkly_w_image', 'Image')}${button('arkly_w_money', 'Money')}</LinearLayout>
`);
write('xml/arkly_widget_info.xml', `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="56dp"
    android:targetCellWidth="4"
    android:targetCellHeight="1"
    android:updatePeriodMillis="0"
    android:resizeMode="horizontal"
    android:widgetCategory="home_screen"
    android:initialLayout="@layout/arkly_widget" />
`);

// 3. Manifest receiver
let xml = fs.readFileSync(MANIFEST, 'utf8');
const cls = `${pkg}.ArklyWidgetProvider`;
if (xml.includes('ArklyWidgetProvider')) {
  console.log('patch-widget.js: manifest entry already present.');
} else {
  const close = xml.lastIndexOf('</application>');
  if (close === -1) die('no </application> in AndroidManifest.xml.');
  const block = `    <receiver android:name="${cls}" android:exported="false">
        <intent-filter>
            <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
        </intent-filter>
        <meta-data android:name="android.appwidget.provider" android:resource="@xml/arkly_widget_info" />
    </receiver>
    `;
  xml = xml.slice(0, close) + block + xml.slice(close);
  fs.writeFileSync(MANIFEST, xml, 'utf8');
  console.log('patch-widget.js: registered receiver in manifest.');
}
console.log(`patch-widget.js: wrote ${providerPath} and widget resources.`);
