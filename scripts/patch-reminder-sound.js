#!/usr/bin/env node
// Reminder sound (Decisions 359, 363): the phone's notification sound, the phone's alarm sound, or an audio file, optionally rising.
// android/ and node_modules/ are never committed, so CI writes all of it here, after patch-reminder-actions.js and
// patch-audioroute.js (it needs the receiver the first one writes and the onCreate() patch-screenlock.js guarantees). Idempotent.
//   1. writes ArklyReminderSound, ArklyReminderSoundService, ArklySoundBridge and ArklyAlarmActivity (the reminder screen over the lock screen, Decision 368) next to MainActivity.java (package filled in),
//   2. registers the bridge as window.ArklySound,
//   3. manifest: FOREGROUND_SERVICE_MEDIA_PLAYBACK and the service (type mediaPlayback, not exported),
//   4. patches the plugin's TimedNotificationPublisher to start the sound when a reminder is posted, and its
//      NotificationDismissReceiver to stop it on a swipe-away. The plugin is a library and cannot name an app class, so both call
//      the app class by reflection under its full name, inside try/catch: if the class is missing the reminder shows as before,
//   5. patches ReminderActionReceiver so Done and Snooze stop the sound.
// Each step checks its own marker and aborts loudly when a file is not the shape it was written against.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JAVA_ROOT = process.env.PATCH_JAVA_ROOT || path.join(ROOT, 'android', 'app', 'src', 'main', 'java');
const MANIFEST = path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const PLUGIN_DIR = path.join(ROOT, 'node_modules', '@capacitor', 'local-notifications', 'android', 'src', 'main', 'java',
  'com', 'capacitorjs', 'plugins', 'localnotifications');
const TEMPLATES = ['ArklyReminderSound', 'ArklyReminderSoundService', 'ArklySoundBridge', 'ArklyAlarmActivity', 'ArklyRepeatReceiver'];
const MARK = 'arkly-reminder-sound';

const die = (msg) => { console.error(`patch-reminder-sound.js: ${msg}`); process.exit(1); };
function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const f = findMainActivity(full); if (f) return f; }
    else if (entry.name === 'MainActivity.java') return full;
  }
  return null;
}

for (const p of [JAVA_ROOT, MANIFEST, PLUGIN_DIR]) if (!fs.existsSync(p)) die(`${p} not found — run after "npm install" and "cap add android".`);
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) die('no MainActivity.java found.');
let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) die('no package line in MainActivity.java.');
const appDir = path.dirname(mainPath);

// 1. Java classes ---------------------------------------------------------------------------------------------
for (const name of TEMPLATES) {
  const tpl = path.join(__dirname, 'java', `${name}.java`);
  if (!fs.existsSync(tpl)) die(`${tpl} not found.`);
  const src = fs.readFileSync(tpl, 'utf8').split('__PACKAGE__').join(pkg);
  if (src.includes('__PACKAGE__')) die(`a placeholder was not filled in ${name}.`);
  fs.writeFileSync(path.join(appDir, `${name}.java`), src, 'utf8');
}

// 2. Bridge registration --------------------------------------------------------------------------------------
if (!main.includes('"ArklySound"')) {
  const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklySoundBridge(this), "ArklySound");\n';
  const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
  if (!re.test(main)) die('MainActivity.onCreate() not found — run patch-screenlock.js first.');
  main = main.replace(re, `$1${LINE}`);
  if (!main.includes('"ArklySound"')) die('bridge registration did not apply.');
  fs.writeFileSync(mainPath, main, 'utf8');
}

// 3. Manifest -------------------------------------------------------------------------------------------------
let manifest = fs.readFileSync(MANIFEST, 'utf8');
if (!manifest.includes('FOREGROUND_SERVICE_MEDIA_PLAYBACK')) {
  const m = manifest.match(/<application\b/);
  if (!m) die('<application> not found in AndroidManifest.xml.');
  manifest = manifest.slice(0, m.index) + '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />\n    ' + manifest.slice(m.index);
}
for (const perm of ['VIBRATE', 'WAKE_LOCK', 'USE_FULL_SCREEN_INTENT']) { // vibration; keeping the phone awake while the sound plays; the reminder screen over the lock screen (Decisions 365, 368)
  if (!manifest.includes(`android.permission.${perm}`)) {
    const m = manifest.match(/<application\b/);
    if (!m) die('<application> not found in AndroidManifest.xml.');
    manifest = manifest.slice(0, m.index) + `<uses-permission android:name="android.permission.${perm}" />\n    ` + manifest.slice(m.index);
  }
}
if (!manifest.includes('ArklyReminderSoundService')) {
  if (!manifest.includes('</application>')) die('</application> not found in AndroidManifest.xml.');
  manifest = manifest.replace('</application>', '    <service android:name=".ArklyReminderSoundService" android:exported="false" android:foregroundServiceType="mediaPlayback" />\n    </application>');
}
if (!manifest.includes('ArklyRepeatReceiver')) { // rings an unattended reminder again (Decision 372)
  manifest = manifest.replace('</application>', '    <receiver android:name=".ArklyRepeatReceiver" android:exported="false" />\n    </application>');
}
if (!manifest.includes('ArklyAlarmActivity')) {
  manifest = manifest.replace('</application>', '    <activity android:name=".ArklyAlarmActivity" android:exported="false" android:showWhenLocked="true" android:turnScreenOn="true" android:launchMode="singleTask" android:excludeFromRecents="true" android:theme="@android:style/Theme.DeviceDefault.NoActionBar" />\n    </application>');
}
fs.writeFileSync(MANIFEST, manifest, 'utf8');

// 4. Plugin hooks ---------------------------------------------------------------------------------------------
const cls = `${pkg}.ArklyReminderSound`;
function patchPlugin(file, anchor, insertAfter, code) {
  const p = path.join(PLUGIN_DIR, file);
  if (!fs.existsSync(p)) die(`${p} not found.`);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(MARK)) return;
  if (s.split(anchor).length !== 2) die(`${file}: expected exactly one "${anchor}".`);
  s = insertAfter ? s.replace(anchor, `${anchor}\n${code}`) : s.replace(anchor, `${code}\n${anchor}`);
  fs.writeFileSync(p, s, 'utf8');
}
// The publisher: the notification is handed to prepare() just before it is posted (it gains a full-screen intent, Decision 370), and to onFire() after.
function patchPluginReplace(file, anchor, code) {
  const p = path.join(PLUGIN_DIR, file);
  if (!fs.existsSync(p)) die(`${p} not found.`);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(MARK)) return;
  if (s.split(anchor).length !== 2) die(`${file}: expected exactly one "${anchor}".`);
  fs.writeFileSync(p, s.replace(anchor, () => code), 'utf8');
}
patchPluginReplace('TimedNotificationPublisher.java', '        notificationManager.notify(id, notification);',
  `        try { notification = (android.app.Notification) Class.forName("${cls}").getMethod("prepare", Context.class, int.class, android.app.Notification.class).invoke(null, context, id, notification); } catch (Throwable ignored) { /* ${MARK}: posted as it is */ }
        notificationManager.notify(id, notification);
        try { Class.forName("${cls}").getMethod("onFire", Context.class, int.class, String.class, android.app.Notification.class).invoke(null, context, id, android.os.Build.VERSION.SDK_INT >= 26 ? notification.getChannelId() : null, notification); } catch (Throwable ignored) { /* ${MARK}: no sound service */ }`);
patchPlugin('NotificationDismissReceiver.java', '        int intExtra = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Integer.MIN_VALUE);', false,
  `        try { Class.forName("${cls}").getMethod("stop", Context.class).invoke(null, context); } catch (Throwable ignored) { /* ${MARK}: no sound service */ }`);

// 5. Done and Snooze stop the sound ---------------------------------------------------------------------------
const receiverPath = path.join(appDir, 'ReminderActionReceiver.java');
if (!fs.existsSync(receiverPath)) die('ReminderActionReceiver.java not found — run patch-reminder-actions.js first.');
let receiver = fs.readFileSync(receiverPath, 'utf8');
if (!receiver.includes(MARK)) {
  const anchor = '            NotificationManagerCompat.from(context).cancel(shownId);';
  if (receiver.split(anchor).length !== 2) die(`ReminderActionReceiver.java: expected exactly one "${anchor.trim()}".`);
  receiver = receiver.replace(anchor, `            ArklyReminderSound.stop(context); // ${MARK}\n${anchor}`);
  fs.writeFileSync(receiverPath, receiver, 'utf8');
}
console.log(`patch-reminder-sound.js: wrote ${TEMPLATES.length} classes, registered ArklySound, patched the manifest, the publisher, the dismiss receiver and the action receiver.`);
