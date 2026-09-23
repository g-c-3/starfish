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
flipped to `true`.** Root cause of the actual "Dumpzone keeps stopping" crash, confirmed by a real
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
