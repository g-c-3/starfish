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
