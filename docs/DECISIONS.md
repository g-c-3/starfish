# Decisions

Numbered log, no dates (see TRACK.md for dates). Terse, factual, no attribution to individuals.

**1. Core model.** Fully offline capture-and-action app. Voice, location, photo, PDF, file, and text
entries convert to searchable text where possible, indexed in one FTS5 timeline. No automated
inference, no external verification, no account or server. Monetized by one rewarded ad per day, max,
only if it loads.

**2. Voice notes carry no transcription.** Recorder only, with a noise-reduction toggle
(`VOICE_COMMUNICATION` audio source, not custom DSP) and a mandatory label. Removes the largest
technical risk (offline speech-to-text) at the cost of voice notes being searchable by label only —
stated explicitly in-app, not left implicit.

**3. Reminders are notifications with a tone, not alarms.** `local-notifications`, not `AlarmManager`
full-screen alarms. Simpler, more tolerant of Doze delays; doesn't force-take the screen. Compensated
with a battery-optimization-exemption prompt on first reminder and an "X scheduled" trust indicator.

**4. Expense follow-up: save first, ask after.** "Spent 500" with no category saves immediately as
`uncategorized`; a 15-second prompt asks what it was for. Never blocks on the answer; a late/no reply
just updates the row already saved.

**5. Three credentials, never conflated.** App-open password, private-notes PIN, backup passkey —
separately scoped, separately recoverable, separately hinted. App-open password recoverable via
backup-passkey-as-proof-of-ownership. Private-notes PIN has no recovery path, even via valid restore,
since the backup passkey only unlocks the archive, not PIN-derived note encryption — only a
destructive PIN reset exists. Backup passkey is never stored; forgetting it makes that backup
permanently unrecoverable. First two hints stored locally; backup-passkey hint lives in the backup
file's own unencrypted header, shown before the passkey prompt at restore.

**6. Normal restore only ever asks for the backup passkey.** App-open password and PIN travel inside
the restored database and resume automatically at their backed-up values — restoring can revert the
app-open password if it changed since backup, surfaced as a one-time notice.

**7. Append is the default restore mode; overwrite is the dangerous, explicit-opt-in path.** Append:
non-destructive, UUID-based dedup (exact match skipped but offer "restore anyway"; same-label/
different-UUID appended with a `(Restored)` suffix). Overwrite: destructive, always shown with its
consequence stated plainly. Safety-backup toggle offered for both; skipping it under append needs no
warning, skipping it under overwrite triggers a warning dialog requiring an explicit "I understand"
tap. If the safety backup itself can't fit, overwrite restore refuses to proceed. Incoming backup must
verify fully before any deletion starts.

**8. Selective backup/restore share one category list**, entry types plus Tags (definitions only,
`INSERT OR IGNORE`, no dedup needed) and App Settings (non-sensitive preferences only — never
credential hashes/salts/hints). Both directions show a storage sanity check (required vs. available)
before the action is enabled. "Extract to device storage" pulls a category's raw files out without
touching the database.

**9. Every entry gets five actions: Share, Download-for-append, Download (plain), Edit, Delete.**
Private notes get Copy (auto-clearing clipboard) instead of Share/Download. Download-for-append always
encrypts; the passkey is optional — skipping it falls back to a fixed, disclosed-as-weaker app-level
default key. Plain Download is always unencrypted, meant to leave the app for good. Per-file zip
sidecar schema (label, tags, timestamps, category) matches the full-backup format — one import/dedup
engine serves both.

**10. Tags and labels are picked from a shared, growing list, never retyped.** One tag-picker
component across every entry type (`listAllTags()`), same pattern as label autocomplete
(`label_history`).

**11. Batch add uses one common label with history-aware auto-numbering.** Multi-select Image/PDF/
Generic-File capture can suffix a running number onto a shared label (`Invoice 1`, `Invoice 2`...),
continuing from the label's last-used number rather than restarting at 1.

**12. App name: Dumpzone.** "Dumpstore" rejected — too close to Dumpster, an established Android
file-recovery app in an adjacent category. "Dumphere" cleared but replaced by "Dumpzone" after a
further conflict check also cleared, keeping the "dump it in" positioning without the "junk"
connotation risk. Package id: `com.dumpzone.app`.

**13. Security hardening ceiling: JS obfuscation, ProGuard/R8, startup signature check.** NDK-level
native obfuscation rejected as not worth the build complexity for a solo, GitHub-Actions-only
pipeline — client-side checks can only raise tamper cost, never eliminate it, since nothing here has
a server to validate against, including the ad-gate logic itself.

**14. Ad gate never blocks data access.** Rewarded ad attempted in background on first open per day,
3–5s timeout. Loads → full-screen, non-skippable. Fails/offline → gate skipped entirely, silently. No
optional/skippable middle state — an ad-gate that could lock out a user's own data over a network
hiccup would contradict the offline-first premise.

**15. Repo holds client + docs only — no server split.** Single repo, no backend to separate out.
Manual APK sideload; no Play Store plan decided yet.

**16. Files are delivered complete, never pushed directly, never as diffs.** Matches the mobile-only,
no-terminal workflow — every file is a full, ready-to-download replacement.

**17. Docs use numbers, not dates.** DECISIONS.md and SESSIONS.md entries are numbered only; TRACK.md
is the sole place mapping any of it to a real date/time.

**18. Dark mode: simple on/off, no auto-detection required for v1.** Stored as a local preference
(`meta.dark_mode`), applied via a `data-theme` attribute and CSS variables. Falls under the App
Settings backup category.

**19. Gradient mode: on/off, independent of dark mode, two user-pickable colors.** Same color allowed
for both — collapses to a single-tone glow rather than a two-tone gradient, by design, not a bug to
guard against. Rendered as a soft background gradient plus a blurred glow/spillover layer behind
cards — pure CSS, cosmetic only, no functional effect. Also falls under App Settings.

**20. Captured file storage path convention: `Directory.Data/files/<uuid>.<extension>`.** Not
previously pinned down; backup/restore needs a fixed convention to read and write against. Files are
named by the owning entry's own id, so a restored file and its DB row always agree.

**21. Full backup is a single AES-GCM-encrypted JSON archive, not a zip.** Keeps the "no external
library" stance (crypto.js only) for Phase 6; file bytes travel base64-encoded inside the JSON.
Per-file download-for-append (Phase 7, Decision 9) is a separate, later decision to use a zip
container — the two share the same entry-record schema but not the same container format.

**22. Overwrite-mode restore is destructive only within the selected categories**, not a full-device
wipe by default. Existing rows in unselected categories are untouched. Selecting every category and
choosing overwrite is how a full replace is done — there's no separate "wipe everything" switch.

**23. App icon generated from one source file via `@capacitor/assets` in CI**, not hand-crafted
per-density PNGs. `resources/icon.png` is the only file to touch when the icon changes; no separate
adaptive-icon foreground/background layers exist yet since only one flattened image was supplied —
revisit if launcher-mask cropping turns out to be a problem on a real device.

**24. Icon source images must be supplied full-bleed (artwork to the edges), not pre-padded.** The
adaptive-icon generator applies its own safe-zone inset; a source that already carries margin stacks
with that inset and renders visibly smaller than sibling icons on the launcher — confirmed on-device
(Session 7) and fixed by re-cropping `resources/icon.png` to ~2–6% margin. Any future icon swap
follows this same rule.

**25. Google Drive backup is opt-in and additive, never a replacement for local backup.** Local-only
stays the default and fully functional with no account, forever. Connecting a Google account adds a
second destination for the same backup file; nothing about local capture, search, or backup/restore
starts depending on it.

**26. Drive access uses the `drive.file` OAuth scope only** — the app can see/manage only files it
created itself, never the rest of the person's Drive. Chosen specifically because it's Google's
non-sensitive tier: basic verification only, not the restricted-scope security assessment full or
readonly Drive access would require.

**27. The Google Cloud OAuth consent screen must be published to Production, not left in Testing.**
Testing-mode refresh tokens for non-basic scopes expire after 7 days, which would silently break
time-based auto-backup about a week in. Production removes that limit without triggering full manual
verification, since the scope (Decision 26) stays non-sensitive.

**28. A Drive backup is byte-for-byte the same encrypted archive format as a local backup** (Decision
21) — same passphrase, same KDF, same "never stored" rule. Drive only ever holds the opaque encrypted
blob; one engine, two destinations.

**29. Auto-backup to Drive is time-based (daily/weekly, user-configurable)**, with manual "Backup now"
always available regardless of the auto-backup setting. Requires a background scheduling mechanism
not yet chosen (Phase 13) — everything in the app today is foreground-only or a local notification.
"Fully offline" language across docs/UI updates to "offline-first, optional cloud backup" once this
ships, since the old phrasing stops being accurate the moment Drive backup exists as a feature.

**30. No refresh-token/serverAuthCode store for Drive auth.** `gdrive.js` never requests
`grantOfflineAccess`; it calls `GoogleAuth.signIn()` fresh each time, relying on the native Android
SDK's own silent-consent caching. Nothing of our own to persist or secure beyond what Android's
account manager already handles.

**31. Auto-backup is a check on app open/resume, not `@capacitor/background-runner`.** That plugin's
headless JS environment has no SQLite or Filesystem access (confirmed against the Capacitor 6 docs) —
it cannot read entries or captured files, so it cannot build a backup payload, independent of any
timing/battery concerns. AlarmManager/a foreground service were also passed over, consistent with the
existing choice to keep reminders as local notifications rather than alarms. The tradeoff is explicit:
if the app isn't opened, no auto-backup runs — an honest, visible limit rather than a silent one.

**32. A due auto-backup shows a one-tap passkey prompt, never runs fully silently.** The backup
passkey is never stored (existing credentials rule), so `checkAndRunAutoBackupIfDue()` can't cache it
across sessions — when the schedule says a backup is due, the app shows a small banner asking for the
passkey once, with an explicit "Skip this time" option that leaves `last_drive_backup_at` untouched so
it comes due again next open rather than silently waiting out the full interval.

**33. Per-file zip export uses `@zip.js/zip.js`, not JSZip.** Checked both against current
maintenance data before choosing: JSZip's last release was 2022 with a maintenance score of zero;
zip.js ships regular releases, has zero dependencies, and is TypeScript-typed. Both work fine in a
plain browser/WebView context — only one of them is still actually maintained.

**34. Per-file "Download for append" reuses `backup.js`'s exact archive pipeline**
(`buildBackupPayload`/`encryptBackup`/`decryptBackupPayload`/`restoreBackup`), scoped to one entry via
an `entryIds` filter added to `buildBackupPayload`. The zip's single JSON entry carries an unencrypted
`mode` field (`passkey`/`default`/`pin`) so import knows what to prompt for without guessing. This
means a per-file export and a full backup are decrypted and deduped by the same code path — one
engine, three destinations (local restore, Drive restore, per-file import) rather than three to keep
in sync.

**35. Fixed a real bug found while building the above:** `restoreBackup`'s cross-PIN append path
referenced `entry._sourcePinSalt`, a field `buildBackupPayload` never actually set (Session 5).
`buildBackupPayload` now captures the device's one `private_pin_salt` once per payload as
`payload.privateNotesSalt` (not per-entry — one PIN, one salt, same for every private note on that
device), and `restoreBackup` reads that instead. Cross-PIN private-notes append was non-functional
until this fix; same-PIN append (the common case) was unaffected, since that path never touched the
missing field.

---

**Pivot: app-open password optional; "Private Notes" generalized into a Private Vault spanning
Text/Voice/Image/PDF/Files, with full feature parity to the main app. Decisions 36–44.**

**36. App-open password is optional ("quick access").** First-run setup offers it, blank means no
lock screen at all on open. Addable/removable anytime after via Settings (`setAppPassword`/
`removeAppPassword`). Doesn't touch the other two credentials — Vault PIN and backup passkey stay
exactly as independent as before.

**37. "Private" is no longer notes-only — Private Vault spans Text, Voice, Image, PDF, and Files**,
each independently browsable plus an "All" combined view. Expenses/Reminders stay out of vault scope
(not requested, don't obviously fit "vault" as a concept). Same vault PIN gates all five.

**38. Vault file bytes are encrypted at rest, not just gated behind a PIN in the UI.** Non-negotiable,
not asked as a question: a "private" photo sitting as a plaintext file anyone with file-manager
access could open would defeat the entire point. Implementation: no new column, no second encryption
scheme — a vault entry's `file_path` stays NULL, and its base64 file bytes (plus OCR text for
image/pdf, bundled together) travel inside the exact same `encrypted_body` column and
`encryptPrivateNote`/`decryptPrivateNote` calls a private note's text already used. A note's
plaintext is unchanged (still just its text) — zero migration needed for existing private notes.

**39. Vault search is an in-memory index built fresh on unlock, discarded on lock — never persisted,
not even encrypted.** Considered a persistent encrypted index and rejected it: SQLite FTS5 has no
native encryption, so a "persistent encrypted index" would still mean decrypting everything into an
in-memory FTS5 table on every unlock anyway — at which point most of the work is identical to the
simple option, minus a second on-disk artifact that has to be kept in sync with the vault's actual
contents on every add/edit/delete (a real, ongoing bug surface for a feature whose entire point is
"don't leak this"). At this scale (a personal vault, not an enterprise search problem) the
performance case for persistence doesn't hold either. Mirrors `privateSessionKey`'s existing
in-memory-only lifecycle, not a new pattern.

**40. Vault labels/content are excluded from the shared `entries_fts` search index and the shared
`label_history` autocomplete table entirely — not just the body.** Fixed two real bugs to make this
true: `insertEntry()` (db.js) and `restoreBackup()` (backup.js) were both indexing a private entry's
**label** into `entries_fts` even though the body was already excluded — meaning a vault note titled
something sensitive would surface in ordinary, no-PIN search with just an empty preview, leaking its
existence and title. Both also wrote every entry's label to `label_history` unconditionally, which
would have let a vault-only label surface as an autocomplete suggestion in the normal (non-vault)
capture bar. Vault's own search/autocomplete instead comes from the in-memory index (Decision 39).

**41. Share and plain Download work identically for vault and non-vault entries — reversed from this
session's earlier default.** Originally scoped vault items to a Copy-only alternative on the reasoning
that Share/Download inherently means the content leaves the encryption boundary as plaintext.
Overridden on explicit direction: user convenience — "they should have the ability to use the file
however they want" — outweighs that caution here. Content is still decrypted only into memory first,
never written to disk unencrypted until the moment Download is explicitly invoked; the UI should
carry a one-time notice that sharing/downloading a vault item means it's plaintext from that point on.
"Download for append" (still fully encrypted, still requires the vault PIN, never a passkey/default
option) is unaffected — that restriction was never about limiting convenience, it's about the format's
entire purpose being a safe round-trip back into a vault.

**42. Private Vault has its own 30-day trash bin, independent of the main app's**, plus its own
auto-lock timer (`credentials.vault_auto_lock_minutes`, separate column, separate from
`auto_lock_minutes`). No new table for the second bin — `deleted_at`+`is_private` are enough to
distinguish "which bin" a soft-deleted row belongs to; `listTrash()`/`restoreFromTrash()`/
`permanentlyDeleteEntry()` (db.js) are shared, generic functions, not duplicated per bin.

**43. Every per-file action's UI shows Share / Download / Download for append / Edit / Delete in that
order, identically, for both non-vault and vault entries** — full parity, per explicit direction
("every single thing in non private will be exactly replicated in private vault"), Share/Download
restriction lifted per Decision 41.

**44. "Select files" multi-select: category-grouped, size shown per item, selectable individually or
as a whole category.** Bulk actions cover four of the five (Share, Download, Download for append,
Delete) — Edit stays per-item only, bulk-editing arbitrary fields across mixed entry types doesn't
have a coherent meaning. One shared implementation for both main and vault (same parity principle).
Known limitation, not papered over: Capacitor's Share plugin has no multi-file share of its own, so a
bulk Share opens one native share sheet per item sequentially rather than a single combined share.

**45. Both locks — app-level password and Vault PIN — lock immediately on backgrounding, not just
after idle timeout.** `@capacitor/app`'s `appStateChange` listener triggers this; the app-level idle
timer itself resets via one delegated document-level listener (click/keydown/input) rather than
manually calling `armAppAutoLock()` from every capture/search/browse function individually — the
vault's own timer needed several follow-up patches for exactly that omission, so the app-level one
was built to not repeat it. No-op when quick access is enabled — there's nothing to lock back to.

---

**46. Added Vite as a real build step — `src/` is now the source, `www/` is build output.**

Root cause this fixes: the app has **never once been able to load, in any session**, because
browsers cannot resolve bare npm-package specifiers (`import { X } from '@capacitor/filesystem'`)
on their own — only a bundler or a hand-authored import map can, and ES module resolution happens
before any code runs, so a single unresolvable import anywhere in the dependency graph blocks the
entire script. Every file that imports a Capacitor plugin (`notifications.js`, `backup.js`,
`fileactions.js`, `gdrive.js`, and `app.js` itself) has had this problem since before any of these
sessions existed. The first device test's blank screen had two causes stacked on top of each other —
a `window.sqlitePlugin` global that nothing set (fixed the prior session) and this bare-import
problem underneath it, which the sqlitePlugin fix didn't touch since it introduced a normal ES
import for the same package, which has the identical failure mode. The second device test's still-
blank screen is what actually surfaced this.

Why this wasn't caught by any earlier syntax check: `node --check` uses Node's module resolution,
which *can* resolve bare specifiers from `node_modules` — completely different from a browser's
native ES module loader, which has no such algorithm without an import map. Checking with the wrong
tool gave false confidence for many sessions.

**The fix, verified by actually running it, not just asserted:** added Vite (`^7.3.2` — checked
against current npm data, not assumed from memory) as a devDependency, moved `src/` to be the real
source directory, configured Vite to build `src/` → `../www` so `capacitor.config.json`'s `webDir`
never has to change, and added a `npm run build` step to CI before `cap sync`. Ran `npm install` +
`npx vite build` for real in a sandbox before delivering this — 82 modules bundled successfully, and
the output was grepped to confirm zero unresolved `@capacitor`/`@zip`/`@codetrix` imports remain
anywhere in the built JS.

This also means every existing `import` statement across every file (db.js, crypto.js, intents.js,
notifications.js, ads.js, backup.js, gdrive.js, vault.js, fileactions.js, app.js) needed **no code
changes at all** — they were always correct JavaScript, just missing the one build step that makes
them resolvable in a real browser engine. The fix is entirely in the build pipeline, not the app code.

---

**47. `gdrive.js` never calls `GoogleAuth.signIn()` until `GOOGLE_DRIVE_CONFIGURED` is manually
flipped to `true`.** Root cause of the actual "Arkly keeps stopping" crash, confirmed by a real
device crash log (Session 21) — not the SQLite/bundling issues from Sessions 18–19, which were both
real and correctly fixed. The plugin's native `signIn()` method has no null-check on its internal
`GoogleSignInClient` before calling it; with no client ID configured, that's a guaranteed uncaught
`NullPointerException` **inside the plugin's own compiled Java code**, which kills the whole app
process before anything can reach JavaScript — confirmed no amount of JS-side try/catch could have
caught this, since the crash happens on the native side of the bridge, before a promise resolution
or rejection is even possible. The guard is a plain JS boolean, flipped manually alongside adding a
real client ID (`android-notes/native-setup.md` §11) — simple, explicit, and impossible to forget
since both steps are documented together in one place.

---

**48. Voice recording uses `cap-voice-rec` (v6.x), not the original `tchvu3/capacitor-voice-recorder`
or its `@independo` fork.** Fixes a real, confirmed device bug (Session 24): the voice capture
button was using the same generic file-picker as image/pdf/file, meaning "record a voice memo"
actually asked the person to upload an existing audio file rather than record one.

Chose `cap-voice-rec` specifically because its major version explicitly tracks Capacitor's own major
version (named "For Capacitor 6"), avoiding the exact version-mismatch class of problem the Google
Sign-In plugin caused earlier (Session 21) — the original `tchvu3` package is on major version 7,
which by its own stated convention ("major versions of the plugin are compatible with major versions
of Capacitor") likely targets Capacitor 7, not our Capacitor 6 pin. `@independo`'s actively-maintained
fork was also considered — better long-term maintenance, but requires bumping `minSdkVersion` from
Capacitor 6's default of 22 to 24, a native config change with no clear payoff given the API need
here is simple record/stop, not the fork's more advanced continue/finalize controls.

Verified before writing any code against it, not assumed: queried the npm registry directly for the
real current version (`6.0.1`, not a guessed number), installed it for real in a sandbox, and read
its actual shipped `definitions.d.ts` to confirm `stopRecording()`'s exact return shape
(`{ value: { recordDataBase64, msDuration, mimeType } }`) — its own README had an inconsistency
about this (one section mentioned a `path` field that doesn't exist in the actual type definitions).
Also fixed two related bugs found in the same code path: `pdf` and `image` capture had no `accept`
filter on their file inputs, so either would accept literally any file type.

Not done: the noise-reduction toggle from the original plan (`android-notes/native-setup.md` §5) —
this plugin has no audio-source parameter to expose it. Still an open item, tracked separately from
basic recording, which is what was actually broken and is now fixed.

---

**49. Manifest permissions are applied by a CI script (`scripts/patch-manifest.js`), never by hand-editing
a manifest file.** Root cause this fixes, found while resolving Session 24's flagged "unverified"
question about `cap-voice-rec` and `RECORD_AUDIO`: `android/` has never actually been committed to the
repo — `build-android.yml`'s "add platform if not present" check has been true on every run across all
24 prior sessions — so `android-notes/native-setup.md` §3's permission list, despite being documented
since Session 1, had never actually been injected into any AndroidManifest.xml that reached a real build.
A hand-edit would have been discarded the next CI run regardless of whether anyone remembered to make it.

Confirmed by direct inspection, not assumption: downloaded `cap-voice-rec@6.0.1` from npm and read its
shipped `android/src/main/AndroidManifest.xml`. It declares a `<service>` with
`android:foregroundServiceType="microphone"` and zero `<uses-permission>` entries — so it does not
self-declare `RECORD_AUDIO`, resolving Session 24's open question, and its foreground service has no
permission of its own either, which is a second, previously unflagged gap. Cross-checked Capacitor's own
5→6 upgrade documentation to confirm the project's default `targetSdkVersion` is **34**: Android 14 (API
34) requires both `FOREGROUND_SERVICE` and a type-specific permission (`FOREGROUND_SERVICE_MICROPHONE`
for a `microphone`-typed service) declared in the manifest, or the OS throws a `SecurityException`/
`MissingForegroundServiceTypeException` at `startForeground()`, inside native code — unreachable by any
JS-side try/catch, the same failure class as Decision 47. Untested until now only because Session 24
built the recording UI but hadn't yet run it on a device.

Fix: `scripts/patch-manifest.js`, run by CI (`build-android.yml`) immediately after `npx cap add android`
and before `cap sync`/icon generation. Idempotent — checks for each permission before inserting, so it's
harmless to run against an already-patched manifest and safe to keep even if `android/` is committed
later. All eight permissions from `native-setup.md` §3 (the original six plus the two new
foreground-service ones) now live in one place, `REQUIRED_PERMISSIONS` in that script, rather than a doc
list with no mechanism to apply it. Verified by running the script against a representative sample
manifest in a sandbox before delivering: inserted all eight on first run, correctly no-op'd on a second
run against its own output.

Also noted, not acted on: `package.json` lists `@capawesome-team/capacitor-android-foreground-service` as
a dependency, but nothing in `src/js/` imports it — dead weight, likely a leftover from before
`cap-voice-rec` was chosen. Flagged for later cleanup, not removed this session since it isn't the cause
of anything currently broken.

---

**50. Biometric unlock is a convenience alternative to typing the app-open password or Vault PIN — never
a fourth credential, never both locks via one toggle.** Off by default; each lock's toggle requires
confirming the real password/PIN (hash-compared against what's stored) before anything reaches the
biometric layer, and changing or removing that password/PIN immediately clears the biometric secret for
it, forcing re-confirmation — a stale cached value would otherwise unlock with, or derive a vault key
from, a credential that no longer matches.

Plugin: `@capgo/capacitor-native-biometric@6.0.4`, chosen over the original (unscoped)
`capacitor-native-biometric` after checking both directly: the original's peer dependency is
`@capacitor/core@^3.4.3` and its `build.gradle` points at `jcenter()`, dead since 2021 — using it risked
breaking the CI build outright. The Capgo fork's `6.0.4` pins `@capacitor/core@^6.0.0` and uses
`google()`/`mavenCentral()` with AGP 8.2.1, compileSdk/targetSdk 34 — matches this project. No manifest
permission needed in `scripts/patch-manifest.js`: `androidx.biometric:biometric:1.1.0` (the plugin's own
dependency) self-declares `USE_BIOMETRIC` in its own manifest, standard for that library.

Security model, read from the plugin's native source rather than assumed from its README: its Keystore
key is configured with `setUnlockedDeviceRequired(true)` but not `setUserAuthenticationRequired(true)` —
so decrypting the stored secret only requires the device to be unlocked, not a fresh biometric check on
every read. The actual biometric gate is enforced by this app's own call sequence in `src/js/biometric.js`
(always `verifyIdentity()`, only `getCredentials()` after it resolves), not by the hardware on every
access. Documented plainly in `android-notes/native-setup.md` §10 and `ARCHITECTURE.md` §3 rather than
oversold — this is the same model most consumer apps' "unlock with fingerprint" uses, and manual
password/PIN entry remains the actual security boundary underneath it.

Implementation: `src/js/biometric.js` (new, thin wrapper around the plugin); two new `credentials`
columns (`biometric_app_enabled`, `biometric_vault_enabled`); `src/js/db.js` gained its first real schema
migration (`ensureColumn()`, since `CREATE TABLE IF NOT EXISTS` never retrofits a column onto an existing
on-device install — the same class of gap Decision 49 found for manifest permissions, different layer).
`unlockVault()`/`attemptUnlock()` are reused as-is for the biometric path (the retrieved secret is just
handed to the same verify function a typed entry would use) rather than duplicating "what counts as
correct" a second time.

Also removed this session: `@capawesome-team/capacitor-android-foreground-service` from `package.json`,
flagged as dead weight in Decision 49 — nothing in `src/js/` ever imported it.

---

**51. Every build now gets a real, always-different version, automatically — `versionCode` from the CI
run number, `versionName` from `package.json` plus that same number.** Same root cause as Decision 49,
one layer over: `android/app/build.gradle` comes from the Capacitor CLI's template every time `android/`
is regenerated (every run), and that template unconditionally ships `versionCode 1` / `versionName
"1.0"` — confirmed by extracting `@capacitor/cli`'s actual `android-template.tar.gz` and reading it
directly, not assumed from familiarity with Capacitor. Every build has shipped identically versioned
since Session 1, with no way to tell installed builds apart.

Fix: `scripts/patch-version.js` (new), run by CI immediately after `patch-manifest.js`.
`versionCode = github.run_number` — a strictly increasing integer GitHub Actions already provides, so
there's no manual counter to remember to bump and no risk of forgetting (the actual problem reported:
"still builds with 1.0, need to bump version for every build" is solved by removing the manual step
entirely, not by adding a reminder to do one). `versionName = "<package.json version>+<run number>"`,
so a build installed on-device can be identified from Settings > Apps without checking CI logs, and
`package.json`'s version field still means something (bump it by hand for a real release; the run-number
suffix changes regardless).

Verified by running the script against the actual extracted Capacitor template in a sandbox: correctly
rewrote both fields, correctly overwrote them again on a second run with a different run number
(deliberately not idempotent-skip like `patch-manifest.js` — there's nothing valid to skip on a
template that's always "1.0"), and correctly refused to run (exit 1, clear error) when
`GITHUB_RUN_NUMBER` isn't set, rather than silently guessing a version.

Unrelated, noted for the record: the app icon was replaced directly on GitHub by hand this session
(`resources/icon.png`) — exactly the documented single-file swap in `native-setup.md` §2, no code or
doc change needed on this end.

---

**52. Default theme is colorful, not just the opt-in Gradient mode — one color per capture type
(Text/Voice/Image/PDF/Files), used consistently everywhere that type appears.** Requested directly:
the previous theme (flat grey/white, single blue accent) read as dated, confirmed by the attached
screenshots. Gradient mode (the existing full-screen blurred-glow, user-picked-color effect) stays
exactly as it was — untouched mechanism, still opt-in, still separate — this decision is about what
the app looks like *without* it turned on.

Palette: one brand accent (indigo/violet, `#6C5CE7`) for primary actions and the wordmark, plus five
category colors — amber (note), teal (voice), pink (image), blue (pdf), green (file) — applied to the
capture-bar buttons, every list row's left edge (`.drive-backup-row[data-type=...]`), and the Vault's
filter tabs and capture bar. The color carries real information (which type something is, scannable
down a long list) rather than sitting on top as decoration — the same five hues appear in the same
places whether you're in the main timeline or the Vault, so the mapping only has to be learned once.

`src/js/app.js` gained `data-type="..."` on six render call sites that previously only put the type in
the row's text (`renderMainTimeline`, its search-input counterpart, `renderTrash`, `renderVaultList`,
its search-input counterpart, `renderVaultTrash`) — additive only, nothing removed, verified the type
vocabulary already matched the capture buttons' `data-type`/`data-vault-type` values exactly
(`note`/`voice`/`image`/`pdf`/`file`) before relying on it. Two render sites (`renderDriveBackupList`,
`renderStorageBreakdown`) weren't touched — their rows represent whole backups or storage categories,
not a single capture type, so there's no matching color to apply.

Checked contrast before finalizing, not after a complaint: white text on the lighter category colors
(amber/teal/green) failed WCAG AA on the Vault's capture-bar button labels — fixed by giving those
buttons dark, per-color text (same values already used for the Vault tabs' active state, which were
fine). The primary-button gradient had the same problem at its lighter end in both themes — fixed by
splitting button-fill color (`--btn-1`/`--btn-2`, kept dark enough for white text in both themes) from
brand-as-text color (`--brand`, used for the wordmark, secondary-button text/border, and the focus
ring — needs to read well as text on the page background instead, a different constraint). Verified
every resulting pairing with the actual WCAG contrast formula in a sandbox, not by eye.

System font stack kept as-is, deliberately: this is an offline app with no other network calls beyond
the ads SDK, and a web font would be the first thing in the entire codebase that needs fetching
anything to render text. Hierarchy comes from weight/scale instead of a second typeface.

---

**53. Gradient mode removed entirely; layout rebuilt around a bottom nav (Home / Vault / Settings)
instead of one long scrolling page; every single-setting checkbox restyled as a switch.** Requested
directly, alongside keeping dark mode.

Gradient mode's full removal: `--gradient-1`/`--gradient-2` CSS custom properties, the
`data-gradient` attribute and its `:root[data-gradient="on"]` rules, `setGradientMode()`,
`gradientMode`/`gradientColor1`/`gradientColor2` from `getAppearance()`/`applyAppearance()`, and the
toggle + two color-picker inputs from Settings. Old `gradient_mode`/`gradient_color_1`/
`gradient_color_2` rows already written to the generic `meta` table (including inside any backup
file made before this session) are simply never read again — harmless to leave, nothing left that
reads them, no migration needed since appearance was always stored key-by-key rather than as
dedicated schema columns.

Layout: `#main-screen` split into two panels, `#home-tab` (capture bar, search, timeline — what used
to be the whole screen) and `#settings-tab` (every `<details>` section that used to sit stacked below
the timeline on the same page). A new fixed `#bottom-nav` (Home / Vault / Settings) switches between
them, plus `#vault-screen`, which was already its own screen and needed no restructuring — tapping
Vault calls the exact same `showScreen('vault-screen')` every existing unlock-success path already
called, so there's no new code path for the Vault's own lock gate to go through. `showScreen()` now
also drives the nav's visibility (hidden for first-run/lock-screen/ad-gate, which have nothing to
navigate between yet) and active-tab state, in one place, rather than every call site managing that
itself.

Every standalone on/off setting (dark mode, both biometric toggles, Drive auto-backup, the
safety-backup confirmation) is now a sliding switch, done as a pure CSS restyle of the existing
`<input type="checkbox">` (`appearance: none` + a `::before` thumb) — no change to the underlying
element, id, or `change` listener, so none of the JS that reads `.checked` needed touching. Backup/
restore's category checkboxes deliberately stay compact checkboxes, not switches — picking several
items from a list is a different kind of choice than flipping one setting on or off, and a row of
five switches for that would read wrong. Restore-mode's radio buttons got the same modern-dot
treatment.

`<details>`/`<summary>` in the new Settings tab restyled as cards with a custom rotating chevron
(`::-webkit-details-marker` hidden, `::after` chevron rotated via `[open]`) instead of the browser's
default disclosure triangle — the single biggest contributor to the "1990s" complaint, by nature of
being what a plain unstyled `<details>` list always looks like regardless of anything else on the
page.

Checked WCAG contrast for every new color pairing before finalizing, same discipline as Decision 52:
found and fixed three real failures — the bottom nav's active-tab label (used `--brand` directly at
first, landed at 4.06:1/4.34:1 in light/dark, just under the 4.5:1 small-text threshold; added a
dedicated `--nav-active` token per theme instead, both now ≥5.4:1) and the inactive tab label (fg at
55% opacity blended to 3.87:1 in light mode; raised to 70% opacity, ≥4.5:1 in both themes). Also
swapped two newer CSS features (`color-mix()`, `:has()`) for explicit per-theme tokens and an added
HTML class respectively — both are fine on current Chrome but this app's minSdk 22 (Decision — see
Session 20) means some real devices may carry an older system WebView than whatever's on the
development machine that would have "just worked" during a quick look; explicit fallback-free CSS
costs nothing here and removes the question entirely rather than assuming.

---

**54. Fixed a real security bug: the Vault's PIN gate was never actually connected to `vault-screen`,
so the bottom-nav Vault button opened straight into vault content with no gate at all. Also: both
locks now default to attempting biometric immediately rather than waiting for a button tap.**

Root cause, found by reading the actual current HTML rather than assuming Session 29's refactor had
kept things wired correctly: Session 29 moved `vault-pin-setup-view`/`vault-locked-view` (and the
Session 26 biometric toggle) into Settings' `#vault-settings` accordion, while `#vault-content`
(capture bar, search, tabs, list, trash) stayed in `#vault-screen` with nothing above it to gate on.
The bottom nav's Vault button always called `showScreen('vault-screen')` directly — a screen that,
after that refactor, had never had a lock gate of its own to begin with, only content. A second,
compounding bug in the same area: `lockVault()` cleared the in-memory session key but never cleared
`#vault-list`/`#vault-trash-list`'s already-rendered HTML, so even reaching the gate correctly
wouldn't have hidden content a previous unlock had already rendered into the page.

Fixed by moving the gate elements back into `vault-screen` itself (before `#vault-content`, where
they were originally before Session 29), and rewriting `refreshVaultGateView()` to be the one
function that decides all three states — needs-setup / locked / unlocked — based on whether a PIN
exists and whether `privateSessionKey` is currently set, toggling `#vault-content`'s visibility as
part of that instead of leaving it permanently visible. Every unlock success path (PIN, biometric)
and the Lock button now route through this function rather than assuming the caller already knows
which view should be showing. `lockVault()` now also clears both list containers' `innerHTML`
directly — defense in depth on top of the container being hidden, not a substitute for it.

Biometric defaults: both the app-open lock screen and the Vault gate now call their respective
`tryBiometricUnlock*()` automatically as soon as they're shown, when enabled — fire-and-forget,
reusing the exact same success/failure paths a manual button tap already used, so cancelling or
failing just leaves the password/PIN field available same as before. The Vault's version is guarded
by a module-level flag (`vaultBioAutoPrompted`, reset in `lockVault()`) so it fires once per fresh
"locked" state rather than re-prompting on every re-render while still locked — the app lock screen
needs no equivalent guard since `showLockScreen()` itself only ever runs when freshly (re)locking.

---

**55. Added Money as a sixth capture type (card only — its actual capture flow is intentionally not
built yet, by request); redesigned both capture bars as a 6-card grid; renamed backup/append
filenames to `<prefix>_<letters>_<timestamp>.dz`.**

Money: added everywhere the existing five types are threaded through, deliberately as its own new
type rather than reusing the existing auto-detected `expense` type (which stays exactly as it was,
untouched, still populated only via `intents.js`'s text parsing, not manual capture) — the two are
different mechanisms and conflating them without being asked to felt like the wrong call; easy to
unify later if that turns out to be wanted instead. Touched: `VAULT_TYPES` (vault.js), `buildBackup-
Plaintext`/`parseVaultPlaintext` (given a placeholder text-only shape, same as 'note', since no real
shape has been specified yet), `CATEGORY_LABELS`/`VAULT_TYPE_LABELS` (app.js), `ENTRY_CATEGORIES` in
backup.js (a `money` backup category, letter `m`), and a new `--type-money` color (red — the only
one of the six hues not already in use, and a deliberate, not incidental, choice for a money
category). Tapping the Money card shows a plain "coming soon" message rather than falling into the
generic file-picker branch the other non-special-cased types use, which would have been actively
wrong for a type with no defined shape yet.

Capture UI: both `#capture-bar` and `#vault-capture-bar` are now a 3-column grid of cards (icon
above a text label, larger tap target) instead of a thin row of icon-only buttons — Home's capture
bar gains labels it never had before ("Text", "Voice", etc.), matching what the Vault's bar already
showed. Checked contrast again before finalizing: Home's cards now carry real label text on the
category colors for the first time, so they needed the same dark-text treatment already computed for
the Vault's equivalents (Decision 52) — applied to both via one shared selector rather than
duplicating the color values.

Filenames: `backup_<letters>_<yyyymmdd_hhmmss>.dz` for a full Backup & Restore export,
`append_<letters>_<yyyymmdd_hhmmss>.dz` for a single entry's "Download for append" export — same
shape, different leading word, exactly as specified. `<letters>` is a fixed-order subset of `tvipmf`
(Text/Voice/Image/PDF/Money/Files, only the ones actually included, in that order regardless of
selection order); categories with no letter of their own (Private Vault, Expenses, Reminders, Tags,
App Settings) simply don't contribute one, and `x` is used if none of the six lettered categories
are present at all, so the filename is never left with an empty segment — neither case was specified,
both are reasoned-through defaults, flagged rather than silently assumed. Read the timestamp format
in the request as a likely typo (`yyyymmddh_hhmmss` — an extra "h" before the underscore) and built
the standard `yyyymmdd_hhmmss` instead; flagged rather than guessed silently. Extension changed from
`.dzbackup`/`.zip` to `.dz` for both — the two file types remain internally different (one's a plain
encrypted JSON blob, the other's an actual zip archive), which stays fine since nothing in the code
ever branched on file extension to begin with, only on which `<input>` the file came through; file
pickers still accept the old extensions so previously-made backups keep working. One accepted
tradeoff: the per-entry append filename lost its old label-based naming (which made two exports
distinguishable at a glance even with identical timestamps) in favor of the uniform format — two
exports of the same category within the same second would now collide on name. Not solved, since the
spec was explicit about the format and this felt like a real but rare edge case worth flagging rather
than deviating to handle unasked.

Found and cleaned up in passing: `APP_SETTINGS_KEYS` in backup.js still listed the three
`gradient_mode`/`gradient_color_1`/`gradient_color_2` meta keys removed in Decision 53 — a stale
leftover from that removal, not something new. Old backups containing those keys still restore fine
(harmless, unread rows); just stopped being an active part of what a new backup writes.

---

**56. Fixed five real bugs reported directly against a device, all in the areas Sessions 29/30
touched — the app lock screen's auto-biometric, the bottom nav, and the Vault gate.**

*Auto-biometric required two attempts on cold start.* Reasoned root cause (not confirmed by
instrumented logging, since that's not available here): triggering the OS BiometricPrompt
immediately on cold start, before the Android Activity has actually settled/gained window focus, is
a known class of timing issue — the prompt can visually appear and accept the fingerprint without
the result reliably reaching the app, so a second, later attempt (once focus has settled) works.
Mitigated with a 400ms delay before the automatic attempt in `showLockScreen()` — a reasoned
estimate, not a measured value; worth tightening, or replacing with an actual focus/resume signal,
if a real device check shows it's still flaky. The Vault gate's equivalent auto-attempt wasn't given
the same delay — it's reached by navigating there, not by a cold start, so Activity focus should
already be established by the time it fires.

*Bottom-nav Home/Settings did nothing while on the Vault screen.* Root cause: the nav handler called
`switchMainTab(tab)` directly, which only toggles `#home-tab`/`#settings-tab` inside `#main-screen` —
it never actually showed `#main-screen` itself. If `#vault-screen` was the currently visible screen,
tapping Home or Settings just silently changed which sub-tab main-screen would show *the next time
it became visible*, with no visible effect. Fixed by giving `showScreen()` an optional `tab`
parameter (defaulting to Home, preserving every existing `showScreen('main-screen')` call site's
behavior unchanged) and having the nav handler call `showScreen('main-screen', { tab })` instead of
touching the sub-tab directly.

*The Lock button stayed visible on the Vault's locked/setup gate, where there's nothing to lock.*
Fixed: `refreshVaultGateView()` now hides `#vault-lock-btn` unless genuinely unlocked.

*The biometric enable/disable toggle showed on the locked landing gate, not just once inside.*
Requested directly: the toggle (and its confirm-PIN sub-form) is a Vault *setting*, not part of
getting into the Vault — the "Unlock with fingerprint/face" *button* correctly stays on the locked
gate (that's the actual unlock mechanism), but the toggle now only renders once truly unlocked.
Moved the markup from beside `vault-locked-view` into `#vault-content`, and changed
`refreshVaultGateView()`'s visibility condition on the row from "a PIN exists" to "currently
unlocked."

*Locking the Vault didn't return to Home immediately.* The handler was awaiting an async gate
refresh before navigating away. Reordered: `showScreen('main-screen')` now runs synchronously,
right after `lockVault()`, with no await in between — the gate refresh that used to happen here
isn't needed anyway, since the bottom nav's Vault handler already calls `refreshVaultGateView()`
fresh on every visit.

---

**57. Added Reminder and Location as two more capture cards (placeholder, same as Money in Decision
55), positioned before Money — Text/Voice/Image/PDF/Reminder/Location/Money/Files, eight cards now.
Backup filename letters extended from `tvipmf` to `tviprlmf` to match.**

Reminder reuses the *existing* `type: 'reminder'` / `reminders` category rather than introducing a
parallel type, unlike Money's relationship to Expense — the two situations aren't actually
analogous. `intents.js` already auto-detects reminders from typed text ("remind me..."), and a
reminder is a reminder regardless of how it was created; there's no real ambiguity the way "money"
could mean several different things, which is what motivated keeping Money and Expense apart. One
real consequence of this reuse: Reminder is now vault-capable (it's one of the eight manual capture
cards, all of which support Private Vault), so `reminders` in `ENTRY_CATEGORIES` gained the same
`&& !e.is_private` guard every other vault-capable category already has — a no-op for any reminder
that exists today (all auto-detected, never private), only relevant once a private one becomes
possible. Location is genuinely new — no prior type, schema, or auto-detection to reuse — added
exactly like Money: its own category (`locations`), its own color, placeholder "coming soon" on tap,
no defined content shape yet.

Colors: red was already taken by Money, so Reminder is orange (`#F97316`) and Location is cyan
(`#06B6D4`) — the two remaining hues distinct from all six already in use. Checked contrast the same
way as every color added since Decision 52: both need dark text over their background (white fails
AA at this saturation/lightness, same as five of the other six type colors already did).

Filenames: `tvipmf` → `tviprlmf`, in card order (Text/Voice/Image/PDF/Reminder/Location/Money/Files).
`CATEGORY_LETTERS`/`LETTER_ORDER` in backup.js updated together, plus the design-plan comment at the
top of `style.css` and the filename convention section in `ARCHITECTURE.md` §4 — all three needed to
stay in sync or the documentation would have drifted from the code the moment this shipped. This
extension wasn't explicitly requested in so many words — the request added two cards to the same
visual set the filename letters were built from, and extending the acronym to match felt like the
faithful reading of "these letters represent the cards," but it's a judgment call, flagged rather
than silently assumed, same as the other filename defaults in Decision 55.

Capture-card grid: 3 columns → 4, for a clean 4x2 layout instead of 3+3+2.

---

**58. Ads deferred to a future build — explicit product decision, not a technical default.** No
AdMob account, no plugin, no gate shown, not even a notification-based ad format — nothing ad-related
ships in this build. Phase 12 in ROADMAP.md stays unstarted and now says so explicitly rather than
just sitting unchecked; `ads.js`'s gate-decision logic is untouched and stays in the repo as
scaffolding for whenever this is actually picked up, since deleting working, self-contained logic
that isn't the cause of anything broken isn't warranted here — only its one caller was removed.

That caller turned out to matter more than expected. Investigating a reported freeze ("once entering
the app completely froze, nothing works") plus a worse version of Session 31's biometric-timing bug
(now needing a full second unlock, not just a second tap) surfaced two compounding issues in the same
area, both fixed together:

1. `onUnlocked()` called `runDailyAdGateIfDue(window.adSdk, metaStore)` every single unlock.
   `window.adSdk` has never been set anywhere — confirmed by checking `package.json` and
   `capacitor.config.json` directly, neither has ever referenced an AdMob plugin, matching what
   ROADMAP.md's Phase 12 already said. `ads.js`'s own `try/catch` handled the resulting
   `TypeError` safely on its own — this was extra, pointless async work on the unlock path, not a
   confirmed hang by itself, but real complexity with nothing behind it, removed along with the ads
   decision above rather than left in place calling into nothing.

2. The actual likely cause of the freeze/double-unlock: Session 31's fix for the biometric
   cold-start timing bug used a bare `setTimeout(..., 400)` called from inside `showLockScreen()`,
   independent of the rest of `DOMContentLoaded`'s own setup. That setup does its own sequence of
   awaited database calls (populating Settings' toggles, biometric availability, etc.), and the
   timeout's 400ms could land in the middle of it on a slower device — two separate chains of
   SQLite calls running concurrently against the single connection, which is a plausible, common
   cause of exactly this symptom (an unlock that appears to succeed but the app never actually
   finishes initializing). Reasoned from the code and the timing involved, not confirmed via
   device-side logging, which isn't available here.

   Fixed by moving the actual trigger to the last line of the `DOMContentLoaded` handler, after
   every other setup step has fully run — there's nothing left for it to race against at that
   point. `showLockScreen()` still computes `window.biometricUnlockAvailable`, it just no longer
   schedules anything itself. Kept a smaller delay (300ms) on top for the original window-focus
   concern Session 31 was trying to address, now layered on top of "wait for our own setup to
   finish" rather than substituting for it.

---

**59. Fixed the actual cause of two more reported bugs: two biometric prompts firing on every app
open, and the Vault sometimes ending up already unlocked with no PIN/biometric prompt at all.**

Root cause: `DOMContentLoaded`'s initial setup called `refreshVaultGateView()` once, unconditionally,
right after wiring the Vault's buttons — before the person had done anything, let alone reached or
tapped the Vault tab. `refreshVaultGateView()` auto-triggers a biometric attempt for the Vault when
it's enabled (Decision 56), so this fired a **second** biometric prompt on cold start, independent of
and racing against the app lock screen's own auto-attempt (Decision 56/58) — matching exactly what
was reported: two prompts, and which one "wins" (or whether both are needed) depending on timing.
Worse: if that Vault-side attempt succeeded, `privateSessionKey` got set and the Vault's content
silently became available — while the person was still looking at the *app's* lock screen, having
authenticated for the app, not the Vault. Reaching the Vault tab afterward would then show it already
unlocked, no prompt at all, because it already was.

This line had been redundant since the moment the bottom-nav Vault button was written (Session 30) —
that handler already calls `refreshVaultGateView()` fresh on every actual visit, and vault-screen
starts hidden regardless, so nothing needed the state pre-computed at cold start. It went unnoticed
because on its own it was harmless (just redundant); it only became actively wrong once Decision 56
added an auto-biometric side effect to the function it was redundantly calling. Removed entirely,
with the reasoning left in a comment at the call site it used to occupy, since "this looks like it
should be here" is exactly the kind of assumption that put it there in the first place.

---

**60. Fixed the Select files screen's scattered layout — a checkbox sizing bug, not a one-off
styling gap.** Reported directly against a screenshot: category and item checkboxes floated
disconnected from their labels, labels pushed to odd positions. Root cause: `.cat-select-all` and
`.item-select` (the Select files screen's checkboxes) had never been given a rule of their own —
every checkbox styled so far (Decisions 52/53) was scoped to a specific class
(`.switch-row`/`.category-checkboxes`), so anything outside those fell through to the general
`input, button, select { width: 100% }` rule, stretching the checkbox and scattering whatever sat
next to it in its flex row.

Fixed at the root rather than adding a third one-off class-scoped rule (the same gap that caused
this): the compact square-checkmark checkbox is now the *default* for any plain `input[type=
checkbox]`, and `.switch-row` overrides it to the sliding-switch look for the handful of single
on/off settings that want that instead. A checkbox with no specific class now still gets sane
sizing rather than silently inheriting `width: 100%` — closes this category of bug for any checkbox
added later, not just the one reported. Also caught while consolidating: the switch needed an
explicit `content: none` on its `:checked::after` to suppress the new default checkmark glyph,
which would otherwise have shown up inside the sliding thumb.

Also fixed while in this file, unrelated to the report but found during review: Decision 53's own
entry had ended up out of chronological order, sitting after Decision 59 instead of after Decision
52 — an artifact of an earlier edit anchoring to non-unique matching text. Moved back into place;
no content was lost or changed, only its position in the file.

---

**61. Bottom nav reduced from three tabs to two — Home and Vault only. Settings (both the main app's
and the Vault's) moved from being a nav destination to being a card/tile reached from within the
screen it belongs to. A small red circular power button, present on every screen, force-closes the
app.**

Requested directly. Three changes, all UI-only — no schema, no credential, no backup-format change:

1. **Home:** `#settings-tab` itself is unchanged (same accordion of Your Data/Storage breakdown/
   Trash/App lock/Appearance/Backup & Restore/Google Drive/Append-from-download) — only its entry
   point moved, from the bottom nav's third button to an "⚙️ App Settings" tile inside Home, below
   the capture cards. `switchMainTab()` (already the function that shows/hides `#home-tab`/
   `#settings-tab`) is unchanged in what it does, just no longer driven by a nav button for the
   `'settings'` case — the tile and a new "← Back to Home" link at the top of `#settings-tab` call
   it directly. Settings is treated as part of Home for nav-highlighting purposes: viewing it keeps
   the Home icon active in the (now two-button) nav, rather than nothing being highlighted.
2. **Vault:** the three previously scattered settings surfaces — the biometric toggle row, the
   auto-lock timeout select (previously its own `<details id="vault-lock-settings">`, now flattened
   to a plain subsection since nothing needed its own collapse/expand), and Vault Trash — are now
   nested inside one `<details id="vault-settings-card">`, matching the "one settings card/tile"
   request the same way Home's tile does. Vault Trash stays its own nested `<details>` (unlike the
   auto-lock select) because `renderVaultTrash()` is lazily triggered by its own `toggle` event —
   collapsing it into a flat subsection would mean it renders every time Vault Settings opens,
   whether or not Trash is what's being checked. No element id changed, so no JS wiring needed
   touching beyond the two new entry-point listeners above — everything else was a pure markup
   relocation. Extended the existing `#settings-tab details` chevron-card CSS treatment (Decision
   53) to `#vault-settings-card` and its nested `#vault-trash-settings`, so Vault's settings read as
   the same design language Home's already do, rather than the plain unstyled `<details>` they were
   using before (a pre-existing, never-previously-flagged gap — only `#settings-tab` had ever gotten
   that treatment).
3. **Power button:** a single `#power-close-btn` element, fixed top-right, living directly under
   `<body>` rather than inside any `.screen` div — so it's present regardless of which screen
   `showScreen()` currently shows, without duplicating it into first-run/lock/main/vault/ad-gate
   individually. Confirms (`confirm('Close Arkly?')`) before acting, since this is a hard process
   kill, not the existing lock-on-background behavior (Decision 45) — that's unaffected and still
   covers what the person sees on next open regardless of whether they used this button or the OS's
   own back/recents gesture. Calls `@capacitor/app`'s `App.exitApp()` (already a project dependency,
   already used for `appStateChange` — Decision 45), guarded by `@capacitor/core`'s
   `Capacitor.isNativePlatform()` so a browser preview shows a plain message instead of a silent
   no-op or a thrown error — `exitApp()` has no meaning outside a native Android/iOS shell. Both
   imported dynamically, matching how the rest of the codebase already brings in plugins only where
   used rather than at module load.

Not done, flagged rather than assumed: whether the power button should also appear inside modal
overlays (Select files, the overwrite-confirm dialog, the auto-backup-due banner) wasn't specified —
left visible underneath them (z-index below `.modal-overlay`'s 10, above the bottom nav's 5) rather
than layered on top, so an open modal still has full visual priority and the button can't be tapped
through it by accident.

---

**62. Recents-preview blanking to match Opera Incognito. Power icon restyled to a
transparent-background red-outline glyph. Confirmation dialog removed from the power button. Power
button removed from the app-open lock screen.**

Requested directly, all four in one session:

1. **Recents-preview blanking:** `MainActivity` needs `FLAG_SECURE` set on its window — no
   JS/Capacitor-layer equivalent exists; this is native-only. Since `android/` is never committed
   (Decision 49), a hand-edited `MainActivity.java` would be silently discarded the next CI run —
   same root problem `patch-manifest.js` solves for the manifest. `scripts/patch-mainactivity.js`
   follows the identical pattern: finds the stock, override-free `MainActivity.java` Capacitor's
   template generates, inserts an `onCreate()` that sets the flag, aborts loudly (rather than
   silently no-op'ing) if the stock file's shape doesn't match what it expects to edit, and skips
   cleanly if already patched. Wired into `build-android.yml` right after the manifest patch step.
   Tested directly in this session's sandbox against a reconstructed stock `MainActivity.java` —
   confirmed correct output on first run and a clean idempotent no-op on a second run — since there's
   no real `android/` folder to test against outside actual CI. **One flag, two effects, not
   separable:** the recents/task-switcher preview goes blank instead of showing a live screenshot
   (the actual ask), and screenshots/screen recording of the app are blocked system-wide as an
   inherent side effect of the same flag. Documented as a feature of the same piece, not a bug, so
   it isn't mistaken for one later — a legitimate build/test risk regardless, since this specific
   native behavior has never run on a device (same standing gap as everything since Session 25).
2. **Power icon restyle:** replaced the solid red circle + white "⏻" glyph (Decision 61) with an
   inline SVG power glyph (line + open-top arc, the standard "power" icon shape) — transparent
   background, `stroke="currentColor"`, button `color: var(--danger)`. Reads correctly in both
   light and dark mode without a separate dark-mode override, since `--danger` (unlike `--bg`/`--fg`/
   `--card-bg`) is the same red in both themes already — nothing new needed there.
3. **Confirmation removed:** the `confirm('Close Arkly?')` gate is gone — tapping the button now
   calls `exitApp()` immediately (still guarded by the same `Capacitor.isNativePlatform()` check as
   before, for the browser-preview case). Removed on request; flagged as the accepted tradeoff — a
   mistaken tap now closes the app with no chance to cancel, same as a mistaken tap of the device's
   own back/recents gesture would.
4. **Hidden on the lock screen:** `showScreen()` now toggles `#power-close-btn`'s `.hidden` class
   based on which screen id is being shown — hidden only for `'lock-screen'` (the app-open password
   gate), present everywhere else including first-run and the Vault's own PIN gate. "Unlock screen"
   in the request read as this one specifically, since it's the one screen whose actual purpose and
   button label is "unlock" the app itself — the Vault's separate PIN gate wasn't named and keeps
   the button. Flagged as an assumption, not confirmed; easy to extend to the Vault gate too if
   that's what was meant.

---

**63. Recents-preview blanking (Decision 62) disabled for now.**

`FLAG_SECURE`'s screenshot-blocking side effect got in the way of taking screenshots during active
development — reported directly. The CI step calling `scripts/patch-mainactivity.js` in
`build-android.yml` is commented out, not deleted; the script itself is untouched and still correct
(confirmed working in Decision 62's own sandbox test). Re-enabling later is a one-line uncomment,
not a rebuild of the feature. Deleting the script file instead, as briefly considered, would have
left the workflow calling a file that no longer exists — a build failure, not a clean disable.

---

**64. Privacy Screen made a real, in-app, user-toggleable setting — replacing Decisions 62/63's
native MainActivity patch entirely.**

Requested directly: rather than a build-time flag that could only be turned off by editing CI
(Decision 63's disable), make it a Settings switch the person can flip themselves, any time.

Decision 62's approach (`scripts/patch-mainactivity.js` hand-inserting `FLAG_SECURE` into
`MainActivity.java`'s `onCreate()`) was fundamentally build-time — the flag got set once, at
process start, with no way for JS to change it afterward short of a full rebuild. That's why
Decision 63 could only ever *disable it entirely* for development, not offer a real toggle.

Replaced with `@capacitor-community/privacy-screen`, pinned to **`5.2.0`** specifically — its
`peerDependencies` is `@capacitor/core ^6.0.0`, the only version line of this plugin that matches
this project's Capacitor 6 (the plugin's own newer major versions, 6.x and 8.x, require Capacitor
7/8; unrelated numbering coincidence that its own version happens to also say "6"). Verified before
adopting by downloading the actual `5.2.0` tarball and reading its shipped Android source directly,
not just its README (same discipline as Decisions 49/50) — `PrivacyScreen.java`'s `enable()`/
`disable()` do exactly `window.addFlags`/`clearFlags(WindowManager.LayoutParams.FLAG_SECURE)` on
the current Activity, nothing more, callable from JS at any time. `capacitor.config.json`'s
`PrivacyScreen.enable` is set to `false` so native startup itself never turns it on — a new
`src/js/privacy-screen.js` wrapper (mirroring `biometric.js`'s shape) applies whatever's actually
stored, at the same point in `bootstrap()` that `applyAppearance()` already runs (before the lock
screen even renders — so the setting, when on, also covers the lock screen, not just the unlocked
app). Persisted via `metaGet`/`metaSet` under `privacy_screen_enabled`, same mechanism as
`dark_mode`/`auto_backup_enabled` — off by default. New `#privacy-screen-settings` card in Settings,
same populate-then-wire pattern as the dark-mode toggle right below it.

One known gap, stated rather than glossed over: on a cold launch there are one or two frames
between the WebView first painting and this module's `enable()` call resolving, during which the
setting (if on) isn't in effect yet. Fixing that would need native code reading a persisted
native-side flag before `onCreate()` finishes — out of scope for what's otherwise a plain web-layer
toggle, and a narrower gap than Decision 62's version had at cold start too (that one had the same
kind of native/JS timing gap, just for a different reason — Capacitor's own bridge init time).

`scripts/patch-mainactivity.js` is superseded, not merely paused this time — delete it from the
repo (see this session's file list). `build-android.yml`'s already-commented-out step calling it is
removed outright rather than left commented, since there's nothing left to re-enable that way.
`android-notes/native-setup.md` §13 is removed for the same reason — it was the last section in
the file, so nothing needs renumbering.

---

**65. Universal lock/unlock button (fixed top-right, left of the power button); vault's own
"Lock" button removed as redundant; universal Back button added as the middle slot of the bottom
nav; every dedicated "back to home" element removed in favor of it.**

Requested directly, three related changes in one session:

1. **Lock/unlock toggle:** new `#lock-toggle-btn`, same fixed-position pattern as the power
   button (Decision 61) — outside every `.screen` element, same z-index layering — positioned
   immediately to its left. Neutral foreground color (`var(--fg)`, not red or brand), since it's
   neither destructive (the power button) nor a primary action, just a status/utility icon.
   Context-aware at click time rather than tracking a separate "which context" flag: checks whether
   `#vault-content` is currently visible to decide whether to lock the Vault or the main app, so it
   can never drift out of sync with what's actually on screen. Locking the Vault is the exact same
   two calls the old `#vault-lock-btn` made (`lockVault()` then a synchronous `showScreen('main-
   screen')`, preserving the Session 31 fix that made that navigation synchronous rather than
   awaiting an async gate refresh first); locking the main app reuses `showLockScreen()` wholesale
   rather than re-implementing its branching — it already correctly handles "password set" (shows
   the real lock screen), "quick access" (no-ops back to Home, since there's nothing to lock), and
   would even handle "no credentials row yet" safely, though that path is additionally guarded by
   checking `#first-run-setup` isn't currently showing, so tapping it mid-setup does nothing rather
   than something undefined.

   Always rendered in its "unlocked" appearance, never "locked" — both places it's shown are
   themselves already-unlocked states by construction (the two exclusions below), so there's no
   case where a "locked" appearance would ever be needed. Hidden on the app-open lock screen (same
   condition as the power button, in `showScreen()`) and on the Vault's own locked/setup gate
   (a second, separate exclusion in `refreshVaultGateView()`, since `vault-screen` doesn't change
   screen id when its internal gate/content substate toggles — the same reason the old
   `#vault-lock-btn`'s visibility rule lived in that same function). `#vault-lock-btn` itself is
   removed from the Vault banner entirely — genuinely redundant now, not kept as a second way to do
   the same thing.

2. **Universal Back button:** middle slot of the three-slot bottom nav (`#nav-back-btn`, between
   Home and Vault), styled as a plain rounded square rather than a third tab — no label, no active
   state, since it isn't a destination. Backed by a deliberately simple two-slot toggle, not a full
   history stack: `currentLocation`/`lastLocation` (one of `'home'`/`'settings'`/`'vault'`),
   updated by `recordLocation()` calls placed inside `showScreen()`/`switchMainTab()` themselves —
   every existing caller of those two functions gets Back-button support for free, without needing
   to touch each call site individually. Pressing Back swaps which location is "current" vs "last"
   the same way any other navigation does, so pressing it again toggles right back to where you
   just left, rather than getting stuck unable to return. A deeper stack was deliberately not built:
   this app's actual navigation depth is only ever one level (Home ⇄ Settings ⇄ Vault), so a stack
   would add complexity with no case that could ever use the extra depth.

   Lives physically inside `#bottom-nav`, so it's hidden together with it for free on screens where
   the nav itself is hidden (lock screen, first-run, ad gate) — no separate visibility rule needed,
   unlike the power/lock buttons which live outside any screen and need their own.
   `refreshVaultGateView` (Vault's gate-render function) had to be exposed as `window.
   refreshVaultGateView` for `goBack()` to call it — `goBack()` lives at module top level alongside
   `showScreen()`/`switchMainTab()`, but `refreshVaultGateView` is itself only ever defined inside
   the `DOMContentLoaded` closure; same cross-closure pattern already used for `window.
   tryBiometricUnlockVault`/`window.attemptUnlock`, not a new one.

3. **Every dedicated back element removed:** `#settings-back-btn` ("← Back to Home", added in
   Decision 61) is gone — the universal Back button replaces it. Nothing else in the app had a
   comparable element.

Not done, flagged rather than assumed: whether the lock/unlock button should also show during
first-run-setup was ambiguous in the request (only two exclusions were named: the two biometric
unlock pages) — left visible there per the literal instruction, with the click handler itself
guarding against acting on it before setup completes, rather than silently adding a third exclusion
that wasn't asked for.

---

**66. Back button restyled (new icon, tap-glow); lock button restyled (golden, thicker, persistent
glow) and given a disabled state; power button given a persistent red glow; the Vault's lock button
— reportedly missing — traced to a contrast bug and fixed by removing the Vault's dark title bar and
the bottom nav's dark active-Vault-tab background; lock button hidden on first-run setup.**

Six related changes, requested together after seeing the app running on-device for the first time:

1. **Back button icon** replaced with a "curved return arrow" (chevron + a hooking curve, no
   enclosing circle), matching a supplied reference image minus its outer ring. Soft glow on tap:
   a `.glow` class triggers a 0.5s `box-shadow` keyframe animation in `var(--brand)`, added and force-
   reflowed before re-adding (so a rapid second tap restarts the animation rather than no-op'ing
   since the class is already present) and removed again on `animationend` so it doesn't linger as
   dead state on the element.
2. **Lock button restyled:** color changed from neutral `var(--fg)` to a new `--gold` (`#d4af37`,
   fixed across both themes, same reasoning as `--danger` already being theme-invariant), stroke
   width increased (2 → 2.6, "thickish"), and a persistent `drop-shadow` glow added — unlike the
   back button's tap-triggered animation, this one is always on, describing the button's resting
   state rather than a feedback gesture.
3. **Power button given a persistent red glow** too (`drop-shadow` in `var(--danger)`) — requested
   as permissive ("can"), added for visual parity with the lock button now that it has one.
4. **Disabled state:** on the main-app screens (Home/Settings), the lock button now visually
   disables itself (`filter: grayscale(1); opacity: 0.35; pointer-events: none`) whenever no
   app-open password is set — quick access has nothing for it to lock into, so this makes that
   fact visible on the button itself rather than only in Settings' own copy ("quick access has
   nothing to lock back to"). Computed fresh on every entry into Home/Settings
   (`updateLockButtonDisabledState()`, called from `switchMainTab()`) rather than cached, so it
   stays correct if a future session adds a UI to actually change the app-open password after
   first-run (no such UI exists yet — `setAppPassword()`/`removeAppPassword()` are only ever called
   from first-run-setup today). Never disabled in the Vault context — the Vault always has a PIN by
   the time this button is shown for it at all (hidden otherwise, on its own locked/setup gate).
5. **Vault's lock button, reportedly missing:** it was never actually missing from the DOM — the
   real cause was a contrast bug. `.vault-banner`'s background was `var(--vault)`, a near-black
   deep violet (`#1a1030`), and the fixed lock-toggle-btn icon sitting visually on top of it used
   `var(--fg)` — dark in light theme, nearly the same near-black tone as the banner behind it, so
   the icon was there but effectively invisible. Restyling the icon gold (change 2, this session)
   already fixes the contrast on its own, but the banner's dark background is also removed outright
   (see next point), which was the direct, separately requested fix.
6. **Vault's dark title bar removed** (`.vault-banner` background changed from `var(--vault)` to
   `var(--card-bg)`, with a plain border instead), and the bottom nav's active-Vault-tab background
   changed from `var(--vault)` (dark) to `var(--vault-fg)` (a light lavender tint), with its text/
   icon color swapped to `var(--vault)` so it stays legible — the same "black bar" look, just in the
   bottom nav instead of the top. The Vault's own visual identity (deliberately distinct from the
   rest of the app, per Decision 52/original design notes) now comes from the lock emoji, the
   letter-spaced heading, and the nav tab's lavender tint, rather than a solid dark panel. The inner
   filter chips (`.vault-tab.active` — All/Text/Voice/etc.) were **not** touched — they weren't
   named in the request, and unlike the icon-on-banner case, light-lavender text on that same dark
   background there is genuinely readable, not a contrast bug.
7. **Lock button hidden on first-run setup** (`showScreen()`'s hide condition extended from just
   `'lock-screen'` to `'lock-screen' || 'first-run-setup'`) — there's no password to lock yet at
   that point, so showing it would be actively misleading, not just redundant. This replaces the
   assumption flagged at the end of Decision 65 (left visible there at the time, pending
   confirmation) — now resolved by this direct instruction.

---

**67. Vault title box removed and heading aligned to the lock/power row; lock gold brightened.**

Requested after seeing Decision 66 on-device. (1) `.vault-banner` lost its card background, border,
and padding — the "🔒 PRIVATE VAULT" heading now sits bare on the page. Its `h2` uses the same
20px/1.45 metrics as Home's "Today" heading inside the same 20px `.screen` padding, so its vertical
center (~34px) lands on the fixed lock/power buttons' center (14px top + 20px half-height) by
construction rather than via a magic offset; Home already aligned this way. (2) `--gold` changed
`#d4af37` → `#ffc61a` (the metallic gold read dull on the light background), and the lock's glow
is now two stacked `drop-shadow` layers (3px + 7px) instead of one, so the brighter color reads as
lit rather than flat. Still one fixed value across both themes.

---

**68. Lock icon changed from open to closed padlock; color changed from gold to neon green.**

Requested directly. Icon: the shackle now closes fully into the body (`M8 11V7a4 4 0 0 1 8 0v4`,
both ends anchored to the body's top edge) rather than leaving one side open — a closed-lock glyph
reads more clearly as "tap to lock" than an already-open one did. Color: `--gold` replaced outright
with a new `--neon-green` (`#39ff14`), same "fixed across both themes" treatment as `--danger`/the
variable it replaces — every reference (icon color, both glow `drop-shadow` layers, code comments)
updated together rather than leaving a stale `--gold` variable unused. Confirmed no other file still
referenced `--gold` before finishing.

---

**69. Label autocomplete (Phase 8) wired using the exact hint pattern `promptForTags()` already
established, not a new UI mechanism.** No request pending this session, so picked up the oldest
still-open item off the standing list (ROADMAP Phase 8's "label autocomplete drafted but not wired")
rather than waiting further on the device-pass debt, same pattern as Sessions 16/17/35/40.

`label_history` has tracked `(type, label, use_count)` since Session 1 and `insertEntry()` already
writes to it on every non-vault save — nothing there needed to change. What was missing was any read
path: no function ever queried it back out, and nothing in the UI showed it. Added `listLabelHistory
(db, type, limit=8)` (db.js) — most-used labels for one type, same shape and ordering convention as
`listAllTags()`. Vault entries can't leak into this: `insertEntry()`'s existing `is_private` guard
(Decision 40) already keeps vault labels out of `label_history` entirely, so nothing new was needed
to preserve that boundary here.

Wired via a new `promptForLabel(type, defaultLabel)` (app.js), placed directly alongside
`promptForTags()` and built the same way on purpose: a plain `prompt()` with the type's previously-
used labels appended as a hint string, since a bare `prompt()` can't render real tap-to-select chips
— that's still Phase 4's design pass, not attempted here, and building a one-off richer picker just
for labels while tags stays plain would be an inconsistency, not an improvement. Typing anything not
in the hint still works; `label_history` is a memory aid, not a closed list.

Only wired to voice capture's label prompt (both the main and vault capture bars — the two existing
call sites) — the one place in the app today where a label is actually free-typed by hand. Note
labels come from the text itself (`text.slice(0, 40)`), and file/image/pdf/generic-file labels come
from the picked file's name — neither has a free-text prompt to attach a hint to, so neither was
touched. Also exposed `listLabelHistory` on `window.Arkly`, matching `listAllTags`'s existing
exposure, in case a future capture screen wants to read suggestions before opening a prompt rather
than only inside one.

Batch add with auto-numbering (`batchAddWithCommonLabel()`) is a separate, larger piece — it needs an
actual multi-select Image/PDF/Generic-File capture screen (offering "Add individually" vs. "Batch add
with common label") that doesn't exist yet, unlike label autocomplete which only needed a read
function and two call-site swaps. Left for a future session, not folded in here.

---

**70. Lock icon's neon green is now theme-aware; its glow is dark-mode-only.** Reported directly from
a real device (first device feedback since Session 25): `#39ff14` "looks nice in dark mode" but
"bleeds too much" in light mode, with "no clear icon" — confirming Decision 68's assumption that
`--neon-green` needed no dark-mode variant, the same "fixed across both themes" treatment as
`--danger`, was wrong for this hue specifically. Red against either background stays legible; a fully
saturated `#39ff14` glow against near-white (`--bg: #f6f4ff`, `--card-bg: #ffffff`) has almost no
contrast at the glow's edges, so the two `drop-shadow` layers smear into the icon instead of framing
it.

Fix has two parts, kept separate since they're two different causes: (1) `--neon-green` is now
theme-aware — `:root` (light) gets a solid `#15803d`, `:root[data-theme="dark"]` keeps the original
`#39ff14`. (2) the glow `filter` moved off the base `#lock-toggle-btn` rule into a `:root[data-theme="dark"] #lock-toggle-btn` override, so light mode
gets a plain icon with no glow at all instead of a softened one — testing showed the glow itself was
the bleed, not just its intensity, so softening it in light mode wouldn't have been enough. Moving the glow into a theme-scoped selector
raised its specificity above the existing `#lock-toggle-btn.disabled` rule, which would otherwise
have been silently overridden (dark-mode disabled button would keep glowing) — added a matching
`:root[data-theme="dark"] #lock-toggle-btn.disabled` rule so the disabled state still wins in both
themes. Caught by rechecking specificity before finishing, not by re-testing the disabled state on
device (still unconfirmed there, same standing gap as everything since Session 25).

---

**71. Auto-release on every push to main, plus an on-by-default daily in-app update check.**
Requested directly, with two explicit choices confirmed before writing anything, since this is the
app's first real network call now that ads (Phase 12) remain unwired: check on by default (same
cadence pattern as the ad gate — once a day, silent, never blocks) rather than opt-in; release a new
GitHub Release on every push to `main` rather than only on a manually pushed version tag.

CI side (`build-android.yml`): a `Create GitHub Release` step runs after the existing artifact
upload, using `gh release create` (preinstalled on GitHub-hosted runners, no new Action/dependency)
against the built-in `secrets.GITHUB_TOKEN` — no new secret to configure. Needed `permissions:
contents: write` added at the workflow level; the default token is otherwise read-only. Tag is
`v<versionName>`, where `versionName` is exactly what `scripts/patch-version.js` already stamps onto
the APK itself (`<package.json version>+<CI run number>`) — reused rather than recomputed a second
time, so the release tag and the installed app's own version string can never drift apart. Since the
run-number suffix is strictly increasing (that script's own reasoning, unchanged here), every push
gets a guaranteed-unique tag — no collision handling needed. `patch-version.js` now also writes
`APP_VERSION_NAME` to `$GITHUB_ENV` so the release step can read the same value without
re-parsing `package.json` itself.

Client side (`update-check.js`, new module): mirrors `gdrive.js`'s `checkAndRunAutoBackupIfDue` in
shape — operates directly on `db`, not app.js's `metaGet`/`metaSet` helpers, since app.js imports this
module and the reverse would be circular. Reads `GET https://api.github.com/repos/g-c-3/starfish/
releases/latest` (public endpoint, no auth, no personal data sent beyond standard request headers),
gated the same way `ads.js`'s gate is: a `meta` row for on/off, a `last_update_check_date` row for
the once-a-day cadence, `navigator.onLine` checked first, a 5s timeout race, silent on any failure.
Version comparison extracts the `+<run number>` suffix from both the installed app's version
(`@capacitor/app`'s `App.getInfo().version`) and the release's tag name, and compares the two
integers directly — exact, and avoids semver parsing entirely, the same reasoning `patch-version.js`
already used for why versionCode is the run number and not a hand-set value.

On a match, a dismissible banner (`update-available-banner`, same `modal-overlay` shape as the
existing auto-backup-due banner) names the new version and offers "View release", which opens the
GitHub Release page via `@capacitor/browser` (new dependency — no native permissions beyond what
Capacitor's own Custom Tabs launch already needs). No auto-install: a sideloaded APK cannot update
itself without going through Android's install flow by hand, same as every build up to this one, so
the banner's only real action is pointing at where to get the new one. A Settings toggle
(`update-check-toggle`, "Updates" `<details>`, next to Appearance) lets the check be turned off
entirely — `update_check_enabled` reads/writes through the existing `meta` table, matching
`auto_backup_enabled`'s existing pattern, and was added to `APP_SETTINGS_KEYS` in `backup.js` so the
setting survives a backup/restore round-trip the same way `dark_mode` already does.
`last_update_check_date` deliberately was not added to that list — it's cadence bookkeeping, not a
user-facing setting, same distinction `gdrive.js` already draws by keeping `last_drive_backup_at` on
the `credentials` table rather than exporting it.

Not run through CI or confirmed on a device — flagged explicitly, same standing gap as everything
since Session 25.

---

**72. Update check changed from an on-by-default daily background check to a manual "Check for
updates" Settings button.** Requested directly, one change: replace Decision 71's cadence entirely
rather than add the button alongside it. `update-check.js` lost its `db` parameter, its `meta`-backed
on/off flag, and its `last_update_check_date` gate — none of that machinery has a reason to exist once
a check only ever runs from an explicit tap; keeping it would have meant a setting that no longer does
anything a person would notice, and a "last checked" date nobody could query. `checkForUpdateIfDue`
became `checkForUpdate`, same version-comparison logic (the `+<run number>` suffix, exact integer
compare, no semver), returning a plain `{status, ...}` result instead of an `available` boolean so the
caller can also show "up to date" — that state didn't need distinguishing before, when a non-match
just meant staying silent; now every tap needs a visible outcome, including the version number, or a
button with no feedback reads as broken.

`onUnlocked()`'s call to the old `checkUpdateOnOpen()` is gone, along with that function. Its Settings
UI changed from a toggle to a button + inline status line + a conditionally-shown "View release"
button, in the same `<details id="update-check-settings">` card; the global `update-available-banner`
modal is gone too, since results now render inline right next to the button that triggered them rather
than as a separate overlay. `backup.js`'s `APP_SETTINGS_KEYS` addition from Decision 71
(`update_check_enabled`) is reverted — nothing writes that key anymore.

Net effect: with ads (Phase 12) still unwired, the app now makes zero network calls unless this
button is tapped — a stronger "fully offline by default" position than Decision 71's daily check,
not a weaker one. `@capacitor/browser` stays a dependency; "View release" still needs it.

---

**73. File-chooser picker no longer triggers the immediate-lock-on-backgrounding behavior from
Decision 45.** Reported directly: adding a file (Image/PDF/Generic File, both main and vault capture)
opens the system file picker, which — same as switching to another app — pauses our Activity;
`registerBackgroundLock()`'s `appStateChange` listener can't tell those two cases apart on its own,
so it locked the vault and/or showed the app lock screen the instant the picker appeared, even though
the person never actually left the app.

Fix is a one-shot flag, `expectingPickerReturn`, set by a new `beginPickerLaunch()` immediately before
either of the two `input.click()` calls (main capture, vault capture — the only two system-picker
launch points in the codebase, confirmed by grep before writing anything). `registerBackgroundLock()`
checks it first: if true, consumes it (resets to `false`) and returns without locking anything, for
that one pause event only — a later, unrelated backgrounding still locks normally, since the flag is
already spent. Bounded by a 3-second timeout that also resets the flag, in case the expected pause
never arrives (some OEM file choosers don't actually leave the Activity) — without that bound, a
picker launch that doesn't trigger a pause would leave the flag armed indefinitely and silently skip
the next real backgrounding too, which would be a security regression, not just a missed edge case.

Deliberately narrow: only the file-chooser path was touched. Sharing a vault entry out and the Google
Drive OAuth flow also pause the Activity the same way, and still lock immediately, unchanged — both
are cases where data or a credential is genuinely leaving the app's boundary, unlike picking a file
to bring something in, so the same exception was not extended to them without being asked.

---

**74. Idle timeout, lock-on-background, and lock-on-screen-off split into three independent on/off
switches, for both the app-open lock and the Vault lock (six toggles total).** Requested directly.
Previously "idle timer" and "lock on background" (Decision 45/73) were a package deal with no way to
turn either off on its own, and there was no way to lock specifically when the phone's own screen
turns off, as distinct from switching to another app.

Six new `credentials` columns (`ensureColumn`, same migration pattern as `biometric_*_enabled` —
Decision 50): `app_lock_idle_enabled`, `app_lock_background_enabled`, `app_lock_screenoff_enabled`,
and the same three `vault_lock_*`. Idle and background default to `1` — matches the prior, always-on
behavior exactly, so no existing install's behavior changes just from installing this update.
Screen-off defaults to `0`, for a different reason: it's genuinely new capability nothing before this
could have relied on, and it needs new native code (below) that can't be verified without a real
device — defaulting it on would mean shipping an unconfirmed security behavior as if it were settled.

`armAppAutoLock()`/`armVaultAutoLock()` now check their own `*_idle_enabled` column before arming (both
already clear any existing timer unconditionally at the top, so toggling idle off mid-session correctly
cancels a timer already ticking, not just future ones). `registerBackgroundLock()`'s single inline
lock-or-don't block became a shared `handleLockTrigger(trigger)` — `trigger` is `'background'` or
`'screenoff'`, matching the column-name suffixes exactly (not user input, so building the column name
with a template literal is safe) — called from both the existing `appStateChange` listener and a new
one below it.

**Screen-off needed real native code, not just another JS check.** Android pauses the Activity
identically whether the screen turned off or the person switched to another app — `appStateChange`
can't tell them apart, full stop. `Intent.ACTION_SCREEN_OFF` is a separate, system-wide broadcast that
only fires on an actual screen-off, but it's one of the broadcasts Android has never allowed to be
declared in the manifest — only a receiver registered in code can catch it. Went with a `MainActivity`
`BroadcastReceiver` dispatching a plain `arkly-screen-off` DOM event into the WebView via
`evaluateJavascript()`, rather than a full Capacitor plugin — a real plugin needs its own Gradle
module, manifest entry, and `cap sync` discovery, a lot of untestable-here moving parts for one narrow
signal. `src/js/app.js` listens with an ordinary `window.addEventListener()`, no Capacitor plugin API
on the JS side either.

New `scripts/patch-screenlock.js`, same idempotent-CI-script pattern as `patch-manifest.js`/
`patch-mainactivity.js` (`android/` is never committed — see Decision 49). Handles `MainActivity.java`
in either shape `patch-mainactivity.js`'s own currently-disabled (Decision 63) step might leave it in
— stock empty class, or one with an existing `onCreate()` — and runs every build regardless of that
other script's on/off state. No `RECEIVER_EXPORTED`/`RECEIVER_NOT_EXPORTED` flag on the
`registerReceiver()` call: Android 13+ requires one for a context-registered receiver only when the
filter isn't restricted to protected system broadcasts, and `ACTION_SCREEN_OFF` — only the OS can ever
send it — is exempt. Verified the script itself against both `MainActivity.java` shapes in a scratch
copy, including that a second run is a correct no-op; not verified by an actual Gradle/device build,
since neither is possible in this environment.

Two lock triggers overlap at the OS level, and this is expected, not a bug: turning the screen off
also pauses the Activity, so with "Lock when backgrounded" on, screen-off already locks via that path
regardless of the screen-off toggle's own state. The screen-off toggle is additive — it matters
specifically when background is off but the phone's own screen lock/timeout should still lock the
app. Documented in both Settings descriptions and android-notes §14 so this isn't mistaken for a bug
report later, same concern patch-mainactivity.js's own comment raised about FLAG_SECURE and
screenshots.

---

**75. "Check for updates" downloads the APK directly instead of opening the release page.**
Reported from a device screenshot: the update-available case (correctly detecting `0.1.0+175` →
`0.1.0+176`) was working, but "View release" only ever led to the GitHub release page, one extra tap
away from the actual file. `checkForUpdate()` now also returns `downloadUrl` — the release's `.apk`
asset's `browser_download_url`, found via `release.assets`, not guessed — since `build-android.yml`'s
release step attaches exactly one file, the signed APK, this is a direct lookup. Falls back to the
release page itself only if no `.apk` asset is found, which would mean that CI step had changed shape
without this being updated to match.

Button renamed `update-view-release-btn` → `update-download-btn` ("Download update") to match what
it now does — `Browser.open()` on the asset URL directly hands the file to the OS's own download
manager instead of rendering a page, the same behavior a direct link to any non-browser-renderable
file type gets. Still one manual step short of an actual install: a sideloaded APK can't install
itself regardless of how the file arrived, so tapping the downloaded file in the notification shade
or Downloads app is still required, same as always.

The "up to date" case was already correct — it already named the version (`0.1.0+176`, matching
Decision 72's own design) — reworded slightly for clarity ("You're up to date — …" instead of "Up to
date — …") but not changed in substance; flagging this so it's clear that half of the report was
already working as designed, not a second bug.

---

**76. Fixed cramped spacing between adjacent switch-row toggles in App lock/Vault Settings.** Reported
from device screenshots: Decision 74's six lock-trigger toggles rendered touching each other with no
visible gap, and their description paragraphs read ambiguously as belonging to either the toggle
above or below. Root cause: `.switch-row` itself sets no vertical margin, and its wrapping `<label>`
has no default browser margin to fall back on — nothing was ever providing the gap, not a value being
suppressed. A pre-existing rule (`#settings-tab details > *:not(summary), #vault-settings-card > *
:not(summary) { margin-top: 0; }`, meant to keep the very first element under a `<summary>` flush
against it) wasn't the cause here, but does mean a plain `.switch-row { margin-top }` fix would need
matching specificity (ID + type + class) to actually take effect, not just get re-zeroed by it.

Added `#settings-tab details > .switch-row, #vault-settings-card > .switch-row { margin-top: 14px; }`,
with a smaller 10px variant for a switch-row that's the first element right after `<summary>` (flush
against the summary line read just as cramped as flush against another toggle did). Left
`.mode-description`'s own spacing untouched (`margin: 0 0 10px 24px` — no top margin, hugs the element
above it, indented like an explanation) since the fix's job was to add the *missing* gap after each
toggle, not to rebalance a rule that was already correct.

Deliberately fixed at the shared `.switch-row` level, not scoped to only the six new lock toggles —
the same "no gap between adjacent toggles" problem was latent everywhere in Settings (auto-backup,
biometric toggles, the safety-backup confirmation), just not visible until Decision 74 put three
toggles in a row for the first time. Every Settings/Vault section with switch-rows should read
slightly more breathable now, not just App lock/Vault — worth a broader visual re-check next time
Settings is open on device, not only the two sections that were screenshotted.

---

**77. Update download switched from `@capacitor/browser`'s `Browser.open()` to
`window.location.assign()`; `@capacitor/browser` dropped as a dependency.** Reported directly:
Decision 75's "Download update" button got stuck mid-download instead of ever completing. Root cause:
`Browser.open()` opens a Chrome Custom Tab — an in-app overlay meant for viewing web content without
leaving the app, not for driving an actual file download of any real size. A `.apk` response isn't
something Capacitor's WebView can render itself, so the fix is to let the WebView hand the URL off
entirely to the device's own default-browser app via `window.location.assign(url)` — that gets the
real system `DownloadManager`, not a Custom Tab's, which is what actually completes the download and
surfaces the normal "Download complete" notification.

Confirmed by inspecting a separate, working sideloaded-Android project's own update-check
implementation (unrelated app, shared for comparison) — its own code comment states the same
mechanism explicitly: "Capacitor's WebView hands non-app URLs to the system browser, which downloads
the APK." That project uses `window.location.assign()` for exactly this reason and doesn't depend on
`@capacitor/browser` at all.

`@capacitor/browser` had exactly one call site in this codebase (this button) — removed the import and
the dependency from `package.json` rather than leaving an unused native plugin installed. The click
handler no longer needs to be `async` either, since `window.location.assign()` doesn't return a
promise worth awaiting.

---

**78. Reminder capture card built (main capture bar only); Vault Reminder stays a placeholder.**
Capture uses a modal (`#reminder-modal`: label, `datetime-local`, repeat select), not `prompt()` — a
date/time needs a real picker, and free-typed dates parse inconsistently by locale. `promptForReminder()`
(app.js) resolves `{label, fire_at, repeat_rule}` or `null`; label required, one-time reminders must be in
the future, repeating ones aren't checked. Save path: `insertEntry()` → `applyTags()` →
`scheduleReminder()`. A scheduling failure is reported, the row stays saved — same order as the
auto-detected path in `captureText()`. Same `type: 'reminder'` and columns as auto-detected reminders
(Decision 57); the two are indistinguishable once created. Vault Reminder not built: the notification
body carries the label in plaintext outside the vault's encryption boundary. Whether vault reminders
should exist at all is open. Location and Money unchanged.

---

**79. Location capture card built (main capture bar only), with an optional Share step on save.**
Tap: `@capacitor/geolocation` (already a dependency, previously unused) `requestPermissions()` →
`getCurrentPosition({enableHighAccuracy, timeout: 15s})` → label prompt (history-aware, type
`location`) → tags → `insertEntry()` with `latitude`/`longitude` (existing columns; backup already
carries them) → "Share it now?" confirm. Share is opt-in per save, never automatic. `shareEntry()`
(fileactions.js) gained a location branch, so the per-entry Share action and bulk Share send the
label plus a map link built from the stored coordinates (`https://www.google.com/maps?q=<lat>,<lng>`).
Building the link makes no network call; the recipient's device resolves it. Coordinates leave the
device only through that explicit Share. Permission failure, GPS timeout, or no fix: alert, nothing
saved. `ACCESS_COARSE_LOCATION` added to `scripts/patch-manifest.js` (and native-setup §3): the
plugin's own manifest is empty and Android 12+ needs COARSE declared alongside FINE. Vault Location,
Money unchanged (placeholders). Map view of saved locations (ARCHITECTURE §7) still not built.

---

**80. Update check scans the release list for the highest run number instead of calling
`/releases/latest`.** Reported from a device: builds up to 198 existed, the check offered 196. Cause
(likely, not proven — the API rate-limited further inspection): `/releases/latest` ranks releases by
the tagged commit's date, not by tag or run number, and responses are publicly cached for 60 seconds,
so builds pushed minutes apart can report an older one. Fix: `GET /releases?per_page=15`, drop drafts,
prereleases and tags without a `+<run number>` suffix, take the highest run number. Request carries a
timestamp query param and `cache: 'no-store'`. Same single manual-tap network call (Decision 72). An
empty or unusable list reports `unparseable_version`. Tested against a mocked list with out-of-order
and draft entries. Limit: only the 15 newest releases are inspected — more than 15 builds between
checks still resolves correctly, since the highest of those 15 is newer than any build installed from
before them.

---

**81. Home cards are folders; each has its own New button; Home also has a universal New.**
Tapping a card opens that type's list (`#folder-view`) with a "＋ New" button that runs the same
capture flow the card used to run directly (extracted from the card click handler into
`startCapture(type)`, body unchanged). Each card shows a count badge (`renderFolderCounts()`, one
grouped query). A "＋ New" button above the cards opens `#new-chooser-modal`, a grid of the same eight
types, then calls `startCapture()`. Rules:
- Home no longer lists all entries mixed. `#timeline` now holds search results only; an empty search
  box clears it. Entries are reached through their folder, search, or Select files.
- Money's folder also lists `expense` entries. They are the only money-related records until Money
  capture is defined, and with the mixed list gone they would otherwise have no folder. Types stay
  separate (Decision 55); only the listing is shared.
- Vault entries are excluded from counts and folder lists (`is_private=0`), same boundary as the digest.
- Back: the universal Back button closes an open folder first (Decision 65 allows no dedicated back
  element); the bottom-nav Home button also closes it.
- Folder list uses the existing row render (Share, Download, Download for append, Edit, Delete),
  limit 200 per folder.
Vault capture bar unchanged: still direct-capture cards, no folders. Whether the Vault should mirror
this is open.

---

**82. Back is hierarchical and stops at the landing page; it no longer toggles between Home and Vault.**
Reported from a recording: repeated Back presses bounced Home -> Vault -> Home. Replaces the two-slot
`currentLocation`/`lastLocation` toggle from Decision 65 (`lastLocation` removed). `backAction()`
(app.js) names what Back does now, one level up inside the current section only:
- Home: Settings -> Home landing; open folder (Decision 81) -> Home landing; landing -> nothing.
- Vault: open Vault Settings card -> Vault landing; landing or locked gate -> nothing.
Back never crosses between Home and Vault; the bottom-nav Home/Vault buttons do that. At a landing page
the button is dimmed and inert (`.disabled`, `updateBackButtonState()`), so a press that does nothing
doesn't read as broken. Vault Trash and Select files are not Back levels: Trash is nested inside the
settings card that Back collapses, and Select files has its own close. All other Decision 65 behavior
(button position, glow, no dedicated back elements) unchanged.

---

**83. Download for append removed.** The per-entry encrypted export and everything built on it are gone:
- Per-entry "Download for append" button on Home folders and the Vault list; the bulk button in Select
  files; the "Append files from download" import screen in Settings.
- `downloadForAppend()`, `importAppendZips()`, the `download_append` bulk action, the app-level default
  export key (`APP_DEFAULT_PASSPHRASE`), the per-file archive `mode` field, the `entryIds` filter on
  `buildBackupPayload()`, and the `append_` filename prefix (only `backup_` remains).
- `@zip.js/zip.js` dependency, used nowhere else; the built bundle dropped from about 271 kB to 107 kB.
Per-entry actions are now Share, Download, Edit, Delete. Nothing replaces it; moving data between devices
is Backup & Restore (including Private Vault) or the optional Drive backup.
Unchanged: Backup & Restore's Append mode, UUID dedup, the `(Restored)` suffix and the cross-PIN Vault
append path (Decisions 7, 35). They serve full-backup restore, not this feature.
Supersedes: Decision 9 (five actions, per-file zip), 33 (zip library), 34 (per-file pipeline), 43 (action
order), the vault-PIN export clause of 41, the per-entry append item in 44, and the `append` prefix in
55. Those entries stay as history. Any `append_*.dz` file exported earlier can no longer be imported.

---

**84. Batch add on the main capture bar.** Image, PDF and Files pickers accept multiple files. One file: unchanged. Two or more: confirm dialog, OK = batch, Cancel = individual.
- Batch: one common label (history-aware hint), tags asked once, each file saved as its own entry labelled `<base> <n>`. `n` continues from the base label's `use_count` in `label_history`, which holds one counter row per (type, base label). No batch grouping is stored (Decision 11).
- Individual: each entry labelled by its file name, shared tags.
- Numbered labels written by `insertEntry()` are deleted from `label_history` after the batch unless they already existed, so autocomplete lists base labels only.
- Voice stays one at a time. Vault unchanged: single-file picker, no batch. Whether the Vault should mirror this is open.
- OCR-based label pre-fill (`suggestLabel()`) not applied: no OCR text exists yet (Phase 5).
Supersedes the unwired draft of `batchAddWithCommonLabel()` described in Decision 69.

---

**85. Vault mirrors Home.** Resolves the open question in Decision 81.
- Cards: same eight-card grid (`#vault-capture-bar`, now the shared `.capture-cards` layout instead of a wrapping row), each with a count badge. A card opens that type's folder (`#vault-folder-view`) with a New button running the Vault capture for that type.
- Universal New (`#vault-universal-new-btn`) opens the shared `#new-chooser-modal`; a target flag routes the choice to Home or Vault capture.
- The list under the search box (`#vault-list`) is search results only; empty search clears it. Entries are reached through folders, search, or Select files.
- Counts, folder lists and search read the in-memory index (Decision 39) and render only while unlocked. Money's folder lists Money entries only; Vault has no Expense type.
- The type tabs (`#vault-tabs`) and their CSS are removed; folders replace them. Folder rows keep the four actions.
- Vault Settings card moved to the position of Home's settings tile.
- Back (Decision 82): open Vault folder closes first, then an open Vault Settings card. The nav Vault button and every lock reset the Vault to the card grid.
- Not changed: Vault Reminder, Location, Money remain placeholders; Vault capture of files stays single-file (no batch, Decision 84).



---

**86. Visual system.** Supersedes the visual identity notes of Decisions 52, 53, 55 and 57; behavior in those decisions is unchanged.
- Layered surfaces (bg, surface, surface-2) with a hairline border and one soft shadow. Dark and light themes both complete; every color is a token.
- Type color is context, not fill: `data-type` / `data-vault-type` set `--tc-rgb` and `--tc-ink` (darker ink in light theme for contrast). It appears only on icon chips, count badges and digest chips. `expense` shares Money's color.
- Font: Inter variable, latin subset, bundled in `src/fonts/` (OFL license kept alongside). No network fetch; system fonts are the fallback for other scripts.
- Icons: inline SVG sprite at the top of `index.html`, referenced as `<use href="#i-name">`, stroke-based, `currentColor`. No emoji as icons.
- Folder tiles: two columns, icon chip + label; count is a badge on the chip corner so labels never truncate.
- Entry rows: one template (`entryRowHtml`) for Home folders, Vault folders and search results. Actions are icon-only buttons keeping the existing `main-*` / `vault-*` classes. An overflow menu is deferred to the in-app sheets of step 3.
- Bottom nav: floating, translucent, rounded; Back stays the middle control.
- Rows built by `drive-backup-row` (trash, Drive list, storage) keep that class with the new surface style.
- Rendered strings are escaped (`escapeHtml`) before `innerHTML`.

---

**87. Auth screens and Settings structure.** Extends Decision 86.
- Lock screen, first-run, ad gate: `.auth-screen` (centered column, max 440 px). The `:not(.hidden)` guard keeps the `.hidden` rule effective. Vault PIN setup and locked views are `.form-card`s with a small brand mark.
- Settings groups: Data (Your Data, Storage breakdown, Trash), Security (App lock, Privacy Screen), Preferences (Appearance, Updates), Backup (Backup & Restore, Google Drive). Group labels are plain text, not collapsible. Section tone (`data-tone`: blue, green, violet, amber) only tints the icon chip.
- Switch rows: label left, switch right (`row-reverse` on the existing markup, so no JS or id change).
- First-run copy shortened; the two credentials remain separate cards (app-open password, Vault PIN), never merged.

---

**88. Biometric button and update download state.**
- Unlock buttons are labelled "Use Biometric" (fingerprint icon). They carry `.biometric-btn`: a slow breathing glow, no motion under reduced-motion preference.
- `.hidden` is `display: none !important`. Component classes that set `display` must not be able to un-hide an element the app hides.
- Download update: always rendered, `disabled` until a check returns an available update. A new check disables it first.

---

**89. Background art.** Extends Decision 86.
- Two drawings, both `<symbol>`s in the `index.html` sprite: `art-cubes` (unlock, first-run, ad gate, locked Vault) and `art-squares` (inside `#home-main` and `#vault-main`, so folder views and Settings stay plain).
- Theme handling: strokes and fills use `--art-t/-b/-v/-p/-a` tokens (inline `style="…var()"`), plus `--art-opacity` per theme. No second asset per theme.
- Layer rules: `.bg-art` is absolute, `z-index: -1` inside `.screen`'s stacking context, `pointer-events: none`, masked to fade. Cubes cover the screen; squares cover the top 300 px.
- The locked-Vault cubes are a sibling after `#vault-content` and hidden by `#vault-content:not(.hidden) ~ .bg-cubes`, so no JS tracks the state.
- Art is original and generated, not taken from stock images.

---

**90. Open & edit requirements.**
- Every entry opens on tap into a viewer for its type; Share, Download, Edit, Delete stay.
- Text: opens as a text editor. Voice: opens as a recorder (new) and a player (saved). Image: photo viewer with thumbnails. PDF: PDF viewer. Reminder: opens; greyed out once completed. Location: viewable as coordinates or better. Files: open with the phone's matching app.
- An entry has at most two tags. Previously used tags appear as tappable, selectable chips.
- Save is one dialog: file name at the top, tags below it, description below that. Pressing Save without filling anything stores a default file name, no tags, no description.
- Existing entries with more than two tags are left as they are until edited.
- Money capture shape: to be specified by the owner.

---

**91. Save dialog, tags and description.** Implements Decision 90's save rules.
- One bottom sheet, `openSaveDialog()`: name, tags, description, Save. Resolves null on cancel. Capture uses Discard and ignores outside taps; edits use Cancel.
- Names: default is what each type used before. A picked file keeps its phone name (Image, PDF, Files). Several picked files: `mode` is `own` (each keeps its name) or `number` (one name, numbered under Decision 84's counter).
- Tags: max two (`MAX_TAGS`), enforced in the dialog, `applyTags` and `saveVaultEntry`. Chips are `listTagsForScope`: tags used by live entries of the same privacy scope, most used first. Editing an entry with more than two tags keeps the first two. `setEntryTags` replaces an entry's tags.
- Description: `description TEXT` for ordinary entries, `encrypted_description BLOB` for Vault entries (plaintext column stays NULL). Searchable: appended to the body in the FTS column for ordinary entries; held in the in-memory index for the Vault. Backup carries both; append-mode re-keying also re-encrypts `encrypted_description`.
- Text editor: full-screen `openTextEditor()`; Save returns the text and the caller opens the dialog; the dialog's back-out returns to the editor with the text kept.
- Overlays are closed by `dismissOverlays()` on app lock (all) and Vault lock (Vault only); `overlayAbortCount` stops capture loops after that.
- Rows carry `data-id`; a tap outside `.row-actions` opens the entry. Text notes only until the other viewers exist.
- `toast()` replaces `alert()` for messages in these flows. Reminder time entry and expense edit still use `prompt()` until their own steps.

---

**92. Reminder completion, detail and notification actions.** Implements Decision 90's reminder rules.
- Status (`reminders.js`): `done` (`completed_at` set), `fired` (no repeat, time passed), `upcoming`. Inactive = done or fired, greyed and struck through in lists. Repeating reminders only become inactive via Mark done (which also cancels their notifications).
- `completed_at INTEGER` on `entries`; carried through `editEntry`, backup and restore. Editing a reminder to a new time clears it and reschedules.
- Reopen is offered only when the reminder was marked done; a fired one-off offers Reschedule.
- Notification actions: Done = mark done; Snooze = a one-off notification 10 minutes out under id `hash(entryId + ':snooze')`. The listener needs only the database. A plain tap on a notification is deliberately not handled, so nothing is opened ahead of the lock screen.
- `softDelete` cancels a reminder's notifications; `restoreFromTrash` reschedules a pending one (dynamic imports keep `db.js` free of the notification plugin at load).
- Reminder date/time and repeat are fields of `openSaveDialog({ reminder })`; the standalone reminder pop-up is removed. The dialog compares times to the minute and keeps the stored value when unchanged.
- `openViewer()` is the shared full-screen shell for entry viewers: header with back and edit, scrolling body, closed by lock like the editor.

---

**93. Location detail.** Implements Decision 90's location rule.
- `openLocation()` on the shared `openViewer()` shell. Main entries only.
- Coordinates shown as degrees with hemisphere letters, plus decimal values to six places.
- Plot: inline SVG on a 30° latitude/longitude grid, x = longitude + 180, y = 90 − latitude, pin clamped 6 units inside the frame. No map tiles or coastline data, so nothing is fetched and the single-network-call rule holds.
- Open in Maps: `geo:lat,lng?q=lat,lng(label)` through `window.location.assign`, as in Decision 77. Arkly makes no request; the phone's maps app does whatever it does. Leaving the app triggers the normal background lock.
- Copy: `navigator.clipboard`, no plugin added.
- No stored coordinates: notice only, no actions.

---

**94. Credential fields cleared on lock; lock button routed by screen.**
- `clearSecretInputs()` empties password inputs: all of them when the lock screen shows (`showScreen('lock-screen')`, which every app-lock path uses), the Vault ones (`vault-pin-input`, `vault-setup-pin-input`, `vault-biometric-confirm-pin`) in `lockVault()`, and the relevant field right after a successful unlock.
- Lock button (`#lock-toggle-btn`): Vault screen locks the Vault and returns Home; Home and Settings lock the app. Chosen by `currentLocation`, not by `#vault-content`'s class, which is only reset when the Vault gate is next shown.
- The two locks stay independent (Decision 65): the button locks only what is on screen.

---

**95. Reminder save confirmation shows the time and its distance.**
- One-time reminders: toast reads "Reminder set for <weekday, date, time> · in <duration>" on create and on edit. Repeating reminders keep the plain toast.
- Reason: the date-time picker is 12-hour; a wrong AM/PM saves a valid future time and nothing fails visibly.
- No change to scheduling. Exact-alarm delivery is unchanged and still open (see Session 73).

---

**96. Reminders are subtle banners with the default sound.** Replaces the "with a tone" part of Decision 3; the rest of Decision 3 stands.
- Channel `dumpzone_reminders_v2`: importance 4 (heads-up banner), no custom sound. Snooze and Done actions unchanged.
- A channel's importance and sound cannot change after creation, so the style change uses a new id. On first launch after the update the old channel is deleted and every live reminder is scheduled again on the new one (`reminder_channel` = 2 in app meta; retried next launch if it fails). A pending snooze on the old channel is lost.
- Not changed: scheduling stays inexact. A banner does not make delivery earlier; late delivery under battery saving remains open (Session 74).

---

**97. Reminders schedule with `allowWhileIdle`; exact alarms not needed.**
- Cause of reminders appearing only after the app was opened: `schedule` had no `allowWhileIdle`, so `@capacitor/local-notifications` 6.x set `AlarmManager.set(RTC)`, a non-waking alarm. Doze and battery saving hold it until the phone is next awake.
- Fix: `allowWhileIdle: true` on reminder and snooze schedules. The plugin then uses `setAndAllowWhileIdle(RTC_WAKEUP)`, which wakes the phone. A reference app with reminders that fire while closed and under battery saving schedules this way, inexact.
- Consequence: delivery can still be late, up to several minutes under Doze (Android allows idle-mode alarms about once per 9 minutes per app). Accepted for a subtle banner reminder.
- Exact alarms (`USE_EXACT_ALARM`) are dropped as a proposal unless a device test with this fix still shows late delivery. This also keeps the manifest free of a Play-restricted permission.
- Not changed, flagged: repeating reminders pass `every` without `repeats`, and 6.x plugin repeat paths use a non-waking `RTC` alarm. Recurrence needs a device check before it is trusted; a fix would schedule the next occurrences ahead, re-synced on each app open.

**98. Play Store distribution deferred.** Revisit when the app is fully ready; sideload APK stays the only channel until then.
- Open items for that review: signed AAB output, target API 36 (Capacitor upgrade), hardware back handling, removal of the in-app GitHub update check in a Play build, permission and Data Safety declarations, privacy policy link, and Play's restrictions on exact-alarm permissions.

---

**99. Snoozed state; notification buttons open the app.** Extends Decision 92.
- Reported: Snooze on the notification opened the app, and the reminder row went grey like a finished one.
- The app opening is the plugin: `@capacitor/local-notifications` 6.x builds every action button with `PendingIntent.getActivity`, so Snooze and Done always launch the app (to the lock screen if locked). The handler runs from the database and needs no unlock. Avoiding the launch needs a native broadcast receiver; not built.
- The grey row was correct under Decision 92 (a one-off whose time has passed is "fired") but misleading after a snooze. New status `snoozed`: `snoozed_until` (existing column, previously unused) set to now + 10 minutes by the Snooze action.
- A snoozed reminder is active: not greyed, meta reads "Snoozed until <time>", the viewer shows a Snoozed pill and "Mark done". After the snooze time it returns to the plain rule (one-off: fired; repeating: upcoming). Done and a new time both clear `snoozed_until`.
- A Snooze or Done from a notification while the app is open redraws the list through the `arkly-reminders-changed` event.
- The snooze notification itself uses `allowWhileIdle` (Decision 97).

---

**100. Notification buttons send the app back after acting.** Follows Decision 99.
- Device result: Snooze 10 min fires its second notification (Decisions 96 and 97 build). Done also opens the app, same plugin cause as Snooze.
- After a Snooze or Done is handled, the app calls `App.minimizeApp()` when that button launched it, so the person returns to the launcher or previous app instead of staying in Arkly. Backgrounding locks the app as usual.
- Launch detection: the action arrives within 6 seconds of the app last coming to the foreground (`lastResumeAt`, set at load and on every resume). A button tapped from the shade over an app already in use does not minimise.
- Limits: the app still appears briefly, since the launch itself cannot be prevented without a native receiver. The 6-second window is a heuristic; a cold start slower than that leaves the app open.

---

**101. Reminders use exact delivery.** Supersedes the "exact alarms dropped" line in Decision 97; the rest of Decision 97 stands.
- Device result: with `allowWhileIdle` only, a reminder due about a minute after creation reached the shade only once the app was opened (earlier tests on the same build fired on time). `allowWhileIdle` alarms are still inexact, so Doze and battery saving may hold them. The reference app's reminders land at random times inside multi-hour windows, so they show that delivery happens, not that it is on time.
- `USE_EXACT_ALARM` and `SCHEDULE_EXACT_ALARM` added to `REQUIRED_PERMISSIONS` in `scripts/patch-manifest.js`. In `@capacitor/local-notifications` 6.x, `setExactIfPossible` then uses `setExactAndAllowWhileIdle(RTC_WAKEUP)`; with neither permission it silently falls back to the inexact call. Banner channel, default sound and Snooze/Done are unchanged: no alarm screen, no alarm sound.
- Android 13+ grants `USE_EXACT_ALARM` at install, with no prompt. Android 12 grants `SCHEDULE_EXACT_ALARM` by default. On Android 14+ the second permission alone is denied by default, so the first is the one that matters there.
- Cost: Google Play restricts both permissions to alarm and calendar apps (Decision 98 open item). Sideload is unaffected.
- Not fixed by this: phone-maker background limits that stop an app's alarms (battery "restricted" mode, autostart off, a swipe-away treated as force-stop). The battery-optimisation prompt stays an open item.

---

**102. Snooze and Done run in a native receiver, not the Activity.** Supersedes the launch behaviour in Decisions 99 and 100; the snoozed state (Decision 99) is unchanged.
- Cause of the app appearing: `@capacitor/local-notifications` 6.x builds each action button with `PendingIntent.getActivity`.
- `scripts/patch-reminder-actions.js` (CI, after `npm install` and `cap add android`, before Gradle) patches the plugin source so the `snooze` and `done` buttons send a broadcast to `ReminderActionReceiver`, written next to `MainActivity.java` and registered not exported. Other action ids keep the stock intent. The script aborts if the plugin's code shape differs.
- Receiver, no app launch: dismisses the notification. Done cancels the reminder's and the snooze's alarms and stored copies (same ids as `cancelReminder`). Snooze copies the notification JSON under the snooze id, schedules it 10 minutes out with `allowWhileIdle`, and leaves a repeating schedule alone. Ids use the same hash as `hashIdToInt`.
- The database is not opened natively. The receiver queues `{a, e, t}` under `dz_ra:*` keys in the Capacitor Preferences store (entry id, action, time; no content). `drainQueuedReminderActions()` in `app.js` applies them in tap order: Done sets `completed_at`, Snooze sets `snoozed_until` to tap time + 10 minutes. It runs at startup before the lock screen, on resume, and every 4 seconds while visible (a shade tap over the open app fires no resume event). Keys are removed only after the writes, so a failure retries with the same result.
- Credentials: unchanged. The queue holds no entry content and no credential; nothing here needs an unlock.
- Notifications scheduled before this build keep the old buttons. One reschedule of live reminders runs once (`reminder_actions` in `meta`); the old JS listener and the minimise rule (Decision 100) stay as the fallback for any that remain.
- Limits: the row changes when the app next drains the queue, not at the tap. Not run through CI or on a device. Plugin updates may change the patched block.

---

**103. Voice recorder screen and player.** Implements Decision 90's voice rule.
- Both run on the shared viewer shell. The shell gains `onClose` (runs on every close, including a lock's forced close), `guard` (may refuse Back) and hides Edit when a viewer has none.
- Recorder: ready, recording (timer from the clock), review. Review plays the take with the player; Save hands it to the existing Save dialog, Record again and Discard drop it. Microphone permission is asked before the screen opens, because the system prompt pauses the app and a lock would read that as backgrounding.
- Back during recording or review needs a second tap within 3 seconds. A lock discards the take, the same as unsaved editor text; nothing is kept in memory or on disk.
- Player: one `<audio>` element on an in-memory blob URL. Play/pause, scrub, speed cycling 1, 1.25, 1.5, 2, 0.75. Containers with no length use the recorder's duration, or a far seek to find it. Playback keeps the idle lock armed (app or Vault) while playing.
- Saved voice opens from Home folders and the Vault list. Vault audio is decrypted on open into a blob URL held only while the viewer is open, then revoked; closing or locking stops playback. Home audio is read from `Directory.Data`.
- No new plugin, permission or network use. Credentials unchanged.
- Limits: a recording is held in memory as base64 until saved or discarded. Not run on a device; `<audio>` support for each recorder container (aac, webm) is unconfirmed.

---

**104. Back is visible on every screen and dismisses whatever is open.** Extends Decisions 65 and 82.
- Cause of the gap: the editor, viewer, Save dialog and modals are full-screen layers above the bottom nav, and the nav was hidden on the lock, first-run and ad-gate screens.
- The nav is never hidden after start. On the lock, first-run and ad-gate screens it shows Back alone (`back-only`). While any overlay is open (`body.overlay-open`, set by a class observer, so every open and close path including a lock's forced close is covered) it shows Back alone, centred above the overlay; each overlay pads its own controls clear of it.
- Back order: Save dialog, then the static modals (overwrite confirm, new-entry chooser, scheduled-backup prompt, Select files, each through its own cancel or close button), then editor, then viewer (through the viewer's guard), then the Decision 82 hierarchy.
- Dimmed where there is nothing to go back to: Home and Vault landing (unchanged), the lock screen, first-run, a locked Vault gate. Back never unlocks or skips anything.
- Back while the scheduled-backup prompt is open acts as "Skip this time".
- Limits: the lock and power buttons are still covered by overlays. Not run on a device.

---

**105. Image grid and viewer.** Implements Decision 90's image rule.
- The Image folder, Home and Vault, shows a 3-column grid of square thumbnails instead of rows. Tiles load as they scroll into view, two decodes at a time; a tile keeps an icon placeholder until its thumbnail is ready or if it fails.
- Thumbnail: longest side 320 px, JPEG. Home thumbnails are also cached as files in the app's cache directory (`thumbs/<id>.jpg`); the OS may clear them and they are rebuilt. Vault thumbnails are never written to disk: they live in an in-memory map that `lockVault()` empties, and a decode that finishes after a lock is discarded.
- Viewer, on the shared shell: the folder's images in grid order. Swipe (a horizontal drag of over 20% of the width at scale 1) or the arrows move between images; pinch zooms to 6×, drag pans within the image, double-tap toggles 2.5×. Share, Download, Delete (to Trash, as the row buttons did) and header Edit (name, tags, description) replace the old row buttons. A search result for an image opens the same viewer on that one image.
- One full-size image is held at a time as an in-memory blob URL, revoked on every change, on close and on a lock's forced close. Vault images are decrypted on demand for the grid and viewer only. Gestures re-arm the matching idle lock.
- Credentials and the Decision 104 Back behaviour unchanged.
- Limits: a grid of many large photos decodes slowly the first time. The viewer loads full-size images with no downscale. Not run on a device.

---

**106. Home search: stored index, safe word-prefix query, substring pass.**
- Cause of "no results": `entries_fts` was contentless (`content=''`), where every column reads back NULL, so the join on `entries_fts.id` in `searchEntries` matched nothing, and the `UPDATE` / `DELETE ... WHERE id = ?` calls on it matched nothing either. Typed text also went to FTS5 raw, so a dot in "photo.png" was a syntax error and "1001" never matched "1001073062".
- The index now stores its columns. `initDb` drops an existing contentless table once and rebuilds it from `entries` (non-private rows only; label plus body text plus description). Private entries stay out, as before.
- `searchEntries`: each typed word is quoted and matched as a word prefix, ranked (label above body); then a second pass adds substring matches in label, body or description, so Home matches like the Vault does ("1073" finds "1001073062.png"). Private and trashed entries are excluded from both. An unreadable query shows no results instead of failing.

**107. Repeating reminders are scheduled as a window of exact occurrences.**
- Cause: the plugin fires an `at` notification once and ignores `every` beside it, so a repeating reminder fired once and, rescheduled with a past time, never again. Its own cron form re-arms with a non-waking alarm, which Doze delays (Decision 97).
- `scheduleReminder` now schedules the next occurrences as ordinary exact, wake-from-idle one-offs: daily 30, weekly 26, monthly 12, stepping from the original time (daily and weekly keep the local clock time; monthly keeps the day of month, clamped to short months). Occurrence 0 keeps the plain id; occurrence k has id hash(`<entryId>:r<k>`), at most 30 ids per reminder.
- The window is topped up on launch and on resume, at most every 6 hours, and again after any Done. The total across all repeating reminders is held under 400 alarms (Android allows 500 per app).
- Limit: if the app is not opened for longer than the window (30 days for daily), occurrences stop until it is. Not yet confirmed past the first day on a device.

**108. Done on a repeating reminder means this time only.** Supersedes Decision 92 for repeating reminders.
- Done (notification button or in-app) dismisses the notification and clears any snooze. `completed_at` stays empty and the later occurrences stay scheduled. One-off reminders are unchanged: Done completes and cancels.
- The row and the viewer show the next due time for a repeating reminder; the viewer button reads "Done for now". A series ends by editing Repeat to none, or by deleting it.
- Notification extra carries `repeating`, so the native receiver (Decision 102) cancels only the snooze for a repeating reminder. Notifications scheduled before this carry no flag; the top-up after launch or Done restores any series they cut short.

**109. Image viewer layout; Vault pickers take several files.** Refines Decision 105.
- The viewer image fills the screen under a thin header: back, name, Edit (rename), Share, Download, Delete, then the count. The header extras exist only while the image viewer is open. Tags are not shown in the viewer (still editable through Edit).
- The stage is a fixed-size flex box, so tall and wide images fit entirely.
- The Vault's file pickers set `multiple`, like Home (Decision 84): one file keeps its name; several offer keep-each-name or one numbered name (`name 1`, `name 2`). Vault entries keep no label history.
- Bug fixed with it: `toBase64` in `crypto.js` spread the whole buffer into `String.fromCharCode`, which overflowed the call stack from roughly 100 KB, so a photo could not be encrypted into the Vault. It now converts in 32 KB chunks.

---

**110. Restore file picker accepts any file type.**
- Cause: `#restore-file-input` used `accept=".dz,.dzbackup,application/json"`. Android's chooser maps the filter to MIME types; `.dz` has none, so only JSON stayed selectable and a `.dz` backup showed greyed out.
- Fix: `accept="*/*"`. `handleLocalRestore()` already rejects a non-backup file (`JSON.parse`) and a wrong passkey fails decryption, so no new validation is needed.

**111. Restore refreshes the Vault index and the lists.**
- Cause: the Vault list reads an in-memory index built at unlock (Decision 39); restore never rebuilt it, so restored Vault entries stayed hidden until a relock.
- Fix: after a successful restore, `buildVaultIndex` runs if the Vault is unlocked, then a `arkly-data-restored` event redraws Home counts and folder and the Vault lists. A locked Vault needs nothing: unlock builds the index fresh.

**112. Append restore does not treat trashed entries as duplicates.** Refines Decision 7.
- Cause: the exact-UUID and same-label checks read every row, so an entry sitting in Trash made its restored copy skip, or take a "(Restored)" suffix.
- Rule: both checks count live rows only (`deleted_at IS NULL`). A live exact match is skipped as before. If the UUID exists only in Trash, the restored copy takes a fresh UUID (the trashed row still owns the primary key) and keeps its label; the trashed row stays in Trash.
- Consequence: restoring an entry that is also in Trash, then restoring the trashed one, leaves two copies. Accepted.

**113. Location capture shows progress and blocks repeat taps.**
- Cause: a GPS fix takes up to 15 seconds with nothing on screen, so repeated taps looked reasonable.
- Rule: while the fix is pending, a sticky "Fetching location…" message shows, the Home New buttons (`#folder-new-btn`, `#universal-new-btn`) are disabled, and a second Location capture is ignored. Both clear in a `finally` on success, timeout or refused permission. Failures keep their own notice.
- `toast(message, sticky)` gained a sticky mode and `hideToast()`.

**114. Discarding a capture asks Yes/No.**
- Rule: in a Save dialog opened with the Discard label (voice, image, PDF, file, reminder, location), both the Discard button and Back ask "Discard? Yes, discard / No, keep it" before dropping the take. Dialogs labelled Cancel or Back to editing (edits, text notes) leave at once, as before.
- `askYesNo()` and `#yesno-dialog`: one at a time; Back answers No and is checked first in the Back order (Decision 104); a lock closes it as No and the Save dialog closes through the lock path as before.
- Fix after first device check: `#save-dialog` has `z-index: 11` over `.modal-overlay`'s 10, so the sheet opened behind it and Discard and Back seemed to do nothing. `#yesno-dialog` is `z-index: 12`. Back answers No through an `activeYesNo` check ahead of the Save dialog; the `BACK_MODALS` entry was removed as unreachable.

**115. Leaving the text editor or voice recorder with unsaved content asks Yes/No.** Supersedes the tap-twice rule in Decisions 91 and 103.
- Cause of the change: Back showed a toast, then discarded on a second tap within 3 seconds; unclear and easy to trigger by accident.
- Rule: one Back opens the Yes/No sheet (Decision 114). Text editor: shown only when the text changed ("Discard changes?"). Voice recorder: shown while recording or in review ("Discard recording?"); nothing in the ready state. Yes leaves and drops the content, No keeps it.
- Mechanism: `requestBack` (editor) and the recorder's `guard` are async; the viewer shell's `back` awaits `guard()`. A lock closes the sheet as No and force-closes the screen as before.

**116. New in Location offers two sources: current location or pasted coordinates.**
- Rule: New opens a chooser (Save current location / I have coordinates). Current location behaves as before (Decisions 79, 113). Coordinates opens a paste dialog, then the Save dialog; Back to coordinates in the Save dialog returns to the paste dialog with the text kept.
- Accepted input, parsed on the phone with no network (`geoparse.js`, `parseCoordinates`): decimal pair separated by comma, semicolon or space (latitude first); decimal degrees with N/S/E/W; `geo:` URIs; full Google Maps links, reading `!3d…!4d…` (place pin) before `@lat,lng` (view centre) before `q`, `query`, `ll`, `sll`, `center`, `destination`, `daddr`. A `/maps/place/<name>` segment becomes the default entry name.
- Checks: finite numbers, latitude within ±90, longitude within ±180. A swapped pair that falls outside the range is rejected, never guessed. The check shown to the person is the decimal and degree text plus the grid plot (Decision 93); no map data is fetched.
- Not in the paste dialog: Open in Maps. Leaving the app triggers the background lock (Decision 93) and would drop the pasted text. It stays in the saved entry's viewer.
- Not supported: degrees-minutes-seconds.

**117. Verify link: an optional, per-tap network step for short map links.** Extends the network rule in Decision 1 (ARCHITECTURE §1).
- Cause: a short link (`maps.app.goo.gl`, `goo.gl/maps`) holds no coordinates; they exist only in its redirect.
- Rule: the Verify link button appears only when the pasted text is a short link, with a note that it contacts Google once and sends nothing else. Nothing runs until it is tapped. No internet, an unreadable link or a refused redirect shows a plain message and the person can paste the full link or coordinates instead.
- Mechanism: `resolveShortLink` follows redirects one hop at a time (`CapacitorHttp.get` with `disableRedirects`, 8 s timeouts, 5 hops at most) and stops at the first hop that carries coordinates, so the destination page is never fetched. Only https hosts on Google domains are contacted; any other redirect target aborts before a request is made. The result is shown in the same preview and still needs Continue.
- Network calls now: ad SDK (deferred), opt-in Drive backup, Check for updates, Verify link. The last two run only on a tap.

**118. Files open with the phone's matching app.**
- Cause: Files rows had no viewer; tapping showed a "coming later" toast.
- Rule: tapping a Files row opens a detail view (name, type and size, description, tags, saved time) with an Open with app button. The button hands the file to the phone's matching app through `@capacitor-community/file-opener` 6.x (the 7.x and 8.x lines need a newer Capacitor core). Unknown or missing extension offers every app that accepts a file. No matching app, or a missing file, shows a plain message.
- Home files: opened from their stored path; no copy is made.
- Vault files: decrypted into memory, written to `cache/open/<id>.<ext>`, then handed off. The copy is outside the Vault's encryption from that moment, the same boundary as Share and Download. It is removed on app launch, on resume and before the next open, so it never outlives the person's return to Arkly.
- Not removed on viewer close or on lock: leaving the app locks it (Decision 93) and would delete the file while the other app is still reading it.
- Lock behaviour: opening another app is a background event and locks as the person's lock settings say, the same as Open in Maps. No picker exemption is used.
- No new network call, permission or manifest change: the plugin brings its own file provider for app data and cache.
- PDF entries keep the "coming later" toast until Phase 16 H.

**119. The Vault stays: opt-in by setting a PIN, permanent once on.**
- Rule: with no Vault PIN the Vault is off and the Vault tab shows only the PIN setup view. Setting a PIN, at first-run or later, turns it on. There is no feature to turn it off or remove the PIN; a PIN can be changed, not removed.
- First-run keeps the optional Vault PIN field; no new setting or switch is added.
- The three credentials stay independent (ARCHITECTURE §3).

**120. A Files row opens the file directly; rows show the extension.** Refines Decision 118.
- Cause: the detail view added a step between the tap and the file.
- Rule: tapping a Files row (Home folder, Vault folder, either search list) hands the file to the phone's matching app at once. Name, tags and description are changed through the row's Edit action. A second tap while a launch is pending is ignored. Failures show a plain message.
- Row icon: a Files row shows its extension, upper case and at most four characters (PDF, DOCX, XLSX, ZIP), in place of the folder icon. No extension keeps the folder icon. Other types keep their icons. The Vault index carries `extension` so Vault rows match Home.
- Decision 118's detail view is removed; its Vault copy and purge rules are unchanged.

**121. PDF entries open in an in-app viewer on a bundled pdf.js.**
- Cause: PDF rows had no viewer. Handing off to the phone's app was the alternative; the person chose an offline in-app viewer at the cost of a larger APK.
- Library: `pdfjs-dist` 4.10.38, legacy build, pinned exactly (the legacy build runs on older system web views). Its worker is bundled by Vite and started on the first PDF open; the viewer code is loaded then too, so startup is unchanged. APK growth: about 1.7 MB of script before the APK's own compression.
- Viewer: full-screen under a thin header with Edit (rename) and the page count. Pages are placeholders sized from the first page, drawn when within one screen of the view and released beyond it, one draw at a time. Pixel ratio is capped at 2 and by a per-page pixel budget. Zoom steps 1, 1.5, 2 and 3 times the fit-to-width size, by + and − buttons, keeping the centre of the view; wider pages scroll sideways.
- Not included: text layer, selection, search inside a PDF, bundled fonts and character maps (so a PDF that relies on fonts it does not embed may show substitutes), annotations, forms.
- Home PDFs are read from their stored path. Vault PDFs are decrypted into memory only, never written to disk, and dropped on close or lock. Scrolling and zoom count as activity for the matching auto-lock.
- A PDF that cannot be read (password-protected or damaged) shows a plain message and an Open with app button using the Decision 118 path.
- PDFs saved as Files (type `file`, extension pdf) still open in the phone's app (Decision 120); only entries of type PDF use this viewer.
- No network call and no new permission.

**122. Long-press multi-select inside folders and search lists.**
- Cause: bulk actions existed only on the Select files screen; rows inside a folder could not be selected together.
- Rule: a long press (about half a second, finger still) on a row or image tile in a Home folder, a Vault folder, or either search list starts selection mode with that item selected. In selection mode a tap toggles an item instead of opening it, row actions are hidden, and each item shows a ring that fills with a tick when chosen. Deselecting the last item leaves the mode.
- Bar: a bar over the top of the screen shows the count, Select all, Share, Download and Delete, and a cancel button. Select all covers the lists currently visible in that section.
- Scope: one section at a time, Home or Vault, never mixed. Leaving the folder, switching screens, locking, Back, or finishing an action ends the mode. Android Back and the in-app Back leave selection mode before anything else.
- Actions reuse the Select files path: items are processed one after another, so Share opens one share sheet per item (the existing limit). Delete asks Yes/No first and moves items to trash, not permanent. The result is a one-line message.
- Vault: selecting and acting count as activity for the Vault auto-lock; the Vault index is rebuilt after a delete.
- No new plugin, permission or network call.

**123. The Home | Back | Vault bar sits lower so its Back circle matches the floating Back.**
- Cause: the bar was taller and 10 px up, so its Back circle sat about 12 px higher than the floating Back used in folders, viewers and editors.
- Rule: the bar is a fixed 56 px high, 5 px above the bottom edge (plus the system inset), so the circle centre is 33 px up, the same as the floating Back. Home and Vault buttons use tighter vertical padding to fit. Back-only and overlay modes are unchanged.

**124. Money capture design (not yet built). No automatic detection of expenses.**
- Detection: the rule that turned a Home note containing "spent" and a number into an expense is removed from capture. Money entries come only from the Money form. Existing expense rows stay, remain listed in the Money folder, and count as Spent in totals. Reminder text detection is not changed by this decision.
- Entry kinds: Spent, Lent, Received, Borrowed.
- Fields: amount (stored as a whole number of the smallest unit, no decimals drift), kind, category (own list, recent first, nothing guessed), note, tags, date of the event (default now, editable), person (Lent and Borrowed), payment method (own list: cash, UPI, card and so on), due date (Lent and Borrowed, a plain field, no notification).
- Repayments (Lent and Borrowed): a list of partial or full returns, each with amount, date and an optional note. Remaining = amount minus the sum. Status is derived, never typed: open, partly returned, settled. A repayment cannot exceed the remaining amount. Add repayment pre-fills the remaining amount; a full return is one repayment.
- Month header in the Money folder, with previous and next month: Spent, Received, Net (Spent and Received only). Loans stay out of Net. Two separate lines, all time: owed to you (remaining on Lent) and you owe (remaining on Borrowed).
- Currency: one symbol for the whole app, stored in app settings (so it travels with the App Settings backup category), default ₹. Settings offers a list of common symbols and a free text field for any other. Changing it only relabels; amounts are never converted, and the setting says so plainly.
- Storage: Home entries keep the details in a new `money_json` column added through the existing column migration; the label is a readable summary and the note is the description, so search finds them. Backup export and import must carry the column. Vault entries keep the same details as JSON inside the encrypted body, replacing the placeholder text shape; Vault totals come only from the unlocked index and are never mixed with Home.
- Not included: charts, budgets, recurring entries, per-entry currency, conversion, reminders from due dates, CSV export (a later step).
- Build order is in the roadmap.

**125. Password-protected PDFs open in the viewer after the password is typed.** Refines Decision 121.
- Cause: the viewer only showed a message and Open with app for a protected PDF.
- Rule: when pdf.js reports that a document needs a password, the viewer shows a password field in place of the pages, with Open and Cancel. A wrong password says so and asks again. Cancel, or leaving the viewer, shows the protected-PDF message with Open with app.
- Password handling: kept in the field and passed to pdf.js for that open only. The field is emptied on use and on leaving; the password is never written to the database, a file, the clipboard or any setting, and nothing is remembered between opens. Home and Vault behave the same; typing counts as activity for the matching auto-lock, and locking the Vault closes the viewer and the prompt.
- Logic lives in `pdfopen.js` with pdf.js passed in, so it is tested in Node against a real encrypted file (right password, wrong then right, give up, no prompt for an unprotected file).
- No network call and no new permission.

**126. Money on Home: form, rows, month header, repayments, edit.** Builds Decision 124 step 3.
- Capture: New in the Money folder opens the form (kind, amount, person and due date for Lent and Borrowed, category, payment method, date), then the Save dialog. The name defaults to the readable summary, the description is the note, tags as elsewhere. Back from the Save dialog returns to the form with the values kept.
- Edit: the same two steps. A name still equal to the old summary follows the new details; a typed name is kept.
- Kind is fixed once repayments exist. Cause: changing it would change what the repayments mean.
- Repayments: Add repayment on the detail view, pre-filled with the remaining amount; an overrun is refused. A repayment cannot yet be edited or removed.
- Month header: Money folder only, starts on the current month each time the folder opens. The list is not filtered by month. Totals read every Home Money and expense row, not just the 200 the list shows.
- Rows: kind, amount with the symbol, status (a partly returned loan shows what is left), event date. A settled loan is greyed.
- Expense rows from before Decision 124 open in the same viewer as Spent. Their Edit stays on the earlier prompts.
- Symbol: read from the `currency_symbol` meta key, default ₹. The Settings control is step 4.
- Dialogs close when the app locks. Back does not close them; Cancel does.
- Logic lives in `moneyui.js`; `app.js` only wires it. `editEntry` writes `money_json`.
- No network call and no new permission.

**127. One commit per change set.**
- Cause: every commit to `main` starts its own build. Run numbers follow the order builds start, not the order of commits, so the highest release number can hold older source. A release holding only the docs commit, and one holding only the stylesheet commit, were both installed as the newest build.
- Rule: upload all files of a change set in one commit. If several commits landed, run Build Android APK on `main` once they finish and install that run.
- The in-app update check compares release numbers only. "Up to date" does not prove the newest source is installed.

**128. Money repayments in the form; payment methods; month header controls.** Refines Decision 126.
- Payment method defaults: Cash, UPI, Card, IMPS, RTGS, NEFT. Recent values come first, up to 10 chips.
- A repayment now stores `method` beside amount, date and note. A repayment stored without one reads as empty.
- Lent and Borrowed show a Repayments section last in the form: repaid amount, date, repaid by, note, and + Add repayment. A partial repayment can be followed by more. The list can remove a repayment; changes are kept only when the entry is saved.
- The kind is fixed while any repayment is listed. A repayment typed but not added blocks Continue. An amount above what is left, or an amount below what is already repaid, is refused.
- Add repayment on the detail view also asks Repaid by.
- Month header: a small previous button, Month and Year dropdowns, and a small next button in one row. Cause of the earlier layout: `icon-btn` has no base style, so the arrows took the global full-width button rule.
- The Money form and repayment dialogs scroll when taller than the screen.
- A single repayment still cannot be edited in place; remove it and add it again.

**129. Month header year control.** Replaces the year list in Decision 128.
- The Year dropdown lists the shown year and two either side, oldest first. Picking one moves the window.
- A text field under the row takes any four-digit year from 1900. Applies on Enter or when the field loses focus. An invalid entry is dropped and the shown year stays.
- Cause: the list was bounded by the oldest entry and next year, newest first, so other years were unreachable.

**130. Currency symbol control in Settings.** Builds Decision 124 step 4.
- Location: Settings > Preferences > Currency. Chips for the symbols in `Money.CURRENCIES`, the current one selected; a text field takes any other symbol.
- Rule: a typed symbol is 1 to 5 characters, trimmed, no control characters. Anything else is refused with a message and the stored symbol is unchanged. Cause: `cleanSymbol` silently falls back to the default, which would hide a bad entry.
- Applies at once: stored in `meta.currency_symbol`, Home redraws. Amounts are never converted; the tile says so.
- Backup: `currency_symbol` added to `APP_SETTINGS_KEYS`, so it travels with the App Settings category. The control repaints after a restore.
- No network call and no new permission.

**131. Expense detection removed from capture.** Builds Decision 124 step 5.
- Rule: typed text containing "spent" and a number is saved as a plain note. Money entries come only from the Money form.
- Removed: the expense handler in `intents.js`, the expense branch of `captureText`, and the follow-up prompt with its 15-second timer in `app.js`.
- Kept: reminder text detection (Decision 124), label suggestion, and every read path for existing expense rows (list, totals as Spent, viewer, search, backup). The `amount`, `expense_category` and `replied` columns stay.
- Cause for keeping the columns: old rows and old backups still carry them.

**132. Back closes the Money dialogs.** Refines Decision 126 (Back did not close them).
- Rule: while the Money form or the repayment dialog is open, Back acts as Cancel. It sits just under the Yes/No sheet and above selection, the Save dialog and the viewers in the order Back checks.
- No confirmation: Cancel on these dialogs has none either.
- Cause of the dead Back: `backAction()` did not know the dialogs, so it found nothing to dismiss, or dismissed what sat behind them. The dialogs' open and close hooks now also refresh the Back button state.

**133. Back is never dead; unsaved work asks Discard.** Applies to Home and Vault alike.
- Rule: Back and every Cancel on a screen holding input ask "Discard changes?" (Yes, discard / No, keep editing) when something changed since opening. With no change they close at once, no question.
- Edit (Save) dialog: compared with its values at open; was closing silently. Outside tap follows the same rule.
- Money form and repayment dialog: same comparison, including repayments added to a loan. Cancel and Back share one path.
- Coordinates paste, auto-backup passkey, Settings fields (passkey, hint, restore file, currency symbol, confirm password) and the Vault Settings confirm PIN: ask before leaving. A backup or restore that succeeds clears its passkey fields first.
- Unchanged: the text editor guard, capture dialogs that always ask Discard, the recording Discard.
- Not covered: first-run and lock screens, which have no screen to go back to; native prompt() and confirm() sheets, which Android closes itself.

**134. Per-entry action order and Delete icon.** Fixed order everywhere: Edit, Share, Download, Delete. Delete is a red bin icon.
- Changed: row buttons (Home and Vault) were Share, Download, Edit, Delete. The image viewer Delete was not red. The Select files Delete is now a red bin with its label.
- Bulk bars have no Edit; their order is Share, Download, Delete.
- Viewers other than image show only Edit in the header; adding Share, Download and Delete to them is open.

**135. Vault Money.** Builds Decision 124 step 6.
- Storage: the details JSON (`money.js` `toJson`) sits in `encrypted_body`; the note in `encrypted_description`; `money_json` and `file_path` stay NULL. Cause: `money_json` is plaintext, which is right for Home and wrong for the Vault.
- Name: the Save dialog defaults to `Money <time>`, never to the readable summary, and Edit never rewrites a name from the details. Cause: the label is the only plaintext a Vault row carries, and the summary holds the amount and person.
- Index: built on unlock with the details, a search text (summary, person, category, method, repayment methods and notes) and a size; discarded on lock. Rows, month header, loan totals, search and the category and method chips read only this index and are never mixed with Home.
- Dialogs: the Home form, repayment dialog and viewer are reused with Vault hooks. A Vault lock closes Vault Money dialogs only and leaves a Home form open; an app lock closes both.
- Header ids use the prefix `vms` (Home keeps `ms`), so the two never collide in the page. The header is emptied when the folder closes or the Vault locks.
- Share and Download: readable text built from the decrypted details (summary, date, method, due, returned, remaining, repayments); Download is a `.txt`. Same rule as Decision 41: the copy is plaintext once it leaves the Vault.
- Backup: unchanged. `private_vault` carries `encrypted_body`; cross-PIN append re-keys it as for every other Vault type.
- The Vault symbol is the app symbol (Decision 130), loaded on unlock.

**136. Row-button feedback and the download folder.**
- Each row action button (Edit, Share, Download, Delete) glows on its own, with the Back button's animation; Delete glows in the danger colour. Cause of the old behaviour: `:active` also matches every ancestor, so pressing a button lit the whole row. The row now reacts only to a press outside `.row-actions`.
- Every Download writes to `Documents/Arkly`. A name already there gets ` (2)`, ` (3)` and so on; an earlier copy is never overwritten. Backup files and Extract to device storage keep their own paths: restore reads backups from the Documents root.
- Location, Reminder and Money (and legacy Expense rows) download as a readable `.txt`. Location: name, coordinates, map link, saved time, note. Reminder: name, time, repeat, status, note. Money: summary, date, method, due, returned, remaining, repayments, note.
- Download shows `Downloaded to Documents/Arkly/<name>`; a failure shows `Could not download: <reason>`. The message comes from one wrapper, so every Download entry point shows it.

**137. Undo after delete.** Every Delete (row button, image viewer, Select files, multi-select, Clear items older than 30 days) shows `Moved to trash` or `N moved to trash` with an Undo button for 6 seconds.
- Undo is a restore from the 30-day trash (`restoreFromTrash`), so a deleted reminder goes back on the schedule. The Vault index is rebuilt once per batch.
- Not offered for Delete permanently, which keeps its confirmation.
- One toast at a time: a newer toast replaces an Undo still showing.
- An app lock or a Vault lock hides an Undo that belongs to what locked (the Vault lock only for Vault deletes), so no Undo button sits on the lock screen.
- Clear items older than 30 days now reports through this toast instead of a blocking alert; with nothing to clear it says so.

**138. Android Back button and back gesture.** Both run the on-screen Back button's action (`backAction()`, Decisions 82, 104, 132, 133), with the same glow. Where that button is dimmed (a section's landing page, the lock gate) the app goes to the background, which locks it (Decision 45); it does not close. Cause: no listener was registered, so Android used its default and left the app from any depth.

**139. A Vault lock always shows the gate.** Found in the DP17 lock check: with the Vault on view, the idle timer, app-to-background and screen-off locks cleared the key and the lists but left the content showing, with the unlocked icon, the folder counts and no PIN prompt.
- Cause: only the lock button redrew the Vault gate. The other three paths called `lockVault()` alone.
- Fix: `lockVault()` itself redraws the gate when the Vault screen is on view, without a biometric prompt (the app may be in the background). It also empties the folder counts and the Vault search text.
- Returning to the app on a locked Vault screen shows the gate and offers biometric, as the Vault tab does. The app lock screen hides the Vault screen, so this never races it (Decision 59).
- A Vault lock closes the Select files screen when it lists Vault items.
- An app lock now also closes the static overlays that sat above the lock screen (Select files, New chooser, overwrite confirmation, due-backup prompt), each through its own Cancel or Skip, and empties the Select files list. Cause: they sit above the lock screen and nothing closed them.

**140. Vault Reminder.**
- Capture: Vault, Reminder, New opens one Save dialog (name, note, when, repeat, tags), as Home does. The name defaults to `Reminder <time>`.
- Notification and lock screen: title `Arkly Reminder`, text `Vault Reminder`. The name and note are read only inside the Vault. The same text is used for a snooze and for every occurrence of a repeating reminder. Nothing else from the Vault appears in a notification.
- Snooze and Done stay on the notification: they show nothing and need no PIN. A tap on the notification still opens nothing (Decision 92).
- Storage: type `reminder`, `is_private` 1. `fire_at`, `repeat_rule`, `completed_at` and `snoozed_until` are plaintext columns, because the notification needs them while the app and the Vault are locked. The name is the plaintext label, as for every Vault row; the note is in `encrypted_description`; the body is empty.
- Rows, viewer, Done, Reopen, Reschedule, Edit, Share, Download, Delete with Undo and restore from trash work as on Home. Share and Download give text (name, time, repeat, status).
- Vault reminders never appear in Home folders, counts, search or the digest (the `is_private` scope is unchanged).
- Cause fixed on the way: `editEntry` and restore from trash rescheduled a reminder only when it was not private.

**141. Viewer header actions.** Closes the open point of Decision 134. The Money, Reminder, Location and Voice viewers show Share, Download and Delete after Edit, in the order of Decision 134, in Home and the Vault. The image and PDF viewers already had them. Delete moves the entry to trash, closes the viewer and shows Undo (Decision 137); there is no confirmation, since the trash and Undo cover a mistake. Share and Download from a Vault viewer follow Decision 41.

**142. Vault Location.** Last Vault capture card; closes the placeholder left by Decisions 79 and 116.
- Capture: Vault, Location, New runs the Home flow (`pickLocation`, shared): chooser (current location or coordinates), GPS fix or paste dialog, then the Save dialog. Decisions 79, 113, 116 apply unchanged.
- Storage: type `location`, `is_private` 1. `{ latitude, longitude }` as JSON in `encrypted_body`; note in `encrypted_description`. The `latitude` and `longitude` columns, `file_path`, `body_text` and `money_json` stay NULL. Cause: those two columns are plaintext, which is right for Home and wrong for the Vault. Coordinates outside ±90 or ±180, or not numbers, are refused before encrypting.
- Name: the Save dialog defaults to `Location <time>`, never to a pasted place name, which would be the plaintext label. Edit changes name, tags and description only, as on Home.
- No network from the Vault: the paste dialog hides Verify link, and a short link tells the person to open it in Maps and paste the full link or the coordinates. Decision 117 is unchanged on Home.
- Index: built on unlock with the coordinates, a search text (decimal latitude and longitude to six places) and a size; discarded on lock. A corrupt entry is still listed, with no coordinates.
- Viewer: the Home viewer (Decision 93) with the coordinates read from the index; the header actions follow Decision 141. Open in Maps hands a `geo:` URI to the phone, which is the same plaintext exit as Share (Decision 41); leaving the app triggers the background lock.
- Share and Download: the name and map link, as on Home; Download is a `.txt` that also carries the note, decrypted for that copy. Plaintext from that point on (Decision 41).
- Locks: the chooser and paste dialog carry `isVault`; a Vault lock closes only the Vault ones, an app lock closes both. A Vault lock during the GPS fix saves nothing.
- Backup: unchanged. The entry travels in `private_vault`; cross-PIN append re-keys `encrypted_body` as for every Vault type.
- Vault location rows never appear in Home folders, counts, search or the digest (the `is_private` scope is unchanged).

**143. Vault matches Home.** Owner direction: the Vault works as Home does, with three differences only: its own PIN, the notification text `Vault Reminder` (Decision 140), and trash, Select and search kept separate from Home. Supersedes the parts of Decisions 135 and 142 that differed.
- Names: Vault Money defaults to the readable summary and Vault Location to the pasted place name, as on Home. Edit rewrites an unchanged summary name from the new details in both. Consequence: the label is the one plaintext field of a Vault row, so an amount, person or place name typed or pasted into it is stored unencrypted. Rename the entry to keep it out.
- Verify link: available in the Vault paste dialog, one request to Google on tap, as on Home (Decision 117). No Vault data is sent; only the short link the person pasted.
- Rows: Vault rows show type and date as Home rows do, not the size. The size stays in Select files.
- Share and Download: Vault Money, Reminder and Location include the note, decrypted for that copy. Plaintext from that point on (Decision 41).
- Home Share now sends the same text as Download for Money (summary, date, method, loan figures, repayments, note), Reminder (name, time, repeat, status, note) and Location (name, map link, note). Before, Home Money Share sent the summary only and Home Reminder Share the name only.

**144. Encryption at rest: plan, staged, nothing built.** Owner goal: nothing readable by reading the database file or the files on disk, and still fast. Plan only; each stage below is a separate roadmap item (Phase 17) and needs approval before it starts.
- Key derivation: stays PBKDF2 with AES-GCM on Web Crypto. No Argon2id and no other external crypto library. Raising the PBKDF2 iteration count is allowed inside this rule and is open.
- Layers, in build order:
  - A. Vault labels encrypted (`encrypted_label`, a generic placeholder in `label`), decrypted into the in-memory index on unlock, never in `entries_fts` or `label_history`. Ends the plaintext-label consequence recorded in Decision 143.
  - B. Vault index updated per entry on add, edit and delete, instead of a full rebuild after every change.
  - C. Whole-database encryption, so labels, sizes and the search index are unreadable without the key. Home search keeps FTS5. Whether `@capacitor-community/sqlite` supports this, and the cost in speed, are not yet checked.
  - D. Per-file encryption on disk: a random name with no extension, a random key per file wrapped under the master key. The type no longer shows in the file name. A file is decrypted into memory to open it. Vault files stop being base64 inside the database only if this stage chooses so.
  - E. Backup and restore adapted at every stage, under the rules below.
  - F. One-time migration of existing data, on a successful unlock.
- Vault entries stay encrypted under the Vault PIN on top of any database layer. Opening the database does not open the Vault.
- Search: encrypting each field separately would force an in-memory index and slow search; whole-database encryption does not. The plan therefore avoids per-field encryption for Home.
- Database key: open. Options are a random key held in the Android keystore (works with no app password, does not move between phones) or a key from the app password (does not exist while the password is optional). Not decided.
- Credentials stay independent: app-open password, Vault PIN and backup passkey. No layer lets one recover another.
- Backup rules, binding on every stage:
  - A backup is encrypted only under the backup passkey. It never contains a device key or anything derived from one.
  - A backup restores on a different device with the passkey; Vault entries also need the old Vault PIN, as now (append re-keys them).
  - Restore re-encrypts everything for the current device.
  - Backups made before this plan (plaintext labels, unencrypted files) are accepted for good, and encrypted on the way in.
  - Append stays the default restore; the safety-backup rule is unchanged; a restore that fails partway must not leave a mix of old and new encryption.
- Speed: each stage is measured on a real phone, including backup and restore of a large library, before it is called done.
- Passcode strength: no length or character rule exists today. A minimum length or a warning for short passcodes is open and undecided; a short numeric PIN is the weakest point whatever the cipher.

**145. Vault labels encrypted (Phase 17 A).** A Vault row stores the placeholder `Vault item` in `label` and the real label in `encrypted_label`, encrypted under the Vault key like the body and description.
- Read: `loadVaultEntryContent` returns the row with its label decrypted; the in-memory index, the Vault trash list, Share and Download use that. An undecryptable label reads `Unreadable item`.
- Write: capture and Edit write `encrypted_label` and keep the placeholder; Edit of a Vault label now needs the unlocked Vault, as description edits already did.
- Migration: on unlock, every Vault row (trash included) still holding a plaintext label is encrypted and its `label` replaced by the placeholder. Repeatable, safe if cut short. This is the label part of Phase 17 F, done here so A has effect on existing data.
- Backup: `encrypted_label` travels in the payload. Append skips the `(Restored)` label-match check for Vault entries (labels are placeholders or ciphertext); the UUID check stays. A different-PIN restore re-keys `encrypted_label` with the body and description. A backup from before this decision (plaintext label, no `encrypted_label`) is accepted: encrypted on the way in under a different-PIN restore, otherwise at the next unlock.
- Limit: freed database pages and journal files may still hold an old plaintext label until whole-database encryption (Phase 17 C). A and the migration do not remove those.
- Closes the plaintext-label consequence of Decision 143. Credentials unchanged: no new key, no new credential.

**146. Home tools row, Trash folder, Search layer, shared sort and filter.** Home shows four icon-only tiles in one row: Select, Search, Trash, Settings (no visible labels; each has an accessible name and a tooltip). They replace the Settings tile, the search box and the Select files button.
- Trash moves out of Settings into a folder-like view on Home (hides the card grid, Back returns). Rows show type, deleted date and days left, with Restore and Delete permanently. The 30-day rule is unchanged.
- Search opens a full-screen layer. The bar grows out of the Search tile (a transform from the tile's box to the bar's box; its content fades in after) and the keyboard is raised inside the tap. Back or the close button reverses it. Reduced motion skips the animation. Locking, or going to the Vault, the lock screen or Settings, closes it at once and clears the text and results.
- One toolbar serves Trash, Search results and Select files (`browse.js`): type chips with counts, a sort list, and for Trash and Search a period list (Any time, Today, Last 7 days, Last 30 days). Period is the deleted date in Trash and the created date in Search. Select files has type chips and sort only (Default, Name, Largest, Smallest).
- Sorts: Trash: Recently deleted, Deleting soonest, Name, Type. Search: Best match, Newest, Oldest, Name, Type. Names sort numerically (item 2 before item 10).
- Type chips wrap onto several rows so every type is visible without sideways scrolling.
- Select files is a fixed-size dialog (the list scrolls inside it, Share, Download and Delete sit in one row, Close below) so it does not resize per type, and the Back button is raised above it while it is open.
- Not changed: the Vault's own search, Vault Trash and Vault Select files keep their current form. Matching them is a separate item (done, Decision 147).
- No new data, no new credential, no network.

**147. Vault tools row, Vault Trash folder, Vault Search layer, Vault-only Select.** Finishes the item left open in Decision 146. The Vault landing page shows the same four icon-only tiles as Home: Select, Search, Trash, Vault Settings. The Vault search box, the Select files button, the inline results list and the Trash section inside Vault Settings are removed.
- Trash: a folder-like view inside the Vault (Back returns). Same toolbar, sorts and 30-day rule as Home. Labels are decrypted for display (`vaultRowLabel`) and held only while the view is open; closing it or locking the Vault empties them.
- Search: the one search layer of Decision 146 with a source flag. Opened from the Vault tile it reads the in-memory index (Decision 39), shows Vault rows, and nothing from Home. A Vault lock, or switching to Home, closes it at once and clears the text, results and rows. The lock and power buttons stay hidden while it is open, as on Home.
- Settings: the tile opens the existing settings card as its own view (card always open, summary hidden). Back asks Discard if a field holds typed input (Decision 133).
- Select: Home Select lists Home entries only; Vault Select lists Vault entries only, one chip per Vault type. Before, Home Select and the Home storage breakdown also listed Vault items while the Vault was unlocked; that mixing is removed. A Vault lock closes a Vault Select dialog.
- Long-press selection in search results follows the layer's source.
- Back order inside the Vault: dialogs and viewers, Search, Vault Trash, Vault Settings, a type folder.
- No new data, no new credential, no network.

**148. Trash Undo, pinch zoom, PDF viewer switch.**
- Trash Undo (Home and Vault): Restore shows an Undo toast that puts the item back in the trash with its original deleted date. Delete permanently keeps its confirmation, then hides the row at once and runs the real delete after the Undo window; Undo cancels it. This replaces the exception in Decision 137 ("not offered for Delete permanently"). Only one delete is pending at a time: a second one, reopening a Trash view, or a Vault lock completes it immediately. If the app is closed inside the window the item stays in the trash.
- Pinch zoom in the PDF viewer, Home and Vault: two fingers scale the pages by a transform while they move, then the pages are redrawn sharp at the new zoom on release, anchored at the pinch point. Range 1 to 4. The + and - buttons step from any zoom, including a pinched one.
- PDF viewer switch: the top of each PDF folder (Home and Vault) carries one switch, in-app viewer on or off, default on. It is a single setting (`pdf_inapp_viewer`) shared by both, included in backups with the other non-sensitive settings. Off: every PDF open, including from search, goes to the phone's PDF app or its chooser (Decision 118 path). For Vault PDFs that means a temporary decrypted copy, as for other Vault files, removed on the next launch or resume.
- No new data beyond one setting, no new credential, no network.

**149. In-app sheets replace native dialogs.** No `prompt()`, `confirm()` or `alert()` remains in `app.js`.
- Text sheet (`askText`): one field, OK and Cancel, optional password mask and decimal keypad. Resolves the typed text, or `null` on Cancel, Back or a lock. The field is emptied on every close, so a typed passkey never outlives the sheet (Decision 94 rule). A Vault-flagged sheet closes on a Vault lock; others close on an app lock.
- Yes/No sheet: `askYesNo` gains `explicitNo`. The No button then resolves `'no'`; Back or a lock still resolves `false`, so a dismissal is never read as a choice.
- Drive restore mode: Append (safe) or Overwrite. Only the Overwrite button selects Overwrite, and the existing consequence dialog still follows. The native `confirm()` it replaces read Cancel as Overwrite.
- Wrong password, wrong PIN, failed Vault biometric and similar notices are toasts.
- Delete permanently, Select delete and Clear older than 30 days ask through the Yes/No sheet. Rules unchanged: 30-day trash, Undo window, Append default.
- Removed unused `promptForTags` and `promptForLabel`; tags and names come from the Save dialog (Decision 91).
- No new data, no new credential, no network.

**150. Real free space for backup and restore checks; sizes count what an entry stores.**
- Free space comes from `@capacitor/device` (`realDiskFree`, Android StatFs of the data directory), replacing `navigator.storage.estimate()`, which reports the WebView's own quota. A missing or failed reading is unknown and never blocks (as before).
- Backup: the existing check against the payload size stays; a second check uses the encrypted file's real size just before it is written. Restore: the required size is the file bytes plus the database rows.
- Sizes: an entry's size is its file or note text plus description, Money details, coordinates (16 B) and legacy expense fields. Your Data shows the sum of the Home entry sizes (Vault excluded, Decision 40), labelled as data held, not as an estimate of device usage.
- Drive's check against Drive's own quota is unchanged.
- One new official plugin, no permission, no network. Nothing leaves the device.

**151. Vault index updated per entry (Phase 17 B).** The in-memory Vault index is no longer rebuilt after every change.
- Add, edit, trash, Undo, restore, permanent delete and bulk delete re-read only the affected rows. A row that is a live Vault row is added or replaced; any other result removes it. A Home id changes nothing.
- Order is the database order, kept through each row's `rowid`, so a restored entry returns to its place.
- Full build stays for: unlock (with the label migration), a backup restore, and a reminders-changed event that names no entry. If no index exists yet, a refresh does a full build.
- The index is still memory only, never written to disk, and cleared on lock (Decision 39). No change to backup, restore, credentials or stored data.
- Measured on a real phone with a large Vault before it is called done (DP37).

**152. PDF viewer tools (Phase 18): plan, approved, nothing built.** Three items, built in order, one per session, each with its own device pass. All offline; no account, no network, no cloud.
- A. Reading tools, `pdfjs-dist` only: text layer, search inside the PDF, jump to page, thumbnails, outline, password-protected PDFs. The PDF password goes through the text sheet, is never stored and the field is emptied on close. Vault PDFs stay in memory only.
- B. Mark-up and forms through the pdf.js annotation editor: highlight, note or text box, drawing, stamp, form fill. Output is a new copy by default (same folder, name with a suffix). Replacing the original is a separate explicit choice, with its consequence stated and no Undo. A Vault copy is encrypted under the Vault key like any Vault entry. Leaving with unsaved marks asks to discard.
- C. Page tools and image to PDF with `pdf-lib`: rotate, delete, reorder, split or extract, merge, image to PDF, a signature picture placed on a page. Always a new copy. `pdf-lib` is not a crypto library, so the Decision 144 rule does not apply, but bundle size and CI are checked before use. The signature is a picture, not a digital signature.
- With the PDF viewer switch off (Decision 148) the phone's PDF app opens the file and these tools do not exist.
- Not doing: conversion to or from Office files (needs heavy converters or a server); summaries or questions about a document (automated inference, outside the app's premise); cloud sharing and collaboration (a backend); OCR of scanned PDFs (offline OCR data is large and the usual library fetches it over the network); cryptographic digital signatures (Web Crypto cannot produce the PDF signature format and an external crypto library is excluded by Decision 144).
- Speed and memory: each item is measured on a real phone with a large PDF before it is called done.

**153. PDF reading tools (Phase 18 A).** Builds item A of Decision 152.
- Text layer: each drawn page gets a pdf.js `TextLayer` of transparent text over the canvas, so words can be selected and copied with the system selection controls. It is released with the page and drawn again after a zoom.
- Find: a Find bar (field, count, previous, next, close). A query needs 2 or more characters; case is ignored and whitespace collapsed; a phrase can run across text items and line ends. Search runs page by page and shows progress; it starts after a typing pause or on Enter. The first match on or after the current page is chosen; next and previous wrap. Cap 2000 matches, shown as `2000+`. Highlights cover the whole text element holding a match (yellow; the current one orange), not the exact characters.
- Pages panel: thumbnails drawn while near the view and released beyond it, the current page marked; an Outline tab listing entries that point inside the document with their page (links to outside addresses are not followed); a go to page field clamped to 1 through the page count.
- Back closes Pages, then Find, then the viewer.
- Privacy: the query, the results, the page text and the thumbnails live in memory only. Page text is cached only while Find is open and dropped when it closes. Closing Find, closing the viewer or a Vault lock empties the field and drops everything. Vault bytes stay in memory only. Copy from a Vault PDF reaches the system clipboard by the person's own action, as Share and Download already do (Decision 41); it is not cleared automatically.
- Password-protected PDFs keep the inline prompt of Decision 125; it is not moved to the text sheet named in Decision 152.
- Scanned PDFs have no text to select or find (OCR excluded, Decision 152). No new dependency, no network, no new permission, no stored data.

**154. Home PDFs are read as bytes through the app's file URL.** A 41.92 MB PDF closed the app during "Loading…" with no message (a process kill, not a script error). Cause: the base64 read held the file as a base64 string, its decoded string and the byte array at once. Confirmed on device: the 41.92 MB PDF now opens. Home PDFs now load with `fetch` on the Capacitor file URL straight into a byte array; if that read fails, the base64 read runs as before. Vault PDFs are unchanged: the stored entry is base64 inside the encrypted record, so a very large Vault PDF can still exhaust memory. No new permission, no network (the URL is the app's own local file server).

**155. Entrance motion only.** Extends Decision 86; no behavior change.
- Screens and modal backdrops fade in (0.18s); the toast slides in from above (0.2s). Sheets keep `sheet-in` (Decision 86 era), buttons keep their press scale.
- Opacity only on screens: a transform would make a screen the containing block for fixed children while it runs.
- Entrances only. Hiding is `display: none`, so exits do not animate; adding exits would mean delaying every hide in `app.js`.
- Everything sits under `prefers-reduced-motion: no-preference`.
- Haptics not added: no haptics plugin is installed, and a new plugin is a new dependency. Light-theme tuning not done blind.
- No new dependency, no permission, no network, no stored data.

**156. Vault file metadata cache.** Extends Decision 144 (B); stage C and D unchanged.
- Cause of the slow Vault open: the full index build decrypted and parsed each file entry's whole body (file bytes as base64) to get its size and OCR text, after the plugin had returned every body; a tags query ran per entry. Encryption itself is not the cost.
- `encrypted_meta` (new column, Vault file types only: voice, image, pdf, file): JSON `{v, bl, o, s}` (body length, OCR text, size) under the Vault key, same AES-GCM call.
- Derived data, never authoritative. Used only if it decrypts under the current key and `bl` equals the SQL length of the stored body; otherwise rebuilt from the body and written back. This covers a PIN change, a restore, and any write path that forgets it. A Vault content edit clears it anyway.
- The index query returns NULL instead of a file entry's body, with its length; text, money, location and reminder bodies are still read.
- Not in backups: the export drops it, restore leaves it empty, the next unlock fills it. Backup format, safety backup, append default and the three credentials are unchanged.
- First unlock after the update rebuilds the records once, at today's speed.
- No new dependency, no permission, no network. Whole-database and per-file encryption (C, D) remain open; D would replace this record with its own.

**157. Preparing Vault notice.** Extends Decision 156; no behavior change to data.
- While the full index build creates file records, a sticky toast reads "Preparing Vault: N of M" (M = file entries without a record) and is hidden when the build ends. Nothing shows when no records are needed.
- Shown on unlock and after a restore; not on single-entry updates. The record build itself still runs one entry at a time and can block the screen briefly on a very large file, so the count may pause.
- No new dependency, no permission, no network, no stored data.


**158. Whole-database encryption (Phase 17 C).** Implements Decision 144 item C and settles its key-source question.
- Engine: SQLCipher through `@capacitor-community/sqlite` 6.0.2 (the 8.x line needs a newer Capacitor). `capacitor.config.json` sets `androidIsEncryption: true`.
- Key: random 256-bit value generated on the device, stored by the plugin in Keystore-backed encrypted preferences. Not derived from the app-open password, the Vault PIN or the backup passkey; the three credentials stay independent. Never in a backup. If the key is lost (app data cleared) the encrypted file cannot be opened; recovery is a backup restore, and startup stops with a clear message instead of failing silently.
- Not the app password: it is optional, changing it would rewrite the whole file, and a forgotten one would lose data. An optional password wrapper around the same key stays open.
- Fresh install: the database is created encrypted. Existing install: stays plain until the owner taps Settings, Database encryption, Encrypt database. Opt-in, one-way, warns to run Export Now first.
- Conversion runs at the next start, before any connection exists (`initDb`). One attempt per request: the flag is cleared before the attempt, so a hang cannot repeat. Row counts of every table (FTS shadow tables skipped) are compared before and after, and the file must report as encrypted. The result is stored (`dz_enc_result`) and shown in Settings. `checkConnectionsConsistency()` runs at every start to close native connections left by a reload.
- An in-app conversion that closed the live connection first hung and was dropped; the cause was not identified.
- Measured on device: encrypted open 6 to 16 ms (plain 5 to 8); 50 FTS searches 132 to 469 ms (plain 121 to 315) over three runs; the real schema with its FTS5 table plus a 10 MB blob converted in 666 ms with all rows and search hits intact. The owner's own database converted with every Home count unchanged.
- `scripts/patch-manifest.js` sets `android:allowBackup="false"`: an OS backup would restore the file without its key. The app's own Export and Restore are unaffected.
- The plaintext schedule columns and timestamps of Vault reminders now sit inside the encrypted file. Vault entries stay under the Vault PIN on top.
- `encbench.js` and its Settings row (Diagnostics) remain until cleanup.
- No new dependency, no permission, no network, no account.

**159. Backup format 2: chunked, encrypted per line (Phase 6, found on DP42).**
- Cause: Export Now froze, then the app closed, on 109 MB of Home data plus the Vault. Format 1 held the whole archive as one string and copied it many times (base64, stringify, encrypt, stringify again, size check; the payload was also built twice, once only to measure it). Restore had the same shape: whole file read, whole JSON parsed.
- Format 2 (written by `createBackup`): same `.dz` file name. Line 1 is a plain header `{version:2, salt, kdfIterations, hint}`. Every later line is `{iv, c}`: one AES-GCM call with the line number as additional data, so a dropped, moved or swapped line fails to decrypt. Order: head record (categories, tags, settings, Vault salt, size per category), then per entry an entry record followed by its stored-body pieces and file chunks (3 MB of file bytes per line; a stored body over 1 MB, such as a Vault file, is split into 2 MB pieces), then an end record with the counts.
- One passkey derivation per backup (300000 PBKDF2 iterations, as before). Header fields are the only plain data: salt, iterations, hint.
- Format 1 files restore unchanged. The Drive path still writes and reads format 1 (`buildBackupPayload`, `encryptBackup`, `decryptBackupPayload` are kept as they were).
- Size check without a payload: one query of column lengths plus a file size per file. Expected size is 1.34 times the data plus a small margin.
- Restore reads the picked file with `File.slice`, 2 MB at a time, one entry at a time. File chunks are appended to `files/<id>.<ext>`. Entries in unselected categories and exact duplicates are read past without decrypting.
- Overwrite: the passkey is proven by the head record, then the whole file is read and decrypted once and its end record checked, before the safety backup and before anything is deleted. A damaged or cut-short file stops there with nothing changed. Append has no first pass; a file that ends early reports "ends early" and keeps what was restored.
- A file missing from storage at backup time is left out and reported as a count; format 1 failed the whole backup on it.
- A wrong passkey on a format 1 file now shows a message instead of an unhandled error.
- Unchanged: append default, overwrite warning and safety-backup rules, cross-PIN Vault re-key, selective categories, file name pattern, the three independent credentials.
- Measured in Node on 150 MB of files: peak extra memory about 990 MB (format 1) against 68 MB (format 2) with disk-backed storage; tests cover round trip, byte-identical files at chunk boundaries, empty and missing files, an oversized Vault body, truncation, reordered lines, wrong passkey, overwrite refusal, and format 1 restore. Not yet run on a device.
- `crypto.js`: `encryptChunk`, `decryptChunk` added and `toBase64`, `fromBase64` exported; `fromBase64` rewritten as a plain loop (same output, much faster on multi-MB strings).
- Idle auto-lock (app and Vault) is held for the duration of Export Now and Restore, then re-armed. Cause of the lock seen on device: a long restore receives no taps, so the idle timer fired mid-restore. Overwrite also reports each phase (checking the file, safety backup N of M, replacing current data, restoring N of M), since the first two had no progress text and looked frozen.
- After a restore the Vault shows "Preparing Vault: N of M" once at the next unlock: the per-file metadata cache (Decision 156) is not part of a backup and is rebuilt. Expected, one time.

**160. Encryption test removed (Phase 17 C cleanup).** Closes the last bullet of Decision 158.
- Removed: `src/js/encbench.js`, the Settings Diagnostics group with its Encryption test row, and the script tag in `index.html`. Nothing else imported it.
- It only ever touched scratch databases. No schema, stored data, credential, backup format or CI change.
- Committed after DP42 check 5 (fresh install shows Database encryption On), which passed.
- No new dependency, no permission, no network, no account.

**161. Per-file encryption: format and core module (Phase 17 D).** Implements Decision 144 item D. Module only; nothing calls it yet.
- File on disk: `files/<32 hex>`, no extension. Header 16 bytes (`DZF1`, 8-byte nonce prefix, chunk size). Then 1 MiB chunks, each AES-GCM under the file key; IV is the prefix plus the chunk index; additional data is the index plus a final-chunk flag. Truncation, extension, reordering and a copy under another name all fail to decrypt.
- File key: random 256-bit, wrapped under the master key with the stored path as additional data, kept in a new `entries.file_key` column. The type stays in `entries.extension`, inside the encrypted database.
- Master key: random 256-bit in the `meta` table of the encrypted database. Not derived from the app password, the Vault PIN or the backup passkey; never in a backup. Lost with the database; recovery is a backup restore, as in Decision 158.
- Files from before this stage have `file_key` null and are read as plain files. Both kinds work side by side until the migration (F).
- Backup and restore (E): backup reads through the module, so the archive holds file bytes under the backup passkey only and the format does not change. Restore writes through the streaming writer, so files are encrypted for the current device on the way in.
- Opening in another app and Share of a Home file need plaintext: a decrypted copy goes to the cache folder already used for Vault files and is purged the same way.
- Open before wiring: the thumbnail cache in the cache folder holds plain JPEGs; encrypt it or stop caching Home thumbnails. Entry deletion leaves the file behind today; deletion must remove the file.
- Measured in Node on real crypto: 41 MB written in 607 ms, read in 70 ms. Not measured on a device.
- No new dependency, no permission, no network, no account.

**162. Per-file encryption wired (Phase 17 D, E).** Carries out the call-site plan of Decision 161.
- `src/js/files.js` (NEW) binds `filestore.js` to the device: `initFiles(db)` (idempotent per database; master key in `meta`), save, streaming writer, read, size, remove. A row without `file_key` is looked up in `entries` before it is read, so a list row never reads an encrypted file as a plain one.
- New Home captures and restored files are written as `files/<32 hex>` with `entries.file_key`; the type stays in `entries.extension`. Existing files keep `file_key` null and stay plain until F.
- Image, voice and PDF reads, Share, Download, open with phone app and sizes go through `files.js`. Share and open with phone app of an encrypted file use a decrypted copy in `cache/open/`, purged like the Vault copies.
- Backup reads decrypted bytes under the backup passkey only and drops `file_key` from the archive; both formats are unchanged. Restore writes through the streaming writer, so files are encrypted for the current device on the way in; an entry restored without file bytes has `file_key` null.
- The thumbnail disk cache is removed (Home and Vault thumbnails are memory only); `cache/thumbs/` is purged at launch. Cost: a Home grid decodes its images again after a restart. Not measured on a device.
- Permanent delete, trash purge and the overwrite-restore wipe remove the file with its entry. Files orphaned by earlier versions stay until F.
- Memory: an encrypted file is decrypted whole when backed up, opened or viewed, one file at a time. Largest tested so far 41 MB.
- No new dependency, no permission, no network, no account. Credentials unchanged.

**163. Migration of plain Home files (Phase 17 F).** Runs once, at start, after the database opens and before the lock screen can be passed.
- Rows with a file, `file_key` null and `is_private` 0 are converted one at a time: write the encrypted copy, read it back and compare every byte, point the entry at it, remove the plain file. `updated_at` is not changed.
- A file that is missing, or fails any step, stays as it was (the partial encrypted copy is removed) and is retried at the next start. A failure never blocks startup.
- Only when every file converted and none was missing: files in `files/` that no entry points to (left by earlier versions of deletion, or by an interruption between the row update and the removal) are removed, and `meta.files_migrated` is set. Later starts skip all of it. Nothing creates plain files afterwards: capture and restore both write encrypted.
- The notice is a sticky "Securing files: N of M"; a failure shows a count.
- Not covered: thumbnails (no longer on disk, Decision 162); Vault files (already inside `encrypted_body`).
- Risk: the conversion rewrites the owner's real files in place. Export Now first.

**164. Update check and download for the private repo.** Supersedes the public-repo parts of Decisions 72, 75, 77 and 80; the tap-only rule of Decision 72 stands.
- The repo is private: the unauthenticated release list returns 404 and the browser asset link needs a browser session.
- The owner saves a read-only fine-grained token once in Settings > Updates. It is stored as `meta.update_token` in the encrypted database. It is not in `APP_SETTINGS_KEYS`, so no backup carries it, and it is not in the repo, the workflow, the docs or the built APK. It is a fourth stored secret, independent of the three credentials.
- "Check for updates" sends `Authorization: Bearer <token>` to `api.github.com` only, only on that tap. No token saved: no request, and the status says so. 401, 403 and 404 report "token refused" (a private repo answers 404 to a token that cannot see it).
- The asset is the API `url`, not `browser_download_url`. Download is native (`Filesystem.downloadFile`, token and `Accept: application/octet-stream`), into `cache/update/`, then handed to the system installer. A browser hand-off (Decision 77) cannot send the token; an in-page fetch is blocked because the signed asset URL answers without CORS headers.
- `Filesystem.downloadFile` (plugin 6.0.4) opens the target file directly and ignores `recursive`, so `cache/update/` is created first with `mkdir`. First device run failed with "open failed: ENOENT" before this.
- `REQUEST_INSTALL_PACKAGES` added to `patch-manifest.js`. Android asks the owner once to allow installs from this app. The downloaded APK is purged at launch.
- Network calls are now the ad unit, the optional Drive backup, Verify link and this tap: the last carries a credential. Token and request details checked from the authoring environment: release list 200, asset API url 302 to a signed URL, native-style download with both headers 206.
- Risk: token rotation or expiry stops updates until a new one is saved. An APK that carried the token would expose it to anyone holding the APK; it does not.

**165. App renamed to Arkly; CI builds only for code changes.**
- The user-visible name and everything derived from it changed: app name, notification titles and channel description, biometric prompts, the Documents download folder, the restore extraction folder, the Drive folder name, DOM event names, the global object, the workflow artifact and release title, the package name in `package.json`, and all docs.
- Kept as they were, because changing them would break upgrades, signing or saved data: package id `com.dumpzone.app` (a new id installs as a different app with no data, and the Drive sign-in is tied to it), keystore alias `dumpzone`, database file `dumpzone.db`, notification channel ids `dumpzone_reminders_v2` and `dumpzone_reminders`, biometric entry names `dumpzone.app-password` and `dumpzone.vault-pin`, the `.dz` backup extension and the format magic bytes.
- Drive: backups go to `Arkly Backups`; an existing `Dumpzone Backups` folder is still found and used, so earlier backups stay listed.
- Decision 12 and the Session 4 entry keep the earlier name, since they record how the name was chosen and changed.
- `build-android.yml` has `paths-ignore` for `docs/**`, `**/*.md` and `android-notes/**`. A push builds unless every changed file matches; a push with any code, workflow, script or config change builds. Manual runs (`workflow_dispatch`) are unchanged. Run numbers only advance on builds, so the update check is unaffected.
- Risk: a docs-only push never produces an APK; a build needs a code change or a manual run.

**166. PDF mark-up and forms (Phase 18 B): own mark-up on `pdf-lib`. Replaces the pdf.js annotation editor named for item B in Decision 152.**
- Cause: the viewer draws its own pages on the core pdf.js API. The pdf.js annotation editor belongs to pdf.js's own viewer; wiring it into this one uses undocumented parts and cannot be checked without a device.
- Tools: highlight (3 colours), text (fixed size), draw (3 colours), stamp (7 fixed labels, 3 colours), undo, form fill. Marks are held in memory as fractions of the displayed page, so zoom does not move them. Saving draws them into the page: a saved mark cannot be edited again. Form fields stay fillable in the saved file.
- Save: a new copy by default (label plus " (marked)", same tags and description). Replace original is a separate choice with a second confirmation: the original is deleted for good and its date is not kept. The new entry is written first, the original deleted after. Home copies go through the per-file encryption of Decision 162; Vault copies are encrypted under the Vault key like any Vault entry.
- Close and Back with unsaved marks ask Discard (Decision 133). Back closes the form first.
- Not supported: password-protected PDFs (open for reading only, stated when Mark up is tapped), XFA forms (standard fields only), button and signature fields, editing a saved mark, characters outside the standard Latin set (drawn as `?`, noted after saving).
- Dependency: `pdf-lib` 1.17.1, pinned. Not a crypto library. It is a separate chunk (432 kB, 179 kB gzip) loaded when Mark up is tapped; opening a PDF does not load it.
- Privacy: marks, typed text and form values live in memory only and are dropped on Close, on closing the viewer and on a lock. No network, no new permission, nothing stored until Save.
- Geometry: page rotation, crop box and media box are applied once, on export. Checked in Node against pdf.js viewport conversion for rotations 0, 90, 180, 270 and a crop box (text position and upright, highlight rectangle, stamp).
- Risks: not run through CI or on a device. A large PDF is held as bytes, a base64 string and the output while saving. Touch drawing, the bar over the bottom area and the form list are untested on a phone.

**167. PDF page tools (Phase 18 C, first part): rotate, delete, reorder, extract, split.**
- Scope: Phase 18 C is built in parts. This part covers the pages of one open PDF. Merge, image to PDF and the signature picture follow, each its own approval. The pure functions for merge and image to PDF already exist in `pdfpages.js` and are checked in Node, but have no screen yet.
- Tools: Edit pages button in the viewer opens a page grid. Per page: rotate left or right, move earlier or later, delete. Tap a page to select it. Save copy writes the pages as shown; Extract writes the selected pages; Split writes one PDF per typed range (such as 1-3, 4-6) of the pages as shown. Reset restores the original order and angles. The last page cannot be deleted.
- Output is always a new entry beside the original (label plus a suffix: edited, extract, page N, pages A-B), same tags and description. There is no replace choice. Home copies go through the per-file encryption of Decision 162; Vault copies are encrypted under the Vault key.
- Method: the chosen pages are copied into a new document. Outline, form fields and document metadata of the source are not carried over; links and annotations on a copied page stay with it. Rotation is added to the page's own angle.
- Limits: 2000 pages in one output, 20 parts in one split, 200 images in one image to PDF. Password-protected PDFs are refused with the reading-only message, as in Decision 166.
- Close and Back with unsaved edits ask Discard (Decision 133).
- Dependency: none new. `pdf-lib` is already bundled (Decision 166); the new code is two small chunks (`pdfpages` 2.9 kB, `pdfpages-ui` 6.6 kB), loaded when Edit pages is tapped.
- Privacy: the page list, selection and thumbnails live in memory only and are dropped on Close, on closing the viewer and on a lock. Bytes are read again for each save and not kept. No network, no new permission.
- Risks: not run through CI or on a device. The screen (thumbnail cards, rotated thumbnails, buttons over the viewer, split prompt) is untested on a phone. A page with an unusual size shrinks to fit its card.

**168. Merge PDFs and Make a PDF from pictures (Phase 18 C, second part).**
- Entry: the selection bar (long press a row, as in Decision 122) gets one button, Make a PDF. It works on a selection of PDFs only (two or more: merge) or of pictures only (one or more), in a Home folder, the Vault, or a search list. Any other selection says what to select. No file picker and nothing outside the app is read.
- Order: an order sheet lists the selected items in the order they were selected, with earlier and later buttons and a name field. The pages follow that order. Back, Cancel and any lock close the sheet and make nothing.
- Output: a new PDF entry, no tags or description, named as typed (default: first label plus "(merged)", or the first label plus a count for pictures). The originals stay. Home output goes through the per-file encryption of Decision 162; Vault output is encrypted under the Vault key.
- Pictures: each is drawn to a canvas first and encoded as JPEG (quality 0.9, long side at most 3000 px, transparency on white), so camera orientation is applied and any format the phone can decode works. Cost: a picture is recompressed. Each page is A4 in the picture's orientation with the picture filling it.
- Memory: sources are read one at a time, not all at once.
- Limits: 2000 pages in a merge, 200 pictures in one PDF. A password-protected PDF stops the merge naming the file; a file that cannot be read stops it naming the file.
- Dependency: none new. New chunk `pdfcompose-ui` (loaded when the button is tapped); `pdfpages` now also takes items as functions and reports the failing item's position.
- Privacy: the list, name and converted pictures live in memory only. No network, no new permission.
- Risks: not run through CI or on a device. The selection bar now holds one more button on narrow screens. Canvas conversion and the order sheet are untested on a phone. A very large merge is held as one output in memory.

**169. Picture tool in PDF mark-up (Phase 18 C, third part): a picture, such as a signature, placed on a page.**
- Entry: a fifth mark-up tool, Picture, beside Highlight, Text, Draw and Stamp. It asks for one picture with the phone's picker (any picture the phone can decode), then a tap on a page places it centred on the tap. Size S, M or L (15, 25 or 40 percent of the page width; height follows the picture). Undo removes the last placement. Change picture picks another for later placements; earlier placements keep theirs.
- Clear background (on by default): light pixels become transparent with a soft edge, so a signature photographed on white paper does not cover the text under it. Switching it off keeps the picture as it is. The picture is kept at most 900 px on its long side, with camera orientation applied, as PNG.
- Save: through the mark-up save of Decision 166 (new copy by default, replace as an explicit choice). The picture is drawn into the page; it cannot be moved or resized after saving. One copy of the picture is embedded however many times it is placed.
- Geometry: placement, page rotation and crop box are applied once, on export, the same way as the other marks. Checked in Node against pdf.js for rotations 0, 90, 180, 270, a crop box, and rotation with a crop box (corners of both placements within 0.6 point).
- Not done, by choice: a stored signature kept in the database. The picture is picked each time, so no new stored credential-like item exists. Nothing is drawn by finger as a signature beyond the existing Draw tool. No cryptographic signature (Decision 152).
- Picker: the app lock exemption of Decision 73 covers the one pause and return of the system picker.
- Privacy: the picture's bytes, its converted copy and its preview address live in memory only; the preview address is released on Close, on closing the viewer and on a lock. No network, no new permission, no new dependency.
- Risks: not run through CI or on a device. Canvas conversion and the picker return are untested on a phone. Picking a picture while the app lock timer runs relies on the Decision 73 window. A picture with a coloured background keeps its colours where not light.

**170. Weak-secret warning when a credential is set (Phase 17, open item).**
- Warning only, never a block. A short PIN is a legitimate choice for a quick unlock on a phone that is itself locked, and existing credentials are untouched. The person sees why it is weak and picks Use it or Change it.
- Thresholds, in characters: Vault PIN 6, app-open password 8, backup passkey 10. The passkey is highest because a backup file leaves the phone and can be guessed against offline. Also flagged at any length: one character repeated.
- Where it runs: first-run setup (app password, then Vault PIN); Vault PIN setup; Backup now; the auto-backup banner (a declined weak passkey keeps the banner open); Drive Backup now. Not on restore or Drive restore (the passkey there is the one the backup already has), not on unlock, not on empty fields.
- The three credentials stay independent: each field is checked on its own against its own threshold; nothing is compared across them and nothing is stored.
- Back on the dialog counts as Change it.
- Code: `src/js/passcheck.js` (pure, 12 Node checks); `confirmStrength` and the call sites in `app.js`; the existing yes/no dialog.
- Not done, by choice: a block, a score meter, a dictionary or breach list (no data to ship, nothing to look up), or any change to the PBKDF2 iteration count (existing hashes and backups depend on it; separate decision).
- Risks: not run through CI or on a device. The dialog appearing over the first-run screen is untested.

**171. Backup passkey: 600000 PBKDF2 iterations for new backups (Phase 17, open item, part).**
- New backups (format 2 from Export Now, the safety backup and auto-backup; the Drive archive) derive their key with 600000 iterations, up from 300000. Still PBKDF2 with SHA-256 and AES-GCM on Web Crypto (Decision 144).
- Why this credential: a backup file leaves the phone and can be guessed against offline at the attacker's speed. The other two secrets are verified inside the encrypted database on the phone.
- Compatibility: every backup already carries its own iteration count in its header, and restore reads it. Backups made before this change (300000) open as before; nothing is converted. A restore never changes the count of the file it reads.
- One constant, `BACKUP_KDF_ITERATIONS` in `crypto.js`, used by the format 2 writer in `backup.js` and by the Drive archive writer. The Vault key derivation keeps its own fixed count; the app-open password and Vault PIN hashes keep theirs.
- Not done, by choice: raising the app-open password hash or the Vault key count. Neither stores its count, and the Vault key encrypts existing entries, so a different count means re-encrypting the Vault or a versioned rehash at unlock. Separate decision, only with a measured reason.
- Cost: one derivation per backup or restore takes about twice as long. On a desktop runtime 300000 took 142 ms and 600000 took 282 ms; a phone is slower, to be measured (DP53).
- Risks: not run through CI or on a device. Restore of a backup made before this change and of one made after it both need a device check.

**172. App-open password and Vault PIN hashes: 600000 PBKDF2 iterations, versioned (Phase 17, open item, part).**
- New hashes use 600000 iterations (PBKDF2, SHA-256), up from 210000. The count is stored beside each hash: `credentials.app_password_iter` and `credentials.private_pin_iter`. A NULL count means 210000, the count before it was stored. Both columns are added by `ensureColumn`; nothing else in the schema changes.
- Upgrade: after a correct app-open password or Vault PIN, a hash below 600000 is recomputed from the typed secret and replaced (`upgradeCredentialHash`). The salt is kept, because the Vault key derives from the PIN salt and backups carry it. The UPDATE applies only while the stored hash is still the one that was verified. A failed upgrade leaves the old hash valid and is retried at the next unlock. Verification always reads the stored count, so a hash is never checked at the wrong one.
- Unchanged: the Vault key derivation keeps its fixed 300000 (re-encrypting the Vault is a separate decision, only with a measured reason). Backups, the backup passkey (Decision 171), biometric unlock and the three-credential separation are untouched. Credential hashes are not in any backup (Decision 8), so no restore path reads or writes the new columns.
- Setting or removing a password or PIN writes or clears its count with the hash.
- Cost: one extra derivation at the first correct unlock after the update, once per credential, then every unlock and every confirmation takes about twice as long as before. On a desktop runtime the derivation is a fraction of a second; a phone is slower, to be measured (DP55).
- Why: both hashes are checked on the phone only, so this is not the exposure a backup file has, but the count was below current guidance and raising it needed no re-encryption.
- Risks: not run through CI or on a device. First unlock after the update for each credential, biometric unlock after it, and password or PIN change after it need a device check.

**173. Haptic feedback: tried, dropped (Phase 15, polish item 4).**
- Tried: `@capacitor/haptics` 6.0.3 with a Settings switch and a short vibration on save, delete, multi-select start and a wrong password or PIN. Three builds: the plugin's impact and notification patterns; one-shot lengths through `vibrate({ duration })`; the same lengths also through the web view's `navigator.vibrate`.
- Result on the owner's phone: no vibration at all in any build. The Test vibration button showed the plugin answering with no error (platform android, plugin present) and the web view accepting its call, so the request reached the system and was dropped there. Cause on the phone not found; the owner had checked the phone's vibration settings.
- Decision: dropped, as agreed beforehand (stop rule: no vibration on the third build). Removed: the dependency, `src/js/haptics.js`, the Settings row, every call site (`toastSaved` is gone, success toasts are plain `toast` again). The install-time VIBRATE permission leaves with the plugin.
- Not removed: a `haptics_enabled` row may remain in `meta` on a phone that ran those builds; nothing reads it.
- Revisit only with a phone where it works and a reason; a native `performHapticFeedback` route is the untried alternative.

**174. Vault batch numbering continues from the existing labels (Phase 8, part).**
- The Vault multi-select save (Image, PDF, Files) already offered one common name, numbered. It restarted at 1 on every batch, so a second batch named "Invoice" gave a second "Invoice 1". Home continues from the counter in `label_history` (Decision 84).
- The Vault keeps no plaintext label history (labels are encrypted, Decision 145), so none is added. The start is read from the in-memory Vault index: `nextBatchStart(entries, type, baseName)` in `src/js/batch-number.js` returns the highest N among labels exactly `<baseName> N` of the same type (N a plain positive integer of up to 9 digits), or 0. The batch then numbers from that value plus one.
- Counted: entries in the Vault index (not in the Vault Trash). A name that matches only as text (`Invoice 2b`, `Invoice 02`, `Old Invoice 40`) is ignored. Individual (keep each name) saves and single files are unchanged. Home is unchanged.
- Differs from Home: Home continues from how many times the base label was used; the Vault continues from the highest number present, so deleting the highest-numbered entry lets its number be used again.
- Risks: not run through CI or on a device (DP57).

**175. Reminder wording in a typed note is offered, not applied (Phase 9, confirmation item).**
- Cause: a note typed in the Home editor that contained "remind me" was converted to a reminder with no question (Decision 124 kept reminder text detection). The conversion dropped the tags and description set in the Save dialog, kept only the parsed words as the label, and ended with a "Note saved" toast.
- Rule: after the Save dialog, text that reads as a reminder with a time still ahead opens a Yes/No sheet: the parsed label and time, "Set reminder" or "Keep as note". Back or No keeps a plain note. A lock while the sheet is open saves nothing, as for the other capture dialogs.
- Differs from the plan in ARCHITECTURE §7 (auto-dismiss into the parsed default): an unanswered sheet would then create the entry nobody confirmed. The default is the note, the same as typing without the phrase.
- Reminder from the sheet: name, tags and description come from the Save dialog; when the description is empty and the name differs from the text, the typed text is stored as the description so it is not lost. Time and repeat are the parsed time and none; Reschedule in the viewer changes them. The toast shows the time and distance (Decision 95).
- Code: `reminderOffer(text, now)` in `intents.js` (parsed reminder with a future time, else null). `captureText` in `app.js` no longer detects anything; it makes a reminder only when called with `reminderAt`. The Vault note path never detected and is unchanged.
- Unchanged: the phrases and the time parsing, the Reminder card (Save dialog with its own time fields), notifications, Vault, backup.
- Risks: not run through CI or on a device (DP58). The sheet over the Save dialog and the lock-while-open path need a device check.

**176. Unsaved Home note text is kept as a draft (bug fix).**
- Cause (reported): text typed in the new-note editor was lost when the app or the phone screen locked. A lock closes the editor and returns nothing, and nothing had been written.
- Rule: while typing in the Home New note editor, the text is written to `meta.note_draft` (half a second after the last keystroke) and again when the editor closes for any reason except Yes on Discard. New note opens with the draft and a "Draft restored" toast; Back on a restored draft asks Discard, and Yes clears it. A successful save clears it.
- Privacy: the row sits in the encrypted database (Decision 158), behind the app lock like every note. It is not in `APP_SETTINGS_KEYS`, so no backup carries it. One draft only.
- Not covered, by choice: the Vault editor (a draft would need the Vault key, which a lock clears), and edits of an existing note (the saved text is still there).
- Risks: not run through CI or on a device (DP59).

**177. Autosave of unsaved work, stage 1: Text, new and edit, Home and Vault (new Phase 19).**
- Report: an edit of an already saved note lost the added text when the app locked; the Decision 176 draft covered only a new Home note. Owner request: unsaved work in Text, Voice, Reminder, Location and Money, Home and Vault, is saved as "Autosave <date time>" when the app locks, goes to the background or closes; an edit is saved onto its existing file. Built in stages: 1 Text, 2 Voice, 3 Reminder, Location, Money. This entry is stage 1.
- Rule: while a text editor is open, its text goes to a draft row in `meta` half a second after the last keystroke, when the app is hidden, and when the editor closes with unsaved changes by any route except Yes on Discard. A clean close or Yes on Discard clears the row. A successful save clears it.
- Commit: at the next app unlock, Home drafts are committed before the lists draw; at the next Vault unlock, Vault drafts are committed before the index is built. A new note becomes a note named `Autosave YYYY-MM-DD HH:MM`; an edit is written onto its entry (text only, name, tags and description unchanged); if the entry no longer exists the text becomes an Autosave note. A toast says so. A commit that fails leaves the row for the next unlock.
- Rows: `note_draft`, `note_edit_draft` (Home, in the encrypted database, Decision 158); `vault_note_draft`, `vault_edit_draft` (encrypted under the Vault key, no plain text). Edit rows hold the entry id and the text. None is in `APP_SETTINGS_KEYS`, so no backup carries them. One draft per row; a Vault draft made under another PIN is dropped.
- Supersedes the restore step of Decision 176: New note no longer reopens a draft, and the "Draft restored" toast is gone; the draft becomes an Autosave note at the next unlock instead.
- Timing: the entry appears at the next unlock, not at the moment of the lock; the Vault commits at the next Vault unlock. A kill of the app keeps the text stored up to half a second before it.
- Not covered in this stage: Voice, Reminder, Location, Money; edits of non-text entries.
- Risks: not run through CI or on a device (DP59). Lock paths, the Vault key at lock, and the commit before the first list draw need a device check.

**178. A note with reminder wording is always saved; a reminder is offered in addition (changes Decision 175).**
- Request: saving as a note and setting a reminder are both wanted, not one or the other.
- Rule: the note is saved first, with the name, tags and description from the Save dialog. If the text reads as a reminder with a time still ahead, a Yes/No sheet then asks "Also set a reminder?" (parsed label and time; "Set reminder too" or "Note only"). Yes adds a second entry, a reminder named with the parsed label, carrying the same tags, scheduled at the parsed time, no repeat. Back, No or a lock keeps the note only. The toast reads "Note saved · Reminder set for …".
- Changes from 175: the note is no longer replaced by the reminder, so the typed text is never lost and the description fallback is gone; a lock during the sheet no longer discards the text (the note is saved).
- Unchanged: the phrases, the time parsing, `reminderOffer`, the Reminder card, Vault.
- Risks: not run through CI or on a device (DP58).

**179. Autosave, stage 2: Voice, Home and Vault (Phase 19).**
- Rule: a take that is neither saved nor discarded by the person, because the app locked, went to the background or the recorder was closed by the system, is saved at once as a voice entry named `Autosave YYYY-MM-DD HH:MM`. Three states: recording (the recorder is stopped and the take kept), a finished take in review, and a take being finalised when the screen closes.
- Also covered: a take already sent to the Save dialog when a lock closes the dialog. Cancel, the Discard button and Yes at "Discard recording?" are explicit discards and save nothing. Save with a name saves as before.
- Vault: the Vault key is read before the lock clears it and passed to the save; the take is encrypted like any Vault voice entry. No Vault index refresh at that moment (it would rebuild a cache after the lock); the next Vault unlock builds it in full.
- Not covered: the app being killed while recording, or the phone powering off; that take is lost (the recorder holds the audio until stopped). The Autosave entry carries no tags or description.
- Risks: not run through CI or on a device (DP60). Whether the recorder stops and returns its data while the app is in the background after a lock is not verified.

**180. Home voice recording can keep running behind a lock (Phase 19, extends Decision 179).**
- Request: an option to keep a take recording in the background, enabled before or during a take, Home only.
- Switch: "Keep recording when the app locks or goes to the background", on the Home recorder screen only, `meta.rec_background`, off by default, changeable before and during a take. Not shown in the Vault recorder.
- Off: unchanged (Decision 179): a lock stops the take and keeps it as an Autosave entry.
- On: a lock, a background lock or an idle lock closes the recorder screen and the app locks as usual, but the take is not stopped; `bgRec` holds its start time. At the next unlock the recorder reopens on the running take (timer from the start time); Stop leads to the review and the Save dialog as before. Back with Yes at Discard still discards.
- Vault: not covered, by choice. A Vault take cannot continue behind a Vault lock without holding the key or plain audio in memory.
- Limits: if the app is killed while the take runs, it is lost, as in Decision 179. The whole take is returned as one base64 string at Stop, so a very long take is a memory risk; no cap is set yet and the safe length needs a device test. Whether the recorder keeps running behind a lock on the phone is not verified.
- Risks: not run through CI or on a device (DP61).

**181. Move between Home and Vault (new Phase 20, planned and approved, nothing built).**
- Request: a fifth row action, Move, before Delete: "Move to Vault" on Home rows, "Move to Home" on Vault rows. Order: Edit, Share, Download, Move, Delete.
- Home to Vault encrypts under the Vault key; Vault to Home decrypts. Name, tags (up to 2), description and date are carried.
- Order of steps: write the new entry, read it back and compare, and only then delete the original permanently (no Trash, no Undo). A failure at any step leaves the original untouched and removes any partial copy. Approved by the owner: the deletion happens only after the move succeeded.
- Moving into the Vault needs the Vault unlocked (the button leads to the PIN screen). Moving out makes name and text searchable in Home; the confirm sheet says both consequences plainly.
- Reminders are rescheduled on the other side (notification text `Vault Reminder` in the Vault, Decision 140). Large Vault files held as one block need a size check with a plain message instead of risking a crash; the cap needs a device test. Legacy expense rows get no Move.
- Build order: Text, Location, Money; Reminder; Image, PDF, Files, Voice with the size cap; Move for a selection. Each step needs a device check. Backup format unchanged.

**182. Move, step 1: Text, Location, Money (Phase 20, built).**
- `src/js/move.js`: `moveToVault(db, key, id)`, `moveToHome(db, key, id)`, `canMove(type)`. Order as in Decision 181: write the copy, read it back and compare (name, content, note, tags, created time), then `permanentlyDeleteEntry` on the original. Any failure removes the copy and leaves the original.
- The copy keeps the original's created and updated times (set after the insert).
- Home to Vault lowers the `label_history` count for the moved name by one, and removes the row at zero, so a Vault name does not stay as a Home suggestion (Decision 40). The Home search row goes with the original. Vault to Home is an ordinary Home insert: search row and suggestion count are added.
- Vault Location and Money keep their data in `encrypted_body` only; `latitude`, `longitude` and `money_json` stay empty on Vault rows and are filled on Home rows.
- Button: icon `i-move`, between Download and Delete, only for note, location and money, only on the Home and Vault folder lists. Not in search results, viewers or Select files (step 4). Legacy expense rows never show it.
- Locked Vault: Move on Home opens the Vault tab with a notice (PIN setup when no PIN is set). The move is not queued. A Vault lock while the sheet is open moves nothing.
- Known risk: `permanentlyDeleteEntry` removes the search row, then the tag links, then the entry. If the last step fails, the copy is removed and the original stays without its search row and tag links until it is edited.
- Risks: not run through CI or on a device (DP62). Reminder, Image, PDF, Files and Voice not covered (steps 2 and 3).

**183. Move, step 2: Reminder (Phase 20, built).**
- `move.js` carries a Reminder's `fire_at`, `repeat_rule`, `completed_at` and `snoozed_until` (plain columns on both sides, Decision 140) along with name, note, tags and times. A reminder with no time is refused.
- The Vault copy keeps an empty body; the note goes to the encrypted description as for any Vault Reminder.
- Notifications are handled in `app.js` (`rescheduleMovedReminder`), after the database move succeeded, because the copy has a new id: the old id's occurrences and snooze are cancelled, then the new entry is scheduled with its side's text (name on Home, `Vault Reminder` in the Vault). A pending snooze is scheduled again for its remaining time. A done reminder, or a one-off whose time has passed, schedules nothing.
- If cancelling or scheduling fails, the move stands and a notice says the notification could not be updated. The old notification is cancelled before the new one is scheduled so a name never shows on the lock screen after the move into the Vault.
- The confirm sheet adds one sentence about the notification text.
- Risks: notification behaviour, the remaining-time snooze and a repeat window after a restart are not verified (DP63). Not run through CI or on a device. Image, PDF, Files and Voice not covered (step 3).

**184. Move, step 3: Voice, Image, PDF, Files (Phase 20, built; no size cap).**
- Owner decision: no size cap and no size number. This replaces the size check named in Decision 181.
- `move.js` carries `file_path`/`file_key` (Home) or `fileData` (Vault), `extension`, `auto_category`, and for Image and PDF the OCR text (`body_text` on Home, `ocrText` in the Vault envelope).
- Home to Vault: the file is read whole (`readBytes`), turned into base64 and sealed in `encrypted_body`; `file_path` stays empty. Vault to Home: base64 written through `saveBase64` (per-file encryption, Decision 161), then the row is inserted. In both directions the copy is read back and compared byte for byte (Vault side: the stored base64) before the original is deleted; the original's file goes with it (`permanentlyDeleteEntry`).
- A failure removes the copy, including a Home file written before its row existed.
- Order protects the data when memory runs out: the copy is written first, so a crash leaves the original, at most with an extra copy on the other side. A crash cannot be caught or turned into a message.
- `moveBusy` stops a second move starting during a long one; file kinds show a `Moving…` notice.
- Risks: a very large file may exhaust memory and close the app (several copies of the bytes exist at once). Not run through CI or on a device (DP64). Move for a selection not covered (step 4).

**185. Move, step 4: Move for a selection (Phase 20, built).**
- Select files bar: an icon (`sel-move`, `i-move`) before Delete. Its tooltip follows the screen the selection started on: Move to Vault (Home, search results) or Move to Home (Vault).
- One sheet states the count and the same consequences as a single move (permanent, not the trash, reminder notification text). Cancel changes nothing.
- Items move one at a time, in the order selected, each through `moveToVault` or `moveToHome`. A failure leaves that item where it was and the rest go on; one notice gives moved, not moved (with the first reason) and cannot-be-moved counts. Items of a type Move does not cover (legacy expenses) are left in place and counted.
- Progress is a `Moving i of N…` notice. `moveBusy` stops a second move starting meanwhile.
- Vault locked on Home: the selection ends and the Vault tab opens with a notice; nothing is queued. The Vault key is read after the sheet; a lock meanwhile moves nothing. A lock during the run does not stop the run.
- The Vault index is refreshed once at the end for the entries that changed. Reminders are rescheduled per item (Decision 183).
- No undo: moves are permanent (Decision 181).
- Risks: one more icon in the bar leaves less room for the selected count on a narrow phone. A large selection of files takes as long as its files add up to; the app is not closed meanwhile. Not run through CI or on a device (DP65). The handler is not covered by the Node checks; `move.js` is.

**186. Move with a locked Vault unlocks in place (replaces the locked-Vault behaviour of Decisions 182 and 185).**
- Move to Vault, single or from a selection, no longer sends the person to the Vault tab. `unlockVaultInPlace` asks over the current page: the OS biometric prompt when the Vault biometric is enabled and available, then a PIN sheet (password field, Unlock, Cancel). A wrong PIN shows the sheet again with a notice; Cancel moves nothing.
- It uses the same checks as the Vault gate (`unlockVault`, `tryBiometricUnlockVault`): same PIN check, hash upgrade, draft commit and index build. No new stored value; the PIN typed in the sheet is cleared when the sheet closes, and an app lock closes the sheet.
- After a successful unlock the page, open folder and selection are unchanged; the Move sheet follows. The Vault stays unlocked under its usual idle and background locks, as after unlocking from the Vault tab.
- No PIN set: a notice says to set the Vault up in the Vault tab; nothing opens.
- A second unlock request while one is open is ignored.
- Risks: the biometric prompt is not wrapped in the picker-return flag (it is a dialog, not an activity pause), as in the Vault tab; not run through CI or on a device (DP65). The app-lock, background and screen-off locks during the sheet are not exercised by Node checks.

**187. Old workflow runs are deleted automatically; the latest 3 stay.**
- `.github/workflows/cleanup-runs.yml`: manual only (`workflow_dispatch`); no automatic trigger, because a job bills at least a minute on a private repo. It lists completed runs, groups them by workflow, keeps the newest 3 of each and deletes the rest. Its own runs are kept to 3 the same way.
- Queued and running runs are never listed, so never deleted. Deleting a run removes its logs and artifacts (the workflow artifact APK of that run); GitHub Releases and their APK assets stay, so the in-app update check (Decisions 72, 164) is unaffected.
- Permissions: `actions: write`, `contents: read`. Uses the built-in workflow token; no stored secret.
- Run it from the Actions tab whenever the list grows; the first run clears the existing backlog.
- Confirmed on GitHub: a manual run left 3 builds. A run deleted by mistake cannot be restored; the count of 3 is the `KEEP` value in the file.

**188. Move: confirm first, then unlock; locked state and missing set-up shown in sheets.**
- Replaces the order in Decision 186. The Move sheet comes first; the unlock (biometric when enabled, then the PIN sheet) follows only after the person confirms. Cancelling the Move sheet leaves a locked Vault locked.
- With the Vault locked the Move sheet adds one sentence saying so, and its button reads `Unlock and move`. The PIN sheet names the move (`Enter your Vault PIN to move 3 items.`).
- A Vault with no PIN: a sheet `Set up the Vault first` with `Open Vault` / `Close` replaces the notice; Open Vault ends a selection first, then opens the Vault tab.
- A lock that happens while the Move sheet is open is handled by asking for the unlock afterwards; a lock during the move itself is as before.
- Risks: not run through CI or on a device (DP65); the PIN-only path is the untested one.

**189. Autosave stage 3: Reminder, Location and Money, new entries, Home and Vault (Phase 19).**
- Rule: while a Reminder Save dialog, a Money form and its Save dialog, or a Location paste dialog, GPS fix and Save dialog is open, the raw fields of each dialog go to one `meta` row per kind half a second after the last change, when the app is hidden, and when a lock closes it. A row is written only when a field differs from the first state of the flow (a GPS fix counts as a difference); a flow that returns to its first state removes its row. Back between the Money form and its Save dialog, or between the paste dialog and its Save dialog, keeps the fields. Save, a discard, and Cancel clear the row; a lock keeps it.
- Commit: at the next app unlock (Home) and Vault unlock (Vault), after the text drafts and before the lists draw. A complete form becomes its entry: Reminder needs a readable time; Location needs a GPS fix or coordinates that parse; Money needs an amount that parses and details that normalize. The name is what the person had typed, else `Autosave YYYY-MM-DD HH:MM`; tags (up to two) and note are kept. An incomplete form becomes a Text entry named `Autosave YYYY-MM-DD HH:MM` listing only the filled-in fields (`Kind: Spent`, `Category: Food`). Nothing filled in: the row is dropped. A toast says so.
- A committed reminder is not scheduled: no notification is created at commit. The toast says so.
- Rows: `form_draft_reminder`, `form_draft_location`, `form_draft_money` (Home, encrypted database, Decision 158); `vault_form_draft_<kind>` (encrypted under the Vault key; the Vault key is read before the first await, as in Decision 177). None is in `APP_SETTINGS_KEYS`, so no backup carries them. One draft per row; a Vault row made under another PIN is dropped; a row that cannot be committed stays for the next unlock.
- Code: `src/js/autosave.js` (`parseFormDraft`, `resolveFormDraft`, pure); `formDraft`, `commitFormDrafts` and the lock and hide flush in `app.js`; `draft` option on `openSaveDialog`, `openCoordsDialog` and `openMoneyForm`. `dismissOverlays` flushes before it closes dialogs and marks the draft locked.
- Not covered: edits of Reminder, Location and Money entries (Decision 177 left edits of non-text entries out; they are the open part of this stage); Voice is Decision 179.
- Risks: not run through CI or on a device (DP66). Lock paths, the Vault key at lock, the date and time pickers raising change events, and the commit before the first list draw need a device check. A committed reminder sits in the Reminders folder without a notification.

**190. Autosave stage 4: edits of Reminder, Location and Money, Home and Vault (Phase 19).**
- Rule as Decision 189, for the edit of an existing entry: Reminder Edit and Location Edit details (the Save dialog), and Money Edit (form, then Save dialog). Rows: `form_edit_draft_<kind>` (Home) and `vault_form_edit_draft_<kind>` (encrypted under the Vault key). Each carries the entry's id and name next to the fields. Voice, Image, PDF and Files Edit details are not covered. Not in backups.
- Commit, at the same unlocks and after the new-entry drafts: a complete form is written onto its entry with `editEntry`, then the tags. A cleared name keeps the entry's own. A reminder follows the Save rules of `editEntryUI`: a changed time or repeat reopens a finished reminder; an active reminder is rescheduled; a finished one with an unchanged time is left alone. A time within the same minute as the stored one counts as unchanged, because the picker holds whole minutes. The toast says `saved to its entry`.
- A reminder edit is rescheduled, unlike a new autosaved reminder (Decision 189): leaving the old notification pending would contradict the stored time. The reschedule runs after the write, on its own: a future time or a repeating reminder is scheduled; a time already past, or a finished reminder, has its notification cancelled instead (scheduling a past time would fire at once). A failure does not keep the row: the edit stays written, the row is cleared, and the toast says a reminder could not be rescheduled and to save it again.
- An incomplete form (Money without a readable amount or date, Reminder without a readable time) becomes a Text entry `Autosave YYYY-MM-DD HH:MM` headed `<Kind> edit (not finished)`, then `Entry: <name>` and the filled-in fields; the entry is left as it was. An entry that no longer exists, or whose type changed, gets the same note headed `(entry not found)`. A row that cannot be committed stays for the next unlock.
- Code: `resolveFormDraft` takes `edit`, `forceNote`, `noteName` and `entryLabel`; `formDraft(kind, isVault, entry)`, `applyEditDraft` and the second pass of `commitFormDrafts` in `app.js`; `editEntryUI` and `editMoney` hold the draft until the save succeeds.
- Risks: not run through CI or on a device (DP67). The reschedule at unlock, a Vault reminder rescheduled before the Vault index is built, and the same lock and picker points as Decision 189 need a device check.

**191. Redraw of the lists after a committed draft (Phase 19).**
- Cause (DP67): drafts are committed at unlock, but lists drawn before the lock were not redrawn, so rows showed their old data until opened. Text and Voice autosaves (Decisions 177, 179) had the same gap.
- Rule: an unlock that commits at least one draft dispatches `arkly-drafts-committed`. Home: after the commit in `onUnlocked`. Vault: after the Vault index is built, because the redraw reads it. The listener redraws the Home lists and totals and, with the Vault unlocked, the Vault lists (the `arkly-data-restored` handler). An unlock that commits nothing dispatches nothing.
- Risks: not run through CI or on a device (DP68).

**192. OCR dropped from the app (Phase 5).**
- Rule: no text recognition of images or PDFs. No ML Kit, no `tesseract.js`, no native plugin, no bundled language data. Extends Decision 152, which excluded OCR of scanned PDFs.
- Cause: owner decision after the two routes were compared. ML Kit needs a custom native plugin and Gradle edits through CI scripts. `tesseract.js` adds an estimated 5 to 15 MB to the APK and is slow on large PDFs. Neither was judged worth it.
- Effect: images and PDFs are found by label and tags only; `body_text` stays NULL for them on Home. The Phase 8 label pre-fill from recognized text is dropped; `suggestLabel()` has no input and is unused. Phase 5 stays partial: noise-reduction toggle and notification sound asset remain.
- Kept as is: the `body_text` column, the Vault `ocrText` envelope field, the `o` field of `encrypted_meta` (Decision 156) and their carrying in Move (Decision 184). All hold empty values; removing them would rewrite confirmed code for no gain.
- Stale in code, not changed: the comment in `captureFile` (`app.js`), `suggestLabel()` and its import. Cleanup is optional and not scheduled.
- Risks: docs only; no code changed.

**193. Vault Trash no longer loads file bytes (bug fix).**
- Report: opening the Vault Trash showed no files, then the app stopped.
- Cause (likely; no device log yet): `listTrash` ran `SELECT *`, so every trashed Vault file came across the bridge with its whole `encrypted_body` (the file as base64). Vault files have no `file_path`; their bytes are in that column. The same load that Decision 156 removed from the Vault index. `restoreFromTrash` also read the whole row to check for a reminder.
- Fix: for the Vault, `listTrash` selects only `id, type, label, encrypted_label, extension, auto_category, created_at, deleted_at, is_private`, which is all the trash rows and `vaultRowLabel` use. Home keeps `SELECT *` (Home file bytes are on disk, not in the row). `restoreFromTrash` reads `type` first and the whole row only for a reminder.
- Why correct: the trash list never needed the body; a Vault row's size no longer affects the list.
- Risks: not run through CI or on a device (DP69). If the crash remains, the cause is elsewhere and needs the device log.

**194. Vault tab closes Trash and Settings (bug fix).**
- Report: Vault Trash drew under the landing tiles instead of as its own view.
- Cause (likely; the exact tap sequence was not reported): the Vault tab handler called `closeVaultFolder()`, which un-hides the card grid, but left Vault Trash and Vault Settings open. Tapping the Vault tab, or leaving to Home and returning, while either was open showed the grid and that view together.
- Fix: the tab handler closes Trash first and Settings through `leaveIfClean` (the PIN confirm field asks before discarding), then the folder. The Vault tab lands on the card grid, as the Home tab does (Decision 81).
- Why correct: all three Vault views are closed by the one entry point that shows the grid.
- Risks: not run through CI or on a device (DP70). If the overlap shows on a plain tap of the Trash tile, the cause is elsewhere.

**195. Vault key hierarchy and speed (Phase 17 L to O): plan, nothing built.** Replaces the open "PBKDF2 count for the Vault key" item. Owner: no Vault data and no old backups to keep, so no migration and no support for the old format. Goal: Vault unlock, open, search and Trash cost independent of file size and count, with the PIN still the only way to the key (Decision 144).
- L. Key. A random 256-bit Vault master key (VMK), stored only wrapped (AES-GCM) under a key derived from the PIN: PBKDF2 SHA-256 at 600000, the count stored beside the wrapper and raised after a correct unlock as in Decision 172.
  - A wrong PIN fails the unwrap. The separate `private_pin_hash` verify and the second derivation at 300000 go away: unlock is one PBKDF2 (today 600000 plus 300000). A PIN change re-wraps the VMK only.
  - First unlock with no wrapper: an empty Vault creates and wraps the VMK; a Vault holding an old-format entry stops with a message and changes nothing.
  - The VMK is in memory only while unlocked. Entry fields are encrypted under it with the entry id and field name as additional data, so a ciphertext moved to another row or field fails.
  - Biometric (Decision 50): the Keystore copy holds the VMK instead of the PIN, so a biometric unlock runs no PBKDF2. Cleared on a PIN change or when biometric is turned off, as today. Exposure is the same as the stored PIN: both open the Vault to code running as the app.
- M. Vault files on disk in the Home format (Decision 161): random name, no extension, 1 MiB chunks, random per-file key wrapped under the VMK in `entries.file_key`; `encrypted_body` stays NULL for voice, image, pdf and file. Delete removes the file; the existing orphan sweep covers both. Move between Home and Vault (Decision 184) re-wraps the file key and copies no bytes.
- N. Index and search.
  - One encrypted index blob (VMK) holds, per entry: id, type, normalized label, tags, dates, size, extension. It is read and decrypted once at unlock and written through on each change, debounced.
  - Rows stay the source of truth: a missing, stale or failing blob is rebuilt from them.
  - Name search scans the normalized strings in memory (lowercase, accents folded; label, tags, extension), label ranked above tag, for notes and every file type.
  - Body search: note text sits in a second encrypted blob, decrypted on the first body search of an unlock and held until lock. Label and tag matches show first. Unlock never waits for it.
  - Thumbnails are small encrypted files with random names, made at capture and decrypted only for visible tiles. Vault Trash lists from the index.
- O. Backup and restore. The archive stays under the backup passkey (Decision 159) and carries the wrapped VMK with its salt and count, so a restore on another phone needs the old PIN, as now. Append unwraps with the old PIN and re-wraps entries under the current VMK; overwrite replaces the wrapper. Archives from before this plan are refused with a plain message. Append default and the safety-backup rule unchanged.
- The three credentials stay independent. Keystore keys are never in a backup.
- Measured on a phone at each stage: unlock at 0, 500 and 5000 items with 20 MB files; Vault Trash; name search; first body search.
- Open: a minimum length for the Vault PIN. At 600000 a 4-digit PIN still falls offline in minutes; the warning of Decision 170 is advisory.
- Risks: rewrites the Vault read and write paths and the backup format. Each stage needs approval and a device pass before the next.

**196. Vault key wrapper built (Phase 17 L).** Carries out stage L of Decision 195.
- `crypto.js`: `createVaultWrap`, `wrapVmk`, `unwrapVault`, `vmkMatchesWrap`, `vmkToKey`. The wrapper is JSON in `credentials.vault_wrap`: salt, count (600000), IV, the wrapped key (AES-GCM, fixed additional data) and `kcv`, a check value of the key.
- Unlock: the PIN unwraps the key (one PBKDF2). No PIN hash is stored or compared; a wrong PIN fails the unwrap. A wrapper at a lower count is re-made after a correct unlock.
- Biometric: the Keystore copy is `vmk1:` plus the Vault key. Unlock checks it against `kcv`, then runs no PBKDF2. A stored PIN from before this decision, or a key that fails the check, is cleared and the PIN sheet follows. Enabling needs the PIN once.
- Set-up: `setupVaultPin` makes the key and wrapper and writes NULL to the three old PIN columns. It stops with a message, changing nothing, if any Vault row exists. First-run set-up does the same when a PIN is entered. A phone with a PIN from before this build shows "Create your Vault" once.
- Backup: the archive carries `privateVaultWrap` in place of `privateVaultSalt`. Append unwraps the source key with the old PIN and re-encrypts under the current key as before. An archive with Vault items and no wrapper is refused with a plain message; a wrong PIN is reported as one.
- Not in this stage: binding each encrypted field to its entry id and field name (moved to N, where entry writes are reworked); a PIN-change screen (none exists, so `wrapVmk` is only used for the upgrade); files on disk, the index blob and thumbnails (M, N); backup format rules beyond the above (O).
- Checks: 14 Node checks on the wrapper (right and wrong PIN, empty PIN, tampered and unreadable wrapper, unknown version, check value, round trip under the unwrapped key, key not extractable, new wrap each time, re-wrap); `vite build` passes. One unwrap took 95 ms on a desktop; not measured on a phone.
- Risks: not run through CI or on a device (DP71). Credentials and backup paths changed together; Vault backup and restore are untested on a device.

**197. Vault set-up asks before erasing old rows (bug fix).**
- Report: Vault set-up showed "This Vault holds items from an earlier format. Nothing was changed." and never completed.
- Cause: Decision 196 stops set-up when any Vault row exists. Trashed Vault items from earlier testing were still stored, and the new key cannot open them. The message gave no way forward.
- Fix: `setupVaultPin` returns the row count; set-up then asks "Erase old Vault items?", stating the count, that Vault Trash is included, and that erasing is permanent. On Erase and continue it cancels each old reminder, deletes each row through `permanentlyDeleteEntry`, deletes the Vault drafts in `meta` (`vault_%draft%`, which the new key cannot open), then creates the new Vault. Cancel changes nothing.
- Why correct: nothing is deleted without the person confirming the consequence; the rows could never be read by the new key.
- Checks: the draft-cleanup SQL run on SQLite (removes `vault_note_draft`, `vault_edit_draft`, `vault_form_draft_*`; keeps `note_draft` and `vault_autolock`); `vite build` passes. Not run through CI or on a device (DP71).

**198. The lock screen reads the stored credentials on every attempt (bug fix).**
- Report: after the app locked, neither the correct password nor a successful biometric opened Home. A cold start with the password worked.
- Cause (likely; not reproduced): `attemptUnlock` verified against the hash, salt and count captured when `showLockScreen()` ran at start-up. An auto-lock or background lock only shows the lock screen and reuses that function, so a password or biometric changed since start-up was checked against the old hash. A biometric unlock hands the new password to the same function and failed the same way.
- Fix: `attemptUnlock` selects the three values from `credentials` on each attempt. If the password was removed meanwhile it unlocks. Hash upgrade (Decision 172) now works from the same fresh values.
- Why correct: one source of truth, the stored row; cold start and later locks verify the same way.
- Risks: not run through CI or on a device (DP72). If it still fails with no password change since start-up, the cause is elsewhere and the screen state at that moment is needed.

**199. Password management and backup authorization (Phase 21): plan, nothing built.** Requested by the owner: set, show, change and remove passwords; password-gated backups; a saved passkey for automatic backups.
- Show/hide (P1): an eye control on every password input (set-up, change, backup and restore passkey, confirm). The lock screen keeps its input as is.
- Set, change, remove (P2):
  - Either secret can be set later in Settings if it was skipped. Home means the app-open password; the Vault has its own PIN. They stay independent (Decision 144).
  - Change or remove needs the current secret or a biometric check first. Changing the app password re-hashes it. Changing the Vault PIN re-wraps the Vault key (Decision 195): with the current PIN it unwraps first; with biometric the key is already held, so the old PIN is not needed.
  - Only the app-open password can be removed (quick access). The Vault PIN cannot: it is what wraps the Vault key.
  - A change clears that secret's stored biometric copy, as in Decision 50; biometric is turned on again afterwards.
- Backup authorization (P3):
  - Before a manual backup the app asks for the app password if one is set, and the Vault PIN if the Vault is included, or one biometric check instead of both. Password entries are separate for Home and Vault; one biometric covers both.
  - This is a gate on the in-app action, not a key: the archive stays encrypted under the backup passkey (Decision 159), asked for as now. The three credentials stay independent; the gate verifies and recovers nothing.
  - It stops someone using the open app to export. It does not protect data from anyone who copies the phone's storage; that is the database and file encryption (Decisions 158, 161, 195).
- Automatic backup (P4):
  - An unattended run cannot ask for anything, so the check applies when automatic backup is turned on and whenever its schedule, target or passkey changes.
  - A saved passkey for automatic runs conflicts with the rule that the backup passkey is never stored (ARCHITECTURE section 3, Decisions 25 to 29, 171). Proposed: kept only in Keystore-backed storage, never in the database, a backup or the cloud; the person chooses it once and needs it to restore anywhere else. Not built until the owner approves the change to that rule.
  - Phone storage and Google Drive use the same saved passkey and the same check.
- Open: approval of the stored automatic-backup passkey; whether it is chosen by the person (proposed) or generated and shown once.
- Risks: touches Credentials and Backup and Restore. Each stage is checked against those sections first and device-tested before the next.

**200. Show/hide control on password fields (Phase 21 P1).** Carries out P1 of Decision 199.
- `src/js/passeye.js`: each `input[type=password]` is wrapped once in `.pw-field` with an eye button after it. Fields added later are wrapped by a `MutationObserver`. The input's margins move to the wrapper so the button centres on the input.
- Excluded: the lock screen input (`data-no-eye`), as planned. Included: set-up, change and confirm fields, backup and restore passkeys, the update token, the PDF password prompt, and the shared single-field text sheet when it asks for a secret (`setPasswordField`).
- A revealed field is hidden again by `clearSecretInputs` (lock and unlock), when the text sheet closes, and when the app leaves the foreground.
- Revealing sets `type` to `text`, so `clearSecretInputs` now also selects `input[data-pw]`. Without that a revealed field would keep its text after a lock (Decision 94).
- Pure display. No credential, hash, key, storage or backup code changed. The button keeps focus where it was, so the keyboard stays up.
- Autocapitalize, autocorrect and spellcheck are switched off on wrapped fields.
- Checks: 18 Node checks on a DOM stub (wrap once, lock input untouched, show and hide, icon and label, selector still finds a revealed field, hide all and hide a list, field added later, shared field on, off and reused, hidden on background); `vite build` passes.
- Risks: not run through CI or on a device (DP73). Layout of each field is unverified on a phone. A keyboard may still offer the revealed text as a suggestion.

**201. Set, change and remove secrets from Settings (Phase 21 P2).** Carries out P2 of Decision 199.
- App lock tile: Set password (when none), Change password and Remove password (when set). Vault Settings: Change Vault PIN. The Vault PIN is first set in the Vault tab, unchanged. The Vault PIN cannot be removed: it wraps the Vault key.
- A change or removal needs the current secret first: one biometric prompt when that unlock is on, otherwise the typed secret. A wrong secret is refused. Setting a password when none exists needs no check.
- New secret: typed twice, weak-secret advisory (Decision 170), optional hint. Cancel or mismatch at any step changes nothing.
- App password: `setAppPassword` and `removeAppPassword` as before. Both clear the stored biometric copy (Decision 50). Remove asks Remove or Keep with the consequence stated. The idle timer and the Lock button follow the new state.
- Vault PIN: the Vault key comes from the current PIN or from the biometric copy, is wrapped under the new PIN, and replaces `vault_wrap` only if it still equals the one read. No item is re-encrypted. The biometric copy is cleared. A backup made earlier still needs the PIN it was made with (Decision 196).
- The three credentials stay independent. The backup passkey is not touched. Nothing is stored beyond the existing hash, wrapper and hints.
- Checks: 31 Node checks on the real crypto with a stub database and sheets (set, mismatch, empty, cancel at each step, weak refused and accepted, wrong and right current secret, biometric path and its fallback, remove and keep, Vault PIN change keeps the same key, old PIN fails, update guard, no Vault); `vite build` passes.
- Risks: not run through CI or on a device (DP74). The biometric prompt inside a change is untested natively. A failure inside any flow shows "That did not work. Nothing was changed."

**202. Manual backup authorization (Phase 21 P3).** Carries out P3 of Decision 199.
- `confirmBackupAccess(categories)` runs before Back up now (Settings) and Back up to Drive, after the passkey and category checks and before the weak-passkey advisory and any storage work. A refusal stops the backup with a status line.
- Asked: the app password if one is set; the Vault PIN if the Vault is set up and the Private Vault category is included. Neither applies: no prompt.
- One biometric prompt replaces the typed entries: the app copy when a password is set and its unlock is on, otherwise the Vault copy when the Vault is needed and its unlock is on. A verified prompt covers both gates (as planned in Decision 199); the two typed entries stay separate. Cancel or a failed prompt falls back to typing.
- A gate on the in-app action, not a key: the archive stays encrypted under the backup passkey, asked as before (Decision 159). Nothing is stored, changed or recovered; the three credentials stay independent.
- Not gated: restore, the safety backup before an overwrite restore, the automatic backup (P4), extract to device storage.
- Limits: it does not protect data from anyone who copies the phone's storage; that is the database and file encryption. Typed attempts have no counter or delay; the lock screen has none either.
- Checks: 45 Node checks (31 from Decision 201 plus the gate: nothing set, app password right, wrong and cancelled, Vault excluded, not set up, Vault PIN right and wrong, both typed, one biometric covers both, bad biometric falls back, Vault biometric alone, biometric cancelled); `vite build` passes.
- Risks: not run through CI or on a device (DP75). The biometric prompt is untested natively.

**203. Lock-screen fingerprint button follows stored state (bug fix).** Reported: Home fingerprint fails while the typed password works; Vault fingerprint works.
- Cause: `biometricUnlockAvailable` and the lock screen button were set once at start-up. Changing or removing the app password, or turning its fingerprint off, in the same session clears the stored copy (Decision 50) but left the button; a tap read a copy that no longer existed and showed the failure line. The Vault has no such button, so it was unaffected. Inferred from the code; not reproduced on a device.
- Fix: `syncLockBiometric` re-reads the password, the fingerprint flag and the sensor, then sets the flag and the button. It runs at start-up and after every enable and disable; set, change and remove password reach it through disable.
- Second defect, same area: `attemptUnlock` was defined only after the quick-access and first-run returns in `showLockScreen`, so a password set in Settings during a quick-access session left the lock screen with no unlock function until restart. It is now defined first.
- Why correct: the button state is derived from the same stored values the unlock path reads, at the moment they change.
- Plaintext and wrapper paths are unchanged. The plugin stores each secret under its own name, so the same password for Home and Vault cannot collide.
- Checks: 5 Node checks (off at start, shown after enabling, hidden after disabling, no password, sensor unavailable); the 45 earlier checks still pass; `vite build` passes.
- Risks: not run through CI or on a device (DP76).

**204. One window for each secret change and for the backup gate; fingerprint is a choice (Phase 21 P2 and P3 redesign).** Requested by the owner. Replaces the sequence of separate sheets and the automatic fingerprint prompt of Decisions 201 and 202; their rules otherwise stand.
- `openSecretForm`: one window with labelled fields, an inline message line, an optional "Use fingerprint instead" button, Submit and Cancel. A wrong or mismatched entry is shown in the window, which stays open. It shares the text sheet's slot, so Back and every lock close it and clear the typed values.
- Change password: Current password, New password, Repeat new password, Hint (optional). Change Vault PIN: the same with the PIN. Remove password: Current password only. Set password: the three new-secret fields.
- Fingerprint never runs unless the button is tapped. The button appears only when that unlock is on and the sensor is available. After it confirms, the current field is hidden and the rest of the window is completed and submitted as before. A failed fingerprint shows a message; typing still works.
- Backup gate: App lock password if one is set, Vault PIN if the Vault is set up and included (labelled Vault PIN, as everywhere else in the app), one Submit. Only the Vault field when no app password is set. The fingerprint button, when offered, closes the window and covers both. A wrong entry names which one.
- There is no stored backup passkey to change: it is typed at each backup. The weak-passkey advisory and the passkey step are unchanged.
- The weak-secret advisory (Decision 170) appears over the window; declining keeps the window open and saves nothing.
- Unchanged: the three credentials stay independent; the gate is not a key; a change clears that secret's fingerprint copy (Decision 50); the Vault PIN re-wraps the Vault key only (Decision 195); `vault_wrap` is replaced only if it still equals the one read.
- Checks: 38 Node checks on the flows against the real crypto (each flow in one window, current secret wrong and right, fingerprint offered but never run unless chosen, fingerprint then new secret, bad fingerprint falls back, remove, Vault PIN keeps the same key, update guard, gate with both, one or neither field, one fingerprint covers both); 14 jsdom checks on the window itself (open, error stays open, success clears, fingerprint hides the current field, lock clears, second window refused, exception message, buttons usable again); 5 earlier checks on the lock screen button; `vite build` passes.
- Risks: not run through CI or on a device (DP74, DP75). Window layout on a phone is unverified. The fingerprint prompt is untested natively.

**205. Fingerprint offered again when the app returns to a lock screen (bug fix).** Reported: after the screen locks and the app is reopened, no fingerprint is offered.
- Cause: the automatic prompt ran once, from the load handler. A lock on screen-off or backgrounding shows the lock screen without it, and nothing ran when the app came back to the front. The button was set once at start-up as well (Decision 203).
- Fix: on `appStateChange` to active with the lock screen showing, `offerLockBiometric` re-reads the stored state (`syncLockBiometric`, which also sets the button) and opens the prompt after a short delay for window focus. No automatic prompt on an idle lock while the app stays in front; the button is there.
- Loop guard: the fingerprint screen is its own Activity, so opening and closing it pauses and resumes the app. `tryBiometricUnlockApp` holds a busy flag while it runs and a two-second cooldown after it, so that resume, and a cancel, never reopen the prompt.
- The typed password path and the credential logic are unchanged.
- Checks: 8 Node checks (resume offers it, resume right after the prompt does not, fingerprint off, lock screen gone before the delay ends, a later resume offers again, resume during an open prompt, no loop after a cancel); the earlier suites still pass; `vite build` passes.
- Risks: not run through CI or on a device (DP77). The cooldown length is an estimate, not a measured value.

**206. File explorer card: Home and Vault, nine cards, three per row (Phase 22, stage E0).** Requested by the owner.
- Built: a ninth card, "File explorer", after Files in both the Home and the Vault grids. Both grids are three columns; each card is icon above label, the count badge on the card's corner. Own tone (slate). The card carries `data-tool` (Home) or `data-vault-tool` (Vault), not `data-type`, so folder opening, counts, the New chooser, search and Move are untouched. The New chooser keeps two columns and its eight types. Tapping the card says it is not built yet.
- Requirement as stated: works like a file manager app, independent of the entries, with built-in viewers and editors: text viewer and editor, docx, xlsx and pptx viewers, audio and video player.
- Not built, not approved: browsing and the viewers (Phase 22, E1 to E4 in ROADMAP). Needs decisions first:
  - Storage access. Browsing the whole phone needs All files access: a manifest permission added by `scripts/patch-manifest.js`, a system screen the person grants once, and a small native bridge applied by CI (the pattern of native-setup section 14). The alternative is Android's folder picker: one folder granted at a time, no broad permission, a less fluid explorer. Sideload only; a Play Store release would need a permission declaration.
  - Vault. Phone storage cannot be encrypted by the Vault. Proposal: the Vault card browses the Vault's own encrypted files as folders, with import from the phone and export to it; opened files follow Decision 118's cache hygiene.
  - Viewers. Text, image and PDF use code already in the app. Audio and video use what the WebView plays; other formats go to another app. docx, xlsx and pptx need bundled libraries, view only, pinned and offline; each adds to the APK size.
  - Delete. Deleting on the phone is permanent unless a trash is added; the dialog states it.
- Privacy: everything stays on the phone; no network, no account, no telemetry. The explorer reads files the person navigates to and copies none of them anywhere unless asked.
- Checks: `vite build` passes; the other suites are unaffected. Layout on a phone is unverified.
- Risks: not run through CI or on a device (DP78). A third-width card has little room: the label is one line with an ellipsis.

**207. File explorer: approvals and stage E1a (Phase 22).** Owner decisions on Decision 206's open points, then the browse stage.
- Approved: (1) All files access. (2) The Vault card opens the same explorer, with the same unencrypted access to the phone's storage, plus removable storage and USB drives over OTG when connected. It is an entry behind the Vault lock, not a protected area: nothing the explorer shows or opens is encrypted or kept by the Vault, and a Vault lock closes the screen. (3) Bundled libraries for the office viewers. (4) A separate trash inside the explorer for deletes.
- Built (E1a): `explorer.js` and the screen. Storage list with free space and a USB tag, quick access, folder listing with breadcrumbs, sort by name, date or size (folders first, natural order), hidden-file toggle, filter by name, refresh. File names are rendered as text, never as markup. A file opens in another app through the existing file opener.
- Native bridge: `scripts/patch-explorer.js` writes `ArklyExplorerBridge.java` and registers it in `MainActivity.onCreate()` as `window.ArklyExplorer` (a WebView JavaScript interface, the no-plugin route of Decision 74). It answers: is All files access granted, open Android's settings screen for it, and which volumes are mounted. The CI step runs right after `patch-screenlock.js`. `patch-manifest.js` adds `MANAGE_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`. Android 11 and later: the person grants it once on a system screen. Earlier: the two storage permissions are asked at runtime.
- Folder listing uses the filesystem plugin with a percent-encoded `file://` path, which reads any path once access is granted. Removable volumes come from the storage manager (Android 11 and later) or the app's external directories (earlier).
- Lock: the app's lock on background is skipped once for the trip to Android's settings or another app (the picker flag of Decision 73), so granting access or opening a file does not lock the app. An app lock closes the screen from either card; a Vault lock closes the one opened from the Vault. The listing is dropped when the screen closes.
- Delete (E2): files go to a trash folder on the same storage, with a record of the original place; restore, empty and a 30-day purge. A delete never crosses storages, so it is a rename, not a copy.
- Plan: E1b built-in viewers; E2 manage and trash; E3 office viewers. Each device-tested before the next.
- Checks: 31 Node checks on the screen and its helpers against a stub filesystem (listing, sorting, filtering, hidden toggle, breadcrumbs, Back, volumes, USB name with a percent sign, drive removed, open file, lock closes and clears); the manifest and MainActivity patches run twice on a stub Android tree (idempotent) and both Java files parse; `vite build` passes.
- Risks: not run through CI or on a device (DP79). The Java is not compiled here, only parsed, so a symbol error would show first in CI. Opening a file on a USB drive in another app goes through the app's file provider, which may not cover removable volumes; the built-in viewers (E1b) read the file directly and avoid this. Whether Android lists a USB drive through the storage manager on every phone is unverified. Quick-access folders are tried when tapped; a missing one shows the folder error.

**208. Card order and the Notes label (Home and Vault).** Requested by the owner.
- Order, both grids: Voice, Notes, Image / Location, Reminder, PDF / Money, File explorer, Files.
- The Text card is labelled Notes, and its folder heading follows (`FOLDER_TITLES`). Item default names, type chips and the New chooser keep "Text": they name the kind of item, not the folder.
- Display only: types, folder opening, counts and Move are unchanged.
- Checks: `vite build` passes; card order and labels read back from the markup for both grids. Not device-tested (DP78).

**209. Text renamed to Notes everywhere (supersedes the Text exceptions of Decision 208).** Requested by the owner.
- User-facing, the note type is now Notes: card label, folder heading, New chooser card, type chips on rows, default item names (for example "Notes 14/10/2026"), the editor's accessibility label, the Autosave toasts ("Unsaved note was saved as Autosave", "Unsaved Vault note was saved as Autosave") and the editor's discard dialog ("Your note has not been saved."). One label map (`VAULT_TYPE_LABELS`) drives the headings, chips and default names; `FOLDER_TITLES` is removed.
- Unchanged: the stored type value `note`, the database and backup category keys (already labelled Notes), the PDF mark tool "Text", and generic uses of "text" for typed content. Items already saved keep the names they were given.
- Checks: `vite build` passes; no `>Text<` label left in the markup. Not device-tested (DP78).

**210. Fingerprint succeeded but the app or the Vault did not open (bug fix).** Reported: the fingerprint is read successfully and entry fails, for the app lock first and now the Vault; the password or PIN works.
- Cause (inferred from the code and Android's behaviour, not reproduced): the system fingerprint screen is its own Activity, so showing it pauses the app, which reports "went to background". The lock-on-background then ran: with the app unlocked it showed the lock screen over the Vault gate; with the Vault unlocked, or the event reaching the page late, it locked the Vault or the app again right after the successful unlock. Typing needs no such screen, so it was unaffected. Only file pickers set the pause exemption (Decision 73); no fingerprint prompt did. Decision 203 fixed a real but separate defect (a stale button) and did not cover this.
- Fix: `biometric.js` counts open prompts and exports `biometricPromptBusy()`, true while any prompt is open and for 1.5 seconds after (the late event). The background handler in `app.js` returns early when it is true, before any lock logic. Unlock and enable prompts are both wrapped, so the gates of Decisions 201 to 204 are covered too.
- Why correct: a pause caused by the fingerprint screen is never a real backgrounding, and every pause from it arrives inside the window. A genuine backgrounding more than 1.5 seconds after a prompt locks as before. The screen-off lock is a separate event and is not affected.
- The picker flag of Decision 73 is unchanged.
- Checks: 14 Node checks on `biometric.js` with a stub plugin (busy while open, grace after, idle later, cancel leaves no stuck state, enable covered, counter returns to zero) and on the handler order in `app.js`; the earlier suites still pass; `vite build` passes.
- Risks: not run through CI or on a device (DP80). The 1.5 second grace is an estimate. A real backgrounding inside it after a prompt is not locked by the background trigger.

**211. File explorer built-in viewers (Phase 22, stage E1b).** Requested by the owner; next stage of Decision 207.
- Built: `src/js/explorer-view.js`, a layer inside `#explorer-screen`. The explorer sends text, image, PDF, audio and video files to it; everything else, and every file when the screen is opened without the app's dialogs, goes to another app as before.
- Nothing is copied or stored. No database row, no draft, no cached copy: the viewers read the file where it is. The entry viewers of the app are not reused (they are tied to stored entries, Edit, Share and Delete); only their shared parts are: the PDF viewer and its reading tools, the image zoom and the in-app dialogs.
- Text: read as UTF-8; Save writes the same path. A file over 2 MB goes to another app. A NUL byte means binary: not opened. A replaced-byte character means the bytes were not valid text: opened read-only, since saving would write the replacements. Windows line endings are restored on save. Unsaved changes ask before Back drops them.
- Image: the file is shown through the app's local file route, not read into memory; zoom, pan and swipe through the folder's images in the listing's order. A format the WebView cannot decode says so.
- PDF: read whole into memory, up to 150 MB, then the existing viewer with zoom, find, pages and outline. No mark-up, page tools or save: nothing writes to the phone's files except text Save.
- Audio and video: the WebView's own player over the same local route, so large files stream. Playback pauses when the app is backgrounded; the auto-lock timer is renewed while playing. A format the WebView cannot play says so.
- Back closes an open PDF tool, then the viewer, then steps up the folders. An app lock closes the viewer and the explorer from either card; a Vault lock closes the one opened from the Vault. Each viewer has Open with app.
- Privacy: no network, no account, no copy. The Vault card has the same unencrypted access (Decision 207).
- Checks: 36 Node checks (text load, edit, save, line endings, discard prompt, write failure, binary, invalid bytes, size limit; image source, stepping, zoom teardown; PDF create, tool-first Back, teardown; audio and video, error message, removal; dispatch, Open with app, Back order, lock close, no-dialog fallback); `vite build` passes.
- Risks: not run through CI or on a device (DP81). Images, PDFs and media rely on the local file route serving paths outside the app's folders, including a USB drive; if a phone refuses, those files show the error text and Open with app. Text save to a read-only drive fails with a message. Large PDFs are memory-heavy.

**212. Vault files on disk (Phase 17 stage M).** Carries out stage M of Decision 195. Owner approved.
- Voice, image, PDF and file entries in the Vault are written to `files/<random name>` in the Home format, the file key wrapped under the Vault key (additional data: the path). Row: `file_path`, `file_key` set; `encrypted_body` NULL; size and OCR text in `encrypted_meta` as `{ v: 2, s, o }`. `saveVaultEntry` still takes base64 `fileData`, and `loadVaultEntryContent` still returns it, so the callers are unchanged; `withFile: false` skips reading the bytes.
- `filestore.js` gains `rewrapFileKey`, `sameWrappedKey`, `newFilePath`; `files.js` gains the Vault-key store, `rewrapForVault`, `rewrapForHome`, `keysMatch`, `beginRawFile`, `writeRawBase64`.
- Move (Decisions 181 to 188): a file with its own key is not read or copied. The copy points at the same file with the key re-wrapped, the check compares the two unwrapped keys, and the original is detached before it is deleted so the file stays. A failure restores the original's file reference and removes the copy without touching the file. A plain Home file from before Decision 161 still goes through memory.
- Edit of a Vault file's content writes a new file, points the row at it, then removes the old one; OCR text alone rewrites the meta.
- `encrypted_meta` of a file row is never rewritten when it fails to open (a wrong key must not replace the OCR text); it is made only when missing.
- Backup: a Vault file travels as its stored bytes (format 1 as base64 with `rawFile`, format 2 as the file lines) with `file_key` and `encrypted_meta` kept. Restore writes the bytes as they are. Append with the source PIN unwraps the file key with the source Vault key and wraps it under the current key, at a new path; otherwise path and wrapped key stay. Archives and rows from before this decision, with bytes in `encrypted_body`, still restore and open.
- Not in this stage: the encrypted index blob, body search and thumbnails (N); backup format rules beyond the above (O). Settings storage figures for Vault files are not reworked.
- Checks: 28 Node checks (save, on-disk bytes are ciphertext, load, wrong key and untouched meta, size, index, edit, OCR edit, permanent delete, Move to the Vault and back with no file written, failed original delete, failed copy, key re-wrap across keys and paths, wrong path); `vite build` passes.
- Risks: not run through CI or on a device (DP82). The Vault backup and restore changes are not exercised in Node. Vault files are now visible as files on disk (random names, ciphertext); their count and sizes are no longer hidden inside the database.

**213. File explorer trash (Phase 22, stage E2).** Owner decision: no encryption for the explorer's trash, and the Home and Vault cards share one trash. Amends the trash rule of Decision 207.
- One trash, one list, the same from both cards. Deleted files are not encrypted or re-written. A delete stays a rename on the same storage, so the trash folder still sits on each storage; the screen lists them together.
- The Vault card's trash view is no more private than the Home card's, matching the unencrypted access of Decision 207.
- Restore, empty and the 30-day purge are unchanged.

**214. Update check on the public repo.** The repo is public; supersedes the token parts of Decision 164. Owner decision.
- `checkForUpdate` sends one unauthenticated GET to `api.github.com` on the Check for updates tap, with no `Authorization` header. The download uses the release asset's `browser_download_url`, natively, with no header.
- The token controls (field, Save token, Remove token, status line) are gone from Settings > Updates. No token is read or sent anywhere. A token saved by an earlier build is deleted from `meta` at start-up.
- A 403 or 429 reads as the unauthenticated rate limit (60 requests an hour per address). The previous "no token" and "token rejected" results no longer exist.
- Network calls unchanged: the ad unit and this tap-only check (plus its tap-only download).

**215. Lock screen Back and fingerprint unlock fixes.** Owner reports: the Vault fingerprint still failed; Back from the app lock screen reached Home without a password.
- Back: `showScreen('lock-screen')` left the recorded location at Settings or Vault, so `backAction()` returned that location's action and Settings Back went to Home. Now `backAction()` returns nothing while the lock screen is showing, the lock screen resets the location, and the Settings action re-checks. The Android Back button then minimises the app.
- Vault fingerprint: the page resume after the fingerprint screen called the gate refresh, which could start a second prompt over the first. One attempt now runs at a time (`singleFlight`): callers during an attempt share its result and no prompt starts on its own for 2 s after one ends. A failure inside the unlock no longer leaves a half-opened Vault: the Vault is locked again.
- Reasons: the plugin read returns declined, unreadable or a secret. Only a copy that no longer matches the Vault wrapper or the app password clears the setting (reset). Unreadable keeps it: see Decision 216. Messages: not confirmed; saved key could not be read; reset (turn it on again); could not open. The app-open lock uses the same outcomes.
- Cause for the Vault failure is not confirmed. A second prompt on resume fits the symptom and is removed; a plugin storage fault is not ruled out.
- Checks: 12 Node checks on the plugin read outcomes and `singleFlight`; `vite build` passes. The Back fix and the resume path are not exercised in Node.

**216. Fingerprint setting kept on an unreadable stored copy; return to the Vault after an app lock.** Owner report: the Vault was open, the screen was locked, the lock screen then came back with no fingerprint option, and the password led to Home instead of the Vault. Amends Decision 215.
- Cause 1, introduced by Decision 215: a stored copy that could not be read right after the fingerprint was accepted cleared the setting. The key requires the phone to be unlocked, so the read can fail for a moment after the screen comes on. The setting vanished and the lock screen showed no fingerprint button. Now an unreadable copy only fails that attempt, with a message; the setting and button stay. A copy that does not match the wrapper or the password is still cleared, since that can only be stale.
- Cause 2: after an app lock the unlock always went to Home. An app lock that comes while the Vault is on view now returns to the Vault gate after the unlock. The Vault itself stays locked and asks for its own PIN or fingerprint. A lock from any other screen still returns to Home.
- A person whose fingerprint setting was cleared by the build with Decision 215 must turn it on again in Settings.
- Checks: `vite build` passes; not exercised in Node or on a device (DP83).

**217. Root cause of the fingerprint failures: the plugin's delete clears every credential; an app lock also locks the Vault.** Owner reports: the Vault fingerprint stopped working after the app fingerprint was turned off and on; the Vault stayed open after an app lock from the Home lock button. Amends Decisions 215 and 216.
- Cause 1: the fingerprint plugin's `deleteCredentials({ server })` deletes the one keystore key but clears the whole credential store (`editor.clear()`), so every other saved credential is lost. Turning the app fingerprint off or on wiped the Vault's saved key; a Vault PIN change, a Vault reset or turning the Vault fingerprint off wiped the app's. The settings stayed on, the fingerprint was accepted, the read failed, and the unlock failed. This explains the earlier symptoms of Decisions 210, 215 and 216.
- Fix: `deleteCredentials` is never called. Turning a fingerprint off overwrites its stored copy with an unusable marker; the setting in the database says whether it is on. The two saved copies are independent.
- A stored copy that cannot be read after an accepted fingerprint is retried once (the key can be unavailable for a moment after the screen comes on). If it still fails, the setting is cleared with a message to turn it on again; this replaces the keep-it rule of Decision 216 now that the usual cause is known. A stored copy that is the off marker counts as unreadable.
- A phone that already lost a copy under the old delete needs the fingerprint turned on again once, for the app and for the Vault; the first failed attempt clears the stale setting.
- Cause 2: the app lock from the Home lock button, the idle timer and the other routes locked only the app; the Vault stayed unlocked and opened after the unlock. Any app lock now also locks the Vault, whatever the Vault's own lock settings. After the unlock the Vault asks for its own PIN or fingerprint (Decision 216 returns to the Vault gate when the lock came from the Vault).
- Checks: 16 Node checks (read outcomes and retry, off marker, each fingerprint kept when the other is turned off or on, `deleteCredentials` never used, `singleFlight`); `vite build` passes. The app lock change is not exercised in Node or on a device (DP83).

**218. Home opens clean and redraws on every arrival.** Found in DP82: after Moves and deletes in the Vault, tapping Home showed the Trash view under the card grid and the card counts were stale; a lock and unlock, or entering a folder, cleared it.
- Cause 1: the Home tab button closed an open folder but not the Home Trash, so the Trash opened earlier stayed visible and the card grid was shown over it. Now it closes both and lands on the card grid.
- Cause 2: nothing redrew Home when it came back in front, so the counts reflected the last Home action, not the Moves and deletes done in the Vault meanwhile. Every arrival at Home (tab, Back, unlock) now redraws the counts, totals and the open folder.
- Checks: `vite build` passes; not exercised in Node or on a device (DP83 item 9).

**219. File explorer manage, first part (Phase 22, stage E2a).** E2 is built in two parts; this is the first.
- Built: long-press multi-select, new folder, rename, properties, delete to the shared trash (Decision 213), trash view with restore, delete for good and empty, 30-day purge. Copy, move and share are E2b.
- Logic in `src/js/explorer-manage.js`, pure over an injected filesystem; `explorer.js` supplies the plugin adapter. No native change, no new permission, no network call.
- Names: trimmed; no `/`, `\` or NUL; not `.` or `..`; at most 255 bytes. A clash is any other entry whose name matches ignoring case, because storage may or may not tell the cases apart. Clash: refused, nothing overwritten.
- Case-only rename goes through a temporary name, then the final one; a failure on the second step puts the original name back. Reason: the plugin's rename may remove an existing destination first, which for a case-only change on case-insensitive storage is the file itself. Plugin behaviour recalled, not verified on a device.
- Trash: `.arkly-trash` at each storage root. Delete is a rename on the same storage. Each item is a random 12-hex id with a `<id>.json` record (name, original path, folder flag, size, deleted time) written first and removed if the rename fails; `.nomedia` keeps trashed pictures and music out of other apps. The record holds the original path in plain text, in line with Decision 213.
- Restore: original place, made again if missing; a taken name gets ` (1)`, ` (2)`. A record pointing into the trash folder or off its storage restores to the storage root. A record whose item is gone is removed; an unreadable one is left alone.
- Purge: items older than 30 days are removed once per open of the screen, after access is confirmed, in the background. Delete for good and Empty trash ask first and say it cannot be undone. Delete to the trash asks first and states the 30 days and that the trash is not encrypted.
- The trash folder and anything inside it cannot be deleted or renamed from the explorer; it shows only with the hidden-file toggle on. A storage root cannot be deleted.
- A batch continues past a failed item and reports done and failed counts.
- Filter text and the hidden toggle clear the selection, so an action never reaches an item that is not shown.
- Checks: 51 Node checks on `explorer-manage.js` against an in-memory filesystem (names, free names, clashes, case-only rename, trash, restore, tampered records, purge, expiry, batch failure, properties); 31 DOM checks on the screen against the real `index.html` and a stub plugin; `vite build` passes. Not run through CI or on a device (DP84).
- Risks: plugin `rename`, `rmdir`, `mkdir` and `stat` behaviour on real storage, USB drives and exFAT names is unverified. A rename inside a very large folder, and Properties on one, are untimed.

**220. Archive extraction in the File explorer (Phase 22, stage E2c).** Owner request: extract zip, 7z, rar and other compressed files natively.
- Formats: zip, cbz, jar (zip4j; passwords and AES); 7z (commons-compress with xz; password); rar and cbr (junrar; password); tar, tar.gz and tgz, tar.bz2, tar.xz; single gz, bz2, xz files. RAR 5 is not supported by the library and is reported as such. Office files (docx, xlsx, pptx) are not treated as archives; apk is not either.
- Native, not in the page: `scripts/java/ArklyArchiveBridge.java`, copied and registered as `window.ArklyArchive` by `scripts/patch-archive.js` in CI, right after `patch-explorer.js`; the same route as Decision 207. The script also adds the four libraries to `android/app/build.gradle` and licence-file packaging excludes. Gradle fetches the libraries in CI; the app makes no network call. Pinned: commons-compress 1.26.2, xz 1.9, zip4j 2.11.5, junrar 7.5.5.
- One job at a time, on a background thread; the page polls `status()` and may `cancel()`. Chunked streaming, so size is not held in memory.
- Destination: a new folder beside the archive named after it (`name`, `name (1)`, …). Nothing that exists is overwritten. Tapping an archive asks: Extract, Open with app, or dismiss. A selection of one archive also shows Extract in the selection header.
- Safety: entry names are made relative; any name with `..`, or resolving outside the new folder, is skipped and counted. Links in tar archives are skipped and counted; no link is ever created. At most 200000 entries. Free space is checked every 8 MB written; 32 MB is always left. A failed or cancelled run deletes the new folder: nothing partial is kept.
- Password: asked only when the archive needs one, in the app's password field; never stored. A wrong one asks again.
- Closing the screen, an app lock or a Vault lock cancels a running extraction. Back during extraction cancels it.
- Checks: 20 Java checks of the library-independent paths, compiled against API stubs (names, unique folder, traversal, cancel, cleanup, password codes, errors); 41 DOM checks on the flow and 31 earlier ones; `scripts/patch-archive.js` run twice on a stub Android tree; `vite build` passes. Not run: the real libraries, CI, any device (DP85).
- Risks: library versions and APIs are recalled, not compiled here; a mismatch shows first in CI. commons-compress 1.26 uses `java.nio.file`, so 7z and tar need Android 8 (API 26) or later at run time. A wrong password on 7z and RAR can only be told apart from a damaged archive by the combined message. Names illegal on FAT or exFAT make that entry fail the whole run.

**221. Archives open like folders (Phase 22, stage E2c, revised).** Owner request: tapping an archive opens it inside the app, with no Extract or Open with app question. Replaces the tap behaviour in Decision 220.
- Tap an archive: it is read natively and shown as a folder: breadcrumbs start at the archive's name, folders first, the name filter and Name and Size sort work. Date is hidden (entries carry none). Dotfiles are shown. Folders implied by deeper paths are shown even when the archive has no entry for them. Back goes up a folder, then out of the archive.
- Native additions in `ArklyArchiveBridge`: `openArchive` (one scan in the background; the entry list is kept in memory, at most 200000), `browseStatus`, `children(id, folder)` (one folder at a time, so a large archive is never sent whole), `closeArchive`, `startEntry`, `startSelected`, `clearCache`. The bridge now takes the activity, for the cache folder.
- Tap a file inside: that one entry is extracted into the app's cache folder and shown in the built-in viewer, read-only (the text viewer offers no saving; copies are not written back). Copies are removed when the archive closes, when the screen closes or locks, and at app start. They are not encrypted while open, the same exposure as the explorer's other files (Decision 207).
- Extract all (header icon) and Extract selected (long-press, then the Extract icon; a folder takes what is inside it) write a new folder beside the archive, as in Decision 220. After it, the view returns to the same folder of the archive.
- Selecting inside an archive offers only Extract: no rename, delete or properties; an archive is read-only.
- Password: asked when opening (header-encrypted 7z and RAR) or when a file needs it (zip, per entry); kept in memory for as long as that archive is open, then dropped; never written.
- A name with `..` is not listed and never extracted. A nested archive is not opened inside the archive: the message says to extract it first.
- The Extract icon in the selection header for one archive in a folder stays (extract all).
- Checks: 39 Java checks against stubs (adds listing, implied folders, one entry to the cache, selected entries, a folder name that is a prefix of another, cache clearing, closing, control characters in names); 40 DOM checks on the browse flow; 31 earlier DOM checks; patch script run twice; `vite build` passes. Not run: the real libraries, CI, any device (DP86).
- Risks: listing a tar.gz, tar.bz2 or tar.xz reads and decompresses the whole archive once, so a large one opens slowly (progress shows the count). A file opened from the cache with Open with app inside the viewer may not reach another app, since the cache is private to Arkly; the viewers do not need it. The library calls for listing (`getEntries`, `getUncompressedSize`, `getFullUnpackSize`) are recalled, not compiled.

**222. File explorer copy, move and share (Phase 22, stage E2b).** Second part of E2 (Decision 219).
- Selecting in a folder shows a second row under the selection header: Copy, Move, Share. Not shown in the trash or inside an archive.
- Destination picker: folders only, opened at the current folder, crumbs from the storage list down; dot folders are hidden; New folder is available in it. The button reads Copy here or Move here and is disabled, with the reason, when the destination is inside a selected folder, is the trash, or (move) is where the items already are.
- Native, like Decisions 207 and 220: `scripts/java/ArklyFileOpsBridge.java`, copied and registered as `window.ArklyFileOps` by `scripts/patch-fileops.js` in CI after `patch-archive.js`. No Gradle change, no permission, no network. One job at a time on a background thread; the page polls `status()` and may `cancel()`; the progress view shows items, bytes and the current name; Back cancels.
- Nothing is overwritten: a taken name becomes `name (1).ext`, a folder `name (1)`. Copy beside itself makes a numbered copy.
- Move on one storage is a rename. If the rename fails (another storage), the item is copied whole and the original removed only afterwards; if the original cannot be removed the item counts as failed with that message.
- Free space is checked before a copy and every 8 MB; 32 MB is always left. Cancel or a failure removes the half-copied item; items already finished stay, and the message says how many.
- A failed item does not stop the rest; the result gives done, failed and skipped counts. Links are skipped, never followed or created. A folder cannot go into itself. The trash folder is never a source or a destination.
- Share: files only, up to 100, through the existing share plugin with file URIs; a selection with a folder disables it. Share is an explicit user action. It can fail for storage outside the app's file-provider paths (for example a USB drive); the message is shown and nothing else happens.
- Checks: 26 Java checks on a real temporary filesystem (unique names, copy and move, cross-storage fallback, folder into itself, trash, missing source, links, cancel, one job at a time, odd names); 35 DOM checks; the earlier 31 and 40 DOM checks pass; patch script run twice; `vite build` passes. Not run: CI, any device (DP87).
- Risks: the share plugin's file-provider paths cover the primary storage; other storages and the Vault card's folders are unconfirmed. Copying very large trees pre-scans them first. The Java is compiled here only on a desktop JDK, not in the Android build.

**223. Recursive folder creation on an existing folder (fix to Decision 219).** The filesystem plugin's `mkdir` rejects "Directory exists" even with `recursive` set (read in the plugin source, version 6.0.4). The explorer's adapter now treats a recursive `mkdir` on a path that is already a folder as success; a non-recursive one still rejects, and every clash is still checked first by name. Effect: delete to trash and restore failed on every use after the first (the trash folder, or the restore parent, already existed). Batch results (trash, restore, delete for good, empty) now name the first reason, for example "0 moved to trash, 4 could not be moved: <reason>". Checked: the test stub now rejects `mkdir` on an existing folder like the plugin; the new check fails on the earlier code with the same message seen on the device, and passes now. Same plugin source read: `rename` removes an existing destination first, which is why a case-only rename goes through a temporary name (Decision 219).

**224. Destination picker: Cancel, and files shown (revises Decision 222).** Owner request after DP87 use.
- Cancel: a Cancel button beside Copy here / Move here and New folder, and on the storage list; it leaves the picker and the folder is shown again. The selection is cleared, as when the picker was opened. Back still goes up a level.
- Files are listed after the folders, greyed and not tappable, with size and date, so what already exists is visible. Dot files stay hidden unless one has the same name as an item being copied or moved. The trash folder is never listed.
- A name that matches an item being copied or moved (ignoring case; a file or a folder) is marked in the list with the name the new one would get (`name (1).ext`, skipping numbers already taken), and the banner counts the matches and says nothing is replaced. Nothing changed in what happens: the native job never overwrites and numbers a taken name (Decision 222). Moving into the folder the items already sit in is still refused and shows no marks.
- Checks: 46 DOM checks on the picker (adds files as plain rows, tapping a file does nothing, flags and numbering including a skipped `(1)`, a folder clash, an unrelated file unmarked, Cancel from a sub folder and from the storage list); earlier suites pass; `vite build` passes. Not device-tested (DP87).

**225. Name clashes in copy and move: Replace, Skip or Rename (revises Decisions 222 and 224).** Owner request.
- Choosing Copy here or Move here reads the destination. Items whose name is free go through at once, as before. For items whose name is taken (ignoring case), a list opens: each row shows the existing item and the new one with size and date, and the buttons Replace, Skip and Rename; the top row offers Replace all, Skip all and Rename all. An item leaves the list when its action is done; the list ends, with a one-line summary, when it is empty. A copy made beside its own original is not a clash: it still gets a number.
- Rename: the new item is saved with a number (`name (1).ext`); the row says which name. Skip: nothing is done and the item stays where it was. Replace: see below.
- Replace is the only way anything is overwritten. It is for a file over a file only; a folder is never replaced and never replaces anything, so those rows offer Skip and Rename. The banner states that Replace deletes the existing file for good; Replace all asks first, with the count and the same statement. A single Replace is one deliberate tap on a button named Replace in the destructive colour, with the statement on screen.
- Native, `ArklyFileOpsBridge.startWith(op, dest, paths, policy)` with policy rename or replace (`start` is unchanged and means rename). The new file is made whole under a temporary name beside the old one; only then is the old one removed and the temporary one renamed. A failure or a cancel before that leaves the old file as it was. A move on one storage renames the original to the temporary name first; across storages the original is removed after the swap. Same file onto itself is refused.
- One native job per item, in order, so each row can finish, fail or be cancelled on its own; a failed row stays with its reason and the same three choices. Back while one runs cancels it and keeps the row; Back otherwise leaves the list and every remaining item is left as it was, and says how many.
- Checks: 37 Java checks on a real temporary filesystem (adds copy, same-storage move and cross-storage move with Replace, a different-case name, folder over file and file over folder refused, the same file refused, cancel mid-replace keeps the old file with no temporary left, rename policy, an unknown policy refused); 46, 28, 40, 31 and 5 DOM checks pass; patch script unchanged; `vite build` passes. Not run: CI, any device (DP89).
- Risks: a failure after the old file is deleted and before the rename finishes leaves the new file under a temporary name (the message says so); not expected. Replacing does not use the explorer trash, so it cannot be undone. Dates in the rows come from the file system as listed.

**226. File explorer office viewers (Phase 22, stage E3).** Stage E3 of Decision 207, view only. Library choice follows the rule of Decision 207 (bundled, pinned, offline).
- One bundled library: `fflate` 0.8.2, exact version, to unpack the zip. The three formats are read by `src/js/office-read.js` with the WebView's own XML parser; drawing is in `src/js/office-render.js`. Both load only when a file of these types is opened (a separate build chunk, about 21 kB). A document-conversion library was not used: its output is markup from the file, and the viewer sets only text, never markup.
- Opened from the explorer and from inside an archive (Decision 220), through the same viewer layer as Decision 211. The file is read whole through the local file route, up to 50 MB; larger goes to another app. Nothing is saved, copied or stored; there is no Save button.
- Unpacking: only the parts needed (XML, relationships, pictures png, jpg, gif, webp, bmp); a part over 25 MB or a total over 120 MB is not unpacked. Not a zip, or a protected file, shows "protected or damaged"; a zip of another kind shows "not a valid file of this type"; both offer Open with app.
- docx: headings (style or outline level), bold, italic, underline, strike, super and subscript, centred and right alignment, bullet and numbered lists (from the paragraph or its style; numbers count per list and level, letters for letter formats), tables with merged columns, pictures. Hyperlinks show as text and do not open. Headers, footers, footnotes, comments, tracked deletions and text boxes are not shown. First 10,000 paragraphs, with a notice.
- xlsx: one tab per visible sheet, one sheet read at a time. Cells show the stored value: a formula shows its last stored result, never recalculated, and is empty if the file never stored one. Dates and times (by format code) as year-month-day and 24-hour time, percentages with %, other numbers cleaned of float noise, no other number formats. Merged cells, colours, widths and charts are not shown. First 5,000 rows and 200 columns, with a notice.
- pptx: one slide at a time, Previous and Next, position in the header. Title, text with level and bullets, tables, pictures, speaker notes; document order, not slide position. Charts and diagrams say they are not shown. Backgrounds, shapes and fonts are not drawn.
- Privacy: no network, no account, no cache copy, no database row. Pictures are object URLs, revoked when the slide changes or the viewer closes. An app lock or a Vault lock closes the viewer as before.
- Checks: 38 checks of the readers and drawing on files made with python-docx, openpyxl and python-pptx (headings, runs, both list kinds, table, picture, hidden sheet, dates, percentages, booleans, sparse cells, slides, notes, navigation, object URLs revoked, errors for a non-zip, a wrong zip and a wrong type, markup in a file shown as text); 14 checks of the viewer (three kinds open, no Save, header count, Back cleans, error text, size limit, closed before the read ends); `vite build` passes.
- Risks: not run through CI or on a device (DP90). Files made by other programs than those used here may use structures not read (shown as missing text, not an error). Layout on a phone is unverified. A large sheet inside the limits may be slow to read. Wide tables scroll sideways; there is no pinch zoom.

**227. Office viewer fidelity and theme (Phase 22, stage E3b).** Owner request after DP90: the viewers showed plain text with the formatting gone; wanted a fuller viewer and a dark mode switch of their own, defaulting to the system and kept once chosen. Three stages, each device-tested before the next: 1 docx and the shared toolbar and theme (built), 2 xlsx, 3 pptx. Supersedes the plain drawing of Decision 226; its limits, privacy rules and file reading stand.
- Theme: one setting for the three viewers, Auto (default, follows the phone's theme and changes with it), Light or Dark. Set from a switch in the viewer's bar; kept on the phone through the preferences plugin under one key, with the docx view choice. It is not part of a backup. The viewer has its own theme, independent of the app's; the app's header and Back bar keep the app theme.
- Dark rendering: the page is dark; dark text becomes a light colour of the same hue, light colours stay; fills keep their colour except near-white ones, which become the dark page; text on a fill without its own colour is chosen by the fill's brightness; borders follow the text rule; pictures are untouched. Every colour is set for both themes at drawing time, so a switch needs no redraw.
- docx reading: theme colours and fonts; style inheritance (based-on, document defaults, default paragraph style, character styles); run font, size, colour, highlight, shading, caps, small caps, hidden; paragraph alignment (justified too), spacing, line spacing, indents, shading, borders, page break before; numbering with the level's own text, number format, start and indents; tables with grid widths, borders from table, style and cell, shading, merged across and down, first-row style, cell margins, vertical alignment; pictures at their set size; header and footer of the last section; footnotes numbered in order of reference; page size and margins.
- Views: Page (default) draws the page at its set width with its margins, scaled to the screen; Reflow wraps text to the screen with indents halved. Pinch and +/− zoom, 0.5 to 5 times, around the midpoint; scaling uses CSS zoom.
- Fonts are not bundled (APK size): a font name maps to a phone font of the same kind (serif, sans, monospace), with the usual metric-compatible names tried first.
- Not drawn: text boxes, shapes, columns, tab stops (a tab is a tab character), endnotes, comments, other sections' own headers and footers, charts, SmartArt, WordArt, equations. Tracked deletions are not shown.
- Checks: 63 checks of the readers, drawing, colours for both themes, theme switch and its saving, views (files from python-docx, openpyxl, python-pptx); 14 checks of the viewer; `vite build` passes; the office chunk is about 36 kB.
- Risks: not run through CI or on a device (DP91). CSS zoom and the two-finger pinch are assumed to work in the WebView; whether the WebView reports the phone's theme to the page is unverified. Fonts will differ from the original, so line breaks and page length can differ. Files from other programs may use structures not read.

**228. Office viewer xlsx fidelity (Phase 22, stage E3b, stage 2).** Owner report after DP91: the docx view is close to the reference viewer; the spreadsheet showed values only, in one wide column. Extends Decision 227; its theme, privacy and limits stand.
- Reading: theme and indexed colours with tint; fonts (name, size, bold, italic, underline, strike, colour); solid fills; borders (style, colour) on all four sides; alignment (horizontal, vertical, wrap, indent); column widths, hidden columns, row heights, hidden rows; merged cells; frozen rows and columns (up to 20 and 10); grid lines on or off; the default column width and row height.
- Number formats, built-in and custom: thousands separators, decimals, percent, scientific, text and currency symbols in the code (including the bracketed currency form), negative and zero sections, a trailing comma dividing by 1000, dates and times with month and day names and 12-hour time. Fractions, conditions and locale grouping are not applied; those fall back to General. Values are the stored ones; formulas are not recalculated.
- Drawing: a fixed-layout table with a style rule per cell style used on the sheet, so colours for both themes are set once (fills kept except near-white, which becomes the dark surface; text and border colours lightened when dark). Numbers align right, text left, booleans and errors centred unless the cell says otherwise. Text that does not wrap runs over empty, unstyled cells to its right. Frozen cells stick under the column letters and beside the row numbers. Zoom is the same as in docx (+/− and pinch).
- Safety: the style rules are built only from validated colour codes and numbers; font names are reduced to letters, digits, spaces and . _ - before use.
- Limits: first 5,000 rows, 200 columns, 100,000 cells, with a notice. Not drawn: conditional formatting, data bars, charts, pictures (a notice says so), comments, links, rich text inside a cell (shown plain), pattern fills other than solid, text rotation, shrink to fit, styles set on a whole row or column with no cells.
- Checks: 85 checks of readers, drawing, both themes, number formats (20 format codes), freeze, merge, hidden rows and columns, widths and heights; 14 viewer checks; `vite build` passes; the office chunk is about 47 kB.
- Risks: not run through CI or on a device (DP92). Column widths use 7 px per character plus 5, which can differ a little from the original. Large sheets near the limits may be slow.

**229. Office viewer xlsx text beyond the cell (Phase 22, stage E3b, stage 2).** Owner report after DP92 screenshots: text longer than its cell could not be read past the cell or the table edge. Extends Decision 228.
- Columns: the table gets the columns that overflowing text runs into, found before drawing, plus three spare empty columns, up to 200. Nothing is cut at the table edge.
- Text stopped by a filled or styled neighbour is clipped, as in a spreadsheet; tapping any cell with content shows its cell name and all of its text in a bar under the tabs (up to about five lines, scrollable, text selectable), and outlines the cell. Tapping an empty cell or elsewhere closes the bar. Nothing is stored.
- Checks: 95 reader and drawing checks (10 new: spare columns, spill span, neighbour stop, bar shown, hidden and cleared); 14 viewer checks; `vite build` passes.
- Risks: not run on a device (DP92). The width a long text needs is estimated from its length and font size, so a spill can end a little short or long.

**230. Office viewer pptx fidelity (Phase 22, stage E3b, stage 3).** Owner request to continue after DP92. Extends Decision 227; its theme, privacy and limits stand.
- Reading: each slide is resolved to positioned items in px at the slide size set in the file: shapes, pictures with crop, lines and connectors, groups (scale and offset), tables. Placeholders take position, fill, line, body insets and anchor, and text styles from the matching layout then master shape; text size, colour, font, alignment, indent, spacing and bullets come from the shape, layout, master text styles and the presentation defaults, in that order. Backgrounds come from the slide, layout or master (solid, gradient, picture). Colours resolve theme and mapped scheme colours with brightness, tint, shade and alpha. Shapes from the master and layout draw under the slide's own unless hidden.
- Drawing: a canvas at the slide size, scaled to the screen width with CSS zoom; rectangles, rounded rectangles, ellipses, lines, and arrows, triangles, diamonds, hexagons and similar by outline shape; any other shape is a rectangle. Text boxes follow anchor, insets, wrap and the automatic shrink the file records. Rotation and flips apply.
- Tables: cell fill, borders, margins, merged cells; a table style the file names is approximated: the common medium style with the theme's first accent (header row, banded rows, white lines), the no-style and the grid styles; a style defined only in the file's style list is not read.
- Navigation: Previous, Next, swipe sideways (not while zoomed), pinch and +/− zoom, reset on each slide; speaker notes under the slide.
- Theme: a slide keeps the colours it was designed with in both themes; only the frame around it follows the viewer theme.
- Not built: thumbnail strip (promised in Decision 227), charts and diagrams (a labelled empty box), picture and pattern fills, animations, transitions, text direction, WordArt, shadows and effects, group rotation.
- Checks: 107 reader, drawing and theme checks (a 4:3 deck and a 16:9 deck made with python-pptx: placeholders, bullets, notes, background, rounded shape, ellipse, picture, table, line, group); 14 viewer checks; `vite build` passes; the office chunk is about 65 kB.
- Risks: not run through CI or on a device (DP93). Decks from other programs may use shapes, fills or table styles not read; fonts differ from the original, so text may wrap differently; text that overflows its shape is shown, not clipped.

**231. Bundled document fonts (Phase 22, stage E3b).** Owner request: add Arial, Times New Roman and Calibri, and their sans versions if they exist.
- The three Microsoft fonts cannot be redistributed in a public repository. Open fonts with the same character widths are bundled instead: Carlito for Calibri, Arimo for Arial (the same design as Liberation Sans), Tinos for Times New Roman (the same design as Liberation Serif). All three are under the SIL Open Font License 1.1; each licence file is kept beside the fonts.
- They are declared in `style.css` under the names documents use ("Calibri", "Arial", "Times New Roman"), regular, bold, italic and bold italic, in two subsets: Latin, and Latin Extended (which holds the rupee sign). Character ranges split the subsets. A file is fetched from the app only when text uses it; nothing is read from the network.
- Calibri and Arial are already sans; Times New Roman has no sans version, so none is added. Other font names still map to the nearest phone font of the same kind (Decision 227). Cambria (Caladea) and Helvetica are not added.
- Cost: 24 font files, about 1.3 MB added to the APK.
- Effect: also applies to any other text in the app set in these names; the app's own interface keeps Inter.
- Risks: not run through CI or on a device (DP94). Glyphs outside the two subsets (Indian scripts, Greek, Cyrillic) fall back to the phone's fonts.

**232. More document fonts, matching and notice (Phase 22, stage E3c).** Owner report: slides lost their formatting for missing fonts; request: the best version of every font option.
- Ten more open families with all four styles, Latin and Latin Extended: Open Sans, Montserrat, Poppins, Lato, Roboto, Gelasio, Caladea, Cousine, Comic Neue, Anton (Anton has one style). SIL Open Font License 1.1; licence files kept beside them. About 1.4 MB added; with Decision 231 the fonts are about 2.7 MB, each file fetched only when used.
- Names documents use map to them: Segoe UI, Verdana, Tahoma, Aptos, Trebuchet MS to Open Sans; Century Gothic to Poppins; Gotham to Montserrat; Candara, Corbel to Lato; Georgia to Gelasio; Cambria to Caladea; Courier New, Consolas, Lucida Console to Cousine; Comic Sans MS to Comic Neue; Impact to Anton; Helvetica and Helvetica Neue to Arimo; Times to Tinos; Calibri Light to Carlito.
- Any other name falls back to a bundled font of the same kind: serif to Times New Roman's stand-in, monospace to Courier New's, everything else to Open Sans, instead of the phone's default.
- Notice: after drawing, a one-line notice lists the fonts the document uses that are neither bundled, embedded nor on the phone (found by comparing text widths against plain fallbacks), up to four names. It is shown once per opening and stores nothing.
- Embedded fonts: fonts a Word file carries (obfuscated parts) are read, restored with the key stored beside each, loaded for that viewer only and removed when it closes. Fonts embedded in a presentation are not read (their format is not supported). The font's licence flags are not applied; the file is only viewed on this phone.
- Checks: 111 reader, drawing and theme checks (embedded font restored to a TrueType header, none in a plain file, name mapping); 14 viewer checks; `vite build` passes and emits the font files.
- Risks: not run on a device (DP95). Matching is by name, not by look: an unusual display font will still differ. The notice relies on a text-width test that can miss a font whose width equals the fallback's.

**233. Office viewer charts, diagrams and slide controls (Phase 22, stage E3d-1).** Owner report: charts and diagrams showed as an empty box in slides, a slide title showed in a different colour than in the original; request: charts in all three kinds, slide centred, First / Previous / Play-Pause / Next / Last buttons, blur while playing, same in landscape. Extends Decisions 226, 227, 230; their theme, privacy and limits stand.
- Charts (docx, xlsx, pptx): the chart part's cached values are read into a plain model (`readChart`) and drawn as SVG by the new `office-chart.js`. Column, bar (clustered, stacked, percent), line, area, pie, doughnut, scatter, bubble, radar; combinations; a second value axis; axis titles, scale limits, number formats, data labels, legend, title. Nothing is recalculated, so a chart shows the values the file last saved.
- Placement: a Word chart sits in the text at its size; an Excel chart (and picture) sits over the cells it was anchored to; a slide chart sits at its frame. Text colour follows the viewer theme in Word and Excel, and the slide background in slides.
- Diagrams (SmartArt) in slides: the file keeps a ready drawing beside the diagram data; its shapes go through the normal slide drawing. A diagram without that drawing, and any other object, shows the one-line note.
- Colour: three inheritance gaps closed. A slide's own colour-map override is applied; a shape's style font colour now beats the presentation default text colour (it was ignored); a placeholder takes its geometry (rounded corners) from the layout or master.
- Slide area: the slide is centred and fits whole in portrait and landscape (fit by width and height). Buttons: First, Previous, Play/Pause, Next, Last, with icons. Play advances every 5 seconds, stops on the last slide, restarts from the first when pressed on the last. While playing, the viewer goes full screen, the page behind is blurred, and only the slide and the buttons stay sharp; Pause restores the normal view. The play timer is not user activity, so the auto-lock still applies.
- Excel notice: now only for shapes and other drawings that are still not shown.
- Cost: no new network call, no stored data, no library. About 14 KB of script added.
- Checks: 36 reader, drawing and viewer checks on generated files (nine chart types, diagram, style colour, layout geometry, Excel anchors, Word chart, button set, play and pause state); charts rendered to images and inspected; `vite build` passes.
- Risks: not run through CI or on a device (DP96). The title colour cause could not be confirmed without the owner's file; the three gaps above are the known ways it differs. Full screen while playing relies on the viewer not sitting inside a transformed parent. 3D, surface, stock and funnel charts are not drawn.

**234. Office viewer tools: Find, Copy, Info, Go to slide (Phase 22, stage E3f); editing and two more tools staged.** Owner request after DP96: add every tool that can and should be added for the three kinds, editing included. Extends Decisions 226, 227, 233; their privacy and limits stand.
- Find (all three): a toolbar button opens a find row with a field, a match count, previous and next. Case-insensitive; matches are highlighted and the current one is stressed. Word: the whole text. Excel: every visible sheet, up to 2,000 matches; a match switches to its sheet, scrolls to the cell and selects it. Slides: every slide, up to 2,000 matches; a match changes slide. A match inside one run of text is found; one split across runs of different formatting is not.
- Go to slide: a number field in the find row, slides only.
- Copy: copies the whole text in Word, the current sheet as tab-separated rows in Excel, the current slide (with notes) in slides. Text can also be selected by long press and copied by the system. The clipboard is written only on that tap.
- Info: words and characters (Word), sheets and the current sheet's size (Excel), slide count and the current slide's words (slides), with the fonts used.
- Nothing in the file is changed; no network call, nothing stored. The tools are hidden while a slide show plays.
- Staged, not built: (1) slide thumbnails and a Word headings outline; (2) editing. Editing ends the view-only rule of Decision 226 and needs its own design first: which edits (text in place, cell values), patching only the changed parts of the file so everything else is kept as is, save as a copy before any overwrite, the trash and backup rules for files in the vault, and a clear unsaved-changes state.
- Checks: 22 viewer checks on generated files (buttons, count, highlight, clearing, info, go-to field, closing); the 36 earlier checks still pass; `vite build` passes.
- Risks: not run through CI or on a device (DP97). Find on a large workbook or deck loads every sheet or slide once per search.

**235. Office viewers: full screen, three-dot menu, folding title bar, Open with chooser; editing dropped (Phase 22, stage E3h).** Owner report after DP97: a wide empty bar at the bottom of all three viewers; request: full screen, the toolbar folded into a menu beside the share button, the title bar hiding while scrolling, an Open with list of other apps, and read only for good. Supersedes the editing plan in Decision 234; extends Decisions 226, 227, 233, 234.
- Read only: the office viewers never edit. The staged editing stage (E4) is removed. Plain text files keep their own editor.
- Full screen: the empty bar was space reserved for the floating Back bar. While an office file is open that bar is hidden and the reservation removed; the title bar's arrow and the system Back still leave. This departs from Decision 104 (Back visible everywhere) for office files only.
- Menu: the three-dot button sits before the share button. It opens a panel with theme, view, zoom, Find, Copy, Info and Open with. Theme, view and zoom keep it open; Find, Info and Open with close it; a tap outside closes it. Find and Info rows appear under the title bar.
- Title bar: scrolling down hides it, scrolling up or reaching the top shows it, in Word, Excel and slides. Direction is judged over a short run and events right after a change are ignored, so the resize it causes does not flip it back. Opening the menu shows it.
- Open with: the share button and the menu entry now always list the apps that can open the file (a chooser), instead of using the default app. Other file types keep the default behaviour. The file is handed over only on that tap.
- Checks: 21 shell checks (menu panel, Open with, hide and show on scroll, stop after close) plus the 22 tool checks and 36 earlier checks pass on generated files; `vite build` passes.
- Risks: not run through CI or on a device (DP98). The chooser relies on the file opener plugin showing its list when asked not to use the default app. The title bar is measured when it hides; a rotation while hidden keeps it hidden until the next scroll up.

**236. PDF in the full-screen shell; smooth title bar fold (Phase 22, stage E3i).** Owner report after DP98: Open with works; the title bar fold was jerky; the empty bottom bar and the three-dot menu are wanted for PDF too. Amends Decision 235.
- PDF: opens in the same shell as office files: no reserved bottom space, floating Back bar hidden, three-dot button before the share button, title bar folds while scrolling. The menu holds Find, Pages and outline, Zoom in and Zoom out (they were floating buttons); Find and Pages close it, zoom keeps it open, a tap on the page closes it. The share button lists the apps that can open the PDF.
- Fold: the cause of the jerk was resizing the whole viewer on every frame of the animation. The title bar now floats over the file; the body's top margin changes once and the body slides from its old position with a transform (about a fifth of a second), so only the compositor moves. The transform is cleared when the slide ends, because a leftover transform would become the frame of the full-screen slide show.
- Scroll logic moved to `chrome-scroll.js`, shared by the office viewers and PDF; events for 450 ms after a change are ignored.
- Images, text, audio and video keep their shell.
- Checks: 17 shell checks (office and PDF: flags, menu, Open with, fold and unfold, glide cleanup, restore on close; text unchanged), 21 menu, 22 tool and 36 earlier checks pass on generated files; `vite build` passes. The PDF engine itself is not loaded in these checks.
- Risks: not run through CI or on a device (DP99). The PDF menu panel sits over the page; check it does not hide the search bar.

**237. Explorer PDF: Mark up and Edit pages in the menu; slim title bar (Phase 22, stage E3j).** Owner report after DP99: PDF menu and smooth fold work; the PDF menu showed four buttons where six were expected; the title bar is too tall in all four viewers. Amends Decisions 235, 236.
- The two missing buttons, Mark up and Edit pages, existed only in the entry PDF viewer (Decisions 166, 167); the Explorer PDF never had them. They are now mounted in the Explorer PDF too, in place of the zoom buttons: Find, Pages and outline, Mark up, Edit pages. Zoom is by pinch, which the viewer already supports.
- Saving: Mark up saves a new PDF next to the original, named `name (marked).pdf`; Replace writes over the original and is the tool's own explicit choice. Edit pages always saves a copy, `name (edited).pdf`. A copy never overwrites an existing file: a number is added (`marked 2`). The folder list refreshes when the viewer closes after a save. Files are written only on that tap, to the same folder; no network call.
- The picture tool opens the phone's picker through the same hand-over the Explorer uses for other apps, so the app lock does not fire on return.
- Read only for office files stands (Decision 235); this adds nothing there.
- Title bar: slimmer in Word, Excel, slides and PDF: smaller buttons, smaller semibold title, the page or slide count as a small pill, a thin divider, a lightly translucent blurred background. Other viewers keep the standard bar.
- Checks: 9 PDF wiring checks (menu buttons, no zoom buttons, copy naming and no-overwrite, Replace, page tools copy, bytes written, folder told it changed, with the PDF engine and the tool panels stubbed), 17 shell, 21 menu, 22 tool and 36 earlier checks pass on generated files; `vite build` passes.
- Risks: not run through CI or on a device (DP100). The mark-up and page tools themselves are unchanged and not exercised here; their save route in the Explorer is new. Saving next to a file on removable storage may fail with the phone's permission message.

**238. Explorer PDF: Open with in the menu (Phase 22, stage E3k).** Owner report after DP100: PDF tools work; add Open with to the PDF menu in the same style as the other buttons. Extends Decisions 236, 237.
- A fifth round button (the share icon) closes the PDF menu row of four and sits last in it: Find, Pages and outline, Mark up, Edit pages, Open with. It lists the apps that can open the PDF, the same chooser as the share button in the title bar. The file is handed over only on that tap.
- Word, Excel and slides already carry Open with in their menu (Decision 235); unchanged.
- Checks: 11 PDF wiring checks (button order, chooser flag, menu closes) plus 17 shell, 21 menu, 22 tool and 36 earlier checks pass on generated files; `vite build` passes.
- Risks: not run through CI or on a device (DP101).

**239. PDF menu: Open with as a labelled button, dock centred (Phase 22, stage E3l).** Owner report after DP101: the share symbol on the fifth button was unclear; the dock sat at the left. Amends Decision 238.
- The fifth button is wider and carries the words "Open with" instead of the share symbol; the other four keep their round icons.
- The menu dock is centred horizontally on the screen, with a margin at each side.
- Checks: 11 PDF wiring checks (including the button label) plus 17 shell, 21 menu, 22 tool and 36 earlier checks pass on generated files; `vite build` passes.
- Risks: not run through CI or on a device (DP102). Layout only; the dock width with the label is about 300 px.

**240. Word headings outline and slide thumbnails (Phase 22, stage E3g).** Planned in Decision 234's follow-up; no editing involved (Decision 235).
- A new Outline button (Word) or Slides button (slides) sits in the viewer menu after Info. It opens a panel under the find row; a second tap, a pick, or Play closes it.
- Word: one row per top-level heading, indented by level (headings inside tables, headers, footers and footnotes are not listed); at most 500 rows. A tap scrolls the heading to the top. No headings gives a plain notice.
- Slides: a horizontal strip of thumbnails, each the slide drawing scaled to 132 px wide, with number and first text line. Thumbnails are drawn when they scroll into view, with their own object URLs, released when the panel closes or the viewer closes. A tap opens that slide.
- Excel has no panel; sheet tabs already serve.
- Files: `src/js/office-render.js`, `src/css/style.css`. No change to the reader, credentials, backups or network use.
- Checks: 6 simulated-page checks on a generated Word file (button present, panel hidden at start, rows and indents, tap scrolls and closes, toggle, destroy); `vite build` passes.
- Risks: slide thumbnails not exercised, no slide file in the checks; not run through CI or on a device (DP103). Strip height with a tall slide shape and drawing cost on a long deck are unmeasured.

**241. Word pages: plan (Phase 22, stage E3d).** Owner report: a Word file shows as one long sheet, not as pages. Aim: page breaks as close to the original as the file allows. Nothing built; no decision here changes credentials, backups or network use.
- Stage 1, saved breaks (exact when present): page sheets drawn from the breaks the file already holds (`lastRenderedPageBreak` markers, explicit page breaks, page-break-before on a paragraph, section breaks). Header and footer on every page, with page number and page count fields filled in. The stored page count (`docProps/app.xml`) is read for comparison.
- Stage 2, measured breaks (fallback, an estimate): used only when the file has no saved markers. Text is measured with the bundled fonts. Rules followed: line height from font metrics, space before and after, keep with next, keep lines together, widow and orphan control, table rows not split across pages. When the page count differs from the stored count, a notice says page breaks are estimated.
- Stage 3, shapes: text boxes, shapes and floating pictures at their positions, reusing the slide drawing. Equations after that.
- Reflow view stays as it is; Page view takes the sheets.
- Not planned: SmartArt, WordArt, fields that need Word to compute them (contents page numbers are shown as saved), exact match for files never saved by Word.
- Risks: files from other programs carry no markers, so stage 2 decides their breaks; fonts with no width-matched bundled copy drift; a long document measured page by page may be slow on a phone (a page limit and progress notice are part of stage 2).
- Build order: stage 1 first, device-checked, then stage 2.

**242. Word pages: stage 1, saved breaks (Phase 22, stage E3d).** Builds the first stage of Decision 241. No change to credentials, backups or network use.
- Page view draws one sheet per page, each at its section's size and margins, with header and footer on every sheet. Breaks come only from what the file holds: saved page markers, explicit page breaks, page-break-before and section breaks (next page, even and odd treated as next page; continuous adds none).
- A marker inside a paragraph splits it across two sheets; a marker at a table row splits the table between rows, never inside a vertically merged group. A marker straight after an explicit break adds no page.
- Header and footer: default, first-page (when the section sets it) and even-page (when the file sets it); a section without its own takes the previous one. PAGE, NUMPAGES and SECTIONPAGES are filled per sheet; numbering follows each section's start and format. Reflow view still shows the saved field text.
- Footnotes appear at the foot of the sheet that cites them. Info and Copy leave out the repeated headers and footers.
- Stored page count (`docProps/app.xml`) is read; a notice shows when it differs from the sheets drawn. A file with no saved break stays one continuous sheet, with a notice when it was saved with more than one page; stage 2 is for those.
- Reflow view is unchanged. The page DOM is rebuilt only when the view switches.
- Files: `src/js/office-read.js`, `src/js/office-pages.js` (new), `src/js/office-render.js`, `src/css/style.css`.
- Checks: 14 on generated Word files; `vite build` passes.
- Risks: not run in a browser, through CI or on a device (DP104). Fonts that differ from the original move text within a sheet but not the break. A sheet grows when its content is taller than the page.

**243. Word pages: stage 2, measured breaks; font notice; break notice rule (Phase 22, stages E3d, E3m, E3n).** Builds the second stage of Decision 241 and two owner requests. No change to credentials, backups or network use.
- Files with no saved page marker (a script-generated file, for one) are laid out by measuring. Page view shows the text at once with a "Laying out pages" notice, then swaps in the sheets; the work waits for the fonts (2.5 s at most) and runs once per file.
- Measuring: the blocks are drawn in a hidden column as wide as the page text area; each block's top and bottom are read back. A paragraph that crosses the page bottom is cut at the last line that ends above it (found by a search over text offsets), and the rest carries on the next sheet.
- Rules: explicit breaks, page-break-before and section breaks are honoured; keep with next (a heading travels with what follows); keep lines together; widow and orphan control (two lines each side; a paragraph under four lines is not split); table rows are never split and never inside a vertically merged group; a row taller than a page is taken whole. Space before and after is whatever the flow measured.
- Not measured: header and footer height (the page margins alone set the text area), shapes, floating pictures, footnote space at the foot of a sheet. More than 800 sheets stops the layout and keeps one sheet with a notice.
- The notice says the breaks are estimated, with both counts when the stored count is above 1 and differs (E3n). A stored count of 1 or none no longer shows a mismatch for saved files either.
- Font notice (E3m): a close button removes it for that viewer; scrolling down folds it with the title bar (same short slide), scrolling up brings it back. All four viewers.
- Files: `src/js/office-read.js` (keep-with-next, keep-lines), `src/js/office-pages.js`, `src/js/office-render.js`, `src/css/style.css`.
- Checks: 17 on a simulated layout (fit, orphan, widow, keep with next, keep lines, short paragraph, table split, breaks, long paragraph over four sheets with no text lost, sections and numbering); 14 earlier saved-break checks still pass; `vite build` passes.
- Risks: the DOM measuring and the cut search were not run against a real layout (DP105). A paragraph cut falls on a word wrap, so a hyphenated or very differently spaced font can move a line. Page counts will differ from Word where fonts differ or header and footer are tall.

**244. Word pages: files that break their own pages (Phase 22, stage E3d).** Fixes a regression from Decision 243: a converted file with hard page breaks and no saved marker (157 pages in Word) was measured and gave 166.
- Hard breaks (explicit, page-break-before, section) count as the file's own pages again. Measuring still runs for a file with no saved marker; the file's own breaks are kept unless the measured count is more than 15 percent above them. A file with no hard break, or with far fewer breaks than the text needs, uses the measured layout.
- A file with saved markers is unchanged: markers only, no measuring.
- Files: `src/js/office-pages.js` (`paginate` option `hard`), `src/js/office-render.js`.
- Checks: 19 simulated-layout checks, 14 saved-break checks, `vite build`. Not run on a device: the original file should show 157 pages again (DP105).

**245. Word pages: faster layout for files with their own page breaks (Phase 22, stage E3d).** A 5 MB converted file (157 pages) was fully measured only to confirm its own breaks.
- Up to 12 of the file's own pages, spread across it, are measured alone. When their average overflow is at most 15 percent, the file's own breaks are used and the full measuring is skipped. Otherwise the whole file is measured as in Decision 244.
- Files with saved markers and files with no hard break are unchanged.
- Files: `src/js/office-render.js`.
- Checks: `vite build` passes; the sampling runs against a real layout only (DP105: time to open the 157-page file).

**246. Word pages: draw a file's own pages at once (Phase 22, stage E3d).** Decision 245 still drew the whole text as one flow first, then the sheets: the document was built twice and the wait was little shorter.
- A file with its own hard page breaks and no saved marker shows its sheets immediately. The sampled check of Decision 245 runs afterwards and replaces the sheets only when it finds more than 15 percent overflow; otherwise nothing is redrawn.
- A file with no hard break still shows the text first with "Laying out pages", then the measured sheets.
- Files: `src/js/office-render.js`.
- Checks: `vite build` passes. Time to open the 157-page file not yet measured on device (DP105). Reading and unzipping the 5 MB file and drawing 157 sheets are unchanged and may remain the main cost.

**247. Word pages: sheets filled when near the screen (Phase 22, stage E3d).** Drawing every block of a 157-page file at once was the main wait on the phone.
- Page view creates every sheet as an empty shell at its true size and fills a sheet with its header, text, footnotes and footer when it comes within about 1,500 px of the screen. A filled sheet stays filled. Without the browser's intersection observer, all sheets are filled at once.
- Find, Copy, Info and Outline fill every sheet first (one wait on first use), because they read the text on screen; the heading list for the outline is then rebuilt in document order.
- A sheet whose text runs taller than the page grows when filled, so the scroll position can shift a little while scrolling quickly.
- Reflow view is unchanged: it still draws the whole text once.
- Files: `src/js/office-render.js`.
- Checks: `vite build` passes. Not run on a device (DP105). Reading and unzipping the 5 MB file is unchanged.

**248. Word load time: reader savings and a temporary timing readout (Phase 22, stage E3d).** Screen recordings of the 157-page file: about 5 s of "Loading" before the viewer, then sheets at once and smooth scrolling (Decision 247). The wait is now in reading the file, not drawing it.
- A very large part (over 2 MB of text) is checked for a parse error at its root only; the whole-tree search is kept for small parts.
- The tree helpers `kid` and `kids` stop at the first match and no longer copy the child list.
- The Word Info line ends with the load timings: unzip, parse, read, pages, and the sheets drawn so far. Temporary: remove once load time is tuned (roadmap E3o).
- Files: `src/js/office-read.js`, `src/js/office-render.js`.
- Checks: 14 saved-break and 19 simulated-layout checks pass; `vite build` passes. The gain is not measured: the sandbox has no browser parser, so the first timings come from the phone (DP105).

**249. CI install pinned past a broken package release (Phase 1, CI).** The Android build failed at "Install Node dependencies": `@trapezedev/project` 7.1.11 (pulled in by `@capacitor/assets`) was published to the registry with a dependency, `@trapezedev/gradle-parse` 7.1.11, that does not exist. The repository has no lockfile, so every run takes the newest release.
- `package.json` gets an `overrides` entry holding `@trapezedev/project` at 7.1.10, the last release whose dependencies resolve. No application code is touched.
- Reproduced without the entry (same error as the CI log) and resolved with it, using a lockfile-only install; the full build was not run.
- Remove the entry once a later release of that package installs cleanly. A committed lockfile would stop this class of failure; not done, needs approval.
- Files: `package.json`.

**250. Word floating objects: stage 3 (Phase 22, stage E3d).** Builds the third stage of Decision 241 for anchored pictures, shapes and text boxes. No change to credentials, backups or network use.
- `office-read.js`: a `wp:anchor` drawing holding a picture or a shape becomes a `{ float }` run: size, rotation, geometry, solid fill, outline, text-box paragraphs (size, bold, italic, underline, colour, alignment, insets), horizontal and vertical position (relative-from, offset or alignment), wrap kind, behind-text flag and wrap distances. Inline pictures and charts are read as before. A drawing inside `mc:AlternateContent` is read from its first choice; before, such a drawing was dropped.
- `office-render.js`: `slideItem` is the slide drawing of one item, now shared; `slideDom` calls it. `floatNode` draws a float: wrap none, behind or in front is an overlay on its paragraph; square, tight and through float left or right of the column; top and bottom takes its own line. `placeFloats` sets page- and margin-relative vertical positions once a sheet is filled. Floats are drawn in Page view and in Reflow.
- Approximations: a wrapped float sits at its paragraph, not at its vertical offset; text wraps by the box, not the outline of a tight wrap; grouped shapes, connectors with arrowheads, gradients, shadows and shape styles without an explicit fill or outline are not drawn; text-box text is not read by Copy or Info (Find sees it on screen).
- Equations are not started.
- Files: `src/js/office-read.js`, `src/js/office-render.js`, `src/css/style.css`.

**251. Word equations (Phase 22, stage E3d).** Last row of Decision 241's stage 3. No change to credentials, backups or network use.
- `office-read.js` `readMath`: `m:oMath` (inline) and `m:oMathPara` (display, one run per `m:oMath`) become `{ math, disp, size, color }` runs. Tree nodes: text run (upright for `m:sty` p or b, bold, colour), fraction (bar, no bar, linear, skewed), superscript, subscript, both, prescripts, radical, big operator with limits, delimiters with separators, function, accent, bar, group character, lower and upper limit, matrix, equation array, border box; `box` and `phant` pass their content through; tracked insertions are read, deletions skipped. Capped at 600 nodes and 24 levels.
- `office-render.js` `mathNode`: spans and CSS, Cambria Math with serif fallbacks (no bundled math font, so no font notice). Latin and lower-case Greek letters italic unless plain; relations and binary operators spaced; a leading minus is unary. Delimiters are stretched SVG paths only when the content holds a fraction, radical, operator, matrix, limit or group; otherwise the plain character. Display equations are centred blocks; in inline equations a big operator puts its limits at the side.
- Copy and Info: the root carries `data-lin`; while text is read, the drawing is swapped for it, so a fraction reads `(a)/(b)`, not stacked lines. Find works on the drawn text.
- Page measuring: the cut walker skips `.eo-math` text, so offsets match the model's text runs; a math run is placed like a picture.
- Approximations: limits of tall integrals sit beside the symbol, not at its ends; `&` alignment marks in equation arrays are dropped, rows are left aligned; no equation spacing rules beyond operators; equations in slides (`a14:m`) are not read.
- Files: `src/js/office-read.js`, `src/js/office-render.js`, `src/css/style.css`.

**252. Word groups, free-form shapes and float placement (Phase 22, stage E3d).** Bugs in Decision 250, found with the owner's file (a table frame drawn as a solid black box; a picture drawn 400 px to the right of its place).
- Cause 1: a group anchor (`wpg:wgp`) was read as its first shape only, and a free-form outline (`a:custGeom`, here the table borders as thin filled polygons) was drawn as a plain rectangle, so the borders became a solid fill.
- Fix 1: `readDocx` reads a group into a `group` item (children placed by the group's child offset and extent scale: shapes, text boxes, pictures); `custOf` reads `custGeom` paths (move, line, cubic and quadratic curve, close) into one SVG path; `slideItem` draws a `group` and a `cust` shape (SVG, viewBox in the path's units). Arcs are not read.
- Cause 2: an overlay float is absolutely placed in its paragraph, but a page-relative left was measured from the column, so the paragraph's indent shifted it.
- Fix 2: `floatNode` stores the float's page x (`data-hpage`); `placeFloats` sets `left` against the paragraph's actual left. Wrapped floats and aligned floats are unchanged.
- Shape fill and line colours now keep alpha, lumMod, lumOff, tint and shade (`clrA`); a fill with alpha 0 is no fill.
- Not done: a fill taken from a shape style reference; nested groups (their shapes are skipped); text in a free-form shape.
- Checked on the owner's file: 87 floats read (23 groups, 36 pictures, 28 shapes), 27 free-form shapes; no large solid black fill remains. Layout not seen on a device.
- Files: `src/js/office-read.js`, `src/js/office-render.js`.

**253. Persisted Vault index and lazy body search (Phase 17, stage N, first part).** Carries out the index, search and Trash items of stage N in Decision 195; supersedes the memory-only rule of Decisions 39 and 151 for what is listed here. Thumbnails and entry-bound field encryption are not in this part.
- Two blobs in `meta`, each encrypted under the Vault key with the same AES-GCM call as the entry fields. `vault_index_blob`: per live entry a fingerprint, label, description, size, Money and Location details; per trashed entry a fingerprint and label. `vault_text_blob`: note text and file OCR text. Neither key is in `APP_SETTINGS_KEYS`, so neither is in a backup; a restore leaves them and the fingerprints catch any change.
- Fingerprint: the last 20 characters of each stored encrypted field of the row (label, description, and body or meta). Those characters hold the random IV, so any re-encryption changes it. Made in SQL for the light read and in JS for full rows; the two are equal.
- Unlock: one light read of every Vault row (no bodies), the tag read, one blob read. An entry whose fingerprint matches comes from the blob; any other is rebuilt from its row (one bulk read above 50). Schedule columns and tags always come from the rows, since a notification action can change a schedule while the Vault is locked. A missing, unreadable (wrong key, damaged) or stale blob only costs the rebuild. "Preparing Vault: N of M" shows at 10 or more rebuilt entries.
- Write: debounced, serialised, failure ignored (the blob is a cache). A change pending at lock is serialised before the key is dropped.
- Name search: synchronous, in memory, lower case with accents folded; ranked label, then tag and extension, then description and Money or Location details.
- Body search (note text, file OCR text): separate and lazy. The text is loaded on the first body search of an unlock, from the text blob where fingerprints match and from the rows otherwise, then written back if changed. The Vault search layer draws name matches at once and appends body matches when loaded.
- Entries no longer carry `searchableText`. The note editor reads a Vault note's text from its row when opened (`vaultNoteText`).
- Vault Trash: labels come from the stored index, with no decryption per row; a new or changed row is decrypted once and kept.
- Differences from Decision 195: tags are read from the tag table at unlock, not stored (they are plaintext there already, and the read keeps them current); normalised strings are made in memory at load, not stored; dates and extension come from the light read.
- Not in this part: encrypted thumbnails; field encryption bound to entry id and field name (it changes the stored form of every entry, so it goes with O); timings at 0, 500 and 5000 items.
- Files: `src/js/vault.js`, `src/js/app.js`.
- Checks: 36 Node checks against the real schema (cached unlock reads no entry and decrypts only the blob; a re-encrypted entry is the only one rebuilt; schedule change read from the row; accent-folded and ranked name search; body search from the blob; trash and restore; label from the stored index with no decryption; change flushed at lock; wrong key and damaged blob; bulk rebuild with progress; blobs hold no plaintext); `vite build` passes.
- Risks: not run through CI or on a device (DP108). Stale detection relies on every write to an encrypted field re-encrypting it; no path writes otherwise. The first body search of a large Vault reads every note once. No change to credentials, backup format, restore or network use.

**254. Encrypted Vault thumbnails (Phase 17, stage N, second part).** Carries out the thumbnail item of stage N in Decision 195; supersedes Decision 162's "thumbnails are memory only" for the Vault. Home thumbnails are unchanged.
- One small file per Vault image in `vthumbs/`, named by the SHA-256 of the entry id (no table of names, no id in the name). Content: `{ p, d }` (the image's `file_path`, a JPEG data URL), AES-GCM under the Vault key, the same call as entry fields.
- Read: `getVaultThumb` returns the data URL only when the file opens under the current key and `p` equals the row's `file_path`; otherwise the thumbnail is made again from the full image and written (`putVaultThumb`). A replaced image, a new key or a damaged file therefore only cost one decode.
- Made when a tile first needs it, not at capture: the capture and Move paths are untouched. `thumbMem` still holds data URLs while unlocked and is emptied at lock.
- Sweep: after the index build at unlock, off the unlock path, `sweepVaultThumbs` removes every file in `vthumbs/` that no Vault image row (trashed ones included) maps to. This covers delete, purge, Move to Home and a restore that wipes rows, so no delete path changed.
- Index entries now carry `filePath`, read from the row at unlock.
- Not in backups: the export names its categories and does not read `vthumbs/`; after a restore the thumbnails are made again on view. The orphan sweep of `files/` does not look in `vthumbs/`.
- `files.js` gains `writeText`, `readText`, `removePath`, `listPaths` (text by path, folder listing); the caller encrypts.
- Not in this part: field encryption bound to entry id and field name (goes with O); timings.
- Files: `src/js/files.js`, `src/js/vault.js`, `src/js/app.js`.
- Checks: 12 Node checks (path on entries; hash file names; stored text is ciphertext; round trip; wrong key gives none; replaced image ignored; filePath on a cached unlock; sweep keeps trashed, removes deleted and stray, repeat removes none) plus the 36 of Decision 253; `vite build` passes.
- Risks: not run through CI or on a device (DP109). Thumbnail files are visible on disk as count and size (a few tens of KB each, ciphertext), like Vault files. No change to credentials, backup format, restore or network use.

**255. Restore of Vault items under another Vault key (Phase 17, stage O, first part).** Carries out stage O of Decision 195. Owner approved. Cause: the restore screen passed neither a source PIN nor this device's Vault key, and Overwrite never replaced the wrapper, so Vault entries made under another key (another phone, or a Vault reset since the backup) were inserted but could not be opened.
- `src/js/vaultrestore.js`, `planVaultRestore`: runs once the backup passkey has opened the archive, before anything is changed. It compares the archive's wrapped key with this device's by the check value stored in the wrapper (no PBKDF2). Both formats use it.
  - No Vault entries in the restore, or the category not chosen: nothing.
  - Same key (also when the PIN was changed after the backup): entries are inserted as they are.
  - Append, other key: the PIN set when the backup was made is asked; it is checked against the archive's wrapper in the window; the source key is opened once (it was one PBKDF2 per entry) and every entry field is re-encrypted under this device's key; file keys are re-wrapped and file bytes are not touched. This device's Vault must be unlocked; the window unlocks it first.
  - Overwrite, other key: after the old rows are removed and before the first entry is written, this device's wrapper is replaced by the archive's. No PIN is asked: the backup passkey is the proof, as for the rest of the restore. The Vault locks, the fingerprint copy is turned off, and the status line says the Vault PIN is now the one set when the backup was made. The earlier PIN no longer opens the Vault. This replaces the Vault; it does not recover a forgotten PIN (Decision 195 keeps the PIN as the only way to the key).
  - Append with no Vault on this device: refused, set up the Vault first.
  - Vault entries with no wrapper in the archive (made before stage L): refused before any change.
- The engine returns `vault_pin_needed`, `vault_pin_wrong`, `vault_locked`, `vault_not_set_up` or `vault_old_format` before touching anything; the first two carry `vaultWrap`. Cancel at the unlock or the PIN window changes nothing.
- Not changed: the three credentials stay independent; the safety backup, Append default and the Overwrite warning; the archive format; no network use. The Vault PIN hint is not in the archive and stays as it was after Overwrite.
- Not in this part: field encryption bound to entry id and field name (still open under O: it changes the stored form of every Vault entry, the index blobs and the archive).
- Files: `src/js/vaultrestore.js` (new), `src/js/backup.js`, `src/js/app.js`.
- Checks: 18 Node checks on real crypto (no entries, category off, no wrapper, same key under another wrapper, PIN needed, wrong PIN, locked, no Vault here, rekey round trip, replace and flag, same changes nothing, unreadable wrapper); `vite build` passes.
- Risks: not run through CI or on a device (DP110). Re-keyed Vault files, the format 1 path and a restore stopped part-way were not exercised in Node. The Drive restore calls the same engine and has no screen yet.

**256. Vault index rebuild stays sequential (Phase 17, stage N, timings).**
- Rule: `buildVaultIndex` rebuilds stale entries one at a time. Warm unlock reads the stored index and decrypts one blob; only a stale entry is decrypted.
- Cause: measured in Node at 5000 items, cold 633 ms and warm 72 ms. Rebuilding 16 at a time gave 539 ms cold, a gain inside run-to-run spread, for a change to green code.
- Revisit only if an on-device cold build (DP111) is slow enough to show; the batch size is the single change to try.
- Not changed: index and blob formats, fingerprints, search, the three credentials, network use.

**257. Vault fields bound to entry id and field name (Phase 17, stages N and O, last open item).** Carries out the binding named in Decision 195 and left open in 172, 253, 254 and 255.
- Cause: AES-GCM with no additional data opens a ciphertext copied from another entry or field.
- Rule: a Vault field is encrypted with `id|field` as additional data (`fieldAad`; fields `label`, `desc`, `body`, `meta`) and stored as `{"v":2,"cipher","iv"}`. The mark comes first so the random IV stays in the last 20 characters (Decision 253 fingerprint). The two index blobs use `blob|<meta key>`.
- Reading: a marked field opens only with the same additional data; a missing one throws. An unmarked field opens as before. Removing the mark makes it fail.
- Writing: every write binds. New entries pick the id before any field is encrypted. Edit, label, description, meta and blob writes pass the id they are stored under.
- Existing data: one forced pass at the first unlock after the update (`vault_bound_v2` in `meta`, not in a backup). Every entry, trashed ones included, is rebuilt once and its unmarked fields are re-encrypted bound; the rebuild notice shows when 10 or more. A field that does not open is left as it is. The body of a file entry from before Decision 212 is not read by the pass and is bound when the entry is edited.
- Restore: Append under another key opens each field with the source key and binds it to the stored id. Same key and a new id (a trashed row owns the old id): a marked field is opened and bound to the new id; an unmarked one is kept and the flag is cleared so the next unlock binds it. A marked field that needs a key while the Vault is locked stops that entry with a message.
- Not bound: thumbnails (`vthumbs/`), file keys wrapped under the Vault key, stored Vault settings. Wrong thumbnail or setting content is cosmetic or unreadable, not another entry's data.
- Cost: warm unlock unchanged (57 to 72 ms at 5000 items in Node). The forced pass costs once: 1.8 s at 5000 items in Node, 0.24 s at 500; more on a phone.
- Not changed: the three credentials, Append as the default restore path, the safety backup, the archive format, no network use.
- Files: `src/js/crypto.js`, `vault.js`, `backup.js`, `fileactions.js`, `move.js`.
- Checks: 33 Node checks against the real schema and real crypto (bound round trip, wrong id or field, missing data, removed mark, wrong key, legacy opens both ways, IV in the fingerprint tail, forced pass over 120 legacy entries with trashed and unmigrated rows, warm build rewrites nothing, swapped label and body refused, new entry bound, restore same id, new id, no key, legacy kept with flag cleared, rekey from bound and unmarked sources, pre-label backup); `vite build` passes.
- Risks: not run through CI or on a device (DP112). The forced pass writes up to four fields per entry on the phone. Restore was exercised on the extracted insert function, not through the whole engine.

**258. Committed lockfile and `npm ci` in CI (Phase 1, CI).** Carries out the lockfile proposed in Decision 249.
- Cause: with no lockfile every CI run took the newest release of every package, so one bad release (Decision 249) fails the build.
- Rule: `package-lock.json` is committed and `build-android.yml` runs `npm ci` instead of `npm install`. The run installs exactly what the lockfile names, from `https://registry.npmjs.org`, and fails if `package.json` and the lockfile disagree.
- The `overrides` pin from Decision 249 stays; the lockfile records `@trapezedev/project` at 7.1.10.
- Updating a dependency now means regenerating the lockfile and committing it together with `package.json`.
- Checked: a clean `npm ci` then `vite build` passes (427 packages, all from the registry above, no credential in the file).
- Risks: not run through CI. CI uses Node 20 and the lockfile was made with Node 22 and npm 10 (format supported by both).
- Not changed: application code, credentials, backups, network use of the app.
- Files: `package-lock.json` (new), `.github/workflows/build-android.yml`.

**259. R8 code shrinking and renaming for the release build (Phase 10).** Carries out the ProGuard/R8 item of Decision 13.
- `scripts/patch-r8.js` (new, run by `build-android.yml` after the version step): sets `minifyEnabled true` in the release buildType and writes `android/app/proguard-rules.pro` once (marker line). Idempotent; aborts if the template has no release buildType with `minifyEnabled false`.
- Resource shrinking stays off: notification icons and tones are looked up by name and the resource shrinker cannot see that.
- Kept by rule: annotations and signatures; Capacitor core, the Cordova layer and every `CapacitorPlugin` class with its `PluginMethod` methods; `@JavascriptInterface` methods and every `Arkly*` bridge class; broadcast receivers; the encrypted database engine (`net.zetetic`, `net.sqlcipher`, the sqlite plugin); the plugin packages loaded by class name (`ee.forgr`, `com.codetrixstudio`, `com.xitronix`, `com.ryltsov`, `com.capacitorjs`). Warnings about optional classes of the archive libraries are silenced (`-dontwarn`, `-ignorewarnings`). Stack traces keep file and line.
- Not changed: web bundle, credentials, backups, network use. The app makes no new call.
- Checked: the script ran on a freshly generated Android project, once and twice (one change in `build.gradle`, rules file written once); package names in the rules checked against the installed plugins. The rules were not run through R8 and the build was not run.
- Risks: not run through CI or on a device (DP114). A class reached by name that the rules miss shows as a crash or a missing feature in the release build only. To go back, remove the step from `build-android.yml`.
- Files: `scripts/patch-r8.js` (new), `.github/workflows/build-android.yml`.

**260. No obfuscation of the web bundle (Phase 10).** Replaces the JavaScript obfuscation item of Decision 13 and ARCHITECTURE section 8.
- Rule: the web bundle is minified by Vite (default) and not obfuscated.
- Cause: the source is public in the repository, so obfuscated output hides nothing a reader cannot already open, and obfuscation slows start-up and run time and enlarges the bundle, against the speed goal.
- `javascript-obfuscator` stays in `devDependencies` unused; removing it changes the lockfile and is left for a later change.
- Not changed: the startup signature check of Decision 13 (next in Phase 10).

**261. Startup signature check (Phase 10).** Carries out the signature check of Decision 13.
- Rule: at open the page asks `window.ArklySignature.check()`. The answer is `match`, `mismatch` or `unknown`; only `mismatch` shows a sticky notice ("not signed with the original release key"). Nothing is blocked and no data is touched; `unknown` (no bridge, nothing readable, any error) shows nothing.
- Build: the workflow reads the release certificate's SHA-256 fingerprint from the keystore (`keytool`, password through the environment, never the command line) into `ARKLY_CERT_SHA256`; `scripts/patch-signature.js` writes it into `ArklySignatureBridge.java`, copied next to `MainActivity.java` and registered in `onCreate` like the other bridges. A fingerprint that is missing or not 64 hex characters stops the build, so the check is never silently left off. A fingerprint is public; no secret is written anywhere.
- A build signed by someone else's keystore (a fork) carries that keystore's fingerprint and matches itself.
- Limit: the expected value lives in the APK. Someone who repackages the app and edits it removes the check. It raises the cost of a plainly re-signed copy and no more (Decision 13).
- Not changed: credentials, backups, network use (the check is local).
- Checked: the Java bridge compiled and run against stubs of the Android classes (match, mismatch, unknown, both API paths); the patch script run on a generated project (registered once, rerun safe, refuses a missing fingerprint); the `keytool` extraction equal to the certificate's SHA-256; `vite build` passes. Not run through CI or on a device (DP115).
- Files: `scripts/java/ArklySignatureBridge.java` (new), `scripts/patch-signature.js` (new), `.github/workflows/build-android.yml`, `src/js/app.js`.
- The bridge class matches the `**.Arkly*` keep rule of Decision 259.

**262. Map view not built (Phase 9).** No map that loads tiles from the network: it would be a third network call. Offline map data bundled in the app is not planned. The item is dropped until that changes; saved locations stay on the timeline and open in the device's map app as before.

**263. Money chart under the month header (Phase 9, expense charts).** Carries out the expense charts of ARCHITECTURE section 3.
- Rule: the Money summary (Home and Vault, one shared painter, Decisions 129 and 135) shows Spent and Received bars under the month totals. Mode `6 months`: the six months ending at the shown month. Mode `This month by week`: the weeks of the shown month, Monday to Sunday, the first and last cut at the month edges.
- Data: the same details objects as `monthTotals`; loans never count; each bar is the sum of `monthTotals` for that period (checked). One pass over the items, no new query. Home reads the database as before; the Vault reads only its unlocked in-memory index and the chart is cleared with the box when the folder closes or the Vault locks.
- Reading: Spent is the solid bar and Received the outlined one (distinct without colour), with a legend. Tapping a bar pair, or Enter on it, writes that period's two amounts into a line under the chart. An empty range shows a message and keeps the mode switch.
- The mode is per folder, in memory only; nothing is stored.
- Not changed: money data and formats, backups, credentials, network use (the chart is local SVG, no library).
- Checked: 22 Node checks (six-month range and year wrap, week boundaries, month starting Monday, leap day, loans and empty items excluded, sums equal `monthTotals`, markup free of NaN, empty state); 2.3 ms per redraw at 20000 items; rendered in light and dark themes and viewed; `vite build` passes. Not run on a device (DP116).
- Files: `src/js/money.js` (`trendBuckets`), `src/js/moneychart.js` (new), `src/js/app.js`, `src/css/style.css`.

**264. Quick-capture widget: design and what it must close first (Phase 9). Built in Decision 266.** Records the plan and the findings from reading the capture flows.
- Entry: an `AppWidgetProvider` with four buttons (Note, Voice, Image, Money). Each sends a `VIEW` intent with `arkly://capture/<note|voice|image|money>` through an immutable `PendingIntent`. The page receives it with `@capacitor/app` (`getLaunchUrl` on a cold start, `appUrlOpen` when running). Native side: provider class, layout, widget info, icons, a manifest receiver and intent filter, written by a new `scripts/patch-widget.js` with `patch-manifest.js`; nothing else native, no permission, no network.
- Money is the Money form with Spent preselected.
- App unlocked or no app-open password: the flow opens directly over the current screen.
- App locked (the spec, ARCHITECTURE section 6): creation only. The database key is independent of the app-open password (Decision 158), so the database is open, and the lock gates the screens only. A capture-only mode keeps the lock screen underneath, opens one capture flow, and returns to the lock screen on save, cancel, Back or backgrounding. It never shows another screen, never renders the timeline, and skips the daily ad gate (full opens only). The Vault is never reachable from it.
- Found in `startCapture` and the dialogs it opens: each would show stored data to someone holding a locked phone. These must be closed before the widget is built: unsent drafts restored into the note editor and the Money and Reminder forms (`noteDraftHandlers`, `formDraft`); label suggestions from `label_history` in the Save dialog; the list of existing tags in the Save dialog; category, method and person suggestions in the Money form (`moneyItems`); `renderMainTimeline` after each save. In capture-only mode each is off: no draft read or written, empty suggestion sources, no timeline render. The Voice and Image flows are not yet read for the same.
- Exposure: the activity is exported, so another app can send the same link. Capture-only shows no stored data and saves only after the person confirms the Save dialog.
- Left to the owner: approval to relax the app-open lock for creation only, as the specification says. No other credential is touched.
- Not changed: nothing in the code.

**265. Widget captures go to a separate inbox and move to Home at unlock (Phase 9). Built in Decision 266.** The owner's idea; replaces the capture-only mode of Decision 264. The widget entry (deep link, provider, patch script) stays as in 264.
- Rule: a capture started from the widget is written to its own table, `widget_inbox` (id, type, label, description, body_text, money_json, file_path, file_key, created_at), never to `entries`. Added with `CREATE TABLE IF NOT EXISTS` in the schema.
- Screen: a minimal capture screen of its own (Note: text; Money: amount, kind Spent preselected, optional note; Voice: record; Image: camera). A default name, no Save dialog, no tags, no suggestions, no drafts. It reads no Home table, renders no timeline and shows no stored entry. It confirms the save, may show how many widget items are waiting, and returns to the lock screen or leaves the app. This closes every item in the list of Decision 264 by construction.
- Transfer: at unlock (`onUnlocked`), and straight after a widget save when the app is already open or has no password, each inbox row is inserted into `entries` with the same id and its original time, then deleted. Insert first with `OR IGNORE`, delete after: a crash in between repeats harmlessly. One toast says how many items were added. Files stay where they are; the path and key move to the entry row.
- Home gets the items with the usual indexing (search, Voice, Image and Money folders). The Vault is never reachable from the widget.
- Backup: Export Now first moves any waiting items to Home. Restore with Overwrite clears the table; Append never reads it. The start-up sweep of unreferenced files counts inbox file paths as kept. Removing all data clears it.
- Exposure: the activity is exported, so another app can send the widget link; the screen shows nothing stored and saves only after the person confirms.
- Left to the owner: approval to build this; approval to relax the app-open lock for creation only (the specification) still stands. No other credential is touched; the inbox sits in the same encrypted database.
- Not changed: nothing in the code.

**266. Quick-capture widget built (Phase 9). Not run through CI, not run on a device (DP117).** Builds Decisions 264 and 265; the owner approved.
- Native: `scripts/patch-widget.js` (workflow step after `patch-fileops.js`) copies `scripts/java/ArklyWidgetProvider.java` next to `MainActivity.java`, writes the widget layout, provider info (4 by 1 cells, resizable across) and two shape drawables, and registers the receiver, not exported. Four buttons, each the app's own line icon in a brand-gradient disc with its label below, on a violet gradient panel: Note, Voice, Image, Money. Icons are vector drawables written by the script. No permission, Gradle change or network call.
- Link: `arkly://capture/<note|voice|image|money>` through an explicit, immutable `PendingIntent`. No intent filter, so no link another app or a web page can open by itself. `widget.js` accepts only those four exact links (`getLaunchUrl` at start, `appUrlOpen` while running) and ignores any other.
- Screen: `widget.js`, its own layer above every screen, built in script. Note: text. Money: kind (Spent preselected; Lent, Received, Borrowed also offered), amount, optional note; no person, category or method. Voice: record, play back, Save. Image: camera button (file input with `capture`), preview, Retake. Names: first line of the note; the Money summary; `Voice <time>`; `Image <date time>`. The only stored value read is `meta.currency_symbol`.
- Locked: the screen opens over the lock screen. Save writes the inbox, shows how many are waiting, then sends the app to the background. Cancel and Back close it to the lock screen. A lock or backgrounding closes it and drops an unsaved capture (no drafts). The fingerprint offer is skipped while it is open.
- Unlocked, or no app-open password: Save writes the inbox, moves it at once, toasts "Saved" and redraws the timeline.
- Inbox: `widget-inbox.js`; table `widget_inbox` from Decision 265 plus `extension` (the voice or image file type). `transferInbox` inserts each row through `insertEntry` (id and original `created_at` kept, usual indexing) when the id is not yet in `entries`, then deletes the row; a failed row stays. This replaces `OR IGNORE`, which would have skipped the search index. Runs at the start of `onUnlocked` (toast "N widget items added"), after a widget save when unlocked, at the start of `createBackup` and of the Drive backup.
- Backup and files: Overwrite (`wipeCategories`) clears the inbox and its files when entry categories are replaced; Append never reads it. The orphan sweep in `files.js` keeps inbox paths. No remove-all-data feature exists; nothing to change.
- Network: unchanged, the ad unit and the tap-only update check. Credentials: none touched; the Vault is not reachable. Ad gate: not changed; the widget never reaches it.
- Exposure: the activity is exported, so another app can send the same explicit intent; the screen shows nothing stored and saves only on Save.
- Checked in a Node harness (in-memory SQLite): transfer, repeat after a crash between insert and delete, failed row kept, clear. `patch-widget.js` run twice on a stand-in `android/` tree: second run adds nothing. `vite build` passes.
- Not verified: camera `capture` input in this WebView, widget layout on a device, `getLaunchUrl` on a cold start from the widget. Relaunch from recents may deliver the old link and open an empty capture screen; nothing stored is shown.
- Left to the owner: DP117.

**267. Widget: compact look, type colours, More (Phase 9). Not run through CI, not run on a device (DP117).** The owner's request after the first look at Decision 266.
- Look: a 60dp panel centred in the one-cell area. At the left the app logo (`@mipmap/ic_launcher`) and "Arkly" (a tap opens the app); then Note, Voice, Image, Money, More. Each disc uses that type's colour from the app (note amber, voice teal, image pink, money red, More violet) with the app's line icon. Shapes and icons are written by `patch-widget.js`.
- More: `arkly://capture/more` opens four coloured tiles: Reminder, Location, PDF, File. Same rules as Decision 265 (creation only, nothing stored shown, no drafts); a tile opens its capture in the same layer.
- Reminder: text, date and time, repeat (none, daily, weekly, monthly). The notification is scheduled at Save, not at unlock, so it rings on time while the app stays locked; the entry appears at unlock under the same id. Save fails if scheduling fails; a failed inbox write cancels the notification. Done or Snooze tapped before unlock finds no entry (not verified).
- Location: one GPS fix (permission asked when needed) and an optional name. No pasted coordinates, no map.
- PDF, File: one file from the system picker; the file name is the label and its extension is kept. No text extraction, no tags, no category.
- Inbox: `widget_inbox` gains `fire_at`, `repeat_rule`, `latitude`, `longitude`; `ensureColumn` adds them on installs from Decision 266.
- Network: unchanged. Credentials: none touched. The Vault is still not reachable.
- Not verified: the logo and vector icons inside the widget host, geolocation and the file picker while locked, Done or Snooze before unlock.
- Left to the owner: DP117, extended.

**268. Autosave of the details edit of Voice, Image, PDF and File (Phase 19). Not run through CI, not run on a device (DP118).** The gap left in Decision 190.
- Rule: the Edit details dialog (name, note, tags) of a Voice, Image, PDF or File entry, Home and Vault, keeps its fields like the Location details edit. Committed at the next unlock (Home) or Vault unlock (Vault) onto the entry as a normal Save would. When the entry is gone, an Autosave text entry lists the fields.
- Scope: edits only. The files themselves are not touched, and there is no draft for a new Voice, Image, PDF or File (Decisions 179 and the capture flows own those).
- Code: `autosave.js` adds the four kinds (`details`, details-only, edit-only); `app.js` adds them to `FORM_DRAFT_KEYS` and `editEntryUI` creates the draft for any kind listed there. Rows: `form_edit_draft_<kind>` and `vault_form_edit_draft_<kind>`. No new commit code.
- Checked: Node checks on `resolveFormDraft` for the four kinds (complete edit, empty draft, new entry returns nothing, entry gone gives a note); `vite build` passes.
- Phase 9 closed: the confidence-confirmation item is the reminder offer sheet of Decision 175; no second confirmation is built.
- Network, credentials, backup: unchanged. Draft rows stay out of backups as before.

**269. Ads dropped (Phase 12).** The owner decided the app will not show any ad.
- Phase 12 is closed as dropped. No AdMob plugin, rewarded unit, daily gate or ad-related network call will be added.
- Supersedes Decision 58 (deferred) and the daily-gate design in ARCHITECTURE. `src/js/ads.js` is unused and is not imported anywhere; it stays until the owner asks for its removal.
- The app's only network call is now the tap-only update check, plus the optional Drive backup.

**270. Category card numbers: tint with the type's ink (Phase 15, light-theme tuning). Not run through CI, not run on a device (DP119).** The owner: the numbers on the category cards look odd and are hard to read.
- Cause: the count badge used near-black text on the solid type colour, heavy and dull in both themes.
- Fix: badge background is the type colour mixed into the card surface (14% light, 24% dark), the number uses the type's own ink colour (`--tc-ink`, already tuned per theme), 11px bold. A plain surface colour is the fallback where `color-mix` is missing.
- Contrast computed for all nine types: 4.3 to 6.1 in the light theme, 5.0 to 7.6 in the dark theme at the mixes first tried; the light mix was lowered to 14% to raise it.
- Files: `src/css/style.css`. `vite build` passes.

**271. Access check on the automatic backup (Phase 21 P4). Not run through CI, not run on a device (DP120).** The owner chose to add the check after the review in Session 152.
- Finding: the automatic backup is a Drive upload that runs on app open when due and asks the backup passkey through a banner. No passkey is stored, so the stored passkey planned in Decision 199 is not needed and is not built; the rule that the backup passkey is never stored stands.
- Built: `confirmBackupAccess(categories, purpose)` (Decision 202) now runs before turning automatic backup on, before changing its frequency, before the banner's Back up now (after the passkey and its strength check) and before Connect Google Drive. Same asking as a manual backup: the app password if set, the Vault PIN if the Vault is set up (all categories are included), or one fingerprint. `purpose` only changes the sentence in the window.
- Not asked: turning automatic backup off, Disconnect, Skip, restore, the safety backup, extract to device storage.
- A refusal puts the switch or the frequency back and shows a notice; the banner stays open.
- Still a gate on the in-app action, not a key. Nothing is stored or recovered; the three credentials stay independent.
- Files: `src/js/app.js`. `vite build` passes.
- Left to the owner: DP120.

**272. Google Drive connect: CI on/off switch, Web client ID (Phase 13). Not run through CI, not run on a device (DP121).** The owner asked for Drive connect to be built.
- Finding: `gdrive.js`, the Settings UI and the sign-in plugin were already built; the only blocker was the manual Google Cloud setup and the guard held at `false` in code. The sign-in plugin requests an ID token with the configured client ID, which Google Sign-In accepts only for a Web application client; the Android-client ID written in the older setup notes would fail with error 10.
- Switch: the repository variable `GDRIVE_WEB_CLIENT_ID` (not a secret; the ID is inside the APK). `scripts/patch-gdrive.js`, a workflow step before the web build, validates it, writes `plugins.GoogleAuth` (scope `drive.file` only, no offline access, `androidClientId` set to that ID) into `capacitor.config.json` in the CI workspace, never committed, and exports `ARKLY_GDRIVE_CONFIGURED`. `vite.config.js` defines `__GDRIVE_CONFIGURED__` from it and `gdrive.js` uses that as `GOOGLE_DRIVE_CONFIGURED`. A malformed value fails the build; no variable leaves Drive off, which keeps the Session 21 crash guard.
- Setup values: the signature step now also writes the package name and the release SHA-1 (public) to the run Summary, so no keytool command is needed. `android-notes/native-setup.md` section 11 rewritten: Web client, Android client, variable, rebuild.
- Network: the Drive calls already existed and run only when the person connects, backs up, restores or an automatic backup is due; this adds none. Credentials: none touched; the access check of Decisions 202 and 271 still precedes connecting and the automatic backup.
- Checked: `patch-gdrive.js` with no value, a malformed value and a valid value; `vite build` with the flag; the SHA-1 line extracted from a test keystore; the workflow file parses. Not run against a real Google account.
- Left to the owner: the Google Cloud setup and the variable (section 11), then DP121.

**273. Package id and internal names changed to Arkly (everything except two format identifiers). Not run through CI, not run on a device (DP122).** The owner asked for every Dumpzone name to become Arkly, including `com.dumpzone.app` to `com.arkly.app`. Supersedes the "kept" list of Decision 165.
- Changed: package id `com.arkly.app` (`capacitor.config.json`); database file `arkly.db`; notification channel ids `arkly_reminders_v2` (current) and `arkly_reminders` (the id deleted at start, absent on a fresh install); biometric entry names `arkly.app-password` and `arkly.vault-pin`; the Drive folder lookup uses only `Arkly Backups` (Drive was never connected in any build, so no `Dumpzone Backups` folder exists). The setup notes and ARCHITECTURE describe the new names. Numbered Decisions and Sessions keep the earlier name where they record history.
- Consequence: Android treats `com.arkly.app` as a different app. It installs next to the old one with no data, no fingerprint enrolment and no scheduled reminders, and the old app cannot be updated into it. Data moves through the app's own backup: a full local backup in the old app, a Restore in the new one (DP122). The in-app update check will offer the new package as a normal install. Backups do not contain the package id or database name, so they restore into the new app.
- Kept: the keystore alias `dumpzone` and the `KEY_ALIAS` secret (internal to CI; invisible in the app; renaming needs a new keystore and four new secrets, and the signing certificate is unchanged so the startup signature check of Decision 261 is unaffected); the `.dz` backup extension and the backup format magic bytes (changing them would stop existing backups, including the one used for this move, from restoring). Either can change later on request: a new keystore is now possible without losing update continuity, and a reader that accepts both magic values would allow a new extension.
- Google Drive: the OAuth Android client must use package `com.arkly.app`. No Drive setup had been done under the old id, so nothing is lost.
- Network, credentials, backup format: unchanged.
- Checked: no `dumpzone` text remains in `src/`, `scripts/`, the workflow or `capacitor.config.json`; `vite build` passes. Not run through CI.
- Left to the owner: DP122, and the Google Cloud Android client with the new package name when Drive is set up.

**274. Public homepage and privacy policy for the Google consent screen (Phase 13).** Added because Publish app stayed disabled in Google Cloud with every required Branding field filled and no verification required.
- Files: `docs/index.html` (homepage) and `docs/privacy.html` (privacy policy), plain static pages with no script and no outside request. Served by GitHub Pages from the `docs` folder of `main` at `https://g-c-3.github.io/starfish/`.
- Content: data stays on the device, no account, server or analytics; the permissions and why; Drive backup opt-in with the `drive.file` scope, encrypted on the device with a passkey that is never stored; the tap-only update check as the only other network use; contact through the repository's issue page, no email address.
- Google Cloud Branding: home page `https://g-c-3.github.io/starfish/`, privacy policy `https://g-c-3.github.io/starfish/privacy.html`, authorised domain `g-c-3.github.io`. No logo (a logo forces verification).
- A docs-only push does not start a build (Decision 165 `paths-ignore` covers `docs/**`).
- If Google still keeps Publish disabled, the cause is not in these fields and the next step is a screenshot of what the console shows.

**275. Release step made safe for a re-run (CI).** A build log showed every step green and the APK uploaded, then "Create GitHub Release" failing because the tag `v<version>` already existed: a re-run keeps its run number, so the tag is the same.
- Fix: the step looks for the release; when it exists it replaces the APK on it (`gh release upload --clobber`), otherwise it creates it as before.
- Effect: a re-run ends green. A release keeps one APK per version.

**276. Drive sign-in crash fixed: the plugin was never initialised. Not run through CI, not run on a device (DP121).** First tap on Connect Google Drive in the build with Drive on crashed the app: `NullPointerException` in `GoogleAuth.signIn`, native, uncatchable from JS.
- Cause: the sign-in plugin's `load()` is empty and its native sign-in client is created only by `initialize()`. `gdrive.js` called `signIn()` without it. Decision 272 turned the guard on, so the call was reached for the first time. The earlier Session 21 crash had the same cause, wrongly attributed to a missing client ID.
- Fix: `initGoogleAuth()` calls `GoogleAuth.initialize()` once per process, before `signIn()` and before `signOut()` (which also uses the client). Client ID, scopes and no offline access come from the `GoogleAuth` block written by `scripts/patch-gdrive.js`. `signOut()` does nothing while the guard is false.
- Why correct: the plugin source shows `initialize()` as the only place the client is built; `signIn()` and `signOut()` both dereference it. A rejected `initialize()` clears the cached promise so the next tap retries.
- Still needed on the Google side: the Android OAuth client with package `com.arkly.app` and the release SHA-1. Without it sign-in now fails with a normal error (such as 10) shown in the app, not a crash.
- Files: `src/js/gdrive.js`. `vite build` passes.

