# Architecture — Dumpzone

A fully offline, privacy-first personal capture & action app for Android, built with Capacitor.
No accounts, no server, no automated inference, no external verification. Everything lives on the device.

> Working name history: prototyped as "Actioner" during early design; finalized as **Dumpzone**.
> Package id / app id should be updated to `com.dumpzone.app` (see `capacitor.config.json`) before first release build.

Last updated: 2026-09-19 (seed session — full design consolidated from pre-repo conversation; no code beyond the scaffold committed yet).

## 1. Core principles
- 100% local storage (SQLite), no network calls except the ad SDK.
- Three independent local credentials: app-open password, private-notes PIN, backup passkey.
- Everything convertible to text gets indexed (FTS5) for full-text search.
- Voice recordings and generic files are searchable by **label only** (no transcription/parsing).
- Images and PDFs are OCR'd; both label and OCR text are indexed (label ranked higher).
- Rule-based intent engine (regex/keyword) detects reminders and expenses from any text/voice-labeled/typed input — no automated inference.
- **Every entry requires a user-supplied label before save completes** (blocking, not optional) — across voice,
  image, PDF, generic file, and note types alike. Labels are what make voice notes and generic files searchable
  at all, since neither gets transcription/parsing.
- Ads are a rewarded, non-skippable unit shown once per day **only if one successfully loads**; if it fails to load or there's no internet, the gate is skipped silently. Never blocks access to local data.

## 2. Entry types
| Type | Body content | Searchable by | Extra fields |
|---|---|---|---|
| Text note | typed | label + body | `is_private` |
| Private note | typed, AES-encrypted at rest | label only (until PIN unlock, then body too) | pin-derived key |
| Voice recording | audio file | label only | noise_reduction (bool) |
| Image | OCR'd | label + OCR text | ocr_text |
| PDF | OCR'd | label + OCR text | ocr_text |
| Generic file | none | label only | extension, auto_category |
| Expense | amount + category | label/category | amount, category, replied (bool) |
| Reminder | text + datetime | label | fire_at, repeat_rule, snoozed_until |

## 3. Credentials (three independent locks)
1. **App-open password** — gates app launch. Salted hash in DB. Recoverable via backup-passkey proof (see below).
2. **Private-notes PIN** — independent. Derives AES key for private note bodies via PBKDF2. NOT recoverable via backup; only "reset & wipe private notes" is available if forgotten.
3. **Backup passkey** — never stored anywhere. Combined with a random salt (stored unencrypted in backup header) via PBKDF2/Argon2id to derive the backup's AES-256 key. Forgetting it makes that backup permanently unrecoverable.

All three support an optional, plaintext **hint** — but not all stored the same way. The app-open password and
private-notes PIN hints are stored locally in the `credentials` table, same as their hashes. The **backup
passkey hint cannot be stored locally** (nothing about the backup passkey persists on the device by design) —
it lives **inside the backup file's own header**, unencrypted alongside the salt, and is shown to the user **at
restore time, before the passkey prompt** (similar to how a Wi-Fi network shows its hint before asking for the
password). For all three, a poorly chosen hint can leak the credential itself — the app should show a one-time
tip discouraging hints that reveal the answer. The backup passkey hint gets a **firmer, one-time warning modal**
specifically (not just a tip), since that file can leave the device entirely (uploaded to Drive/email/etc.),
making a bad hint there a bigger real-world exposure than one that only ever sits in local app storage.

Nothing stops a user from using the same value for all three — that's their call, but Settings should carry a
soft, non-blocking warning ("Using the same password across all three reduces protection if one is ever
exposed"). The three are otherwise fully independent: changing the app-open password doesn't touch the PIN or
require a new backup; changing the PIN only re-encrypts private notes under a freshly derived key; making a new
backup only ever uses whatever passkey is typed in at that moment — an older backup keeps working with whatever
passkey was used when *it* was made.

### Forgot password
- **App-open password:** recoverable via backup-passkey proof — see flow below.
- **Private-notes PIN:** NOT recoverable, even with a valid backup restore (the backup passkey only unlocks the
  backup archive; it does not unlock private-note bodies, which are separately encrypted under the PIN-derived
  key). Only option is "Reset private notes" (destructive, wipes that section only). An optional self-written
  hint (not a real recovery mechanism) can be shown to help jog memory.
- **Backup passkey:** never stored anywhere, by design. Forgetting it makes that specific backup file permanently
  unrecoverable. No in-app flow can help here.

### Forgot app password flow
User selects a backup file + enters its passkey → successful decryption is proof of ownership →
user sets a new app-open password and the DB (including the *old* password's hash, PIN, and private notes) is restored.
If no backup exists, only option is full local wipe.

### What restore actually asks for (important distinction)
A normal restore (not the forgot-password recovery flow above) **only ever prompts for the backup passkey** —
never the app-open password or the private-notes PIN. Those two credentials live inside the restored database
itself as hashes/derived keys, so they come back automatically at whatever they were on the source device at
backup time, and the app shows its normal lock screen afterward using that restored app-open password. If the
app-open password was changed *after* the backup was made, restoring reverts it to the older, backed-up value —
worth a one-time notice at restore time: "This will restore your data as of [backup date] — password and notes
will match that point in time."

## 4. Backup & Restore (full design)

### Two restore modes — always shown together, always described in plain language
- **Append (default-selected):** *"Adds this backup's entries to what you already have. Nothing existing is
  deleted. Duplicates are flagged, not lost."* Non-destructive by construction.
- **Overwrite:** *"Replaces everything on this device with the backup's contents. Your current data will be
  permanently erased unless you back it up first."* Destructive.

### Safety backup (a backup-of-current-data taken before restoring another one)
- Shown as a toggle for **both** modes.
- **Append + safety backup skipped:** no warning, no dialog — genuinely safe, nothing at risk.
- **Overwrite + safety backup skipped:** dangerous path, handled with friction on purpose:
  1. Warning triggers the moment the toggle is switched off (not deferred to the main Restore button).
  2. Dialog: *"If you continue without a safety backup, all data currently on this device will be permanently
     deleted and cannot be recovered."*
  3. Requires an explicit **"I understand"** button tap — not dismissible via outside-tap or back gesture.
  4. Restore only becomes actionable after that confirmation.
- **Overwrite + safety backup kept on:** if the device lacks enough free storage to complete the safety backup,
  restore **refuses to proceed** — block with "Free up X MB to safely restore" rather than silently skipping
  the safety net or partially completing it.
- The incoming backup's passkey must be fully verified/decrypted **before** any deletion begins in overwrite mode
  — never start wiping existing data until the replacement data is confirmed valid.

### Selective restore (choose categories: Notes, Private Notes, Voice, Images, PDFs, Files, Expenses, Reminders,
### Tags, App Settings)
- The backup archive always contains everything; selectivity is applied only at restore time, when extracting
  from the already-decrypted archive.
- **Tags** and **App Settings** are separate, independent categories from the entry-type list — selecting them
  doesn't depend on which entry types are also selected, and vice versa:
  - **Tags:** restores the `tags` table's definitions (names) via `INSERT OR IGNORE` — no UUID/dedup logic
    needed, since a tag is either already present or newly created, with nothing to attribute or collide on.
    Useful for bringing back a personal tagging taxonomy on a fresh install even before any entries are restored.
  - **App Settings:** restores non-sensitive local preferences (auto-lock timeout, notification tone choice,
    digest visibility, etc.) as a straightforward overwrite — no merge semantics needed, just replace the local
    value. Explicitly **excludes** password/PIN hashes, salts, and hints — those remain governed only by the
    credential rules already established (a normal restore never touches them; only the dedicated
    forgot-app-password recovery flow does), so a Settings restore can never become a backdoor around that.
- Storage sanity check shown before restore is enabled: **Required** (sum of file sizes for selected categories)
  vs. **Available** (device free space via Filesystem API). Restore button is disabled if required > available.
- The same backup file can be re-opened later for a follow-up partial restore of a different category — not a
  one-shot, all-or-nothing use of the file.
- **"Extract to device storage" (no DB import):** lets the user pull a category's raw files out to a normal
  folder (e.g. `Downloads/Dumpzone-Restore/`) without touching the app's database — solves the "I already added
  new files in this category, don't want to disturb them, but want to see what's in the backup" case. Each
  extracted file is accompanied by a metadata sidecar (label/tags/timestamp/category) so it can be re-added
  later with minimal effort. (Applies to file-bearing categories only — Tags and App Settings have no raw files
  to extract this way.)

### Selective backup (choose categories to include; default: all selected, including Tags and App Settings)
- Same category list as restore — the seven entry types plus **Tags** and **App Settings** — with a
  "Select All / None" convenience toggle.
- Storage check here is about **staging + final archive size**, a distinct number from the restore-side check:
  "Space required to build backup: X MB — Available: Y MB." Blocks backup creation if insufficient.
- Private notes are included as their already-encrypted ciphertext — no extra decrypt/re-encrypt step needed at
  backup time.
- The safety backup (taken automatically before an overwrite-mode restore) always attempts **full**, regardless
  of any selective-backup preference elsewhere — if it can't fit, the restore is blocked (see above), rather than
  silently taking a partial safety backup that leaves an unknown gap.

### Append-mode duplicate handling (UUID-based, since every entry has a stable id)
- **Exact match (same UUID already exists):** skipped automatically, counted, not shown as a decision point —
  but the post-restore summary includes a **"Restore these anyway"** action. Forcing one in generates a *new*
  UUID for the forced copy and labels it `(Restored)`, exactly like a label-collision case below.
- **Different UUID, same/similar label:** appended as a new entry, with its label suffixed `(Restored)` (e.g.
  "Invoice (Restored)") so it's visually distinguishable in the timeline/search. The underlying file is never at
  real risk of a filesystem-level name collision, since files are stored under internally-generated unique names
  (e.g. `<uuid>.jpg`), not the original camera/OS filename — `(Restored)` is purely a display disambiguator.
- **Post-restore summary, always shown:** *"X entries added, Y skipped as exact duplicates (restore anyway?),
  Z labeled (Restored) due to matching labels."*

### Private notes across devices/PIN changes (append mode)
Each private note is encrypted with a key derived from whatever PIN was active on the device that created it.
Appending a backup containing private notes encrypted under a *different* PIN requires:
1. Prompt: *"This backup contains private notes encrypted with a different PIN. Enter the PIN used on the
   source device to bring them in."*
2. Decrypt each with that source PIN's derived key, then **immediately re-encrypt under the current device's
   active private-notes key** before inserting — so every private note in the live DB ends up consistently
   encrypted under one key: whichever PIN is active on this device right now.
3. If the source PIN is unknown/forgotten, only the private notes are skipped (same "unrecoverable" logic as a
   normal forgotten-PIN case) — everything else in the backup still imports normally.
The app-open password is unaffected either way: it lives in the `credentials` table, untouched by append mode,
which only ever touches `entries`.

## 5. Per-file actions (every entry gets these five)

1. **Share** — native share sheet, raw file for voice/image/pdf/file, plain text for notes. **Private notes get
   no Share/Download at all — a Copy button instead**, which copies decrypted plaintext to the clipboard and
   auto-clears the clipboard after ~30–60 seconds. A one-time notice on first use: content leaves the app's
   encryption boundary once shared or copied.
2. **Download for append** — produces a file meant to round-trip back into Dumpzone later (this device, another
   device, or after a reinstall). **Always encrypted, never plaintext** — the only thing optional is whether a
   user-supplied passkey is used:
   - **Passkey given:** standard AES-GCM via the same KDF as full backups. Session-only "reuse last passkey"
     convenience for batch exports (never persisted to disk; clears when the app backgrounds/closes).
     Forgetting this passkey makes that specific export permanently unrecoverable, same as a full backup.
   - **Passkey skipped:** file is still encrypted, using a fixed **app-level default key** baked into the app
     itself (not user- or device-specific) — this keeps the file portable across installs but is honestly closer
     to obfuscation than real protection, since any Dumpzone install effectively holds that same default key.
     The UI must say so plainly: *"No passkey set — file will use default app-level encryption (not secured
     against other Dumpzone users)."* The file's header records which mode was used so import doesn't have to
     guess whether to prompt for a passkey.
   - **Private notes exception:** no passkey prompt, no optional toggle — always encrypted with the note's own
     PIN-derived key. Both the raw content and its metadata sidecar are encrypted together, since even the
     label/tags could leak what a private note is about.
   - Zip contents: raw file (named by internal UUID) + a metadata sidecar (`id`, `label`, `type`, `tags`,
     `created_at`, category/amount where relevant) — **the same sidecar schema used by full backups**, so one
     shared import/dedup engine (see Append-mode duplicate handling above) handles both a full-backup restore
     and appending a handful of individually-downloaded zips.
   - **"Append files from download" screen** — a dedicated multi-select import screen accepting any number of
     these zips at once, running each through the same dedup logic and producing the same kind of summary report.
3. **Download (plain)** — unencrypted raw file only, written using the entry's **label** as the filename (not
   the internal UUID), meant for genuinely leaving the app (open elsewhere, send outside Dumpzone). Not private
   notes (see #1).
4. **Edit** — label/tags always editable; note body editable; OCR'd text (image/pdf) editable, useful for
   correcting misreads that hurt search; expense amount/category editable; reminder time/repeat editable and
   must reschedule its notification, not just silently update the DB row. Private note edits require the PIN
   already unlocked for that session.
5. **Delete** — soft-delete into the 30-day trash bin (see Additional features → Trash below); consistent with
   the append-mode philosophy of never silently destroying data.

## 6. Additional features (all approved, part of v1 scope)

- **Daily/weekly digest** — home-screen summary computed from local aggregation only, e.g. "Today: 3 notes,
  1 reminder set, ₹500 spent, 2 photos saved." No new capture logic — just queries over `entries`.
- **Tags** — lightweight multi-tag system layered on top of the required per-entry label (see `tags` /
  `entry_tags` tables in `db.js`), letting search cut across entry types (e.g. everything tagged `#medical`
  regardless of whether it's a note, photo, or PDF). **Tags are picked, not retyped**: once a tag is created, it
  appears as a selectable chip in a shared tag-picker component used identically across every entry type — the
  same picker also offers a "+ New tag" option to create one inline, which then joins the pool for next time.
  Powered by `listAllTags()` in `db.js`; no schema change needed since `entry_tags` was already a generic
  many-to-many table.
- **Quick-repeat patterns** — a "repeat monthly/weekly" toggle at creation time for recurring reminders (rent,
  bills) and recurring expenses, using the existing `repeat_rule` field already on the `entries` schema.
- **Trash / soft-delete (30-day auto-purge)** — every Delete is a soft-delete (`deleted_at` timestamp set, row
  hidden from all normal queries and from FTS results) with a dedicated "Trash" screen to restore or empty early.
  A background job (`purgeOldTrash` in `db.js`) permanently removes anything older than 30 days.
- **On-this-day resurfacing** — a simple date-diff query surfaced on app open (after the ad gate), e.g.
  "1 month ago you saved..." Pure rule-based recency query, no automated inference.
- **Storage usage breakdown** — a Settings screen showing size used per category (Voice/Images/PDFs/Files),
  with a "clear items older than X days" action per category to help manage device storage proactively.
- **Home-screen quick-capture widget** — a 4-button Android widget (voice/photo/note/expense) that jumps
  straight into capture mode, skipping the app-open password for *creation only* (not for viewing existing
  data). Treated as the highest-leverage retention feature discussed — reduces the friction that normally kills
  daily use of note-taking apps.
- **Expense charts** — simple bar/line charts (weekly/monthly) built on the same aggregation used for the digest.
- **Recurring backup reminder** — a soft local notification/banner if it's been 30+ days since the last backup,
  tied to `credentials.last_backup_at`. Doubles as a nudge that keeps the "forgot app password" recovery path
  (see above) actually usable, since that recovery flow depends on a recent backup existing.
- **App auto-lock timeout** — configurable inactivity timeout (`credentials.auto_lock_minutes`, default 5) that
  re-locks the app, so the password isn't only a one-time gate at cold launch.

## 7. Capture UX decisions (validated during design, binding for the build)

- **One unified "+" capture entry point** — a single button opens a sheet (mic / camera / file / text) rather
  than separate top-level buttons per type; all captures land in the same unified timeline regardless of source.
- **Confidence-based confirmation, not silent action** — when the intent engine detects a reminder or expense,
  show a small inline confirmation chip (e.g. "Detected: ₹500 expense — categorize?") with an auto-dismiss into
  the sensible default (uncategorized / as-parsed) if ignored, rather than committing silently with no visible
  feedback. Builds trust since nothing infers silently — every action traces to a visible rule.
- **Map view for saved locations** — entries with a lat/long get a lightweight map view (in addition to the flat
  timeline), since location was otherwise dead metadata on a card.
- **Label autocomplete from history** — implemented via the `label_history` table in `db.js` (also what powers
  batch-numbering, above). Previously used labels for a given entry type surface as tap-to-select suggestions at
  capture time ("Invoice", "Payment Screenshot", "Receipt"...), so a personal taxonomy builds up naturally
  without the user retyping the same label repeatedly, and without any hardcoded category list.
- **OCR-based label suggestion** — implemented as `suggestLabel()` in `intents.js`. Keyword matches against OCR
  text (e.g. "INVOICE NO", "UPI", "prescription", "aadhaar") pre-fill/suggest a label ("Invoice", "Payment
  Screenshot", "Prescription", "ID Proof") at capture time — a plain dictionary lookup, not automated inference. Never blocks
  save; purely a convenience the user can accept or overwrite.
- **Batch file addition with common label + auto-numbering** — for multi-select capture of Image, PDF, and
  Generic File types (voice stays one-at-a-time, since it's captured live rather than picked from storage). At
  the picker screen, offer two explicit paths: "Add individually" (existing per-file label prompt) or "Batch add
  with common label" (this feature). In batch mode:
  - User enters **one label**; each file is saved as a separate entry with that label auto-suffixed by a running
    number in selection order — `Invoice 1`, `Invoice 2`, `Invoice 3`...
  - Numbering **continues from prior history for that label rather than restarting at 1**, using the same
    `label_history` table that already tracks use-counts, so a later "Invoice" batch continues at `Invoice 4`,
    `Invoice 5`, etc. instead of colliding with an earlier batch's numbering.
  - Any tags added at the batch level apply to every file in the batch, saving repeated re-tagging.
  - OCR still runs **per file individually** — each gets its own `ocr_text` — and `suggestLabel()` can still
    pre-fill the common label if most/all files in the batch match the same OCR keyword pattern (e.g. a batch of
    payment screenshots all suggesting "Payment Screenshot" as the shared label).
  - Once saved, every entry from the batch is fully independent — searchable, editable (can be individually
    renamed later via the existing Edit action), and deletable on its own, with no lingering "batch" grouping
    in the data model.
- **Expense follow-up flow** — implemented as `promptExpenseFollowup()` in `app.js`. When "spent 500" has no
  inline category, the expense entry is saved immediately as `uncategorized`, and the UI asks "What did you
  spend this on?" with a 15-second window (`EXPENSE_FOLLOWUP_TIMEOUT_MS`). A reply updates the category and
  label in place; no reply within the window leaves it as `uncategorized` — nothing is ever blocked on the answer.
- **Reminder notifications, not alarms** — implemented via `@capacitor/local-notifications` (`notifications.js`),
  deliberately not `AlarmManager`/full-screen intents, for reliability and simplicity reasons recorded in
  `android-notes/native-setup.md`. Includes a custom tone, a notification channel, and Snooze (10 min) / Done
  action buttons.
- **Reminder reliability UX** — on first reminder ever set, explicitly prompt the user to exempt Dumpzone from
  battery optimization, with a plain explanation ("so Android doesn't delay or kill your reminder"). The
  reminders list/settings screen shows a simple trust indicator — "X reminders scheduled" — so the user has a
  visible signal that scheduling actually worked, rather than silently hoping it fires.
- **Intent engine is deliberately pluggable** — `intents.js`'s `registerIntentHandler({ name, test, extract,
  buildEntry })` pattern means adding a new rule-based intent later (e.g. "log this medicine dose", "note this
  birthday") is a small, self-contained handler, not a rewrite of the detection engine. This was a deliberate
  architecture choice made even though only two handlers (reminder, expense) exist today.
- **"Your Data" transparency screen** — a dedicated Settings screen showing total DB size, total entry count,
  and an "Export Now" button (jumps straight into the backup flow). Distinct from the per-category storage
  breakdown above — this one is about making local-only data ownership visible and concrete to the user, not
  about managing storage space.

## 8. Security hardening decisions (recorded, implemented in `android-notes/native-setup.md`)

- **JS minification/obfuscation** of the web bundle before `cap sync`, so the shipped code isn't trivially
  readable by unzipping the APK.
- **ProGuard/R8** (`minifyEnabled true`) for the native Android/Kotlin-Java layer on release builds.
- **Basic signature/tamper check** at app startup, comparing the running app's signing certificate against the
  expected release cert hash, to raise the bar against resigned/repackaged "mod APK" copies.
- Explicitly **not** pursuing NDK-level native obfuscation — judged not worth the added build complexity given
  the GitHub-Actions-only, no-local-machine build pipeline, and the fact that client-side checks can only ever
  raise the cost of tampering, never eliminate it (the app's own ad-gate logic runs on the attacker's device by
  necessity, since there's no server to validate against — see Ads section).

## 9. Search
SQLite FTS5 virtual table over `(label, body_text)` for all non-private, non-voice, non-generic-file entries.
Private note bodies are excluded from the FTS index entirely; only unlocked-in-session search covers them.
Ranking: label match > body/OCR match, then recency.
- **Filters** — by entry type, date range, and "has location" — combinable with the text query, not just a
  plain keyword search.
- **Snippet/highlight results** — show matched text in context (via FTS5's `snippet()`/`highlight()`) rather
  than just entry titles, so a search result is legible at a glance instead of requiring a tap to check relevance.

## 10. Ads
Rewarded ad unit (not basic interstitial — must be non-skippable by policy).
Flow on first open each day:
1. Attempt to load rewarded ad in background (3–5s timeout).
2. Loaded → show full-screen, non-skippable, must complete to proceed.
3. Failed to load / no internet → skip gate entirely, no message shown.

## 11. Build pipeline (GitHub Actions, no local machine needed)
See `.github/workflows/build-android.yml`. On push, it:
1. Installs Node deps.
2. Runs `npx cap sync android`.
3. Builds a signed release APK using a keystore stored in GitHub Secrets.
4. Uploads the APK as a workflow artifact / release asset.

### One-time setup you need to do
1. Generate a keystore (can be done via GitHub Actions itself in a one-off job, or ask me to generate the commands).
2. Add these repo secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
3. Push to `main` — Actions builds the APK automatically.

## 12. Folder structure
```
dumpzone/
  www/                  -> the actual app (HTML/JS/CSS), Capacitor's webview content
    index.html
    css/style.css
    js/
      db.js             -> SQLite schema + FTS5 setup
      crypto.js         -> KDF + AES helpers for private notes & backups
      intents.js         -> rule-based reminder/expense detector + OCR label suggestion
      notifications.js  -> local notification scheduling (tone, snooze/done actions)
      ads.js            -> rewarded ad gate logic
      app.js            -> app bootstrap / router / expense follow-up flow
  capacitor.config.json
  package.json
  .github/workflows/build-android.yml
  android-notes/        -> notes on native tweaks needed after `npx cap add android`
```

## 13. Status
Implemented in code already: schema (including tags, label history, soft-delete columns), FTS5 search,
credential hashing/KDF/AES helpers, the intent engine (reminders, expenses, OCR label suggestion), notification
scheduling, the ad-gate decision logic, and the app bootstrap control flow (auth → ad gate → digest → timeline,
plus the expense follow-up timeout).

Specified in this doc but not yet coded: the full backup/restore engine (append vs. overwrite, selective
backup/restore with storage sanity checks, safety-backup-before-overwrite, UUID-based dedup, per-file
download-for-append zips with the shared sidecar schema), the quick-capture home-screen widget, expense charts,
the map view, the confidence-confirmation chip UI, and the on-this-day/storage-breakdown screens. These are the
next implementation milestones. Native plugin wiring (voice recorder, OCR, exact permissions, signature check)
is documented in `android-notes/` since it requires editing the generated `android/` project after
`npx cap add android`, which should be run once and committed.
