# Sessions

Most recent first. Numbered, no dates (see TRACK.md).

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
