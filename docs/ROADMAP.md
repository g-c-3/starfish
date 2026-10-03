# Roadmap

## Minimum (quick reference)

- [x] 0 — Repo scaffold & docs
- [ ] 1 — Infra & secrets
- [ ] 2 — Core data layer
- [ ] 3 — Capture & intent engine
- [~] 4 — App shell & control flow (5 reported bugs fixed — Session 31; 8 capture cards, 1 still placeholder: Money; Reminder Session 56 and Location Session 57 built, main only)
- [~] 5 — Native plugin wiring (voice recorder + permissions done, needs device confirm; OCR/noise-toggle/sound asset not)
- [~] 6 — Backup & restore engine (core logic done, UI wired, not device-tested)
- [~] 7 — Per-file actions (all four built, attached to the Home folders and the Vault list; Download for append removed — Session 61)
- [~] 8 — Tags & label UX (tag picker, label-history hint, main-capture batch add wired — Session 62; Vault batch add not)
- [~] 9 — Additional features (auto-lock, digest, on-this-day, storage breakdown, Your Data screen, backup-reminder banner done; rest not started)
- [~] 10 — Security hardening (biometric unlock done, needs device confirm; Privacy Screen done as a real Settings toggle — Decision 64; obfuscation/ProGuard/signature check not)
- [~] 11 — CI/CD (build workflow committed, live green run not yet confirmed; auto-release added Session 49, update check changed to manual Settings button Session 50)
- [ ] 12 — Ads integration
- [ ] 13 — Google Drive backup (optional, opt-in, core logic done, no UI, blocked on manual OAuth setup)
- [~] 14 — Private Vault (Text/Voice/Image/PDF/Files, encrypted at rest, in-memory search, own trash/auto-lock)
- [~] 15 — UI redesign (1 design system, 2 auth/Settings screens, background art done — Sessions 64–67; 3 folded into 16A, 4 polish not started)
- [x] 16-pre — Snooze and Done from the notification without opening the app (confirmed on device — Session 81)
- [~] 16 — Open & edit (A unified Save dialog and B text editor done — Session 69; E reminder detail done — Session 70, F location detail done — Session 71, C voice recorder + player done — Sessions 82–83, D image viewer, G open Files with phone app, H PDF viewer)

## Detailed

- [x] **0 — Repo scaffold & docs.** Docs and scaffold (`www/`, `capacitor.config.json`,
  `package.json`, `.github/workflows/build-android.yml`, `android-notes/native-setup.md`) both
  confirmed committed on `main`.
- [ ] **1 — Infra & secrets (manual).**
  - [x] Package name: `com.dumpzone.app` (set in `capacitor.config.json`).
  - [x] Android signing — keystore generated (alias `dumpzone`) and 4 GitHub secrets set. CI
    run against the live secrets not yet confirmed green — pending manual check.
  - [ ] AdMob account, one Rewarded ad unit (not Interstitial). **Deliberately not doing this yet
    (Decision 58)** — ads deferred to a future build, not this one.
  - [x] App icon — source artwork at `resources/icon.png`; CI generates all densities via
    `@capacitor/assets`. Confirmed on-device (Session 7): initial version rendered visibly smaller
    than sibling icons (double safe-zone padding — see Decision 24); re-cropped full-bleed and fixed.
  - [ ] Play Console account — deferred; revisit when the app is fully ready (Decision 98).
- [ ] **2 — Core data layer.** `db.js` (schema, FTS5, tags, label history, soft-delete),
  `crypto.js` (PBKDF2/AES-GCM). Committed; not device-tested. Stale pre-rebrand naming
  (`actioner.db`, header comment) fixed earlier. **Vault pivot:** `is_private` generalized from
  notes-only to any type; app-password columns now nullable (optional password); added
  `vault_auto_lock_minutes`, `restoreFromTrash`/`permanentlyDeleteEntry`/`listTrash`. Fixed a real
  bug found during the pivot: private entries' **labels** (not just bodies) were being written to
  `entries_fts` and `label_history` unconditionally — meaning a vault item's title was discoverable
  via ordinary, no-PIN search and could surface in the normal capture bar's autocomplete. Fixed in
  both `insertEntry()` here and `restoreBackup()` in backup.js (Decision 40).
- [ ] **3 — Capture & intent engine.** `intents.js` (reminder/expense detection, OCR label
  suggestion), `notifications.js`, `ads.js`. Committed; not device-tested. `notifications.js`'s
  stale pre-rebrand naming (channel id, titles) fixed earlier.
- [~] **4 — App shell & control flow.** `app.js`, `index.html`, `style.css`. **Foundational gap
  found and fixed during the Vault pivot:** nothing anywhere ever toggled screen visibility —
  `unlock-btn` had no click listener, `main-screen` was never shown after unlock. Every UI section
  built across every prior session (backup/restore, Drive, import) was technically unreachable
  until `showScreen()` was added. Now wired: first-run setup (optional app-password +
  optional Vault PIN), the lock screen, quick-access skip path, main screen, and the Vault
  screen. **Second gap, found and fixed the session after:** the main capture bar's five buttons
  had no click listeners at all — only the vault's got wired during the pivot. `captureText`/
  `saveNote` only ever handled typed text; there was no equivalent of `captureToVault()` for
  voice/image/pdf/file on the non-vault side. Built `captureFile()` to fill that gap (mirrors
  `captureToVault`, unencrypted, writes to `Directory.Data/files/<uuid>.<ext>` per the existing
  storage convention). Also: `showMainTimeline()` returned rows but nothing ever rendered them or
  attached the per-file actions (built in Phase 7, sitting unused ever since) to anything —
  that's now done too, with tags shown per entry (one bulk `GROUP_CONCAT` query, not N+1).
  OCR for image/pdf still isn't implemented (Phase 5), so captured images/PDFs have no `body_text`
  yet — labels/tags still work for search. **Visual theme modernized (Session 28, Decision 52)** —
  colorful by default now (per-capture-type color coding across buttons/rows/tabs, one brand
  accent, gradient masthead accent). **Layout rebuilt (Session 29, Decision 53)**: bottom nav
  (Home/Vault/Settings) instead of one long scrolling page; Gradient mode removed entirely (dark
  mode kept); every on/off setting is a switch, not a checkbox. **Nav reduced to two tabs (Session
  36, Decision 61):** Settings dropped as a bottom-nav destination — Home now has an "App Settings"
  tile that opens the same `#settings-tab` panel, and the Vault's scattered biometric/auto-lock/
  Trash settings are consolidated into one `#vault-settings-card` tile inside the Vault screen. A
  small red power button, fixed top-right on every screen, force-closes the app
  (`@capacitor/app`'s `App.exitApp()`). **Restyled (Session 37, Decision 62):** transparent
  background, only the icon stroke red (was a solid filled circle); confirmation dialog removed;
  hidden on the app-open lock screen specifically (present everywhere else, including the Vault's
  own PIN gate). **Lock/unlock toggle + universal Back button added (Session 43, Decision 65):**
  a second small icon button, left of the power button, locks whichever of the app or the Vault is
  currently open (context-aware, checked at click time); the Vault's own former "Lock" button is
  gone, replaced by it. A third bottom-nav slot between Home and Vault is a universal Back button
  (hierarchical since Session 60, Decision 82 — originally a two-slot toggle) — every dedicated "back to
  home" element from earlier sessions is removed in favor of it. **Restyled + Vault contrast bug
  fixed (Session 44, Decision 66):** lock button now golden, thicker, persistent glow, and disabled
  (grayed out, not tappable) on Home/Settings whenever no app-open password is set; power button
  given a matching persistent red glow; back button given a new icon and a 0.5s tap-glow animation;
  lock button also now hidden on first-run setup. The Vault's lock button had been reported missing
  — actually a contrast bug (a near-black icon on the Vault's own near-black title bar), fixed by
  removing that dark bar and the bottom nav's matching dark active-Vault-tab background entirely. **Session 45, Decision 67:** the title box removed too, heading aligned with the lock/power row, lock gold brightened.
  **Session 30 (Decisions 54/55):**
  fixed a real bug where the Vault's PIN gate had been left disconnected from `vault-screen` by the
  Session 29 refactor (bottom-nav Vault button bypassed it entirely — see Decision 54); both locks
  now default to biometric on open; capture bars redesigned as a 6-card grid; Money added as a
  sixth capture type (card only — its actual capture flow, and whether it reuses the existing
  Expense machinery or stays separate, is still open for a future session). **Session 31 (Decisions
  56/57):** fixed five reported bugs — biometric double-tap on cold start (mitigated with a delay;
  Session 32 found the real cause and fixed it properly, see below), bottom-nav Home/Settings not
  working from the Vault screen, the Vault's Lock button showing while already locked, the
  biometric toggle showing on the locked gate instead of only once unlocked, and Lock not returning
  Home immediately. Added Reminder and Location as two more cards (eight total:
  Text/Voice/Image/PDF/Reminder/Location/Money/Files) — Reminder reuses the existing auto-detected
  type, Location is new; both placeholder like Money. **Session 61 (Decision 83):** Download for append removed everywhere — buttons, bulk action, import screen,
  `append_` filenames, zip dependency. Restore Append mode unchanged. Not run on a device.
  **Session 60 (Decision 82):** Back is hierarchical — one level up inside Home or Vault, stops at the
  landing page (dimmed there), never switches section. Not run on a device.
  **Session 63 (Decision 85):** Vault mirrors Home — folder cards with count badges, per-folder New, universal New with type chooser, search-only list, type tabs removed. Not run on a device.
  **Session 59 (Decision 81):** Home cards are folders — each opens its type's list with a New
  button and count badge; universal New with a type chooser on Home; Home timeline is search-only; Vault
  unchanged. Not run on a device.
  **Session 57 (Decision 79):** Location card built on the main capture bar — GPS fix saved with
  coordinates, optional Share of a map link on save; Share action handles location entries; not run on a
  device. Vault Location and Money still placeholders. **Session 56 (Decision 78):** Reminder card built on the main capture bar — modal with
  datetime picker and repeat select, tags, notification scheduled on save; not run on a device. Vault
  Reminder, Location, Money still placeholders.
  **Session 32 (Decision 58):** Session 31's
  delay-based biometric mitigation was itself the cause of a worse bug (reported freeze, full
  second unlock needed) — the delay raced against `DOMContentLoaded`'s own setup. Fixed by moving
  the trigger to run only after that setup fully completes. Also removed the ad gate from the
  unlock path entirely (ads deferred to a future build — see Phase 12). **Session 33 (Decision
  59):** found the real cause of a double biometric prompt on open and the Vault sometimes
  appearing already unlocked — an unconditional, redundant `refreshVaultGateView()` call at cold
  start that also fired the Vault's own auto-biometric attempt before the app itself was even
  unlocked. Removed; the nav handler already covers it correctly.
  **First real device test (Session 18): blank screen on launch.** `bootstrap()` read
  `window.sqlitePlugin`, a global nothing ever set — a leftover from the original pre-existing
  scaffold that predates every session in this log, never caught because nothing had run the app on
  a device until now. Fixed: import `CapacitorSQLite`/`SQLiteConnection` directly from
  `@capacitor-community/sqlite` instead. Audit afterward found a second bug of the same shape: six
  button handlers called bare `window.X()` for functions that only exist under `window.Dumpzone.X` —
  fixed all six.
  **Second device test: still blank — root cause was much deeper (Decision 46).** The app has never
  been able to load in any session: browsers can't resolve bare npm-package imports
  (`'@capacitor/filesystem'`) without a bundler, and every plugin-importing file has always had this.
  `node --check` never caught it because Node's module resolution isn't the same as a browser's.
  Fixed by adding Vite as a real build step — `src/` is now the actual source, `www/` is build
  output (§11/§12, ARCHITECTURE.md). Verified by actually running `npm install` + `vite build` in a
  sandbox before delivering, not just asserted: 82 modules bundled, zero unresolved imports remained
  in the output.
  **Third device test: native crash instead of blank screen — confirmed the above fix worked.**
  Got a real crash log via ADB this time (Session 21) rather than guessing further:
  `GoogleAuth.signIn()`'s native code has no null-check on its internal sign-in client, so calling
  it with no client ID configured is a guaranteed uncaught `NullPointerException` inside the
  plugin's own compiled Java code — kills the whole process before JS ever sees it (Decision 47).
  Fixed with a `GOOGLE_DRIVE_CONFIGURED` guard in `gdrive.js` that prevents the app from ever calling
  that native method until a real client ID exists.
  **Fourth device test (Session 22): the app actually loads and renders.** First real success after
  three sessions of crashes. Confirmed working: first-run setup screen (both optional-credential
  fields), the main screen with digest/on-this-day/timeline/capture bar all present, "Select files"
  opening correctly with proper empty-state handling ("Nothing to select yet" rather than an error
  on empty data), and all eight settings sections rendering (Storage breakdown, Trash, App lock,
  Private Vault, Appearance, Backup & Restore, Google Drive Backup).
  This confirms all three fixes (SQLite import, Vite bundling, GoogleAuth guard) actually work
  together, not just in isolation. Real functional testing (capture, search, tags, edit/delete,
  backup/restore, Vault) starts now.
- [~] **5 — Native plugin wiring.** **Voice recorder done** (Session 24, `cap-voice-rec`, real
  device bug fix — see Decision 48) — record/stop UI wired into both capture bars. Required
  permissions (including two newly-found foreground-service ones for this plugin's own recording
  service) now applied automatically by CI via `scripts/patch-manifest.js`, not just documented —
  see Decision 49; not yet confirmed against a real build/device, that's next session's first task.
  Noise-reduction toggle still not done, this plugin has no audio-source parameter
  (`android-notes/native-setup.md` §5). OCR (ML Kit or Tesseract), notification sound asset:
  documented, not implemented.
- [~] **6 — Backup & restore engine.** `backup.js` built: create/encrypt/write, open/decrypt/restore
  (append + overwrite, UUID dedup, `(Restored)` label-collision suffix), selective categories with
  storage sanity checks (`navigator.storage.estimate()` — an estimate, no device free-space API
  exists in Capacitor core), safety-backup-before-overwrite with its explicit-confirmation gate,
  extract-to-storage (no DB import). UI now wired in `index.html`/`app.js`: category checkboxes,
  mode selector with both descriptions always shown, the overwrite confirmation dialog (safety-backup
  checkbox defaulted on). Not run on a device — flag as risk. **Vault pivot:** the notes-only
  `private_notes` category is now a unified `private_vault` category spanning all five vault types
  (Decision 37). Cross-PIN append path (renamed from cross-PIN-private-notes to cross-PIN-vault) is
  written but especially untested (no way to exercise it without two real devices or a manually
  crafted second-PIN backup). Still plain/unstyled — matches Phase 4's current bare-skeleton look,
  not a finished visual design.
- [~] **7 — Per-file actions.** `fileactions.js` built: Share, plain Download, Edit (reminders reschedule
  via a caller-supplied callback), Delete (re-exports `db.js`'s `softDelete`), plus the "Select files"
  multi-select (category-grouped, per-item size, bulk Share/Download/Delete — Decision 44). Share/Download
  work identically for Vault and non-Vault entries, decrypting into memory first (Decision 41); Share also
  handles location entries (Decision 79). **Download for append removed (Session 61, Decision 83)** along
  with its import screen, per-entry zip format, `append_` filename prefix and the `@zip.js/zip.js`
  dependency. Both entry lists render the four actions per entry. **Not run on a device.**
  Wiring Edit surfaced two real bugs in `editEntry()`, fixed earlier and still standing: it expected
  `fields.text` for vault entries but `fields.body_text` for non-vault notes, and expense/reminder fields
  (`amount`/`expense_category`/`fire_at`/`repeat_rule`) were never written to the row. A vault delete also
  never rebuilt the in-memory search index; fixed.
- [~] **8 — Tags & label UX.** `promptForTags()` built and wired into both main and vault capture —
  shows existing tags (`listAllTags()`) as a hint, free-text creates new ones (`applyTags()`'s
  `INSERT OR IGNORE` already handled "new tag" with no changes needed). Tags now display per entry
  in both the main timeline and vault list. **Label autocomplete wired (Session 47, Decision 69):**
  new `listLabelHistory()` (db.js) plus `promptForLabel()` (app.js), mirroring `promptForTags()`'s
  own hint pattern — shows that type's previously-used labels (most-used first) as a hint inside the
  same `prompt()`, rather than retyping from memory each time. Wired to both of the app's two voice
  capture flows (main + vault), the only places today where a label is actually typed by hand; note/
  file/image/pdf/generic-file labels are auto-derived (text excerpt or filename) with no free-text
  prompt to attach a hint to. Same `prompt()`-based rough edge as other one-offs flagged elsewhere in
  this doc — real chip UI and live autocomplete-as-you-type are still Phase 4's design pass, not
  built here. **Batch add built (Session 62, Decision 84):** main capture for Image/PDF/Files is multi-select; more than one file offers batch add (one common label, auto-numbered, counter continues from `label_history`) or individual add (file names). Tags apply to the whole batch. Vault batch add and OCR-based label pre-fill not built. Not run on a device.
- [~] **9 — Additional features.** Digest, on-this-day, storage breakdown, data-transparency screen,
  recurring backup reminder (done — see detail below), quick-capture widget, expense charts, map view,
  confidence-confirmation chip, dark mode toggle (done, gradient mode removed — Decision 53). **Auto-lock timeout done** — `credentials.auto_lock_minutes` has existed since
  Session 1 but was never actually enforced anywhere until now (Decision 45). Also fixed while
  building it: `privateSessionKey`'s own comment has said "cleared on vault lock/background" since
  the Vault pivot, but nothing ever listened for backgrounding — the vault would stay unlocked
  indefinitely across app-switches, relying only on its idle timer. Both the app-level password lock
  and the vault now lock immediately on backgrounding (`@capacitor/app`'s `appStateChange`), not just
  after idle timeout. **False-positive lock on file-picker fixed (Session 51, Decision 73):** the
  system file chooser pauses the Activity the same way backgrounding does, so adding an Image/PDF/
  Generic File was locking the app/vault the instant the picker opened. One-shot `expectingPickerReturn`
  flag (armed by `beginPickerLaunch()` before both `input.click()` sites, 3s safety timeout) suppresses
  that one pause without weakening the immediate-lock behavior for any real backgrounding. Sharing out
  and the Drive OAuth flow deliberately still lock immediately — not the same case.
  **Split into three independent lock triggers, per lock (Session 52, Decision 74):** "idle timer" and
  "lock on background" were previously a package deal with no way to turn either off separately, and
  there was no way to lock specifically on the phone's own screen-off/lock either. Now six independent
  toggles (`app_lock_idle_enabled`, `app_lock_background_enabled`, `app_lock_screenoff_enabled` and the
  same three `vault_lock_*`), each gating its own trigger. Screen-off needed new native code — Android's
  Activity lifecycle can't distinguish "screen turned off" from "backgrounded" on its own, so a
  `BroadcastReceiver` for `Intent.ACTION_SCREEN_OFF` was added via a new idempotent CI script
  (`scripts/patch-screenlock.js`, see android-notes §14), dispatching a `dumpzone-screen-off` DOM event
  into the WebView. Defaults to **off** in the database until confirmed working on a real device — the
  other two default to their prior always-on behavior, so no existing install's behavior changes
  silently. Not yet run through CI or confirmed on device.
  **Digest, on-this-day, and storage breakdown done.** `showDigest()` had backend logic since early
  on but was never rendered anywhere — fixed, and while fixing it, found it also never excluded
  vault entries from its counts: a "3 notes today" digest with 1 public + 2 vault notes would have
  hinted at vault activity outside the vault, the same class of leak Decision 40 already closed for
  search/autocomplete. Fixed the same way — `is_private=0` added to the query. `onThisDay()` and
  `storageBreakdown()` are new, both excluding vault entries for the same reason; storage breakdown
  reuses `fileactions.js`'s `getSelectableEntries()` for sizes rather than computing them a second
  way, and its "clear items older than 30 days" action reuses the existing bulk-delete (soft-delete,
  30-day trash, not permanent). **"Your Data" transparency screen done (Session 35):** total entry
  count (vault excluded, same reasoning as digest/on-this-day above — this screen sits behind the
  app-open password, not the Vault PIN) plus an on-device storage estimate
  (`navigator.storage.estimate()`, same estimate-only caveat as the backup/restore storage checks),
  and an Export Now button that opens the existing Backup & Restore section rather than a second
  export path. **Recurring backup-reminder banner done (Session 40):** a soft, dismissible nudge on
  Home when 30+ days have passed since the more recent of the local/Google Drive backup timestamps
  (`credentials.last_backup_at`/`last_drive_backup_at`) — suppressed on an essentially-empty
  install so a fresh setup isn't nagged immediately; dismiss is in-memory only, reappears next cold
  launch. Remaining items (quick-capture widget, expense charts, map view, confidence-confirmation
  chip) not started.
- [~] **10 — Security hardening.** **Biometric unlock done** (Session 26, `@capgo/capacitor-native-biometric`,
  Decision 50) — fingerprint/face as an alternative to the app-open password or Vault PIN, off by
  default, independent per lock; not yet confirmed on a real device. **Privacy Screen done** (Session
  39, Decision 64) — a real Settings toggle (off by default), `@capacitor-community/privacy-screen`
  (pinned `5.2.0` for Capacitor 6 compatibility) blanking the recents preview and blocking screenshots
  together, replacing Session 37/38's build-time-only `MainActivity` patch (Decisions 62/63) entirely
  — that approach is gone, not just superseded in docs; `scripts/patch-mainactivity.js` deleted. **Exact reminder delivery via exact-alarm permissions (Session 78, Decision 101)** — device-verified Session 79: fires with the app closed and battery saver on.
  **Notification buttons return the app to the background (Session 77, Decision 100)** — device-verified Session 79; the app still shows for about a second first.
  **Snoozed reminder state (Session 76, Decision 99)** — device-verified Session 79: Snooze shows "Snoozed until", Done greys the row.
  **Reminders fire while closed: `allowWhileIdle` (Session 75, Decision 97)** — not run on a device.
  **Reminder banner channel, default sound (Session 74, Decision 96)** — not run on a device.
  **Reminder save toast with distance (Session 73, Decision 95)** — not run on a device.
  **Typed credentials cleared on lock (Session 72, Decision 94)** — password and PIN fields are emptied when
  either lock engages and after a successful unlock; not run on a device. JS
  obfuscation, ProGuard/R8, startup signature check: still documented, not implemented.
- [ ] **11 — CI/CD.** `build-android.yml` committed; signing-path and fail-fast fixes applied
  (Session 3). Runs `npm run build` (Vite) before `cap sync` (Decision 46, Session 18) — without
  it, the bundled app can never load in any WebView, verified as the actual root cause of two
  consecutive blank-screen device tests. **Now also patches the freshly-generated `android/` platform
  on every run** — required manifest permissions (Decision 49) and a real, always-incrementing
  version (Decision 51), both via small idempotent-where-appropriate Node scripts in `scripts/`,
  since `android/` itself is never committed and starts from the same unmodified template every
  time. (A third such script, for `FLAG_SECURE`, existed briefly in Sessions 37–38 and is gone as of
  Session 39 — Privacy Screen is a real plugin now, not a native patch; nothing left to run in CI
  for it.) **First real CI run attempted, Session 41** — failed at the Vite build step
  (`Could not resolve "./privacy-screen.js"`), root cause a missing file from Session 39's delivery,
  not a workflow or code problem; re-delivered. **Second attempt, Session 42** — progressed past
  that (file now resolves), failed one step further in because `package.json`/`capacitor.config.json`
  from the same Session 39 delivery also hadn't been committed; re-delivered both. Live green run
  still not confirmed — manual check pending. **Auto-release added (Session 49, Decision 71):** every
  push to `main` now also creates a tagged GitHub Release with the signed APK attached (`gh release
  create`, tag = `v<versionName>`, always unique since the run-number suffix always increases). Not
  yet run through CI. **Update check changed to a manual Settings button (Session 50, Decision 72):**
  Session 49's on-by-default daily background check is gone — `update-check.js` now only runs when
  "Check for updates" is tapped in Settings, no gate, no on/off setting to maintain since there's
  nothing left running in the background to turn off. Reports all three outcomes inline in that
  Settings section: up to date (names the version), an update found (names it, offers a direct
  download of the `.apk` asset — see Session 53, Decision 75), or a check failure (offline/network/
  unparseable). **Wrong build offered, fixed (Session 58, Decision 80):** the check now scans the
  release list for the highest run number instead of using `/releases/latest`. Still no auto-install — sideloaded APKs can't update themselves regardless of how the
  check is triggered or the file arrived. Not yet confirmed on device.
- [ ] **12 — Ads integration. Deliberately deferred (Decision 58) — not part of this build.** Logic
  drafted in `ads.js`, never wired to a real AdMob plugin, no plugin ever added to `package.json`.
  Session 32 removed the one call site that invoked it (`onUnlocked()`) — it was calling
  `runDailyAdGateIfDue()` with `window.adSdk` always undefined (nothing had ever set it), adding
  needless work to the unlock path for a gate with nothing behind it to open. `ads.js` itself is
  untouched, left as scaffolding for whenever this phase is actually picked up.
- [~] **13 — Google Drive backup (optional, opt-in).** Additive to Phase 6, never a replacement
  (Decision 25). Sub-items, roughly in dependency order:
  - [ ] Manual: Google Cloud project, enable Drive API, OAuth consent screen scoped to `drive.file`
    only (Decision 26), **published to Production** before relying on auto-backup (Decision 27) —
    walkthrough in `android-notes/native-setup.md` §11. **Still blocking** — nothing below can be
    device-tested until the real OAuth client ID replaces the placeholder in `capacitor.config.json`.
  - [ ] Manual: Android-type OAuth client (package `com.dumpzone.app` + release keystore's SHA-1).
  - [x] Google Sign-In plugin wired (`@codetrix-studio/capacitor-google-auth`, Capacitor 6
    compatible). No `grantOfflineAccess`/token store of our own (Decision 30) — relies on the native
    SDK's silent cached-consent sign-in instead.
  - [x] `gdrive.js` built: auth, find/create the app's backup folder, upload reusing `backup.js`'s
    exact archive format (Decision 28), storage check via Drive's `about.get` quota, restore
    delegates to `backup.js`'s existing `restoreBackup()` rather than duplicating it, plus a
    read-only preview function. Not run against a real account — no OAuth client exists yet.
  - [x] Auto-backup mechanism decided: a check on app open/resume (`checkAndRunAutoBackupIfDue()`),
    not OS-level background scheduling — `@capacitor/background-runner` confirmed incapable of
    SQLite/Filesystem access, so it can't build a payload at all (Decision 31).
  - [x] Settings UI: connect/disconnect account, manual "Backup now to Drive", auto-backup
    enabled/frequency picker (writes `meta.auto_backup_enabled`/`auto_backup_frequency`),
    storage-check display (same visual pattern as local backup's). Also the call site that invokes
    `checkAndRunAutoBackupIfDue()` on app open and supplies it a passphrase getter. **Known rough
    edge:** Drive restore/backup-now use plain `prompt()`/`confirm()` for the one-off passphrase and
    mode choice rather than the nicer modal built for local restore's overwrite confirmation and the
    auto-backup-due banner — functional, inconsistent, worth revisiting once Phase 4's real UI exists.
  - [ ] "Fully offline" language in docs/UI updated to "offline-first, optional cloud backup"
    (Decision 29) — done in ARCHITECTURE.md this session; still needs doing in any in-app copy once
    that copy exists (Phase 4's UI is still a bare skeleton).
- [~] **14 — Private Vault** (pivot; work spans Phases 2/4/6/7 above — this entry cross-references
  rather than duplicates). Text/Voice/Image/PDF/Files, unified under `is_private` (was notes-only),
  gated by the Vault PIN. See ARCHITECTURE.md §3b for the full design. Built this session:
  - [x] `vault.js`: content bundling (note text unchanged from pre-pivot; file types get a small
    JSON envelope of base64 bytes + OCR text, encrypted together via the same
    `encryptPrivateNote`/`decryptPrivateNote` calls private notes always used), save/load, and the
    in-memory-only search index (Decision 39 — built fresh on unlock, discarded on lock, never
    persisted even encrypted).
  - [x] Two real privacy leaks fixed (Decision 40): private entries' labels — not just bodies —
    were hitting `entries_fts` and `label_history` unconditionally in both `insertEntry()` and
    `restoreBackup()`. Vault-only label autocomplete now comes from the in-memory index instead.
  - [x] File encryption at rest (Decision 38) — vault entries never write file bytes to disk
    unencrypted; `file_path` stays NULL, content lives in `encrypted_body`.
  - [x] Optional app-open password (Decision 36) — first-run setup screen built (didn't exist
    before at all; only the check-against-it path did), `setAppPassword`/`removeAppPassword` for
    Settings-time changes.
  - [x] Vault's own trash bin and own auto-lock timer (Decision 42) — `vault_auto_lock_minutes`
    column, `listTrash`/`restoreFromTrash`/`permanentlyDeleteEntry` shared with the main bin,
    distinguished by `is_private` rather than a second table.
  - [x] Share/Download parity with the main app (Decision 41) — reversed an earlier, more
    restrictive default on explicit direction.
  - [x] "Select files" multi-select (Decision 44), shared between main and Vault.
  - [ ] **Not run on a device or through CI.** Same standing risk as everything else — flagged, not
    resolved, since that requires the manual Google Cloud/CI steps from earlier phases regardless.
  - [ ] Vault UI is functional but plain (prompt()/confirm() for capture and some actions) —
    matches Phase 4's overall bare-skeleton state, not a finished design.

Phases with a real dependency (e.g. 7 needs 6) are worked in order. Phases without one (e.g. 9's
individual items) can be picked up in any order once prerequisites are met.
- [~] **15 — UI redesign (Decision 86).** Visual system only; element ids and logic unchanged.
  - [x] 1 — Design system, Home, Vault (Session 64): tokens, bundled Inter, inline SVG icon sprite,
    folder tiles with corner count badges, entry rows with icon actions, floating nav, empty states,
    dark and light themes. Not run on a device.
  - [x] 2 — Lock screen, first-run, Vault gate, ad gate, Settings (Session 65): centered auth layout with
    brand mark and form cards; Settings grouped (Data, Security, Preferences, Backup) with icon chips;
    switches as label-left rows; custom select arrow. Not run on a device.
    Session 66: biometric buttons read "Use Biometric" with a slow glow; Download update disabled until a newer release is found; `.hidden` made unconditional.
    Session 67: background art — cubes on unlock/auth screens, rounded squares on Home and Vault landing; both themes.
  - [ ] 3 — Capture flows: replace `prompt()`/`confirm()`/`alert()` with in-app bottom sheets (touches logic).
  - [ ] 4 — Polish: transitions, haptics if the existing plugins allow, light-theme tuning.
- [ ] **16 — Open & edit (Decision 90).** Every entry opens on tap; the four row actions stay.
  - [x] A — Unified Save dialog (Session 69): name, tags (max 2, previous tags as chips), description, one
    Save; untouched Save stores defaults; picked files keep their phone name; several files offer keep-names or
    one numbered name. `description` column (+ `encrypted_description` for the Vault), in backup/restore and
    search. Replaces `prompt()`/`confirm()`/`alert()` in capture, Vault capture and Edit details. Still using
    `prompt()`: the reminder time (E), expense edit (Money).
  - [x] B — Text editor (Session 69): full-screen, word count, discard guard, Save leads into the dialog; rows
    open on tap (non-text types show a "coming later" toast until C–H).
  - [x] C — Voice (Session 82, Decision 103; device-confirmed Session 83): recorder screen (timer, Record/Stop), review
    with the player before Save, then the saved-entry viewer (play/pause, scrub, speed 0.75 to 2×), Home and Vault.
  - [ ] D — Image: thumbnail grid in the Image folder, full-screen viewer (swipe, pinch zoom).
  - [x] E — Reminder (Session 70): detail view (when, repeat, status, description, tags), Mark done / Reopen /
    Reschedule; greyed out and struck through in lists once done or fired; reminder time and repeat are part of the
    Save dialog (old reminder pop-up removed). Notification Done/Snooze buttons now work; delete cancels the
    notification, restore reschedules.
  - [x] F — Location (Session 71): detail view with coordinates (N/S, E/W and decimal), a grid plot drawn from them
    (30° lines, no map data), Copy, and Open in Maps via a `geo:` hand-off. Main entries only; Vault Location
    still has no capture.
  - [ ] G — Files: open with the phone's matching app.
  - [ ] H — PDF: in-app viewer.
  - Open choices (confirm before the step that needs them): PDF viewer by bundling pdf.js (offline,
    about 1.3 MB larger APK) or by handing off to the phone's PDF app; adding a file-opener plugin for G
    (Vault files get a short-lived decrypted copy in app cache); a real map needs network tiles, which
    would break the single-network-call rule, so F uses coordinates plus hand-off.
  - Suggested order: A, B, E, F, C, D, G, H.
  - [x] **Before C: notification Snooze and Done without opening the app (Session 80, Decision 102; device-confirmed Session 81).** A native
    receiver patched in by CI handles both buttons: no app launch. It dismisses, cancels or schedules the alarms, and
    queues the action; the app applies the queue to the database at startup, on resume and every 4 seconds while
    visible. Built by CI and confirmed on a device: reminder fires, Snooze and Done
    act with no app launch. Not yet checked: a shade tap while the app is open, an install over an older build with a
    pending reminder, repeating reminders. Row state lags the tap until the queue is drained.
