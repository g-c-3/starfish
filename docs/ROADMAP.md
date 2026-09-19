# Roadmap

## Minimum (quick reference)

- [x] 0 — Repo scaffold & docs
- [ ] 1 — Infra & secrets
- [ ] 2 — Core data layer
- [ ] 3 — Capture & intent engine
- [ ] 4 — App shell & control flow
- [ ] 5 — Native plugin wiring
- [~] 6 — Backup & restore engine (core logic done, no UI, not device-tested)
- [ ] 7 — Per-file actions
- [ ] 8 — Tags & label UX
- [ ] 9 — Additional features
- [ ] 10 — Security hardening
- [ ] 11 — CI/CD
- [ ] 12 — Ads integration
- [ ] 13 — Google Drive backup (optional, opt-in, core logic done, no UI, blocked on manual OAuth setup)

## Detailed

- [x] **0 — Repo scaffold & docs.** Docs and scaffold (`www/`, `capacitor.config.json`,
  `package.json`, `.github/workflows/build-android.yml`, `android-notes/native-setup.md`) both
  confirmed committed on `main`.
- [ ] **1 — Infra & secrets (manual).**
  - [x] Package name: `com.dumpzone.app` (set in `capacitor.config.json`).
  - [x] Android signing — keystore generated (alias `dumpzone`) and 4 GitHub secrets set. CI
    run against the live secrets not yet confirmed green — pending manual check.
  - [ ] AdMob account, one Rewarded ad unit (not Interstitial).
  - [x] App icon — source artwork at `resources/icon.png`; CI generates all densities via
    `@capacitor/assets`. Confirmed on-device (Session 7): initial version rendered visibly smaller
    than sibling icons (double safe-zone padding — see Decision 24); re-cropped full-bleed and fixed.
  - [ ] Play Console account — not blocking; only if Play distribution is later decided on.
- [ ] **2 — Core data layer.** `db.js` (schema, FTS5, tags, label history, soft-delete),
  `crypto.js` (PBKDF2/AES-GCM). Committed; not device-tested. Stale pre-rebrand naming
  (`actioner.db`, header comment) fixed this session.
- [ ] **3 — Capture & intent engine.** `intents.js` (reminder/expense detection, OCR label
  suggestion), `notifications.js`, `ads.js`. Committed; not device-tested. `notifications.js`'s
  stale pre-rebrand naming (channel id, titles) fixed this session.
- [ ] **4 — App shell & control flow.** `app.js`, `index.html`, `style.css`. Functional skeleton
  committed; real UI screens not built. `app.js`'s stale `window.Actioner` global renamed to
  `window.Dumpzone` this session.
- [ ] **5 — Native plugin wiring.** Voice recorder + noise toggle, OCR (ML Kit or Tesseract),
  permissions, notification sound asset. Documented in `android-notes/native-setup.md`, not
  implemented. Requires `npx cap add android` run once, generated project committed.
- [~] **6 — Backup & restore engine.** `backup.js` built: create/encrypt/write, open/decrypt/restore
  (append + overwrite, UUID dedup, `(Restored)` label-collision suffix), selective categories with
  storage sanity checks (`navigator.storage.estimate()` — an estimate, no device free-space API
  exists in Capacitor core), safety-backup-before-overwrite with its explicit-confirmation gate,
  extract-to-storage (no DB import). Not wired to any UI screen. Not run on a device — flag as risk.
  Cross-PIN private-notes append path is written but especially untested (no way to exercise it
  without two real devices or a manually crafted second-PIN backup).
- [ ] **7 — Per-file actions.** Share, Download-for-append (encrypted, optional passkey, shared
  sidecar schema), plain Download, Edit, Delete. Depends on 6's sidecar schema.
- [ ] **8 — Tags & label UX.** Shared tag picker (`listAllTags()` drafted), label autocomplete
  (`label_history`), batch add with auto-numbering (`batchAddWithCommonLabel()` drafted). No UI yet.
- [ ] **9 — Additional features.** Digest, on-this-day, storage breakdown, data-transparency screen,
  quick-capture widget, expense charts, backup-reminder nudge, auto-lock timeout, map view,
  confidence-confirmation chip, dark mode toggle (done), gradient mode toggle (done, 2 color pickers,
  same-color allowed). Remaining items not started.
- [ ] **10 — Security hardening.** JS obfuscation, ProGuard/R8, startup signature check. Documented,
  not implemented.
- [ ] **11 — CI/CD.** `build-android.yml` committed; signing-path and fail-fast fixes applied
  (Session 3). Live green run against the now-set secrets not yet confirmed — manual check pending.
- [ ] **12 — Ads integration.** Wire `ads.js`'s decision logic to a real AdMob plugin, rewarded unit
  only. Logic drafted; native plugin call not.
- [~] **13 — Google Drive backup (optional, opt-in).** Additive to Phase 6, never a replacement
  (Decision 25). Sub-items, roughly in dependency order:
  - [ ] Manual: Google Cloud project, enable Drive API, OAuth consent screen scoped to `drive.file`
    only (Decision 26), **published to Production** before relying on auto-backup (Decision 27) —
    walkthrough in `android-notes/native-setup.md` §10. **Still blocking** — nothing below can be
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
  - [ ] Settings UI: connect/disconnect account, manual "Backup now to Drive", auto-backup
    enabled/frequency picker (writes `meta.auto_backup_enabled`/`auto_backup_frequency`),
    storage-check display (same visual pattern as local backup's). Also the call site that invokes
    `checkAndRunAutoBackupIfDue()` on app open and supplies it a passphrase getter.
  - [ ] "Fully offline" language in docs/UI updated to "offline-first, optional cloud backup"
    (Decision 29) — done in ARCHITECTURE.md this session; still needs doing in any in-app copy once
    that copy exists (Phase 4's UI is still a bare skeleton).

Phases with a real dependency (e.g. 7 needs 6) are worked in order. Phases without one (e.g. 9's
individual items) can be picked up in any order once prerequisites are met.
