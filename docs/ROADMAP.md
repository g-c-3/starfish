# Roadmap

## Minimum (quick reference)

- [x] 0 — Repo scaffold & docs
- [ ] 1 — Infra & secrets
- [ ] 2 — Core data layer
- [ ] 3 — Capture & intent engine
- [~] 4 — App shell & control flow (Money capture: model, schema and backup — Session 88; Home form, rows, month header, repayments and edit — Session 89 (steps 1 to 3 of Decision 124); Settings currency symbol — Session 91 (step 4); expense detection removed — Session 91 (step 5); Vault Money — Session 92 (step 6), not device-tested; 5 reported bugs fixed — Session 31; Vault Reminder — Session 92 (Decision 140); viewer header actions — Session 92 (Decision 141); both confirmed on device (DP27); Vault Location — Session 93 (Decision 142), Vault made to match Home (Decision 143), not device-tested; all 8 Vault capture cards now built; Reminder Session 56 and Location Session 57 built on Home)
- [~] 5 — Native plugin wiring (voice recorder + permissions done, needs device confirm; noise-toggle/sound asset not; OCR dropped, Decision 192)
- [~] 6 — Backup & restore engine (core logic done, UI wired; real free-space check confirmed on device — Session 97; format 2 chunked backup built after Export Now crashed on 109 MB and confirmed on device (Export Now, Restore append and overwrite) — Session 102, Decision 159)
- [~] 7 — Per-file actions (all four built, attached to the Home folders and the Vault list; Download for append removed — Session 61)
- [~] 8 — Tags & label UX (tag picker, label-history hint, main-capture batch add wired — Session 62; Vault batch add numbering continues — Session 107, Decision 174, confirmed on device (DP57); OCR label pre-fill dropped, Decision 192)
- [~] 9 — Additional features (auto-lock, digest, on-this-day, storage breakdown, Your Data screen, backup-reminder banner done; reminder offer instead of silent conversion built — Session 108, Decision 175, not device-tested (DP58); rest not started)
- [~] 10 — Security hardening (biometric unlock done, needs device confirm; Privacy Screen done as a real Settings toggle — Decision 64; obfuscation/ProGuard/signature check not)
- [x] 11 — CI/CD (build workflow committed; live green runs confirmed — Session 107: releases v0.1.0+494, +498 and +499 exist, each created by the workflow's last step after the signed build; auto-release added Session 49, update check changed to manual Settings button Session 50)
- [ ] 12 — Ads integration
- [ ] 13 — Google Drive backup (optional, opt-in, core logic done, no UI, blocked on manual OAuth setup)
- [~] 14 — Private Vault (Text/Voice/Image/PDF/Files, encrypted at rest, in-memory search, own trash/auto-lock)
- [~] 15 — UI redesign (1 design system, 2 auth/Settings screens, background art done — Sessions 64–67; 3 folded into 16A, 4 polish: Home tools row, Trash folder, Search layer, sort and filter built — Session 94, confirmed on device — Session 97; 4c Vault parity built — Session 95, confirmed on device — Session 97; 4d Trash Undo, PDF pinch zoom and viewer switch built — Session 96, confirmed on device — Session 97; 3 native dialogs replaced with in-app sheets built — Session 97, confirmed on device — Session 97; 4 polish: entrance motion built — Session 100, not device-tested; haptics dropped — Session 107, Decision 173; light-theme tuning not)
- [x] 16-pre — Snooze and Done from the notification without opening the app (confirmed on device — Session 81)
- [x] 16 — Open & edit (A unified Save dialog and B text editor done — Session 69; E reminder detail done — Session 70, F location detail done — Session 71 (add by coordinates — Session 86), C voice recorder + player done — Sessions 82–83, D image grid + viewer done — Sessions 84–85, G open Files with phone app done on device — Session 87, H PDF viewer built — Session 87, confirmed on device (DP15), in-app password prompt confirmed (DP17); Phase 16 complete)
- [~] 17 — Encryption at rest (Decision 144; K password and PIN hash counts to 600000, versioned, built — Session 107, Decision 172, confirmed on device (DP55); A Vault labels built and confirmed on device — Session 94; B Vault index per entry built and confirmed on device — Session 98; B2 Vault unlock speed (file metadata cache and progress notice) built and confirmed on device — Session 100, Decisions 156 and 157; C whole-database encryption built and database converted on the owner's phone — Session 101, Decision 158, DP42 checks 1 to 4 confirmed Session 102 (Decision 159), check 5 confirmed — Session 103; Encryption test removed — Session 103, Decision 160; D per-file encryption core module built — Session 103, Decision 161; D wired and E built with it — Session 104, Decision 162, confirmed on device (DP43); F migration confirmed on device — Session 104, Decision 163, DP44; G update check for the private repo confirmed on device — Decision 164, DP45; H rename and docs-only commits skip CI confirmed — Decision 165, DP46; L to O Vault key hierarchy planned — Decision 195)
- [~] 18 — PDF viewer tools (Decision 152, approved; A reading tools built — Session 99, Decision 153, confirmed on device — Session 100; B mark-up and forms built and confirmed on device — Session 105, Decision 166 (DP48); C1 page tools (rotate, delete, reorder, extract, split) built — Session 106, Decision 167, confirmed on device (DP49); C2 merge PDFs and Make a PDF from pictures built — Session 106, Decision 168, confirmed on device (DP50); C3 picture tool built — Session 106, Decision 169, confirmed on device (DP51); Phase 18 complete)
- [x] 19 — Autosave of unsaved work, complete (Decision 177; stage 1 Text built and confirmed — Session 108 (DP59); 2 Voice and 2b background recording confirmed — Session 108 (DP60, DP61); 3 Reminder, Location, Money new entries built and confirmed on device — Session 110, Decision 189 (DP66); 4 edits of Reminder, Location, Money built and confirmed on device — Session 110, Decision 190 (DP67); 5 redraw of the lists after a committed draft built and confirmed on device — Decision 191 (DP68))
- [x] 20 — Move between Home and Vault, complete (Decision 181; step 1 Text, Location, Money built and confirmed on device — Session 109, Decision 182 (DP62); 2 Reminder built and confirmed on device — Session 109, Decision 183 (DP63); 3 Voice, Image, PDF, Files built and confirmed on device, no size cap — Session 109, Decision 184 (DP64); 4 Move for a selection built and confirmed on device — Session 109, Decisions 185 to 188 (DP65))
- [~] 21 — Password management and backup authorization (Decision 199; P1 show/hide control built — Session 112, Decision 200, not device-tested (DP73); P2 set, change, remove built — Session 113, Decision 201, not device-tested (DP74); P3 and P4 not started)
- [~] DP — Device pass backlog (DP60 and DP61 confirmed — Session 108; DP59 and DP58 confirmed — Session 108; DP57 confirmed — Session 107; DP56 closed, haptics dropped — Session 107; DP55 confirmed — Session 107; DP54 confirmed — Session 106; DP53 confirmed — Session 106; DP52 confirmed — Session 106; DP51 confirmed — Session 106; DP50 confirmed — Session 106; DP49 confirmed — Session 106; DP48 confirmed — Session 105; DP1 to DP12 confirmed Session 86; DP13 confirmed — Session 92; DP14, DP15 and DP18 to DP22 confirmed — Session 91; DP16 confirmed — Session 87; DP17 confirmed — Session 92; DP23, DP24 and DP25 confirmed — Session 92; DP26 and DP27 confirmed — Session 92; DP31 to DP36 confirmed — Session 97; DP37 confirmed — Session 98)

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
- [ ] **3 — Capture & intent engine.** `intents.js` (reminder/expense detection, label
  suggestion, unused since Decision 192), `notifications.js`, `ads.js`. Committed; not device-tested. `notifications.js`'s
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
  OCR for image/pdf is dropped (Decision 192), so captured images/PDFs have no `body_text` —
  labels/tags work for search. **Visual theme modernized (Session 28, Decision 52)** —
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
  button handlers called bare `window.X()` for functions that only exist under `window.Arkly.X` —
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
  (`android-notes/native-setup.md` §5). OCR dropped (Decision 192). Notification sound asset:
  documented, not implemented.
- [~] **6 — Backup & restore engine.** `backup.js` built: create/encrypt/write, open/decrypt/restore
  (append + overwrite, UUID dedup, `(Restored)` label-collision suffix), selective categories with
  storage sanity checks (real free space from `@capacitor/device` `realDiskFree` — Session 97, Decision 150; an unknown reading does not block; the backup file's real size is checked before writing), safety-backup-before-overwrite with its explicit-confirmation gate,
  extract-to-storage (no DB import). UI now wired in `index.html`/`app.js`: category checkboxes,
  mode selector with both descriptions always shown, the overwrite confirmation dialog (safety-backup
  checkbox defaulted on). Not run on a device — flag as risk. **Vault pivot:** the notes-only
  `private_notes` category is now a unified `private_vault` category spanning all five vault types
  (Decision 37). Cross-PIN append path (renamed from cross-PIN-private-notes to cross-PIN-vault) is
  written but especially untested (no way to exercise it without two real devices or a manually
  crafted second-PIN backup). Still plain/unstyled — matches Phase 4's current bare-skeleton look,
  not a finished visual design.
  **Format 2 (Session 102, Decision 159):** Export Now crashed on 109 MB of data because the whole archive was one
  string. Backups are now written as one encrypted line per chunk (3 MB of file bytes), sized without building
  the payload; restore reads the picked file in slices, one entry at a time; overwrite reads and checks the whole
  file before deleting anything. Format 1 files still restore (append restore of one confirmed on device — Session 103); the Drive path is unchanged. Node tests and
  `vite build` pass. Confirmed on device in Session 102: Export Now, Restore (append), Restore (overwrite) with the safety backup, 29 entries and about 109 MB of Home data; the overwrite took a few minutes with phase text shown, and the app stayed unlocked.

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
  built here. **Batch add built (Session 62, Decision 84):** main capture for Image/PDF/Files is multi-select; more than one file offers batch add (one common label, auto-numbered, counter continues from `label_history`) or individual add (file names). Tags apply to the whole batch. OCR-based label pre-fill not built. Not run on a device. The Vault multi-select save also offers one numbered name; its numbering continues from the highest existing `<name> N` in the Vault index (Session 107, Decision 174, `src/js/batch-number.js`, 7 Node checks, confirmed on device, DP57).
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
  (`scripts/patch-screenlock.js`, see android-notes §14), dispatching a `arkly-screen-off` DOM event
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
  app-open password, not the Vault PIN) plus the size of the data held
  (sum of the per-entry sizes the Storage breakdown shows, Session 97, Decision 150),
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
- [x] **11 — CI/CD.** `build-android.yml` committed; signing-path and fail-fast fixes applied
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
  from the same Session 39 delivery also hadn't been committed; re-delivered both. Live green runs
  confirmed (Session 107): the releases v0.1.0+494, +498 and +499 were published today, and the release step is the last step of the job, so each means the Vite build, the patches, `cap sync` and the signed build all passed. **Auto-release added (Session 49, Decision 71):** every
  push to `main` now also creates a tagged GitHub Release with the signed APK attached (`gh release
  create`, tag = `v<versionName>`, always unique since the run-number suffix always increases). Confirmed
  working (Session 107): every release above came from it. **Update check changed to a manual Settings button (Session 50, Decision 72):**
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
- [x] **19 — Autosave of unsaved work (Decisions 177 to 191).** Unsaved work in Text, Voice, Reminder, Location and Money, Home and Vault, is kept when the app locks, goes to the background or closes, and becomes `Autosave <date time>` (a new item) or is written onto its file (an edit). Staged, one per session.
  - [x] 1 — Text, new and edit, Home and Vault (Session 108, Decision 177): confirmed on device (DP59).
  - [x] 2 — Voice (Session 108, Decision 179; confirmed on device, DP60): a take being recorded, in review, or sent to the Save dialog when the app locks or backgrounds is saved as an Autosave entry; a recording killed mid-take is lost. `vite build` passes; not run through CI or on a device (DP60).
  - [x] 2b — Home voice keeps recording behind a lock (Session 108, Decision 180): switch on the Home recorder, off by default; the recorder reopens on the running take at the next unlock; Home only; confirmed on device (DP61).
  - [x] 3 — Reminder, Location, Money, new entries, Home and Vault (Session 110, Decision 189): the fields of each open dialog are kept in one `meta` row per kind (Home and Vault) and committed at the next unlock or Vault unlock. A complete form becomes the entry, an incomplete one an Autosave text entry listing what was filled in; an autosaved reminder is not scheduled. `autosave.js` (16 Node checks), draft session and commit in `app.js` (12 checks on stubs), `vite build` passes; confirmed on device (DP66).
  - [x] 4 — Edits of Reminder, Location, Money, Home and Vault (Session 110, Decision 190): the edit's Save dialog (Reminder, Location details) and the Money form with its Save dialog keep their fields in `form_edit_draft_<kind>` rows with the entry's id and name; committed at the next unlock or Vault unlock onto the entry (a reminder is rescheduled as a normal Save would), or as an Autosave text entry when the form is incomplete or the entry is gone. 25 Node checks on `autosave.js`, 20 on the draft session and commit; `vite build` passes; confirmed on device (DP67). Edits of Voice, Image, PDF and Files details are not covered.
  - [x] 5 — Redraw after a committed draft (Session 110, Decision 191): found on device in DP67, the lists drawn before a lock showed the old rows after the unlock until an entry was opened. An unlock that commits any draft (text, form, edit) now redraws the Home lists and, with the Vault unlocked, the Vault lists. `vite build` passes; confirmed on device (DP68).
- [ ] **21 — Password management and backup authorization (Decision 199).** Planned, nothing built. Each stage needs approval and a device pass.
  - [~] P1 — Show/hide control on every password input (Session 112, Decision 200). Built: `src/js/passeye.js`; every password field except the lock screen input; 18 Node checks; `vite build` passes; not run through CI, not device-tested (DP73).
    - [ ] DP73 — not yet run, Session 112. Eye control (Decision 200). Check each field: first-run app password and Vault PIN, Settings token and biometric confirm fields, Backup now and Restore passkey, Vault set-up, Vault unlock, Vault confirm PIN, auto-backup banner, the passkey and PIN sheets, the PDF password prompt. Each shows an eye at the right edge; tapping it reveals the text and keeps the keyboard and caret; tapping again hides it; long text never runs under the eye; spacing is unchanged. A revealed field is hidden again after leaving the app, after a lock and after the sheet closes. The lock screen password field has no eye.
  - [~] P2 — Settings: set the app password and the Vault PIN if not set; change either after the current secret or a biometric check; remove the app password only, after the same check. The Vault PIN cannot be removed (it wraps the Vault key). Session 113, Decision 201. Built: App lock tile (Set, Change, Remove password) and Vault Settings (Change Vault PIN); the Vault PIN is first set in the Vault tab as before; 31 Node checks; `vite build` passes; not run through CI, not device-tested (DP74).
    - [ ] DP74 — not yet run, Session 113. Secret management (Decision 201). (1) No password: Settings, App lock shows "No password" and only Set password; set one (typed twice, optional hint); lock the app and unlock with it; the Lock button is no longer greyed. (2) Change password: asks the current one (or one biometric prompt when fingerprint unlock is on); a wrong one is refused; the new one works, the old one does not; fingerprint unlock is off afterwards and the notice says so. (3) Remove password: current secret, then a Remove or Keep dialog; the app then opens without a lock screen. (4) Vault Settings, Change Vault PIN: current PIN (or one biometric prompt), new PIN twice, optional hint; the new PIN unlocks, the old one does not, items open as before; fingerprint unlock is off afterwards. (5) A weak entry shows the advisory; mismatched entries are refused; cancelling at any step changes nothing. (6) A Vault lock while the PIN sheet is open closes it.
  - [ ] P3 — Manual backup authorization: app password if set, Vault PIN if the Vault is included, or one biometric for both; then the backup passkey as now.
  - [ ] P4 — Automatic backup (phone storage, Google Drive): a saved passkey; changing the schedule, target or passkey needs the same check. Needs the owner to approve the change to the never-stored rule first.
- [x] **20 — Move between Home and Vault (Decisions 181 to 188).** Fifth row action before Delete: Move to Vault (Home), Move to Home (Vault). Write, read back, then delete the original permanently; failure leaves the original. Steps, each with a device check:
  - [x] 1 — Text, Location, Money (Session 109, Decision 182): `move.js` (`moveToVault`, `moveToHome`, `canMove`), fifth row button on the Home and Vault folder lists for these three types, confirm sheet, both directions; 11 Node checks; `vite build` passes; confirmed on device (DP62).
  - [x] 2 — Reminder (Session 109, Decision 183): schedule, repeat, snooze and done carried; notifications cancelled and scheduled again on the other side; 13 Node checks; `vite build` passes; confirmed on device (DP63).
  - [x] 3 — Voice, Image, PDF, Files (Session 109, Decision 184): file read whole, written under the other side's storage, compared byte for byte, original and its file removed; extension, category, OCR text carried; no size cap by owner decision; 16 Node checks; `vite build` passes; confirmed on device (DP64).
  - [x] 4 — Move for a selection (Session 109, Decision 185): Move icon in the Select files bar (Move to Vault from Home, Move to Home from the Vault), one item at a time, per-item failures reported, items of an uncovered type left alone; `vite build` passes; confirmed on device (DP65).

Phases with a real dependency (e.g. 7 needs 6) are worked in order. Phases without one (e.g. 9's
individual items) can be picked up in any order once prerequisites are met.
- [~] **15 — UI redesign (Decision 86).** Visual system only; element ids and logic unchanged.
  - [x] 4b — Home tools row, Trash folder, Search layer, shared sort and filter (Session 94, Decision 146): built, icon only, confirmed on device — Session 97 (DP32).
  - [x] 4c — Vault parity (Session 95, Decision 147): Vault tools row, Vault Trash folder with decrypted labels, Vault Search layer on the in-memory index, Vault-only Select files with the shared toolbar. Built, `vite build` passes, confirmed on device — Session 97 (DP33). Home Select no longer lists Vault items.
  - [x] 4d — Trash Undo, PDF pinch zoom, PDF viewer switch (Session 96, Decision 148). Built, `vite build` passes, confirmed on device — Session 97 (DP34).
  - [x] 1 — Design system, Home, Vault (Session 64): tokens, bundled Inter, inline SVG icon sprite,
    folder tiles with corner count badges, entry rows with icon actions, floating nav, empty states,
    dark and light themes. Not run on a device.
  - [x] 2 — Lock screen, first-run, Vault gate, ad gate, Settings (Session 65): centered auth layout with
    brand mark and form cards; Settings grouped (Data, Security, Preferences, Backup) with icon chips;
    switches as label-left rows; custom select arrow. Not run on a device.
    Session 66: biometric buttons read "Use Biometric" with a slow glow; Download update disabled until a newer release is found; `.hidden` made unconditional.
    Session 67: background art — cubes on unlock/auth screens, rounded squares on Home and Vault landing; both themes.
  - [x] 3 — Native `prompt()`/`confirm()`/`alert()` replaced with in-app sheets (Session 97, Decision 149): text sheet (`askText`), Yes/No sheet, toasts. None remain in `app.js`. Built, `vite build` passes, confirmed on device — Session 97 (DP35). Drive and legacy expense edit paths are unreachable on a device today.
  - [~] 4 — Polish. Entrance motion built and confirmed on device (Session 100, Decision 155; DP40): screens and modal backdrops fade in, toast slides in, all under `prefers-reduced-motion: no-preference`; CSS only, `vite build` passes, not run through CI.
    - [x] Haptics — dropped Session 107 (Decision 173): no vibration on the owner's phone in three builds although the plugin and the web view both accepted the call. Dependency, wrapper, Settings row and call sites removed.
    - [ ] Light-theme tuning — needs on-device review; nothing changed blind.
- [x] **16 — Open & edit (Decision 90).** Every entry opens on tap; the four row actions stay.
  - [x] A — Unified Save dialog (Session 69): name, tags (max 2, previous tags as chips), description, one
    Save; untouched Save stores defaults; picked files keep their phone name; several files offer keep-names or
    one numbered name. `description` column (+ `encrypted_description` for the Vault), in backup/restore and
    search. Replaces `prompt()`/`confirm()`/`alert()` in capture, Vault capture and Edit details. Still using
    `prompt()`: the reminder time (E), expense edit (Money).
  - [x] B — Text editor (Session 69): full-screen, word count, discard guard, Save leads into the dialog; rows
    open on tap (non-text types show a "coming later" toast until C–H).
  - [x] C — Voice (Session 82, Decision 103; device-confirmed Session 83): recorder screen (timer, Record/Stop), review
    with the player before Save, then the saved-entry viewer (play/pause, scrub, speed 0.75 to 2×), Home and Vault.
  - [x] D — Image (Sessions 84–85, Decisions 105 and 109): thumbnail grid in the Image folder (Home and Vault), full-screen
    viewer with swipe or arrows between images, pinch and double-tap zoom, and a thin header carrying Edit (rename),
    Share, Download, Delete and the image count. Device-confirmed Session 85, Home and Vault.
  - [x] E — Reminder (Session 70): detail view (when, repeat, status, description, tags), Mark done / Reopen /
    Reschedule; greyed out and struck through in lists once done or fired; reminder time and repeat are part of the
    Save dialog (old reminder pop-up removed). Notification Done/Snooze buttons now work; delete cancels the
    notification, restore reschedules.
  - [x] F — Location (Session 71): detail view with coordinates (N/S, E/W and decimal), a grid plot drawn from them
    (30° lines, no map data), Copy, and Open in Maps via a `geo:` hand-off. Vault Location viewer
    added in Session 93 (Decision 142).
    - Session 86: New offers current location or pasted coordinates / map link; optional Verify link for short links
      (Decisions 116, 117). Confirmed on device — Session 86.
  - [x] G — Files: open with the phone's matching app (Session 87, Decisions 118 and 120; built, `vite build` passed; confirmed on device, DP14). Tap a Files row: the file opens straight in the phone's app, no detail step (Decision 120). Rows show the
    file extension (PDF, DOCX, ZIP) in place of the folder icon. Home files open from their stored path; Vault files open from a
    decrypted copy in cache, removed on the next launch or resume. Plugin: `@capacitor-community/file-opener` 6.x.
  - [x] H — PDF: in-app viewer (Session 87, Decision 121; built, `vite build` passed, page layout and parsing tested in Node; confirmed on device, DP15 and DP17). Tap a PDF row: full-screen viewer on a bundled pdf.js (legacy build, pinned 4.10.38), pages
    drawn lazily and released off screen, page count in the header, zoom buttons (1, 1.5, 2, 3 times), rename from the header. Home
    and Vault; Vault bytes stay in memory and are dropped on close or lock. A password-protected PDF asks for the password inside the viewer (Decision 125);
    a damaged one, or a cancelled prompt, offers Open with app. No text layer, no search inside a PDF, no bundled fonts or character maps.
  - Choice made: PDF by bundling pdf.js, offline (Decision 121). A real map needs network tiles, which would break the
    single-network-call rule, so F uses coordinates plus hand-off.
  - Suggested order: A, B, E, F, C, D, G, H.
  - [x] **Before C: notification Snooze and Done without opening the app (Session 80, Decision 102; device-confirmed Session 81).** A native
    receiver patched in by CI handles both buttons: no app launch. It dismisses, cancels or schedules the alarms, and
    queues the action; the app applies the queue to the database at startup, on resume and every 4 seconds while
    visible. Built by CI and confirmed on a device: reminder fires, Snooze and Done
    act with no app launch. Shade tap with the app open confirmed Session 85. Row state lags the tap until the
    queue is drained.
- [~] **17 — Encryption at rest (Decision 144).** A built. Each item needs approval before it starts, and is measured on a real phone.
  - [x] A — Vault labels encrypted (`encrypted_label`, placeholder `Vault item` in `label`). Built Session 94, Decision 145; includes the unlock-time migration of existing labels and the backup and restore changes. Confirmed on device in Session 94 (DP30).
  - [x] B — Vault index updated per entry on add, edit, trash, restore and delete (Session 98, Decision 151). Built, `vite build` passes, confirmed on device (DP37). A full build remains on unlock, after a restore and on a reminder change that names no entry.
  - [x] B2 — Vault unlock speed (Session 100, Decision 156). The full index build no longer decrypts file bytes: each file entry carries a small encrypted metadata record (size, OCR text, body length), rebuilt when missing, stale or under another key; file bytes are not even read from the database during the build; tags in one query. First unlock after the update rebuilds the records once (as slow as before); later unlocks read only the records. Tested in Node on real crypto and SQLite (3 MB files: second build 7 ms); `vite build` passes; not run through CI; confirmed on device (DP41). Progress notice added (Decision 157): a sticky toast "Preparing Vault: N of M" while records are being built.
  - [x] C — Whole-database encryption (Session 101, Decision 158). SQLCipher through the sqlite plugin; random device key in Keystore-backed storage; new installs start encrypted; existing installs convert from Settings, Database encryption, at the next start. Converted on the owner's phone with Home counts unchanged. `allowBackup` set to false.
    - [x] DP42 — confirmed on device, all checks, Session 103. Checks 1 to 4 confirmed Session 102 (Vault entries, images, PDFs and files open; a reminder fires with Snooze and Done and repeats; Export Now, Restore append and Restore overwrite work on the format 2 backup, Decision 159). Check 5, Session 103: a fresh install shows Database encryption On.
    - [x] Cleanup — `encbench.js`, the Diagnostics row and its script tag removed (Session 103, Decision 160). `vite build` passes, nothing left in the build output; not run through CI.
  - [~] D — Per-file encryption: random name, no extension, per-file key wrapped under the master key. Core module `src/js/filestore.js` (Session 103, Decision 161) and device binding `src/js/files.js` (Session 104, Decision 162). New Home captures and restored files are encrypted; `entries.file_key` added; reads (image, voice, PDF, Share, Download, open with phone app, sizes) go through `files.js`; thumbnail disk cache removed; permanent delete, trash purge and overwrite wipe remove the file. 17 Node checks on `files.js`; `vite build` passes; not run through CI; DP43 confirmed on device. Existing files were converted by F.
  - [~] E — Backup and restore adapted at each stage (rules in ARCHITECTURE.md §3c). Built with D (Session 104, Decision 162): backup reads decrypted bytes through `files.js` and drops `file_key`; restore writes through the streaming writer in both formats. Export Now, Restore (append) and Restore (overwrite) with the safety backup confirmed on device (DP43); adapted again with F (DP44).
  - [x] F — One-time migration of existing plain Home files (Session 104, Decision 163). Built: per-file write, byte-for-byte read-back, row update, plain file removal; orphan sweep once all are converted; runs at start with a "Securing files" notice. 8 Node checks; `vite build` passes; DP44 confirmed on device.
  - [x] G — Update check and download for the private repo (Session 104, Decision 164). Built: token in Settings > Updates (encrypted database, not in backups), authenticated release list, native APK download, system installer hand-off, `REQUEST_INSTALL_PACKAGES`. Update check unit-checked (no token, 401/403/404, 500, no APK, newer and current); `vite build` passes; DP45 confirmed.
  - [x] H — Rename to Arkly (Session 104, Decision 165): app name, notifications, prompts, Documents folder, Drive folder (an existing earlier folder is still found), events, global, workflow artifact. Pre-rename identifiers kept (package id, keystore alias, database file, channel ids, biometric entry names). `build-android.yml` skips pushes that change only `docs/**`, `**/*.md` or `android-notes/**`. `vite build` passes; DP46 confirmed.
  - [~] I — Weak-secret warning when a credential is set (Session 106, Decision 170). Built: advisory dialog at first-run setup, Vault PIN setup, Backup now, the auto-backup banner and Drive Backup now; 12 Node checks on `passcheck.js`; `vite build` passes; not run through CI; confirmed on device (DP52).
  - [~] J — Backup passkey iterations 300000 to 600000 for new backups (Session 106, Decision 171). Built: one constant used by the format 2 writer and the Drive archive writer; the header already carries the count so earlier backups open. 6 Node checks on `crypto.js` (new count written, round trip, wrong passkey, an earlier 300000 archive, chunk round trip); `vite build` passes; not run through CI; confirmed on device (DP53).
  - [x] K — App-open password and Vault PIN hashes to 600000 iterations, versioned (Session 107, Decision 172). Built: count stored beside each hash, older hashes upgraded after a correct unlock with the salt kept. 14 Node checks on `crypto.js` (new count, round trip, wrong secret, earlier hash with no stored count, salt kept, upgraded hash verifies, Vault key unaffected); `vite build` passes; not run through CI; confirmed on device (DP55).
  - [~] L — Vault key wrapped by the PIN, one PBKDF2 at unlock, biometric holds the key (Decisions 195, 196). Built Session 111; 14 Node checks; `vite build` passes; not run through CI, not device-tested (DP71).
    - [ ] DP72 — not yet run, Session 111. App lock (Decision 198). In App Settings change the app password (or turn its biometric off and on), then leave the app so it locks: the new password opens Home, and so does biometric. Lock again from the lock button: same. Old password: Wrong password. Cold start still works.
  - [ ] DP71 — not yet run, Session 111. On the current install the Vault shows Create your Vault: set a PIN (a weak one shows the advisory). If old Vault items remain, Erase old Vault items? appears with the count: Cancel changes nothing; Erase and continue creates the Vault (Decision 197). Add a note, an image, a reminder; lock, unlock with the PIN: all open. Turn on Vault biometric (PIN asked once), lock, unlock with biometric: no wait for the PIN check, items open. Wrong PIN: Wrong PIN. Export Now with the Vault included, Restore append on the same phone with the PIN: Vault items return. With a wrong PIN: the restore says so. App-open password and its biometric unchanged. Time the Vault unlock by PIN and by biometric.
  - [ ] M — Vault files on disk in the Home format; Move re-wraps the file key (Decision 195). Planned.
  - [ ] N — Encrypted index blob, in-memory name search, lazy body search, encrypted thumbnails (Decision 195). Planned.
  - [ ] O — Backup and restore for the new Vault format (Decision 195). Planned.
  - Open: Vault PIN minimum length; optional app-password wrapper around the database key.
- [ ] **18 — PDF viewer tools (Decision 152).** Approved by the owner, in this order, one item per session. Applies to the in-app viewer in Home and Vault; with the PDF viewer switch off the phone's own app opens the file and none of these exist. All offline, no network, no account.
  - [~] A — Built Session 99 (Decision 153), `vite build` passes, search and outline logic tested in Node against a real PDF; not run through CI, not device-tested (DP38). Reading tools (`pdfjs-dist` only): text layer (select, copy), search inside the PDF with match count and next/previous, jump to page, page thumbnails, the PDF's outline, password-protected PDFs (passkey asked in the text sheet, never stored, field emptied on close).
  - [x] B — Mark-up and forms (Session 105, Decision 166; own mark-up on `pdf-lib` instead of the pdf.js editor): highlight, text, drawing, stamp, undo, form fill. Saved as a new copy by default; replacing the original is an explicit choice with its consequence stated. Vault copies are encrypted under the Vault key. Export checked in Node against pdf.js geometry (rotations, crop box, forms, password-protected file refused); `vite build` passes; confirmed on device (DP48); not run through CI.
  - [~] C — Page tools and image to PDF (`pdf-lib`, already bundled by Decision 166, not crypto). Output is always a new copy.
    - [x] C1 — Built Session 106 (Decision 167): rotate, delete, reorder, extract, split by range, on the open PDF. `vite build` passes (new chunks 2.9 kB and 6.6 kB, `pdf-lib` unchanged); 31 Node checks on `pdfpages.js`; not run through CI; confirmed on device (DP49).
    - [x] C2 — Built Session 106 (Decision 168): Make a PDF button in the selection bar; a selection of PDFs merges, a selection of pictures becomes one PDF (each converted to JPEG first, so orientation is applied); order sheet; output a new entry in Home or the Vault. 35 Node checks on `pdfpages.js` (lazy items, failing item position, real JPEG input); `vite build` passes; not run through CI; confirmed on device (DP50).
    - [x] C3 — Built Session 106 (Decision 169): Picture tool in the mark-up: pick a picture, optional Clear background, tap to place, size S, M or L, saved with the other marks. Placement checked in Node against pdf.js (rotations, crop box); `vite build` passes; not run through CI; confirmed on device (DP51).
  - Not doing, by decision: conversion to or from Office files, summaries or questions about a document, cloud sharing or collaboration, OCR of scanned PDFs, cryptographic digital signatures. Reasons in Decision 152. OCR of images and PDFs generally: Decision 192.
- [~] **DP — Device pass backlog (Sessions 55 to 74).** Built and reasoned from code, never confirmed on a device. Run
  one by one, newest risk first; mark each with the session that confirms it.
  - [x] DP1 — Backup and restore (Session 69, Decision 91): install over an older build, existing entries survive the
    migration; backup, then restore in append mode and in overwrite mode, keeps name, tags and description.
  - [x] DP2 — Credentials and lock (Sessions 65, 72): app password field empty after the lock button, idle lock, app
    switch and screen off; Vault PIN field empty after the Vault locks; the lock button on Home and Settings shows the
    lock screen; first-run Continue still saves.
  - [x] DP3 — Biometrics (Sessions 65, 66): buttons hidden when none are enrolled; shown and working when enrolled.
  - [x] DP4 — Location capture (Session 57): permission dialog, a fix outdoors and indoors, timeout notice with no fix,
    Share sheet.
  - [x] DP5 — Location viewer (Session 71): coordinates and pin in both themes, Open in Maps launches the maps app,
    Copy, rename and tags from the pencil, locking the app with the viewer open.
  - [x] DP6 — Updates (Sessions 55, 58, 66): Check for updates names the newest build; Download update stays disabled
    until a check finds a newer one, then hands off to the download and completes.
  - [x] DP7 — Look (Sessions 64, 67): Inter font loads, tiles fit the screen width, light theme, no sideways scroll on
    Home or Vault, background art does not hurt legibility in either theme.
  - [x] DP8 — Batch add (Session 62): a second batch with the same label continues the numbering; Cancel saves nothing.
  - [x] DP9 — Row actions (Session 61): four actions in order on Home and Vault rows; Select files offers Share.
  - [x] DP10 — Home folders and counts (Sessions 59, 63): counts on the cards after capture; the Vault mirrors Home.
  - [x] DP11 — Reminder dialog (Session 70): preset chips, a past time refused, a fired one-off offers Reschedule only,
    deleting a reminder before it is due stops its notification.
  - [x] DP12 — Install over an older build with a reminder pending (Sessions 75 to 78): it still fires, buttons work.
  - [x] DP13 — confirmed on device in Session 92. Original check: repeating reminders beyond the first day (Decisions 107, 108): a daily one fires again the next day;
    weekly and monthly ones; Done for now keeps the series; Repeat set to none stops it.
  - [x] DP14 — confirmed on device in Session 91. Original check: Open Files with the phone's app (Session 87, Decisions 118, 120): tapping a Home file opens it in a matching app with no
    detail step; the row icon shows the extension; a Vault file does the same and the Vault locks per its settings; no matching app
    shows a plain message; after returning, `cache/open/` is empty.
  - [x] DP15 — confirmed on device in Session 91. Original check: PDF viewer (Session 87, Decision 121): a Home PDF opens and draws; scrolling a long one stays smooth; page count updates;
    zoom in and out keeps your place and allows sideways scroll; rotate the phone; a password-protected PDF shows the message and
    Open with app works; a Vault PDF opens, then lock the app with it open and confirm it closes; rename from the pencil keeps the
    page. Check a PDF with unusual fonts or a scan.
  - [x] DP16 — confirmed on device in Session 87 (image grid selection with bar and ticks; Back circle aligned). Original check: long press a row in a Home folder, a Vault folder
    and a search list (text, reminder, voice, location, image tile, PDF, file); more taps add and remove; Select all; Share, Download and
    Delete act on the selection; Back and the cancel button leave selection mode; locking leaves it; the Home | Back | Vault bar sits
    low enough that its Back circle lines up with the floating Back in folders and viewers.
  - [~] **Money capture (Session 87, Decision 124; steps 1 and 2 built Session 88, step 3 built Session 89, Decision 126, steps 4 and 5 built Session 91, Decisions 130 and 131; DP18 to DP22 confirmed on a device in Session 91).** Build order: (1) done: `money.js`: model, repayment maths, month totals,
    currency list, Node-tested; (2) done: schema: `money_json` column via `ensureColumn`, backup restore writes it (export already `SELECT *`); (3) done: Home: form,
    list rows, month header, repayment dialog, edit, viewer (search reads the summary and note); (4) done: Settings: Currency tile under Preferences, chips plus free text, `currency_symbol` carried by the App Settings backup category; (5) done: expense detection removed from `captureText` and `intents.js`, reminder detection kept;
    (6) done, Session 92, Decision 135: Vault Money (JSON in `encrypted_body`), not device-tested. Open question: reminder text detection stays unless told otherwise.
  - [x] DP18 — confirmed on device in Session 91. Original check: Money on Home (Sessions 89 and 90, Decisions 126 and 128): add one of each kind; the row meta shows kind, amount, status, date; Lent shows the person and due date; Add repayment pre-fills the remaining amount, a partial one shows "Partly returned" and what is left, a full one settles and greys the row; an overrun is refused; edit keeps repayments and fixes the kind; the month header totals and previous and next move; loans stay out of Net; search finds an entry by summary and by note; lock with a Money dialog open closes it; IMPS, RTGS and NEFT show as method chips; the Repayments section at the end of Lent and Borrowed adds several partial repayments with date, method and note, and removing one before saving works; Month and Year dropdowns and the small arrows sit in one row; the year list shows two years either side, oldest first, and a typed year jumps to any year from 1900; Back closes the Money form and the repayment dialog like Cancel, and the Back button is lit while they are open (Decision 132).
  - [x] DP19 — confirmed on device in Session 91. Original check: Currency symbol (Session 91, Decision 130): Settings > Preferences > Currency shows the current symbol selected; tapping a chip changes it and Money rows and the month header redraw with it; a typed symbol of 1 to 5 characters applies on Enter or the button; an empty or longer entry shows a message and changes nothing; backup with App Settings, change the symbol, restore, and the symbol and chip selection return.
  - [x] DP20 — confirmed on device in Session 91. Original check: Detection removal (Session 91, Decision 131): type "spent 500 on food" in Home text capture and it saves as a plain note, not a Money entry; "remind me tomorrow at 9am to call mom" still makes a reminder; an old expense row still lists in Money and counts as Spent.
  - [x] DP21 — confirmed on device in Session 91. Original check: Discard (Session 91, Decision 133): in an edit dialog change the name, Back asks Discard, No keeps it, Yes closes; no change, Back closes with no question; same on the Money form and repayment dialog (Cancel too), the coordinates paste, and the Vault; Settings: type a backup passkey, Back asks; after a successful backup Back asks nothing.
  - [x] DP28 — confirmed on device in Session 94. Original check: Vault Location (Session 93, Decision 142). Check: Vault, Location, New offers current location or coordinates; both reach the Save dialog with the pasted place name or `Location <time>` as the default name; the paste dialog shows Verify link for a short link, as on Home; the saved row opens a viewer with degrees, decimal, grid plot, Copy, Open in Maps; Share and Download give the name and map link (Download also the note); Edit changes name, tags and description only; search finds the decimal coordinates, tags and description; delete, Undo and restore from trash work; a Vault lock during the GPS fix or in either dialog saves nothing; the coordinates paste dialog on Home stays open when only the Vault locks; backup then append-restore with another PIN keeps the entry readable; Home Location unchanged (capture, viewer, Verify link).
  - [x] DP39 — confirmed on device in Session 99: the 41.92 MB PDF opens from Home (Decision 154). Still unchecked: a Vault PDF after the change.
  - [x] DP38 — confirmed on device in Session 100 (all items). Earlier note: small-PDF check passed in Session 99; the rest was: Vault lock with a panel open, Back order, pinch zoom, a scanned PDF, speed on 100+ pages. Original list: PDF reading tools (Session 99, Decision 153). Check: open a PDF with real text, Home and Vault; long-press a word and select, copy, paste elsewhere; Find: type 2 or more characters, count reads "1 of N", next and previous move and wrap, the current match is orange and others yellow, matches survive zoom and scrolling, closing Find clears the marks and the field; a scanned PDF finds nothing and selects nothing; Pages: thumbnails fill in while scrolling, the current page has a border, tapping one jumps; Outline lists entries with page numbers and jumps, a PDF without one says so; Go to page clamps to 1..N and ignores text; Back closes Pages, then Find, then the viewer; lock the Vault with a panel and a query open and confirm all close with the text gone; pinch and the + and - buttons still work; a large PDF (100+ pages) searches without freezing; a password-protected PDF still asks.
  - [x] DP40 — confirmed on device in Session 100. Original check: entrance motion (Session 100, Decision 155): screens and backdrops fade in on Home, Vault, lock screen and dialogs; toast slides in; no flicker or stuck-transparent screen after lock and unlock; nothing moves with the system animation setting off.
  - [x] DP46 — confirmed on device and in CI, Session 104 (Decision 165). Name Arkly, notification title and tone, biometric unlock, Drive backups still listed, downloads in Documents/Arkly, a docs-only commit starts no Actions run and a code commit does.
  - [x] DP59 — confirmed on device, Session 108. Autosave, Text (Session 108, Decisions 176, 177). Home, Text, New: type words, do not save, lock the app (lock button, then also screen off, then also Home button with the app killed from recents). Unlock: a toast says unsaved text was saved and Text lists "Autosave <date time>" with the words. Home, open a saved note, add words, do not save, lock, unlock: the saved note has the added words, name unchanged. Back then Yes, discard on a new note and on an edit: nothing is saved at the next unlock. Back with no change: nothing saved. Save normally: no Autosave appears later. Vault: the same four checks in Vault, Text; the Autosave appears after the next Vault unlock, readable; Vault lock with the editor open. A backup and restore does not carry drafts. Reminder offer sheet open at lock: the text appears as an Autosave note.
  - [x] DP61 — confirmed on device, Session 108. Original check: Home voice behind a lock (Session 108, Decision 180). Home, Voice: the switch "Keep recording when the app locks or goes to the background" shows, off. Turn it on, Record, lock the app, wait 30 seconds, unlock: the recorder opens on the running take with the time counted on; Stop, review: the audio covers the whole time including the locked part; Save works. Turn it on during a take, then lock: the same. Off: a lock stops the take and keeps an Autosave entry (DP60). Back then Yes, discard while it runs: nothing saved. Screen off and idle lock behave the same. The Vault recorder has no switch. Note the longest take that saves without the app closing.
  - [x] DP60 — confirmed on device, Session 108. Original check: Autosave, Voice (Session 108, Decision 179). Home, Voice, Record: record a few seconds, lock the app (lock button), unlock: Voice lists "Autosave <date time>" that plays the recorded part. Record, Stop, then lock while the review shows: the same. Record, Stop, Save, then lock while the Save dialog is open: the take is kept as an Autosave entry. Record, then screen off: the same. Back then Yes, discard (while recording and in review): nothing saved. Discard button: nothing saved. Cancel in the Save dialog: nothing saved. Save with a name: saved once, no Autosave. Repeat in the Vault; the Autosave appears after the next Vault unlock and plays. Note whether the recorder keeps recording or stops when the screen turns off, and the length kept.
  - [x] DP58 — confirmed on device, Session 108. Note and reminder (Session 108, Decisions 175, 178). Home, Text: type "remind me tomorrow at 9am to call mom", Save with a name and one tag: the note is saved, then a sheet "Also set a reminder?" shows the label and time. Set reminder too: a note and a reminder both exist (reminder named "call mom", same tag), the toast shows the time and distance, the notification fires. Note only: just the note. Back on the sheet: just the note. Lock with the sheet open: the note is saved, no reminder. "remind me today at 8am" after 8am: no sheet, a note. Plain text: no sheet. Vault Text with the same words: a plain Vault note, no sheet. Reminder card on Home unchanged.
  - [x] DP62 — confirmed on device, Session 109. Move, step 1 (Decision 182). Home, Text, Location and Money rows show a Move to Vault icon before the bin; Voice, Image, PDF, Files and Reminder rows show none; Vault rows of the same three types show Move to Home. Vault locked, tap Move on Home: a notice and the Vault PIN screen; unlock, return, tap Move again. Sheet states both consequences; Cancel changes nothing. Move a Text with two tags, a note and a past date: it leaves Home, appears in the Vault folder with the same name, tags, note and date; Home search and the Home name suggestions no longer show its name. Money with a repayment keeps amount, returned and remaining; Location keeps its coordinates and opens the map link. Move each back to Home: searchable by name and text, same tags, note and date; not in either Trash. Lock the Vault while the sheet is open, then Move: nothing moves. A large Text (about 200 KB) moves. Backup then restore in append mode shows no duplicate.
  - [x] DP63 — confirmed on device, Session 109. Move, step 2 Reminder (Decision 183). Home, Reminder rows show Move to Vault; Vault Reminder rows show Move to Home. Home, a repeating reminder (daily) with a note and a tag, a time two minutes ahead: Move to Vault, sheet mentions Vault Reminder. It leaves Home, shows in the Vault Reminder folder with the same name, note, tag, time and repeat. At the time the notification reads Vault Reminder, once, not twice; Snooze and Done work from it. Move it back: at the next time the notification shows its name, once. A one-off reminder with a time ahead moves and still fires once; a done reminder stays done and does not fire; a reminder snoozed for ten minutes still fires after the remaining time. A fired one-off moves and stays fired. Lock the Vault while the sheet is open, then Move: nothing moves. Reboot the phone after a move: the reminder still fires once.
  - [x] DP64 — confirmed on device, Session 109. Move, step 3 Voice, Image, PDF, Files (Session 109, Decision 184). Home rows of these four types show Move to Vault; Vault rows show Move to Home. Move a small Image to the Vault: it leaves Home, opens in the Vault viewer as the same picture, name, tags, note and date kept. Move it back: opens the same, the file is encrypted on Home as before. Same for a PDF (same pages, Edit PDF still opens it), a Voice recording (plays, same length) and a Files item of each category (Share and Download give the same file). A reasonably large file, then a very large one: each either moves or shows Not moved with the original untouched. If the app closes during a move, reopen: the original is still there, at most with an extra copy on the other side to delete. Tap Move twice quickly: one move only. Storage in Settings does not grow by the file's size after a move. Vault Image rows keep their text search after a move back (name only, no OCR yet).
  - [x] DP66 — confirmed on device, Session 110. Autosave, Reminder, Location, Money (Session 110, Decision 189). Home, Reminder, New: change the name, then lock the app and unlock: a Reminder entry with that name appears, the toast says it is not scheduled, and no notification fires for it. Change only the note and press Home to the launcher, reopen, lock, unlock: the same. Open the dialog and change nothing, lock, unlock: nothing is added. Discard with Yes: nothing is added at the next unlock. Home, Money, New: type an amount, lock, unlock: a Money entry with that amount, kind, category and method, named Autosave and the date. Clear the amount, type a category, lock, unlock: a Text entry listing Kind, Category and When. Fill the Money form, Continue, change the name in the Save dialog, lock: a Money entry with that name. Back to amount keeps the fields. Home, Location, current location: get a fix, lock at the Save dialog: a Location entry at that fix. Paste coordinates, lock before Continue: a Location entry; paste text with no coordinates, lock: a Text entry listing Pasted. Same four checks in the Vault, locking the Vault (and the app): the entries appear at the next Vault unlock and are listed at once; with the Vault unlocked and the app backgrounded for a while the row is kept. Save normally after a background: no Autosave entry appears later. Force-close the app with a form open and a change half a second old: the entry appears at the next unlock.
  - [ ] DP70 — not yet run, Session 111. Vault tab (Decision 194; reported: Vault Trash drew under the landing tiles). Open Vault Trash, tap Home, tap Vault: the card grid shows alone. Open Trash, tap the Vault tab again: the grid shows alone. Same for Vault Settings (type in the PIN confirm field first: Discard? appears). Trash tile still opens Trash as its own view; Back returns to the grid.
  - [ ] DP69 — not yet run, Session 111. Vault Trash (Decision 193; reported: the Vault Trash showed no files and the app crashed). Vault: move a large Image or PDF (several MB) and a Voice recording to the trash, open Vault Trash: all rows list with their names, no crash. Restore one: it returns to the Vault list. Delete one permanently, then Undo within the toast: it stays in the trash. Restore a Vault Reminder: its notification is scheduled again. Home Trash still lists and restores as before.
  - [x] DP68 — confirmed on device, Session 110. Redraw after a committed draft (Session 110, Decision 191). Home, Money: leave the Money folder open on its list, edit an entry's amount, lock, unlock: the list and the month totals show the new amount at once, without opening the entry. The same with a Reminder time and a Location name in their folders, and with the folder counts after a new autosaved entry. Vault: the same with the Vault locked from the Vault screen, then unlocked: the list shows the new data at once. Text and Voice autosaves (Decisions 177, 179) also appear in their lists at once. An unlock that commits nothing does not flash or reload the lists.
  - [x] DP67 — confirmed on device, Session 110 (found: the lists showed the old data until an entry was opened, Decision 191). Autosave, edits of Reminder, Location, Money (Session 110, Decision 190). Home, Money: open an entry, Edit, change the amount, lock, unlock: the entry shows the new amount and the toast says the work was saved to its entry. Edit, change only the name in the Save dialog, lock: the name changes. Clear the amount in the form, lock: a Text entry `Autosave <date time>` with `Money entry edit (not finished)`, `Entry: <name>` and the filled-in fields; the entry is unchanged. Edit and change nothing, lock: nothing changes. Discard with Yes: nothing at the next unlock. Home, Reminder: Edit, change the time, lock, unlock: the entry shows the new time and its notification fires at the new time, not the old; a finished reminder with a new time becomes active again. Edit, change only the note: the time and a finished state are unchanged. Home, Location: Edit details, change the name, lock: the name changes. Edit a reminder to a time that will already have passed at unlock (set it two minutes ahead, lock, wait, unlock): no notification fires at once and the old one does not fire. A repeating reminder keeps its notifications. Vault, Reminder: the same time change, locking the Vault, then unlock: the notification fires at the new time and shows the Vault text, not the name. The same checks in the Vault, locking the Vault, and with the app backgrounded. Save normally after a background: no Autosave entry appears later. Voice, Image, PDF and Files Edit details are unchanged.
  - [x] DP65 — confirmed on device, Session 109. Move, step 4 (Session 109, Decision 185). Long-press a Home row, select several of mixed types (a Text, a Money, a Reminder, an Image, a PDF), tap the Move icon in the bar: its tooltip reads Move to Vault. Vault locked: the Move sheet comes first and says the Vault is locked, with the button reading Unlock and move; Cancel there leaves the Vault locked. Unlock and move: the biometric prompt (when enabled), then a PIN sheet, over the same page; the page, folder and selection are unchanged and the move follows. With biometric off only the PIN sheet shows; a wrong PIN shows it again with a notice; Cancel on it moves nothing and the selection stays. The same for a single Move on a Home row. No Vault PIN set: a sheet says to set the Vault up and offers Open Vault. Unlocked: the sheet gives the count; Cancel changes nothing; Move shows Moving 1 of N and ends with a count. All items appear in the Vault folders with names, tags, notes and dates; none remain in Home. Select in the Vault, tap Move (tooltip Move to Home): they return to Home and are searchable. A selection holding a failing item (a PDF whose file is missing) moves the rest and says how many were not moved and why; the failing item stays put. Search a name, select results and Move: works from the search list. The bar still fits on a narrow phone: the selected count may shorten but all icons are tappable. Make a PDF, Share, Download and Delete in the bar still work.
  - [x] DP57 — confirmed on device, Session 107. Decision 174. Vault batch numbering. Vault, Files folder: pick 3 files, Save, choose the numbered option, name them Test: they save as Test 1, Test 2, Test 3. Pick 2 more files, same name: Test 4 and Test 5. A different name starts at 1. Keep-each-name still keeps the file names. A single file keeps the name typed. Home batch add unchanged. Then delete the Test entries.
  - [x] DP56 — closed, Session 107: haptics dropped (Decision 173), nothing to test.
  - [x] DP55 — confirmed on device, Session 107 (the first unlock of the password and the first unlock of the Vault each took longer, the upgrades; everything else works). Decision 172. Password and PIN hash counts. On the owner's phone with an app-open password and a Vault PIN already set: (1) lock the app, unlock with the password: it opens, the first unlock takes noticeably longer than later ones; lock and unlock again: it opens. (2) Open the Vault with the PIN: it opens and its entries read; lock and open again. (3) A wrong password and a wrong PIN are still refused. (4) Biometric unlock for both still works after (1) and (2). (5) Settings: change the password and the PIN, lock, unlock with the new ones; the old ones are refused; Vault entries still read after a PIN change. (6) Backup now and Restore (append and overwrite) still work. Note the delay at each unlock.
  - [x] DP54 — confirmed on device, Session 106 (fast). Overwrite restore speed (Session 106). Restore an Overwrite of a backup with about 40 entries across several categories: the status shows "Replacing current data, n of m…" counting up and the step is clearly shorter than before; then "Restoring n of m…"; result "Done" with the same counts as before. Overwrite with only one category selected still leaves the others untouched. Append restore unchanged.
  - [x] DP53 — confirmed on device, Session 106 (Overwrite restore sat on "Replacing current data…" for a long time: fixed, see DP54). Backup key iterations (Session 106, Decision 171). Settings, Backup now: a backup is made and the time from tap to "Saved" is noted (expect about 1 to 3 seconds more than before). Restore (append) of that new backup works. Restore of a backup made before this update works. Wrong passkey is refused for both. Drive Backup now and a Drive restore, if Drive is set up. Auto-backup banner run works.
  - [x] DP52 — confirmed on device, Session 106. Weak-secret warning (Session 106, Decision 170). Fresh install, first-run setup: app password of 4 characters shows "Weak password" with Use it and Change it; Change it stays on the setup screen; Use it goes on. Then a Vault PIN of 4 characters, same. 111111 as a PIN: "One character repeated". An 8-character password and a 6-character PIN pass with no dialog. Empty fields (no password, no PIN) pass with no dialog. Vault gate (PIN not yet set): short PIN warns. Settings, Backup now with a 6-character passkey warns; with 10 characters it does not; the backup runs only after Use it. Auto-backup banner with a short passkey warns and the banner stays open after Change it. Drive Backup now warns the same way. Restore with a short passkey does not warn. Back button on the dialog counts as Change it.
  - [x] DP51 — confirmed on device, Session 106. Picture tool (Session 106, Decision 169). Open a PDF in Home, Mark up, Picture: the phone's picker opens and the app does not lock when it returns. Choose a photo of a signature on white paper: tapping a page places it centred on the tap, the white is clear and page text shows through. Clear background off: the white shows. S, M, L change the size of the next placement. Place twice, Undo removes one. Change picture: new placements use the new one, old ones stay. Cancel the picker: nothing changes, the tool stays. Save new copy: the picture is on the page in the same place, on a rotated page too. Replace original works. Discard on Close with a placement. Repeat in the Vault. A large camera photo (12 MP or more) places without the app closing.
  - [x] DP50 — confirmed on device, Session 106. Merge PDFs and Make a PDF (Session 106, Decision 168). Home, PDF folder: long press a PDF, tap a second, tap Make a PDF: the sheet lists both in tap order, earlier and later buttons reorder, an empty name is refused, Cancel and Back make nothing. Make PDF adds one entry with the pages in that order, originals untouched. One PDF selected: message. A PDF and a picture selected: message. Password-protected PDF in the selection: message names it. Image folder: select three pictures including one taken in portrait with the phone camera, a PNG with transparency: one PDF, one page each, upright, transparency white. One picture alone works. Search list selection works. Repeat in the Vault: output appears in the Vault. The selection bar still fits on a narrow screen. A 20+ picture selection finishes without the app closing.
  - [x] DP49 — confirmed on device, Session 106. Page tools (Decision 167). Open a PDF in Home: Edit pages opens the grid with thumbnails. Rotate left and right turn a thumbnail; move earlier and later change the position number; delete removes a page and the last page refuses; Reset restores all. Save copy is disabled until something changes; saving adds an entry "(edited)" beside the original with the changes, original untouched. Select two pages, Extract adds one entry. Split with 1-2, 3-3 adds two entries; a bad range shows a message. Close with unsaved changes asks Discard. Back closes the grid first. Password-protected PDF shows the reading-only message. Repeat in the Vault: copies appear in the Vault. Long PDF (50+ pages): grid scrolls, thumbnails appear.
  - [x] DP48 — confirmed on device, Session 105, all checks (Decision 166). Open a PDF in Home: Mark up button opens the bar; Highlight and Draw drag without scrolling, tapping the tool again scrolls; Text and Stamp place on tap; Undo; Form lists fields of a fillable PDF; Save new copy appears beside the original named "… (marked)" and shows the marks, in a rotated page too; Replace original asks twice and removes the original; Close with marks asks Discard; a password-protected PDF says it is read-only; same in the Vault; a 20+ page PDF saves without a crash.
  - [x] DP47 — confirmed on device, Session 104. A wrong password, then the right one, then a new lock shows no old message; typing clears it; a cancelled biometric prompt shows its message once and it clears on the next lock.
  - [x] DP45 — confirmed on device, Session 104 (Decision 164). Token saved, update found, download completed after the folder fix, installer prompt, install over the current build, Remove token.
  - [x] DP44 — confirmed on device, Session 104. Export Now first; installed over the current build; "Securing files: N of M" showed once (14 of 25 on screen) and the app opened; files open as before. Original check: Home images, voice notes, PDFs and files all open as before; Settings storage figures unchanged; a restart shows no notice.
  - [x] DP43 — confirmed on device, Session 104. Original check: install over the current build; existing files still open (plain until F); add an image, a voice note, a PDF and a file on Home and use each (open, Share, Download, Open with phone app, sizes); Export Now, then Restore (append, then overwrite with the safety backup); delete one new file permanently from Trash; note whether a Home image grid with many images feels slower after a restart (thumbnails are no longer cached on disk). Export Now, Restore (append: 38 exact duplicates skipped) and Restore (overwrite: 38 added) shown on screen.
  - [x] DP41 — confirmed on device in Session 100 (all items, including the notice of Decision 157). Original check: Vault unlock speed (Decision 156). Check: with a Vault holding large files (a big PDF, several images), the first unlock after the update is as slow as before (it rebuilds the records once); lock and unlock again: clearly faster; list, sizes, tags and Vault Search (including text found in a scanned image or PDF, if any exists) read the same as before; add a file, rename it, trash and Undo it: each shows at once; edit an image's text if that path is reachable: search finds the new text; restore a backup into the Vault (append, then overwrite): entries list and search correctly after the next unlock; Home is unaffected. Note the unlock time before and after. The first slow unlock shows "Preparing Vault: N of M" counting up and the notice disappears when the Vault opens; later unlocks show none; the notice also shows after a restore into the Vault.
  - [x] DP37 — confirmed on device in Session 98. Original check: Vault index per entry (Decision 151). Check: with a Vault of 50 or more entries, add a note, edit a name, edit a Money entry, add a repayment, trash, Undo, restore from Vault Trash and delete permanently: each shows in the list and in Vault Search at once, and none feels slower than before (the point of the change); bulk delete from Select files removes every chosen item from the list and search; a Vault entry's name and tags in search match what the list shows after an edit; lock and unlock gives the same list; Home is unaffected. Note how long a save takes with a large Vault, before and after if a previous build is at hand.
  - [x] DP36 — Free space and sizes (Session 97, Decision 150), confirmed on device — Session 97. Check: Settings > Your Data shows a size close to the Storage breakdown total, not ~0 B; Storage breakdown shows Money and Location above 0 B (a few hundred bytes and 16 B plus any description); back up with free space and it succeeds; Select files sizes for Money and Location match; with the phone nearly full, a backup or restore says "Not enough space" with the needed and free figures instead of failing midway; in Settings > Backup the free figure matches the phone's own storage screen (within the system's rounding). The first build with `@capacitor/device` must pass CI.
  - [x] DP35 — In-app sheets replace native dialogs (Session 97, Decision 149), confirmed on device — Session 97. Check: wrong app password, wrong Vault PIN, wrong PIN in a biometric confirm and a failed Vault biometric each show a toast, no system dialog; Home Trash and Vault Trash: Delete permanently opens the Yes/No sheet (Delete / Keep), Back keeps, Delete then Undo still works; Select files: Delete asks through the sheet, Cancel and Back leave the selection; Settings > Storage breakdown: Clear items older than 30 days asks through the sheet; lock with any sheet open closes it; the Back button is lit while a sheet is open. Not reachable on a device now: Drive passkey and restore-mode sheets (Drive not configured), legacy expense Edit amount and category sheets.
  - [x] DP34 — Trash Undo, pinch zoom, PDF switch (Session 96, Decision 148), confirmed on device — Session 97. Check: Home and Vault Trash, Restore shows Undo and Undo puts the item back in the trash with its days-left unchanged; Delete permanently asks, the row leaves at once, Undo brings it back, doing nothing for a few seconds deletes it; a second permanent delete finishes the first; locking the Vault finishes a Vault one. PDF viewer on Home and in the Vault: pinch in and out stays anchored under the fingers, redraws sharp, limits at fit width and 4x, scrolling and the + and - buttons still work, no browser page zoom. PDF folder top shows the switch on Home and in the Vault (same state in both); off: tapping a PDF, also from search, opens the phone's PDF app or chooser; on: in-app viewer again; the choice survives restart and a backup restore.
  - [x] DP33 — Vault tools, Trash, Search, Select (Session 95, Decision 147), confirmed on device — Session 97. Check: Vault landing shows four icon-only tiles (Select, Search, Trash, Settings) and no search box or Select files button; Settings opens the settings view with every switch working, Back returns, Back asks Discard with a typed confirm PIN; Trash opens as a folder, rows show decrypted names, type, deleted date, days left; Restore returns the item to its folder and count; Delete permanently asks first; chips, Sort and When work; empty message shows; Settings no longer holds Vault Trash. Search from the Vault tile: placeholder says Vault, results are Vault items only (name, tags, description, text), open and Back return to results, long-press selects and bulk Share, Download and Delete work, locking the Vault or tapping Home closes it with text gone; Home Search still finds Home items only. Select from the Vault: only Vault items, one chip per type, sizes shown; Home Select shows no Vault items even while the Vault is unlocked; locking the Vault closes the Vault Select dialog. Both themes, reduced motion.
  - [x] DP32 — Home tools, Trash, Search, Select (Session 94, Decision 146), confirmed on device — Session 97. Check: Home shows four icon-only tiles in one row (Select, Search, Trash, Settings; no visible labels) and no search box or Select files button; Settings opens Settings, and Settings no longer lists Trash. Trash: opens as a folder, Back returns to Home; rows show type, deleted date, days left; Restore returns the item to its folder and the count; Delete permanently asks first; type chips, Sort and When change the list; an empty Trash shows its message; a legacy expense row appears under Money. Search: the bar grows out of the tile, the keyboard is up when it lands; typing shows results with chips, Sort and When; Enter lowers the keyboard; tapping a result opens it and Back returns to the results; Back or the close button reverses the animation; locking the app or switching to the Vault closes it with the text gone; the lock and power buttons are hidden while it is open; Undo after a delete redraws it. Select: chips and Sort work, ticks survive a filter or sort change, Share, Download and Delete selected still work. Both themes, and reduced motion on (no animation). Second build: Trash now shows its rows; Select files keeps one size for every type, shows all types at once, and Back is lit and works while it is open; the Search close button is a plain round button.
  - [x] DP31 — Home lock button after a Vault lock (Session 94), confirmed on device — Session 97. Check: in the Vault, tap the lock button; it lands on Home and the lock button is still shown on Home; it still locks the app when a password is set, and shows greyed when none is set; unlock the Vault again and its lock button shows.
  - [x] DP30 — confirmed on device in Session 94. Original check: Vault labels encrypted (Session 94, Decision 145). Check: install over the previous build, unlock the Vault once, and every existing entry keeps its name in the list, search, viewer, trash, Share and Download file name; a new entry's name shows the same; editing a name works and survives a lock and unlock; Select files shows names; backup, then append-restore on the same PIN and on another PIN, keeps names and adds no "(Restored)" to Vault entries; restore a backup made before this build and its names are readable after the next unlock; Home names, search and autocomplete unchanged.
  - [x] DP29 — confirmed on device in Session 94. Original check: Vault matches Home (Session 93, Decision 143). Check: new Vault Money entry defaults to the readable summary and Edit rewrites an unchanged summary name; Vault rows show type and date (no size); Select files still shows sizes; Share and Download of a Vault Money, Reminder and Location entry include the note; Home Share of Money, Reminder and Location sends the same text as Download; Vault Verify link resolves a short map link.
  - [x] DP27 — Vault Reminder and viewer actions (Session 92, Decisions 140, 141) — confirmed on device in Session 92.
  - [x] DP26 — Locks always show the gate (Session 92, Decision 139) — confirmed on device in Session 92.
  - [x] DP25 — Undo and native Back (Session 92, Decisions 137, 138) — confirmed on device in Session 92.
  - [x] DP24 — Row buttons and downloads (Session 92, Decision 136) — confirmed on device in Session 92.
  - [x] DP23 — Vault Money (Session 92, Decision 135) — confirmed on device in Session 92.
  - [x] DP22 — confirmed on device in Session 91. Original check: Action order (Session 91, Decision 134): every row shows Edit, Share, Download, Delete in that order, Delete a red bin, in Home and the Vault; image viewer header and Select files Delete match.
  - Session 87: DP15 confirmed for a Home PDF (draws, zoom, sideways scroll, page count), rename keeps the page, and the protected-PDF
    message and Open with app fallback (Home and Vault). A Vault PDF that opens normally and locking with it open are still unchecked.
  - [x] DP17 — In-app PDF password (Session 87, Decision 125) — confirmed on device in Session 92: right password opens, wrong one asks again, Cancel offers Open with app, Back and a Vault lock close the prompt, reopening asks again.
  - Session 87: DP14 partly confirmed: a Home file opens in the phone's app with no detail step and the row icon shows the extension.
    Still unchecked: a Vault file, a type with no app, and the empty `cache/open/` after returning.
  - Session 86: DP1 to DP12 confirmed on device. DP4 no-fix notice confirmed (Location services off). DP13: Done for now and Repeat
    set to none confirmed; the next-day fire of daily, weekly and monthly repeats is still pending.
  - Confirmed in passing, Session 85: Save dialog and tags (Session 69), Back (Sessions 60, 83), Home multi-select
    (Session 62), reminder notification, Done and Snooze (Sessions 70, 73, 74).
