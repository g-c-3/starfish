# Architecture — Arkly

A fully offline-first, privacy-first personal capture & action app for Android, built with Capacitor.
No account or server is required for anything the app does by default. No automated inference, no
external verification. An entirely optional, opt-in Google Drive backup exists for anyone who wants
an off-device copy (see §4b) — everything else stays local-only, with or without it.

> Working name history: prototyped as "Actioner" during early design; finalized as **Arkly**.

Last updated: 2026-09-19 (seed session — full design consolidated from pre-repo conversation; no code beyond the scaffold committed yet).

## 1. Core principles
- 100% local storage (SQLite) by default. No account or server is required for capture, search,
  reminders, expenses, or local backup/restore.
- The only network calls this app will ever make are the ad SDK (deferred — see below), only if
  the person explicitly opts in, Google Drive backup (§4b), and two actions the person starts with a
  tap: Check for updates (public repo, no token, Decision 214) and Verify link (short map link, Decision 117). None is reachable from, or
  required by, local-only use.
- Three independent local credentials: app-open password, private-notes PIN, backup passkey.
- Everything convertible to text gets indexed (FTS5) for full-text search.
- Voice recordings and generic files are searchable by **label only** (no transcription/parsing).
- Images and PDFs are searchable by label and tags only; no text recognition (Decision 192).
- Rule-based intent engine (regex/keyword) detects reminders from any text/voice-labeled/typed input — no automated inference. Money is never detected (Decision 131).
- **Every entry requires a user-supplied label before save completes** (blocking, not optional) — across voice,
  image, PDF, generic file, and note types alike. Labels are what make voice notes and generic files searchable
  at all, since neither gets transcription/parsing.
- **Ads are deliberately not part of this build (Decision 58)** — Phase 12 stays unstarted; no
  AdMob plugin is installed, `ads.js`'s gate logic is written but never called from anywhere. The
  design decision for whenever ads *do* ship is still: a rewarded, non-skippable unit shown once
  per day **only if one successfully loads**; if it fails to load or there's no internet, the gate
  is skipped silently, and it never blocks access to local data. Not notifications either — no ad
  format of any kind ships in this build.

## 2. Entry types
| Type | Body content | Searchable by | Extra fields |
|---|---|---|---|
| Text note | typed | label + body | `is_private` |
| Voice recording | audio file | label only | noise_reduction (bool) |
| Image | none | label only | — |
| PDF | none | label only | — |
| Generic file | none | label only | extension, auto_category |
| Reminder | text + datetime | label | fire_at, repeat_rule, snoozed_until — manual capture card built Decision 78; Vault variant built Decision 140 (schedule columns plaintext, name in `encrypted_label` (Decision 145), note in `encrypted_description`, notification text `Vault Reminder`), same type/columns the pre-existing `intents.js` auto-detection ("remind me...") already used; the two are indistinguishable once created |
| Location | none | label only | latitude, longitude — capture card built Decision 79 (main only; Vault variant not built); Share sends label + map link; detail view Decision 93 |
| Money | none (Home: details in `money_json`, Decisions 124, 126; Vault: details JSON in `encrypted_body`, Decision 135) | Home: label (readable summary) + description (note); Vault: in-memory index only | Home and Vault built; kinds Spent, Lent, Received, Borrowed with repayments; separate type from Expense below; expenses are not auto-detected (Decision 131) |
| Expense | amount + category | label/category | amount, category, replied (bool) — legacy rows only (detection removed, Decision 131); read as Spent in Money, no capture card, no private variant |

`is_private` (pivot: was notes-only, now applies to Text/Voice/Image/PDF/Reminder/Location/Money/Files
— Private Vault, §3b) turns ANY of these eight into a vault entry: AES-encrypted at rest under the
vault PIN's derived key,
excluded from both `entries_fts` and `label_history` entirely (not just the body — see §3b), and
findable only through the vault's own in-memory search once unlocked. Expenses/Reminders have no
private variant — out of vault scope.

## 3. Credentials (three independent locks)
1. **App-open password — optional ("quick access").** Gates app launch when set; a `NULL` hash means no lock
   screen at all on open. Addable/removable anytime in Settings, not just at first run. Salted hash in DB when
   set. Recoverable via backup-passkey proof (see below) — only meaningful when a password exists to recover.
   Own idle auto-lock (`auto_lock_minutes`) plus an immediate lock on backgrounding (Decision 45) — moot when
   quick access is enabled, since there's nothing to lock back to.
2. **Vault PIN** — independent. Wraps a random Vault key (PBKDF2 600000, AES-GCM; Decision 195) that
   encrypts every vault entry (any of the five types, not just text — §3b). NOT recoverable via backup; only "reset & wipe the Vault" is available if forgotten.
   Its own auto-lock timer (`vault_auto_lock_minutes`), separate from whatever the app-open password's own
   timeout is — locking the app doesn't necessarily lock the Vault and vice versa. Also locks immediately on
   backgrounding, same as the app-open password (Decision 45) — `privateSessionKey` never survives the app
   actually leaving the foreground, not just an idle window.
   Typed credentials never persist (Decision 94): every password/PIN field is emptied when the lock screen shows
   (all app-lock paths) and when the Vault locks (Vault fields), and after a successful unlock.
   Lock button (`#lock-toggle-btn`): locks the Vault on the Vault screen, the app on Home/Settings (by
   `currentLocation`); the two locks stay independent.
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
require a new backup; changing the PIN only re-wraps the Vault key (no PIN-change screen exists yet); making a new
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
whatever was stored for biometric unlock — a stale cached value would otherwise unlock with the *old*
credential (for the Vault, the stored copy is the Vault key itself, not the PIN, Decision 195; one that no longer matches the wrapper is cleared), silently wrong the moment it changed. Re-enabling after a change
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
never the app-open password. The one exception: an Append of Vault items made under another Vault key asks for the Vault PIN set when the backup was made (§4, Decision 255). Those two credentials live inside the restored database
itself as hashes/derived keys, so they come back automatically at whatever they were on the source device at
backup time, and the app shows its normal lock screen afterward using that restored app-open password (or skips
straight in, if quick access was what the source device had). If the
app-open password was changed *after* the backup was made, restoring reverts it to the older, backed-up value —
worth a one-time notice at restore time: "This will restore your data as of [backup date] — password and notes
will match that point in time."

### Privacy Screen (Decision 64 — a real user-toggleable setting, not a build-time flag)
A Settings switch (`#privacy-screen-settings`, off by default) backed by `@capacitor-community/privacy-screen`
(pinned to `5.2.0` — the only version line whose `peerDependencies` matches this project's Capacitor 6).
Two effects from one Android setting (`FLAG_SECURE`), not independently toggleable: the recent-apps/
task-switcher preview shows a blank thumbnail instead of a live screenshot of the last screen (matching
Opera Incognito's behavior — requested directly), and screenshots/screen recording of the app are blocked
system-wide. The second is a side effect of the first, not a separate feature, but fits the app's own
privacy premise regardless. Applied via `src/js/privacy-screen.js`'s `setPrivacyScreen()`, called at the
same point in `bootstrap()` as `applyAppearance()` — before the lock screen renders, so the setting (when
on) covers the lock screen too, not just the unlocked app. Persisted via `metaGet`/`metaSet`
(`privacy_screen_enabled`), same mechanism as `dark_mode`. Replaces an earlier build-time-only version
(Decisions 62/63) that hand-patched `MainActivity.java` in CI and could only be turned off by editing the
workflow — this version is a real runtime toggle instead.

## 3b. Private Vault (pivot — was notes-only "private notes," now spans five types)

The Vault is opt-in: no Vault PIN means off; setting one turns it on, and it cannot be turned off afterwards (Decision 119).

Text, Voice, Image, PDF, and Files can all be private now, gated by the one Vault PIN (§3). The Vault is meant
to be **an exact functional replica of the main app** — same capture, same edit, same tags/label autocomplete,
same search, same trash-with-30-day-restore, same four per-file actions in the same order — with three
deliberate differences, all safety-necessary rather than arbitrary:

1. **Everything lives encrypted at rest, including raw file bytes.** A vault entry's `file_path` stays `NULL`;
   its content (base64 file bytes, plus an always-empty OCR text slot for image/pdf, Decision 192, bundled together as one JSON string) travels
   inside `encrypted_body` instead, via the exact same `encryptPrivateNote`/`decryptPrivateNote` AES-GCM calls
   a private note's text always used. A note's own plaintext shape is unchanged, so pre-pivot private notes
   need no migration. Content is only ever decrypted into memory (a `Blob`/object URL for files), never written
   back to disk unencrypted except at the explicit moment Download is invoked (point 3 below).
1a. **Description is encrypted too.** A Vault entry's description lives in `encrypted_description` (same AES-GCM
   calls); `description` stays NULL. It is decrypted into the in-memory index on unlock and is searchable there.
   The label is encrypted too (Decision 145): `label` holds the placeholder `Vault item`, `encrypted_label` the real one. The schedule columns of a Vault Reminder, `type` and the timestamps are inside the encrypted database file since Phase 17 C (Decision 158).
2. **Search runs on an in-memory index, dropped on lock. It is stored only as two blobs encrypted under the Vault key**
   (Decision 253, replacing Decision 39's memory-only rule): see "Persisted Vault index". Same lifecycle as `privateSessionKey` itself. Also powers vault-only label
   autocomplete, which deliberately does **not** touch the shared `label_history` table — see point 4.
3. **Share and plain Download work exactly like the main app's** (Decision 41, reversed from an earlier,
   more restrictive default) — the UI should carry a one-time notice that doing so puts a plaintext copy
   outside the vault's encryption boundary from that point on, but nothing is blocked.
   ("Download for append" no longer exists — Decision 83. Moving Vault content between devices is a full
   backup with the Private Vault category, restored with its cross-PIN append path.)
4. **Vault entries never touch `entries_fts` or `label_history` — not just their body, their label too**
   (Decision 40). This was a real, silently-shipped bug until this pivot: both tables were being written for
   *every* entry regardless of `is_private`, meaning a vault item's title (though never its body) was
   discoverable via ordinary, no-PIN search, and its label could surface as an autocomplete suggestion in the
   normal capture bar. Fixed in `insertEntry()` (db.js) and `restoreBackup()` (backup.js).

**A Vault lock always shows the gate (Decision 139).** Every lock path (button, idle, background, screen off) ends in `lockVault()`, which clears the key, lists, counts and search text, closes Vault dialogs and viewers, closes a Select files screen listing Vault items, and redraws the locked gate when the Vault is on view (no biometric prompt then; it is offered on return to the app). An app lock closes the static overlays above the lock screen.

**Its own trash, its own auto-lock.** The Vault has a second 30-day trash bin, independent of the main app's —
same restore/permanent-delete, same 30-day rule, distinguished from the main bin by `is_private` rather than a
second table (`listTrash()`/`restoreFromTrash()`/`permanentlyDeleteEntry()` in db.js are shared, generic
functions). Its auto-lock timer is its own column (`vault_auto_lock_minutes`), independent of whatever the
app-open password's own timeout does — locking one doesn't necessarily lock the other.

**Backup category.** Every vault entry, regardless of type, falls under one unified `private_vault` backup
category (was a notes-only `private_notes` category before this pivot) — see backup.js's `ENTRY_CATEGORIES`.

**"Select files" multi-select** (Decision 44; type chips and sort added to Home's, Decision 146) is shared between the main app and the Vault: category-grouped,
per-item size shown, selectable individually or as a whole category, with bulk Share/Download/Download for
append/Delete (Edit stays per-item — bulk-editing arbitrary fields across mixed types has no coherent meaning).

### Vault files on disk (Decision 212)
- Voice, image, PDF and file entries in the Vault are stored as `files/<random name>`, no extension, in the Home format (Decision 161). The per-file key is wrapped (AES-GCM, the path as additional data) under the Vault key, not the master key, and kept in `entries.file_key`. `file_path` is set, `encrypted_body` is NULL, size and OCR text sit in `encrypted_meta` (`{ v: 2, s, o }`, encrypted under the Vault key).
- Move between Home and Vault writes no bytes: the key is unwrapped under one key and wrapped under the other, the new row points at the same file, and the old row gives the file up before it is deleted.
- Delete, Trash purge and the orphan sweep treat Vault and Home files alike. A Vault row from before this decision keeps its bytes in `encrypted_body` and is still read.
- Backup: a Vault file travels as its stored bytes with its wrapped key; the archive's wrapped Vault key (Decision 196) opens it. Restore writes the bytes as they are; Append with the source PIN re-wraps the key under this device's key and gives the file a new path; Overwrite keeps both.

## 3c. Encryption at rest (Decision 144; A, B, C built and confirmed; D, E built, not device-tested)

Goal: nothing readable by reading the database file or the files on disk, and still fast. Key derivation stays PBKDF2 with AES-GCM on Web Crypto; no external crypto library.

| Stage | What | State |
|---|---|---|
| A | Vault labels encrypted (`encrypted_label`, generic placeholder in `label`) | built, Session 94, Decision 145; confirmed on device |
| B | Vault index updated per entry, not rebuilt on every change | built (Session 98, Decision 151); confirmed on device |
| C | Whole-database encryption, FTS5 search kept | built, Session 101, Decision 158; owner's database converted; DP42 confirmed on device, Session 103 |
| D | Per-file encryption: random name, no extension, random per-file key wrapped under the master key | core module built, Session 103, Decision 161; wired, Session 104, Decision 162; not device-tested |
| E | Backup and restore adapted at every stage | built with D, Session 104, Decision 162; not device-tested |
| F | One-time migration of existing plain Home files | built, Session 104, Decision 163; runs at start; not device-tested |
| N | Persisted encrypted Vault index, name search, lazy body search, Trash from the index (Decisions 195, 253) | first part and encrypted thumbnails built, Session 149 (Decisions 253, 254); device-confirmed; field binding built under O, Session 151 (Decision 257) |
| O | Backup and restore for the new Vault format (Decisions 195, 255) | first part built, Session 150 (Decision 255): restore under another Vault key (device-confirmed); field binding built, Session 151 (Decision 257); not device-tested |

Vault entries stay under the Vault PIN on top of any database layer. The three credentials stay independent. The database key is random, generated on the device and held in the plugin's Keystore-backed storage (Decision 158); it is not derived from any of the three credentials and is never in a backup. New installs start encrypted; an existing plain file converts at the next start after the owner opts in, one attempt per request, with row counts compared. `allowBackup` is false so an OS backup cannot restore the file without its key.

**Backup rules (binding on every stage):** a backup is encrypted only under the backup passkey and never holds a device key; it restores on a different device with the passkey, plus the old Vault PIN for Vault entries (append re-keys); restore re-encrypts for the current device; pre-plan backups stay restorable and are encrypted on the way in; append stays the default and the safety-backup rule is unchanged; a failed restore must not leave a mix of old and new encryption. Check §4 before touching any of this.

**Migration (Decision 163):** plain Home files are converted once at start (write, read back and compare, repoint, remove); orphans in `files/` are swept once after a clean run.

**Home files (Decision 162):** stored as `files/<32 hex>` with `entries.file_key`; plain files (`file_key` null) are read as they are until F. Thumbnails are memory only. Other apps get a decrypted copy in `cache/open/`. Deleting an entry removes its file.

Open: Vault PIN minimum length; an optional app-password wrapper around the database key; speed of backup and restore with many files.

## 4. Backup & Restore (full design)

### Archive formats (Decision 159)
- **Format 2 (written by Export Now and the safety backup):** line 1 is a plain header `{version:2, salt, kdfIterations, hint}`; every later line is `{iv, c}`, one AES-GCM call whose additional data is the line number. Records in order: head (categories, tags, settings, Vault salt, size per category), per entry an entry record then its stored-body pieces and file chunks, end (counts). Backup and restore hold one chunk at a time, never the whole archive.
- **Format 1 (read always; written by the Drive path):** one JSON object, encrypted as a whole.
- Restore reads the picked file with `File.slice`. Overwrite reads and decrypts the whole file once, and checks the end record, before the safety backup and before any deletion; append has no first pass.
- A format 2 file is detected by its header text; anything else is read as format 1.

### Filenames (Decision 55, letters extended in Decision 57)
`backup_<letters>_<yyyymmdd_hhmmss>.dz` (the `append_` prefix was removed in Decision 83); `letters` is a fixed-order subset of
`tviprlmf` (Text/Voice/Image/PDF/Reminder/Location/Money/Files — only the letters for categories
actually included, regardless of the order they were selected in; a backup with only Text and PDF
is `tp`, not `pt`). Categories with no letter of their own (Private Vault, Expenses, Tags, App
Settings) don't contribute one; a backup containing none of the eight lettered categories at all
uses `x` rather than leaving that segment empty. `.dz` replaced the previous `.dzbackup`/`.zip`
extensions — file pickers still accept the old extensions for anything backed up before this
change, but nothing is
written with them anymore.

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
    digest visibility, currency symbol, etc.) as a straightforward overwrite — no merge semantics needed, just replace the local
    value. Explicitly **excludes** password/PIN hashes, salts, and hints — those remain governed only by the
    credential rules already established (a normal restore never touches them; only the dedicated
    forgot-app-password recovery flow does), so a Settings restore can never become a backdoor around that.
- Storage sanity check shown before restore is enabled: **Required** (sum of file sizes for selected categories)
  vs. **Available** (device free space via Filesystem API). Restore button is disabled if required > available.
- The same backup file can be re-opened later for a follow-up partial restore of a different category — not a
  one-shot, all-or-nothing use of the file.
- **"Extract to device storage" (no DB import):** lets the user pull a category's raw files out to a normal
  folder (e.g. `Downloads/Arkly-Restore/`) without touching the app's database — solves the "I already added
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
- **Exact match (same UUID already exists among live entries; trashed rows do not count, Decision 112):** skipped automatically, counted, not shown as a decision point —
  but the post-restore summary includes a **"Restore these anyway"** action. Forcing one in generates a *new*
  UUID for the forced copy and labels it `(Restored)`, exactly like a label-collision case below. An entry whose UUID exists
  only in Trash is restored under a fresh UUID with its own label; the trashed row stays in Trash.
- **Different UUID, same/similar label:** appended as a new entry, with its label suffixed `(Restored)` (e.g.
  "Invoice (Restored)") so it's visually distinguishable in the timeline/search. The underlying file is never at
  real risk of a filesystem-level name collision, since files are stored under internally-generated unique names
  (e.g. `<uuid>.jpg`), not the original camera/OS filename — `(Restored)` is purely a display disambiguator.
- **Post-restore summary, always shown:** *"X entries added, Y skipped as exact duplicates (restore anyway?),
  Z labeled (Restored) due to matching labels."*

### Vault items across devices and PIN changes (Decision 255)
The archive carries the wrapped Vault key (`credentials.vault_wrap`, in the archive as `privateVaultWrap`) once, for every Vault entry in it. `vaultrestore.js` compares it with this device's wrapper by the check value inside, after the backup passkey opens the archive and before anything is changed.
- **Same key:** entries are inserted as they are. No PIN is asked, also when the PIN was changed after the backup.
- **Append, other key:** the PIN set when the backup was made is asked (checked against the archive's wrapper); this device's Vault must be unlocked. The source key is opened once; every entry field (body, label, description, metadata) is decrypted with it and encrypted under this device's key, and a Vault file's key is re-wrapped under this device's key with a new path (bytes untouched). A wrong or forgotten PIN skips nothing silently: the restore does not start, and Cancel changes nothing.
- **Overwrite, other key:** this device's wrapper is replaced by the archive's after the old rows are removed and before the first entry is written; the Vault locks, the fingerprint copy is turned off, and the Vault PIN is the one set when the backup was made. The backup passkey is the proof; the earlier PIN no longer opens the Vault. The PIN hint is not in the archive and stays.
- **Append with no Vault set up here:** refused. **Vault entries with no wrapper (made before stage L):** refused with a plain message, before any change.
The app-open password is unaffected either way: it lives in the `credentials` table, untouched by append mode, which only ever touches `entries`.

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
the app itself creates — Arkly can never browse, read, or touch anything else in the person's
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
won't fit" check `backup.js` already does against the phone's real free space (Decision 150) applies here against
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
fit" check `backup.js` already does against the phone's real free space (Decision 150) applies here against that
response instead — `limit` absent means an unlimited-storage account, treated as no cap. Shown before
the upload starts, not discovered mid-transfer.

**Restore reuses `backup.js`'s `restoreBackup()` directly** — `gdrive.js`'s `restoreFromDrive()` only
fetches the archive from Drive and hands it to the exact same append/overwrite/dedup/tag-restore logic
Phase 6 already has. One restore engine regardless of source, not two to keep in sync.

**Google Sign-In plugin: `@codetrix-studio/capacitor-google-auth`**, chosen for compatibility with the
app's current Capacitor 6 pin — the newer, more actively-recommended Capawesome Google Sign-In plugin
requires Capacitor 8, a separate, larger upgrade not undertaken for this alone.

## 5. Per-file actions (every entry gets these four — `fileactions.js`, Decision 83)

Order is fixed everywhere (Decision 134, Move added by Decision 181): Edit, Share, Download, Move, Delete. Move shows only for the types it supports (Decisions 182 to 184). The Select files bar order is Share, Download, Make a PDF, Move, Delete (Decision 185). Delete is a red bin icon. Row buttons, the image viewer header and the Select files screen follow it; bulk bars omit Edit. A tapped row button glows alone; the row does not react (Decision 136). The Money, Reminder, Location and Voice viewers carry Share, Download and Delete after Edit too (Decision 141).

Downloads: `Documents/Arkly/<label>.<ext>`, existing names get a ` (n)` suffix; Location, Reminder, Money (and legacy Expense) are `.txt`; a toast confirms the path (Decision 136).

Download for append, its per-entry encrypted zip and the "Append files from download" import screen were
removed in Decision 83. The only way to move data between devices or installs is a full or selective backup
(§4), including Private Vault content.

1. **Edit** — label/tags always editable; note body editable; expense amount/category editable; reminder time/repeat editable and
   must reschedule its notification, not just silently update the DB row. **Vault entries of any type**
   (not just text) require the vault PIN already unlocked for that session to edit content — label/tags-only
   edits don't, since those were never encrypted. Built (`editEntry()`), takes a caller-supplied reschedule
   callback for reminders rather than importing `notifications.js` directly, to avoid a circular import with `app.js`.
2. **Share** — native share sheet, raw file for voice/image/pdf/file, plain text for notes. **Works identically
   for Vault entries** (Decision 41, pivot — was Copy-only before): content is decrypted into memory first,
   never written to disk unencrypted, but otherwise no restriction. A one-time notice on first vault
   Share/Download: content leaves the vault's encryption boundary as plaintext from that point on. `copyPrivateNote()`
   still exists as an extra convenience for vault text specifically, not a replacement for Share/Download anymore.
3. **Download (plain)** — unencrypted raw file only, written using the entry's **label** as the filename (not
   the internal UUID), meant for genuinely leaving the app (open elsewhere, send outside Arkly). **Works for
   Vault entries too** (Decision 41, pivot) — decrypted into memory first, written out plain only at the moment
   this is explicitly invoked. Built (`downloadPlain()`).
4. **Delete** — soft-delete into the 30-day trash bin (main or Vault's own — §3b); consistent with
   the append-mode philosophy of never silently destroying data. Already existed as `db.js`'s `softDelete()`;
   `fileactions.js` re-exports it so every per-file action is reachable from one module.

**"Select files" multi-select** (Decision 44, §3b) covers three of these four in bulk — Share, Download,
Delete — shared between main and Vault, category-grouped with per-item size shown.

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
- **Undo (Decision 137).** Every Delete shows a 6-second toast with Undo, which restores from trash. Delete permanently has none.
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
- **Expense charts** — built (Decision 263): Spent and Received bars under the Money month header, six months or the weeks of the shown month, from the same details as the month totals, in `src/js/moneychart.js` (local SVG, no library); Home and Vault share the painter, the Vault reads its in-memory index only.
- **Recurring backup reminder — done (Session 40).** A soft, dismissible in-app banner (not a push
  notification — simpler, and "soft" only requires never blocking anything) shown on Home when it's been
  30+ days since the more recent of `credentials.last_backup_at`/`last_drive_backup_at` — either backup path
  keeps the "forgot app password" recovery flow (see above) usable, so whichever is more recent is what's
  checked, not local specifically. Suppressed when there are zero entries (nothing yet worth losing) so a
  fresh install isn't nagged on day one. Dismiss is in-memory only, not persisted — reappears at the next
  cold launch rather than going silent for weeks if forgotten.
- **App auto-lock timeout** — configurable inactivity timeout (`credentials.auto_lock_minutes`, default 5) that
  re-locks the app, so the password isn't only a one-time gate at cold launch.
- **Dark mode** — on/off toggle, stored as `meta.dark_mode` (`'on'`/`'off'`). No system-theme auto-detection
  required for v1; the toggle is the single source of truth once set. Applies via a `data-theme` attribute on
  `<html>` and CSS custom properties, not a full stylesheet swap. Lives under the App Settings backup category
  (see Backup & Restore above), so it travels with a backup/restore like any other non-sensitive preference.
  A separate "Gradient mode" (full-screen blurred glow, user-picked colors) existed briefly and was removed
  (Decision 53) — dark mode is the only Appearance setting now.
- **Layout: bottom nav, not one long page (Decision 53; reduced to two tabs in Decision 61)** — Home / Vault,
  fixed at the bottom of the screen once the app is unlocked (hidden on first-run/lock-screen/the ad gate,
  which have nothing to navigate between). Home and Settings are two panels inside the same main screen,
  toggled together (no longer by the nav directly — Settings is reached via an "App Settings" tile inside
  Home, Decision 61) rather than requiring a scroll past the entire timeline to reach settings; Vault keeps
  its own separate screen and lock gate, unchanged by this — the nav's Vault button just triggers the same
  unlock flow that already existed. The Vault's own settings (biometric toggle, auto-lock, Vault Trash) are
  similarly consolidated into one tile (`#vault-settings-card`) inside the Vault screen rather than three
  separate always-visible sections. A small red power icon (transparent background, only the icon stroke
  colored — Decision 62 restyled this from an earlier solid-circle version), fixed top-right and present on
  every screen except the app-open lock screen (removed there on request, Decision 62), force-closes the app
  via `@capacitor/app`'s `exitApp()` — native-platform only. No confirmation dialog (removed in Decision 62;
  present briefly when the button first shipped in Decision 61). Lock-on-background (Decision 45) is
  unaffected by any of this and still covers what's seen on next open regardless of how the app was closed.
- **Lock/unlock toggle + universal Back button (Decision 65).** `#lock-toggle-btn` sits fixed top-right,
  immediately left of the power icon, on every screen except the app-open lock screen and the Vault's own
  locked gate — context-aware at click time (checks whether `#vault-content` is visible) rather than tracking
  a separate flag, so it can't drift out of sync with what's on screen. Locks the Vault (`lockVault()` +
  synchronous `showScreen('main-screen')`) or the main app (reuses `showLockScreen()` wholesale) depending
  on which is current; `#vault-lock-btn` (the Vault banner's own former "Lock" button) is gone, fully
  replaced. A third bottom-nav slot, `#nav-back-btn`, sits between Home and Vault — styled as a plain
  rounded square, not a third tab (no label, no active state). Hierarchical since Decision 82 (originally a two-slot toggle):
  Back goes up one level inside the current section and stops at that section's landing page, where it is
  dimmed — Home: Settings or an open folder -> Home landing; Vault: an open Vault Settings card -> Vault
  landing. It never switches between Home and Vault; the nav's Home/Vault buttons do that. Every dedicated "back to home" element
  (e.g. Decision 61's `#settings-back-btn`) is removed in favor of this one universal control.
- **Restyle + disabled state + Vault contrast fix (Decision 66; icon/color updated in Decisions 67-68).**
  Lock button: closed-padlock icon, `--neon-green` (`#39ff14`, fixed across both themes, changed from an
  earlier open-padlock/gold version), thicker stroke, persistent two-layer glow (`drop-shadow`); disabled (grayscale, dimmed,
  `pointer-events: none`) on Home/Settings whenever no app-open password is set (quick access has nothing
  for it to lock into), recomputed on every entry into those tabs rather than cached; never disabled in the
  Vault, which always has a PIN by the time the button is shown for it. Power button: persistent red glow
  added for parity. Back button: new curved-return-arrow icon (no enclosing circle), plus a 0.5s tap-glow
  animation in `var(--brand)`. Hidden on first-run setup too now, not just the lock screen — no password
  exists yet at that point. Separately, the Vault's own lock button was reported missing; root cause was a
  contrast bug, not a logic bug — `.vault-banner`'s near-black background (`var(--vault)`) made the
  (previously `var(--fg)`-colored) icon sitting on top of it nearly invisible in light mode. Fixed by
  removing that dark title bar entirely (`.vault-banner` now uses `var(--card-bg)`) and the bottom nav's
  matching dark active-Vault-tab background (now `var(--vault-fg)`, a light tint, with `var(--vault)` as
  the now-legible text/icon color) — the Vault's visual identity comes from the lock icon, heading and nav
  tint rather than a solid dark panel. Superseded in part by Decision 86: the filter chips and tabs no
  longer exist (Decision 85) and the nav uses the floating style.

## 7. Capture UX decisions (validated during design, binding for the build)

- **One unified "+" capture entry point** — a single button opens a sheet (mic / camera / file / text) rather
  than separate top-level buttons per type; all captures land in the same unified timeline regardless of source.
  **Home layout (Decision 81):** the eight cards are folders, each listing only its type (Money also lists
  expenses) with a New button inside; a universal New on Home asks which type; the mixed timeline is now
  search results only. The Vault mirrors this exactly (Decision 85).
- **Offer, not silent action (Decisions 175, 178)** — typed note text is always saved as a note. When it reads as a
  reminder with a time still ahead, a Yes/No sheet after the Save dialog offers a reminder in addition (parsed label and
  time; Set reminder too / Note only). Back or No keeps the note only. Every action traces to a visible rule.
- **Map view for saved locations** — dropped (Decision 262): a map that loads tiles would be a third network call.
- **Label autocomplete from history** — implemented via the `label_history` table in `db.js` (also what powers
  batch-numbering, above). Previously used labels for a given entry type surface as tap-to-select suggestions at
  capture time ("Invoice", "Payment Screenshot", "Receipt"...), so a personal taxonomy builds up naturally
  without the user retyping the same label repeatedly, and without any hardcoded category list.
- **OCR-based label suggestion** — dropped with OCR (Decision 192); `suggestLabel()` in `intents.js` has no input and is unused. As designed: keyword matches against OCR
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
  - Once saved, every entry from the batch is fully independent — searchable, editable (can be individually
    renamed later via the existing Edit action), and deletable on its own, with no lingering "batch" grouping
    in the data model.
  - **Status (Decision 84):** built on the main capture bar only (Image/PDF/Files). Chosen by a confirm dialog when more than one file is picked; individual add labels each entry by file name. No label pre-fill: OCR dropped (Decision 192). Vault batch add not built.
- **Expense follow-up flow** — removed (Decision 131). Expenses are no longer detected from text; see Money.
- **Reminder notifications, not alarms** — implemented via `@capacitor/local-notifications` (`notifications.js`),
  deliberately not `AlarmManager`/full-screen intents, for reliability and simplicity reasons recorded in
  `android-notes/native-setup.md`. Includes a high-importance banner channel (`dumpzone_reminders_v2`, system default sound, Decision 96)
  and Snooze (10 min) / Done action buttons. Schedules use `allowWhileIdle: true`, and the manifest carries
  `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` so the plugin sets an exact alarm that wakes the phone in Doze
  (Decisions 97, 101). Snooze/Done run in a native receiver with no app launch (Decision 102, see the section below);
  Snooze stores `snoozed_until`, giving a `snoozed` status that stays active (Decision 99).
- **Reminder reliability UX** — on first reminder ever set, explicitly prompt the user to exempt Arkly from
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

### Save dialog and text editor (Decision 91)
One sheet for every capture and edit: file name, tags (max two), description, Save. Untouched Save stores the
default name, no tags, no description; picked files keep their phone name. Tag chips list tags used by live
entries in the same scope only (main dialog: non-private; Vault dialog: private). Text notes are written in a
full-screen editor that leads into the dialog. Both overlays close when the app locks (all) or the Vault locks
(Vault ones); a capture loop that sees a lock stops instead of reopening the editor. Description is searchable in
the same FTS column as the body. Tapping a row opens it; text notes, reminders and locations have viewers so far.

### Reminders: completion and notification actions (Decision 92)
`reminderStatus(row)` (`reminders.js`): `done` if `completed_at` is set; `fired` if it does not repeat and its time
has passed; otherwise `upcoming`. Done and fired are greyed out in lists. A repeating reminder is never inactive
through Done or time (Decisions 107 and 108): Done clears this time and it recurs until Repeat is set to none or it is deleted. The reminder's date, time and repeat are fields of the Save dialog. Notification buttons: Done
on a one-off sets `completed_at` and cancels (on a repeating one it clears the snooze only); Snooze schedules a one-off 10 minutes out under its own id, so a repeating schedule
is not replaced. Both are handled natively (Decision 102): `ReminderActionReceiver` (written by
`scripts/patch-reminder-actions.js`, which also points the plugin's `snooze`/`done` buttons at it) dismisses the
notification, cancels or schedules the alarms, and queues `{a, e, t}` under `dz_ra:*` keys in the Capacitor Preferences
store. `drainQueuedReminderActions()` (`app.js`) writes `completed_at` / `snoozed_until` in tap order at startup, on
resume and every 4 seconds while visible. No database is opened natively and no content is queued, so both work while
the app is locked or closed; the Decision 100 minimise rule remains only as a fallback for notifications scheduled
before Decision 102; a plain tap on the
notification does nothing, so content is never opened ahead of the lock screen. Deleting a reminder cancels its
notifications; restoring a pending one reschedules it.

### Restore refresh and Discard confirmation (Decisions 111, 114)
After a restore the Vault index is rebuilt when the Vault is unlocked and `arkly-data-restored` redraws Home and Vault lists.
In a capture Save dialog (Discard label) Discard and Back ask Yes/No through `askYesNo()` before dropping the take. The text editor (changed text) and the voice recorder (recording or review) do the same on Back (Decision 115); the tap-twice rule is gone.

### Add location by coordinates (Decisions 116, 117)
New in Location asks: Save current location or I have coordinates. Coordinates opens a paste dialog (`#coords-dialog`) that parses
live with `geoparse.js` (decimal pair, N/S/E/W, `geo:`, full Google Maps links) and shows the decimal and degree text plus the grid
plot before Continue opens the Save dialog. A short map link shows Verify link: one tap, one request to Google through
`CapacitorHttp` (redirects read one hop at a time, Google https hosts only, stops at the first hop with coordinates). Open in Maps
is not offered here because leaving the app triggers the background lock.

### Location capture progress (Decision 113)
While the fix is pending a sticky "Fetching location…" message shows and the Home New buttons are disabled.

### Location detail (Decision 93)
Opens on the shared viewer shell: coordinates as degrees with hemisphere letters, decimal values, and an inline SVG
grid plot (30° lines, no map data). Open in Maps hands a `geo:` URI to the phone's maps app; Copy writes the decimal
pair to the clipboard. Arkly makes no network request for either. Main entries only; an entry with no coordinates
shows a notice and no actions.

### Voice recorder and player (Decision 103)
Both use the shared viewer shell. Recorder: ready, recording, review; review plays the take before the Save dialog, and a
lock discards it. Saved voice opens in a viewer with the player (play/pause, scrub, speed). Vault audio is decrypted into
an in-memory blob URL for the life of the viewer and revoked on close or lock. Playback re-arms the matching idle lock.

### Back button everywhere (Decision 104)
The Android Back button and back gesture run this same action with the same glow; on a landing page or the lock gate they send the app to the background (Decision 138).

The nav's Back stays visible on every screen: alone on the lock, first-run and ad-gate screens, and alone above any open
overlay (`body.overlay-open`). It dismisses the top-most layer: Yes/No sheet, Money dialog (Decision 132), selection, Save dialog, static modal, editor, viewer (through its
guard), then the Decision 82 hierarchy. Dimmed when nothing is open to go back from.

**Unsaved work (Decision 133).** Back and every Cancel ask "Discard changes?" before dropping typed or chosen input; with nothing changed they close at once. Covered: Save/edit dialog (compared with its values at open), text editor, Money form and repayment dialog, coordinates paste, auto-backup passkey, Settings and Vault Settings fields (passkeys, hint, currency symbol, confirm password or PIN). Capture dialogs (new recording, reminder, location, files) always ask. Passkey fields are cleared after a backup or restore succeeds, so a finished action is not unsaved.

### Repeating reminders (Decisions 107, 108)
A repeating reminder is its next occurrences (daily 30, weekly 26, monthly 12), each an exact wake-from-idle one-off, ids
hash(`<entryId>:r<k>`), at most 30 per reminder. The window is topped up on launch, on resume (at most every 6 hours) and
after a Done. `reminders.js` holds the occurrence math and `reminderNextDue`, shared by the scheduler and the row display.

### Search (Decision 106)
`entries_fts` stores its columns (id, label, body text plus description; non-private rows only). `searchEntries` ranks
word-prefix matches, then adds substring matches from `entries`, so Home matches like the Vault's in-memory search.

### Image grid and viewer (Decision 105, layout Decision 109)
The Image folder (Home and Vault) is a thumbnail grid. Home thumbnails are cached as files in the cache directory; Vault
thumbnails exist only in memory and are dropped on lock. The viewer (shared shell) pages through the folder with swipe or
arrows, zooms with pinch and double-tap, and holds one full-size blob URL at a time, revoked on change, close or lock.
The image fills the screen under a thin header that carries Edit, Share, Download, Delete and the count.

### Multi-select (Decision 122)
Long press on a row or image tile in `#folder-list`, `#timeline`, `#vault-folder-list` or `#vault-list` starts selection (module state
`selection`, bar `#select-bar`). A capture-phase click handler turns taps into toggles while selecting, so open handlers never run.
Actions call `runBulkFileAction` (the Select files path). Ended by Back, folder close, screen change, Vault lock or finishing an action.

### PDF viewer (Decision 121)
Entries of type PDF open in `pdfviewer.js`, built on a bundled pdf.js (legacy build, pinned) and loaded on the first PDF open. Pages are
drawn lazily and released off screen; zoom is 1 to 3 times fit-to-width by buttons; the header carries rename and the page count.
Home bytes come from the stored path; Vault bytes are decrypted in memory only and dropped on close or lock. Layout maths lives in
`pdfmath.js` (no DOM, tested in Node). A protected PDF asks for its password in the viewer (`pdfopen.js`, Decision 125; memory only,
never stored). Reading tools (Decision 153): text layer, find, go to page, thumbnails and outline, in `pdfsearch.js` (pure helpers), `pdfviewer.js` (document side) and `pdftools.js` (interface); memory only. A damaged PDF or a cancelled prompt offers the phone's app. No network.

### Open a file with another app (Decisions 118, 120)
Tapping a Files row hands the file straight to the phone's matching app, with no detail step (`fileopen.js`, Decision 120);
the row icon shows the file's extension. Home files are handed over from their stored path. Vault files are decrypted in memory, written to `cache/open/<id>.<ext>` and handed over; that folder is emptied on
launch, on resume and before each open, never on close or lock (the other app may still be reading). The copy leaves the
Vault's encryption, as with Share and Download. Opening another app locks as a normal background event (Decision 93).
No network, no new permission.

### Money on Home (Decisions 124, 126, 128)
- Form and repayment dialogs: `moneyui.js`. Maths, totals and JSON: `money.js`. Saving, rows and the viewer: `app.js`.
- Capture and edit: form, then the Save dialog. Label defaults to the summary, description is the note.
- Month header (previous, Month and Year dropdowns, next; typed year field under it, Decision 129) and loan totals sit above the Money folder list; totals query all Home rows of type money and expense.
- A repayment holds amount, date, method and note. The form edits the list of repayments; the detail view adds one at a time (Decision 128).
- Symbol: meta key `currency_symbol`, default ₹. Amounts are never converted. Set in Settings > Preferences > Currency: chips from `Money.CURRENCIES`, or a typed symbol of 1 to 5 visible characters (Decision 130). Part of the App Settings backup category.
- Not built: editing a single repayment in place.

### Money in the Vault (Decision 135)
- Details JSON in `encrypted_body`; note in `encrypted_description`; `money_json` and `file_path` NULL. The default name is the readable summary, as on Home (Decision 143); the label is plaintext.
- The unlocked index (`vault.js`) holds the details and a search text; the Vault folder rows, month header, loan totals, search and recent chips read only it. Nothing is mixed with Home totals.
- Same form, repayment dialog and viewer as Home, with Vault hooks: a Vault lock closes them, an app lock closes both. Header ids `vms`.
- Share and Download: readable text from the decrypted details; Download is a `.txt`.
- Backup: no change, the entry travels in the `private_vault` category.

### Location in the Vault (Decision 142)
- `{ latitude, longitude }` JSON in `encrypted_body`; note in `encrypted_description`; `latitude`, `longitude`, `file_path`, `body_text` and `money_json` NULL. The default name is the pasted place name or `Location <time>`, as on Home (Decision 143); the label is plaintext.
- Capture shares `pickLocation` with Home, including Verify link. A Vault lock closes only the Vault's chooser and paste dialog and saves nothing from a pending GPS fix.
- The unlocked index holds the coordinates and a decimal search text. The viewer is Home's (Decision 93) reading the index. Open in Maps, Share and Download are plaintext exits (Decision 41); Open in Maps triggers the background lock.
- Backup: no change, the entry travels in the `private_vault` category.

## 8. Security hardening decisions (recorded, implemented in `android-notes/native-setup.md`)

- **JS minification** of the web bundle (Vite default). Obfuscation is not applied: the source is public and it would only slow the app (Decision 260).
- **R8** (`minifyEnabled true`, resource shrinking off) on release builds, set by `scripts/patch-r8.js` with keep rules for plugins, `Arkly*` bridges and the database engine (Decision 259).
- **Basic signature/tamper check** at app startup (built, Decision 261): `window.ArklySignature.check()` compares the running app's signing certificate
  with the release certificate's SHA-256, written into the app at build time from the keystore (`scripts/patch-signature.js`). A mismatch shows a
  notice; nothing is blocked. It raises the bar against re-signed copies only: the expected value is inside the APK.
- Explicitly **not** pursuing NDK-level native obfuscation — judged not worth the added build complexity given
  the GitHub-Actions-only, no-local-machine build pipeline, and the fact that client-side checks can only ever
  raise the cost of tampering, never eliminate it (the app's own ad-gate logic runs on the attacker's device by
  necessity, since there's no server to validate against — see Ads section).

## 9. Search
SQLite FTS5 virtual table over `(label, body_text)` for all non-private, non-voice, non-generic-file entries.
Private note bodies are excluded from the FTS index entirely; only unlocked-in-session search covers them.
Ranking: label match > body match, then recency.
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
1. Installs Node deps (`npm ci`, from the committed `package-lock.json`; Decision 258).
2. **Builds the web assets** (`npm run build` → Vite bundles `src/` into `www/`). Required, not
   optional: browsers cannot resolve bare npm-package specifiers
   (`import { X } from '@capacitor/filesystem'`) on their own — only a bundler or a hand-authored
   import map can. Every file that imports a Capacitor plugin needs this step to have run first, or
   the app fails to load at all (see the note below — this was the actual cause of the first two
   device-test failures).
3. Adds the Android platform if `android/` isn't committed yet, applies the `scripts/patch-*.js` steps (R8: Decision 259; signature check: Decision 261, after the keystore is decoded), generates app icons, runs
   `npx cap sync android` (copies the now-bundled `www/` into the native project).
4. Builds a signed release APK using a keystore stored in GitHub Secrets.
5. Uploads the APK as a workflow artifact.

`.github/workflows/cleanup-runs.yml` (Decision 187) runs only when started by hand from the Actions tab: it keeps the latest 3 completed runs of each workflow and deletes the older ones with their logs and artifacts. Releases are not touched.

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
arkly/
  src/                  -> the REAL source (HTML/JS/CSS) — edit here, not www/
    index.html
    css/style.css
    js/
      db.js             -> SQLite schema + FTS5 setup
      crypto.js         -> KDF + AES helpers for private notes & backups
      intents.js         -> rule-based reminder/expense detector (label suggestion unused, Decision 192)
      notifications.js  -> local notification scheduling (banner channel, snooze/done actions)
      ads.js            -> rewarded ad gate logic
      backup.js         -> backup/restore engine (build/encrypt/write, decrypt/restore, extract-only)
      gdrive.js         -> optional Google Drive backup (opt-in, additive to backup.js)
      vault.js          -> Private Vault: content bundling, save/load, search index (memory, stored encrypted)
      fileactions.js    -> per-file actions: share, plain download, edit, delete + Select files bulk support
      move.js           -> Move between Home and Vault (Text, Location, Money, Reminder, Voice, Image, PDF, Files; Decisions 182 to 184)
      fileopen.js       -> hand a saved file to the phone's matching app (decrypted copies in cache/open/, purged)
      filestore.js      -> per-file encryption format (chunked AES-GCM, Decision 161), IO injected
      files.js          -> binds filestore.js to the device; every Home file read, write, size and removal (Decision 162)
      pdfviewer.js      -> in-app PDF viewer on bundled pdf.js (lazy-loaded; pages drawn on demand)
      pdfmath.js        -> pure helpers for the PDF viewer: fit scale, pixel budget, page-at-scroll, zoom steps
      pdfopen.js        -> opens a PDF, asking for a password only when needed (memory only; testable in Node)
      app.js            -> app bootstrap / router / expense follow-up flow
  www/                  -> Vite's BUILD OUTPUT — Capacitor's webview content. Regenerated on every
                            CI run; don't hand-edit, changes there get overwritten.
  vite.config.js        -> root: 'src', outDir: '../www'
  capacitor.config.json
  package.json
  .github/workflows/build-android.yml
  .github/workflows/cleanup-runs.yml
  android-notes/        -> notes on native tweaks needed after `npx cap add android`
```

## 13. Status
Implemented in code already: schema (tags, label history, soft-delete columns, optional app-password/vault-PIN
columns), FTS5 search (main app only — Vault search is a separate in-memory index, §3b),
credential hashing/KDF/AES helpers, the intent engine (reminders, expenses), notification
scheduling, the ad-gate decision logic, the app bootstrap control flow (auth → ad gate → digest → timeline,
plus the expense follow-up timeout) including the optional-password/first-run-setup path, the core backup/restore
engine (`backup.js`), optional Google Drive backup (`gdrive.js`, Phase 13 — blocked on manual OAuth setup for
device testing), all four per-file actions (`fileactions.js`) including the "Select files" multi-select, and
the Private Vault (`vault.js` + its `app.js`/`index.html` wiring — capture/browse/search across all five types,
its own trash bin, its own auto-lock). Screen show/hide wiring (`showScreen()`) was itself missing until the
Vault pivot surfaced it — every UI section built in every prior session was technically unreachable before that.
Also implemented: the digest/on-this-day/storage-breakdown screens (§6), and now the "Your Data" transparency
screen (§7, Session 35) — total entry count plus the size of the data held, with an Export Now button that opens
the existing Backup & Restore section rather than a second export path. Entry count excludes Vault entries,
same reasoning as the digest/on-this-day fix (Decision 40) — this screen sits behind the app-open password,
not the Vault PIN. Also implemented: the recurring backup-reminder banner (Session 40), a soft
dismissible nudge on Home when 30+ days have passed since the more recent local/Drive backup. **None
of this has been run on an actual device or through CI yet** — that remains the standing risk
flagged at the end of every session since Phase 1.

Specified in this doc but not yet coded: the quick-capture home-screen widget (design in Decisions 264 and 265; expense charts are built, Decision 263; the
map view is dropped, Decision 262). These are the next
implementation milestones. Native plugin wiring (voice recorder, exact permissions, signature check)
is documented in `android-notes/` since it requires editing the generated `android/` project after
`npx cap add android`, which should be run once and committed.

## Home tools, Trash and Search (Decision 146)
- `index.html`: `#home-tools` (four icon-only `.tool-tile` buttons, named by `aria-label`: `#select-files-btn`, `#open-search-btn`, `#open-trash-btn`, `#open-settings-tile`), `#trash-view` inside `#home-tab`, `#search-screen` as a fixed layer, `#select-files-toolbar` in the Select files dialog. Styles in `css/browse.css`.
- `browse.js`: `browse()` (type, period, sort) and `typeCounts()` are pure; `toolbarHtml()` and `bindToolbar()` draw and wire the toolbar for Trash, Search and Select files.
- `app.js`: `trashOpen` / `closeTrash()` and `searchOpen` / `openSearchScreen()` / `closeSearchScreen()` are top-level so `showScreen()` and `backAction()` can reach them. Back order: dialogs and viewers, then Search, then Trash, then a type folder.
- The Search layer keeps the ids `#search-input` and `#timeline`, so the redraw after Undo still reaches it.
- Select files takes a scope (`getSelectableGroups(scope)`, `getSelectableEntries(db, { scope })`): `home` or `vault`, never mixed (Decision 147).

## Vault tools, Trash, Search and Select (Decision 147)
- `index.html`: `#vault-tools` (`#vault-select-files-btn`, `#vault-open-search-btn`, `#vault-open-trash-btn`, `#vault-open-settings-tile`), `#vault-trash-view`, `#vault-settings-view` holding `#vault-settings-card` (always open, summary hidden by `browse.css`). Siblings inside `#vault-content`: `vault-main`, `vault-folder-view`, `vault-trash-view`, `vault-settings-view`.
- `app.js`: top-level `vaultTrashOpen` / `closeVaultTrash()`, `vaultSettingsOpen` / `closeVaultSettings()`, and `searchMode` (`home` or `vault`) with `searchRows`, so `lockVault()`, `showScreen()` and `backAction()` reach them. `lockVault()` closes all three and a Vault-scoped Select dialog (`#select-files-screen` carries `data-scope`).
- Vault Trash reuses `browse.js` and `showVaultTrash()`. Vault Search calls `searchVault()` on the in-memory index, draws rows with `vaultRowProps`, then appends body matches from `searchVaultBodies()` (Decision 253).
- Nothing from the Vault is stored or sent: lists are rebuilt from the index on each open and emptied on close or lock.

## Trash Undo, PDF pinch zoom, PDF viewer switch (Decision 148)
- `app.js`: module-level `pendingPurge` and `flushPurge()` hold the one delayed permanent delete; `lockVault()` flushes a Vault one. Restore Undo re-trashes with `softDelete` then writes back the original `deleted_at`.
- `pdfmath.js`: `pinchZoom`, `ZOOM_MAX`; `nextZoom` steps from any value.
- `pdfviewer.js`: touch handlers on the scroller (`touch-action: pan-x pan-y`); a transform during the pinch, `setZoom(next, anchor)` on release.
- Setting `pdf_inapp_viewer` (`on` or `off`) in `meta`, listed in `APP_SETTINGS_KEYS` in `backup.js`. `openEntry` reads it for every PDF: `on` goes to `openPdf`, `off` to `openFile`.
- `index.html`: `#pdf-inapp-wrap` and `#vault-pdf-inapp-wrap` at the top of the Home and Vault folder views, shown for the PDF folder only.

## In-app text and choice sheets (Decision 149)
- `app.js`: `askText({ title, text, initial, password, decimal, ok, cancel, isVault })` and `askYesNo({ ..., explicitNo })`, both module-level with `activeText` / `activeYesNo`. `backAction()` checks them first; `dismissOverlays()` closes them on a lock (`askText` honours `isVault`).
- `index.html`: `#text-dialog` (`#text-title`, `#text-text`, `#text-input`, `#text-ok-btn`, `#text-cancel-btn`), `#yesno-dialog`; both `modal-overlay`, z-index 12.
- Callers: Drive passkey (text), legacy expense edit (text), Drive restore mode (`explicitNo`), Delete permanently, Select delete, Clear older than 30 days (Yes/No). Credential failures use `toast()`.

## Storage checks and sizes (Decision 150)
- `backup.js` `getStorageEstimate()`: `Device.getInfo().realDiskFree` (bytes free on the data partition); `null` when unavailable, and callers do not block on `null`.
- Backup: `estimateBackupSize` before building, then the encrypted archive's real size before `Filesystem.writeFile`. Restore: `estimateRestoreSize` = file bytes + each database row's JSON size.
- `fileactions.js` `rowExtraBytes(row)`: description, `money_json`, `expense_category`, coordinates (16 B), `amount` (8 B). Added to every entry size in `getSelectableEntries`, so Storage breakdown, Select files and Your Data agree.
- Your Data (`yourDataSummary`): count of Home entries and the sum of their sizes. No WebView storage API is read.

## Vault index updates (Decision 151)
- `vault.js` `refreshVaultIndexEntries(db, key, ids)`: for each id, reads the row (`rowid AS rid, *`); a live Vault row is upserted through `indexEntryFromRow`, anything else is removed from the cache. Cache order follows `rid`.
- Callers (`app.js`): `captureToVault`, `restoreEntry`, `permanentlyDelete`, `deleteVaultEntry`, `runBulkFileAction` (delete), `offerUndo`, Vault Trash Undo, and the text, Money and repayment edit paths.
- Full `buildVaultIndex` (with `migrateVaultLabels`): unlock, backup restore, `arkly-reminders-changed`.
- The cache is cleared on lock and stored as encrypted blobs (Decision 253); backup, restore and credentials are untouched.

## PDF reading tools (Decision 153)
- `pdfsearch.js`: no DOM, no pdf.js. `pageItems` keeps the items that carry a string, in the order pdf.js's `TextLayer` lays out its elements, so an item index is an index into `textDivs`. `findInItems` joins items (a line end counts as a space, whitespace collapsed) and returns item index ranges per match.
- `pdfviewer.js`: `drawText` adds the layer after each canvas draw; `search` fills `hits` and `hitsByPage`; `applyHits` marks spans when a layer is drawn; the page text cache is cleared by `clearSearch` and `destroy`. `getOutline` resolves named and direct destinations to page numbers. `attachThumbnails` draws and releases thumbnails with an `IntersectionObserver` rooted in the panel body.
- `pdftools.js`: mounted by `openPdf` after the document opens; `closeTop()` backs the viewer's `guard`; `destroy()` runs from `onClose`, which also covers a Vault lock.

## Update check, public repo (Decisions 164, 214)
- Tap only. One unauthenticated `GET api.github.com/repos/<repo>/releases`; newest release by CI run number. No token, no stored credential. A 403 or 429 reads as the hourly limit (60 per address).
- Download: the asset's `browser_download_url`, natively into `cache/update/` with no header, then the system installer. Needs `REQUEST_INSTALL_PACKAGES`.
- A token saved by an earlier build (`meta.update_token`) is deleted at start-up.

## Name and identifiers (Decision 165)
- The app is Arkly. Pre-rename identifiers kept: package id `com.dumpzone.app`, keystore alias `dumpzone`, database file `dumpzone.db`, channel ids `dumpzone_reminders*`, biometric entry names `dumpzone.app-password` and `dumpzone.vault-pin`.
- CI (`build-android.yml`) does not run for pushes that change only `docs/**`, `**/*.md` or `android-notes/**`.

## PDF mark-up (Decision 166)
- `src/js/pdfmark-ui.js` (screen, loaded after the viewer) and `src/js/pdfmark.js` (export on `pdf-lib`, loaded when Mark up is tapped). Shared constants in `pdfmarkconst.js`. The viewer exposes `pageEls()` only.
- Marks: `{ page, kind, ... }` in fractions of the displayed page, origin top-left. Layers sit over each page box, redrawn from the mark list at the page's current size.
- Export maps displayed fractions to PDF space with rotation and crop box (`toPdf`), draws into the page content, fills form fields through the form API. Password-protected files are refused before mark-up opens.
- Save goes through `captureFile` (Home) or `captureToVault`; Replace writes first, then `permanentlyDelete`.
- Bytes are read again when mark-up starts (pdf.js consumes the viewer's copy) and dropped when it ends.
- Picture mark (Decision 169): `{ page, kind: 'sign', x, y, w, ratio, png, url }`. `buildPicture` (in `pdfmark-ui.js`) converts the picked file to PNG on a canvas, with optional clearing of light pixels; `pdfmark.js` embeds each distinct `png` once and draws it with the page rotation. The picker is `pickImage` in the mark-up context in `app.js`, launched after `beginPickerLaunch()`.

## PDF page tools (Decision 167)
- `src/js/pdfpages-ui.js` (editor screen, loaded after the mark-up) and `src/js/pdfpages.js` (pure: bytes in, bytes out, loaded when Edit pages is tapped). Styles in `src/css/pdfpages.css`.
- The edit is a list `{ src, turn }` in output order; a page left out is deleted. `applyPagePlan` copies the listed pages into a new document and adds the turns to each page's angle.
- Thumbnails come from the viewer's `attachThumbnails`; the cards take the thumbnail buttons over, so drawing and release stay with the viewer.
- Also in `pdfpages.js`: `parseRanges`, `splitPdf`, `mergePdfs`, `imagesToPdf` (JPEG and PNG, one A4-fit page per image). `mergePdfs` and `imagesToPdf` take items as bytes or as functions that return them, and a failure carries `index`.
- Save goes through `saveMarkedPdf` with a label suffix and never replaces. Bytes are read again for each save.

### Merge PDFs and Make a PDF (Decision 168)
- Button `sel-pdf` in the selection bar; `runMakePdf` in `app.js` (inside `wireSelection`) reads the selected rows (Home: database rows; Vault: the unlocked index) and requires all PDFs or all pictures.
- `src/js/pdfcompose-ui.js`: `askCompose` (order sheet, routed through `activeCompose` so Back and locks close it) and `toJpegBytes` (canvas conversion).
- Sources are read one at a time through `readStoredBytes` (Home) or `loadVaultEntryContent` (Vault). `saveComposedPdf` writes the output through `captureFile` or `captureToVault`.

### Weak-secret warning (Decision 170)
- `src/js/passcheck.js` returns a message for a weak secret (shorter than 6 for a Vault PIN, 8 for the app-open password, 10 for a backup passkey, or one repeated character) and null otherwise. `confirmStrength` in `app.js` shows it in the yes/no dialog and resolves true to go on.
- Called where a secret is set: first-run setup, Vault PIN setup, Backup now, the auto-backup banner, Drive Backup now. Advisory only; no credential is stored or compared.

### Backup key derivation (Decision 171)
- `BACKUP_KDF_ITERATIONS` (600000) in `crypto.js` is the count for every newly written backup; it is written in the backup's header (`kdfIterations`) and restore derives with the header's count, so earlier backups (300000) still open.
- The Vault PIN wraps the Vault key at `VAULT_WRAP_ITERATIONS` (600000), stored in the wrapper; a lower-count wrapper is re-made after a correct unlock (Decision 195). The app-open password hash is versioned (Decision 172).

### Overwrite restore, wipe step
- `wipeCategories` reads each entry once and removes it when it belongs to any selected category, reporting `{ done, total }` per entry; the status line shows "Replacing current data, n of m…". Entries in the trash are not touched, as before.

### Credential hash counts (Decision 172)
- `hashPassword` uses 600000 PBKDF2 iterations (SHA-256) for new hashes and returns the count; it is stored in `credentials.app_password_iter`. NULL means 210000. The Vault PIN no longer has a hash (Decision 195); `private_pin_hash`, `private_pin_salt` and `private_pin_iter` are no longer written.
- `verifyPassword` reads the stored count. After a correct app-open password, `upgradeCredentialHash` replaces a lower-count hash with the same salt, only if the stored hash is unchanged since it was verified. Failure is silent and retried at the next unlock.
- Hashes and counts are not in any backup. The wrapped Vault key is (stage L of Decision 195).

## Autosave (Decisions 177, 179, 180, 189, 190)
- Text editors keep their text in `meta` while open and when closed with unsaved changes (not on Yes at Discard): `note_draft`, `note_edit_draft` (Home), `vault_note_draft`, `vault_edit_draft` (encrypted under the Vault key). Not in backups.
- Committed at the next unlock (Home) and next Vault unlock (Vault): new text becomes `Autosave YYYY-MM-DD HH:MM`; an edit is written onto its entry; a missing entry keeps the text as an Autosave note.
- Voice (Decisions 179, 180): a take lost to a lock or background is saved as an Autosave entry; Home can keep recording behind a lock.
- Reminder, Location, Money, new entries (Decision 189): `formDraft` (`app.js`) keeps each open dialog's raw fields in `form_draft_<kind>` (Home) or `vault_form_draft_<kind>` (Vault, encrypted under the Vault key). Written only when a field differs from the first state, half a second after a change, on hide, and by `dismissOverlays` just before a lock closes the dialogs. Not in backups.
- Committed after the text drafts at the same unlocks through `resolveFormDraft` (`autosave.js`): a complete form becomes its entry, an incomplete one a Text entry `Autosave YYYY-MM-DD HH:MM` listing the filled-in fields. A committed reminder is not scheduled.
- After an unlock that committed any draft, `arkly-drafts-committed` redraws the Home and Vault lists (Decision 191).
- Edits of Reminder, Location details and Money (Decision 190): the same draft session with the entry's id and name, in `form_edit_draft_<kind>` / `vault_form_edit_draft_<kind>`. The commit writes a complete form onto the entry through `editEntry` (`applyEditDraft`; a reminder is then scheduled, or cancelled when its time has passed, in a separate step whose failure is reported, not retried), else keeps the work as an Autosave Text entry naming the entry. Voice, Image, PDF and Files details are not covered.

## Move between Home and Vault (Decisions 181, 182)
- Steps 1 to 3 support Text, Location, Money, Reminder, Voice, Image, PDF and Files, through `move.js`. Legacy expense rows show no Move button.
- Home to Vault: content is encrypted under the Vault key (`saveVaultEntry`), the label and note in their encrypted columns, `latitude`, `longitude` and `money_json` empty. Vault to Home: decrypted into the plain columns and the search row.
- Name, up to two tags, note and the created and updated times are carried. The copy is read back and compared before the original is deleted permanently (no Trash, no Undo); a failure removes the copy.
- Home to Vault lowers the name's `label_history` count; Home search loses the entry with the original.
- Needs the Vault unlocked in both directions. Move to Vault with the Vault locked asks for the Move confirmation first (it says the Vault is locked), then unlocks in place (`unlockVaultInPlace`: biometric when enabled, then a PIN sheet) and carries on; the page and selection stay (Decisions 186, 188).
- Reminder: schedule, repeat, snooze and done state move with it. `rescheduleMovedReminder` (`app.js`) cancels the old id's notifications and schedules the new entry's, with the text its side shows (Decision 183).
- Files: Home to Vault reads the file whole into the encrypted body; Vault to Home writes it through the per-file store. No size cap (Decision 184); copy first, compare, then delete, so running out of memory leaves the original.
- Selection: the Select files bar moves the selected items one at a time through the same two functions; per-item failures are reported, not fatal (Decision 185).
- Backup format unchanged.

## Changing secrets (Decisions 201, 204)
- Settings, App lock: Set, Change, Remove password. Vault Settings: Change Vault PIN. The Vault PIN is first set in the Vault tab and cannot be removed.
- Each action is one window (`openSecretForm`): Current secret (not for Set), New, Repeat new, Hint (optional), Submit. Errors show in the window. Fingerprint is a button the person taps, offered only when that unlock is on; it hides the current field and never runs by itself. Back and every lock close the window and clear it.
- App password: updates the hash row; clears the fingerprint copy; the idle timer and Lock button follow. Vault PIN: the Vault key is unwrapped (current PIN) or read from the fingerprint copy, re-wrapped under the new PIN; `vault_wrap` is replaced only if unchanged since it was read; no item is re-encrypted; the fingerprint copy is cleared. Older backups keep the PIN they were made with.
- The backup passkey is not involved.
- Every fingerprint prompt is wrapped by `biometric.js`, which reports `biometricPromptBusy()` while one is open and for 1.5 seconds after; the background-lock handler ignores a pause in that window, because the prompt is its own Activity (Decision 210).
- The lock screen fingerprint button is re-derived (`syncLockBiometric`) after every enable and disable, so a cleared copy never leaves a button (Decision 203).
- Returning to the front with the lock screen showing re-derives the button and opens the fingerprint prompt (`offerLockBiometric`); a busy flag and a short cooldown stop the prompt's own pause and resume from reopening it (Decision 205).
- Lock screen and Back (Decision 215): Back does nothing while the lock screen is showing (the Android Back button then sends the app to the background), and showing the lock screen resets the recorded location. Before, a Back from the lock screen ran the Settings or Vault back action and reached Home without a password.
- Vault fingerprint (Decision 215): one attempt at a time, shared by the button, the Vault tab, the resume handler and the move sheet (`singleFlight`, 2 s quiet period after it ends). The plugin read has three outcomes: declined (cancelled or not recognised; setting kept), unreadable (fingerprint accepted but the stored copy cannot be read after one retry; the setting is cleared, Decision 217) and a stored copy that no longer matches the wrapper or password (cleared). Each shows its own message. An app lock that came while the Vault was on view returns to the Vault gate after the unlock (Decision 216). The plugin's `deleteCredentials` clears every saved credential, so it is never used: a fingerprint is turned off by overwriting its copy with a marker, and the app and Vault copies are independent (Decision 217). Any app lock also locks the Vault. The app-open lock follows the same rules.

## Backup access gate (Decisions 202, 204)
- Before Back up now and Back up to Drive: one window with App lock password if one is set and Vault PIN if the Vault is set up and included, one Submit; or the fingerprint button, when offered, which covers both. Then the backup passkey as before.
- A gate on the in-app action, not a key. The archive is still encrypted under the backup passkey only. No credential is changed, stored or recovered.
- Not gated: restore, safety backup, automatic backup, extract to device storage. Typed attempts have no counter or delay.

## Card grids and File explorer (Decisions 206, 207, 211, 213, 219, 220, 221, 222, 226, 227, 228, 229, 230, 231, 232)
- Home (`#capture-bar`) and Vault (`#vault-capture-bar`): nine cards, three per row, icon above label. The first eight open folders through `data-type` and `data-vault-type`. The ninth, File explorer, carries `data-tool` and `data-vault-tool`, so counts, folders, the New chooser, search and Move never see it.
- Both explorer cards open the same overlay, `#explorer-screen` (`src/js/explorer.js`), tracked as `activeExplorer { finish, back, isVault }`: Back steps up a folder, then to the storage list, then closes; an app lock closes it from either card, a Vault lock closes the one opened from the Vault; closing drops the listing.
- It lists the phone's own storage and nothing else: no encryption, no copy, no database table. Folder listing: the filesystem plugin on a percent-encoded `file://` path. Native side (`window.ArklyExplorer`, written into `MainActivity` by `scripts/patch-explorer.js` in CI): All files access check and request, and the mounted volumes with free space and a USB flag.
- Access: `MANAGE_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` from `patch-manifest.js`; granted once on an Android settings screen. The screen sets the picker flag (Decision 73) before leaving for that screen or another app, so the lock on background does not fire for that trip.
- Viewers (Decision 211): `#explorer-viewer`, a layer inside the screen, driven by `src/js/explorer-view.js`. Text view and edit (Save writes the same file), image, PDF (reading tools only), audio and video. Files are read in place: images and media through the local file route, text through the filesystem plugin, PDFs fetched whole. No copy, no database row, no draft. `activeExplorer.back()` hands Back to the viewer first; `finish()` destroys it, so a lock closes both.
- Manage (Decisions 213, 219): `src/js/explorer-manage.js`, pure logic over the filesystem plugin through an adapter in `explorer.js`. A long press selects; the selection header offers select all, rename, properties and delete; the main header carries New folder and Trash. Names: no `/`, `\` or NUL, not `.` or `..`, at most 255 bytes; a clash is any other entry equal ignoring case. A change of letter case only goes through a temporary name. The plugin's `mkdir` rejects an existing folder even when recursive, so the adapter treats that case as success (Decision 223).
- Trash: one `.arkly-trash` folder at the root of each storage, shared by both cards, not encrypted. Delete is a rename on the same storage. An item is a random 12-hex id with a `<id>.json` record (name, original path, folder flag, size, deleted time) written first and removed if the rename fails; `.nomedia` keeps trashed pictures out of the gallery. Restore: original place (made again if missing; a taken name gets a number; a record pointing into the trash or off the storage restores to the storage root). Items past 30 days are removed once per open of the screen. The trash folder cannot be deleted or renamed from the explorer.
- Archives (Decisions 220, 221): `src/js/explorer-archive.js` on the page; native `window.ArklyArchive` (`scripts/java/ArklyArchiveBridge.java`, written and registered by `scripts/patch-archive.js` in CI, which also adds commons-compress, xz, zip4j and junrar to `build.gradle`). Tapping an archive reads its entry list once (`openArchive`, polled with `browseStatus`); the page asks `children(id, folder)` for one folder at a time and shows it like a folder (view `archive`). A file inside is extracted alone into the app's cache (`startEntry`) and opened read-only in the built-in viewers; the cache is emptied when the archive closes, when the screen closes or locks, and at app start. Extract all and Extract selected (`start`, `startSelected`) poll `status(id)`; one job at a time, on a background thread, streamed; the target is a new folder beside the archive. A name outside the target (absolute, `..`) and every tar link are skipped and counted; a failed or cancelled run deletes the new folder. A password is asked only when needed and kept in memory only while the archive is open. An archive is read-only. RAR 5 is not supported.
- Copy, move and share (Decision 222): a second selection row (Copy, Move, Share). The destination picker lists folders, then files (greyed, for reference), from the current folder, marks items that share a name with one being copied or moved and the name the new one would get, has Cancel at every level (Decision 224), and disables the button with the reason when the destination is inside a selected folder, is the trash, or is where a move's items already are. Native `window.ArklyFileOps` (`scripts/java/ArklyFileOpsBridge.java`, written and registered by `scripts/patch-fileops.js` in CI): `start(op, destDir, paths)`, `status(id)`, `cancel(id)`, `release(id)`; one job at a time, streamed. By default nothing is overwritten (a taken name gets a number). After Copy here or Move here the page compares the destination with the items: free names go through at once, and for taken names a Name clashes list offers Replace, Skip or Rename per item and for all (Decision 225); `startWith(op, dest, paths, policy)` runs one item at a time with policy rename or replace. Replace is file over file only: the new file is made whole under a temporary name, then the old one is removed and the temporary one renamed; it is permanent and does not use the explorer trash. A move on one storage is a rename; otherwise copy, then remove the original once the copy is whole. A failed or cancelled item leaves no half copy; finished items stay. Links are skipped. Free space is checked before and during. Share (files only, up to 100) uses the share plugin with file URIs.
- Office viewers (Decision 226): docx, xlsx and pptx, view only, through the same viewer layer. `src/js/office-read.js` unpacks with `fflate` (only the needed parts, size limits) and reads the XML with the WebView's parser into plain data; `src/js/office-render.js` draws it with text nodes only, never markup from the file, and revokes picture object URLs on change and close. Both load on first use. Each viewer opens under a bar with the theme switch (Auto, Light, Dark; one setting for the three, kept through the preferences plugin, Decision 227); the viewer's `data-theme` drives its colours, and colours from a file are set for both themes when drawn. docx keeps fonts, colours, spacing, tables, list markers, pictures, header, footer and footnotes, in a Page view (page width and margins as set, scaled to fit, pinch and +/− zoom) or a Reflow view. xlsx keeps cell fonts, fills, borders, alignment, number formats, column widths, row heights, merges and frozen panes, drawn as a fixed table with one style rule per cell style and the same zoom (Decision 228); overflowing text gets the columns it needs and any cell can be tapped to read all of it in a bar (Decision 229); pptx slides are resolved to positioned items (placeholders, masters, themes, backgrounds) and drawn on a canvas at the slide size, scaled to fit, with Previous, Next, swipe and zoom; the slide keeps its own colours in both themes (Decision 230). Fonts named Calibri, Arial and Times New Roman are drawn with bundled open stand-ins of the same metrics (Carlito, Arimo, Tinos; `src/fonts`, declared in `style.css`, Decision 231); ten more open families cover other common names, any other name falls back to a bundled font of the same kind, a notice lists fonts the phone lacks, and fonts embedded in a Word file are loaded for that viewer only (Decision 232). docx is one scrolling page; xlsx a tab per visible sheet, stored values only, first 5,000 rows and 200 columns; pptx one slide at a time with notes. Up to 50 MB, read whole, nothing saved.
- Office charts, diagrams and slide controls (Decision 233): `office-read.js` `readChart` turns a chart part (Word, Excel or slide) into a plain model from the values cached in the file; `office-chart.js` draws it as SVG with text in currentColor. Excel charts and pictures are placed over the cells they were anchored to; a slide diagram is drawn from the ready drawing the file keeps beside its data. The slide viewer is centred and fitted whole; Play puts `eo-playing` on the viewer host, which goes full screen with a blurred layer behind the slide and buttons. No network, no stored data; the play timer does not count as activity for the auto-lock.
- Office viewer tools (Decision 234): Find, Copy and Info are built once in `office-render.js` (`buildTools`) and fed by a small per-kind object: Word searches the rendered text, Excel searches every sheet's cells and jumps to the match, slides search every slide's text and change slide. Highlights are `<mark>` elements around text the viewer itself rendered; nothing in the file is changed. The clipboard is written only on the Copy tap.
- Office viewer shell (Decision 235): while an office file is open, `explorer-view.js` sets `ev-full` on the viewer and on `body` (floating Back bar hidden, no reserved space), adds the three-dot button that toggles `eo-menu-open` on the host (the toolbar is then a panel), and folds the title bar when `office-render.js` reports a scroll direction (`onChrome`). Open with calls `openExternal(file, true)`, which asks the file opener for a chooser. Read only: no write path exists in the office viewers. PDF uses the same shell (Decision 236): `pdf-full` on the viewer body turns the floating find, pages and zoom buttons into the menu (`pdf-menu-open`). The title bar floats over the body; folding changes the body margin once and slides the body with a transform that is cleared afterwards. Scroll direction logic is in `chrome-scroll.js`. The Explorer PDF mounts the same Mark up and Edit pages tools as the entry viewer (Decision 237); its save route writes a new file next to the original through the filesystem plugin (`copyName`, never over an existing file), or over the original on Replace. The slim title bar rules are under `#explorer-viewer.ev-full`. The PDF menu row ends with an Open with button (Decision 238) that calls the same chooser as the title bar share button.
- Outline and slide thumbnails (Decision 240): `buildTools` adds a third button after Info when a kind supplies `outline` ({ label, title, strip?, fill(panel, close), release() }) and owns the panel under the find row. Word supplies the top-level heading elements collected by `docxBlocks` (`ctx.heads`); rows scroll to them. Slides draw each thumbnail lazily (IntersectionObserver) with `slideDom` scaled to 132 px and a separate `urls()` set, revoked in `release()`. Excel supplies none. The panel is hidden while Play runs.
- Word floating objects (Decision 250): `readDocx` turns an anchored picture, shape or text box into a `{ float }` run; `appendRuns` calls `floatNode`, which draws the item through `slideItem` (shared with the slide drawing). Overlay floats are absolutely placed in their paragraph (`.eo-p` is positioned); wrapped floats use CSS float; page- and margin-relative tops are set by `placeFloats` after a sheet is filled. Groups (one level), free-form outlines (`custGeom` as SVG) and a paragraph-relative left for overlay floats follow Decision 252. Not drawn: nested groups, gradients, shadows.
- Word equations (Decision 251): `readDocx` turns `m:oMath` and `m:oMathPara` into `{ math, disp }` runs holding a small tree (`office-read.js` `readMath`, capped at 600 nodes and 24 levels). `office-render.js` `mathNode` draws it with spans and CSS (`.eo-m*`), SVG only for stretched delimiters and the radical sign; text is set with `textContent`. The root holds `data-lin`, a linear text form: Copy and Info swap the drawing for it while reading. A math run has no `text`, so page slicing treats it like a picture, and the measuring walker skips `.eo-math` text so cut offsets match the model.

## Password show/hide (Decision 200)
- `src/js/passeye.js` wraps every `input[type=password]` in `.pw-field` with an eye button; `initPasswordEyes()` runs at start and observes later additions. The lock screen input carries `data-no-eye`.
- Revealing switches the input to `type=text`; a wrapped input is found by `input[data-pw]`. `clearSecretInputs` covers both types.
- Hidden again on lock, unlock, text sheet close and when the app leaves the foreground.
- The shared text sheet calls `setPasswordField(input, isPassword)`; the eye shows only while it asks for a secret.
- Display only: no credential, key or backup path is touched.

## Persisted Vault index (Decision 253)
- Two `meta` rows, each AES-GCM under the Vault key: `vault_index_blob` (live entries: fingerprint, label, description, size, Money and Location details; trashed entries: fingerprint, label) and `vault_text_blob` (note text, file OCR text). Not in `APP_SETTINGS_KEYS`: never in a backup.
- Fingerprint: last 20 characters of each stored encrypted field of a row (they hold the random IV). `vault.js` makes it in SQL (`FP_SQL`, light read, no bodies) and in JS (`rowFp`, `labelFp`); keep them equal.
- `buildVaultIndex`: light rows + tags + blob; matching fingerprint -> entry from the blob; else rebuilt from the row (`indexEntryFromRow`). Schedule columns and tags always from the rows. Unreadable or missing blob -> full rebuild.
- Writes: debounced, serialised (`writeBlob`), flushed at `clearVaultIndex()` before the key is dropped. Failure ignored.
- `searchVaultIndex(term)`: sync; label, then tag and extension, then description and Money or Location details; accents folded. `searchVaultBodies(db, key, term, exclude)`: lazy, loads `vaultTexts` once per unlock.
- Entries carry no note text; the note editor reads it from the row (`vaultNoteText` in `app.js`). `vaultTrashLabel` serves Vault Trash labels from the stored index.
- Thumbnails (Decision 254): Vault images only, `vthumbs/<sha256(id)>`, `{ p: file_path, d: data URL }` under the Vault key; read by `getVaultThumb`, made on first view by `app.js` `thumbFor`, written by `putVaultThumb`; stale when `p` differs from the row. `sweepVaultThumbs` runs after the index build at unlock and removes files no Vault image row maps to. Not in backups; `files/` orphan sweep does not look in `vthumbs/`. Home thumbnails stay memory only.
- Field binding (Decision 257): each Vault field (`label`, `desc`, `body`, `meta`) is encrypted with `id|field` as AES-GCM additional data, stored `{"v":2,"cipher","iv"}` (mark first, IV last). The two index blobs use `blob|<meta key>`. `encryptPrivateNote(key, text, aad)` and `decryptPrivateNote(key, blob, aad)` in `crypto.js`; a marked blob needs its `aad`, an unmarked one opens without it. Every write binds; `upgradeRow` binds unmarked fields, run once for all rows at the first unlock after the update (`vault_bound_v2` in `meta`, not in a backup).
- Restore (`insertRestoredEntry`): rekey opens each field with the source key and binds it to the stored id; same key and a new id re-binds marked fields; an unmarked field under the same key is kept and `vault_bound_v2` is cleared.
- Not bound: thumbnails, wrapped file keys, stored Vault settings. A file entry's body from before Decision 212 is bound when the entry is edited.
