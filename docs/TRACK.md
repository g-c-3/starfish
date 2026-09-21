# Track

Maps roadmap items, decisions, and sessions to real dates/times. DECISIONS.md and SESSIONS.md use
numbers only, never dates — this file is the sole date reference. Append-only; never edit a past row.

| Date | Session | Decisions added | Roadmap change |
|---|---|---|---|
| 2026-09-19 | Session 1 | Decisions 1–17 | Phase 0 started (docs + scaffold seeded) |
| 2026-09-19 | Session 2 | Decisions 18–19 | Phase 9 detail updated (dark/gradient mode); build-android.yml packaging bug fixed |
| 2026-09-19 | Session 3 | none | Phase 1 signing sub-item closed (keystore generated, secrets set); CI signing-path bug fixed |
| 2026-09-19 | Session 4 | none | Phase 0 checkbox closed (was stale); Phase 1 sub-items checked off; pre-rebrand "Actioner" naming fixed across db.js/app.js/notifications.js/native-setup.md |
| 2026-09-19 | Session 5 | Decisions 20–22 | Phase 6 core engine built (backup.js); pre-existing entry_tags orphan-row bug fixed in db.js (purgeOldTrash) |
| 2026-09-19 | Session 6 | Decision 23 | Phase 1 app-icon sub-item closed (resources/icon.png + CI-generated densities via @capacitor/assets) |
| 2026-09-19 | Session 7 | Decision 24 | App icon bug fixed — re-cropped resources/icon.png full-bleed after user-reported/confirmed double-padding on-device |
| 2026-09-19 | Session 8 | none | resources/icon.png background recolored dark navy → white |
| 2026-09-19 | Session 9 | Decisions 25–29 | Phase 13 added (Google Drive backup, opt-in) — design + manual-setup docs only, no runtime code yet; "fully offline" language updated to "offline-first" |
| 2026-09-19 | Session 10 | Decisions 30–31 | gdrive.js built (Phase 13 core logic); auto-backup mechanism decided (check-on-open, not background-runner) |
| 2026-09-19 | Session 11 | Decision 32 | UI wired for Phase 6 (local backup/restore) and Phase 13 (Drive settings); due auto-backup now prompts once for the passkey rather than trying to run silently |
| 2026-09-19 | Session 12 | Decisions 33–35 | Phase 7 built (fileactions.js, all five actions + import screen); zip library chosen (@zip.js/zip.js over unmaintained JSZip); fixed Session 5's broken cross-PIN append (buildBackupPayload never set the field restoreBackup read) |
| 2026-09-19 | Session 13 | Decisions 36–44 | Pivot: optional app password + Private Vault (Text/Voice/Image/PDF/Files, vault.js new); fixed two label-indexing privacy leaks and the missing screen-visibility wiring (main-screen was never actually shown after unlock, in any prior session) |
| 2026-09-19 | Session 14 | none | Main capture bar + timeline wired for the first time (captureFile() built, Phase 7's actions finally attached to real UI); shared tag picker built for both main + vault |
| 2026-09-19 | Session 15 | none | Edit wired to UI (main + vault); fixed two real bugs in editEntry() found while wiring it — a fields.text/body_text mismatch and expense/reminder fields never being written at all |
| 2026-09-19 | Session 16 | Decision 45 | App-level auto-lock built (column existed since Session 1, never enforced); immediate lock-on-background added for both app password and Vault PIN (privateSessionKey's own comment promised this since Session 13, was never wired) |
| 2026-09-19 | Session 17 | none | Digest/on-this-day/storage-breakdown built; fixed a digest privacy leak (vault entries were counted, same class of leak Decision 40 already closed elsewhere) |
| 2026-09-21 | Session 18 | none | First device test — found and fixed the blank-screen bug (window.sqlitePlugin never set) and a second bug of the same shape (bare window.X() calls that should've been window.Dumpzone.X()) |
| 2026-09-21 | Session 19 | Decision 46 | Second device test still blank — root cause was that the app has never had a bundler, so every Capacitor plugin import was unresolvable in a real browser; added Vite, src/ is now real source, www/ is build output. Verified by actually building it, not just asserting |
| 2026-09-21 | Session 20 | none | Third device test — native crash, not blank screen (confirms the Vite fix worked). No confirmed root cause; ruled out SQLite SDK-version mismatch, removed a placeholder Google OAuth config as a no-regret hedge, recommended getting a real logcat trace |
| 2026-09-21 | Session 21 | Decision 47 | Real crash log obtained via ADB — confirmed root cause was GoogleAuth.signIn()'s native null-check crash, not SQLite. Fixed with a GOOGLE_DRIVE_CONFIGURED guard in gdrive.js |
