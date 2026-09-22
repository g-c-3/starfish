# Native Android notes

These are steps/edits needed inside the generated `android/` folder (created by `npx cap add android`).
**`android/` has never actually been committed** (confirmed Session 25 — build-android.yml's `if [ ! -d
"android" ]` check has been true on every run so far), so anything that needs to land inside it — like
the permissions in §3 — has to be applied by an automated CI step, not a manual edit, since a hand-edited
manifest would be silently discarded the next run. `scripts/patch-manifest.js` is that step for
permissions today; the same pattern (a small idempotent Node script run in CI right after `cap add
android`, before `cap sync`) is the template for anything else future sessions find that needs to persist
inside `android/` without committing the whole generated platform.

## 1. One-time keystore generation
Run once, locally impossible without a machine — but you can do it in a throwaway GitHub Actions job,
or via any online/temporary Linux shell you trust, then delete the keystore from that machine:

```bash
keytool -genkeypair -v -keystore release.keystore -alias dumpzone \
  -keyalg RSA -keysize 2048 -validity 10000
base64 release.keystore > release.keystore.base64
```
Paste the contents of `release.keystore.base64` into the GitHub Secret `KEYSTORE_BASE64`.
Also set `KEYSTORE_PASSWORD`, `KEY_ALIAS` (`dumpzone`), and `KEY_PASSWORD` as secrets.
**Never commit the raw keystore file to the repo.** Already done for the live release keystore
(alias `dumpzone`, secrets set) — this section is a reference for regenerating one if ever needed.

## 2. App icon
Source artwork lives at `resources/icon.png` (repo root) — must be full-bleed (content to the edges,
no pre-baked margin). `@capacitor/assets` generates every density (legacy `mipmap-*` + adaptive
`mipmap-anydpi-v26`) from this one file — CI runs it automatically (`npx @capacitor/assets generate
--android`, right after the `android/` platform exists, before `cap sync`). To change the icon:
replace `resources/icon.png` with a full-bleed square and commit; nothing else to touch.

**Do not supply a pre-padded source.** The generator applies its own adaptive-icon safe-zone inset;
a source that already carries margin stacks with that inset and renders visibly smaller than sibling
icons on the launcher (confirmed on-device, Session 7 — see Decision 24). If you want more breathing
room around the artwork, that's controlled by supplying a dedicated `resources/icon-foreground.png`
(transparent background) at the size you want, not by padding the single combined `icon.png`.

## 3. Permissions (AndroidManifest.xml)
Required:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.INTERNET" /> <!-- ad SDK only -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
```
Note: we deliberately do NOT request `SCHEDULE_EXACT_ALARM` — we're using standard Local Notifications,
not AlarmManager exact alarms (see main README: notification-with-tone, not a true alarm).

**These are applied automatically by CI, not hand-edited — see Decision 49.** `android/` is never
committed (build-android.yml runs `npx cap add android` fresh whenever the folder is missing, which
is every run today), so a manifest edit made by hand in a checked-out `android/` folder would be
discarded the next run anyway, whether or not anyone remembered to make it. `scripts/patch-manifest.js`
runs in CI right after the platform is added and inserts any of the above eight permissions not already
present — idempotent, so it's also safe on a future `android/` that does get committed. This list is the
single source of truth for required permissions; if a new plugin needs one, add it to
`REQUIRED_PERMISSIONS` in that script, not to a manifest file directly (there currently isn't one to edit
between CI runs).

**Two of these (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`) exist specifically for
`cap-voice-rec`'s own declared foreground service** — see §5.

## 4. Notification sound file
Place a `.wav` file at `android/app/src/main/res/raw/notify_tone.wav` — referenced by
`capacitor.config.json`'s `LocalNotifications.sound` and by `notifications.js`'s channel setup.

## 5. Voice recorder with noise-reduction toggle
**Basic recording done (Session 24): `cap-voice-rec` (v6.x, explicitly built for Capacitor 6 —
verified via direct npm registry query and its actual shipped type definitions, not just its
README, which had an inconsistency about its own return shape). Wired into both the main and vault
capture bars — tap the voice button, a record/stop UI appears with a live timer, stopping saves the
recording.**

**Not yet done: the noise-reduction toggle.** This plugin's `startRecording()` takes no parameters —
no way to choose `AudioSource.MIC` vs `AudioSource.VOICE_COMMUNICATION` (the latter is what would
enable the device's built-in AEC/NS/AGC suppression at the hardware/OS level, per the original plan
below). Getting that means either finding a plugin that exposes an audio-source option, or a small
custom native plugin wrapping `MediaRecorder` directly.

**Resolved (Session 25, Decision 49) — confirmed by downloading the actual package and reading its
shipped `android/src/main/AndroidManifest.xml`, not by inference from its README:**
`cap-voice-rec` does **not** self-declare `RECORD_AUDIO`. Its manifest contains exactly one entry — a
`<service>` declaration for its own recording service, with `android:foregroundServiceType="microphone"`
— and no `<uses-permission>` elements at all. So both things flagged as open here previously are real,
confirmed requirements, not hedges:
1. `RECORD_AUDIO` must be declared in the app's own manifest (§3) — confirmed necessary, not merged in
   from the plugin.
2. **A second, more serious gap found while checking the first:** that declared foreground service has
   no matching permission of its own either. Capacitor 6's default `targetSdkVersion` is **34**
   (confirmed against Capacitor's own 5→6 upgrade docs, not assumed) — and Android 14 (API 34) requires
   both `FOREGROUND_SERVICE` and a type-specific permission (`FOREGROUND_SERVICE_MICROPHONE` for a
   `microphone`-typed service) to be declared, or the OS throws a `SecurityException` /
   `MissingForegroundServiceTypeException` **at `startForeground()`, inside native code** — the exact
   same failure shape as Decision 47's GoogleAuth crash: unreachable from any JS-side try/catch, since it
   happens before the bridge returns anything to JavaScript. Without this fix, tapping record on a real
   Android 14+ device would very likely have crashed the app the moment `VoiceRecorder.startRecording()`
   tried to start that service — untested until now only because Session 24 built the UI but hadn't yet
   run it on-device.

Both permissions added to §3's list and to `scripts/patch-manifest.js`'s `REQUIRED_PERMISSIONS`. Also
worth noting: `package.json` carries `@capawesome-team/capacitor-android-foreground-service` as a
dependency, but nothing in `src/js/` imports or references it — dead weight, likely left over from
before `cap-voice-rec` was chosen. Safe to remove whenever convenient; not touched this session since
removing a dependency isn't the fix for the bug at hand and doesn't need to block it.

Original plan, still the reference for the eventual noise-reduction step:
- Use a community plugin — check it supports choosing `MediaRecorder.AudioSource`.
- Or write a ~40-line custom native plugin wrapping `MediaRecorder`, exposing a `noiseReduction: boolean` param
  that switches `AudioSource.MIC` vs `AudioSource.VOICE_COMMUNICATION` (the latter enables the device's
  built-in AEC/NS/AGC noise suppression at the hardware/OS level — no custom DSP needed).

## 6. OCR (images & PDFs)
Recommended: **ML Kit Text Recognition** (on-device, no network call).
- Add `com.google.mlkit:text-recognition` to `android/app/build.gradle`.
- For PDFs: render each page to a bitmap first via `PdfRenderer` (Android's built-in class), then run
  ML Kit text recognition per page and concatenate results into `body_text`.
- Alternative if you want to avoid Google Play Services entirely: Tesseract via a WASM build
  (`tesseract.js`) run inside the webview — slower, slightly less accurate, but zero native code.

## 7. R8/ProGuard (release hardening)
In `android/app/build.gradle`, under `buildTypes.release`:
```gradle
minifyEnabled true
proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
```

## 8. Signature verification (basic tamper check)
Add a small native check at app startup comparing `PackageManager.GET_SIGNATURES` against your known
release cert hash (computed once from your keystore). If mismatched, show a warning or degrade gracefully.
This is a native Kotlin/Java snippet in `MainActivity.java` — ask for it explicitly when you're ready to wire it in.

## 9. Foreground service (optional, for reliability)
Only needed if you find notifications getting delayed on aggressive OEMs (Xiaomi/Oppo/Vivo). A lightweight
foreground service keeps the process alive for scheduled reminders. Adds a persistent notification icon —
tradeoff between reliability and being unobtrusive. Treat as a v2 addition if standard Local Notifications
prove unreliable in testing on your actual device.

## 10. Google Drive backup — Google Cloud Console setup (Phase 13, optional/opt-in)
This is the manual, one-time setup this feature needs before any code can talk to Drive. Everything
here is web-UI on console.cloud.google.com — no terminal.

**`capacitor.config.json`'s `GoogleAuth` plugin block was removed (Session 20)** as a hedge while
investigating a device crash — turned out not to be that crash's cause (see below), but confirmed by
a real crash log (Session 21) to be a genuine, separate crash risk: the plugin's native `signIn()`
method has no null-check on its internal sign-in client, so calling it with no client ID configured
throws an uncaught `NullPointerException` inside the plugin's own compiled Java code, killing the
whole app process — not something any JS-side try/catch can intercept, since it never reaches JS.
`gdrive.js` now has a `GOOGLE_DRIVE_CONFIGURED` guard (currently `false`) that prevents the app from
ever calling `GoogleAuth.signIn()` while unconfigured. **Once the steps below are done, do both:**
1. Add the config block back to `capacitor.config.json`:
```json
"GoogleAuth": {
  "scopes": ["https://www.googleapis.com/auth/drive.file"],
  "grantOfflineAccess": false,
  "androidClientId": "<your real client ID>.apps.googleusercontent.com"
}
```
2. Flip `GOOGLE_DRIVE_CONFIGURED` to `true` in `src/js/gdrive.js` — without this, Drive stays
   guarded off even with a real client ID configured.

1. **Create a Google Cloud project** (or reuse one) at console.cloud.google.com. Free tier is enough.
2. **Enable the Google Drive API**: APIs & Services → Library → search "Google Drive API" → Enable.
3. **Configure the OAuth consent screen**: APIs & Services → OAuth consent screen.
   - User type: External (unless you have a Google Workspace to make it Internal).
   - Scopes: add `https://www.googleapis.com/auth/drive.file` only — do not add `drive` or
     `drive.readonly`, both are restricted and require a paid security assessment (Decision 26).
   - While in Testing status, add your own Google account under "Test users" so you can sign in
     during development.
   - **Before relying on auto-backup: Audience → Publish App → switch from Testing to Production.**
     Skipping this means your refresh token silently expires after 7 days (Decision 27) — auto-backup
     would just stop working with no error message pointing at the cause. Because the only scope
     requested is non-sensitive, publishing does not trigger Google's full manual review queue.
4. **Create an Android OAuth client**: APIs & Services → Credentials → Create Credentials → OAuth
   client ID → Application type: Android.
   - Package name: `com.dumpzone.app`.
   - SHA-1 certificate fingerprint: from the release keystore generated in §1. One extra command run
     the same way that keystore was generated: `keytool -list -v -keystore release.keystore -alias
     dumpzone` — the output includes a line starting `SHA1:`. Paste that value in.
5. **Copy the generated client ID** (ends `.apps.googleusercontent.com`) into
   `capacitor.config.json`'s `plugins.GoogleAuth.androidClientId` — this file already has the field,
   just replace the placeholder value.

Nothing else in Phase 13 can be wired up (`gdrive.js`, sign-in button, auto-backup scheduler) until
this exists, the same way Phase 1's AdMob unit and signing secrets blocked their own downstream work.
