# Roadmap

## Minimum (quick reference)

- [ ] 0 — Repo scaffold & docs
- [ ] 1 — Infra & secrets
- [ ] 2 — Core data layer
- [ ] 3 — Capture & intent engine
- [ ] 4 — App shell & control flow
- [ ] 5 — Native plugin wiring
- [ ] 6 — Backup & restore engine
- [ ] 7 — Per-file actions
- [ ] 8 — Tags & label UX
- [ ] 9 — Additional features
- [ ] 10 — Security hardening
- [ ] 11 — CI/CD
- [ ] 12 — Ads integration

## Detailed

- [ ] **0 — Repo scaffold & docs.** Seed the four docs files; upload the existing local scaffold
  (`www/`, `capacitor.config.json`, `package.json`, `.github/workflows/build-android.yml`,
  `android-notes/native-setup.md`). Closes once docs and scaffold are both committed.
- [ ] **1 — Infra & secrets (manual).**
  - [ ] Package name: `com.dumpzone.app` (already set).
  - [ ] Android signing — keystore + 4 GitHub secrets (see `android-notes/native-setup.md`).
  - [ ] AdMob account, one Rewarded ad unit (not Interstitial).
  - [ ] App icon — not started.
  - [ ] Play Console account — not blocking; only if Play distribution is later decided on.
- [ ] **2 — Core data layer.** `db.js` (schema, FTS5, tags, label history, soft-delete),
  `crypto.js` (PBKDF2/AES-GCM). Drafted locally; not committed or device-tested.
- [ ] **3 — Capture & intent engine.** `intents.js` (reminder/expense detection, OCR label
  suggestion), `notifications.js`, `ads.js`. Drafted locally; not committed or device-tested.
- [ ] **4 — App shell & control flow.** `app.js`, `index.html`, `style.css`. Functional skeleton
  drafted; real UI screens not built.
- [ ] **5 — Native plugin wiring.** Voice recorder + noise toggle, OCR (ML Kit or Tesseract),
  permissions, notification sound asset. Documented in `android-notes/native-setup.md`, not
  implemented. Requires `npx cap add android` run once, generated project committed.
- [ ] **6 — Backup & restore engine.** Largest unbuilt piece: append/overwrite modes, safety-backup
  flow, selective backup/restore (incl. Tags, App Settings), storage checks, UUID dedup,
  extract-without-import. Fully specced in ARCHITECTURE.md; no code yet.
- [ ] **7 — Per-file actions.** Share, Download-for-append (encrypted, optional passkey, shared
  sidecar schema), plain Download, Edit, Delete. Depends on 6's sidecar schema.
- [ ] **8 — Tags & label UX.** Shared tag picker (`listAllTags()` drafted), label autocomplete
  (`label_history`), batch add with auto-numbering (`batchAddWithCommonLabel()` drafted). No UI yet.
- [ ] **9 — Additional features.** Digest, on-this-day, storage breakdown, data-transparency screen,
  quick-capture widget, expense charts, backup-reminder nudge, auto-lock timeout, map view,
  confidence-confirmation chip, dark mode toggle, gradient mode toggle (2 color pickers, same-color
  allowed). None started.
- [ ] **10 — Security hardening.** JS obfuscation, ProGuard/R8, startup signature check. Documented,
  not implemented.
- [ ] **11 — CI/CD.** `build-android.yml` drafted locally, not committed or run live. First live run
  likely needs log-driven fixes, same as any first native CI build.
- [ ] **12 — Ads integration.** Wire `ads.js`'s decision logic to a real AdMob plugin, rewarded unit
  only. Logic drafted; native plugin call not.

Phases with a real dependency (e.g. 7 needs 6) are worked in order. Phases without one (e.g. 9's
individual items) can be picked up in any order once prerequisites are met.
