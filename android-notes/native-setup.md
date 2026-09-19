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
Source artwork lives at `resources/icon.png` (repo root), a single 1254×1254 square, no transparency.
`@capacitor/assets` generates every density (legacy `mipmap-*` + adaptive `mipmap-anydpi-v26`) from
this one file — CI runs it automatically (`npx @capacitor/assets generate --android`, right after the
`android/` platform exists, before `cap sync`). To change the icon: replace `resources/icon.png` and
commit; nothing else to touch.

No separate foreground/background layers were supplied, so the same flattened image is used for both
the legacy icon and the adaptive icon's single layer. Measured artwork margin is ~16–20% on every
side, just inside Android's recommended adaptive-icon safe zone (content within the center ~66%) — so
it should survive a circular or squircle launcher mask without meaningfully cropping the folder or
shield, but this hasn't been confirmed on an actual device/launcher yet. If a launcher's mask crops it
more than expected, the fix is supplying `resources/icon-foreground.png` (transparent background,
content further inset) and `resources/icon-background.png` separately — `@capacitor/assets` picks
those up over the single `icon.png` automatically when both are present.

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
