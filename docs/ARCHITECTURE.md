# Architecture — Dumpzone

A fully offline-first, privacy-first personal capture & action app for Android, built with Capacitor.
No account or server is required for anything the app does by default. No automated inference, no
external verification. An entirely optional, opt-in Google Drive backup exists for anyone who wants
an off-device copy (see §4b) — everything else stays local-only, with or without it.

> Working name history: prototyped as "Actioner" during early design; finalized as **Dumpzone**.

Last updated: 2026-09-19 (seed session — full design consolidated from pre-repo conversation; no code beyond the scaffold committed yet).

## 1. Core principles
- 100% local storage (SQLite) by default. No account or server is required for capture, search,
  reminders, expenses, or local backup/restore.
- The only network calls in the app are the ad SDK and, only if the person explicitly opts in,
  Google Drive backup (§4b). Neither is reachable from, or required by, local-only use.
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
| Voice recording | audio file | label only | noise_reduction (bool) |
| Image | OCR'd | label + OCR text | ocr_text |
| PDF | OCR'd | label + OCR text | ocr_text |
| Generic file | none | label only | extension, auto_category |
| Expense | amount + category | label/category | amount, category, replied (bool) |
| Reminder | text + datetime | label | fire_at, repeat_rule, snoozed_until |

`is_private` (pivot: was notes-only, now applies to Text/Voice/Image/PDF/Files — Private Vault, §3b)
turns ANY of the five into a vault entry: AES-encrypted at rest under the vault PIN's derived key,
excluded from both `entries_fts` and `label_history` entirely (not just the body — see §3b), and
findable only through the vault's own in-memory search once unlocked. Expenses/Reminders have no
private variant — out of vault scope.

## 3. Credentials (three independent locks)
1. **App-open password — optional ("quick access").** Gates app launch when set; a `NULL` hash means no lock
   screen at all on open. Addable/removable anytime in Settings, not just at first run. Salted hash in DB when
   set. Recoverable via backup-passkey proof (see below) — only meaningful when a password exists to recover.
   Own idle auto-lock (`auto_lock_minutes`) plus an immediate lock on backgrounding (Decision 45) — moot when
   quick access is enabled, since there's nothing to lock back to.
2. **Vault PIN** — independent. Derives an AES key for every vault entry (any of the five types, not just
   text — §3b) via PBKDF2. NOT recoverable via backup; only "reset & wipe the Vault" is available if forgotten.
   Its own auto-lock timer (`vault_auto_lock_minutes`), separate from whatever the app-open password's own
   timeout is — locking the app doesn't necessarily lock the Vault and vice versa. Also locks immediately on
   backgrounding, same as the app-open password (Decision 45) — `privateSessionKey` never survives the app
   actually leaving the foreground, not just an idle window.
3. **Backup passkey** — never stored anywhere. Combined with a random salt (stored unencrypted in backup header) via PBKDF2/Argon2id to derive the backup's AES-256 key. Forgetting it makes that backup permanently unrecoverable.

All three support an optional, plaintext **hint** — but not all stored the same way. The app-open password and
Vault PIN hints are stored locally in the `credentials` table, same as their hashes (both nullable — password
because it's optional, PIN because Vault setup can happen any time after first run, not necessarily during it).
The **backup
passkey hint cannot be stored locally** (nothing about the backup passkey persists on the device by design) —
it lives **inside the backup file's own header**, unencrypted alongside the salt, and is shown to the user **at
restore time, before the passkey prompt** (similar to how a Wi-Fi network shows its hint before asking for the
password). For all three, a poorly chosen hint can leak the credential itself — the app should show a one-time
tip discouraging hints that reveal the answer. The backup passkey hint gets a **firmer, one-time warning modal**
specifically (not just a tip), since that file can leave the device entirely (uploaded to Drive/email/etc.),
making a bad hint there a bigger real-world exposure than one that only ever sits in local app storage.

Nothing stops a user from using the same value for all three (when the app-open password is set at all) —
that's their call, but Settings should carry a
soft, non-blocking warning ("Using the same password across all three reduces protection if one is ever
exposed"). The three are otherwise fully independent: changing the app-open password doesn't touch the PIN or
require a new backup; changing the PIN only re-encrypts vault entries under a freshly derived key; making a new
backup only ever uses whatever passkey is typed in at that moment — an older backup keeps working with whatever
passkey was used when *it* was made.

### Biometric unlock (optional, alternative entry — Decision 50)
Fingerprint/face can be enabled as an alternative way to unlock either the app-open password or the Vault
PIN — never both at once by a single toggle, and never the backup passkey (that one is never stored on
the device at all, biometric or otherwise, by design — nothing to gate). Off by default, toggled
independently per lock in Settings, and only offered when enabling it: the real credential is confirmed
(hash-compared against what's already stored) before anything is handed to the biometric layer.

This is **not a fourth credential** — it never creates a new secret. What it stores, natively, is the
exact password or PIN the person already set, gated behind a biometric prompt at the point of both
storing and retrieving it. Turning it on doesn't change what "forgot password" or "forgot PIN" do (see
below) — those flows are untouched, and a forgotten password/PIN is exactly as unrecoverable/recoverable
as it always was, biometric or not. Changing or removing the underlying password/PIN immediately clears
whatever was stored for biometric unlock — a stale cached value would otherwise unlock with (or derive a
vault key from) the *old* credential, silently wrong the moment it changed. Re-enabling after a change
requires confirming the new credential again, same as first-time setup.

Security model, stated plainly: the stored secret sits behind an Android Keystore key that requires the
device to be unlocked to use, but that key does not itself demand a fresh biometric check to decrypt —
the biometric prompt is enforced in the app's own call sequence (always prompt, only read the stored
secret after the prompt succeeds), not by the hardware on every read. This matches how most consumer
apps' "unlock with fingerprint" works, but it's a convenience layer on top of the real credential, not an
independent hardware guarantee — manual password/PIN entry remains the actual security boundary and
always stays available as a fallback.

### Forgot password
- **App-open password:** recoverable via backup-passkey proof — see flow below. Moot if quick access is
  enabled (no password exists to forget).
- **Vault PIN:** NOT recoverable, even with a valid backup restore (the backup passkey only unlocks the
  backup archive; it does not unlock vault entries, which are separately encrypted under the PIN-derived
  key). Only option is "Reset Vault" (destructive, wipes that section only). An optional self-written
  hint (not a real recovery mechanism) can be shown to help jog memory.
- **Backup passkey:** never stored anywhere, by design. Forgetting it makes that specific backup file permanently
  unrecoverable. No in-app flow can help here.

### Forgot app password flow
User selects a backup file + enters its passkey → successful decryption is proof of ownership →
user sets a new app-open password and the DB (including the *old* password's hash, PIN, and Vault entries) is restored.
If no backup exists, only option is full local wipe.

### What restore actually asks for (important distinction)
A normal restore (not the forgot-password recovery flow above) **only ever prompts for the backup passkey** —
never the app-open password or the Vault PIN. Those two credentials live inside the restored database
itself as hashes/derived keys, so they come back automatically at whatever they were on the source device at
backup time, and the app shows its normal lock screen afterward using that restored app-open password (or skips
straight in, if quick access was what the source device had). If the
app-open password was changed *after* the backup was made, restoring reverts it to the older, backed-up value —
worth a one-time notice at restore time: "This will restore your data as of [backup date] — password and notes
will match that point in time."

## 3b. Private Vault (pivot — was notes-only "private notes," now spans five types)

Text, Voice, Image, PDF, and Files can all be private now, gated by the one Vault PIN (§3). The Vault is meant
to be **an exact functional replica of the main app** — same capture, same edit, same tags/label autocomplete,
same search, same trash-with-30-day-restore, same five per-file actions in the same order — with three
deliberate differences, all safety-necessary rather than arbitrary:

1. **Everything lives encrypted at rest, including raw file bytes.** A vault entry's `file_path` stays `NULL`;
   its content (base64 file bytes, plus OCR text for image/pdf, bundled together as one JSON string) travels
   inside `encrypted_body` instead, via the exact same `encryptPrivateNote`/`decryptPrivateNote` AES-GCM calls
   a private note's text always used. A note's own plaintext shape is unchanged, so pre-pivot private notes
   need no migration. Content is only ever decrypted into memory (a `Blob`/object URL for files), never written
   back to disk unencrypted except at the explicit moment Download is invoked (point 3 below).
2. **Search is a fresh in-memory index built on unlock, discarded on lock — nothing persisted, not even
   encrypted** (Decision 39). Same lifecycle as `privateSessionKey` itself. Also powers vault-only label
   autocomplete, which deliberately does **not** touch the shared `label_history` table — see point 4.
3. **Share and plain Download work exactly like the main app's** (Decision 41, reversed from an earlier,
   more restrictive default) — the UI should carry a one-time notice that doing so puts a plaintext copy
   outside the vault's encryption boundary from that point on, but nothing is blocked. "Download for append"
   stays vault-PIN-only, no passkey/default option — that restriction is about the format safely round-tripping
   back into a vault, not about limiting what the person can do with their own content.
4. **Vault entries never touch `entries_fts` or `label_history` — not just their body, their label too**
   (Decision 40). This was a real, silently-shipped bug until this pivot: both tables were being written for
   *every* entry regardless of `is_private`, meaning a vault item's title (though never its body) was
   discoverable via ordinary, no-PIN search, and its label could surface as an autocomplete suggestion in the
   normal capture bar. Fixed in `insertEntry()` (db.js) and `restoreBackup()` (backup.js).

**Its own trash, its own auto-lock.** The Vault has a second 30-day trash bin, independent of the main app's —
same restore/permanent-delete, same 30-day rule, distinguished from the main bin by `is_private` rather than a
second table (`listTrash()`/`restoreFromTrash()`/`permanentlyDeleteEntry()` in db.js are shared, generic
functions). Its auto-lock timer is its own column (`vault_auto_lock_minutes`), independent of whatever the
app-open password's own timeout does — locking one doesn't necessarily lock the other.

**Backup category.** Every vault entry, regardless of type, falls under one unified `private_vault` backup
category (was a notes-only `private_notes` category before this pivot) — see backup.js's `ENTRY_CATEGORIES`.

**"Select files" multi-select** (Decision 44) is shared between the main app and the Vault: category-grouped,
per-item size shown, selectable individually or as a whole category, with bulk Share/Download/Download for
append/Delete (Edit stays per-item — bulk-editing arbitrary fields across mixed types has no coherent meaning).

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

## 4b. Google Drive backup (optional, opt-in — Decisions 25–29)

Everything above (§4) is the local backup/restore engine and remains the default; nothing here
changes it or depends on it being used. This section is an **additional** destination for the same
kind of backup file, reachable only if the person explicitly connects a Google account.

**Opt-in, not a replacement.** Local-only stays the default and fully functional forever. Connecting
Drive adds a second place a backup can be written to/read from; it never becomes required.

**Same encryption, same everything, different destination.** A Drive backup is the exact same
AES-GCM-encrypted archive `backup.js` already produces (Decision 21) — same passphrase, same KDF,
same "never stored" rule for the passkey. Google's servers only ever see the encrypted blob, the same
as if it were sitting on the device's own storage.

**Auth scope: `drive.file` only, never full Drive access.** This scope grants access only to files
the app itself creates — Dumpzone can never browse, read, or touch anything else in the person's
Drive. It's also Google's "non-sensitive" tier, which matters practically: it needs only basic app
verification, not the restricted-scope security assessment (CASA) that full/readonly Drive access
would require — the difference between a solo developer being able to ship this at all and not.

**The OAuth consent screen must be published to Production, not left in Testing.** A project in
Testing status with an external audience gets refresh tokens that expire after 7 days for any scope
beyond basic profile/email — which would silently break time-based auto-backup about a week after
setup, with no obvious symptom beyond backups quietly stopping. Publishing to Production removes that
limit; because the scope stays non-sensitive, this does not trigger Google's full manual verification
queue. See `android-notes/native-setup.md` §11 for the exact console steps.

**Storage check before every upload, same pattern as local (Decision 8).** Drive's `about.get` API
returns quota (`storageQuota.limit`/`usageInDrive`); the same "required vs. available, block if it
won't fit" check `backup.js` already does against `navigator.storage.estimate()` applies here against
that response instead. Shown before the upload starts, not discovered mid-transfer.

**No refresh-token store of our own.** `gdrive.js` never requests `grantOfflineAccess`/a serverAuthCode
and never persists a token. It calls `GoogleAuth.signIn()` fresh, in the foreground, whenever Drive
access is needed; the native Android SDK returns cached consent silently (no UI) if the person already
granted it and their on-device Google session is still valid. Less code, nothing sensitive to secure
beyond what Android's own account manager already secures.

**Auto-backup runs as a check on app open/resume, not via OS-level background scheduling.**
`@capacitor/background-runner` was evaluated and rejected: its headless JS environment (confirmed
against the Capacitor 6 docs, not assumed) exposes only `console`/`fetch`/`crypto`/timers plus
`CapacitorDevice`, `CapacitorKV` (a plain string key/value store, not SQLite), `CapacitorNotifications`,
and `CapacitorGeolocation` — no SQLite, no Filesystem. It cannot read the entries table or captured
files, so it cannot build a backup payload at all, independent of any interval/battery concerns.
Every other Android background-task path (AlarmManager, a foreground service) adds exactly the kind
of native complexity the project already chose to avoid for reminders (Decision — notifications are
scheduled local notifications, not alarms). Checking on open/resume instead costs nothing new: it
runs in the same foreground context everything else already uses, with full SQLite/Filesystem/network
access, and is transparently reliable (if the app isn't opened, no backup runs, which is an honest and
visible limitation rather than a silent one).

`checkAndRunAutoBackupIfDue()` (`gdrive.js`) compares `credentials.last_drive_backup_at` against the
configured `auto_backup_frequency` (`meta` table, alongside `dark_mode` etc. — an App Settings item,
Decision 8's categories) and, if due, signs in silently and backs up without prompting; if silent
sign-in fails (no cached consent) or no passphrase is available to the passive check, it skips quietly
rather than interrupting whatever the person opened the app to do.

**Storage check before every upload, same pattern as local (Decision 8).** Drive's `about.get` API
returns quota (`storageQuota.limit`/`usage`); the same "required vs. available, block if it won't
fit" check `backup.js` already does against `navigator.storage.estimate()` applies here against that
response instead — `limit` absent means an unlimited-storage account, treated as no cap. Shown before
the upload starts, not discovered mid-transfer.

**Restore reuses `backup.js`'s `restoreBackup()` directly** — `gdrive.js`'s `restoreFromDrive()` only
fetches the archive from Drive and hands it to the exact same append/overwrite/dedup/tag-restore logic
Phase 6 already has. One restore engine regardless of source, not two to keep in sync.

**Google Sign-In plugin: `@codetrix-studio/capacitor-google-auth`**, chosen for compatibility with the
app's current Capacitor 6 pin — the newer, more actively-recommended Capawesome Google Sign-In plugin
requires Capacitor 8, a separate, larger upgrade not undertaken for this alone.

## 5. Per-file actions (every entry gets these five — `fileactions.js`, Decisions 33–35)

**Implementation note (differs slightly from the original zip-contents description below):**
`downloadForAppend()` doesn't zip a raw file plus a separate sidecar as two entries — it wraps the
entry in the exact same JSON payload shape `buildBackupPayload()` produces for a full backup (now
scoped to one entry via an `entryIds` filter), encrypts that whole payload the same way
`encryptBackup()` always has, and puts that single encrypted JSON file inside the zip. Net effect is
the same (one file round-trips back in, same dedup handling as a full restore) but the mechanism is
"one entry's worth of a full-backup payload" rather than a separately-designed sidecar format —
simpler, and it means `decryptBackupPayload()`/`restoreBackup()` handle a per-file import with zero
extra code, not a second decrypt/dedup path to maintain.

1. **Share** — native share sheet, raw file for voice/image/pdf/file, plain text for notes. **Works identically
   for Vault entries** (Decision 41, pivot — was Copy-only before): content is decrypted into memory first,
   never written to disk unencrypted, but otherwise no restriction. A one-time notice on first vault
   Share/Download: content leaves the vault's encryption boundary as plaintext from that point on. `copyPrivateNote()`
   still exists as an extra convenience for vault text specifically, not a replacement for Share/Download anymore.
2. **Download for append** — produces a file meant to round-trip back into Dumpzone later (this device, another
   device, or after a reinstall). **Always encrypted, never plaintext** — the only thing optional is whether a
   user-supplied passkey is used:
   - **Passkey given:** standard AES-GCM via the same KDF as full backups. Session-only "reuse last passkey"
     convenience for batch exports (never persisted to disk; clears when the app backgrounds/closes) — not yet
     wired into the UI (`app.js` currently prompts per file; see ROADMAP's rough-edge note).
     Forgetting this passkey makes that specific export permanently unrecoverable, same as a full backup.
   - **Passkey skipped:** file is still encrypted, using a fixed **app-level default key** baked into the app
     itself (not user- or device-specific) — this keeps the file portable across installs but is honestly closer
     to obfuscation than real protection, since any Dumpzone install effectively holds that same default key.
     The UI must say so plainly: *"No passkey set — file will use default app-level encryption (not secured
     against other Dumpzone users)."* The file's own `mode` field (`passkey`/`default`/`pin`) records which was
     used so import doesn't have to guess whether to prompt for a passkey.
   - **Vault exception (any of the five types, not just text):** no passkey prompt, no optional toggle — always
     encrypted with the vault's own PIN-derived key (the PIN itself is used as the passphrase into the same
     `encryptBackup()` call, with a
     fresh random salt each export — self-contained, no need to carry the device's stored PIN salt along). This
     restriction is unaffected by Decision 41 — it's about the format safely round-tripping back into a vault,
     not about limiting what the person can otherwise do with their content (which Share/Download above now allow).
   - Zip contents: one encrypted JSON file (see implementation note above) — **the same underlying schema used
     by full backups**, so one shared import/dedup engine (`restoreBackup()`) handles both a full-backup restore
     and appending a handful of individually-downloaded zips.
   - **"Append files from download" screen** — built, in `index.html`/`app.js`: a multi-select import accepting
     any number of these zips at once, running each through `importAppendZips()` (append mode only, no
     overwrite option on this screen) and producing a combined summary report.
3. **Download (plain)** — unencrypted raw file only, written using the entry's **label** as the filename (not
   the internal UUID), meant for genuinely leaving the app (open elsewhere, send outside Dumpzone). **Works for
   Vault entries too** (Decision 41, pivot) — decrypted into memory first, written out plain only at the moment
   this is explicitly invoked. Built (`downloadPlain()`).
4. **Edit** — label/tags always editable; note body editable; OCR'd text (image/pdf) editable, useful for
   correcting misreads that hurt search; expense amount/category editable; reminder time/repeat editable and
   must reschedule its notification, not just silently update the DB row. **Vault entries of any type**
   (not just text) require the vault PIN already unlocked for that session to edit content — label/tags-only
   edits don't, since those were never encrypted. Built (`editEntry()`), takes a caller-supplied reschedule
   callback for reminders rather than importing `notifications.js` directly, to avoid a circular import with `app.js`.
5. **Delete** — soft-delete into the 30-day trash bin (main or Vault's own — §3b); consistent with
   the append-mode philosophy of never silently destroying data. Already existed as `db.js`'s `softDelete()`;
   `fileactions.js` re-exports it so every per-file action is reachable from one module.

**"Select files" multi-select** (Decision 44, §3b) covers four of these five in bulk — Share, Download,
Download for append, Delete — shared between main and Vault, category-grouped with per-item size shown.

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
  hidden from all normal queries and from FTS results) with a dedicated "Trash" screen to restore or delete
  permanently early. **Two independent bins** (main + Vault — §3b), same rule, distinguished by `is_private`
  rather than a second table. A background job (`purgeOldTrash` in `db.js`) permanently removes anything older
  than 30 days from both.
- **On-this-day resurfacing** — a simple date-diff query surfaced on app open (after the ad gate), e.g.
  "1 month ago you saved..." Pure rule-based recency query, no automated inference.
- **Storage usage breakdown** — a Settings screen showing size used per category (Voice/Images/PDFs/Files),
  with a "clear items older than X days" action per category to help manage device storage proactively.- **Home-screen quick-capture widget** — a 4-button Android widget (voice/photo/note/expense) that jumps
  straight into capture mode, skipping the app-open password for *creation only* (not for viewing existing
  data). Treated as the highest-leverage retention feature discussed — reduces the friction that normally kills
  daily use of note-taking apps.
- **Expense charts** — simple bar/line charts (weekly/monthly) built on the same aggregation used for the digest.
- **Recurring backup reminder** — a soft local notification/banner if it's been 30+ days since the last backup,
  tied to `credentials.last_backup_at`. Doubles as a nudge that keeps the "forgot app password" recovery path
  (see above) actually usable, since that recovery flow depends on a recent backup existing.
- **App auto-lock timeout** — configurable inactivity timeout (`credentials.auto_lock_minutes`, default 5) that
  re-locks the app, so the password isn't only a one-time gate at cold launch.
- **Dark mode** — on/off toggle, stored as `meta.dark_mode` (`'on'`/`'off'`). No system-theme auto-detection
  required for v1; the toggle is the single source of truth once set. Applies via a `data-theme` attribute on
  `<html>` and CSS custom properties, not a full stylesheet swap.
- **Gradient mode** — on/off toggle, independent of dark mode (all four combinations — light/flat,
  light/gradient, dark/flat, dark/gradient — are valid). When on, exposes two color pickers
  (`meta.gradient_color_1`, `meta.gradient_color_2`); picking the same color for both is explicitly allowed and
  collapses the effect to a soft single-tone glow rather than a two-tone gradient. Rendered as a soft background
  gradient plus a blurred "spillover/glow" layer behind cards/panels (large, blurred, semi-transparent color
  blobs positioned behind content — pure CSS, no native plugin) — purely cosmetic, no effect on data, search, or
  any other behavior. Both settings live under the App Settings backup category (see Backup & Restore above),
  so they travel with a backup/restore like any other non-sensitive preference.

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
See `.github/workflows/build-android.yml`. On push to `main`, it:
1. Installs Node deps (`npm install`).
2. **Builds the web assets** (`npm run build` → Vite bundles `src/` into `www/`). Required, not
   optional: browsers cannot resolve bare npm-package specifiers
   (`import { X } from '@capacitor/filesystem'`) on their own — only a bundler or a hand-authored
   import map can. Every file that imports a Capacitor plugin needs this step to have run first, or
   the app fails to load at all (see the note below — this was the actual cause of the first two
   device-test failures).
3. Adds the Android platform if `android/` isn't committed yet, generates app icons, runs
   `npx cap sync android` (copies the now-bundled `www/` into the native project).
4. Builds a signed release APK using a keystore stored in GitHub Secrets.
5. Uploads the APK as a workflow artifact.

**`src/` is the real source now — `www/` is Vite's build output, not hand-edited.** This split
didn't exist before the app was ever actually run on a device: everything lived directly in `www/`
with no bundler, which worked fine for the pure-relative-path files but silently could never load
anything that imported an actual npm package, since a browser's native ES module loader has no way
to resolve a bare specifier like `'@capacitor/filesystem'` without one. `capacitor.config.json`'s
`webDir` stays `"www"` unchanged — Vite just writes there instead of a person doing it by hand.

### One-time setup you need to do
1. Generate a keystore (done — Session 3).
2. Add repo secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (done —
   Session 3, CI success still unconfirmed).
3. Push to `main` — Actions builds the APK automatically.

## 12. Folder structure
```
dumpzone/
  src/                  -> the REAL source (HTML/JS/CSS) — edit here, not www/
    index.html
    css/style.css
    js/
      db.js             -> SQLite schema + FTS5 setup
      crypto.js         -> KDF + AES helpers for private notes & backups
      intents.js         -> rule-based reminder/expense detector + OCR label suggestion
      notifications.js  -> local notification scheduling (tone, snooze/done actions)
      ads.js            -> rewarded ad gate logic
      backup.js         -> backup/restore engine (build/encrypt/write, decrypt/restore, extract-only)
      gdrive.js         -> optional Google Drive backup (opt-in, additive to backup.js)
      vault.js          -> Private Vault: content bundling, save/load, in-memory search index
      fileactions.js    -> per-file actions: share, download-for-append (+ its zip import), plain download, edit
      app.js            -> app bootstrap / router / expense follow-up flow
  www/                  -> Vite's BUILD OUTPUT — Capacitor's webview content. Regenerated on every
                            CI run; don't hand-edit, changes there get overwritten.
  vite.config.js        -> root: 'src', outDir: '../www'
  capacitor.config.json
  package.json
  .github/workflows/build-android.yml
  android-notes/        -> notes on native tweaks needed after `npx cap add android`
```

## 13. Status
Implemented in code already: schema (tags, label history, soft-delete columns, optional app-password/vault-PIN
columns), FTS5 search (main app only — Vault search is a separate in-memory index, §3b),
credential hashing/KDF/AES helpers, the intent engine (reminders, expenses, OCR label suggestion), notification
scheduling, the ad-gate decision logic, the app bootstrap control flow (auth → ad gate → digest → timeline,
plus the expense follow-up timeout) including the optional-password/first-run-setup path, the core backup/restore
engine (`backup.js`), optional Google Drive backup (`gdrive.js`, Phase 13 — blocked on manual OAuth setup for
device testing), all five per-file actions (`fileactions.js`) including the "Select files" multi-select, and
the Private Vault (`vault.js` + its `app.js`/`index.html` wiring — capture/browse/search across all five types,
its own trash bin, its own auto-lock). Screen show/hide wiring (`showScreen()`) was itself missing until the
Vault pivot surfaced it — every UI section built in every prior session was technically unreachable before that.
**None of this has been run on an actual device or through CI yet** — that remains the standing risk flagged
at the end of every session since Phase 1.

Specified in this doc but not yet coded: the quick-capture home-screen widget, expense charts, the map view,
the confidence-confirmation chip UI, and the on-this-day/storage-breakdown screens. These are the
next implementation milestones. Native plugin wiring (voice recorder, OCR, exact permissions, signature check)
is documented in `android-notes/` since it requires editing the generated `android/` project after
`npx cap add android`, which should be run once and committed.
