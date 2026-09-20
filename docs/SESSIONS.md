# Sessions

Most recent first. Numbered, no dates (see TRACK.md).

---

**Session 13**

Pivot, spanning a large chunk of the app: app-open password made optional; "Private Notes"
generalized into a full Private Vault covering Text/Voice/Image/PDF/Files, with the explicit goal
of full functional parity with the main app (same capture, edit, tags, search, trash, five per-file
actions). Decisions 36–44. New file: `vault.js`. Changed: `db.js`, `backup.js`, `fileactions.js`,
`app.js`, `index.html`, `style.css`.

Built: `vault.js` (content bundling — note text unchanged, file types get a small JSON envelope of
base64 bytes + OCR text, encrypted together via the exact same `encryptPrivateNote`/
`decryptPrivateNote` calls private notes always used; save/load; the in-memory-only search index,
chosen over a persistent encrypted index specifically to avoid a second on-disk artifact that has
to stay in sync with the vault's actual contents). Optional app-password flow, including a
first-run setup screen that — it turned out — never existed before at all, only the check-against-it
path did. The vault's own trash bin and its own auto-lock timer, independent of the main app's.
Share/Download reversed to work identically for vault and non-vault entries, on explicit direction
overriding an earlier, more cautious default. The "Select files" multi-select screen, shared between
main and vault, category-grouped with per-item size.

Bugs found and fixed, in order of how serious they were:
1. **Two real privacy leaks**, both pre-existing, surfaced while designing how vault content should
   be indexed: `insertEntry()` (db.js) and `restoreBackup()` (backup.js) were writing every entry's
   **label** — not just its body — into `entries_fts` and `label_history` unconditionally, meaning
   a vault item's title was discoverable via ordinary, no-PIN search and could surface as an
   autocomplete suggestion in the normal capture bar. Fixed in both places.
2. **A foundational gap**: nothing anywhere ever toggled screen visibility. `unlock-btn` had no
   click listener; `main-screen` was never actually shown after a successful unlock. Every UI
   section built across every session since backup/restore first got a UI has been technically
   unreachable until `showScreen()` was added this session while wiring the optional-password flow.
3. Bulk "download for append" would have thrown for every vault item in a multi-select — no PIN was
   ever collected for that flow. Fixed by prompting once upfront when the action needs it.
4. Deleting a vault item (single or bulk) never rebuilt the in-memory search index, so a deleted
   item would keep appearing in vault search/browse until the next unlock. Fixed both call sites.
5. `saveNote()`'s pre-pivot private-notes path duplicated logic that now belongs to `vault.js` and
   bypassed it entirely (no index rebuild, no shared save path). Redirected to delegate to
   `captureToVault()` instead of maintaining two ways to create a private text entry.

Verified before presenting, not just written: every JS file syntax-checked (`node --check`), and
every `getElementById()` call in `app.js` cross-referenced against `index.html`'s actual ids —
zero missing.

Decisions made: 36–44.

Next session start point: same standing items — confirm the CI run is green, Phase 13 (Drive)
still blocked on manual OAuth setup. Nothing in this pivot has been run on an actual device yet,
same flagged risk as everything else. Vault UI is functional but plain (`prompt()`/`confirm()` for
capture and some per-item actions) — a real design pass is still Phase 4's job, not done here.

---

**Session 12**

Built: `www/js/fileactions.js` — Phase 7, all five per-file actions. The substantial new piece is
Download-for-append: rather than inventing a separate sidecar/encryption format, it wraps one entry
in the exact same payload shape `buildBackupPayload()` already produces for full backups (added an
`entryIds` filter to that function), encrypts it the same way `encryptBackup()` always has, and zips
that single JSON file. A `mode` field (`passkey`/`default`/`pin`) travels unencrypted alongside it so
import knows what to prompt for. The "Append files from download" multi-select screen
(`importAppendZips()`) is built and wired into `index.html`/`app.js`; it hands each decrypted file
straight to `backup.js`'s existing `restoreBackup()`, so import shares one dedup engine with local and
Drive restore rather than a fourth implementation of the same logic.

Resolved the standing zip-library choice with evidence, not habit: checked JSZip against `@zip.js/zip.js`
on current maintenance data before picking — JSZip's last release was 2022, maintenance score zero;
zip.js ships regularly, zero dependencies, TypeScript-typed. Added `@zip.js/zip.js` and
`@capacitor/share` to `package.json`.

Bug fixed, found while designing the private-notes export path (not by hunting for bugs — it fell out
of actually tracing through the cross-PIN restore code to decide how private-note exports should
work): Session 5's `restoreBackup` cross-PIN append branch referenced `entry._sourcePinSalt`, a field
`buildBackupPayload` never set anywhere. Fixed by having `buildBackupPayload` capture the device's one
`private_pin_salt` once per payload (`payload.privateNotesSalt` — one PIN, one salt, not per-entry)
and having `restoreBackup` read that instead. Cross-PIN private-notes append was silently broken until
this fix; ordinary same-PIN append was unaffected.

Share/Download(plain)/Edit/Delete are implemented and callable but have no UI buttons — flagged as a
Phase 4 gap (no rendered entry list exists yet to attach them to), not left ambiguous as a Phase 7 one.

Decisions made: 33–35.

Next session start point: same standing items — confirm the CI run is green; Phase 13 still blocked
on the manual Google Cloud Console steps. Phase 7's per-file zip flow and Phase 6/13's UI are all
testable together once a build succeeds and Phase 4 gets enough of a real timeline to attach
Share/Download/Edit/Delete buttons to.

---

**Session 11**

Built: the actual UI for both Phase 6 (local backup/restore) and Phase 13's settings (Drive connect,
auto-backup config, Drive backup list). `index.html` gets a Backup & Restore section and a Google
Drive section (both plain `<details>` blocks, matching Appearance's existing bare style — no visual
design pass, Phase 4 still owns that); `style.css` gets minimal supporting styles (checkbox groups,
a modal-overlay pattern, a warning-text color); `app.js` wires all of it to `backup.js`/`gdrive.js`.

Real design point resolved while wiring, not left implicit: **a due auto-backup can't run fully
silently**, because the backup passkey is never stored (existing credentials rule) and
`checkAndRunAutoBackupIfDue()`'s `passphraseGetter` hook has to come from somewhere real. Built a
small one-tap banner that asks for the passkey only when a backup is actually due, with an explicit
skip option that leaves the due-date untouched rather than silently deferring a full cycle. Recorded
as Decision 32 — this is a real behavior a future session could otherwise "simplify" back into an
unsafe passphrase cache.

Small cleanup along the way: removed `index.html`'s five separate `<script type="module">` tags for
db.js/crypto.js/intents.js/notifications.js/ads.js — `app.js` already `import`s all of them, so those
were redundant (harmless, since ES modules execute once per URL regardless, but pure clutter).

Known rough edge, flagged rather than hidden: Drive's restore and manual-backup flows use plain
`prompt()`/`confirm()` for the passkey and mode choice, while local restore and the auto-backup-due
check use the nicer purpose-built dialogs. Inconsistent, functional, worth revisiting once Phase 4
does a real design pass rather than this bare-skeleton styling.

Decisions made: 32.

Next session start point: same standing blocker on Phase 13 — none of the Drive UI can be
device-tested until the manual Google Cloud Console steps are done and a real OAuth client ID
replaces the placeholder in `capacitor.config.json`. Phase 6's local backup/restore UI has no such
blocker and can be tested as soon as a build succeeds. Also still standing: confirm the CI run is
green, and Phase 7's zip-library choice.

---

**Session 10**

Built: `www/js/gdrive.js` — the actual Drive backup engine (Session 9 was design + manual-setup docs
only). Auth via silent `GoogleAuth.signIn()`, folder find-or-create, storage check against Drive's
`about.get` quota, multipart upload of the exact same encrypted archive `backup.js` produces, a
read-only preview function, and restore that delegates to `backup.js`'s existing `restoreBackup()`
rather than duplicating its append/overwrite/dedup logic. Small schema addition: `credentials` gets a
`last_drive_backup_at` column alongside the existing local `last_backup_at`.

Resolved, with evidence rather than assumption, the two things Session 9 left open:
- **No refresh-token store of our own** (Decision 30) — dropped `grantOfflineAccess` from
  `capacitor.config.json`; the native SDK's own cached-consent sign-in is enough since every Drive
  call happens in the foreground.
- **Auto-backup scheduling mechanism** (Decision 31) — checked `@capacitor/background-runner`
  against its actual Capacitor 6 documentation before deciding, rather than assuming it would work:
  its headless environment has no SQLite or Filesystem access, so it literally cannot read entries or
  build a backup payload. Chose a check-on-app-open/resume design instead
  (`checkAndRunAutoBackupIfDue()`), consistent with the project's existing preference for local
  notifications over AlarmManager. Tradeoff stated plainly in the decision: no app open means no
  auto-backup that cycle — visible and honest rather than a silent background promise that might not
  hold.

Decisions made: 30–31.

Next session start point: unchanged blocker — none of `gdrive.js` can be device-tested until the
manual Google Cloud Console steps (`android-notes/native-setup.md` §10) are done and the real OAuth
client ID replaces the placeholder in `capacitor.config.json`. Once that's done: the Settings UI
(connect/disconnect, manual "Backup now to Drive", frequency picker) and wiring
`checkAndRunAutoBackupIfDue()` into app startup. Also still standing: confirm the CI run is green,
and Phase 7's zip-library choice.

---

**Session 9**

Built: planning + scaffolding for Phase 13 (Google Drive backup), no runtime code yet — this phase
has real prerequisites (an OAuth client that doesn't exist) the same way Phase 1's signing did.
`ARCHITECTURE.md` gets a new §4b design section; `capacitor.config.json` gets the `GoogleAuth` plugin
config block with a placeholder client ID; `package.json` gets
`@codetrix-studio/capacitor-google-auth` (chosen over the newer Capawesome Google Sign-In plugin
specifically because it supports Capacitor 6 — the project's current pin — while Capawesome's needs
Capacitor 8, a separate, larger upgrade not undertaken for this); `android-notes/native-setup.md`
gets §10, the Google Cloud Console walkthrough (project, Drive API, OAuth consent screen, Android
OAuth client, SHA-1 from the existing release keystore).

Researched before committing to any of it: confirmed `drive.file` is Google's non-sensitive scope
tier (basic verification only, not the restricted-scope security assessment full/readonly Drive
access needs) and confirmed that a Testing-status consent screen gets 7-day refresh token expiry for
any non-basic scope — both facts drove Decisions 26–27 and the explicit "publish to Production" step
in the setup walkthrough. Also confirmed the current recommended Capacitor Google Sign-In plugin
requires Capacitor 8 before picking the older, Capacitor-6-compatible alternative instead.

"Fully offline" language in `ARCHITECTURE.md` §1/header changed to "offline-first" per this session's
confirmed direction (Decision 29) — done now, ahead of the feature shipping, since the docs already
needed to describe an opt-in exception (Decision 25) regardless of when the code lands.

Decisions made: 25–29 (Drive backup is opt-in/additive; `drive.file` scope only; consent screen must
be Production, not Testing; same encrypted-archive format as local; auto-backup is time-based with
manual backup always available, plus the offline-language update).

Next session start point: same standing items (confirm the Actions run is green; Phase 6 UI or
Phase 7's zip-library choice) plus, whenever you've done the manual Google Cloud Console steps in
`android-notes/native-setup.md` §10: `gdrive.js` (mirrors `backup.js`'s create/restore shape against
Drive's API instead of the filesystem) and the background-scheduling choice for auto-backup, still
open per ARCHITECTURE.md §4b.

---

**Session 8**

Built: `resources/icon.png` background changed from dark navy to white. Un-mixed the flat, uniform
original background (`RGB(11,13,27)`, confirmed uniform by sampling) against white per-pixel rather
than a flat color swap, so soft anti-aliased edges around the folder/shield don't leave a dark fringe.
Same artwork footprint as Session 7's full-bleed crop — only color changed, not size/position — so no
regression on the double-padding fix from Decision 24.

Note: corners are pure white, but pixels nearer the artwork sit slightly off-white (~231–239) since
the original art's own soft drop-shadow, previously invisible against the dark canvas, is now a faint
visible vignette. Left as-is — reads as intentional depth, not a defect — but flagging in case a
perfectly flat white is wanted instead.

Decisions made: none (cosmetic asset change, not a new rule).

Next session start point: unchanged — confirm the Actions run is green, then Phase 6 UI or Phase 7's
zip-library choice. Re-confirm the icon on-device once built, same caveat as Session 7.

---

**Session 7**

Bugs fixed: app icon rendered visibly smaller than sibling dock icons on-device (user-reported,
confirmed via screenshot comparison). Cause: the source `resources/icon.png` already carried ~17–20%
margin (flagged as a risk in Session 6, not yet wrong at that point); `@capacitor/assets` applies its
own adaptive-icon safe-zone inset on top of whatever source it's given, so the two paddings stacked
into a double shrink. Fix: re-cropped the same artwork to its actual content bounding box and
re-centered it full-bleed (~2–6% margin) before handing it to the generator. Why correct: removing
the redundant margin leaves only the generator's own inset, matching how sibling icons are padded.

Decisions made: 24 (icon source images must be full-bleed; a rule for any future icon swap, not just
this one).

Next session start point: same as before this detour — confirm the Actions run is green, then either
the backup/restore UI (Phase 6) or a zip-library choice for Phase 7. Re-confirm the icon visually
once a build with the new crop is installed; the fix is based on measurement + the known cause, not a
second on-device screenshot.

---

**Session 6**

Built: app icon pipeline. Source artwork saved as `resources/icon.png` (1254×1254, no transparency).
Added `@capacitor/assets` as a devDependency and a `generate-icons` script; `build-android.yml` now
runs `npx @capacitor/assets generate --android` right after the `android/` platform exists (fresh or
committed) and before `cap sync`, so every mipmap density and the adaptive-icon layer are generated
from that one file on every CI run — no per-density PNGs to hand-produce or commit.

Checked (not just assumed): measured the artwork's actual margin against Android's adaptive-icon safe
zone — ~16–20% on every side, against a ~17% recommended minimum. Close enough that it should survive
a circular/squircle launcher mask, but this is a measurement against a spec, not a device screenshot;
flagged as unconfirmed in `android-notes/native-setup.md` §2 and `ROADMAP.md`.

Decisions made: 23 (icon generated from one source file via CI, not hand-crafted per density).

Next session start point: same as before — confirm the Actions run is green (still can't check this
from here), then either the backup/restore UI screens (Phase 6) or a zip-library choice for Phase 7.
The app icon can be visually confirmed once any CI build succeeds and the APK is installed.

---

**Session 5**

Built: `www/js/backup.js` — Phase 6 core engine. Create/encrypt/write a full or selective backup
(`createBackup`), open/decrypt without touching the DB (`openBackupFile`/`decryptBackupPayload`),
restore in append or overwrite mode with UUID dedup and storage sanity checks (`restoreBackup`), and
extract a category's raw files + JSON sidecar to device storage with no DB import
(`extractCategoryToStorage`). No UI wiring yet; not run on a device.

Bugs fixed (caught during this session's own build, before commit): `createBackup` initially wrote
`last_backup_at` to the `meta` table — wrong; `db.js`'s schema keeps it on the single-row
`credentials` table. Fixed to `UPDATE credentials SET last_backup_at=? WHERE id=1`. Separately, the
first draft of `buildBackupPayload`/`restoreBackup` ignored that tags are a many-to-many join
(`entry_tags`), not a column on `entries` — payload now collects each entry's tag names via a join
query, and restore re-creates the `tags` rows and `entry_tags` links (and updates `label_history`,
matching what a normal capture does via `insertEntry`, since restore bypasses that helper to preserve
original `created_at`).

Also fixed, pre-existing (Phase 2, not previously flagged): `entry_tags` has `ON DELETE CASCADE`
foreign keys, but nothing in `db.js` ever sets `PRAGMA foreign_keys = ON`, so hard deletes were
leaving orphaned `entry_tags` rows. Surfaced by writing overwrite-mode restore's delete step; the
same gap already existed in `purgeOldTrash`. Fixed both with an explicit `DELETE FROM entry_tags`
before the parent row delete, rather than relying on a pragma that capacitor-community/sqlite may not
carry across every connection.

Decisions made: 20–22 (file storage path convention; full backup is a single encrypted JSON, not a
zip; overwrite restore is destructive only within selected categories, not a full wipe by default).

Next session start point: Phase 6 has no UI yet — build the backup/restore screens (category
checkboxes, mode selector with the two always-shown descriptions, storage-check display, the
overwrite confirmation dialog). After that, or in parallel if CI is confirmed green by then: Phase 7
(per-file actions), which needs a zip library decision first (Decision 21 explicitly left this open).

---

**Session 4**

Bugs fixed: pre-rebrand name "Actioner" (see Decision 12) survived in four places after the app was
renamed to Dumpzone — `db.js` (header comment, SQLite filename `actioner.db`), `app.js` (global
`window.Actioner`), `notifications.js` (channel id, channel description, notification title), and
`android-notes/native-setup.md` (keystore-generation example used alias `actioner`, but the actual
release keystore generated in Session 3 uses alias `dumpzone`). Cause: rebrand (Decision 12) was
applied to `index.html`, `package.json`, and `capacitor.config.json` but not swept across `www/js/`
or `android-notes/`. Fix: renamed all four to `dumpzone`/`Dumpzone` equivalents; `native-setup.md`'s
keystore section also notes the live keystore already exists under alias `dumpzone`. Why correct:
matches the app id (`com.dumpzone.app`) and the actually-generated keystore; no live installs exist
yet so the DB filename and channel id changes have no migration cost.

Also corrected: ROADMAP.md's Phase 0 checkbox was still unchecked despite both docs and scaffold
being confirmed committed on `main` — closed it. Phase 1's package-name and signing sub-items
checked off to match Session 3's completed work.

Built: nothing new — this was a verification + correction session.

Decisions made: none (bug fixes and a stale-doc correction, not new product/architecture decisions).

Next session start point: confirm (manually, via the GitHub Actions tab — not verifiable from here,
API rate-limited) that the workflow run succeeds end-to-end with the four signing secrets set; this
finally closes Phase 1's signing sub-item and Phase 11's "not yet confirmed" caveat. Then AdMob
account + app icon (Phase 1, manual) or start Phase 6 (backup & restore engine), the largest unbuilt
piece and fully specced already in ARCHITECTURE.md.

---

**Session 3**

Bugs fixed: CI failed at `:app:validateSigningRelease` — cause: the four signing secrets
(`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) were never set in the repo (log
showed them decoding/resolving as empty); separately, the workflow passed the keystore as a bare
relative filename, which Gradle resolved against the wrong working directory even independent of the
missing-secrets issue. Fix: `build-android.yml` now passes an absolute path
(`"$(pwd)/app/release.keystore"`) and fails fast with a clear message if the keystore is empty or any
of the three password/alias secrets are unset. Why correct: absolute path removes Gradle's ambiguous
resolution; fail-fast turns a cryptic downstream error into an immediate, actionable one.

Built: release keystore generated (alias `dumpzone`, 2048-bit RSA, 10000-day validity) and provided
to the account holder for safekeeping outside the repo; corresponding values set as the four GitHub
secrets above.

Decisions made: none (bug fix + one-time infra step, not a product/architecture decision).

Next session start point: confirm the workflow run succeeds end-to-end now that secrets are set;
closes Phase 1's signing sub-item.

---

**Session 2**

Fixed: `build-android.yml` was missing from the delivered zip — the zip command's exclude pattern
wrongly matched the `.github` folder itself, dropping it entirely. Cause: `-x ".*"` matches any
top-level path starting with a dot, including directories, not just stray dotfiles. Fix: rebuilt the
zip without that pattern. Why correct: the workflow file was present on disk the whole time; only the
packaging step was wrong.

Built: dark mode + gradient mode. `www/css/style.css` rewritten with CSS custom-property theme
tokens (`data-theme`, `data-gradient` attributes) and a blurred glow/spillover background layer.
`www/js/app.js` adds `getAppearance()`/`setDarkMode()`/`setGradientMode()`, reading/writing the
existing `meta` table (no schema change). `www/index.html` gets a basic Appearance settings block
wired to these functions.

Decisions made: 18–19 (see DECISIONS.md).

Next session start point: Phase 1 (keystore, AdMob account) — manual, needs direct account action.
Appearance settings still need real UI polish (this session only wired a bare `<details>` block).

---

**Session 1**

Built: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/SESSIONS.md`,
`docs/TRACK.md`. Repo confirmed empty before this session.

Existing local scaffold not yet uploaded: `www/`, `capacitor.config.json`, `package.json`,
`.github/workflows/build-android.yml`, `android-notes/native-setup.md`.

Bugs fixed: none (seed session).

Decisions made: 1–17 (see DECISIONS.md).

Next session start point: upload the scaffold — Phase 0 isn't closed until docs and scaffold are
both committed. Then Phase 1 (keystore, AdMob account) — manual, needs direct account action.
