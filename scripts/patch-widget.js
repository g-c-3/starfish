#!/usr/bin/env node
// Adds the quick-capture widget (Decisions 264-266). android/ is never committed, so CI writes it here.
//
// Writes into android/: ArklyWidgetProvider.java (from scripts/java, package filled in, next to MainActivity.java), the widget
// layout, its provider info, shape drawables and the app's line icons as vector drawables, and registers the receiver in AndroidManifest.xml (not exported).
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
    <gradient android:angle="135" android:startColor="#FF1E1A3F" android:endColor="#FF2F2670" />
    <stroke android:width="1dp" android:color="#33FFFFFF" />
    <corners android:radius="22dp" />
</shape>
`);
// Each button's disc uses that type's colour from the app (light end, base).
const COLOURS = {
  note: ['#FFFFC857', '#FFF5A623'],
  voice: ['#FF5EEAD4', '#FF14B8A6'],
  image: ['#FFF9A8D4', '#FFEC4899'],
  money: ['#FFFCA5A5', '#FFEF4444'],
  more: ['#FFA78BFA', '#FF6C5CE7']
};
for (const [name, [from, to]] of Object.entries(COLOURS)) {
  write(`drawable/arkly_widget_dot_${name}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <gradient android:angle="45" android:startColor="${from}" android:endColor="${to}" />
</shape>
`);
}
// The app's own line icons (24 x 24, round white strokes).
const ICONS = {
  note: ['M4,20h4L19,9a2.1,2.1 0 0 0 -3,-3L5,17v3z', 'M14,7l3,3'],
  voice: ['M12,3a3,3 0 0 1 3,3v5a3,3 0 0 1 -6,0V6a3,3 0 0 1 3,-3z', 'M5,11a7,7 0 0 0 14,0M12,18v3'],
  image: ['M6,4h12a3,3 0 0 1 3,3v10a3,3 0 0 1 -3,3H6a3,3 0 0 1 -3,-3V7a3,3 0 0 1 3,-3z', 'M9,10m-1.6,0a1.6,1.6 0 1 1 3.2,0a1.6,1.6 0 1 1 -3.2,0', 'M21,16l-5,-5 -8,8'],
  money: ['M4,7.5A2.5,2.5 0 0 1 6.5,5H18v3', 'M4,7.5V17a2,2 0 0 0 2,2h13a1,1 0 0 0 1,-1V9a1,1 0 0 0 -1,-1H6.5A2.5,2.5 0 0 1 4,7.5z', 'M16,13.5m-1.1,0a1.1,1.1 0 1 1 2.2,0a1.1,1.1 0 1 1 -2.2,0'],
  more: ['M5.5,5h4v4h-4z', 'M14.5,5h4v4h-4z', 'M5.5,14h4v4h-4z', 'M14.5,14h4v4h-4z']
};
for (const [name, paths] of Object.entries(ICONS)) {
  write(`drawable/arkly_widget_ic_${name}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
${paths.map((d) => `    <path android:pathData="${d}" android:strokeColor="#FFFFFFFF" android:strokeWidth="1.9" android:strokeLineCap="round" android:strokeLineJoin="round" />`).join('\n')}
</vector>
`);
}
const label = (text) => `        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="3dp"
            android:text="${text}"
            android:textColor="#F2FFFFFF"
            android:textSize="10sp"
            android:textStyle="bold"
            android:maxLines="1" />
`;
const button = (name, text) => `    <LinearLayout
        android:id="@+id/arkly_w_${name}"
        android:layout_width="0dp"
        android:layout_height="match_parent"
        android:layout_weight="1"
        android:gravity="center"
        android:orientation="vertical">
        <ImageView
            android:layout_width="30dp"
            android:layout_height="30dp"
            android:background="@drawable/arkly_widget_dot_${name}"
            android:contentDescription="${text}"
            android:padding="7dp"
            android:src="@drawable/arkly_widget_ic_${name}" />
${label(text)}    </LinearLayout>
`;
// Compact: the panel is 60dp tall and centred in the one-cell widget area.
write('layout/arkly_widget.xml', `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="60dp"
        android:layout_gravity="center_vertical"
        android:background="@drawable/arkly_widget_bg"
        android:orientation="horizontal"
        android:paddingStart="4dp"
        android:paddingEnd="4dp">
        <LinearLayout
            android:id="@+id/arkly_w_brand"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1.1"
            android:gravity="center"
            android:orientation="vertical">
            <ImageView
                android:layout_width="30dp"
                android:layout_height="30dp"
                android:contentDescription="Arkly"
                android:src="@mipmap/ic_launcher" />
${label('Arkly')}        </LinearLayout>
${button('note', 'Note')}${button('voice', 'Voice')}${button('image', 'Image')}${button('money', 'Money')}${button('more', 'More')}    </LinearLayout>
</FrameLayout>
`);
write('xml/arkly_widget_info.xml', `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="60dp"
    android:minResizeHeight="60dp"
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
