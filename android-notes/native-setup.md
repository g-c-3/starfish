# Native Android notes

These are steps/edits needed inside the generated `android/` folder (created by `npx cap add android`)
that Capacitor doesn't handle automatically. Commit `android/` to the repo once generated so CI doesn't
need to guess platform-specific config.

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
Add:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.INTERNET" /> <!-- ad SDK only -->
```
Note: we deliberately do NOT request `SCHEDULE_EXACT_ALARM` — we're using standard Local Notifications,
not AlarmManager exact alarms (see main README: notification-with-tone, not a true alarm).

## 4. Notification sound file
Place a `.wav` file at `android/app/src/main/res/raw/notify_tone.wav` — referenced by
`capacitor.config.json`'s `LocalNotifications.sound` and by `notifications.js`'s channel setup.

## 5. Voice recorder with noise-reduction toggle
Capacitor doesn't ship a recorder plugin by default. Options:
- Use a community plugin (e.g. `capacitor-voice-recorder`) — check it supports choosing `MediaRecorder.AudioSource`.
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
