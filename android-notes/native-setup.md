# Native Android notes

> Rename to Arkly (Decisions 165, 273): the package id is `com.arkly.app` and the database, notification channel, biometric entry and Drive folder names follow it. Kept on purpose: the keystore alias `dumpzone` (it lives only inside the keystore file and the `KEY_ALIAS` secret; changing it means a new keystore and new secrets, with no benefit to anyone using the app), the `.dz` backup extension and the backup format magic bytes (changing them would stop every existing backup from restoring).

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
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.INTERNET" /> <!-- update check, Google Drive backup, Verify link -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
```
`USE_EXACT_ALARM` and `SCHEDULE_EXACT_ALARM` are requested so reminders are delivered on time through Doze
(Decision 101). They only change when the notification is delivered: it is still a plain banner, with no alarm
screen or alarm sound. Google Play restricts both to alarm and calendar apps (see Decision 98).

**These are applied automatically by CI, not hand-edited — see Decision 49.** `android/` is never
committed (build-android.yml runs `npx cap add android` fresh whenever the folder is missing, which
is every run today), so a manifest edit made by hand in a checked-out `android/` folder would be
discarded the next run anyway, whether or not anyone remembered to make it. `scripts/patch-manifest.js`
runs in CI right after the platform is added and inserts any of the above permissions not already
present — idempotent, so it's also safe on a future `android/` that does get committed. This list is the
single source of truth for required permissions; if a new plugin needs one, add it to
`REQUIRED_PERMISSIONS` in that script, not to a manifest file directly (there currently isn't one to edit
between CI runs).

**Two of these (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`) exist specifically for
`cap-voice-rec`'s own declared foreground service** — see §5.

## 4. Notification sound
Reminders use the system's default notification sound (Decision 96). `notify_tone.wav` is no longer referenced by
`notifications.js`; it is only the pre-Android 8 fallback named in `capacitor.config.json`'s `LocalNotifications.sound`.

## 5. Voice recorder with noise-reduction toggle
**Basic recording done (Session 24): `cap-voice-rec` (v6.x, explicitly built for Capacitor 6 —
verified via direct npm registry query and its actual shipped type definitions, not just its
README, which had an inconsistency about its own return shape). Wired into both the main and vault
capture bars — tap the voice button, a record/stop UI appears with a live timer, stopping saves the
recording.**

**Noise reduction (Session 153, Decision 281).** The plugin's `startRecording()` read no audio-source option and always used `AudioSource.MIC`. `scripts/patch-voice.js` (a CI step, run after `npm ci`) patches the plugin source in `node_modules`: `CustomMediaRecorder.java` gets a static flag and picks `VOICE_COMMUNICATION` when it is set, `VoiceRecorder.java` sets the flag from the call's `noiseReduction` boolean. Without the option the recorder behaves as before. `VOICE_COMMUNICATION` enables the phone's own noise suppression where the device has it; the effect varies by phone (DP124). Idempotent; fails the build if the plugin source changes.

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

## 6. OCR (images & PDFs)
Dropped (Decision 192). Nothing to set up.

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

## 10. Biometric unlock (Decision 50)
Plugin: `@capgo/capacitor-native-biometric@6.0.4` (Capgo's actively-maintained fork of the older
`capacitor-native-biometric`). **Not the original package** — checked first and rejected: it declares a
`@capacitor/core: ^3.4.3` peer dependency (Capacitor 3, three major versions behind ours) and its
`build.gradle` points at `jcenter()`, which has been shut down since 2021 — using it would likely have
broken the CI build the moment Gradle tried to resolve a dependency from there. The Capgo fork's `6.0.4`
release pins `@capacitor/core: ^6.0.0` exactly, and its `build.gradle` uses `google()`/`mavenCentral()`
only, AGP 8.2.1, compileSdk/targetSdk 34 — matches this project's setup. Verified by downloading both
packages directly and reading their manifests/gradle files, not by trusting either README.

No manifest permission added to `scripts/patch-manifest.js` for this: `androidx.biometric:biometric:1.1.0`
(the plugin's own dependency) self-declares `android.permission.USE_BIOMETRIC` in its own AAR manifest —
standard for that library since its first release, and it's a normal-protection permission (no runtime
prompt either way). Not verified by unpacking the AAR directly the way `cap-voice-rec`'s manifest was in
Session 25 — that package comes via Maven/Gradle, not npm, so there's nothing to `npm pack` and inspect
in this sandbox. Flagging the difference in verification depth honestly; worth a first-principles check
if a real build ever surfaces a missing-permission crash specifically tied to biometric.

Security note (see also ARCHITECTURE.md §3): this plugin's Keystore key uses
`setUnlockedDeviceRequired(true)` but not `setUserAuthenticationRequired(true)` — confirmed by reading
`NativeBiometric.java` directly. Decrypting the stored secret only requires the device to be unlocked, not
a fresh biometric check on every read; the biometric prompt is enforced by always calling
`verifyIdentity()` before `getCredentials()` in `src/js/biometric.js`, not by the hardware itself. Also:
the key isn't invalidated when biometric enrollment changes (no `setInvalidatedByBiometricEnrollment`), so
adding a new fingerprint on the device doesn't automatically revoke this feature's access the way some
other apps' equivalent does. Neither is fixable without forking the plugin's native code — both flagged,
neither blocking, since manual password/PIN entry remains the real security boundary regardless.

## 11. Google Drive backup — Google Cloud Console setup (Phase 13, optional/opt-in)
This is the manual, one-time setup this feature needs before any code can talk to Drive. Everything
here is web-UI on console.cloud.google.com — no terminal.

**Nothing in the repo is edited for this (Decision 272).** CI turns Drive on when the repository variable `GDRIVE_WEB_CLIENT_ID` holds an OAuth *Web application* client ID: it writes the `GoogleAuth` block into `capacitor.config.json` in the build workspace only and switches the `GOOGLE_DRIVE_CONFIGURED` guard in `gdrive.js` on. Without the variable the build keeps Drive off. The guard exists because the sign-in plugin crashes the whole app process when `signIn()` runs with no client ID (Session 21).

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
4. **Create a Web application OAuth client**: APIs & Services > Credentials > Create Credentials > OAuth client ID > Application type: Web application. No redirect URI is needed. Copy its client ID (ends `.apps.googleusercontent.com`). The plugin hands this ID to Google Sign-In's ID-token request, which needs the Web client; an Android-type ID there fails with error 10.
5. **Create an Android OAuth client** in the same project: Application type: Android. Package name: `com.arkly.app`. SHA-1: open the latest run of the build workflow on GitHub > Summary > "Google Drive setup values" and copy the SHA-1 line (no command to run). This client has no ID to copy; Google matches the app by package name and SHA-1. The SHA-1 changes only if the release keystore changes.
6. **Set the variable** on GitHub: repository Settings > Secrets and variables > Actions > Variables tab > New repository variable. Name `GDRIVE_WEB_CLIENT_ID`, value the Web client ID from step 4. It is a variable, not a secret: the ID is inside the APK anyway.
7. **Run the build workflow again**, install the APK, then Settings > Google Drive > Connect. A malformed value fails the build with a clear message; deleting the variable turns Drive off again.

Nothing else in Phase 13 can be wired up (`gdrive.js`, sign-in button, auto-backup scheduler) until
this exists, the same way Phase 1's signing secrets blocked their own downstream work.

## 12. App version per build (Decision 51)
Same root cause as §3 and §10: `android/app/build.gradle` comes from the Capacitor CLI's template
every time `android/` is regenerated, which is every run (Decision 49) — and that template
unconditionally ships `versionCode 1` / `versionName "1.0"`. Every build looked identical on-device
regardless of what actually shipped, with no way to tell builds apart.

`scripts/patch-version.js`, run by CI right after `scripts/patch-manifest.js`, fixes this:
`versionCode` is set to the GitHub Actions run number (`github.run_number` — a strictly increasing
integer, no manual step, always available), and `versionName` is `<package.json version>+<run number>`,
e.g. `0.1.0+42`. Check **Settings > Apps > Arkly > App info** on-device to see the installed build's
exact version. Bump `package.json`'s `"version"` by hand for anything worth calling a real release; the
run-number suffix always changes regardless, so every CI build is distinguishable even between
deliberate version bumps.

Unlike `patch-manifest.js`, this script is **not** idempotent by design — it's meant to overwrite the
version every run, not skip once set (there's nothing to "already be set" correctly on a freshly
regenerated, always-1.0 template).

## 13. Recents-preview blanking + screenshot blocking (Decision 62)
`MainActivity.java`'s stock template (from `npx cap add android`) has no `onCreate()` override at
all — just `public class MainActivity extends BridgeActivity {}`. `scripts/patch-mainactivity.js`
inserts one that sets `FLAG_SECURE` on the window, same idempotent-CI-script pattern as
`patch-manifest.js` (§3) and for the same reason: `android/` is never committed, so a hand edit to
a real `MainActivity.java` would be silently discarded the next CI run.

```java
@Override
public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
}
```

One flag, two effects, not separable: the Android recent-apps/task-switcher preview shows a blank
thumbnail instead of a live screenshot (requested directly — same behavior as Opera Incognito), and
screenshots/screen recording of the app are blocked system-wide as a side effect of the same flag.
Runs in CI right after `cap add android`, alongside the manifest patch — order between the two
doesn't matter, they touch different files.

**Currently disabled (Decision 63)** — the screenshot-blocking side effect got in the way of taking
screenshots during active development. `build-android.yml`'s step calling this script is commented
out, not removed; this script is untouched and still correct. Re-enable by uncommenting that step.

## 14. Screen-off lock trigger (Decision 74)
Powers the "Lock when the phone screen locks" switch in both App lock and Vault settings, as a
third trigger independent of "lock after inactivity" and "lock when backgrounded."

**Why this needs native code at all:** Capacitor's `@capacitor/app` `appStateChange` event fires
`isActive: false` when the Activity pauses — which happens identically whether the person switched
to another app or the screen just turned off. There's no way to tell those two apart from JS alone.
Android does have a distinct signal for an actual screen-off: `Intent.ACTION_SCREEN_OFF`, a
system-wide broadcast independent of Activity focus — but it's one of the broadcasts Android has
never allowed to be declared in the manifest; it only reaches a receiver registered in code.

**Why not a full Capacitor plugin:** a real plugin needs its own Gradle module, manifest entry, and
`cap sync` discovery — a lot of moving parts (and CI risk, since none of it can be tested locally
here) for one narrow signal. Instead, `MainActivity` registers the `BroadcastReceiver` directly and
dispatches a plain DOM event straight into the WebView via `evaluateJavascript()`:
```java
getBridge().getWebView().post(() ->
    getBridge().getWebView().evaluateJavascript(
        "window.dispatchEvent(new Event('arkly-screen-off'))", null));
```
`src/js/app.js` listens with an ordinary `window.addEventListener('arkly-screen-off', ...)` —
no Capacitor plugin API involved on the JS side either.

**`scripts/patch-screenlock.js`** applies this, same idempotent-CI-script pattern as
`patch-manifest.js`/`patch-mainactivity.js` and for the same reason (`android/` is never committed —
see §3). Handles `MainActivity.java` in either state `patch-mainactivity.js`'s own (currently
disabled, Decision 63) step might leave it in: a stock empty class, or one that already has an
`onCreate()`. Runs every CI build regardless of that other script's on/off state. Verified against
both shapes locally in a scratch copy before shipping (not a full Android build — no way to compile
Java or drive Gradle in this environment), including that a second run against already-patched
output is a correct no-op.

**No `RECEIVER_EXPORTED`/`RECEIVER_NOT_EXPORTED` flag** on the `registerReceiver()` call — Android
13+ requires one for a context-registered receiver only when targeting API 33+ (this project targets
34, per §10's own notes) *and* the filter isn't restricted to protected system broadcasts.
`ACTION_SCREEN_OFF` is one — only the OS can ever send it — so it's exempt. Documented here
explicitly so the plain two-arg call doesn't read as a missed update later.

**Not yet confirmed on a real device** — this is the first genuinely new native receiver added to
this codebase since the FLAG_SECURE patch, and unlike that one, it's on by default in CI (no
commented-out step to flip). The screen-off toggle itself defaults **off** in the database (see
Decision 74) specifically because of this — turning it on is an explicit, informed choice until a
real build confirms the event actually reaches the WebView as expected.

## 15. Reminder Snooze/Done without launching the app (Decision 102)
`@capacitor/local-notifications` 6.x builds every action button with `PendingIntent.getActivity`, so a tap always
starts the app. `scripts/patch-reminder-actions.js` (CI, after `npm install` and `cap add android`, before Gradle):
1. writes `ReminderActionReceiver.java` into `MainActivity`'s package;
2. registers it in `AndroidManifest.xml` with `android:exported="false"`;
3. patches `node_modules/@capacitor/local-notifications/.../LocalNotificationManager.java` so the `snooze` and `done`
   buttons use `PendingIntent.getBroadcast` to that receiver (explicit component). Other action ids are unchanged.

The receiver uses the plugin's own classes (`LocalNotificationManager`, `NotificationStorage`, `TimedNotificationPublisher`)
to dismiss, cancel and schedule, and writes `dz_ra:*` keys into the `CapacitorStorage` SharedPreferences group that
`@capacitor/preferences` reads. Notification ids use the same 31-multiplier hash as `hashIdToInt` in `notifications.js`.
The script aborts if the plugin block is not in the expected shape (a plugin upgrade may need it adjusted) and is a
no-op on a second run. Not compiled against Android in the authoring environment.

Reminder notifications carry `extra: { entryId, repeating }` (Decision 108). A repeating reminder is scheduled as several
occurrence ids (`hashIdToInt(entryId)`, then `entryId:r1` to `entryId:r29`, Decision 107); on Done the receiver cancels all
of them for a one-off and only the snooze id when `repeating` is true. `MAX_OCCURRENCES` (30) is the same constant as in
`notifications.js`.

## 16. File explorer bridge (Decisions 206, 207)
Powers the File explorer card (Home and Vault): browsing the phone's internal and removable storage.

**Permission.** `MANAGE_EXTERNAL_STORAGE` (All files access, Android 11+) and `WRITE_EXTERNAL_STORAGE` (earlier) are in `REQUIRED_PERMISSIONS` of `scripts/patch-manifest.js`. On Android 11+ the person grants All files access once on a system screen that the app opens; on earlier versions the two storage permissions are asked at runtime. Sideload only: a Play Store release would need a permission declaration.

**Native side, no plugin.** Same route as section 14: `scripts/patch-explorer.js` writes `ArklyExplorerBridge.java` next to `MainActivity.java` and registers it in `onCreate()` with `addJavascriptInterface(..., "ArklyExplorer")`. Methods: `hasAllFilesAccess()`, `requestAllFilesAccess()`, `volumes()` (JSON: path, name, primary, removable, usb, total, free). The CI step runs right after `patch-screenlock.js`, which guarantees an `onCreate()`. Idempotent.

**Volumes.** Android 11+: `StorageManager.getStorageVolumes()`, mounted volumes only. Earlier: the app's external directories. A USB drive over OTG is listed when Android mounts it as a volume; the USB flag is a guess from the volume's description.

**Not confirmed on a real device or in CI.** The Java is parsed in a scratch check, not compiled. First CI run: confirm it compiles. First device run (DP79): the settings screen, the volume list with a USB drive, and opening a file from a USB drive in another app.

## 17. Archive extraction and browsing (Decisions 220, 221)

`scripts/patch-archive.js` copies `scripts/java/ArklyArchiveBridge.java` next to `MainActivity.java` (package filled in) and registers it in `onCreate()` with `addJavascriptInterface(..., "ArklyArchive")`, right after the explorer bridge. Registered with the activity (`new ArklyArchiveBridge(this)`): the cache folder is `getCacheDir()/arkly-archive`. Methods: `start`, `startSelected`, `startEntry`, `status`, `cancel`, `release` (extraction); `openArchive`, `browseStatus`, `children`, `closeArchive` (browsing); `clearCache`. The CI step runs after `patch-explorer.js`. Idempotent.

**Gradle.** Added to `android/app/build.gradle` (marker `// arkly-archive`): `org.apache.commons:commons-compress:1.26.2`, `org.tukaani:xz:1.9`, `net.lingala.zip4j:zip4j:2.11.5`, `com.github.junrar:junrar:7.5.5`, and `packagingOptions` excludes for `META-INF/LICENSE*`, `NOTICE*`, `DEPENDENCIES`, `INDEX.LIST`. Gradle downloads them in CI; the installed app makes no network call. No new permission.

**Not confirmed in CI or on a device.** The Java was compiled in a scratch check against stubs of the libraries, not the real ones. First CI run: confirm the libraries resolve and the Java compiles; if packaging fails on a duplicate file, add that path to the excludes. First device run (DP85): each format, passwords, cancel, free-space stop. 7z and tar need Android 8 or later at run time.

## 18. Copy and move (Decision 222)

`scripts/patch-fileops.js` copies `scripts/java/ArklyFileOpsBridge.java` next to `MainActivity.java` (package filled in) and registers it in `onCreate()` with `addJavascriptInterface(new ArklyFileOpsBridge(), "ArklyFileOps")`. Methods: `start(op, destDir, pathsCsv)` (a taken name gets a number), `startWith(op, destDir, pathsCsv, policy)` (policy `rename` or `replace`; Decision 225), `status(id)`, `cancel(id)`, `release(id)`. The CI step runs after `patch-archive.js`. No Gradle change, no new permission, no library. Idempotent.

**Not confirmed in CI or on a device.** The Java was compiled and run only on a desktop JDK against a real temporary filesystem. First CI run: confirm it compiles in the Android build. First device run (DP87): both storages, a USB drive, cancel, free-space stop. Sharing relies on the share plugin's file-provider paths; storage outside them (a USB drive) may refuse.
