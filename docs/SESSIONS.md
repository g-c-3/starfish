# Sessions

Most recent first. Numbered, no dates (see TRACK.md).

---

**Session 151**

Start: "Go". Tier 1 docs read; Decisions 195, 255 read; ARCHITECTURE section 3c read; `crypto.js`, `vault.js`, `vaultrestore.js` read. Tasks in order: timings; field binding; committed lockfile (DP111, DP112, DP113 confirmed on device); Phase 10 R8 (DP114 confirmed on device: app fast); Phase 10 signature check.
- Timings (Decision 256): Node harness, real crypto, in-memory SQLite with the real schema, `vault.js` unchanged. Mix of 60% notes, 20% Money, 20% Images on disk.
  - 0 items: cold 0.6 ms, warm 0.4 ms.
  - 500 items: cold 77 ms, warm 6 ms, name search 0.2 ms each, single refresh 0.7 ms.
  - 5000 items: cold 633 ms, warm 72 ms, name search 1.1 ms each, single refresh 0.2 ms.
  - Rebuilding 16 entries at a time: 539 ms at 5000 items. Not kept.
- Field binding (Decision 257):
  - `crypto.js`: `fieldAad`, `isBoundField`; `encryptPrivateNote` and `decryptPrivateNote` take optional additional data; bound blobs carry `v: 2` first.
  - `vault.js`: every entry field and both index blobs bound; `saveVaultEntry` picks the id first; `upgradeRow` and a forced pass at the first unlock (`vault_bound_v2`), trashed rows included.
  - `backup.js` (`insertRestoredEntry`): re-binds on rekey and on a new id; an unmarked field under the same key is kept and the flag cleared.
  - `fileactions.js`, `move.js`: edit, label, description and move reads pass the id.
- Not bound: thumbnails, wrapped file keys, stored Vault settings.
- Lockfile (Decision 258): `package-lock.json` generated, clean `npm ci` and `vite build` pass; `build-android.yml` runs `npm ci`.
- Phase 10, first part (Decisions 259, 260): `scripts/patch-r8.js` and a workflow step turn on R8 with keep rules; JS obfuscation not applied (public source). Signature check built (Decision 261): native bridge, fingerprint read from the keystore in CI, notice on mismatch, never blocks. Map view dropped (Decision 262).

Decisions made: 256, 257, 258, 259, 260, 261, 262.

Verified: 33 Node checks (see Decision 257); benchmark at 500 and 5000 items after the change (warm unchanged, forced pass 0.24 s and 1.8 s in Node); `vite build` passes. Verified: bridge compiled and run against Android class stubs; patch script on a generated project; keytool extraction against the certificate's SHA-256; `vite build`. Not verified: CI and a phone for the signature check (DP115), restore through the whole engine, a Vault file entry from before Decision 212.

Open: DP115; Phase 9 expense charts and quick-capture widget; Phase 21 P4 (needs the intended behaviour); light-theme tuning (needs screens); Autosave of Voice, Image, PDF and Files Edit details (needs approval); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP115 result, then Phase 9 expense charts; fresh session with "Go".

---

**Session 150**

Start: "Go". Tier 1 docs read; Decisions 195 and 254 read; ARCHITECTURE sections 3, 3b, 3c and 4 read. Owner-approved task: Phase 17 stage O.
- Found: `handleLocalRestore` passed no `sourcePin` and no `currentPrivateKey` to the engine, and Overwrite never replaced the wrapper. Vault entries made under another Vault key were inserted and could not be opened. `insertRestoredEntry` also unwrapped the source key once per entry (one PBKDF2 each).
- `src/js/vaultrestore.js` (new): `planVaultRestore` (none, same, rekey, replace, or a reason), `applyVaultPlan` (wrapper replaced on Overwrite).
- `src/js/backup.js`: both formats run the plan once the passkey opens the archive and before any change; the source key is opened once; Vault file keys and entry fields use it; Overwrite replaces the wrapper after the wipe.
- `src/js/app.js`: `restoreWithSourcePin` (unlock, then the PIN of the backup checked in the window, then one restore); cancel message; Overwrite under another key locks the Vault and turns the fingerprint copy off; status line names the PIN change.
- ARCHITECTURE.md: §3 restore prompts, §3c table row O, §4 Vault section rewritten. ROADMAP.md: O row, DP110. DECISIONS.md: Decision 255. TRACK.md: row.

Decisions made: 255.

Verified: 18 Node checks on `planVaultRestore` and the re-key round trip, real crypto, stubbed database. `vite build` passes. Not verified: CI, a Vault file restored with a re-wrapped key, format 1 path, a restore stopped part-way.

Open: O field encryption bound to entry id and field name (needs its own plan and approval); N timings at 0, 500 and 5000 items; lockfile proposal for the Decision 249 pin (needs approval); Phase 21 P4 (needs approval); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details. Earlier Vault restore checks (DP71 item on another PIN, DP82 item 7) are re-covered by DP110, since the screen had no PIN window before this session.

DP110 confirmed on the owner's phone, all checks. Field-binding plan drafted (version marker, legacy fields read without binding, upgrade one entry at a time, every id-changing path re-encrypts); awaiting approval.

Next session start point: approval of the O field-binding plan, then build; fresh session with "Go".

---

**Session 149**

Start: "Go". Tier 1 docs read; Decisions 144, 151, 156 to 158, 195, 196, 212 and 251, 252 read; ARCHITECTURE sections 3b, 3c and headings read. Owner approved Phase 17 stage N.
- `src/js/vault.js`: persisted index and text blobs (`readBlob`, `writeBlob`, fingerprints in SQL and JS), `buildVaultIndex` from the light rows and the stored index, per-entry rebuild when a fingerprint differs, name search with ranking and accent folding, lazy `searchVaultBodies`, `vaultTrashLabel`, flush at lock. Entries no longer carry `searchableText`.
- `src/js/app.js`: Vault search draws name matches then appends body matches; Vault Trash labels from `vaultTrashLabel`; note editor reads a Vault note's text from its row (`vaultNoteText`); unused import removed.
- ARCHITECTURE.md: Vault section 3b point 2 changed, table row N, new section. ROADMAP.md: N row, DP108 added. DECISIONS.md: Decision 253.
- Second part, same session: encrypted Vault thumbnails. `src/js/files.js`: `writeText`, `readText`, `removePath`, `listPaths`. `src/js/vault.js`: `getVaultThumb`, `putVaultThumb`, `sweepVaultThumbs`, `filePath` on entries. `src/js/app.js`: `thumbFor` reads and writes the stored thumbnail for Vault images; sweep after unlock. DP109 added.
- Decisions 253, 254.

Decisions made: 253, 254.

Verified: 36 Node checks (schema taken from `db.js`, real encryption, stubbed file storage): cached unlock reads no entry and decrypts only the blob; a re-encrypted entry is the only one rebuilt; schedule change read from the row; ranked, accent-folded name search; body search from the blob on a second unlock; trash, restore and delete; trashed label with no decryption; change flushed at lock; wrong key and damaged blob; bulk rebuild with progress; blobs hold no plaintext. `vite build` passes. Thumbnails: 12 Node checks (see Decision 254). Not verified: CI, device (DP108, DP109), timings at 0, 500 and 5000 items, a Vault restore with the new blobs present.

Open: N field binding; O; lockfile proposal for the Decision 249 pin (needs approval); Phase 21 P4 (needs approval); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details; DP107 item 5.

Owner approved Phase 17 O, Session 149. CI green; DP107 item 5, DP108 and DP109 confirmed on the owner's phone. Next session start point: Phase 17 O (approved); fresh session with "Go".

---

**Session 148**

Start: Tier 1 docs read; Decisions 241 to 250 read, ARCHITECTURE section headings. Next item: E3d equations.
- `src/js/office-read.js`: `readMath` reads Office Math into a tree; `oMath` and `oMathPara` become `{ math, disp }` runs.
- `src/js/office-render.js`: `mathNode` draws the tree; `appendRuns` calls it; Copy and Info read the linear form; the measuring walker skips equation text.
- `src/css/style.css`: `.eo-m*` rules.
- ARCHITECTURE.md: one bullet. ROADMAP.md: equations row, DP107 added.
- Decision 251.
- Bugs fixed (Decision 252), with the owner's file: table frame drawn as a solid black box (groups read as their first shape; free-form outlines drawn as rectangles); picture drawn 400 px right of its place (page-relative left measured from the column, not the indented paragraph).

Decisions made: 251, 252.

Verified: read check on a generated Word file (inline and display, fraction, power, sum with limits, radical, matrix, delimiters, function); draw check on a sample tree (3 stretched SVG parts, italic and operator classes, linear text `x=(-b)/(2a)x^2(a/b)∑_(i=1)^n i√(y)[1, 2; 3, 4]sin θ`); `vite build` passes. Bug 252 reproduced on the owner's file by reading it (87 floats; no large black fill left) and confirmed on device by screenshot. Equations: owner reported DP107 items 2, 4 and 6 to 9 as passing and item 3 as likely; item 5 (dark theme) not reported. Not verified: layout on a device or in a browser (DP107), CI.

Open: lockfile proposal for the Decision 249 pin (needs approval); Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Start, later in the session: no code written. Phase 5 sound asset found moot (system default sound, Decision 96). Phase 17 stage N sized: the Vault already keeps an in-memory index (stage B); N still needs the persisted encrypted index blob, the body-text blob, encrypted thumbnails and entry-bound field encryption. It rewrites the Vault read and write paths, so it waits for the owner's approval.

Next session start point: CI green; then owner approval for N (or another item of the owner's choice); then "Go".

---

**Session 147**

Start: Tier 1 docs read; Decisions 241 and 249 read, ARCHITECTURE section headings. Release v0.1.0+621 exists after the Decision 249 pin. Next item: E3d stage 3, Word floating objects.
- `src/js/office-read.js`: anchored picture, shape and text-box drawings read as `{ float }` runs (size, rotation, geometry, fill, outline, text paragraphs, position, wrap, behind flag, distances); drawings inside `mc:AlternateContent` are read.
- `src/js/office-render.js`: `slideItem` extracted from `slideDom` and shared; `floatNode` and `placeFloats` draw floats; column width passed to the runs.
- `src/css/style.css`: positioned paragraphs, float wrapper, sheet isolation.
- ARCHITECTURE.md: one bullet. ROADMAP.md: E3d rows, DP105 closed on the roadmap rows, DP106 added.
- Decision 250.

Decisions made: 250.

Second part: owner confirmed CI green. No file with floating objects is available on the device, so DP106 was run as simulated checks: 8 read, 7 drawing in a simulated page, 11 wrap and position arithmetic; the extracted slide drawing is line-for-line the old loop body. DP106 closed on that basis; real layout, zoom and fidelity against Word untested. No file changed.

Verified: 8 read checks on a generated Word file (text box fill, outline, rotation, text, position, wrap; square picture; inline picture unchanged); `vite build` passes. Not verified: rendering in a browser or on a device (DP106), the slide drawing after the `slideItem` extraction (DP106 check 9), CI.

Open: lockfile proposal for the Decision 249 pin (needs approval); E3d equations; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: E3d equations (read Word equation markup, draw it), in a fresh session; or another open item on the owner's word.

---

**Session 146**

Start: Tier 1 docs read; DECISIONS read from Decision 241, ARCHITECTURE section headings. Next item: E3d stage 1, Word pages from saved breaks.
- `src/js/office-read.js`: saved page markers, PAGE, NUMPAGES and SECTIONPAGES fields (complex and simple) read as markers; footnote references flagged; per-section page set-up, start type, numbering, header and footer sets (default, first, even) with inheritance; stored page count from `docProps/app.xml`; table rows flagged where a saved break starts.
- `src/js/office-pages.js` (new): splits blocks into sheets at saved markers, explicit breaks, page-break-before and section breaks; a paragraph is split at a marker; a table splits between rows; page numbers and formats; header and footer pick; returns null when the file holds no break.
- `src/js/office-render.js`: Page view draws sheets with header and footer on each, fields filled, footnotes at the foot of the citing sheet; Reflow unchanged; DOM rebuilt only when the view changes; Info and Copy skip repeated headers.
- `src/css/style.css`: sheet rules.
- Decision 242.

Second part (approved: "Start" with E3m and E3n): `office-pages.js` `paginateAuto` for files with no saved marker (measured breaks); `office-render.js` hidden measuring column and cut at the last fitting line, laid out after the text is shown; font notice close button and fold with the title bar; break notice only when the stored count is above 1 and differs; `office-read.js` reads keep-with-next and keep-lines. Decision 243. 17 simulated-layout checks pass; the DOM measuring was not run against a real layout; `vite build` passes.

Third part: device check showed the 157-page converted file measured to 166 (own hard breaks ignored once stage 2 required saved markers). Fixed: own hard breaks kept unless measuring finds more than 15 percent above them. Decision 244. The marking scheme laid out as four sheets with the estimate notice on device.

Fourth part: the 157-page file now shows 157 pages on device; its load was slow because every page was measured. Decision 245 samples up to 12 pages instead.

Fifth part: sampling alone did not shorten the load on device. The text was drawn once as a flow and again as sheets; a file with its own page breaks now shows its sheets at once and the sample runs afterwards (Decision 246).

Sixth part: still too slow on device. Sheets are now empty shells filled near the screen; Find, Copy, Info and Outline fill all first (Decision 247).

Seventh part: screen recordings read frame by frame: sheets appear as soon as "Loading" ends and scrolling is smooth, so the remaining wait is before the viewer (unzip, parse, read). Reader savings and a temporary timing readout in the Word Info line (Decision 248).

Eighth part: CI log showed the build failing at the install step (an upstream release with a missing dependency); `package.json` pins `@trapezedev/project` at 7.1.10 (Decision 249).

Device timings (Decision 248 readout), 157-page file: unzip 0.2 s, parse 0.6 s, read 1.3 s, pages 0.0 s, 157 sheets drawn in 0.5 s; "Loading" about 2.5 to 3 s. Read is the largest part.

Decisions made: 242, 243, 244, 245, 246, 247, 248, 249.

Device check: a file with saved breaks shows 157 sheets with gaps, header and footer with page number and count on each, a paragraph continued across two sheets, and Reflow and back;  a script-generated file stays one sheet. DP104 closed: count matches Word (157), landscape section, Outline after the switch and footnotes confirmed. E3m and E3n built in the second part.

Verified: 14 checks on generated Word files (mid-paragraph split, marker after an explicit break adds no page, table split, page-break-before, section numbering, field markers, header and footer inheritance, no-marker file); `vite build` passes. Not verified: rendering in a browser or on a device (DP104), CI.

Open: E3d stage 3 (shapes); DP91, DP94, DP95 and DP105 confirmed Session 146; E3o left as is by the owner; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: E3d stage 3 (text boxes, shapes, floating pictures), in a fresh session.

---

**Session 145**

Start: Tier 1 docs read; DECISIONS and ARCHITECTURE read in part (Decision 239, section headings). Next item: E3g, Word headings outline and slide thumbnails. DP102 and DP103 confirmed on device from owner screenshots (outline panel and slide strip both work).
- `src/js/office-render.js`: Outline and Slides button and panel in `buildTools`; heading elements collected by `docxBlocks` for the top-level body; Word outline rows; slide thumbnail strip drawn lazily with its own object URLs, released on close.
- `src/css/style.css`: outline rows, thumbnail strip, hidden while playing.
- Decision 240.
- Owner report: a Word file still shows as one long sheet. Decision 241 records the plan for true pages (saved breaks first, measured breaks as a fallback, shapes after). No code written for it; context was full.

Decisions made: 240, 241.

Verified: 6 simulated-page checks on a generated Word file; `vite build` passes. Not verified: CI. Slide thumbnails were confirmed on a device only. Release status not checked: the GitHub API rate limit was hit.

Open: DP94 and DP95 not yet run; E3d Word pages (Decision 241, not started); Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: E3d stage 1 (saved page breaks, page sheets, header and footer on every page). Source to read first: `office-read.js` (`readDocx`, section properties, header and footer parts), `office-render.js` (`mountDocx`, `docxBlocks`), `style.css` paper rules.

---

**Session 144**

DP101 confirmed on device. Request: Open with as a wide labelled button instead of the share symbol; centre the PDF menu dock.
- `src/js/explorer-view.js`: Open with label.
- `src/css/style.css`: wide button, centred dock.
- Decision 239. Checks as Session 143; `vite build` passes. Not run through CI or on a device (DP102).
- Next: DP102 on device; then thumbnails and Word outline (E3g), then E3d (Word pages and shapes).

---

**Session 143**

DP100 confirmed on device. Request: Open with in the PDF menu, same style as the other buttons.
- `src/js/explorer-view.js`: Open with button, last in the PDF menu.
- Decision 238. Checks: 11 PDF wiring, 17 shell, 21 menu, 22 tool, 36 earlier on generated files; `vite build` passes. Not run through CI or on a device (DP101).
- Next: DP101 on device; then thumbnails and Word outline (E3g), then E3d (Word pages and shapes).

---

**Session 142**

DP99 confirmed on device (smooth fold, PDF menu). Owner report: PDF menu had four buttons, six expected (Mark up and Edit pages were missing); title bar too tall.
- `src/js/explorer-view.js`: Mark up and Edit pages mounted in the Explorer PDF with a save route (new copy next to the file, or Replace); zoom buttons removed (pinch).
- `src/js/explorer.js`: passes the hand-over hook to the viewer.
- `src/css/style.css`: slim title bar.
- Decision 237. Checks: 9 PDF wiring, 17 shell, 21 menu, 22 tool, 36 earlier on generated files; `vite build` passes. Not run through CI or on a device (DP100).
- Next: DP100 on device; then thumbnails and Word outline (E3g), then E3d (Word pages and shapes).

---

**Session 141**

DP98 confirmed on device (Open with works). Owner report: title bar fold is jerky; empty bottom bar and three-dot menu wanted for PDF too.
- `src/js/chrome-scroll.js` (new): shared scroll-direction logic.
- `src/js/explorer-view.js`: title bar floats and the body glides; PDF enters the full-screen shell with its menu; Open with chooser for PDF.
- `src/js/office-render.js`: uses the shared scroll logic.
- `src/css/style.css`: floating title bar, PDF menu panel, PDF bottom space.
- Decision 236. Checks: 17 shell, 21 menu, 22 tool, 36 earlier on generated files; `vite build` passes. Not run through CI or on a device (DP99).
- Next: DP99 on device; then thumbnails and Word outline (E3g), then E3d (Word pages and shapes).

---

**Session 140**

DP97 confirmed on device. Owner report: empty bar at the bottom of all three viewers; toolbar to move into a three-dot menu; title bar to hide while scrolling; Open with list; editing dropped.
- `src/js/explorer-view.js`: three-dot menu button, title bar fold, full-screen flag, Open with chooser for office files.
- `src/js/explorer.js`: `openExternal` takes a chooser flag.
- `src/js/office-render.js`: toolbar becomes the menu panel, Open with entry, scroll-driven title bar callback.
- `src/css/style.css`: full screen, menu panel, folded title bar.
- Decision 235. Checks: 21 shell checks, 22 tool checks and 36 earlier checks on generated files, `vite build` passes. Not run through CI or on a device (DP98).
- Next: DP98 on device; then thumbnails and Word outline (E3g), then E3d (Word pages and shapes).

---

**Session 139**

DP93 and DP96 confirmed on device (owner report: everything worked). Request: add all tools that can and should be added for the three kinds. Editing, thumbnails and the Word outline are large and staged; the three view-only groups were built.
- `src/js/office-render.js`: Find row (all three), Copy, Info, Go to slide; highlight helpers; per-kind tools; Excel sheet API for jumping to a cell.
- `src/css/style.css`: find row, highlights, text selection, hidden while playing.
- Decision 234. Checks: 22 viewer checks on generated files, 36 earlier checks pass, `vite build` passes. Not run through CI or on a device (DP97).
- Next: DP97 on device; then thumbnails and Word outline, then the editing design (a decision first), then E3d (Word pages and shapes).

---

**Session 138**

Owner report after DP93: charts and diagrams do not load in slides; slide title colour differs from the original; request: charts in Word and Excel too, slide centred, First / Previous / Play-Pause / Next / Last buttons with blur while playing, landscape the same.
- `src/js/office-chart.js` (new): chart model to SVG, all common types and combinations.
- `src/js/office-read.js`: `readChart`; Word chart runs; Excel chart and picture anchors; slide charts; diagram drawings; colour-map override; style font colour precedence; geometry from layout and master placeholders; diagram text rectangles.
- `src/js/office-render.js`: chart drawing in Word, Excel and slides; slide viewer rebuilt around five buttons, centring, fit by width and height, Play with blur.
- `src/css/style.css`: centring, buttons, play layer, chart boxes, landscape rules.
- Decision 233. Checks: 36 on generated files, charts rendered and inspected, `vite build` passes. Not run through CI or on a device (DP96).
- Open: the title colour cause is unconfirmed without the owner's file.
- Next: DP96 on device; then E3d (Word pages and shapes, a decision first).

---

**Session 137**

Owner report after DP93: the slides lost formatting for missing fonts; Word pages showed no true page breaks, and shapes were missing. Request: do everything with the best version. Context was filling, so the fonts part was built and the Word pages and shapes part is planned for the next session (E3d).
- `src/fonts`: 80 files (ten families, four styles each, two subsets, ten licence files).
- `src/css/style.css`: declarations under many names, with character ranges; font notice style.
- `src/js/office-render.js`: font stacks with same-kind fallback to bundled fonts, list of fonts used, missing-font notice, embedded fonts loaded and removed with the viewer.
- `src/js/office-read.js`: Word embedded fonts read and restored.
- Docs: ROADMAP (E3c, E3d planned, DP95), DECISIONS (232), ARCHITECTURE, TRACK.

Decisions made: 232.

Verified: 111 reader, drawing and theme checks; 14 viewer checks; `vite build` passes and emits the fonts. Not verified: CI, any device (DP91, DP93, DP94, DP95).

Open: DP91, DP93, DP94, DP95 on device; E3d Word pages and shapes (a decision first); Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP95 and the other device checks, then E3d (Word pages, headers and footers on every page, shapes, text boxes, floating pictures, simple charts); a decision comes first.

**Session 136**

Owner request: add Arial, Times New Roman and Calibri and their sans versions if they exist. The Microsoft fonts cannot be redistributed in a public repository; open fonts with the same widths were added instead (Decision 231).
- `src/fonts`: 24 font files (Carlito, Arimo, Tinos; regular, bold, italic, bold italic; Latin and Latin Extended) and three licence files.
- `src/css/style.css`: font declarations under the Microsoft names, with character ranges.
- Docs: ROADMAP (fonts, DP94), DECISIONS (231), ARCHITECTURE, TRACK.
- Checked: the rupee sign is in the Latin Extended subsets only, so both subsets are bundled.

Decisions made: 231.

Verified: `vite build` passes and emits the font files; 107 viewer checks pass. Not verified: CI, any device (DP91, DP93, DP94), line breaks against the original.

Open: DP91, DP93, DP94 on device; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP91, DP93, DP94 confirmation, then an item you choose.

**Session 135**

Owner confirmed the xlsx fixes (DP92). Next item: E3b stage 3, pptx (Decision 230). DP91 (docx and theme) was not confirmed as a whole; the docx look was reported close to the reference.
- `src/js/office-read.js`: `readPptx` rewritten: slide size, theme and colour map, layout and master placeholder inheritance, text styles and bullets, backgrounds, shapes, pictures with crop, lines, groups, tables with a style fallback, notes.
- `src/js/office-render.js`: slide canvas, shape outlines, text, pictures, tables, lines; Previous, Next, swipe, zoom; zoom helper reports the user's zoom level.
- `src/css/style.css`: slide canvas and frame styles.
- Docs: ROADMAP (DP92 confirmed, stage 3, DP93), DECISIONS (230), ARCHITECTURE, TRACK.
- Not built: thumbnail strip, charts, animations, transitions, picture and pattern fills.

Decisions made: 230.

Verified: 107 reader, drawing and theme checks; 14 viewer checks; `vite build` passes. Not verified: CI, any device (DP91, DP93), decks from other programs.

Open: DP91, DP93 on device; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP91 and DP93 confirmation, then an item you choose; E3b has no stage after 3.

**Session 134**

Owner screenshots of the xlsx viewer (DP92 in progress): the look is right; text longer than its cell could not be read past the cell or the table edge.
- `src/js/office-render.js`: columns found for overflowing text plus three spare; tap a cell to read all of it in a bar; spill logic shared between the column count and the drawing.
- `src/css/style.css`: cell bar and selected cell.
- Docs: ROADMAP (DP92 steps 8 and 9), DECISIONS (229), ARCHITECTURE, TRACK.
- Cause of the report: the table had only the columns that hold data, so text running on past the last one was cut at the table edge; a neighbour with content clips text as in a spreadsheet, with no way to read the rest.

Decisions made: 229.

Verified: 95 reader and drawing checks; 14 viewer checks; `vite build` passes. Not verified: CI, any device (DP91, DP92).

Open: DP91, DP92 on device; E3b stage 3 pptx; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP91 and DP92 confirmation, then E3b stage 3 (pptx).

**Session 133**

Owner shared screenshots comparing the viewers with a reference reader: docx in Page view is close to it; xlsx showed values only. Stage 2 of E3b: xlsx (Decision 228). DP91 not yet fully confirmed (the docx look only).
- `src/js/office-read.js`: `readXlsx` rewritten: theme and indexed colours, fonts, fills, borders, alignment, number formats (`formatValue`), widths, heights, hidden rows and columns, merges, frozen panes, grid lines, drawing notice.
- `src/js/office-render.js`: xlsx table with a style rule per cell style, text spill, frozen cells, zoom shared with docx (`setupZoom`), zoom buttons; font names sanitised.
- `src/css/style.css`: xlsx grid styles.
- Docs: ROADMAP (stage 2, DP92), DECISIONS (228), ARCHITECTURE, TRACK.
- Found while testing: literal text in number formats was read as digit placeholders (a literal's index contained a digit); fixed by masking each literal as one private-use character. Single-section negative numbers got two minus signs; fixed.

Decisions made: 228.

Verified: 85 reader, drawing and theme checks (20 number format codes among them); 14 viewer checks; `vite build` passes. Not verified: CI, any device (DP91, DP92), column width match with the original.

Open: DP91, DP92 on device; E3b stage 3 pptx; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP91 and DP92 confirmation, then E3b stage 3 (pptx).

**Session 132**

Owner confirmed DP87 to DP90 on device. Request: the office viewers lost all formatting; wanted a fuller viewer and a dark mode switch of their own, system by default and kept once set. Choices: one theme setting for the three viewers; dark rendering left to me (Decision 227). Stage 1 of three: docx and the shared toolbar and theme. Source read: `explorer-view.js`, `office-read.js`, `office-render.js`, `style.css`.
- `src/js/office-read.js`: `readDocx` rewritten: theme, style inheritance, run and paragraph formatting, numbering levels, tables, picture sizes, header, footer, footnotes, page size.
- `src/js/office-render.js`: theme switch and saved settings, colours for both themes, docx Page and Reflow views, zoom and pinch, table and paragraph drawing; xlsx and pptx open under the same bar.
- `src/css/style.css`: viewer theme variables and styles.
- Docs: ROADMAP (DP87 to DP90 confirmed, E3b, DP91), DECISIONS (227), ARCHITECTURE, TRACK.
- Found while testing: yellow highlight was treated as near-white and lost in dark mode; fixed by testing all three colour channels.

Decisions made: 227.

Verified: 63 reader, drawing and theme checks; 14 viewer checks; `vite build` passes. Not verified: CI, any device (DP91), pinch and CSS zoom in the WebView, system theme reporting.

Open: DP91 on device; E3b stage 2 xlsx, stage 3 pptx; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP91 confirmation, then E3b stage 2 (xlsx).

**Session 131**

Start: docs read; DP87 to DP89 are device checks. Next approved item, Phase 22 E3, office viewers (Decisions 207, 226). Source read: `explorer-view.js`, `explorer.js`, `style.css`, `package.json`, the workflow.
- `src/js/office-read.js` (new): readers for docx, xlsx, pptx over `fflate`; limits; error messages.
- `src/js/office-render.js` (new): drawing with text nodes only; xlsx tabs and grid; pptx Previous and Next; object URL cleanup.
- `src/js/explorer-view.js`: `docx`, `xlsx`, `pptx` added to the viewer kinds; `showOffice` (read whole, 50 MB limit, loaded on use).
- `src/css/style.css`: office viewer styles.
- `package.json`: `fflate` 0.8.2.
- Docs: ROADMAP (E3, DP90), DECISIONS (226), ARCHITECTURE, TRACK.
- Bug found and fixed while testing: list items from a list style (not set on the paragraph) showed no marker; fixed by reading the numbering from the style. Slide and sheet links were read from the wrong `id` attribute (the slide list has two); fixed by matching the relationships namespace.

Decisions made: 226.

Verified: 38 reader and drawing checks on generated files; 14 viewer checks; `vite build` passes (office chunk about 21 kB). Not verified: CI, any device (DP87, DP88, DP89, DP90), files made by other programs.

Open: DP87 to DP90 on device; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP87 to DP90 confirmation, then an item you choose; Phase 22 has no stage after E3.

**Session 130**

Owner request after using the picker: when names clash, offer Replace, Skip or Rename per file with existing and new sizes, a list with the same three at the top for all, each item leaving the list when done (Decision 225). Source read: `explorer.js`, `explorer-ops.js`, `ArklyFileOpsBridge.java`.
- `scripts/java/ArklyFileOpsBridge.java`: `startWith(op, dest, paths, policy)`; replace policy (temporary name, swap, never a folder).
- `src/js/explorer-ops.js`: policy option, `findConflicts`, `canReplace`.
- `src/js/explorer.js`: conflict detection on Copy here and Move here, the Name clashes view (per item and for all), one job per item, summary; picker wording.
- `src/css/style.css`: clash rows, destructive button.
- `android-notes/native-setup.md`, ROADMAP (DP89), DECISIONS (225), ARCHITECTURE, TRACK.

Decisions made: 225.

Verified: 37 Java checks; DOM suites 31, 40, 46, 5 and the new 28; `vite build` passes. Not verified: CI of the Java change, any device (DP87, DP88, DP89).

Open: DP87, DP88 and DP89 on device; Phase 22 E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP87 to DP89 confirmation, then Phase 22 E3.

**Session 129**

Owner report: everything in copy and move worked; two requests: a way to cancel in the destination picker, and files shown in it so a same-name item is visible (Decision 224).
- `src/js/explorer.js`: Cancel button in the picker banner and on the storage list; files listed after folders (greyed, not tappable); same-name items marked with the name the new one would get; banner counts them.
- `src/css/style.css`: info rows, conflict rows, tag.
- Docs: ROADMAP (DP87 extended), DECISIONS (224), ARCHITECTURE, TRACK.

Decisions made: 224.

Verified: 46 DOM checks on the picker; earlier DOM suites pass; `vite build` passes. Not verified: on a device (DP87).

Open: DP87 and DP88 on device; Phase 22 E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP87 and DP88 confirmation, then Phase 22 E3.

**Session 128**

Bug report from the device: Delete in a folder answered "0 moved to trash, 4 could not be moved". Earlier in the session an explorer with an old `index.html` would not open: cause, the repo had the new `explorer.js` but not the new `index.html`; fix, replace `src/index.html` (done by the owner).
- Bug, cause: the plugin's `mkdir` rejects an existing folder even with `recursive`, and the trash and restore code call it every time; so only the first delete into a fresh trash worked (all DP84 tried). Fix: the adapter in `src/js/explorer.js` treats a recursive `mkdir` on an existing folder as success. Why correct: the plugin source (6.0.4) was read; the test stub now behaves the same; the new check reproduces the device message on the earlier code and passes on the fix.
- `src/js/explorer-manage.js`: batch results carry the first error reason; `explorer.js` shows it in the toast.
- Docs: DECISIONS (223), ROADMAP (DP88), SESSIONS, TRACK, ARCHITECTURE.

Decisions made: 223.

Verified: DOM suites 31, 40, 35 and the new 5 pass; the new one fails on the earlier code; `vite build` passes. Not verified: on a device (DP88), CI of the copy and move Java (DP87 not yet run).

Open: DP87 and DP88 on device; Phase 22 E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP88 and DP87 on device, then Phase 22 E3.

**Session 127**

Owner confirmed DP86 on device (archives open like folders), so E2c is confirmed. Next approved item: Phase 22 E2b, copy, move and share (Decision 222). Source read: `explorer.js`, `package.json`, `fileactions.js` (share usage), the workflow.
- `scripts/java/ArklyFileOpsBridge.java` (new): copy and move job, status, cancel.
- `scripts/patch-fileops.js` (new): copies and registers the bridge.
- `.github/workflows/build-android.yml`: patch step after the archive step.
- `src/js/explorer-ops.js` (new): job polling, destination check, result text.
- `src/js/explorer.js`: Copy, Move and Share in the selection row, destination picker, progress and cancel, share through the existing plugin.
- `src/index.html`, `src/css/style.css`: copy icon, second selection row, picker banner styles.
- Docs: ROADMAP (E2c confirmed, E2b, DP87), DECISIONS (222), ARCHITECTURE, `native-setup.md` section 18.

Decisions made: 222.

Verified: 26 Java checks on a real temporary filesystem; 35 DOM checks on the picker, progress, cancel and share; the earlier DOM suites (31, 40) still pass; patch script twice on a stub tree; `vite build` passes. Not verified: CI, any device (DP87), sharing from a USB drive.

Open: CI run; DP87 on device; Phase 22 E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: CI run; DP87 on device; then Phase 22 E3 (office viewers), or another item you choose.

**Session 126**

Owner confirmed DP83 and DP85 on device. Request: an archive opens like a folder on tap, with no Extract or Open with app question (Decision 221). Source read: `explorer.js`, `explorer-view.js`, `explorer-archive.js`, `patch-archive.js`.
- `scripts/java/ArklyArchiveBridge.java`: entry listing (`openArchive`, `browseStatus`, `children`, `closeArchive`), one entry or selected entries (`startEntry`, `startSelected`), `clearCache`; takes the activity.
- `scripts/patch-archive.js`: registers the bridge with the activity.
- `src/js/explorer-archive.js`: browse polling, folder lists, entry and selection extract.
- `src/js/explorer.js`: archive view (breadcrumbs, folders, filter, sort, selection with Extract only, Extract all), files opened from the cache, password kept in memory while open, cache cleared on leaving.
- `src/js/explorer-view.js`: `readOnly` option; the text viewer does not offer saving for a copy taken from an archive.
- `src/index.html`: Extract all header button.
- `android-notes/native-setup.md`, ROADMAP (E2c, DP86), DECISIONS (221), ARCHITECTURE.

Decisions made: 221.

Verified: 39 Java checks against stubs; 40 DOM checks on browsing; 31 earlier DOM checks; patch script twice on a stub tree; `vite build` passes. Not verified: the real libraries, CI, any device (DP86).

Open: CI run; DP86 on device; Phase 22 E2b copy, move, share and E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: CI run; DP86 on device; then Phase 22 E2b.

**Session 125**

Owner confirmed E2a on device (DP84). Request: native extraction of zip, 7z, rar and other compressed files (Decision 220, E2c). Source read: `explorer.js`, `patch-explorer.js`, the workflow, `native-setup.md`.
- `scripts/java/ArklyArchiveBridge.java` (new): the extraction job, status, cancel.
- `scripts/patch-archive.js` (new): copies and registers the bridge, adds the libraries and packaging excludes to `build.gradle`.
- `.github/workflows/build-android.yml`: patch step after the explorer bridge.
- `src/js/explorer-archive.js` (new): archive names, job polling, messages.
- `src/js/explorer.js`: ask on tap, progress view with Cancel, password prompt, Extract in the selection header, cancel on Back and on close.
- `src/index.html`: Extract icon and button.
- `android-notes/native-setup.md`: section 17.
- Docs: ROADMAP (E2c, DP84, DP85), DECISIONS (220), ARCHITECTURE (File explorer).

Bug fixed (found while editing `index.html`): cause, `index.html` already had an `i-restore` symbol and Session 124 added a second with the same id, so the first in the file won and the Trash restore icon elsewhere changed; fix, the added symbol is removed and the explorer uses the existing one; why correct, ids are unique again (checked).

Decisions made: 220.

Verified: 20 Java checks (compiled against stubs of Android and the four libraries); 41 DOM checks on the extract flow, 31 earlier; the patch script run twice on a stub tree; `vite build` passes. Not verified: the real libraries compile and behave as recalled, CI, any device (DP83, DP85).

Open: DP83 and DP85 on device; Phase 22 E2b copy, move, share and E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: CI run (the extraction libraries and the explorer's Java are the first compile risk); DP83 and DP85 on device; then Phase 22 E2b.

**Session 124**

File explorer stage E2a, manage (Decision 219), first of two parts of E2. Source read: `explorer.js`, `explorer-view.js`, `patch-explorer.js`, the explorer markup and styles, `askYesNo` and `askText` in `app.js`.
- `src/js/explorer-manage.js` (new): name rules, new folder, rename, shared trash, properties; pure logic over an injected filesystem.
- `src/js/explorer.js`: long-press selection and selection header, new folder, rename, delete to trash, trash view (restore, delete for good, empty), properties view, 30-day purge once per open, plugin adapter.
- `src/index.html`, `src/css/style.css`: three icons, New folder and Trash buttons, selection header, selected rows, trash banner and properties styles.
- Docs: ROADMAP (E2a, E2b, DP84), DECISIONS (219), ARCHITECTURE (File explorer).

Decisions made: 219.

Verified: 51 Node checks on `explorer-manage.js`; 31 DOM checks on the screen against the real `index.html`; `vite build` passes. Not verified: CI (the explorer's Java is still uncompiled), any device (DP83, DP84), the plugin's rename and rmdir on real storage and USB drives. Release status not checked: the GitHub API rate limit was hit.

Open: DP83 and DP84 on device; Phase 22 E2b copy, move, share and E3 office viewers; Phase 17 stages N and O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: CI run for stage M, the explorer and E2a; DP83 and DP84 on device; then Phase 22 E2b.

**Session 123**

File explorer stage E1b, built-in viewers (Decision 211), started ahead of the device pass on DP79 at the owner's choice. Source read: `explorer.js`, the entry viewers and editor in `app.js`, `pdfviewer.js`, `pdftools.js`, the explorer markup and styles.
- `src/js/explorer-view.js` (new): text view and edit, image, PDF, audio and video.
- `src/js/explorer.js`: dispatch to the viewers, `shownItems()`, Back and finish hand-over, external open kept as the fallback.
- `src/index.html`, `src/css/style.css`: viewer layer and styles.
- `src/js/app.js`: the explorer is given the app's dialogs, image zoom and auto-lock timer.
- Docs: ROADMAP (E1b, DP81), DECISIONS (211), ARCHITECTURE (File explorer).

Device pass: DP69 to DP81 confirmed on a device, including DP74, DP79 and DP81.

Phase 17 stage M, Vault files on disk (Decision 212), approved by the owner:
- `src/js/filestore.js`, `src/js/files.js`: key wrapping under any key, the Vault-key store, re-wrap for Move, raw write for restore.
- `src/js/vault.js`: file entries written to disk, read back, meta v2, edit of file content.
- `src/js/move.js`: Move re-wraps the key and writes no bytes, with rollback.
- `src/js/fileactions.js`: edit of a Vault file's content.
- `src/js/backup.js`: Vault files in format 1 and 2, restore with re-wrap on Append.
- `src/js/db.js`: schema comments only.
- Bug found by the checks and fixed: a read with the wrong Vault key rewrote the file's meta; meta is now only made when missing.

Fixes reported after stage M (Decisions 214, 215):
- `src/js/app.js`: Back is inert on the lock screen; one Vault fingerprint attempt at a time with specific reasons; app-open lock follows the same outcomes; token code removed.
- `src/js/biometric.js`: `unlockWithBiometricEx` (declined, unreadable, secret) and `singleFlight`.
- `src/js/update-check.js`, `src/js/update-install.js`, `src/index.html`: unauthenticated check and download, token controls removed; an earlier saved token is deleted at start-up.
- Later report: the Decision 215 reset on an unreadable stored copy cleared the fingerprint setting when the phone was still locked; reverted to a message only (Decision 216). An app lock from the Vault now returns to the Vault gate after the unlock (Decision 216).
- Root cause of the fingerprint failures found in the plugin source: `deleteCredentials` clears every saved credential (Decision 217). Not calling it again; off is a marker overwrite. An app lock now also locks the Vault.
- DP82 passed on device with one fault: Home showed the Trash view and stale counts after Vault Moves; fixed (Decision 218).
- Cause of the Back bypass found and fixed (leftover location). Cause of the Vault fingerprint failure not confirmed; a second prompt on resume fits and is removed.

Owner note recorded as Decision 213: the explorer's trash (E2) is not encrypted and is shared by the Home and Vault cards.

Decisions made: 211, 212, 213, 214, 215, 216, 217, 218.

Verified: 36 Node checks on the viewers and dispatch; 28 Node checks on Vault files and Move against a real SQLite schema; 12 Node checks on the fingerprint read and `singleFlight`; `vite build` passes. Not verified: CI (the explorer's Java is still uncompiled), Vault backup and restore of files in Node, any device for stage M (DP82).

Open: DP83 on device; Phase 17 stages N and O; Phase 22 E2 manage and shared trash, E3 office viewers; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: CI run for the stage M and explorer changes, DP83 on device, then Phase 17 N (needs approval) or Phase 22 E2.

**Session 122**

Bug fix (Decision 210): fingerprint reads successfully but the app or the Vault does not open. Source read: `biometric.js`, the background-lock handler, `tryBiometricUnlockApp`, `tryBiometricUnlockVault`, the picker flag.
- `src/js/biometric.js`: prompts counted, `biometricPromptBusy()` exported.
- `src/js/app.js`: the background handler ignores the fingerprint screen's pause.
- Docs: ROADMAP (DP80), DECISIONS (210), ARCHITECTURE (note).

Decisions made: 210.

Verified: 14 new Node checks and the earlier suites; `vite build` passes. Not verified: CI (the explorer's Java is still uncompiled), any device (DP69 to DP80). Cause inferred, not reproduced.

Open: DP69 to DP80 on device; Phase 22 E1b viewers, E2 manage and trash, E3 office viewers; Phase 17 stages M to O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: CI run to confirm the explorer's Java compiles, DP79 and DP80 on device, then Phase 22 E1b.

**Session 121**

Text renamed to Notes everywhere (Decision 209). `src/js/app.js`: label map, Autosave toasts, discard dialog; `FOLDER_TITLES` removed. `src/index.html`: New chooser card and the editor's accessibility label. Docs: ROADMAP (DP78), DECISIONS (209).

Decisions made: 209.

Verified: `vite build` passes. Not verified: CI, any device (DP69 to DP79).

Open: as Session 119.

Next session start point: as Session 119.

**Session 120**

Card order and the Notes label (Decision 208). `src/index.html`: both card grids reordered, Text card labelled Notes. `src/js/app.js`: `FOLDER_TITLES` for the two folder headings. Docs: ROADMAP (DP78), DECISIONS (208).

Decisions made: 208.

Verified: `vite build` passes; order and labels read back from both grids. Not verified: CI, any device (DP69 to DP79).

Open: as Session 119.

Next session start point: as Session 119.

**Session 119**

File explorer stage E1a (Decision 207), after the owner approved the four open points of Decision 206. Source read: overlay and back handling, lock handling and the picker flag in `app.js`, `fileopen.js`, `patch-screenlock.js`, `patch-manifest.js`, the workflow, `native-setup.md`.
- `src/js/explorer.js` (new): the screen and its helpers.
- `scripts/patch-explorer.js` (new): native bridge written and registered by CI.
- `scripts/patch-manifest.js`: `MANAGE_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`.
- `.github/workflows/build-android.yml`: patch step after `patch-screenlock.js`.
- `src/index.html`, `src/css/style.css`, `src/js/app.js`: explorer screen, styles, open and close wiring for both cards, Back, lock and overlay handling.
- Docs: ROADMAP (Phase 22, DP78, DP79), DECISIONS (207), ARCHITECTURE (File explorer), native-setup (section 16).

Decisions made: 207.

Verified: 31 Node checks on the screen; the CI patches against a stub Android tree, twice; the Java parses; `vite build` passes. Not verified: CI (the Java is not compiled here), any device (DP69 to DP79).

Open: DP69 to DP79 on device; Phase 22 E1b viewers, E2 manage and trash, E3 office viewers; Phase 17 stages M to O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: a CI run to confirm the Java compiles, then DP79 on device, then Phase 22 E1b.

**Session 118**

File explorer card, stage E0 (Decision 206). Source read: card markup and wiring in `index.html` and `app.js`, card CSS, `package.json`, `native-setup.md` (permissions, CI patching), `fileopen.js`.
- `src/index.html`: `i-explorer` symbol; ninth card in the Home and Vault grids.
- `src/css/style.css`: three-column grids, icon-above-label cards, slate tone.
- `src/js/app.js`: tap handler for the new card.
- Docs: ROADMAP (Phase 22, DP78), DECISIONS (206).

Decisions made: 206.

Verified: `vite build` passes; earlier suites unaffected. Not verified: CI, any device (DP69 to DP78); the grid on a narrow phone.

Open: owner approval for Phase 22 E1 to E4 and the four decisions in Decision 206; DP69 to DP78 on device; Phase 17 stages M to O; Phase 21 P4; Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: Phase 22 E1 once the decisions are approved; otherwise DP69 to DP78 on device, then Phase 17 stage M.

**Session 117**

Bug fix (Decision 205): no fingerprint offered after a lock and reopen. Source read: `app.js` (`registerBackgroundLock`, `handleLockTrigger`, `tryBiometricUnlockApp`, the start-up prompt); the screenshot showed the lock screen without a fingerprint button.
- `src/js/app.js`: `offerLockBiometric`; resume handler calls it when the lock screen is showing; `tryBiometricUnlockApp` holds a busy flag and a cooldown.
- Docs: ROADMAP (DP77), DECISIONS (205), ARCHITECTURE (note under Changing secrets).

Decisions made: 205.

Verified: 8 new Node checks and the earlier suites; `vite build` passes. Not verified: CI, any device (DP69 to DP77); the cooldown length.

Open: DP69 to DP77 on device; Phase 17 stages M to O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 to DP77 on device, then Phase 17 stage M on approval.

**Session 116**

Redesign of the secret windows (Decision 204), requested by the owner: fingerprint as a choice, and one window per change or gate. Source read: `app.js` (secret management, `askText`, `dismissOverlays`, `backAction`), `index.html`, `style.css`.
- `src/js/app.js`: `openSecretForm`; set, change and remove password, change Vault PIN and `confirmBackupAccess` rebuilt on it; the old step-by-step helpers removed.
- `src/index.html`: `secret-dialog`.
- `src/css/style.css`: `#secret-dialog` (below the yes/no dialog), `.secret-field`, status line.
- Docs: ROADMAP (DP74, DP75 rewritten), DECISIONS (204), ARCHITECTURE (Changing secrets, Backup access gate).

Decisions made: 204.

Verified: 38 + 14 + 5 Node checks; `vite build` passes. Not verified: CI, any device (DP69 to DP76); window layout; the fingerprint prompt.

Open: DP69 to DP76 on device; Phase 17 stages M to O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 to DP76 on device, then Phase 17 stage M on approval.

**Session 115**

Bug fix (Decision 203): Home fingerprint failing while the typed password works. Source read: `app.js` (lock screen, biometric enable and disable, `attemptUnlock`), `biometric.js`, the biometric plugin's Android source (credentials are stored per name).
- `src/js/app.js`: `syncLockBiometric`; called at start-up and after enable and disable; `attemptUnlock` moved ahead of the early returns in `showLockScreen`.
- Docs: ROADMAP (DP76), DECISIONS (203), ARCHITECTURE (note under Changing secrets).

Decisions made: 203.

Verified: 5 new Node checks and the 45 earlier ones; `vite build` passes. Not verified: CI, any device (DP69 to DP76). The cause is inferred from the code and not reproduced.

Open: DP69 to DP76 on device; Phase 17 stages M to O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 to DP76 on device, then Phase 17 stage M on approval.

**Session 114**

Phase 21 P3 (Decision 202): backup access gate. Docs read: Backup & Restore and Credentials sections of ARCHITECTURE, Decision 199. Source read: `app.js` (`handleBackupNow`, `handleDriveBackupNow`, secret management), `backup.js` (category keys).
- `src/js/app.js`: `confirmBackupAccess`; called from `handleBackupNow` and `handleDriveBackupNow`.
- No other source file changed. `src/index.html` and `src/js/passeye.js` are unchanged since Sessions 112 and 113.
- Docs: ROADMAP (P3, DP75), DECISIONS (202), ARCHITECTURE (Backup access gate).

Decisions made: 202.

Verified: 45 Node checks; `vite build` passes. Not verified: CI, any device (DP69 to DP75); the biometric prompt.

Open: DP69 to DP75 on device; Phase 17 stages M to O; Phase 21 P4 (needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 to DP75 on device, then Phase 17 stage M on approval; Phase 21 P4 waits for the passkey decision.

**Session 113**

Phase 21 P2 (Decision 201): set, change and remove secrets from Settings. Docs read: Credentials section of ARCHITECTURE; source read: `app.js` (credential functions, biometric, Vault unlock, askText), `crypto.js` (wrapper), `index.html`.
- `src/js/app.js`: `confirmAppSecret`, `askNewSecret`, `runSetAppPassword`, `runChangeAppPassword`, `runRemoveAppPassword`, `runChangeVaultPin`, `refreshAppPasswordRows`; button wiring in the Settings setup.
- `src/index.html`: Password block in the App lock tile; Vault PIN block in Vault Settings.
- Docs: ROADMAP (P2, DP74), DECISIONS (201), ARCHITECTURE (Credentials: changing secrets).

Decisions made: 201.

Verified: 31 Node checks; `vite build` passes. Not verified: CI, any device (DP69 to DP74); the biometric prompt inside a change.

Open: DP69 to DP74 on device; Phase 17 stages M to O; Phase 21 P3 and P4 (P4 needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 to DP74 on device, then on approval Phase 21 P3 or stage M of Decision 195.

**Session 112**

Phase 21 P1 (Decision 200): show/hide control on password fields. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 195 to 199 only. Source read: `app.js` (`clearSecretInputs`, `askText`, PDF password prompt), `index.html`, `style.css`.
- Finding: the update check for the private repo is already built and confirmed (Decision 164, DP45).
- `src/js/passeye.js` (new): `initPasswordEyes`, `attachEye`, `hidePasswords`, `setPasswordField`.
- `src/js/app.js`: import and start call; `clearSecretInputs` selects `input[data-pw]` and hides revealed fields; `askText` uses `setPasswordField`; the sheet hides the field on close.
- `src/index.html`: `i-eye` symbol; `data-no-eye` on the lock screen input.
- `src/css/style.css`: `.pw-field`, `.pw-eye`, `.pw-off`.
- Docs: ROADMAP (Phase 21, P1, DP73), DECISIONS (200), ARCHITECTURE (Password show/hide).

Decisions made: 200.

Verified: 18 Node checks on `passeye.js`; `vite build` passes. Not verified: CI, any device (DP73). The layout of the wrapped fields is DOM and CSS and has no Node check.

Open: DP69 to DP73 on device; Phase 17 stages M to O; Phase 21 P2 to P4 (P4 needs approval of the stored automatic-backup passkey); Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 to DP73 on device, then on approval Phase 21 P2 or stage M of Decision 195.

**Session 111**

OCR dropped (Decision 192). Fresh session; Tier 1 docs read, Tier 2 skimmed (headings and latest entries). Source read: `package.json`, `native-setup.md` §6, the OCR call sites in `app.js`, `move.js`, `vault.js`, `intents.js`.
- Phase 5 OCR was the next open item. Both routes were compared (ML Kit native plugin; `tesseract.js` bundled locally). The owner dropped OCR from the app.
- Docs: DECISIONS (192), ROADMAP (Phases 3, 5, 8 and the not-doing line), ARCHITECTURE (principles, entry types, Vault envelope, edit actions, label suggestion, batch add, search ranking, file list, status), `android-notes/native-setup.md` (§6 now a stub).
- OCR step: no code changed. Unchanged on purpose: the `body_text` and `ocrText` fields; stale comment in `captureFile` and unused `suggestLabel()` (Decision 192).

- Bug report: the Vault Trash showed no files and the app stopped. Cause, fix and risk in Decision 193. `src/js/db.js`: `listTrash` names its columns for the Vault; `restoreFromTrash` reads the whole row only for a reminder. DP69 added.

- Bug report: Vault Trash drew under the landing tiles. Cause, fix and risk in Decision 194. `src/js/app.js`: the Vault tab handler. DP70 added.
- Slow open, even with no data: read, not changed. Biometric unlock runs the same verify as a typed entry (Decision 50). App unlock: one PBKDF2 at 600000 (Decision 172). Vault unlock: that, plus a key derivation at 300000, then the index build. Each is a fixed cost per unlock, independent of data. Startup before the lock screen also runs the database open, permission and channel calls, and the reminder queue drain. No timing was taken; the split is not measured. Options held for the owner: time each step on device; skip the repeat verify after a biometric success; keep the Vault key instead of re-deriving it (touches Credentials, Decision 50).

- Vault speed: the Vault stores files in the database and decrypts per row at unlock, so cost grows with size and count. Owner: no Vault data and no old backups to keep, fastest and safest wanted. Plan in Decision 195 (stages L to O), nothing built.

- Stage L of Decision 195 built (Decision 196): the PIN wraps a random Vault key; unlock is one PBKDF2; biometric holds the key. Files `crypto.js`, `db.js`, `app.js`, `backup.js`. DP71 added.

- Bug report: Vault set-up stuck on the earlier-format toast. Cause, fix and risk in Decision 197. `src/js/app.js`.

- Bug report: after a lock, the correct app password and biometric did not open Home. Cause, fix and risk in Decision 198. `src/js/app.js`. DP72 added.

- Owner request: show-password, set/change/remove passwords, password-gated backup, saved passkey for automatic backup. Planned as Phase 21 (Decision 199), nothing built. The saved passkey conflicts with the never-stored rule and needs approval.

Decisions made: 192, 193, 194, 195, 196, 197, 198, 199.

Verified: a Node check of the two `listTrash` queries on a stub; 14 Node checks on the Vault key wrapper; `vite build` passes. Not verified: CI, any device (DP69, DP70, DP71). The cause is inferred from the code, not from a device log.

Open: Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 noise toggle and sound asset; Phase 17 Vault key count and app-password wrapper; light-theme tuning; Autosave of Voice, Image, PDF and Files Edit details.

Next session start point: DP69 and DP70 on device, DP69 to DP72, then on approval stage M of Decision 195 or P1 of Decision 199; if the crash remains, the device log is needed. Then the owner picks among the open items.

**Session 110**

Phase 19 stage 3 (Decision 189): Reminder, Location, Money autosave. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 177 and the Autosave section. Source read: `app.js` (Save dialog, paste dialog, capture flows, `dismissOverlays`, text drafts), `moneyui.js`, `vault.js` (`saveVaultEntry`), `money.js`, `geoparse.js`.
- Finding: the update check for the private repo is already built and confirmed (Decision 164, DP45); the owner instruction that lists it as not yet built is out of date.
- `src/js/autosave.js` (new): `parseFormDraft`, `resolveFormDraft`.
- `src/js/app.js`: `formDraft` (one session per flow), `commitFormDrafts`, `insertFormDraft`, `vaultFormDraftArgs`, hide listener; flush in `dismissOverlays`; `draft` option on `openSaveDialog` and `openCoordsDialog`; Home and Vault Reminder, Money and Location flows keep the draft until the entry is saved; unlock toasts.
- `src/js/moneyui.js`: `draft` option on `openMoneyForm`; chips, kind buttons and repayment changes raise `touch`.
- Docs: ROADMAP (stage 3, DP66; Phase 20 and DP65 brought in line with Session 109, which confirmed them), ARCHITECTURE (Autosave), DECISIONS (189).
- DP66 confirmed on device.
- Stage 4 (Decision 190): edits of Reminder, Location details and Money. `autosave.js`: `edit`, `forceNote`, `noteName`, `entryLabel` options; reminder notes now list When. `app.js`: `formDraft` takes the entry, `formDraftKey`, `applyEditDraft`, second pass in `commitFormDrafts`, toast for applied edits; `editEntryUI` (Reminder, Location) and `editMoney` hold the draft until saved.

- Hardening of the stage 4 reschedule (Decision 190): `applyEditDraft` writes first, then schedules or cancels in its own step; a past time is cancelled, not scheduled; a failure clears the row and tells the person. DP67 gained the past-time and Vault reminder checks. Context was nearly full at this point.

- DP68 confirmed on device: Phase 19 complete.
- DP67 confirmed on device. Found: the lists showed the old data after the unlock until an entry was opened. Cause: the lists drawn before the lock were not redrawn after the commit. Fix (Decision 191): `arkly-drafts-committed` after Home and Vault commits, handled like `arkly-data-restored`. Text and Voice autosaves benefit as well.

Decisions made: 189, 190, 191.

Verified (stage 3): 16 Node checks on `autosave.js` (complete and incomplete forms for each kind, tag cap, loan with repayments, repayments over the amount, unparsed paste); 12 checks on the draft session and commit code cut out of `app.js` and run with stubs (no write when untouched, write on change, 500 ms debounce, return to first state removes the row, clear leaves an unrelated row alone, lock flush marks locked and encrypts the Vault row, Home draft untouched by a Vault-only lock, hide flush, GPS fix part, Home and Vault commit, wrong-key row dropped, second commit finds nothing); `vite build` passes. Not verified: CI, any dialog on a device, the date and time pickers raising change events, the lock paths, the Vault key at lock (DP66). The dialog wiring is DOM code and has no Node check.

Verified (stage 4): 25 Node checks on `autosave.js` (9 new: edit complete and incomplete for each kind, cleared name, entry gone, forced note); 20 on the draft session and commit (8 new, including the reschedule guard: edit key and entry, Vault encryption, same-minute time, finished reminder reopened or left alone, Money Home and Vault shapes, entry gone, type mismatch, malformed row); `vite build` passes. Not verified: CI, a device (DP67), the reschedule at unlock.

Open: Autosave of Voice, Image, PDF and Files Edit details; Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 OCR and noise toggle; Phase 17 Vault key count and app-password wrapper; light-theme tuning.

Next session start point: Phase 19 is complete; no device pass is open. The owner picks among the open items.

---

**Session 109**

Phase 20 step 1 (Decision 182): Move for Text, Location and Money. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 181, 140 to 143 and ARCHITECTURE §3b, §3c, §5. Source read: `fileactions.js`, `vault.js`, `db.js` (`insertEntry`, `permanentlyDeleteEntry`), `app.js` row, Home and Vault list and lock paths.
- Finding: the update check for the private repo is already built and confirmed (Decision 164, DP45); the owner instruction that lists it as not yet built is out of date.
- `src/js/move.js` (new): `moveToVault`, `moveToHome`, `canMove`.
- `src/js/app.js`: `moveEntryUI`; Move button in `entryRowHtml` before Delete for these types; handlers on the Home and Vault folder lists.
- `src/index.html`: icon `i-move`.
- Docs: ROADMAP (Phase 20 step 1, DP62), ARCHITECTURE (§5 order, folder list, Move section), DECISIONS (182).

Device pass: DP62 confirmed.

Then step 2, Reminder (Decision 183).
- `src/js/move.js`: `reminder` added to `MOVE_TYPES`; `fire_at`, `repeat_rule`, `completed_at`, `snoozed_until` carried and compared on read-back.
- `src/js/app.js`: `rescheduleMovedReminder` (cancel old id, schedule new, snooze for its remaining time); sheet sentence about the notification text.
- Docs: ROADMAP (step 2, DP62 confirmed, DP63), ARCHITECTURE (Move section), DECISIONS (183).

Device pass: DP63 confirmed.

Then step 3, Voice, Image, PDF, Files (Decision 184), no size cap by owner decision.
- `src/js/move.js`: four file types added; bytes, extension, category and OCR text carried; compared byte for byte; partial Home file removed on failure.
- `src/js/app.js`: `moveBusy` guard and a `Moving…` notice for file kinds.
- Docs: ROADMAP (step 3, DP63 confirmed, DP64), ARCHITECTURE (Move section), DECISIONS (184).

Device finding (DP64, first run): Move to Vault on a Home PDF showed "Its file could not be read". Cause not yet known: the real read error was replaced by that fixed message. Fix: the message now carries the underlying reason, and the doubled full stop in the notice is gone. Next: repeat the move and read the reason.

Device findings (DP64): the first PDF tried had no file behind its entry (only the name remained); Move refused and kept the row, and the notice now names the reason. A file that opens fine moved both ways. Beta data: no further action on the orphaned rows.

Then step 4, Move for a selection (Decision 185).
- `src/index.html`: `sel-move` button before Delete.
- `src/js/app.js`: `runSelectionMove`; the icon's tooltip follows the selection's screen.
- Docs: ROADMAP (step 4, DP64 confirmed, DP65), ARCHITECTURE (Move section, bar order), DECISIONS (185).

Owner request after the step 4 build: a locked Vault must not throw the person to the Vault tab and lose the selection (single Move had the same problem). Built `unlockVaultInPlace` (Decision 186): biometric when enabled, then a PIN sheet over the current page; the move carries on after unlocking. `src/js/app.js` only.

Owner request: keep only the latest 3 workflow runs. New `.github/workflows/cleanup-runs.yml` (Decision 187), manual trigger only to save Actions minutes; selection logic checked on sample data and the file parsed as YAML; confirmed on GitHub by a manual run.

Device finding (DP65, in place unlock): biometric unlock without leaving the page worked. Owner asks: confirm before unlocking, state the locked Vault in the sheet instead of a toast, and cover the PIN-only case. Built (Decision 188): the Move sheet first, with `Unlock and move` and a locked-Vault sentence; the unlock follows; a set-up sheet replaces the toast when no PIN exists. `src/js/app.js` only.

Device pass: DP65 confirmed, including the in-place unlock with biometric and with the PIN only. Phase 20 complete.

Decisions made: 182, 183, 184, 185, 186, 187, 188.

Verified (185, 186): `move.js` checks unchanged (16 pass); syntax check; `vite build` passes. Not verified: the selection handler, the bar, the in-place unlock (biometric prompt, PIN sheet, wrong PIN, Cancel) on a device, the bar width on a narrow phone (DP65). The handler is DOM code and has no Node check.

Verified (184): 16 Node checks on `move.js` with an in-memory file store (voice, image, pdf and file both ways with identical bytes and no stray files; a missing file refused; a failed final delete keeps the original file and leaves no copy in either direction; a wrong key writes no file); syntax check; `vite build` passes. Not verified: any file move on a device, behaviour with very large files (DP64).

Verified (183): 13 Node checks on `move.js` (the 11 below plus a repeating snoozed reminder both ways with the Vault row holding no plain name or note, a done reminder staying done, a reminder with no time refused); syntax check; `vite build` passes. Not verified: any notification behaviour on a device (DP63).

Verified (182): 11 Node checks on `move.js` with real Web Crypto and the real schema in an in-memory SQLite (note, location and money both ways; created and updated times kept; Vault rows hold no plain label, text, coordinates or note; Home search row and suggestion count removed on the way in and added on the way out; a label shared by two Home entries keeps its suggestion; refusals for expense, unreadable money, missing coordinates, locked key, missing and trashed entries leave the original; a wrong key writes nothing; a failed delete of the original removes the copy in both directions); syntax check; `vite build` passes. Not verified: CI, the button and sheets on a device, the PIN-screen path, the Vault lock during the sheet (DP62).

Open: Phase 19 stage 3; Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 OCR and noise toggle; Phase 17 Vault key count and app-password wrapper; light-theme tuning.

Next session start point: the owner picks among the open items. Clean up old runs is confirmed; start it by hand from the Actions tab when the run list is long. Phase 20 is complete and confirmed on device (DP62 to DP65).

---

**Session 108**

Phase 9, confirmation item (Decision 175), chosen as the smallest open item that needs no new dependency, no device review and no change to credentials or backups. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 124, 131, 164 and 172 to 174, ARCHITECTURE §7, §8, §13 and the update-check section. Source read: `intents.js`, the capture path in `app.js`.
- Finding: the update check for the private repo (token header, API asset url, tap only) is already built and confirmed (Decision 164, DP45); nothing to build there.
- Finding, bug: a typed note containing "remind me" became a reminder silently, losing the Save dialog's tags and description, with a "Note saved" toast.
- `src/js/intents.js`: `reminderOffer(text, now)`.
- `src/js/app.js`: Yes/No sheet after the Save dialog when `reminderOffer` matches; `captureText` makes a reminder only when `reminderAt` is passed; `detectIntent` import and `buildFromHandler` removed.
- Docs: ROADMAP (Phase 9, DP58), ARCHITECTURE (§7, §13), DECISIONS (175).

Bugs fixed:
- Cause: `captureText` converted any text matching the reminder phrase and rebuilt the entry from the parsed words only. Fix: conversion happens only after a confirmed offer, and the entry takes name, tags and description from the Save dialog. Correct because the only caller now decides, and the default (Back, No) is the plain note.

Then a reported bug (Decision 176, extended by 177): typed note text was lost when the app locked.
- Cause: a lock closes the editor with no result and nothing had been written.
- Fix (`src/js/app.js`): `openTextEditor` takes `draftKey` and `startDirty`; Home New note writes `meta.note_draft` while typing and on close, restores it on the next New note, clears it on save or on Yes at Discard. Correct because every route that closes the editor without a discard now keeps the text. Vault editor and existing-note edits are not covered.

Then Autosave stage 1 (Decision 177), on the owner's go-ahead after the report that edits of saved notes lost their added text.
- `src/js/app.js`: `noteDraftHandlers`, `commitNoteDrafts`, `autosaveName`; `openTextEditor` takes `persist` and `clear` instead of the 176 draft key; Home and Vault, new and edit, pass them; commit at Home unlock and at Vault unlock; the 176 restore step and its toast are gone.
- Docs: ROADMAP (Phase 19, DP59 rewritten), ARCHITECTURE (Autosave), DECISIONS (177).

Reminder wording changed (Decision 178): the note is always saved and the sheet offers a reminder in addition (`src/js/app.js`).

Then Autosave stage 2 (Decision 179), after DP58 and DP59 were confirmed on the device: Voice, Home and Vault.
- `src/js/app.js`: `autosaveVoice`; the recorder keeps a take on any close that is not a save or an explicit discard (recording, review, finalising); the Home and Vault Save-dialog callbacks keep the take when a lock closed the dialog.
- Docs: ROADMAP (Phase 19, DP58 and DP59 confirmed, DP60), DECISIONS (179).

Then Home background recording (Decision 180), approved after the owner asked for it: a Home-only switch on the recorder screen keeps a take running behind a lock; the recorder reopens on it at the next unlock (`src/js/app.js`: `bgRec`, `resumeRecordingHook`, `homeVoiceSaved`).

Then the Move feature (Phase 20) was designed and approved with the owner (Decision 181); nothing built. Context filled; the session stopped here by the handoff rule.

Decisions made: 175, 176, 177, 178, 179, 180, 181.

Verified (179): syntax check; `vite build` passes. Not verified: any recorder behaviour on a device, CI.

Verified (177): 16 Node checks on the draft functions with real Web Crypto (Home new and edit stored, Vault rows encrypted with no plain text, no write once the key is gone, Home commit leaves Vault rows alone, Autosave name format, edit applied, rows cleared, Vault commit, second run does nothing, an edit of a missing entry kept as an Autosave note, blank text skipped, a draft under another PIN dropped); syntax check; `vite build` passes. Not verified: the editor and lock paths on a device, CI.

Verified in the authoring environment (175): 9 Node checks on `reminderOffer` (tomorrow at 9am gives the next day 9:00 and the label, 5pm ahead today, a past time with "today" refused, a past time with no day word rolls to tomorrow, plain text, expense text and empty text give none, case-insensitive phrase); syntax check of both files; `vite build` passes. Not verified: CI, the sheet over the Save dialog on a device, Back and lock while it is open, the notification firing for a reminder made this way (DP58).

Open: Phase 9 quick-capture widget, expense charts, map view; Phase 10 obfuscation, R8 and signature check; Phase 5 OCR and noise toggle; Phase 17 Vault key count and app-password wrapper; light-theme tuning. Each needs approval or a device review.

Device pass: DP58 and DP59 confirmed.

Device pass: DP60 and DP61 confirmed (voice autosave; recording behind a lock).

Next session start point: Phase 20 Move, step 1 (Text, Location, Money); Autosave stage 3 (Reminder, Location, Money) stays open.

---

**Session 107**

Phase 17 item K (Decision 172), chosen on the owner's delegation. Reason: no new dependency, no change to backups or to any stored secret, and the hash count (210000) was the lowest of the three credentials. Haptics needs a new dependency and approval, light-theme needs a device review, the Vault key count means re-encrypting the Vault, the app-password wrapper is large. Fresh session; Tier 1 and Tier 2 docs read; `crypto.js`, `db.js`, `app.js` credential paths and `backup.js` credential reads checked first.
- `src/js/crypto.js`: `PASSWORD_HASH_ITERATIONS` (600000), `LEGACY_HASH_ITERATIONS` (210000), `needsRehash`; `hashPassword` takes a count and returns it; `verifyPassword` takes the stored count (none means 210000).
- `src/js/db.js`: `app_password_iter` and `private_pin_iter` columns through `ensureColumn`.
- `src/js/app.js`: counts stored at first-run setup, password set and remove, Vault PIN set; read at lock screen unlock, Vault unlock and both biometric enable checks; `upgradeCredentialHash` after a correct unlock (salt kept).
- Docs: ROADMAP (K, DP55), ARCHITECTURE (credential hash counts, open list, backup key derivation line), DECISIONS (172).

Then haptics (Phase 15 polish item 4, Decision 173), on the owner's delegation after the app-password wrapper was reviewed and held back (feasible with the plugin's per-launch secret, but it moves the lock check outside the database, changes forgot-password, and cannot be tested without a device; it needs explicit approval and a staged build). Built on `@capacitor/haptics` 6.0.3, then dropped after three builds with no vibration on the owner's phone.
- Removed: the dependency in `package.json`, `src/js/haptics.js`, the Settings row in `src/index.html`, and every call site and `toastSaved` in `src/js/app.js`.
- Docs: ROADMAP (Haptics and DP56 closed), ARCHITECTURE (haptics section removed), DECISIONS (173 rewritten as dropped).

Then Vault batch numbering (Phase 8, Decision 174), chosen on the owner's delegation as the smallest open item. The Vault multi-select save already offered one numbered name but restarted at 1 each batch.
- `src/js/batch-number.js` (new): `nextBatchStart(entries, type, baseName)`, highest `<baseName> N` of the same type in the in-memory Vault index. No plaintext label history is added (labels are encrypted).
- `src/js/app.js`: the Vault multi-file save numbers from that start plus one.
- Docs: ROADMAP (Phase 8 lines, DP57), DECISIONS (174).

Device pass: DP57 confirmed (Vault batch numbering continues).

Then Phase 11 (CI/CD) closed on evidence, no code. The read-only token cannot list workflow runs (403, a permission of the token, not an expiry), but the releases v0.1.0+494, +498 and +499 exist, each published by the workflow's last step after the signed build, so those runs were green. Auto-release is confirmed working the same way. Docs: ROADMAP (Phase 11, DP57).

Then Phase 16 closed on the docs' own evidence, no code: G (open Files with the phone's app) is confirmed by DP14 and H (in-app PDF viewer) by DP15 and DP17, but both were still marked built and not device-tested. Both Phase 16 headings and the G and H items are now checked. Docs: ROADMAP (Phase 16).

Bugs fixed: none. Haptics gave no vibration on the owner's phone in any build (impact and notification patterns; one-shot lengths; one-shot lengths also through the web view). The Test button showed the plugin answering with no error and the web view accepting its call, so the phone's system dropped the request; cause on the phone not found. Dropped by the stop rule set beforehand.

Decisions made: 172, 173, 174.

Verified in the authoring environment (K): 14 Node checks on `crypto.js` (new count returned, round trip, wrong secret refused, a new hash not accepted at the old count, an earlier hash with no stored count verifies, explicit and undefined count, upgraded hash with the same salt verifies and differs, `needsRehash` on null, undefined, 210000, 600000 and above, Vault key derivation unchanged for the same PIN and salt); `vite build` passes. Device pass (DP55) confirmed: the first unlock of the password and the first unlock of the Vault PIN each took longer (the upgrades); everything works after. Not verified: CI.

Verified after the removal: `vite build` passes; the 14 `crypto.js` checks still pass; the password-hash upgrade code is intact. Verified for batch numbering: 7 Node checks on `nextBatchStart` (highest of the same type, numeric not text order, types kept apart, no match gives 0, empty or missing index, oversized tail ignored, name taken literally); `vite build` passes. Not verified: the Node checks and builds here are not CI runs; the CI runs themselves are evidenced by the releases.

Open: Phase 17 (Vault key count, optional app-password wrapper), light-theme tuning (device review), each needing approval.

Next session start point: the owner picks among the open items (the app-password wrapper needs explicit approval; light-theme needs screenshots).

---

**Session 106**

Phase 18 C, first part (Decision 167). Fresh session; Tier 1 docs read, Tier 2 read for Decisions 152, 166 and the PDF architecture sections. The stray `native-setup.md` and `style.css` under `src/js/` are already gone from the repo.
- `src/js/pdfpages.js` (NEW): pure page functions. `applyPagePlan` (rotate, delete, reorder), `extractPages`, `parseRanges`, `splitPdf`, `mergePdfs`, `imagesToPdf`, `inspectPages`.
- `src/js/pdfpages-ui.js` (NEW) and `src/css/pdfpages.css` (NEW): Edit pages button, page grid, per-page rotate, move and delete, select, Save copy, Extract, Split, Reset, Discard on close.
- `src/js/app.js`: `saveMarkedPdf` takes a label suffix (default unchanged); page tools mounted after the mark-up, Back closes them first; a failure to load them leaves the tools before.
- Docs: ROADMAP (Phase 18 C split into C1 to C3, DP49), ARCHITECTURE (PDF page tools), DECISIONS (167).

Bugs fixed: none.

Decisions made: 167.

Verified in the authoring environment: 31 Node checks on `pdfpages.js` against pdf.js text extraction (reorder, repeated page, rotation added to an existing angle, extract order, split ranges, merge of 12 and 90 pages, range parsing and rejection, empty and out-of-range plans, 2001-page limit, damaged file, PNG to A4-fit landscape page); `vite build` passes. Not verified: CI, any device behavior (DP49), the editor screen (rotated thumbnails, card layout, buttons over the viewer), `saveMarkedPdf` with a suffix and the Vault path (import Capacitor, not run in Node), a password-protected file (message path only), JPEG input to `imagesToPdf`.

Device pass: DP49 confirmed.

Phase 18 C2 (Decision 168), on the owner's go-ahead after DP49.
- `src/js/pdfcompose-ui.js` (NEW): order sheet (`askCompose`) and picture to JPEG conversion (`toJpegBytes`).
- `src/js/pdfpages.js`: `mergePdfs` and `imagesToPdf` take items as bytes or functions and report the failing item's position.
- `src/css/pdfpages.css`: order sheet styles.
- `src/index.html`: Make a PDF button in the selection bar.
- `src/js/app.js`: `runMakePdf` in the selection wiring, `saveComposedPdf`, `activeCompose` in Back and in the lock dismissal.
- Entry through the existing selection mode instead of a file picker: sources are entries already in the app, read through their own decryption; the same route serves the Vault.
- Docs: ROADMAP (C2, DP50, DP49 confirmed), ARCHITECTURE (Merge PDFs and Make a PDF), DECISIONS (168).

Bugs fixed: none.

Decisions made (continued): 168.

Verified in the authoring environment: 35 Node checks on `pdfpages.js` (earlier 31 plus lazy items, failing item position for a merge and for a picture, lazy picture); a real JPEG (landscape 4:3, portrait 3:5) gives A4-fit pages 794x595 and 505x842 points; `vite build` passes. Not verified: CI, any device behavior (DP50), canvas conversion (`toJpegBytes` needs a browser), the order sheet, the selection bar width with the extra button, Vault path, a password-protected source (message path only).

Device pass: DP50 confirmed.

Phase 18 C3 (Decision 169), on "Next" after DP50.
- `src/js/pdfmarkconst.js`: picture sizes, maximum side, clear-background thresholds.
- `src/js/pdfmark.js`: `sign` mark drawn with the page rotation; one embedded copy per picture.
- `src/js/pdfmark-ui.js`: Picture tool, `buildPicture` (canvas to PNG, optional clearing of light pixels), size chips, Clear background, Choose or Change picture, preview addresses released on close.
- `src/css/pdfmark.css`: placed picture style.
- `src/js/app.js`: `pickImage` in the mark-up context (system picker after `beginPickerLaunch`).
- Docs: ROADMAP (C3, DP51, DP50 confirmed), ARCHITECTURE (picture mark), DECISIONS (169).

Bugs fixed: none.

Decisions made (continued): 169.

Verified in the authoring environment: placement of two pictures on 6 page configurations (rotation 0, 90, 180, 270, crop box, rotation with crop box) against pdf.js: both corners of each within 0.6 point, after composing the full transform chain; the same picture placed twice embeds one image and one mask; `vite build` passes. Not verified: CI, any device behavior (DP51), `buildPicture` (needs a browser), the picker return with the app lock, the bar with the extra row on a narrow screen, the Vault path.

Device pass: DP51 confirmed. Phase 18 is complete on device.

Phase 17 item I, chosen by me when asked for "next item is your call" (Decision 170). Reason: no new dependency, no change to existing hashes or backups, and it closes a real gap (nothing checked secret length). Haptics needs a new dependency and approval, light-theme needs a device review, the PBKDF2 count changes what existing hashes and backups depend on, the app-password wrapper is large.
- `src/js/passcheck.js` (NEW): pure strength check.
- `src/js/app.js`: `confirmStrength` and calls at first-run setup, Vault PIN setup, Backup now, the auto-backup banner, Drive Backup now.
- Docs: ROADMAP (I, DP52, DP51 confirmed, Phase 18 complete), ARCHITECTURE (weak-secret warning), DECISIONS (170).

Bugs fixed: none.

Decisions made (continued): 170.

Verified in the authoring environment: 12 Node checks on `passcheck.js` (empty, each threshold on both sides, repeated character, a single character, characters outside the basic range counted as one each, unknown kind, the secret not present in the message); `vite build` passes. Not verified: CI, any device behavior (DP52), the dialog over the first-run screen, the auto-backup banner staying open after Change it.

Device pass: DP52 confirmed.

Phase 17 item J, my pick again (Decision 171): backup passkey iterations to 600000 for new backups. Reason: the header already stores the count, so no format change and no conversion; it is the secret that gets attacked offline. Haptics still needs a new dependency and approval, light-theme needs a device review.
- `src/js/crypto.js`: `BACKUP_KDF_ITERATIONS` (600000), used by `encryptBackup`, exported.
- `src/js/backup.js`: format 2 writer uses the constant.
- Docs: ROADMAP (J, DP53, DP52 confirmed), ARCHITECTURE (backup key derivation, open list), DECISIONS (171).

Bugs fixed: none.

Decisions made (continued): 171.

Verified in the authoring environment: 6 Node checks on `crypto.js` (new archives carry 600000, round trip, wrong passkey refused, an archive made with 300000 still decrypts, format 2 chunk round trip at 600000, timing 142 ms to 282 ms on desktop); `vite build` passes. Not verified: CI, any device behavior (DP53), the real extra time on the phone, `createBackup` and `restoreBackup` end to end (they need the plugins; only the key derivation is exercised).

Open: DP53, Phase 17 (PBKDF2 count for the password hash and the Vault key, optional app-password wrapper), haptics (new dependency), light-theme tuning (device review), each needing approval.

Device pass: DP53 confirmed (backup and restore both worked with the new count). The owner reported that an Overwrite restore of 43 entries sat on "Replacing current data…" for a long time.

Bug fixed, in `src/js/backup.js` (`wipeCategories`):
- Cause: the wipe re-read every entry once per selected category (about 5 times the queries for ten categories), and the status did not change while it ran. Inferred from the code and the status shown, not measured on the device.
- Fix: one pass reading each entry once, deleting it when it matches any selected category, with a per-entry count in the status line.
- Why correct: the set of removed entries is the union of the categories' matches, the same as before; checked in Node against the previous function on a mock database (same rows left and removed for five category selections, queries 595 to 111 for 110 entries and all categories).

Device pass: DP54 confirmed (Overwrite restore is fast).

Next session start point: the owner picks among the open items. Haptics needs approval for a new dependency; light-theme tuning needs a device review; Phase 17 has the password-hash and Vault-key iteration count and the app-password wrapper.

---

**Session 105**

Phase 18 B (Decision 166). Fresh session; Tier 1 docs read, Tier 2 read for Decisions 152, 153, 165 and the Phase 17 and 18 roadmap lines.
- Approach changed with the owner's approval: own mark-up on `pdf-lib` instead of the pdf.js annotation editor (Decision 166).
- `src/js/pdfmarkconst.js` (NEW): colours, stamp labels, sizes, baseline constants.
- `src/js/pdfmark.js` (NEW): export. Displayed fractions to PDF space with rotation and crop box; highlight, draw, text, stamp drawn into the page; form fields listed and filled; password-protected files refused.
- `src/js/pdfmark-ui.js` (NEW) and `src/css/pdfmark.css` (NEW): Mark up button, bar (Highlight, Text, Draw, Stamp, colours, Undo, Form, Save, Close), per-page layers, form list, save choice (new copy or replace, replace confirmed twice).
- `src/js/pdfviewer.js`: `pageEls()`.
- `src/js/app.js`: `saveMarkedPdf`, mark-up context, mount after the reading tools (a failure to load it leaves the reading tools), Back closes form or mark-up first.
- `package.json`: `pdf-lib` 1.17.1.
- Docs: ROADMAP (Phase 17 D and E lines no longer say "until F"; Phase 18 B; DP48), ARCHITECTURE (PDF mark-up), DECISIONS (166).

Bugs fixed: none. Stale docs fixed: Phase 17 D and E lines.

Decisions made: 166.

Verified in the authoring environment: 6 page configurations (rotation 0, 90, 180, 270, rotation with crop box, crop box) against pdf.js viewport conversion: text position and upright, highlight rectangle, stamp text, own mapping equals pdf.js; forms (text, check box, dropdown, radio set and still fillable, unknown field reported); `?` for unsupported characters; password-protected file refused; 2001 marks refused; `vite build` passes (new chunks `pdfmark` 432 kB and `pdfmark-ui` 11 kB, viewer chunk unchanged). Not verified: CI, any device behavior (DP48), the bar over the bottom area, touch drawing next to pinch zoom, saving a large PDF, `saveMarkedPdf` and the Vault path (import Capacitor, not run in Node).

Device pass: DP48 confirmed, all checks (Mark up, Highlight, Draw, Text, Stamp, Undo, Form, Save new copy, Replace original, Discard, password-protected PDF, Vault, long PDF). No bug reported.

Open: Phase 18 C, Phase 17 open items, haptics and the light-theme pass, each needing approval.

Next session start point: Phase 18 C on approval (check `pdf-lib` bundle effect and CI first); Phase 17 open items, haptics and the light-theme pass also need approval.

---

**Session 104**

Phase 17 D wiring and E (Decision 162). Fresh session; Tier 1 docs read, Tier 2 read for Decisions 144 and 161 and ARCHITECTURE §3c.
- `src/js/files.js` (NEW): binds `filestore.js` to the device.
- `src/js/db.js`: `entries.file_key` column (create and `ensureColumn`), `insertEntry` takes it, `permanentlyDeleteEntry` removes the file.
- `src/js/app.js`: `initFiles(db)` after the database opens; `captureFile` saves through `files.js`; image, voice and PDF reads decrypt through it; thumbnail disk cache removed and `cache/thumbs/` purged at launch.
- `src/js/fileactions.js`: Share, Download and size through `files.js`.
- `src/js/fileopen.js`: `plainUriFor` (decrypted copy in `cache/open/` for encrypted files).
- `src/js/backup.js`: reads through `files.js`, drops `file_key` from both formats, restore writes through the streaming writer, overwrite wipe removes files, restored rows carry `file_key`.

Bugs fixed: none. Gaps closed: entry deletion left the file on disk; Home thumbnails were cached as plain JPEGs.

Decisions made: 162.

Verified in the authoring environment: 17 Node checks on `files.js` (round trips, streaming in odd pieces, empty file, abort, missing file, plain legacy file, key lookup for a row without `file_key`, copy under another name fails, master key stored once); `vite build` passes. Not verified: CI, any device behavior, `backup.js` restore paths (not run in Node: they import Capacitor), `permanentlyDeleteEntry` file removal, Home grid speed without the thumbnail cache.

Device pass: DP43 confirmed, all checks. Export Now, Restore (append: 38 exact duplicates skipped) and Restore (overwrite) with the safety backup (safety backup 24 of 38, replacing current data, 38 added) all finished.

Open: F, the migration of existing plain files (also the orphaned files from earlier versions). Phase 18 B, haptics and the light-theme pass each need approval.

Phase 17 F (Decision 163), started on the owner's "Start" in the same session after DP43 closed.
- `src/js/files.js`: `migratePlainFiles`, device `list`.
- `src/js/app.js`: runs it after the database opens, with a "Securing files" notice.
- Verified: 8 Node checks (3 files incl. empty, orphan sweep, missing source, write failure rollback, second run no-op) and the 17 earlier ones; `vite build` passes. Not verified: CI, device (DP44).

Update check for the private repo (Decision 164), on "Continue".
- `src/js/update-check.js`: token header, API asset url, new failure reasons.
- `src/js/update-install.js` (NEW): native download with the token, then the installer.
- `src/index.html`, `src/js/app.js`: token field in Settings > Updates, download via the installer.
- `scripts/patch-manifest.js`: `REQUEST_INSTALL_PACKAGES`.
- Verified: update check against stubbed responses (no token, newer, current, 401, 403, 404, 500, no APK); `vite build` passes; token, release list and signed-URL download checked with curl. Not verified: CI, device (DP45), the installer hand-off.

Rename to Arkly and CI filter (Decision 165), on "Start".
- DP44 confirmed on device (14 of 25 files secured on the first launch, app opened, files as before).
- Code, scripts, workflow, config and android notes renamed; persisted identifiers kept (Decision 165). `src/js/gdrive.js` still finds the earlier Drive folder. `.github/workflows/build-android.yml`: `paths-ignore` for docs-only pushes.
- Verified: `vite build`, syntax check of the patch scripts, JSON files parse. Not verified: CI, device (DP46).

Device pass, update check: DP45 partly confirmed. Token saved, the check found the newer build and enabled Download update. Download failed: "open failed: ENOENT" on `cache/update/`. Cause: `Filesystem.downloadFile` does not create the parent folder and ignores `recursive`. Fix: `mkdir` the folder first (`src/js/update-install.js`). Why correct: the plugin source opens a `FileOutputStream` on the resolved path with no folder creation.

Bug fixed (reported with screenshots): the lock screen kept "Wrong password." or "Biometric unlock failed" after a successful unlock and the next lock. Cause: the status line `password-hint` was only ever written, never cleared. Fix (`src/js/app.js`): it clears when the lock screen is shown (`showScreen`, which every lock path uses), when typing starts, and when a new attempt begins. Why correct: the line then reflects only the latest attempt.

Device pass: DP47 confirmed. DP45 and DP46 confirmed (update download and install, rename, docs-only commit starts no Actions run).

Decisions made (continued): 163, 164, 165.

Next session start point: delete the stray `src/js/native-setup.md` and `src/js/style.css` from the repo, then Phase 17 open items (PBKDF2 iteration count, passcode length warning, optional app-password wrapper) each needing approval.

---

**Session 103**

Phase 17 C cleanup (Decision 160). Fresh session; Tier 1 docs read, Tier 2 read for Decisions 144, 158, 159 and ARCHITECTURE §3c.
- `src/index.html`: Diagnostics group (Encryption test row) and the `encbench.js` script tag removed.
- `src/js/encbench.js`: deleted on GitHub (not deliverable as a file).
- Searched `src/`, `scripts/`, `.github/`, `capacitor.config.json`, `package.json`, `android-notes/` for `encbench`, `enc-bench`, bench, Diagnostics: no other reference. `encbench.js` imported only `@capacitor-community/sqlite` and `SCHEMA_SQL` from `db.js`; nothing imports it.

Phase 17 D started (Decision 161): `src/js/filestore.js` (NEW), not imported by any other file.
- Chunked AES-GCM files named `files/<32 hex>`, per-file key wrapped under a master key held in the `meta` table, streaming writer, plain-file fallback for files from before this stage.
- Call sites that must move to it, found by search: `app.js` (`captureFile`, `imageBlobUrl`, voice source, `readStoredBytes`), `fileactions.js` (Share, Download, size), `fileopen.js` (`openStoredFile`), `backup.js` (read, size, restore writes).

Bugs fixed: none.

Decisions made: 160, 161.

Verified in the authoring environment: `npm install` and `vite build` pass; no `encbench` or `enc-bench` string in the build output. `filestore.js`: 25 Node checks on real Web Crypto (round trips at chunk edges, streaming in odd pieces, plain fallback, no plaintext on disk, unique names, bit flip, truncation, extension, chunk swap, bad header, wrong path, wrong master key, abort, 41 MB). Not verified: CI, how Settings looks on a device, `filestore.js` speed on a device.

Device pass: DP42 check 5 confirmed (fresh install shows Database encryption On); DP42 closed, all checks. Cleanup cleared to commit.

Device pass: an append restore of a format 1 backup (made before Session 102) succeeded; format 1 restore confirmed on device.

Open: wiring Phase 17 D (with E), then F. Phase 18 B, haptics and the light-theme pass each need approval. Context ran low before the wiring.

Next session start point: wire `filestore.js` (Phase 17 D with E): `file_key` column and `ensureColumn`, the call sites listed above, thumbnail cache, file removal on delete. Then F, the migration of existing files.

---

**Session 102**

DP42 device pass on the encrypted database, then the backup crash it exposed (Decision 159), approved by the owner with the approach left to the assistant. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 144, 152, 158 and ARCHITECTURE §3, §3c and §4.
- DP42 checks 1 to 3 confirmed on device: Vault entries, images, PDFs and files open on the encrypted file; a reminder fires with Snooze and Done and repeats; nothing lost after lock and unlock. First Vault unlock after the install looked frozen until the biometric prompt was tapped; later unlocks about half a second. Logged as an observation, cause not identified.
- DP42 check 4 failed: Export Now froze, then "Arkly keeps stopping". Settings showed 19 entries and about 109 MB (Vault not counted).
- `src/js/backup.js`: format 2 writer and reader; restore split into shared helpers (`planEntryTarget`, `wipeCategories`, `insertRestoredEntry`, `restoreTagsAndSettings`); `readBackupHeader` added; format 1 reading and the Drive path untouched.
- `src/js/crypto.js`: chunk helpers, exports, faster `fromBase64`.
- `src/js/app.js`: Export Now shows "Backing up N of M"; restore reads the header first, passes the picked file for format 2, shows plain reasons for failures, and refreshes the lists when a restore stops part-way.
- Tested in Node (real crypto, real SQLite, in-memory and disk-backed file stubs): 37 checks pass; `vite build` passes; not run through CI.
- Device pass of format 2: Export Now with everything ticked finished and saved; Restore (append) reported 29 exact duplicates and added 0; Restore (overwrite) restored every file but the screen looked frozen for a while, then the app locked, and the first Vault unlock showed "Preparing Vault: 3 of 4" (expected, the metadata cache is rebuilt).
- `src/js/app.js`: idle auto-lock held during Export Now and Restore (`withoutIdleLock`); `src/js/backup.js`: `onPhase` text for the overwrite phases.
- Device pass of the rebuilt version: Restore (overwrite) with the safety backup showed each phase (safety backup 22 of 29, replacing current data, restoring 25 of 29, done), took a few minutes, restored all 29 entries and left the app unlocked. DP42 check 4 confirmed. The lock seen earlier did not return, which supports the idle-timer cause.

Bugs fixed:
- The app locked itself in the middle of a long overwrite restore. Cause (from the code, the screen showed no taps for minutes): the idle auto-lock timer fired, as nothing re-armed it. Fix: both idle timers held during backup and restore, re-armed after. Correct because the timers are the only path that locks on idle. The freeze looked longer than it was because the file check and safety backup had no progress text; both now do.
- Export Now crashed on large data. Cause: the whole archive lived in memory as several copies of one string, and the payload was built twice. Fix: format 2 writes one encrypted chunk per line and sizes the backup without building it. Correct because memory now follows one chunk (68 MB against about 990 MB on 150 MB of data in the same test).
- Restore of a large file would have failed the same way (whole file read and parsed). Fix: sliced reading, one entry at a time.
- A wrong passkey on a format 1 file raised an unhandled error. Fix: caught and reported.

Decisions: 159.

Next: DP42 check 5 (fresh install shows Database encryption On), then cleanup of `encbench.js` and the Diagnostics row. A format 1 backup from before this session, if the owner has one, is worth one append restore. Phase 17 D, Phase 18 B and the light-theme pass each still need approval.

**Session 101**

Phase 17 C, whole-database encryption (Decision 158), approved by the owner with the key-source choice left to the assistant. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 144, 152, 156, 157 and ARCHITECTURE §3 and §3c.
- Plugin check from the published 6.0.2 source: SQLCipher 4.5.3 on Android; the secret is held in Keystore-backed encrypted preferences. 8.x needs a newer Capacitor.
- `capacitor.config.json`: `androidIsEncryption: true`.
- `src/js/encbench.js` (new) and a Settings, Diagnostics, Encryption test row in `src/index.html`: scratch databases only, never `dumpzone.db`. Plain vs encrypted timing, FTS5 under SQLCipher, and conversion of a database with the real schema and a 10 MB blob. Removes its scratch files.
- `src/js/db.js`: random key (`ensureSecret`); new installs start encrypted; encrypted files open in `secret` mode; missing key stops with a clear message; `requestEncryption`, `getEncryptionResult`, `convertAtStartup` (flag cleared first, row counts compared, result stored); `checkConnectionsConsistency()` at every start.
- `src/js/app.js` and `src/index.html`: Settings, Security, Database encryption row (status, last attempt, Encrypt database with a warning dialog).
- `scripts/patch-manifest.js`: `android:allowBackup="false"` added after the permission step; tested on a mock manifest, safe to run twice.
- Confirmed on device: the scratch test (encrypted file, same search hits, small timing cost, 10 MB real-schema conversion in 666 ms); the owner's database converted, Settings shows On with "Last attempt: encrypted", Home counts unchanged.

Bugs fixed:
- In-app conversion hung on a sticky "Encrypting…" toast. Cause not identified; the live connection was closed and converted while the app ran. Fix: conversion moved to the next start, before any connection exists. Correct because the same sequence worked on scratch databases.
- Scratch test inserted rows without `created_at` and `updated_at` (required columns), and reused a file name that held an old encrypted file. Fix: columns added, files opened with the stored key and deleted. The first reading of both results was therefore wrong.
- An earlier note said the plugin stored its secret in plain preferences. It uses Keystore-backed encrypted preferences. Corrected before any decision was written.

Decisions made: 158.

Verified in the authoring environment: syntax check of every changed file; manifest script run on a mock file; plugin behaviour read from its published source. Verified on device: see above. Not verified: Vault entries, reminders, image and PDF opening, Export Now and Restore on the encrypted file, a fresh install starting encrypted (DP42).

Open: DP42. The Encryption test row can be removed once DP42 passes. If the Keystore key is lost the file is unrecoverable except from a backup. The optional password wrapper around the key is not built. D (per-file encryption), E and F remain; Phase 18 B and haptics still need approval.

Next session start point: DP42 on the owner's phone. Then remove the Encryption test, or Phase 17 D, Phase 18 B or haptics (each needs approval).

---

**Session 100**

Phase 15 item 4, entrance motion (Decision 155). Fresh session; Tier 1 docs read, Tier 2 read for Decisions 86 and 144 and ARCHITECTURE §3c. Credentials and backup are not touched.
- `src/css/style.css`: one appended block. `fade-in` on `.screen` and `.modal-overlay`, `toast-in` on `.toast`; all inside `prefers-reduced-motion: no-preference`.
- Sheets, buttons, switches and the auth screens already animated; left as they were.
- Repo layout note: source is in `src/`; `www/` is the `vite build` output.

Then, Vault unlock speed (Decision 156), approved by the owner after a report that the Vault opens slowly. Cause: the full index build on unlock decrypted and parsed every file entry's whole body (the file as base64) only to read its size and OCR text, and fetched those bodies through the plugin bridge, plus one tags query per entry. Fix:
- `db.js`: `encrypted_meta` column (`ensureColumn`, existing installs migrate on open).
- `vault.js`: `fileEntryMeta` (size, OCR text, body length under the Vault key; used only if it decrypts and the length matches, else rebuilt from the body and written back); `VAULT_INDEX_SQL` returns NULL for file bodies plus their length; one tags query for the whole build.
- `fileactions.js`: a Vault content edit clears `encrypted_meta`.
- `backup.js`: `encrypted_meta` is dropped from the export. Backup format, restore and the three credentials are untouched; a restored row has no record and gets one at the next unlock.
- Confirmed on device: DP38 (all items) and DP40.

- Confirmed on device: the Vault is fast after the first unlock (DP41, first part). Then a progress notice for the one-time build (Decision 157): `buildVaultIndex` takes an optional `onProgress`, called only while records are being built; `app.js` `buildVaultIndexWithNotice` shows a sticky toast "Preparing Vault: N of M" and hides it when the build ends. Used on unlock and after a restore.

Decisions made: 155, 156, 157.

Verified in the authoring environment: `vite build` passes; Node run of the new index on real crypto and SQLite with three entries (note, PDF, voice; 3 MB files): first build 831 ms and writes 2 records, second build 7 ms, sizes, OCR text and tags identical, a changed body is picked up, a wrong key lists entries unreadable without throwing. Not verified: unlock time on a device with a real Vault, CI.

Open: the first unlock after the update, or after a restore into the Vault, rebuilds the file records once (a notice shows progress). Haptics need a new plugin and approval. Light-theme tuning needs a device. Exits do not animate (hiding is `display: none`). DP38 (rest) not yet device-tested. CI result for the build with `@capacitor/device` still not reported.

Next session start point: DP41 confirmed on device. Then Phase 18 B (needs its own go-ahead), Phase 17 C (needs approval; starts with a plugin and speed check), or haptics (needs approval).

---

**Session 99**

Phase 18 A, PDF reading tools (Decision 153), approved in Decision 152. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 121, 125, 144, 148, 152 and the Credentials and PDF viewer parts of ARCHITECTURE. Credentials and backup are not touched.
- `pdfsearch.js` (NEW): pure helpers `pageItems`, `findInItems`, `normalizeQuery`, `stepMatch`, `firstHitFrom`, `clampPage`, `flattenOutline`.
- `pdfviewer.js`: text layer per drawn page (pdf.js `TextLayer`, released with the page); `search` (page by page, text cached only while Find is open), `stepHit`, `clearSearch`, `goToPage`, `currentPage`, `getOutline`, `attachThumbnails`.
- `pdftools.js` (NEW): tool buttons, Find bar, Pages panel (Pages and Outline tabs, go to page).
- `app.js`: `openPdf` mounts the tools after the document opens; `guard` makes Back close Pages, then Find, before leaving; `onClose` destroys the tools.
- `style.css`: text layer, highlight, Find bar and panel rules.
- Password-protected PDFs keep the inline prompt from Decision 125 (device-confirmed); the field is not moved to the text sheet.

Decisions made: 153, 154.

After delivery: DP38 on a small PDF passed (selection, Find, Pages, Outline, go to page). A 41.92 MB PDF that had never opened closed the app during loading. Decision 154 changes how Home PDFs are read (`readStoredBytes` in `app.js`); confirmed on device: the file opens (DP39).

Verified in the authoring environment: syntax checks, `vite build`, Node checks: a generated three-page PDF read by the bundled pdf.js (matches on the right pages and items, case folded, outline entries and a named destination resolved to pages 1 and 3), phrases across items and line ends, whitespace collapse, overlapping and capped matches, wrap-around stepping, page clamping. Read from the pdf.js source: `TextLayer.textDivs` is parallel to the items that carry a string. Not verified: how any of it looks or behaves on a device (selection handles, Copy, keyboard with the Find bar, panel layout, Back order), speed on a large PDF, CI.

Open: highlights cover the whole text element holding a match, not the exact characters. Copy from a Vault PDF puts text on the system clipboard (the person's own action, in line with Decision 41); it is not cleared automatically. A scanned PDF has no text to select or find (OCR excluded, Decision 152). Backups still save to the Documents root. `style.css` still carries rules for the removed `#vault-search-input` and `#vault-list`. CI result for the build with `@capacitor/device` still not reported.

Next session start point: device-test DP38 (rest) and DP39. Then Phase 18 B (needs its own go-ahead), or Phase 17 C or Phase 15 item 4.

---

**Session 98**

Phase 17 B (Decision 151), approved by the owner. Fresh start from the docs; Decision 144 and the Phase 17 spec read; credentials and backup are not touched by this item.
- `vault.js`: the per-row index build is now `indexEntryFromRow`; `refreshVaultIndexEntries(db, key, ids)` re-reads only the named rows and adds, replaces or removes them in the cache (a trashed, deleted or Home row is removed or ignored); `upsertIndexEntry` keeps database order through each row's `rowid` (`rid`). `buildVaultIndex` is the full build, now ordered by `rowid`.
- `app.js`: capture, edit (text, Money, repayment), trash, Undo, restore from Vault Trash, permanent delete and bulk delete call `refreshVaultIndexEntries` with the affected ids. Full builds remain on unlock, after a backup restore, and on the reminders-changed event (it names no entry).
- No change to backup, restore, credentials or stored data.
- Phase 18 planned (Decision 152): PDF viewer reading tools, mark-up and forms, page tools and image to PDF, approved by the owner, nothing built. Not started this session: context limit.

Decisions made: 151, 152.

Verified in the authoring environment: syntax checks, `vite build`, 12 Node checks against a stub database (full build when no index exists, one decrypt per edit, order kept, trash removes, restore returns to its `rowid` position, new entry appended, Home id never added, permanent delete removes, bulk, result equals a fresh full build, two queries per refresh). Not verified: real speed on a phone with a large Vault, CI.

Device results: DP37 passed (reported by the owner, no failures). Backups still save to the Documents root. `style.css` still carries rules for the removed `#vault-search-input` and `#vault-list`.

Next session start point: Phase 18 A (approved). Phase 17 C and Phase 15 item 4 stay open and need their own go-ahead.

---

**Session 97**

Phase 15 item 3 (Decision 149). Fresh session; Tier 1 and the Tier 2 docs read (Decisions 144 to 148, Credentials section of ARCHITECTURE). Phase 17 B was not started: it needs approval.
- `app.js`: `askText` single-field sheet (Cancel, Back and every lock close it; the field is emptied on close); `askYesNo` takes `explicitNo`; all 16 native `prompt()`/`confirm()`/`alert()` calls replaced; dead `promptForTags` and `promptForLabel` removed (nothing called them); stale comments removed.
- `index.html`: `#text-dialog`. `style.css`: `#text-dialog` stacks above the Save dialog.
- Replaced: wrong password, wrong PIN, failed Vault biometric, Drive connect error and the preview-only power message now toast; Delete permanently (Home and Vault Trash), Select delete and Clear older than 30 days ask through the Yes/No sheet; Drive passkey prompts and legacy expense edit use the text sheet; Drive restore mode asks Append or Overwrite through the Yes/No sheet.
- Behaviour fix: the old Drive restore mode `confirm()` read Cancel as Overwrite. Now only the Overwrite button selects it; Back or a lock cancels the restore.
- Device report: Money and Location read 0 B in the Storage breakdown and Your Data read ~0 B. Cause: sizes counted only file bytes or note text, and Your Data read the WebView's own storage estimate, which excludes files and the database. Fix: `fileactions.js` `rowExtraBytes` adds description, Money details, coordinates (16 B) and legacy expense fields; Your Data sums the Home entry sizes. Correct because it counts what the entry stores, from the same function the breakdown and Select files use.
- Restore check (Decision 150): `backup.js` `getStorageEstimate` now reads real free space with `@capacitor/device` (`realDiskFree`); unknown gives no block. `createBackup` also checks the encrypted file's real size before writing. `estimateRestoreSize` counts database rows, not only file bytes. `package.json`: `@capacitor/device` `^6.0.3`.

Decisions made: 149, 150.

Verified in the authoring environment: syntax check, `vite build`, 10 Node checks on `askYesNo` and `askText` (explicit No, dismissal, Yes, plain No, value returned, field emptied, Back, second call refused), a scan showing no native dialog call left in `app.js`, new element ids present once. Also: 12 Node checks on `rowExtraBytes`, `estimateRestoreSize` and `getStorageEstimate` with a mocked plugin (value, zero, missing, throws); `vite build` with the new plugin (the bundle contains `realDiskFree`); the plugin's published Android source read (StatFs on the data directory). Not verified: the real free-space figure on a device, CI with the new dependency, how the sheets look or stack on a device, keyboard raise, Back order, CI. The Drive and legacy expense paths cannot be reached on a device.

Device results: DP31 to DP36 all passed (reported by the user, no failures). The free-space reading is the data partition; a backup in Documents is assumed to share it (true on current phones). Backups still save to the Documents root. `style.css` still carries rules for the removed `#vault-search-input` and `#vault-list`.

Next session start point: Phase 17 B if approved, or Phase 15 item 4 polish. CI result for the build with `@capacitor/device` not yet reported.

---

**Session 96**

Phase 15 item 4d (Decision 148), requested after device use of the Vault PDF folder.
- Trash Undo, Home and Vault: Restore and Delete permanently both show an Undo toast. Permanent delete is deferred until the Undo window ends; `pendingPurge` / `flushPurge()` in `app.js`; `lockVault()` completes a Vault one.
- PDF viewer: pinch to zoom (`pdfviewer.js`, `pdfmath.js` `pinchZoom`, `nextZoom` steps from any value).
- PDF folder switch (Home and Vault) for in-app viewer on or off; setting `pdf_inapp_viewer`, added to backup settings keys; `openEntry` routes PDFs by it.
- Files: `app.js`, `index.html`, `pdfviewer.js`, `pdfmath.js`, `backup.js`.

Decisions made: 148.

Verified in the authoring environment: syntax checks, `vite build`, a Node check of the `nextZoom` and `pinchZoom` values. Not verified: the pinch gesture itself, the viewer's touch handling beside native scrolling, Undo timing on a device, the phone's PDF app launch for a Vault PDF, CI.

Open: pinch shows a scaled, softer page until release by design. DP31 to DP34 pending.

Next session start point: device-test DP31 to DP34; then Phase 17 B if approved, or Phase 15 item 3 or 4.

---

**Session 95**

Phase 15 item 4c, Vault parity (Decision 147). Fresh session; Tier 1 docs read, Tier 2 read for Decisions 143 to 146, the Vault, Phase 17 and Home tools sections of ARCHITECTURE. Item was marked as needing approval; started on the strength of the Session 94 start point.
- `index.html`: `#vault-tools` row replaces the Vault search box, Select files button and inline results list; new `#vault-trash-view` and `#vault-settings-view` (the settings card moved into it, Vault Trash section removed from it).
- `css/browse.css`: Vault tools row and view titles share Home's rules; settings card summary hidden in its view.
- `fileactions.js`: `getSelectableEntries` takes `scope` (`home` or `vault`).
- `app.js`: module-level `searchMode`, `searchRows`, `vaultTrashOpen`, `vaultSettingsOpen` and their close functions; `lockVault()`, `showScreen()` and `backAction()` close them; Vault Trash view built on `browse.js`; the search layer takes a source and reads the in-memory index in Vault mode; Select files scoped, Vault scope grouped by type; long-press selection in search follows the layer's source; old Vault search and Vault Trash code removed.
- Behaviour change: Home Select and the Home storage breakdown no longer list Vault items while the Vault is unlocked.

Decisions made: 147.

Verified in the authoring environment: syntax checks, `vite build` against the full repo, element ids cross-checked against `index.html` (only the known dynamically created ids differ), HTML nesting parsed with no errors, no stale references to removed ids in `app.js` or the markup. Not verified: how it looks or moves, Back order and keyboard on a device, Vault lock closing each new layer on a device, real SQLite restore and purge from Vault Trash, CI.

Open: `style.css` still carries rules for the removed `#vault-search-input` and `#vault-list` (harmless). DP31 and DP32 still pending. Backups still save to the Documents root.

Next session start point: device-test DP31, DP32 and DP33. Then Phase 17 B (Vault index updated per entry) if approved, or Phase 15 item 3 (capture flows in sheets) or item 4 polish.

---

**Session 94**

Phase 17 A, Vault labels encrypted (Decision 145). Approved as the first item in order. Fresh session; Tier 1 docs read, Tier 2 read for Decisions 142 to 144 and the Vault, Credentials and Backup sections of ARCHITECTURE.
- `db.js`: `encrypted_label` column (schema and `ensureColumn`), `insertEntry` writes it, `VAULT_PLACEHOLDER_LABEL` exported.
- `vault.js`: `saveVaultEntry` stores the placeholder and the encrypted label; `vaultRowLabel`; `migrateVaultLabels` (run at the start of `buildVaultIndex`, trash included); `loadVaultEntryContent` returns the decrypted label; index uses it.
- `fileactions.js`: Vault Share and Download use the decrypted label (file name too); `editEntry` writes `encrypted_label` for Vault rows.
- `app.js`: Vault trash list decrypts labels.
- `backup.js`: restore writes `encrypted_label`, re-keys it on a different-PIN append, skips the `(Restored)` label match for Vault entries, encrypts a pre-change label on the way in.
- ARCHITECTURE.md: label line, Reminder row, Phase 17 table updated.

- Bug fixed after device test: after the Vault lock button, Home showed no lock button. Cause: `refreshVaultGateView` ran its button toggle after an await, once the screen had already moved to Home, and hid the shared lock button there. Fix: it toggles the button and its disabled state only while the Vault is on view. Correct because the Vault's own gate states are the only ones that rule exists for; `showScreen` already sets the button for every other screen. Not yet run through CI.
- DP28, DP29 and DP30 confirmed on device.
- Home tools row, Trash folder, Search layer, shared sort and filter (Decision 146, Phase 15 item 4b). NEW `src/js/browse.js` (filter, period, sort, toolbar) and `src/css/browse.css`. `index.html`: tools row replaces the Settings tile, search box and Select files button; `#trash-view`; `#search-screen`; Trash removed from Settings; `i-restore` icon. `app.js`: overlay state and open/close functions, `showScreen` and `backAction` hooks, Trash, Search and Select files redrawn with the toolbar; Select files names are now escaped.
- Bugs fixed after the first device look at the tools row: (1) Trash showed nothing. Cause: `#trash-view` had been inserted inside the hidden `#folder-view`. Fix: moved it to be a child of `#home-tab`, confirmed by parsing the markup. Correct because `home-main` and `trash-view` are now siblings that `openTrash` and `closeTrash` toggle. (2) Select files had no usable Back. Cause: the dialog sits above the nav and the Back button's lit state was not refreshed. Fix: nav raised above the dialog while it is open, and Back state refreshed on open and close. (3) The Select dialog resized per type. Fix: fixed height, only the list scrolls, actions in one row. (4) Types needed sideways scrolling. Fix: chips wrap (all three toolbars). (5) The Search close button was a stray gradient square. Fix: a plain round button; the Search backdrop is now opaque.
- Tool tile labels removed on request (icon only; `aria-label` and `title` kept).
- Verified: `vite build` passes with the new files; 17 Node checks on `browse.js` (every sort, type and period filter, numeric names, counts, input not changed, toolbar markup). Not verified: how it looks or moves (no browser here), keyboard raise on Android, Back order on a device, CI.

Decisions made: 145, 146.

Verified in the authoring environment: syntax checks on all changed files; 4 Node checks against real SQLite (`node:sqlite`) and real Web Crypto: stored row has the placeholder and no plaintext label, `entries_fts` and `label_history` stay empty for Vault rows, decrypt round trip, wrong key gives `Unreadable item`, index search finds the label, plaintext rows (trashed too) migrate once, Home rows untouched.
Not verified: `vite build`, CI, the `app.js` trash change, the `backup.js` restore path (needs the Capacitor plugins), any device behaviour.

Open: freed pages and journal files may keep an old plaintext label until Phase 17 C. DP31 pending. Backups still save to the Documents root.

Next session start point: device-test DP31 and DP32, then Vault parity (Phase 15 item 4c), planned for a fresh session: a Vault tools row (Select, Search, Trash, Settings), Vault Trash as a folder view with decrypted labels (`vaultRowLabel`), Vault Search as the same grow-out layer reading the in-memory index and closing on Vault lock, Vault Select files with the shared toolbar. Reuse `browse.js` and `browse.css`; the Vault gate and lock paths (`lockVault`, `refreshVaultGateView`) must close every new layer. Phase 17 B follows if approved.

---

**Session 93**

Phase 4, Vault Location (Decision 142). Fresh session; Tier 1 docs read, Tier 2 read for the Vault, Location, Money and Reminder parts. The source lives in `src/` (not `www/`).
- `vault.js`: `location` content (`validLocation`, build and parse), index field `location`, decimal search text, size. Out-of-range or non-numeric coordinates are refused before encrypting.
- `fileactions.js`: Vault Location Share (name and map link) and Download (`.txt` with the decrypted note).
- `app.js`: `pickLocation(isVault)` shared by Home and Vault capture; chooser and paste dialog carry `isVault` (a Vault lock closes only Vault ones); no Verify link in the Vault; generic default name; `openLocation(item, isVault)` reads the index; `captureToVault` takes `location`; row dispatch opens Vault Location.
- Home Location behaviour is unchanged; its branch now calls `pickLocation(false)`.

- Vault made to match Home (Decision 143): Vault Money and Location default names as on Home; Verify link in the Vault; Vault rows show type and date; Vault Money, Reminder and Location Share and Download include the note; Home Share of Money, Reminder and Location sends the Download text (`fileactions.js`, `app.js`).

- Decision 144 recorded: staged plan for encryption at rest (Phase 17), with the backup rules. Plan only, no code.

Decisions made: 142, 143, 144.

Verified in the authoring environment: syntax checks, `vite build`, 34 Node checks on `vault.js` (build refuses 8 invalid inputs, accepts boundary values, parse round trip, unreadable and out-of-range text give null, stored row has NULL coordinate columns and no coordinate or note text, load decrypts, index and search by latitude, longitude, description and tag, wrong key still lists the entry, nothing inserted on refusal, note and reminder unchanged). Not run: the Vault UI on a device, real SQLite, GPS in the Vault, backup and restore of a Vault Location, `fileactions.js` Share and Download (syntax only), CI.

Open: a Vault label is plaintext, so a summary or place name used as the default name is stored unencrypted (Decision 143). Open in Maps from the Vault locks the Vault on return. DP28 pending. Backups still save to the Documents root. After a restore the dark-mode theme is not re-applied until relaunch (pre-existing).

Next session start point: device-test DP28 and DP29, then Phase 17 item A (Vault labels) if approved, or Phase 16 remaining items.

---

**Session 92**

Phase 4 Money capture, step 6 of Decision 124's build order: Vault Money. Fresh session; Tier 1 and Tier 2 docs read.
- `vault.js`: `buildVaultPlaintext` and `parseVaultPlaintext` carry the Money details JSON for `money` (checked with `Money.normalize` before encrypting); the index holds `money` and a search text (summary, person, category, method, repayment methods and notes) and the size.
- `fileactions.js`: Share and Download for a Vault Money entry give readable text (`.txt`); `editEntry` treats `money` as a content field, so it is re-encrypted.
- `app.js`: Vault New in the Money folder (form, then the Save dialog, default name `Money <time>`); rows show kind, amount, status and date; month header and loan totals from the unlocked index; viewer, Add repayment and Edit work for Vault entries. `renderMoneySummary` split into `paintMoneySummary` (ids prefixed `ms` for Home, `vms` for the Vault). `moneyHooksFor(isVault)`: a Vault lock closes only Vault Money dialogs. The Vault header is emptied when the folder closes or the Vault locks. The symbol is loaded on unlock.
- `index.html`: `#vault-money-summary` in the Vault folder view.
- DP23, DP24 and DP25 confirmed on device.
- Vault Reminder (Decision 140): the Vault capture card, rows, viewer, edit, restore and reschedule for Vault reminders; the notification, its snooze and every repeat occurrence read `Vault Reminder` (`notifications.js`, `vault.js`, `fileactions.js`, `db.js`, `app.js`). Checked in Node: 13 checks on the notification payloads (no name anywhere, actions kept, repeats, snooze, Home unchanged) and on storage and the index.
- Viewer header actions (Decision 141): Share, Download and Delete in the Money, Reminder, Location and Voice viewers (`app.js`).
- Bug found in the DP17 lock check (Decision 139): idle, background and screen-off Vault locks left the Vault content showing, with counts and no PIN prompt. `lockVault()` now redraws the gate, empties counts and search, closes a Select files screen with Vault items; the app lock closes the static overlays above the lock screen (`app.js`).
- Undo (Decision 137): toast with an Undo button after every delete, 6 seconds, restores from trash (`app.js`, `style.css`). Android Back and back gesture run the on-screen Back action (Decision 138, `app.js`).
- Follow-up (Decision 136): row action buttons glow individually, the row no longer reacts to them (`style.css`, `app.js`); every Download goes to `Documents/Arkly` with a ` (n)` suffix on a name clash; Location, Reminder and Money (and legacy Expense) download as readable `.txt`; a Download toast, or a failure toast, from one wrapper (`fileactions.js`, `app.js`).

Decisions made: 135, 136, 137, 138, 139, 140, 141.

Verified in the authoring environment: syntax checks, `vite build`, 27 Node checks on `vault.js` (details round trip, unreadable text gives null, invalid and overrunning details refused, ciphertext holds no amount or person, `money_json` NULL, label generic, description encrypted, index details and search by person, category, summary, repayment note and description, corrupt entry still listed, index cleared) and on the Share and Download text. Not run: the Vault UI on a device, real SQLite, backup and restore of a Vault Money entry, CI.

Open: Home Money Share sends the summary only (the Download empty-file gap is closed by Decision 136). A Vault Money Download and Share omit the note, which is not part of the decrypted content. Backups still save to the Documents root, outside `Arkly`. Other viewers still show only Edit in the header (Decision 134 open point), Money included. A single repayment cannot be edited in place. After a restore the dark-mode theme is not re-applied until relaunch (pre-existing). DP13 next-day fire and DP17 and DP26 confirmed on device. The device backlog is clear. DP13 confirmed on device; the rest of DP17 still pending. The Undo window is 6 seconds (`UNDO_MS`); left as is. The glow, `:has` rule, Download names, toast and `.txt` bodies are not run on a device; the naming and text bodies were checked in Node, `vite build` passes.

Next session start point: Vault Location, or Phase 16 remaining items. DP27 confirmed on device; the device backlog is clear.

---

**Session 91**

Phase 4 Money capture, steps 4 and 5 of Decision 124's build order (Settings currency symbol, expense detection removal). Fresh session; Tier 1 and the Money parts of the Tier 2 docs read.
- `index.html`: Currency tile under Preferences (chips, text field, Use this symbol, status line).
- `app.js`: `wireCurrencySettings` paints the chips from `Money.CURRENCIES`, validates a typed symbol, writes `currency_symbol`, redraws Home; repaints after a restore.
- `backup.js`: `currency_symbol` added to `APP_SETTINGS_KEYS` (export and restore both read that list).

- Step 5 (Decision 131): `intents.js` expense handler removed; `captureText` expense branch, `buildFromHandler` expense case, `promptExpenseFollowup` and its timeout constant removed from `app.js`; stale scaffold header comment replaced.
- Device feedback: steps 4 and 5 worked; Back did nothing on the Money form. `app.js`: `backAction()` closes the Money dialogs as Cancel, and the Money hooks refresh the Back button state (Decision 132).
- Decision 133: `askDiscard`, `formState` and a shared leave path; edit dialog, Money dialogs, coordinates paste, auto-backup banner, Settings and Vault Settings fields ask Discard when changed; passkey fields cleared after success. `moneyui.js` Cancel buttons use the shared path.
- Decision 134: row actions reordered to Edit, Share, Download, Delete; image viewer Delete red; Select files Delete a red bin; `fileactions.js` comment order.

Decisions made: 130, 131, 132, 133, 134.

Verified in the authoring environment: syntax checks, `vite build`, the validation rule run in Node against valid and invalid symbols (₹, Rs, CHF, kr accepted; empty, blank, six characters and a control character refused); `detectIntent` in Node: "spent 500 on groceries" and "I spent ₹1200 today" give none, the reminder phrase still gives reminder, label suggestion unchanged. Device checks later passed (see the next paragraph).

Open: Vault Money still a placeholder (step 6). A single repayment cannot be edited in place. After a restore the dark-mode theme and its switch are not re-applied until relaunch (pre-existing, not changed). DP14, DP15 and DP18 to DP22 confirmed on a device at the end of the session. Open: other viewers show only Edit in the header (Decision 134 open point).

Next session start point: Money step 6, Vault Money (Decision 124: JSON in `encrypted_body`, an unlocked-only index for totals). Decide first whether the other viewers get Edit, Share, Download and Delete in the header.

---

**Session 90**

Follow-up to Money step 3 after device checks.
- Cause found for "coming soon" on Home: the installed build held older source (Decision 127). Fixed by process, not code.
- Month header: Month and Year dropdowns with small previous and next buttons in one row (`app.js`, `style.css`).
- Payment methods: IMPS, RTGS, NEFT added (`moneyui.js`).
- Repayments section at the end of the form for Lent and Borrowed, with date, repaid by and note, + Add repayment, and remove (`moneyui.js`, `index.html`, `style.css`). `money.js` stores `method` on a repayment. The viewer line and Add repayment dialog show and ask the method (`app.js`).
- Money dialogs scroll when tall.
- Year control: five-year window around the shown year, oldest first, plus a typed year field (`app.js`, `style.css`).

Decisions made: 127, 128, 129.

Verified in the authoring environment: syntax checks, `vite build`, 32 new and 28 earlier checks on both dialogs in a simulated page. Not run: CI, a device, real SQLite, the header and form layout on a small screen.

Open: Settings symbol control (step 4). Expense detection still in `captureText` (step 5). Vault Money still a placeholder (step 6). A single repayment cannot be edited in place. DP18 still pending on a device, now including the repayments section and the new methods.

Next session start point: commit the changed files in one commit, install the newest build, run DP18. Then step 4, 5, 6.

---

**Session 89**

Phase 4 Money capture, step 3 of Decision 124's build order (Home UI). Fresh session; Tier 1 and the Money parts of the Tier 2 docs read.
- `moneyui.js` (NEW): `openMoneyForm` (kind, amount, person and due date for loans, category and method chips from recent values, date) and `openRepayDialog` (pre-filled with the remaining amount).
- `index.html`: `#money-dialog`, `#repay-dialog`, `#money-summary`.
- `app.js`: Home Money capture (form, then Save dialog), `editMoney`, `openMoney` viewer with repayments and Add repayment, month header with previous and next, Money row meta (settled greyed), expense rows open in the same viewer, symbol read from meta, dialogs close on lock.
- `fileactions.js`: `editEntry` writes `money_json`.
- `style.css`: month header, loan status pills.

Decisions made: 126.

Verified in the authoring environment: syntax checks, `vite build`, 28 checks on both dialogs in a simulated page against the real `index.html` (empty and invalid amounts, loan block, chips, kind fixed with repayments, amount below returned refused, unchanged date kept, overrun refused, partial then full return, cancel, forced close, hooks). Not run: INSERT and UPDATE against real SQLite, the viewer and month header on a device, search for a Money entry, CI.

Open: Settings symbol control (step 4). Expense detection still in `captureText` (step 5). Vault Money still a placeholder (step 6). Back does not close the Money dialogs. A repayment cannot be edited or removed. Device checks pending: DP17 remainder, DP13, rest of DP14 and DP15. Lock and power buttons still sit behind overlays. Picked audio files have no player. Battery-optimisation prompt and "X scheduled" indicator not built.

Next session start point: commit `moneyui.js`, `fileactions.js`, `index.html`, `style.css`, `app.js`; device-check Money on Home (add each kind, repayment to settled, edit, month header, search). Then step 4 (Settings: currency symbol), 5 (remove expense detection from `captureText`), 6 (Vault Money). Reminder text detection stays unless the person says otherwise.

---

**Session 88**

Phase 4 Money capture, steps 1 and 2 of Decision 124's build order. Fresh session; all docs read first.
- `money.js` (NEW): amount parsing to whole minor units, formatting (Indian grouping for ₹ and Rs only), kinds, repayments with derived status, normalize, JSON round trip, label summary, row mapper (legacy expense rows count as Spent), month totals (Net is Received minus Spent, loans excluded), loan totals, recent-values lists, currency list and symbol check.
- `db.js`: `money_json TEXT` added through `ensureColumn`; `insertEntry` writes it.
- `backup.js`: restore insert writes `money_json`. Export needed no change (`SELECT *`).
- `scripts/patch-mainactivity.js` deleted on GitHub (Decision 64 cleanup). Stale comments still name it in `build-android.yml`, `patch-screenlock.js`, `privacy-screen.js` and `native-setup.md`.

Decisions made: none.

Verified in the authoring environment: syntax checks, 11 Node test groups on `money.js` (parsing, formatting, normalize, repayment limits and status, JSON round trip, summary, row mapper, month boundaries, loan totals, recent values), INSERT column and placeholder counts, `vite build`. `money.js` is not imported yet, so it is not in the bundle. INSERTs not run against real SQLite; migration and restore not run on a device. Not run through CI.

Open: `editEntry()` in `fileactions.js` does not carry `money_json` yet (step 3). Device checks pending: DP17 (Back during the prompt, lock with the prompt open, reopen), DP13 (next-day fire), rest of DP14 and DP15 (Vault PDF, lock with it open). Lock and power buttons still sit behind overlays. Picked audio files have no player. Battery-optimisation prompt and "X scheduled" indicator not built.

Next session start point: commit `money.js`, `db.js`, `backup.js`; then Money step 3, Home: form, list rows, month header, repayment dialog, edit, search (touches `app.js`, `index.html`, `style.css`, `fileactions.js`). Then steps 4 to 6. Reminder text detection stays unless the person says otherwise.

---

**Session 87**

Phase 16 G: open Files with the phone's matching app (Decision 118). DP13 stays pending: its test reminder was cancelled, so the next-day fire of daily, weekly and monthly repeats is unconfirmed.
- `fileopen.js` (NEW): `openStoredFile`, `openDecryptedFile`, `purgeOpenCopies`, `mimeForExtension`; plain messages for no matching app and missing file.
- `app.js`: `openFile()` viewer (details plus Open with app); `openEntry` routes `file` rows to it; `cache/open/` purged on launch and on resume.
- `package.json`: added `@capacitor-community/file-opener` `^6.0.1`.

- Device feedback: the detail step was unnecessary. `app.js`: `openFile()` now opens the file at once (Decision 120); the viewer is removed. Rows show the extension in place of the folder icon (`rowIconHtml`, `.ext-badge`). `vault.js`: the index carries `extension`. `style.css`: badge sizes.
- Vault direction confirmed: keep it, opt-in by PIN, permanent once on (Decision 119). No code change.

- Phase 16 H: in-app PDF viewer (Decision 121). `pdfviewer.js` and `pdfmath.js` (NEW); `app.js`: `openPdf()` for PDF rows, Home and Vault, zoom buttons, page count, Open with app fallback for unreadable files; `style.css`: PDF mode; `package.json`: `pdfjs-dist` 4.10.38.
- Device feedback on G: Home file opens directly and the extension icon shows (confirmed).

- Device feedback: PDF viewer confirmed on a Home PDF.
- Long-press multi-select in every folder and search list, Home and Vault (Decision 122): `app.js` (`selection` state, `paintSelection`, `exitSelection`, long-press wiring, bar actions), `index.html` (`#select-bar`), `style.css`.
- Bottom bar lowered so its Back circle matches the floating Back (Decision 123): `style.css`.

- Device feedback: multi-select and nav alignment confirmed (DP16).
- Money capture designed with the person (Decision 124); no code written for it. Built next session so it gets a fresh context.
- Device feedback: protected-PDF message and fallback confirmed in Home and Vault; rename keeps the page (DP15).
- Device feedback: in-app PDF password confirmed in Home and the Vault (right password, wrong password, Cancel).
- In-app PDF password (Decision 125): `pdfopen.js` (NEW), `pdfviewer.js` (`askPassword` option), `app.js` (inline prompt, closes with the viewer), `style.css`.

Decisions made: 118, 119, 120, 121, 122, 123, 124, 125.

Verified in the authoring environment: syntax checks, `npm install`, `vite build`, extension-to-type lookup and badge rendering (case, dot prefix, four-character cap, empty, escaping) in Node. PDF: fit scale, pixel budget, page-at-scroll, zoom steps, base64 and error messages in Node; the bundled pdf.js parsed a two-page test PDF (page count, page sizes, text, bad input) in Node; `vite build` emitted the worker (about 1.36 MB) and viewer (about 380 KB) chunks. Password open: tested in Node against a real encrypted PDF (right password, wrong then right, give up, a throwing callback, an unprotected file never asks, garbage still errors); the prompt screen itself is not run on a device. Drawing onto a canvas was not run here: not run through CI, not run on a device. Multi-select: a simulated page test covered tap-opens, long press starts, the click after a long press is swallowed, taps toggle, row actions are ignored, movement cancels, Select all, bulk delete ids, exit on finish, exit on deselecting the last item, cancel, and a stale long press not eating the next tap. Nav alignment is a CSS change measured from your screenshots (Back circle 44 px up against 32 px, at 1.5 pixel density); not seen on a device. Not run through CI, not run on a device. The plugin's native code and file provider were read from the published package, not compiled here.

Device checks (DP14): Home, Files folder: the row icon reads PDF, DOCX and so on; tap a row and the matching app opens at once (try a text file and a document). A file with no extension: the app list appears. A file type with no app: a plain message. Vault: same, then confirm the Vault locks per its settings. Return to Arkly and open the next file: no stale copy opens. Search for a file name and open it.

Open: DP13 next-day fire. PDF entries still show the "coming later" toast. Lock and power buttons still sit behind overlays. Picked audio files have no player. Battery-optimisation prompt and "X scheduled" indicator not built.

Next session start point: device-check DP17 (PDF password), DP13 (6 am repeat), the rest of DP14 and DP15. Then build Money (Decision 124) in the roadmap order, starting with `money.js` and its tests. Reminder text detection stays unless the person says otherwise.

---

**Session 86**

Device pass DP1 to DP12, with fixes found along the way (Decisions 110 to 114). Passed on device: backup and restore in Append and Overwrite (name, tags, description kept); credentials and lock; biometrics; location capture and viewer; update check; look; batch add numbering; row actions; folder counts; reminder dialog; install over an older build with a reminder pending; Done for now and Repeat set to none.
- `index.html`: restore file input accepts any type, so Android lists `.dz` backups (Decision 110). New Yes/No sheet (`#yesno-dialog`) (Decision 114).
- `app.js`: after a restore the Vault index is rebuilt and Home and Vault lists redraw (Decision 111). Location capture shows "Fetching location…" and disables the New buttons while a fix is pending (Decision 113). Discard and Back in a capture Save dialog ask Yes/No (Decision 114). `toast()` gained a sticky mode and `hideToast()`. Back answers No while the Yes/No sheet is open. Text editor and voice recorder Back ask Yes/No instead of tap-twice (Decision 115); the viewer shell's `back` awaits an async `guard()`.
- `geoparse.js` (NEW): offline `parseCoordinates` and `resolveShortLink` (Decisions 116, 117). Node-tested with a mocked redirect: pairs, N/S/E/W, `geo:`, `!3d!4d`, `@`, `q=`, range errors, short-link redirect, off-domain redirect, redirect loop, offline.
- `index.html` / `app.js` / `style.css`: New in Location asks current location or coordinates; paste dialog with live preview, Verify link for short links, Back to coordinates loop (Decisions 116, 117). `saveLocation()` factored out.
- `style.css`: `#yesno-dialog` raised to `z-index: 12`; it first opened behind the Save dialog (11), so Discard and Back looked dead (Decision 114).
- `backup.js`: Append restore ignores trashed rows in both the UUID and label checks; a trashed id gets a fresh UUID for the restored copy (Decision 112).

Decisions made: 110, 111, 112, 113, 114, 115, 116, 117.

Verified in the authoring environment: syntax checks on every changed file. Device-confirmed: restore picker, Vault refresh after Append, Append with a trashed duplicate, and everything listed as passed above. Decision 113 (Location fetching message) device-confirmed. Decision 114 failed its first device check (sheet hidden behind the Save dialog); fixed with a z-index and then device-confirmed. Decision 115 device-confirmed. Decisions 116 and 117 device-confirmed: the New chooser, the paste dialog, Verify link on a real `maps.app.goo.gl` link (`CapacitorHttp.get` with `disableRedirects` returned the redirect; preview showed the coordinates and place name), Continue into Save, a bad pair rejected, Verify link with no internet, Back to coordinates keeping the text.

Open: DP13 next-day fire of daily, weekly and monthly repeats. Lock and power buttons still sit behind overlays. Picked audio files have no player. Battery-optimisation prompt and "X scheduled" indicator not built.

Next session start point: finish DP13, then Phase 16 G (open Files with a phone app) or H (PDF viewer); both choices still open. Money capture shape still to be given.

---

**Session 85**

Device pass on Sessions 83 and 84, with fixes found along the way (Decisions 106 to 109). Passed on device: Back over the editor, the Save dialog and the lock screen; Home image grid; viewer gestures, rename, delete; Vault images and lock; open an image from search; Snooze and Done from the shade with the app open; daily repeating reminder firing, Done, Snooze.
- `style.css`, `app.js`: viewer stage fixed so tall images fit; viewer made full-bleed; Share, Download, Delete, Edit and the count moved into a thin header (Decision 109).
- `crypto.js`: `toBase64` chunked; a photo could not be saved to the Vault (call stack overflow). Vault pickers now take several files (Decision 109).
- `db.js`, `app.js`: Home search rebuilt: stored index, safe word-prefix query, substring pass (Decision 106).
- `notifications.js`, `reminders.js`, `app.js`, `patch-reminder-actions.js`: repeating reminders scheduled as a window of occurrences and topped up on launch and resume (Decision 107); Done on a repeating reminder is this time only, with the next due shown (Decision 108). First build scheduled nothing for a full window because the plugin rejects an empty cancel list; guarded.

Decisions made: 106, 107, 108, 109.

Verified in the authoring environment: syntax checks, `vite build`, gesture, search and occurrence logic against real SQLite and a scratch DOM, `javac` syntax pass on the receiver. Device-confirmed: everything listed as passed above.

Open: the Device pass backlog (ROADMAP, DP1 to DP13), including the day-after fire of a daily repeat and weekly and monthly repeats. The Android picker app "Photos and videos" crashes if a screenshot is taken while it is open; it is the system app, not Arkly. Lock and power buttons still sit behind overlays. Picked audio files have no player. Battery-optimisation prompt and "X scheduled" indicator not built.

Next session start point: run the Device pass backlog (ROADMAP DP1 to DP13) one check at a time, as one question per check, before any new work. Then Phase 16 G (open Files with a phone app) or H (PDF viewer); both choices still open. Money capture shape still to be given.

---

**Session 84**

Phase 16 D: image thumbnail grid and full-screen viewer (Decision 105).
- `app.js`: thumbnail pipeline (lazy tiles, two decodes at a time, 320 px JPEG; Home cached in the cache directory, Vault in memory only and emptied by `lockVault()`); `attachZoomPan()` (pinch, pan, double-tap, swipe); `openImageViewer()` with Share, Download, Delete, Edit; image folders in Home and the Vault render a grid; `openEntry` opens image rows from search.
- `style.css`: grid, stage, arrows, counter.

Decisions made: 105.

Verified: `app.js` syntax check, `vite build`, gesture logic in a scratch DOM (swipe, short drag ignored, pinch, clamped pan, double-tap in and out, cancel). Not run through CI, not run on a device.

Device checks: Home, Image folder: tiles fill in as you scroll; tap one; swipe left and right, use the arrows; pinch in, drag, double-tap out; Share, Download; Edit a name and see the title change; Delete lands in Trash and moves to the next image. Reopen the folder: thumbnails appear faster. Vault: same, then lock while the viewer is open: it closes and nothing remains. Search for an image name and open it. Check a large camera photo and a portrait photo (orientation).

Open: first open of a large folder is slow. Full-size images are not downscaled in the viewer. Picked audio has no player. Repeating reminders unverified. Device pass on Sessions 59 to 74 still pending outside reminders.

Next session start point: device-check Session 84, then Phase 16 G (open Files with a phone app) or H (PDF viewer); both choices still open. Money capture shape still to be given.

---

**Session 83**

Device pass on Session 82: voice recorder and player confirmed working. Then Back visible and working on every screen (Decision 104).
- `app.js`: bottom nav no longer hidden on the lock, first-run and ad-gate screens (Back only there); a class observer sets `overlay-open` while the editor, viewer, Save dialog or any modal is open; `backAction()` now closes the static modals through their own cancel or close buttons before the existing order.
- `style.css`: Back-only nav layout, raised above overlays, and bottom padding on each overlay so its controls stay clear of the button.

Decisions made: 104.

Verified: `app.js` syntax check, `vite build`, the observer and disabled-state logic in a scratch DOM (opens, closes, no feedback loop). Not run through CI, not run on a device.

Device checks: open a note editor, a reminder, a voice entry, the Save dialog, the New chooser and Select files; Back shows centred at the bottom each time and dismisses that layer, with no control hidden behind it (check the editor's last line and the Save dialog's buttons). Lock screen and first-run: Back is visible and dimmed. Home and Vault landing: dimmed as before. Vault gate locked: dimmed. Keyboard open in the editor: Back should not cover the text being typed.

Open: lock and power buttons are still hidden behind overlays. Picked audio files have no player. Repeating reminders unverified. Device pass on Sessions 59 to 74 still pending outside reminders.

Next session start point: device-check Session 83, then Phase 16 D (image thumbnail grid and viewer). Open choices for G and H. Money capture shape still to be given.

---

**Session 82**

Phase 16 C: voice recorder screen and player (Decision 103).
- `app.js`: top-level `createAudioPlayer()` (play/pause, scrub, speed); `startVoiceRecordingUI()` rebuilt as a recorder screen (ready, recording, review, then the Save dialog) for Home and the Vault; `openVoice()` viewer for saved recordings, wired into `openEntry`. Viewer shell gained `onClose`, `guard` and a hidden Edit button when unused; Back goes through the guard. Vault MIME map now knows aac and webm.
- `style.css`: player and recorder styles.

Decisions made: 103.

Verified: `app.js` syntax check, `vite build`, player behaviour run against a stub audio element in a scratch DOM (play/pause label, seek, no jump while dragging, speed, replay after end, fallback length). Not run through CI, not run on a device.

Device checks: Home, Voice, Record: timer counts, Stop opens review, play, scrub, 2× speed, Save, name it; the row opens the player and the audio plays. Back during recording asks twice. Repeat in the Vault (open, play, lock: playback stops). Check that the saved aac plays; if the player reports an error, note the recorder's mime type from the file extension.

Open: whether `<audio>` plays every recorder container on the device. A lock during recording discards the take. Picked audio files are still saved as plain Files (no player). Repeating reminders unverified. Battery-optimisation prompt and "X scheduled" indicator not built. Device pass on Sessions 59 to 74 still pending outside reminders.

Next session start point: device-check Session 82, then Phase 16 D (image thumbnail grid and viewer). Open choices for G and H. Money capture shape still to be given.

---

**Session 81**

Device pass on Session 80 (Decision 102). No code changed.
- CI built and signed the APK with the patched plugin and receiver.
- Reminder fired; Snooze and Done each acted from the notification without the app opening.

Decisions made: none.

Open: shade tap while the app is open (row update within a few seconds) and an install over an older build with a pending reminder not yet checked. Repeating reminders unverified; the plugin appears to ignore `every` when `at` is set. Battery-optimisation prompt and "X scheduled" indicator not built. Notification small icon drawable. Play distribution deferred (Decision 98). Device pass on Sessions 59 to 74 still pending outside reminders.

Next session start point: Phase 16 C (voice recorder and player). Open choices for G and H. Money capture shape still to be given.

---

**Session 80**

Snooze and Done from the notification without launching the app (Decision 102).
- Built `scripts/patch-reminder-actions.js`: writes `ReminderActionReceiver.java`, registers it in the manifest, and patches the plugin's action buttons to send a broadcast instead of an activity intent. Added as a CI step in `build-android.yml`, after the screen-off patch and before Gradle.
- Receiver dismisses the notification, cancels (Done) or schedules (Snooze, 10 min, `allowWhileIdle`) natively, and queues `{a, e, t}` in the Preferences store.
- `app.js`: `drainQueuedReminderActions()` applies the queue to the database at startup, on resume, and every 4 seconds while visible; one-time reschedule of live reminders (`reminder_actions`) so existing notifications get the new buttons; old listener and minimise rule kept as fallback.

Decisions made: 102.

Verified: `npm install`, `vite build`, `cap add android`, all patch scripts run in order on a scratch copy (second run of the new script is a no-op), patched plugin block and manifest entry read back, `javac` syntax pass with only missing-symbol errors, `app.js` syntax check, workflow YAML parses. Not compiled against Android, not run through CI, not run on a device.

Device checks: install the build, set a reminder 2 minutes ahead, close the app from recents, tap Snooze on the banner: no app appears, a second banner arrives 10 minutes later, opening the app shows "Snoozed until <time>". Repeat with Done: row greys. Also tap a button from the shade while the app is open: the row updates within a few seconds. Install over an older build with a pending reminder: it still works (old buttons) until rescheduled.

Open: row state lags the tap until the app drains the queue. Repeating reminders unverified; reading the plugin suggests `every` is ignored when `at` is set (no `repeats` flag passed), so a repeat may not recur. Battery-optimisation prompt and "X scheduled" indicator not built. Notification small icon drawable. Play distribution deferred (Decision 98). Device pass on Sessions 59 to 74 still pending outside reminders.

Next session start point: device-check Session 80, then Phase 16 C (voice recorder and player). Open choices for G and H. Money capture shape still to be given.

---

**Session 79**

Device pass on the reminder work from Sessions 75 to 78; screen recordings reviewed. No code changed.
- Reminder fired on time with the app closed and battery saver on (Decisions 97, 101).
- Snooze 10 min: app appears for about a second, then returns to the launcher; the row reads "Snoozed until <time>" and stays active (Decisions 99, 100).
- Done: same brief appearance and return; the row greys as Done.
- A reminder that had already fired earlier and was snoozed from its notification shows its own snooze time, as intended.

Decisions made: none.

Open: the brief appearance on Snooze and Done is the plugin's activity intent; removing it needs a native receiver patch (not built). Repeating reminders unverified. Battery-optimisation prompt and "X scheduled" indicator not built. Notification small icon drawable. Play distribution deferred (Decision 98); both exact-alarm permissions are restricted there.

Next session start point: snooze and Done from the notification without opening the app (native receiver patch in CI; handle the database update natively or by a background-safe route; keep the lock rules, the snoozed state and the `allowWhileIdle`/exact scheduling intact; check against ARCHITECTURE.md Credentials first). Then Phase 16 C (voice recorder and player). Open choices for G and H. Money capture shape still to be given. Device pass on Sessions 59 to 74 still pending outside reminders.

---

**Session 78**

Reported: a reminder due 5:20 am did not notify while the app was closed and appeared once the app was opened, though earlier tests fired on time (Decision 101).
- Cause: `allowWhileIdle` alarms are inexact; under Doze they can be held for minutes. The earlier on-time results were not a guarantee.
- Fix: `USE_EXACT_ALARM` and `SCHEDULE_EXACT_ALARM` added to `scripts/patch-manifest.js`, so the plugin schedules with `setExactAndAllowWhileIdle`. Still a banner, no alarm UI. `native-setup.md` updated.
- Finding: the reference app's reminders fall at random times in multi-hour windows, so its closed-app delivery says nothing about punctuality.

Decisions made: 101.

Verified: `node --check`, patch script run against a sample manifest (inserts both, second run is a no-op), plugin source read for the exact-alarm branch. Not run through CI or on device; the exact delivery was not exercised.

Device checks: install the new build, set a reminder 2 minutes ahead, close the app from recents, turn the screen off; the banner appears at the set minute. Repeat after the phone has sat idle for 30+ minutes. If it is still late, set Arkly to unrestricted battery use and allow autostart in the phone's app settings, then retest, and report phone make and Android version.

Open: phone-maker battery limits (battery-optimisation prompt not built). Repeating reminders unverified. Notification small icon drawable. Play distribution: both exact-alarm permissions are restricted there.

Next session start point: Phase 16 C (voice recorder and player), after the device pass on Sessions 59 to 78. Open choices for G and H. Money capture shape still to be given.

---

**Session 77**

Device result (Session 75 build; Session 76 files not yet committed): Snooze 10 min fired its second notification. Done also opened the app (Decision 100).
- Snooze delivery confirmed: Decision 97's `allowWhileIdle` works for the snooze notification.
- Cause for Done opening the app is the same as Snooze (Decision 99): the plugin's action buttons are activity intents.
- Change: after a Snooze or Done is handled, `App.minimizeApp()` returns the person to where they were, only when the button launched the app (6-second window since last resume). Open-app taps are left alone.

Decisions made: 100.

Verified: `node --check`, `vite build`, `minimizeApp` present in `@capacitor/app` 6 types. Not run through CI or on device; the minimise behavior and the window heuristic were not exercised.

Device checks: with the app closed, tap Done and Snooze on a banner; the app flashes briefly then goes back to the launcher or previous app. With the app open and unlocked, pull the shade and tap Done; the app stays open and the row updates. Reopen the app after either: it shows the lock screen if a password is set.

Open: the brief flash remains; removing it needs a native receiver patch. Repeating reminders unverified. Battery-optimisation prompt, "X scheduled" indicator, notification small icon drawable.

Next session start point: Phase 16 C (voice recorder and player), after the device pass on Sessions 59 to 77. Open choices for G and H. Money capture shape still to be given.

---

**Session 76**

Reported: reminder fired on time with the app closed. Tapping Snooze 10 min on the notification opened the app, and the row went grey; unclear whether the snooze would fire (Decision 99).
- Opening the app is plugin behavior (action buttons are activity intents in 6.x). Snooze itself is scheduled from the database before unlock, so it does not depend on the lock state.
- Added a `snoozed` reminder state using the existing `snoozed_until` column. The row shows "Snoozed until <time>" and stays active; the viewer shows a Snoozed pill. Done or a new time clears it.
- The list redraws when a notification action arrives while the app is open.

Decisions made: 99.

Verified: `node --check`, `vite build`, status helper test (one-off past, snoozed, expired snooze, future, done, repeating snoozed). Not run through CI or on device; the snooze notification firing and the row display were not exercised.

Device checks: let a reminder fire, tap Snooze 10 min, unlock; the row is not grey and reads "Snoozed until" about 10 minutes ahead; close the app and wait; a second banner appears near that time; afterwards the row reads Fired. Tap Done on a snoozed one: row greys as Done and no second banner appears. Repeat with the app already open and unlocked: the row updates without reopening the folder.

Open: Snooze and Done still open the app (see Decision 99); removing that needs a native receiver patch.
Open: repeating reminders unverified (Session 75). Battery-optimisation prompt, "X scheduled" indicator, notification small icon drawable.

Next session start point: Phase 16 C (voice recorder and player), after the device pass on Sessions 59 to 76. Open choices for G and H. Money capture shape still to be given.

---

**Session 75**

Reported: another app's reminders fire while closed and under battery saving; asked to compare and to record that Play distribution is revisited when the app is ready (Decisions 97, 98).
- Compared the reference app's reminder scheduling with this one. Difference: it schedules with `allowWhileIdle: true`; this app did not. Confirmed against the installed 6.1.3 plugin source: without the flag the alarm is `set(RTC)`, non-waking.
- Fix: `allowWhileIdle: true` on reminder and snooze schedules. This supersedes the exact-alarm proposal from Session 74 (Decision 97).
- Recorded: Play distribution deferred until the app is fully ready (Decision 98).

Decisions made: 97, 98.

Verified: `node --check`, `vite build`, plugin source read. Not run through CI or on device.

Device checks: install, set a reminder 3 minutes ahead, close the app from recents, turn the screen off and wait; the banner should appear within a few minutes. Repeat with battery saver on. Report delay observed and phone make if it still waits for the app to open.

Open: repeating reminders (daily, weekly, monthly) are unverified; the plugin call passes `every` without `repeats`. Test one on a device, then decide on a schedule-ahead approach.
Open: battery-optimisation prompt and "X scheduled" indicator (documented, not built); notification small icon drawable.

Next session start point: Phase 16 C (voice recorder and player), after the device pass on Sessions 59 to 75. Open choices for G and H. Money capture shape still to be given.

---

**Session 74**

Reported: a reminder due 5:39 pm showed in the shade only after the app was opened at 5:40; wanted a subtle banner like a calendar reminder, no alarm behaviour (Decision 96).
- Reminders now use a high-importance banner channel with the system's default sound (`dumpzone_reminders_v2`). The old channel is deleted once and live reminders are scheduled again on the new one at launch.
- Finding: the lateness is not caused by the notification style. Scheduling is inexact (no exact-alarm permission), so Android can hold it back under battery saving until the app wakes. Two compensations documented in ARCHITECTURE (battery-optimisation exemption prompt, "X reminders scheduled" indicator) are not built; nothing in `src/` implements them.
- Finding: the notification shows a generic blue info icon. `capacitor.config.json` names `ic_stat_notify`, but no step in the repo creates that drawable.

Decisions made: 96.

Verified: `node --check`, `vite build`. Not run through CI or on device; the channel migration and the banner look were not exercised.

Device checks: install over the existing app, set a reminder 2 minutes ahead, leave the app; a banner with the default sound should appear. Check Settings, Apps, Arkly, Notifications: only "Reminders" listed, set to pop on screen. An old reminder still upcoming before the update should still fire.

Open (needs approval): exact timing via `USE_EXACT_ALARM` in `patch-manifest.js`. Same plain banner, no alarm screen or sound; only the time becomes reliable. Reverses the "inexact" part of Decision 3.
Open: battery-optimisation prompt and "X scheduled" indicator (documented, not built).
Open: notification small icon drawable `ic_stat_notify` needs a CI step.

Next session start point: Phase 16 C (voice recorder and player), unless the open items above are chosen first. Open choices for G and H. Money capture shape still to be given. Device pass on Sessions 59 to 74.

---

**Session 73**

Reported: a reminder did not notify (Decision 95).
- Finding: the screenshot shows the reminder stored as due 11:46 pm, about 11 hours after the screenshot time (12:46 pm). Scheduling and time parsing read correctly in code; nothing was due. Most likely the AM/PM field of the date-time picker was left on PM.
- Change: saving a one-time reminder now confirms the time and the distance to it, e.g. "Reminder set for Fri 2 Oct, 11:46 pm · in 11 h". Applies on create and on edit.

Decisions made: 95.

Verified: `node --check`, `vite build`, helper output for minutes, hours and days. Not run through CI or on device. The cause is inferred from the screenshot; a reminder that is genuinely due and silent has not been reproduced.

Device checks: create a reminder 2 minutes ahead with the app closed and the screen off; the toast shows "in 2 min"; confirm a notification appears and its tone plays. If it does not, report phone make and Android version.

Open (needs approval): `SCHEDULE_EXACT_ALARM` is deliberately not requested (native-setup.md), so on Android 12+ delivery uses inexact scheduling and can run late under battery saving. Vendor battery optimisation can also hold it back. Say if the notification should be requested as exact (adds `USE_EXACT_ALARM`; reverses part of the reminders-are-notifications rule).

Next session start point: Phase 16 C (voice recorder and player). Open choices for G and H. Money capture shape still to be given. Device pass on Sessions 59 to 73.

---

**Session 72**

Three reported bugs from device recordings (Decision 94).
- Typed password stayed in the lock screen field after the app locked, so anyone could press Unlock. Same for the Vault PIN field after the Vault locked.
- Lock button did nothing on Home until Vault was opened and left again.
- Lock button on Settings (and Home) only took the user back to Home, like Back.

Bugs fixed:
- Cause (1): nothing ever emptied the inputs. Fix: `clearSecretInputs()` empties every password field when the lock screen shows and the Vault fields in `lockVault()`; also called after each successful unlock. Correct because every lock path (button, idle, background, screen off) goes through `showScreen('lock-screen')` or `lockVault()`.
- Cause (2, 3): the lock button chose Vault or app by whether `#vault-content` was visible. `lockVault()` never hides it and leaving the Vault does not either, so from Home the button kept locking the Vault (already locked, then a jump to Home). Fix: choose by `currentLocation === 'vault'`. Correct because that value is set by every screen switch and is the same value Back uses.

Decisions made: 94.

Verified: `node --check`, `vite build`, headless test of `clearSecretInputs` (Vault-only and all fields; non-password fields untouched). Not run through CI or on device; the button routing was reasoned from the code and the recordings, not exercised.

Device checks: unlock with the typed password, lock with the button, confirm the field is empty; same after idle lock, switching apps, screen off; Vault PIN field empty after Vault lock; lock button on Home and on Settings shows the lock screen, with the Vault open earlier and not; in the Vault it still locks the Vault and returns Home; biometric unlock unaffected.

Open: locking the app from Home does not lock an unlocked Vault (independent locks, Decision 65). Say if the button should lock both.

Next session start point: Phase 16 C (voice recorder and player). Open choices still to confirm for G and H. Money capture shape still to be given. Device pass on Sessions 59 to 72.

---

**Session 71**

Phase 16 F (Decision 93).
- Location rows open in a viewer on the shared shell: coordinates as degrees with N/S and E/W, a grid plot of the point, label, decimal values, description, tags, saved time. Pencil edits details.
- Actions: Open in Maps (`geo:` URI, phone's maps app) and Copy (coordinates to clipboard). Share stays on the row.
- The plot is inline SVG: 30° grid, equator and prime meridian stronger, a ring and pin at longitude and latitude. No tiles, no coastlines, no network.
- An entry with no stored coordinates shows a plain notice and no actions.
- Main app only; Vault Location has no capture yet, so it still shows the toast.

Decisions made: 93.

Verified: `node --check`, `vite build`, helper test for coordinate formatting and pin placement (including the poles and antimeridian clamp). Not run through CI or on device; the viewer render, `geo:` hand-off and clipboard were not exercised.

Device checks: save a location and tap its row; coordinates and pin look right in both themes; Open in Maps launches the maps app at the point; Copy then paste elsewhere; edit name, tags and description from the pencil; locking the app while the viewer is open closes it; back button closes the viewer.

Open: `scripts/patch-mainactivity.js` is still in the repo; delete it on GitHub (Decision 64).

Next session start point: Phase 16 C (voice recorder and player). Open choices still to confirm for G (file-opener plugin) and H (PDF viewer). Money capture shape still to be given. Device pass on Sessions 59 to 71.

---

**Session 70**

Phase 16 E (Decision 92).
- Reminder opens in a viewer (shared shell for the later viewers): time, repeat, status pill, description, tags, created. Actions: Mark done or Reopen, and Reschedule. The pencil in the header edits details.
- Completed means marked done, or fired (one-off, time passed). Both are greyed out and struck through in Home lists and search. Repeating reminders only become inactive by Mark done.
- Reminder date/time and repeat moved into the Save dialog (presets: in 1 hour, tonight 8 pm, tomorrow 9 am); the separate reminder pop-up and its `prompt()`-based edit are gone. Re-saving a fired reminder without changing its time is allowed; a new past time is refused.
- New column `completed_at` (migration, backup, edit).

Bugs fixed (found while reading): notification Done and Snooze buttons were registered but nothing handled them; they now mark done and snooze 10 minutes. Deleting a reminder left its notification scheduled, so it could still fire; delete now cancels it and restore reschedules a pending one. A reminder created from typed text can carry seconds, which the minute-based picker would have treated as a time change; the dialog now compares to the minute and keeps the stored value.

Decisions made: 92.

Verified: `node --check` on all changed files, `vite build`, headless test of the row states (upcoming, fired, done, repeating past), the dialog's reminder block (past time refused, preset, repeat, unchanged-time re-save) and the detail layout. Not run through CI or on device; the database writes, notification actions and delete/restore hooks were not exercised.

Device checks: create a reminder in the dialog and confirm it fires; Mark done then Reopen; a fired one-off shows Reschedule only; Done and Snooze from the notification itself, including with the app locked; delete a reminder before it is due and confirm it stays silent; restore it; backup and restore keep `completed_at`.

Next session start point: Phase 16 F (location detail). Open choices still to confirm for F (coordinates plus hand-off to the phone's maps app), G (file-opener plugin) and H (PDF viewer). Money capture shape still to be given. Device pass on Sessions 59 to 70.

---

**Session 69**

Phase 16 A and B (Decision 91).
- Save dialog (bottom sheet): file name, tags with previous-tag chips (max two, count shown, new tag field), description, Save. Used by note, voice, image/PDF/Files, reminder, location, Vault capture, and Edit. Untouched Save stores the default name. Several picked files: switch between keeping each file's name and one numbered name. Capture dialogs say Discard and ignore outside taps so a stray tap cannot lose a recording.
- Text editor: full-screen, live word and character count, leaving with unsaved changes needs a second Back. New note and editing a note both go editor, then dialog; backing out of the dialog returns to the editor with the text kept.
- Rows open on tap (Home folders, Home search, Vault folders, Vault search). Text notes open the editor; other types show a toast until their viewers land.
- Data: `description` and `encrypted_description` columns (migration via `ensureColumn`), written by `insertEntry`, `saveVaultEntry`, `editEntry`, backup/restore (including re-keying on cross-PIN append), FTS and the Vault index. `MAX_TAGS` = 2 enforced in `applyTags` and `saveVaultEntry`; `listTagsForScope` supplies chips per scope.
- Overlays close on app lock and Vault lock; toast replaces `alert()` in the touched flows.

Bug fixed (found while reading): Vault tag names sat in the shared `tags` table, so the old shared tag list could have shown them outside the Vault. Chips now come from scoped queries.

Decisions made: 91.

Verified: `node --check` on every changed file, `vite build`, and a headless test of the dialog and editor logic with stubbed tags: untouched Save, third tag blocked with a message, new tag, multi-file switch, discard guard, lock dismissal. Not run through CI or on device; the database changes and backup path were not exercised.

Device checks: install over the old app (migration adds two columns, existing entries unaffected); create each type and confirm name, tags, description save; edit details; two-tag limit; chips show earlier tags; Vault dialog shows Vault tags only; backup then restore keeps descriptions (including Vault ones); lock while the editor is open closes it; Back button closes dialog then editor.

Open: reminder time still asked with `prompt()`; expense edit still uses `prompt()`; 29 other `prompt/confirm/alert` calls remain in Settings, backup and Drive flows.

Next session start point: Phase 16 E (reminder detail, completed state), then F, C, D, G, H. Open choices (PDF viewer, file-opener plugin, map) still to be confirmed before F, G, H. Money capture shape still to be given. Device pass on Sessions 59 to 69.

---

**Session 68**

Planning only; no code changed. Requirements for opening and editing entries recorded as Phase 16 and Decision 90. Phase 15 step 3 (in-app sheets) is folded into 16A.

Decisions made: 90.

Next session start point: Phase 16A, unless the open choices in ROADMAP Phase 16 change the order. Money capture shape still to be given. Device pass on Sessions 59 to 67.

---

**Session 67**

Phase 15: background art (Decision 89). Two original drawings, written as SVG symbols in the sprite: isometric cube outlines for the lock screen, first-run, ad gate and the locked Vault; overlapping rounded squares for the Home and Vault landing pages. Colors come from new `--art-*` tokens, so one drawing serves dark and light. Layers sit behind screen content, ignore touches, and fade out toward the content area. Reference images supplied were used for style direction only; none is embedded.

Decisions made: 89.

Verified: `vite build`, headless render of lock, Home and locked Vault in both themes at 360 px. Not run through CI or on device. Device checks: art does not hurt legibility of the header or digest chips; no horizontal scroll on Home or Vault; cubes disappear once the Vault unlocks; squares absent in folder views and Settings; scrolling feels normal.

Next session start point: unchanged (Phase 15 step 3). Device pass on Sessions 59 to 67.

---

**Session 66**

Fixes from device screenshots of Session 65 (Decision 88).
- Both unlock buttons (app lock screen, Vault locked view) now read "Use Biometric" with a fingerprint icon and a slow breathing glow (3.6 s cycle; static soft glow under reduced motion). Settings toggles keep their longer wording.
- Download update is visible but disabled until a check finds a newer release; a new check disables it again and clears its stored URL.

Bug fixed: "Download update" showed before any check. Cause: `.secondary-btn { display: flex }` came later in the stylesheet than `.hidden { display: none }` and won. Fix: `.hidden { display: none !important }`. Correct because no component display rule can now un-hide an element JS has hidden. The same defect could have shown the biometric buttons on devices without biometric enrollment; device check below.

Decisions made: 88.

Verified: `node --check`, `vite build`, headless render of the lock screen button and the Updates section. Not run through CI or on device. Device checks: on a device without enrolled biometrics the biometric buttons stay hidden; Check for updates on the current version leaves Download disabled; with a newer release it enables and downloads; glow is slow and not distracting.

Next session start point: unchanged from Session 65 (Phase 15 step 3). Device pass on Sessions 59 to 66.

---

**Session 65**

Phase 15, step 2 (Decision 87). Lock screen, first-run, Vault PIN setup and locked views, and the ad gate share one auth layout: centered column, gradient brand mark, form cards. Settings is grouped under Data, Security, Preferences and Backup; each section has an icon chip and a tone. Switch rows put the label left and the switch right; helper text is no longer indented under switches (still indented under radios). Selects get a themed arrow. Seven icons added to the sprite. The ad gate shows a spinner and the brand mark instead of bare text.

Markup only plus CSS: no ids removed, no JS changed. First-run inputs keep their ids; placeholder wording shortened.

Decisions made: 87.

Verified: `vite build`, headless render at 360 px of lock, first-run, Settings (App lock open), Vault locked, light first-run. Not run through CI or on device. Device checks: lock screen and biometric button; first-run Continue still saves; every Settings section opens and its controls work (switches, selects, backup/restore, Drive); Vault locked and PIN-setup views; ad gate looks right while loading; light theme.

Open: `#password-hint` shows both hints and errors in one muted style. Settings sub-controls such as the biometric confirm box are unstyled beyond tokens.

Next session start point: Phase 15 step 3 (in-app sheets replacing `prompt()`/`confirm()`/`alert()`), which changes logic and needs a careful pass; or Money capture if defined. Device pass on Sessions 59 to 65.

---

**Session 64**

Phase 15, step 1: design system applied to Home and Vault (Decision 86). New `style.css` with theme tokens, per-type color context, floating translucent bottom nav, 2-column folder tiles with icon chip and corner count badge, entry rows (type chip, title, meta, tag chips, icon-only Share/Download/Edit/Delete), designed empty states, bottom-sheet type chooser, refined inputs and switches. Inline SVG sprite added to `index.html` replaces every emoji icon. Inter variable (latin subset, OFL) bundled in `src/fonts/`. Home header shows the date and the digest as colored chips.

Bug fixed: an empty bordered bar under the Home header. Cause: `#backup-reminder-banner { display: flex }` outranks `.hidden`. Fix: `.hidden` restated at ID specificity. Correct because the banner now hides whenever app.js adds `.hidden`.

Also: entry labels, tags and types are HTML-escaped before rendering (previously inserted raw).

Decisions made: 86.

Verified: `node --check`, `vite build` (font emitted, CSS 18 kB), headless render of Home (dark and light), a folder list and the Vault at 360 px. Not run through CI or on device. Device checks: Inter loads (no fallback look); tiles fit at your width; count badges; folder rows and four icon buttons respond; Vault Settings card opens and toggles still work; nav active states; chooser sheet; light theme via Appearance.

Not touched: lock screen, first-run, Settings tab internals (step 2); capture prompts (step 3).

Next session start point: Phase 15 step 2, unless Money capture is defined first. Device pass on Sessions 59 to 64.

---

**Session 63**

Phase 4: Vault made a copy of Home in appearance and function (Decision 85). The eight cards are the same grid with count badges and open per-type folders; each folder has New. A universal New above the cards opens the shared type chooser for the Vault. The list under the Vault search box is search results only. Vault Settings sits where Home's settings tile does. Type tabs removed. Back closes an open Vault folder first, then the Vault Settings card. Lock closes any open folder and clears every rendered list.

Decisions made: 85.

Verified: `node --check`, `vite build` (bundle about 109 kB), no duplicate ids in `index.html`, no missing ids except the four dynamically created ones noted in earlier sessions. Not run through CI or on device. Device checks: cards show counts after capture, delete and trash restore; folder opens, New inside it adds to that list; Back closes folder then settings card; Lock then unlock lands on the card grid; Vault search shows results only and clears when emptied; Select files still opens from the Vault.

Open: Vault Reminder, Location, Money still placeholders; Vault batch add not built (Decision 84). Vault search results show label and type only, same as Home.

Next session start point: Money capture shape needs defining; else Phase 5 OCR or Vault batch add. Device pass on Sessions 59 to 63.

---

**Session 62**

Phase 8: batch add built on the main capture bar (Decision 84). Image, PDF and Files pickers are multi-select. One file behaves as before. More than one asks: batch (one common label, auto-numbered) or individual (each named by its file). Tags are asked once for the whole selection.

`batchAddWithCommonLabel()` rewritten: it was drafted against pre-staged file paths nothing produced. It now takes picked file data, saves each through `captureFile()`, and continues numbering from the base label's `label_history` counter. Numbered labels that `insertEntry()` adds to `label_history` are removed again unless they pre-existed, so autocomplete shows base labels only.

Decisions made: 84.

Verified: `node --check`, `vite build` (bundle about 108 kB). Not run through CI or on device. Device checks: picker allows multi-select; one file saves as before; two or more show the choice; batch numbering continues on a second batch with the same label; Cancel on the label prompt saves nothing; folder count updates.

Open: Vault batch add not built. OCR label pre-fill waits on Phase 5 OCR. Money capture shape still undefined. `scripts/patch-mainactivity.js` still in repo; delete it on GitHub (Decision 64).

Next session start point: Money capture shape needs defining; else Phase 5 OCR or Vault batch add. Device pass on Sessions 59 to 62.

---

**Session 61**

Download for append removed (Decision 83): UI, bulk action, import screen, filename prefix, backup-payload
entry filter, default export key, and the zip dependency. Scope confirmed beforehand: import screen removed
entirely, nothing replaces it, restore Append mode stays.

Decisions made: 83.

Verified: `node --check` on every JS file, `vite build` (bundle about 271 kB to 107 kB), grep shows no
remaining references to the removed functions or `@zip.js/zip.js` in `src/`. Not run through CI or on
device. Device checks: Home folder rows and Vault rows show four actions; Select files shows Share,
Download, Delete only; Settings has no append import section; full backup and restore (Append and
Overwrite) still work; Drive backup filenames unchanged.

Open: unchanged from Session 60. Docs: Decisions 9, 33, 34, 41, 43, 44, 55 still describe the removed
feature as history; Decision 83 lists what it supersedes.

Next session start point: unchanged from Session 57, plus device pass on Sessions 59 to 61.

---

**Session 60**

Phase 4: Back button made hierarchical (Decision 82). It goes up one level inside Home or Vault and stops
at that section's landing page, where it is dimmed; it no longer bounces between Home and Vault.

Decisions made: 82.

Verified: `vite build`; no remaining reference to `lastLocation`; `showScreen()`/`switchMainTab()` confirmed
to keep `currentLocation` current on every Home/Settings/Vault transition. Not run through CI or on
device; the behavior itself was not exercised, only the code paths read. Device checks: repeated Back on
Home landing does nothing and is dimmed; Back from Settings and from an open folder reaches Home landing
and stops; Back in Vault with Vault Settings open collapses it, then stops; Back never switches section.

Open: unchanged from Session 59.

Next session start point: unchanged from Session 57, plus device pass on Sessions 59 and 60.

---

**Session 59**

Phase 4: Home restructured around folders (Decision 81). Cards open per-type lists with a New button
and count badge; a universal New on Home opens a type chooser; the mixed Home timeline is now search
results only. Money's folder also lists expenses. Universal Back and the Home nav button close an open
folder.

Decisions made: 81.

Verified: `vite build`; every new element id present exactly once in `index.html`; chooser and card
markup counts checked. Not run through CI or on device; no DOM-level test ran. Device checks: card
opens its folder, New inside it adds to that list, counts update after capture/delete, universal New
asks for a type, Back closes the folder, search results still show and clear, Money folder shows
expenses.

Open: Vault has no folders (Decision 81). Counts do not refresh after a backup restore until the next
capture/delete. Location rows show label only. Session 56 and 57 open items unchanged.

Next session start point: unchanged from Session 57, plus device pass on this change.

---

**Session 58**

Reported from device: Settings offered build 196 while 198 existed. `update-check.js` now lists
releases and picks the highest run number (Decision 80) instead of trusting `/releases/latest`.

Decisions made: 80.

Verified: mocked-list test (out-of-order, draft, empty list, already-current), `vite build`. Not
confirmed on device or against the live API — it rate-limited this session's inspection, so the cause
is reasoned, not observed. Device check: with a newer build released, "Check for updates" must name
the newest run number; tap again right after a new release to confirm no stale result.

Open: unchanged from Session 57.

Next session start point: unchanged from Session 57.

---

**Session 57**

Phase 4: Location capture card built. Current GPS fix saved as a `location` entry with coordinates,
then an optional Share (map link via the native share sheet). Share action extended to location
entries generally (Decision 79). `ACCESS_COARSE_LOCATION` added to `patch-manifest.js`.

Decisions made: 79.

Verified: `vite build` succeeded, new code present in built output; `patch-manifest.js` run against a
sample manifest: inserted on first run, no-op on second. Not run through CI or on device. Device
checks: permission dialog appears, fix returns indoors/outdoors, timeout alert on no fix, Share sheet
opens with label and link, link opens at the right point, entry survives backup/restore with
coordinates.

Open: Vault Location and Money still placeholders. Map view not built. Entry row shows label only, no
coordinates. Session 56 open items unchanged.

Next session start point: Money capture shape needs defining; else Phase 8 batch-add or Phase 5 OCR.
Standing device/CI confirmations unchanged.

---

**Session 56**

Phase 4: Reminder capture card built. `#reminder-modal` (index.html) and `promptForReminder()` (app.js);
main capture bar's Reminder branch now saves the entry, applies tags, and schedules the notification.
Location and Money remain placeholders. Vault Reminder remains a placeholder (Decision 78).

Decisions made: 78.

Verified: `npm install` + `vite build` succeeded, modal markup present in both built output files. Not
run through CI or on device. Device checks: modal opens, `datetime-local` picker renders in the
WebView, notification fires at `fire_at`, repeat rules fire repeatedly, tags attach.

Open, unchanged: `scripts/patch-mainactivity.js` still exists in the repo although Decision 64 marked it
for deletion; delete it on GitHub. `captureText()`'s auto-detected reminder path ignores `extra.tags`.
Battery-optimization prompt on first reminder and the "X reminders scheduled" indicator
(ARCHITECTURE.md §7) are still not built.

Next session start point: Phase 4 Location/Money need a defined capture shape before building; else
Phase 8 batch-add or Phase 5 OCR. Standing device/CI confirmations from Session 55 unchanged.

---

**Session 55**

Reported directly: the "Download update" button (Decision 75) got stuck mid-download, never
completing. Checked against a separate, working sideloaded-Android project's own update-check code
(shared for comparison, unrelated app) — its own comments confirm the mechanism: `@capacitor/browser`'s
`Browser.open()` opens a Chrome Custom Tab, which isn't built to drive a real file download of any
size; `window.location.assign(url)` instead lets Capacitor's WebView hand the URL off to the device's
actual default-browser app, which uses the real system `DownloadManager` and completes properly.

Swapped the one call site to `window.location.assign()`, dropped the now-unused `@capacitor/browser`
import and its `package.json` dependency (nothing else in the codebase used it), and dropped `async`
from the click handler since there's no longer a promise to await.

Decisions made: 77.

Verified with `node --check` on app.js and a JSON parse of package.json. Not run through CI or
confirmed on device — the previous "stuck downloading" report was itself only caught on-device, so
that's the one thing to specifically re-test next: tap "Download update" and confirm it actually
reaches a completed file this time, not just that it starts.

Next session start point: unchanged from Session 54, plus confirming this download fix on device.

---

**Session 54**

Reported from device screenshots: Decision 74's six lock-trigger toggles rendered with no visible gap
between them, description paragraphs reading ambiguously about which toggle they belonged to.

Root cause wasn't the existing details-child margin-zeroing rule (that one only matters for elements
with a natural margin to suppress) — `.switch-row` itself never set any vertical margin, and its
wrapping `<label>` has no default browser margin either, so adjacent toggles had nothing providing a
gap in the first place. Added `margin-top: 14px` to `.switch-row` at matching specificity (ID + type +
class) so the existing zeroing rule can't silently re-zero it, with a smaller 10px variant for a
switch-row sitting directly under a `<summary>`.

Fixed at the shared `.switch-row` level rather than scoped to just the two reported sections — the
same gap was missing everywhere a switch-row could end up adjacent to another one (auto-backup,
biometric toggles, the restore safety-backup confirmation), just never visible until three toggles
landed in a row for the first time in Decision 74.

Decisions made: 76.

Verified brace-balance on the full stylesheet; this is a pure CSS change with no JS/schema surface,
so no `node --check` applies. Not confirmed on device — next screenshot should show breathing room
between all three lock-trigger toggles in both App lock and Vault, and ideally a broader glance at
other Settings sections too, since the fix wasn't scoped narrowly to just those two.

Next session start point: unchanged from Session 53 — CI run for patch-screenlock.js, screen-off
toggle on-device confirmation, and now also this spacing fix, all still awaiting a real device pass.

---

**Session 53**

Reported from a device screenshot: update-available detection itself was correct (`0.1.0+175` →
`0.1.0+176`), but "View release" only opened the release page — one extra tap from the actual file.

`checkForUpdate()` now returns `downloadUrl`, the release's `.apk` asset link found via
`release.assets` (a direct lookup, not a guess — `build-android.yml`'s release step attaches exactly
one file). Button renamed to "Download update"; `Browser.open()` on that asset URL directly hands the
file to the OS download manager instead of the release page. Still a manual install afterward — a
sideloaded APK can't install itself no matter how the file arrived.

Also confirmed the "up to date" case was already working as designed (already names the version) —
reworded slightly for clarity, not a second bug fixed.

Decisions made: 75.

Verified with `node --check` on both changed files. Not run through CI or confirmed on device — the
actual `.apk` asset name/shape from a real release has never been inspected directly, only inferred
from what `build-android.yml` attaches; worth confirming the asset lookup finds it on the next real
check.

Next session start point: confirm the download button actually starts a real file download on
device (not just opens a page), and everything still open from Session 52 (CI run for
patch-screenlock.js, screen-off toggle on-device confirmation).

---

**Session 52**

Requested directly: split "idle timer or backgrounded" into three independent switches — idle,
backgrounded, and phone-screen-lock — for both App lock and Vault, six toggles total.

Idle and background were straightforward: six new `credentials` columns (`ensureColumn`, matching
Decision 50's migration pattern), idle/background defaulting to `1` (matches prior always-on
behavior, no silent change for existing installs). `armAppAutoLock()`/`armVaultAutoLock()` check
their own idle column; the background `appStateChange` listener now goes through a shared
`handleLockTrigger(trigger)` gated by the matching column.

Screen-off needed real thought: Android pauses the Activity identically for "screen turned off" and
"switched to another app" — `appStateChange` genuinely cannot distinguish them, this isn't a JS gap
to work around. `Intent.ACTION_SCREEN_OFF` is the actual distinct signal, but it only reaches a
receiver registered in code, not the manifest. Added a `BroadcastReceiver` in `MainActivity` that
dispatches a plain `arkly-screen-off` DOM event into the WebView via `evaluateJavascript()` —
deliberately not a full Capacitor plugin, which would need its own Gradle module and `cap sync`
discovery, more untestable-here moving parts than this narrow signal needs. New
`scripts/patch-screenlock.js` applies it, same idempotent-CI-script pattern as `patch-manifest.js`/
`patch-mainactivity.js` (`android/` is never committed). Verified the script itself against both
possible `MainActivity.java` shapes (stock, and one with an existing `onCreate()`) in a scratch copy,
including idempotency on a second run — couldn't go further than that; no Gradle/device build is
possible in this environment. Screen-off defaults **off** in the database specifically because of
that gap — idle/background default to matching prior behavior, but screen-off is genuinely new and
unconfirmed, so it doesn't turn on by itself.

Documented clearly (Settings descriptions, android-notes §14, Decision 74) that background and
screen-off overlap at the OS level: turning the screen off also counts as backgrounding, so with
"Lock when backgrounded" on, screen-off already locks regardless of its own toggle. The screen-off
switch is for the specific case of background off, screen-lock still wanted — not a bug, just how
Android's lifecycle works, flagged so it isn't mistaken for one later.

Decisions made: 74.

Verified with `node --check` on db.js/app.js, YAML-validated the workflow, and manually ran
`patch-screenlock.js` against two hand-built fake `MainActivity.java` files in a scratch directory to
confirm both code paths and idempotency — as close to a real test as this environment allows. Not run
through actual CI, and the screen-off receiver has never executed on a real device or even a real
Gradle build — flagged explicitly, this is genuinely new native surface, not just new JS.

Next session start point: confirm the CI build actually compiles with `patch-screenlock.js` applied
(first real test of this script), then confirm on device that toggling "Lock when the phone screen
locks" on and actually locking the screen fires the lock as expected, and that leaving it off while
"Lock when backgrounded" stays on still locks on screen-off (expected, per the overlap noted above).
Standing list otherwise unchanged from Session 51.

---

**Session 51**

Reported directly: adding a file locks the app/vault immediately, because the system file picker
pauses the Activity the same way backgrounding does, and `registerBackgroundLock()` (Decision 45)
can't tell the two apart. Re-read ARCHITECTURE.md's Credentials section first (debugging a confirmed
bug touching it) rather than trusting in-context memory of it.

Fix: a one-shot `expectingPickerReturn` flag, armed by a new `beginPickerLaunch()` right before each
of the two `input.click()` calls (main capture, vault capture — confirmed via grep these are the only
two picker launch points in the codebase). The `appStateChange` listener checks and consumes it before
doing anything else, so it only ever suppresses the one pause it was armed for. Bounded by a 3-second
timeout that also clears the flag, so a picker launch that never actually pauses the Activity (some
OEM file choosers don't) can't leave the exception armed indefinitely and silently swallow the next
real backgrounding.

Also found and fixed a documentation bug of my own while re-reading DECISIONS.md for context:
Decision 70 (Session 48's lock-icon theme-aware fix) had landed out of order, after 71 and 72 instead
of between 69 and 71 — a wrong anchor text in an earlier session's edit matched inside Decision 69's
body instead of the true file tail. Content wasn't duplicated, just misplaced; moved it back into
correct chronological order before appending 73.

Scope note: only the file-chooser path got the exception. Sharing a vault entry out and the Google
Drive OAuth flow pause the Activity the same way and still lock immediately — both are cases of data
or a credential actually leaving the app, unlike picking a file to bring something in, so left as-is
without being asked to change them.

Decisions made: 73.

Verified with `node --check` on app.js. Not run through CI or confirmed on device.

Next session start point: confirm on a real device that adding an Image/PDF/Generic File no longer
locks the app/vault, and that a genuine backgrounding (Home button, app switcher) still locks
correctly right after using the picker. Standing list otherwise unchanged from Session 50.

---

**Session 50**

Requested directly, one change: replace Session 49's on-by-default daily background check with a
manual "Check for updates" button in Settings, and show the version + "up to date" when there's
nothing newer.

`update-check.js` simplified — dropped the `db` param, the `meta` on/off flag, and the
`last_update_check_date` gate, none of which mean anything once a check only runs on tap.
`checkForUpdateIfDue` became `checkForUpdate`, returning `{status: 'up_to_date'|'update_available'|
'error', ...}` instead of an `available` boolean, so the caller has something to show either way — a
button that goes silent on a non-match would read as broken. `onUnlocked()`'s automatic call and
`checkUpdateOnOpen()` are gone. Settings UI: the toggle became a button + inline status line + a
"View release" button that only appears when one's actually available; the separate
`update-available-banner` modal is gone, replaced by that inline status. Reverted `backup.js`'s
`APP_SETTINGS_KEYS` addition from last session — no setting left to persist.

Decisions made: 72.

Verified with `node --check` on both changed files. Not run through CI, not confirmed on device.

Next session start point: same as Session 49's, since nothing here touched CI or device-testable
surface beyond the Settings UI — confirm the next CI run creates a Release correctly, confirm the new
Check-for-updates button and its three outcomes (up to date / update available / error) on a real
device. Standing list otherwise unchanged: batch add with auto-numbering (Phase 8); quick-capture
widget, expense charts, map view, confidence-confirmation chip (Phase 9); obfuscation/ProGuard/
signature check (Phase 10); manual Google Cloud OAuth setup blocking Phase 13; light-mode lock-icon
fix (Session 48) still unconfirmed on device.

---

**Session 49**

Requested directly: build releases automatically and prompt in-app when a newer one exists. Since
this is the app's first real network call with ads still unwired, confirmed two choices before
writing anything — on-by-default daily check (not opt-in), release created on every push to `main`
(not only on a manual version tag) — rather than assuming either.

CI (`build-android.yml`): added a `Create GitHub Release` step after the existing artifact upload,
using `gh release create` against the built-in `GITHUB_TOKEN` (no new secret); added `permissions:
contents: write` at the workflow level, since the default token is read-only otherwise. Tag is
`v<versionName>`, reusing exactly what `scripts/patch-version.js` already stamps onto the APK
(`<package.json version>+<run number>`) rather than recomputing it a second time — that script now
also writes `APP_VERSION_NAME` to `$GITHUB_ENV` so the release step can read the same value.

Client: new `update-check.js`, same shape as `gdrive.js`'s `checkAndRunAutoBackupIfDue` — operates
directly on `db`, gated by a `meta` on/off row plus a `last_update_check_date` row for the once-a-day
cadence, `navigator.onLine` checked first, silent on any failure. Compares the `+<run number>` suffix
of the installed app's version (`@capacitor/app`) against the latest release's tag — an exact integer
comparison, no semver parsing. Wired into `onUnlocked()` (`checkUpdateOnOpen()`), right where the
retired ad gate used to sit; the code comment there now says plainly that this — not AdMob — is
currently the app's one network call. On a match: a dismissible banner offering "View release" (opens
the GitHub Release page via new `@capacitor/browser` dependency) — no auto-install, since a sideloaded
APK can't update itself; the person still installs by hand, same as always. Added a Settings toggle to
turn the check off entirely, and added its meta key to `backup.js`'s `APP_SETTINGS_KEYS` so it
survives a backup/restore round-trip like `dark_mode` already does.

Verified with `node --check` (app.js, update-check.js) and a YAML parse of build-android.yml. Not run
through actual CI, and the release step in particular has never executed — first real use of
`gh release create` and the new `contents: write` permission in this repo, worth watching closely on
the next CI run.

Decisions made: 71.

Next session start point: confirm the next CI run actually creates a Release (not just the artifact)
and that the tag/version numbers land as expected; confirm the update banner appears on a real device
once an older build is installed and a newer Release exists. Standing list otherwise unchanged:
batch add with auto-numbering (Phase 8); quick-capture widget, expense charts, map view,
confidence-confirmation chip (Phase 9); obfuscation/ProGuard/signature check (Phase 10); manual
Google Cloud OAuth setup blocking Phase 13; light-mode lock-icon fix (Session 48) still unconfirmed
on device.

---

**Session 48**

Device feedback on Session 46's lock icon (first device feedback since Session 25): neon green
"looks nice in dark mode" but "bleeds too much" in light mode, "no clear icon." Confirmed the report
by reading Decision 68/style.css again rather than guessing — `--neon-green` had no dark-mode
variant, same fixed-both-themes treatment as `--danger`, which was the wrong call for this
particular hue against light mode's near-white background.

Fix, two parts: `--neon-green` is now theme-aware (`#15803d` in `:root`/light, `#39ff14` kept in
`:root[data-theme="dark"]`), and the glow `filter` moved off the base `#lock-toggle-btn` rule into a
dark-mode-scoped override, so light mode has no glow at all rather than a softer one — the glow
itself was the bleed, confirmed against the screenshots, not just its strength. Moving the glow into
a theme-scoped selector raised its specificity above the existing `.disabled` rule, so added a
matching dark-mode `.disabled` override to keep the disabled state winning in both themes — caught
by rechecking specificity, not by a second device test.

Decisions made: 70.

Next session start point: light-mode fix is code-reviewed and specificity-checked but not yet
confirmed on device — that confirmation, plus the disabled state in dark mode specifically, are the
first things to verify next. Standing list otherwise unchanged from Session 47: batch add with
auto-numbering (Phase 8) still not wired; quick-capture widget, expense charts, map view,
confidence-confirmation chip (Phase 9); obfuscation/ProGuard/signature check (Phase 10); manual
Google Cloud OAuth setup blocking Phase 13; CI green-run confirmation still pending since Session 42.

---

**Session 47**

No request pending, so continued down the standing list of unblocked items rather than waiting
further on the device-pass debt — same pattern as Sessions 16/17/35/40. Picked Phase 8's oldest open
item: label autocomplete, drafted (`label_history` table, populated since Session 1) but never wired
to anything that read it back.

Added `listLabelHistory(db, type, limit=8)` (db.js) — previously used labels for one type, most-used
first, same shape/ordering convention as the existing `listAllTags()`. Added `promptForLabel(type,
defaultLabel)` (app.js), built the same way as the already-established `promptForTags()`: a plain
`prompt()` with the type's history appended as a hint, rather than a new richer picker just for
labels while tags stays plain — consistency over a one-off improvement, and real chip UI is still
Phase 4's job either way. Wired to both existing voice-capture label prompts (main + vault capture
bars) — the only two places in the app today where a label is actually typed by hand rather than
auto-derived from the text or filename. Also exposed `listLabelHistory` on `window.Arkly`,
matching `listAllTags`'s existing exposure.

No privacy work needed: `insertEntry()`'s existing `is_private` guard (Decision 40) already keeps
vault labels out of `label_history` entirely, so the new read path can't leak a vault label into a
non-vault suggestion list — confirmed by reading that guard again before writing `listLabelHistory`,
not assumed.

Verified with `node --check` against both modified files as ES modules (sandbox has no npm registry
access to run a full `vite build` this session — scope was two small, syntactically isolated
functions plus two call-site swaps, no new dependency, no markup change, so a full bundler pass
wasn't judged necessary to catch anything a syntax check wouldn't).

Decisions made: 69.

Next session start point: batch add with auto-numbering (`batchAddWithCommonLabel()`) is still not
wired — needs an actual multi-select Image/PDF/Generic-File capture screen with an "Add individually"
vs. "Batch add with common label" choice, which doesn't exist yet; that's the next Phase 8 item if
picked up again. This session's two-line change is low-risk by nature (a hint string and a fallback
default) but still unconfirmed on a real device, same standing gap as everything since Session 25 —
worth confirming the voice-label prompt actually shows the hint text correctly once tested. Also
still open: quick-capture widget, expense charts, map view, confidence-confirmation chip (Phase 9);
obfuscation/ProGuard/signature check (Phase 10); the manual Google Cloud OAuth setup blocking Phase
13; and the CI green-run confirmation still pending since Session 42.

---

**Session 46**

Icon and color follow-up: lock button changed from an open padlock to a closed one, and from gold
to neon green (`--neon-green: #39ff14`), including both glow layers. Confirmed no stray `--gold`
references were left behind. CSS/HTML only; build clean. Decisions made: 68.

Next session start point: unchanged — confirm on device that the closed-lock icon reads clearly at
this size and that neon green has enough contrast against both light and dark backgrounds.

---

**Session 45**

Screenshot follow-up to Session 44. Vault heading's box (background, border, padding) removed; its
`h2` now matches Home's "Today" metrics so it sits on the same row as the lock/power buttons.
`--gold` brightened `#d4af37` → `#ffc61a`, lock glow doubled to two `drop-shadow` layers.
CSS-only; build clean, braces balanced (137/137). Decisions made: 67.

Next session start point: unchanged — confirm on device that the heading aligns with the buttons
and the brighter gold reads well in dark mode too.

---

**Session 44**

Follow-up screenshots after Session 43's changes went live — several restyle requests plus one
reported bug (Vault's lock button "missing").

**Restyles:** back button got a new icon (curved-return arrow, no enclosing circle, matching a
supplied reference minus its ring) and a 0.5s tap-glow (`.glow` class, force-reflowed before
re-adding so rapid taps restart the animation, removed again on `animationend`). Lock button
restyled gold (`--gold`, new CSS variable, fixed across both themes like `--danger`), thicker
stroke, persistent glow. Power button given a matching persistent red glow.

**Disabled state:** the lock button now visually disables itself on Home/Settings whenever no
app-open password is set (grayscale, dimmed, not tappable) — quick access has nothing for it to
lock into. Computed fresh on every entry into those tabs (`updateLockButtonDisabledState()`,
called from `switchMainTab()`), not cached, so it stays correct if a future session ever adds a UI
to change the app-open password after first-run (none exists today — confirmed by checking:
`setAppPassword()`/`removeAppPassword()` are only ever called from first-run-setup). Also now
hidden entirely on first-run setup, resolving the assumption flagged at the end of Decision 65.

**Vault's lock button bug:** reported as missing, actually a contrast bug, not a logic bug —
`.vault-banner`'s background was `var(--vault)` (near-black), and the icon sitting on top of it was
`var(--fg)` (dark in light theme) — present in the DOM, just nearly invisible against a near-black
backdrop. Fixed at the root: removed `.vault-banner`'s dark background entirely (now
`var(--card-bg)` with a border) and the bottom nav's matching dark active-Vault-tab background (now
`var(--vault-fg)`, a light tint, with `var(--vault)` as the legible text/icon color) — both were the
same "black bar" look, requested separately, and removing them fixes the contrast bug as a side
effect (on top of the lock icon's own restyle to gold, which would have fixed it either way).
Left the inner filter chips (`.vault-tab.active`) untouched — not named in the request, and
light-lavender text on that same dark background is genuinely legible there, unlike an icon
matching its backdrop almost exactly.

Verified with a real `npm install` + `vite build`: zero errors, CSS brace-balanced (137/137). All
ids cross-checked between `app.js` and `index.html` — clean except the same class of pre-existing
dynamically-created ids flagged every session.

Decisions made: 66.

Next session start point: this session's changes haven't been seen on the actual device yet —
worth confirming the glow effects render as expected (drop-shadow support, animation timing) and
that the Vault banner's new lighter look reads correctly in both light and dark mode.

---

**Session 43**

Screenshots showed the app actually running on-device for the first time (CI is producing installable
builds now) — three related UI requests off the back of seeing it live:

1. **Lock/unlock toggle**, fixed top-right left of the power button, on every screen except the two
   biometric/PIN unlock pages (app-open lock screen, Vault's locked gate). Context-aware at click
   time — checks whether `#vault-content` is visible to decide whether to lock the Vault or the main
   app, rather than tracking a separate flag that could drift out of sync. Vault path is the exact
   same two calls the old `#vault-lock-btn` made; main-app path reuses `showLockScreen()` wholesale
   (already handles password-set / quick-access / no-credentials-yet correctly) rather than
   re-implementing that branching. `#vault-lock-btn` removed from the Vault banner — genuinely
   redundant now.
2. **Universal Back button** — third bottom-nav slot, between Home and Vault, styled as a plain
   rounded square rather than a third tab. Backed by a deliberately simple two-slot toggle
   (`currentLocation`/`lastLocation`), not a full history stack — recorded inside `showScreen()`/
   `switchMainTab()` themselves, so every existing caller gets Back support for free without
   touching individual call sites. Lives physically inside `#bottom-nav`, so it's hidden together
   with it for free wherever the nav itself is hidden.
3. **Every dedicated "back" element removed** — `#settings-back-btn` ("← Back to Home") is gone,
   replaced by the universal button.

One real cross-closure wrinkle: `goBack()` needed to call `refreshVaultGateView()`, but that
function only ever existed inside the `DOMContentLoaded` closure, not at module top level where
`goBack()`/`showScreen()`/`switchMainTab()` live. Exposed it as `window.refreshVaultGateView`,
same pattern already used for `window.tryBiometricUnlockVault`/`window.attemptUnlock` — not a new
mechanism, just applied to a third function.

Verified with a real `npm install` + `vite build`: 264 KB main bundle, zero errors. All ids
cross-checked between `app.js` and `index.html` — clean except the same class of pre-existing
dynamically-created ids flagged every session (recording timer/stop, backup-reminder's two buttons).

Decisions made: 65.

Next session start point: whether the lock/unlock button should also show during first-run-setup
was ambiguous in the request — left visible there per the literal instruction (only two exclusions
were named), with the click handler guarding against acting on it before setup completes. Flagged,
not assumed either way — worth confirming once seen on device. Device-pass debt from Sessions
25 onward is now partially resolved (CI produces a real APK — that's new progress), but this
session's three changes haven't themselves been tapped on a real device yet.

---

**Session 42**

Second CI log upload. Progress from Session 41's fix — `src/js/privacy-screen.js` now resolves (20
modules transformed, up from 19 before it existed), but the build failed one step further in:

```
[vite]: Rollup failed to resolve import "@capacitor-community/privacy-screen" from
".../src/js/privacy-screen.js"
```

**Cause:** the npm package itself isn't in `node_modules` at build time, which only happens if
`package.json` in the actual committed repo doesn't list it — i.e. Session 39's `package.json`
(and likely `capacitor.config.json`, delivered alongside it, though a missing config wouldn't itself
break the build) never got committed, even though this session's earlier file
(`privacy-screen.js`) now has. Confirmed by the error message directly — `npm install` (the step
right before) completed without error, so it simply had nothing named `@capacitor-community/
privacy-screen` to install.

**Fix:** re-delivered `package.json` and `capacitor.config.json` unchanged, re-confirmed against
the sandbox (clean `npm install` + `vite build`, 99 modules, zero errors). **Why correct:** the
error names the exact unresolvable package, and it's the one dependency line unique to Session 39
that a prior session's `package.json` wouldn't have — every other file this build step touches
(`privacy-screen.js`, `app.js`) is already confirmed present from Session 41's diagnosis.

No code changed this session either — two sessions in a row now have been "which of Session 39's
several files actually landed," not a code defect. Worth naming as a pattern: **Session 39
delivered 6 files in one message** (2 NEW: `privacy-screen.js`; REPLACE: `package.json`,
`capacitor.config.json`, `app.js`, `index.html`) — it looks like they're landing one or two per
push rather than all at once. Flagged for the person, not assumed silently: double-check all of a
multi-file session's outputs got applied before the next push, rather than re-uploading logs
one gap at a time.

Decisions made: none.

Next session start point: unchanged — once `package.json`/`capacitor.config.json` are actually
committed, the workflow should get past step 6 for the first time. If it fails again, check whether
anything else from Session 39 (or any earlier multi-file session) is still missing before assuming
new code is at fault.

---

**Session 41**

Uploaded a GitHub Actions log bundle from a real CI run — the first actual CI feedback since the
device-pass debt started (Session 25). Build failed at step 6 (`npm run build`, i.e. the Vite build):

```
Could not resolve "./privacy-screen.js" from "src/js/app.js"
```

**Cause:** Session 39 delivered `src/js/privacy-screen.js` as a **NEW** file alongside several
**REPLACE** files — easy to miss when pasting into GitHub's web UI, since a REPLACE overwrites a
path that already exists in the file browser, while a NEW file has to be deliberately created at a
path that isn't there yet. It never made it into the commit; `app.js`'s `import { setPrivacyScreen }
from './privacy-screen.js'` (also from Session 39) had nothing to resolve against. `npm install`
(step 5, just before) succeeded fine — the new dependency itself, `@capacitor-community/privacy-screen`
in `package.json`, was committed correctly; only the wrapper module was missing.

**Fix:** re-delivered `src/js/privacy-screen.js` unchanged (confirmed against the sandbox copy,
which still builds clean — 99 modules, zero errors — with nothing else in the repo touched). **Why
correct:** the error names the exact missing path and nothing else; every other file this depends
on (`package.json`, `capacitor.config.json`, `app.js`) was already confirmed present since `npm
install` and module resolution got as far as needing this one specific file before failing.

No code changed this session — this was a missing-file diagnosis, not a bug in anything that was
written. Logged here anyway since it's exactly the kind of gap that could recur with any other NEW
file in a future session's delivery, worth remembering as a pattern, not just a one-off.

Decisions made: none.

Next session start point: unchanged — once this file is actually committed, the same workflow run
(or a fresh push) should get past step 6 for the first time and reach the actual APK build/signing
steps, which is the real first test of everything built across Sessions 25–40. Re-upload the next
log bundle (or report success) so the device-pass debt can finally start closing.

---

**Session 40**

No new request pending, so continued down the standing list of unblocked Phase 9 items (same
pattern as Sessions 16/17/35) — built the recurring backup-reminder banner (ARCHITECTURE §9).

New `backupReminderDue()` (app.js) checks whichever of `credentials.last_backup_at`/
`last_drive_backup_at` is more recent — either backup path keeps the "forgot app password"
recovery flow usable, so only the most recent of the two matters, not local specifically. Due at
30+ days, same threshold the spec named. Suppressed when there are zero entries (nothing yet worth
losing) so a brand-new install isn't nagged on day one — without that check, `last_backup_at` being
unset (`0`) would always read as "over 30 days," which is true but misleading for an install with
nothing in it yet.

Rendered as `renderBackupReminder()`, following the exact populate-then-wire shape already used for
digest/on-this-day right above it in the same DOMContentLoaded block. New `#backup-reminder-banner`
in Home's header, hidden unless due. Two buttons, built dynamically (same as the recording-timer
UI elsewhere) rather than static markup: "Back up now" jumps into Settings' Backup & Restore
section (`switchMainTab('settings')` + `.open = true` + `scrollIntoView`), "✕" dismisses — in-memory
only, not persisted, so it reappears at the next cold launch rather than going silently snoozed for
weeks if forgotten. Deliberately a plain in-app banner, not a push notification — simpler, and
"soft" in the spec only requires never blocking anything, which this doesn't either way.

Fixed in passing while updating ROADMAP.md's Phase 9 intro line: it still listed "gradient mode
toggle (done, 2 color pickers, same-color allowed)" as a current feature, though Decision 53 (Session
29) removed gradient mode entirely — a stale line left over from before that removal. Corrected to
say removed, not done.

Verified with a real `npm install` + `vite build`: builds clean. All ids cross-checked between
`app.js` and `index.html` — clean except the same two pre-existing dynamically-created ids
(`recording-stop-btn`, `recording-timer`) flagged every session, plus this session's own two new
dynamically-created ids (`backup-reminder-btn`, `backup-reminder-dismiss-btn`), same non-issue for
the same reason.

Decisions made: none — implementing an already-specified feature, not a new design call.

Next session start point: unchanged in substance — the device-pass debt from Sessions 25 onward
still stands, now also covering whether the banner's `scrollIntoView` actually lands correctly and
whether the 30-day threshold feels right in practice. If picking up more unblocked work instead:
quick-capture widget, expense charts, map view, and the confidence-confirmation chip remain open
from Phase 9; label autocomplete UI/batch-add wiring remains open from Phase 8; obfuscation/
ProGuard/signature check remain open from Phase 10.

---

**Session 39**

Idea from last session's screenshot-blocking complaint: make Privacy Screen a real Settings toggle
the person can flip themselves, instead of something only adjustable by editing CI.

Session 37/38's approach (`scripts/patch-mainactivity.js` hand-patching `MainActivity.java`) was
fundamentally build-time — the flag got set once at process start, no way for JS to change it
afterward short of a rebuild, which is exactly why Session 38 could only disable it entirely rather
than offer a real switch. Replaced it outright with `@capacitor-community/privacy-screen`, after
checking npm for a real, compatible, maintained option first rather than writing more native code —
found one. Pinned to `5.2.0` specifically: its `peerDependencies` is `@capacitor/core ^6.0.0`, the
only version line of this plugin that matches this project's Capacitor 6 (its own newer major
versions, 6.x/8.x, need Capacitor 7/8 — an unrelated numbering coincidence). Verified by downloading
the actual `5.2.0` tarball and reading its shipped `PrivacyScreenPlugin.java`/`PrivacyScreen.java`
directly rather than trusting the README: `enable()`/`disable()` do exactly `window.addFlags`/
`clearFlags(FLAG_SECURE)` on the current Activity, real runtime toggles, nothing more.

`capacitor.config.json`'s `PrivacyScreen.enable` set to `false` so native startup never turns it on
by itself. New `src/js/privacy-screen.js` (mirrors `biometric.js`'s shape) applies whatever's
actually stored, called at the same point in `bootstrap()` as `applyAppearance()` — before the lock
screen renders, so the setting also covers the lock screen when on. Persisted via `metaGet`/
`metaSet` under `privacy_screen_enabled`, same mechanism as `dark_mode`/`auto_backup_enabled` — off
by default. New `#privacy-screen-settings` card in Settings, same populate-then-wire pattern as the
dark-mode toggle right below it.

Retired the old approach rather than leaving it as dead weight: `scripts/patch-mainactivity.js`
deleted, `build-android.yml`'s already-commented-out step calling it removed outright,
`android-notes/native-setup.md` §13 rewritten to describe the new plugin instead of the old patch.

One known gap stated plainly: a cold launch has one or two frames between the WebView painting and
`setPrivacyScreen()`'s call resolving, during which an "on" setting isn't in effect yet — no fix
without native code reading a persisted native-side flag before `onCreate()` finishes, out of scope
for what's otherwise a plain web-layer setting.

Verified with a real `npm install` + `vite build`: 99 modules (plus the new dependency), zero
errors, same class of pre-existing benign warnings as always. All ids cross-checked between `app.js`
and `index.html` — clean except the same two pre-existing dynamically-created ids flagged every
session. `capacitor.config.json`, `package.json`, and the YAML workflow all parse cleanly.

Decisions made: 64 (replaces 62/63's approach entirely, doesn't just amend it).

Next session start point: unchanged in substance — the device-pass debt from Sessions 25 onward
still stands, now also covering whether this plugin's `enable()`/`disable()` actually work as
expected on a real device (the sandbox could verify the source and the build, not runtime behavior
on Android). If picking up more unblocked work instead: quick-capture widget, expense charts,
backup-reminder nudge, map view, and the confidence-confirmation chip remain open from Phase 9;
label autocomplete UI/batch-add wiring remains open from Phase 8; obfuscation/ProGuard/signature
check remain open from Phase 10.

---

**Session 38**

Reported: `FLAG_SECURE` (Decision 62) was getting in the way of taking screenshots during active
development — expected, since screenshot-blocking is an inherent side effect of the same flag that
blanks the recents preview, not a separate switch. Asked whether deleting `scripts/patch-mainactivity.js`
was the right way to turn it off — no: `build-android.yml` still calls it, so deleting the file
would have turned a clean disable into a CI failure (missing file) instead.

Disabled by commenting out the one CI step that calls the script, not deleting anything — the
script stays, untouched and still correct, so re-enabling later is a one-line uncomment rather than
rebuilding the feature. Updated ARCHITECTURE.md, `android-notes/native-setup.md` §13, and ROADMAP.md
to say clearly that this is built-but-disabled, not built-and-live, so a future session doesn't
assume recents actually blanks on a real device right now.

Decisions made: 63 (disable, not delete — reasoning above).

Next session start point: unchanged in substance — the device-pass debt from Sessions 25 onward
still stands. When development is far enough along that screenshots aren't needed as often,
re-enabling Decision 62 is uncommenting the step in `build-android.yml` — worth doing before any
build meant to be used for real, since the feature was requested for exactly that use case.

---

**Session 37**

Two requests: recents-preview should go dark/blank like Opera Incognito's task-switcher behavior;
the power button should be restyled to a transparent-background red-outline icon (matching a
supplied reference image) instead of a solid red circle, with its confirmation dialog removed and
the button itself removed from the app-open lock screen.

**Recents-preview blanking** needs Android's `FLAG_SECURE` on `MainActivity`'s window — no
Capacitor-layer or JS equivalent exists. Since `android/` is never committed (Decision 49), a hand
edit to a real `MainActivity.java` would be discarded the next CI run, so this follows
`patch-manifest.js`'s exact pattern: a new `scripts/patch-mainactivity.js`, run in CI right after the
manifest patch, that finds the stock override-free `MainActivity.java` Capacitor's template
generates and inserts an `onCreate()` setting the flag — idempotent (skips if already patched),
aborts loudly rather than guessing if the stock file's shape doesn't match what it expects. Tested
in this session's sandbox against a reconstructed stock file (real `android/` doesn't exist outside
actual CI): correct output on first run, clean no-op on a second run, braces balanced. One flag, two
effects, not separable — the recents preview goes blank (the actual ask) and screenshots/screen
recording are blocked system-wide as a side effect; documented in ARCHITECTURE.md and
`android-notes/native-setup.md` §13 as a feature of the same piece, not a bug, so it isn't mistaken
for one later. This specific native behavior hasn't run on a device yet — same standing gap as
everything since Session 25, called out again here since it's a new native code path, not just UI.

**Power button restyle:** replaced the emoji-on-solid-circle button with an inline SVG (line + open
arc, the standard power-icon shape), transparent background, `stroke="currentColor"` tied to
`color: var(--danger)` — reads correctly in both themes with no dark-mode override needed, since
`--danger` doesn't change between themes the way `--bg`/`--fg`/`--card-bg` do. Confirmation dialog
removed — tapping now calls `exitApp()` immediately (still guarded by the existing
`Capacitor.isNativePlatform()` check for the browser-preview case). Hidden specifically on
`#lock-screen` via one line in `showScreen()`; every other screen, including first-run and the
Vault's own PIN gate, keeps it — "the unlock screen" wasn't fully unambiguous (the Vault's gate says
"Unlock Vault" too), read as `#lock-screen` since that's the one whose actual purpose is unlocking
the app itself; flagged in Decision 62 as an assumption in case that's not what was meant.

Verified with a real `npm install` + `vite build`: 99 modules, zero errors. All ids cross-checked
between `app.js` and `index.html` — clean except the same two pre-existing dynamically-created ids
(`recording-stop-btn`, `recording-timer`) flagged in every prior session's check.

Decisions made: 62 (all four changes this session, one decision, all UI/native-config, no
schema/credential/backup-format change).

Next session start point: unchanged in substance — the device-pass debt from Sessions 25 onward
still stands, now also covering whether `FLAG_SECURE` actually blanks recents and doesn't break
anything else (camera preview, screenshots for support requests, etc. — worth knowing about before
relying on it). If picking up more unblocked work instead: quick-capture widget, expense charts,
backup-reminder nudge, map view, and the confidence-confirmation chip remain open from Phase 9;
label autocomplete UI/batch-add wiring remains open from Phase 8; obfuscation/ProGuard/signature
check remain open from Phase 10.

---

**Session 36**

Requested UI restructure: bottom nav reduced from three tabs to two (Home, Vault); the main app's
Settings moved from a nav destination to an "App Settings" tile inside Home; the Vault's three
scattered settings sections (biometric toggle, auto-lock, Vault Trash) consolidated into one
"Vault Settings" tile inside the Vault screen; a small red circular power button added, fixed
top-right, present on every screen, force-closing the app.

`#settings-tab` itself is untouched — same accordion of settings sections, same lazy-render-on-open
listeners — only its entry point changed, from the nav's third button to the new tile plus a
"← Back to Home" link at the top of the panel. `switchMainTab()` picked up one line: viewing
Settings now keeps the Home nav icon highlighted (Settings is conceptually part of Home, not a
destination of its own) instead of leaving nothing highlighted.

Vault's three sections moved into one `<details id="vault-settings-card">`: the biometric row and
the auto-lock select flattened to plain subsections (no id changes, so no JS wiring needed beyond
what already existed); Vault Trash stayed its own nested `<details>` since `renderVaultTrash()` is
lazily triggered by its own `toggle` event, and flattening it would mean it re-renders every time
Vault Settings opens rather than only when Trash itself does. Extended the existing `#settings-tab`
chevron-card CSS (Decision 53) to also cover `#vault-settings-card` and its nested details, fixing
a pre-existing, never-flagged gap where Vault's settings had always rendered as plain unstyled
`<details>` — only Home's had ever gotten the card treatment.

Power button: `#power-close-btn`, fixed `top`/`right`, living directly under `<body>` rather than
inside any `.screen` div, so it's present regardless of which screen `showScreen()` shows — no
duplication needed across first-run/lock/main/vault/ad-gate. Confirms before acting, then calls
`@capacitor/app`'s `App.exitApp()` (already a dependency, already used for `appStateChange` —
Decision 45), guarded by `@capacitor/core`'s `Capacitor.isNativePlatform()` so a browser preview
gets a plain message instead of a silent no-op. z-index sits above the bottom nav but below modal
overlays, so an open modal keeps visual priority and the button can't be tapped through it.

Verified with a real `npm install` + `vite build` before delivering: 99 modules, zero errors, same
class of pre-existing benign dynamic-import warnings as prior sessions (one new one for
`@capacitor/core`, harmless for the same reason the others are — it's already statically imported
by nearly every Capacitor plugin in the project regardless of this change).

Decisions made: 61 (this session's three changes, one decision — all UI-only, no schema/credential/
backup-format change). Also fixed in passing: DECISIONS.md had Decision 53's entry sitting out of
chronological order (after 59 instead of after 52) from an earlier edit — moved back into place,
content unchanged.

Next session start point: unchanged in substance — the device-pass debt from Sessions 25 onward
still stands, now covering this session's changes too. Flagged but not resolved: whether the power
button should appear inside modal overlays wasn't specified — left underneath them (visible, not
tappable-through) rather than assuming either way. If picking up more unblocked work instead:
quick-capture widget, expense charts, backup-reminder nudge, map view, and the
confidence-confirmation chip remain open from Phase 9; label autocomplete UI/batch-add wiring
remains open from Phase 8.

---

**Session 35**

Picked up an unblocked Phase 9 item rather than waiting further on the standing device-pass debt
(Sessions 25–34), same pattern as Sessions 16/17 — nothing here needed a device to build or verify.

Built the "Your Data" transparency screen (ARCHITECTURE §7), specified but not yet coded: a Settings
section showing total entry count and an on-device storage estimate, plus an Export Now button.
`yourDataSummary()` (app.js) counts non-deleted, non-vault entries — vault entries excluded for the
same reason `showDigest()`/`onThisDay()` already exclude them (Decision 40): this screen sits behind
the app-open password, not the Vault PIN, so a count that included vault items would leak the vault's
size to anyone with app access but not the PIN. Storage size has no such split available —
`navigator.storage.estimate()` reports the whole origin's usage, not per-category — so it's shown as
one on-device total (files + vault content + the database itself), labeled as an estimate, same
caveat already used for the backup/restore storage checks. Export Now opens the existing Backup &
Restore settings section and scrolls it into view rather than building a second export path.

New `<details id="your-data-settings">` added to Settings, positioned above Storage breakdown (the
higher-level, "is my data actually local" summary, vs. the per-category breakdown below it). Verified
with a real `npm install` + `vite build` before delivering, not just syntax-checked: 99 modules
transformed, zero errors, only the same pre-existing benign dynamic-import warnings prior sessions
have already seen. Also fixed a stale line in ARCHITECTURE.md §13 while touching it — the Status
section still listed the on-this-day/storage-breakdown screens as "not yet coded," though Session 17
built both; corrected to reflect what's actually implemented.

Decisions made: none — implementing an already-specified, already-scoped feature, not a new design
call.

Next session start point: unchanged in substance — the device-pass debt from Sessions 25 onward still
stands, now with one more built-but-unverified-on-device screen added to it (low risk: read-only
display plus a settings-open call, no data mutation). If picking up more Phase 9 work instead of the
device pass: quick-capture widget, expense charts, backup-reminder nudge, map view, and the
confidence-confirmation chip are all unblocked and unstarted.

---

**Session 34**

Fixed the Select files screen's scattered layout, reported against a screenshot — checkboxes
floating disconnected from their labels. Root cause: those checkboxes (`.cat-select-all`,
`.item-select`) had never been given a rule of their own, so they fell through to the general
`input { width: 100% }` rule and stretched, scattering their flex row. Every checkbox styled so far
had been scoped to a specific class (`.switch-row`/`.category-checkboxes`) — anything outside those
was unprotected.

Fixed at the root instead of adding a third class-scoped patch: the compact checkbox is now the
default for any plain checkbox, with `.switch-row` overriding it to the sliding-switch look where
that's wanted. Closes this category of bug for any checkbox added later, not just this one.

Also found and fixed while reviewing this file: Decision 53's entry had ended up out of
chronological order in `DECISIONS.md`, sitting after Decision 59 instead of after 52 — an artifact
of an earlier edit anchoring to non-unique text. Moved back into place, no content changed.

Decisions made: 60.

Next session start point: unchanged — the device-pass debt from Sessions 25 onward still stands.
This session's fix is CSS-only and low-risk by nature, but still unconfirmed visually on a device.

---

**Session 33**

Two bugs reported together, both traced to the same single line: a double biometric prompt on every
app open (with the app's own unlock behaving inconsistently depending on which prompt got completed
or ignored), and the Vault sometimes showing up already unlocked with no prompt at all.

Cause: `DOMContentLoaded`'s initial setup called `refreshVaultGateView()` once, unconditionally,
immediately after wiring the Vault's buttons — before the person had reached or tapped the Vault tab
at all. That function auto-triggers a Vault biometric attempt when enabled (Decision 56), so this
fired a second prompt on cold start racing against the app lock screen's own one, and could silently
set the Vault's unlock state in the background while the person was still on the app's lock screen —
so by the time they actually opened the Vault tab, it was already unlocked with nothing asked.

This call had been redundant since Session 30 (the bottom-nav Vault button already calls it fresh on
every real visit) but harmless on its own; it only became actively wrong once Decision 56 gave the
function it was calling a side effect. Removed the line entirely.

Decisions made: 59.

Next session start point: unchanged — still the same device pass owed since Session 25, now with
one more thing this session should make easier to verify (only one biometric prompt should ever
appear at app open; the Vault should never be reachable without its own prompt first).

---

**Session 32**

Product decision, not a bug: ads are deliberately not part of this build — no AdMob account, no
plugin, no gate, no ad format of any kind, notifications included. Phase 12 marked as an explicit
deferral in ROADMAP.md rather than left looking like ordinary unfinished work.

Removing the one place that called into `ads.js` turned out to matter for two bugs reported in the
same message: a full app freeze after entering, and a worse version of Session 31's biometric-timing
issue (needing a whole second unlock, not just a second tap). Two things found together:

`onUnlocked()` called the ad gate with `window.adSdk`, which has never been set anywhere (confirmed
by checking `package.json` and `capacitor.config.json` directly — no AdMob plugin has ever been
added). `ads.js`'s own try/catch already handled that safely, so this wasn't a confirmed crash by
itself, but it was real, pointless work sitting on the unlock path.

More likely the actual cause: Session 31's biometric-timing fix used a bare `setTimeout` fired from
inside `showLockScreen()`, independent of the rest of `DOMContentLoaded`'s own setup — which does
its own sequence of awaited database calls. On a slower device, the timeout could land mid-setup,
racing two chains of SQLite calls against the same connection. Reasoned from the code, not confirmed
via device logging. Fixed by moving the actual biometric trigger to the very last line of
`DOMContentLoaded`, after everything else has finished — nothing left to race against. The
window-focus delay from Session 31 stayed, just layered on top of that instead of standing alone.

Decisions made: 58.

Next session start point: unchanged in substance — a real device pass is owed for all of Sessions
25 through this one. This session specifically should make that pass easier, not harder: fewer
things happening on the unlock path, one less untested integration point (ads) removed from the
critical path entirely.

---

**Session 31**

Five bugs reported directly against real device screenshots, all fixed:

1. Auto-biometric on the app lock screen needed two attempts (worked, stayed on the same page,
   worked again on a second explicit tap). Reasoned cause: triggering the OS prompt immediately on
   cold start, before the Activity has window focus, is a known timing issue. Added a 400ms delay
   before the automatic attempt — an estimate, not a measured fix, worth revisiting after a real
   device check.
2. Bottom-nav Home/Settings did nothing while viewing the Vault — the handler changed which
   sub-tab main-screen would show without ever actually showing main-screen. Gave `showScreen()` an
   optional tab parameter so navigating there from anywhere can land on a specific tab.
3. The Vault's Lock button stayed visible even when already locked. Now hidden unless genuinely
   unlocked.
4. The biometric enable/disable toggle showed on the locked landing page, not just once inside —
   requested directly. Moved it into the unlocked content area; the actual unlock button correctly
   stays on the locked gate.
5. Locking the Vault didn't return Home immediately — the handler awaited an unnecessary async
   refresh before navigating. Now synchronous, right after lock.

Also added two more capture cards, Reminder and Location, positioned before Money — eight cards now
(Text/Voice/Image/PDF/Reminder/Location/Money/Files). Reminder reuses the existing auto-detected
`reminder` type (a reminder is a reminder, unlike Money's deliberately-kept-separate relationship to
Expense); Location is entirely new, same placeholder treatment as Money. Extended the backup
filename letters from `tvipmf` to `tviprlmf` to match — flagged as a judgment call, not something
explicitly re-specified, since the request added cards to the same set the letters were drawn from.
Capture-card grid moved from 3 to 4 columns for a clean 4x2 layout. Two new type colors (orange,
cyan) picked and contrast-checked the same way as every color since Decision 52.

Decisions made: 56, 57.

Next session start point: still the same real-device pass owed since Session 30, now covering five
more fixes on top — none of tonight's changes have been confirmed on a device either, only reasoned
through and checked for internal consistency (syntax, no duplicate IDs, contrast math). Priority if
only some of it can be tested: the Vault gate states (setup/locked/unlocked, and the Lock button's
visibility in each) and the nav fix, since those are the two that were reported as actually broken
rather than requested-and-built-fresh.

---

**Session 30**

A reported bug turned out to be a real one: tapping the bottom-nav Vault button opened straight into
Vault content with no PIN prompt. Traced it to Session 29's refactor — the actual gate elements
(`vault-pin-setup-view`/`vault-locked-view`, plus Session 26's biometric toggle) had been moved into
Settings' Private Vault accordion, disconnected entirely from `vault-screen`, which was left holding
only the content with nothing above it to gate on. A second bug in the same area: `lockVault()`
cleared the in-memory key but never cleared the vault list's already-rendered HTML, so even a
reconnected gate wouldn't have hidden content from a previous unlock.

Fixed by moving the gate back into `vault-screen` itself and rewriting `refreshVaultGateView()` as
the single function deciding all three states (needs-setup/locked/unlocked) and toggling the
content's visibility as part of that, rather than the content being permanently shown. Every unlock
path now routes through it. `lockVault()` now also clears the rendered lists directly.

Also: both the app lock screen and the Vault gate now auto-attempt biometric unlock as soon as they
show, when enabled, instead of waiting for a button tap — requested directly. Fire-and-forget, same
success/failure paths a manual tap already used; the Vault's version is guarded against re-prompting
on every re-render while still locked.

Added Money as a sixth capture type — card only, its real capture flow deliberately not built yet.
Kept it separate from the existing auto-detected `expense` type rather than reusing that machinery
without being asked to. Threaded through everywhere the other five types are: vault support, backup
category (letter `m`), labels, a new red accent color (the one hue not already in use). Tapping it
shows a plain "coming soon" rather than falling into the generic file-picker path, which would have
been wrong for an undefined type.

Redesigned both capture bars as a 3-column card grid (icon + label) instead of a thin icon-only row —
Home's bar gains text labels it never had. Checked contrast again for the newly-visible labels on
the category colors, same discipline as Sessions 28–29.

Renamed backup/append output files to `backup_<letters>_<timestamp>.dz` /
`append_<letters>_<timestamp>.dz`, exactly as specified, with two flagged (not silently assumed)
defaults: an "x" placeholder if none of the six lettered categories are selected, and the standard
`yyyymmdd_hhmmss` timestamp shape (read the request's extra "h" as a likely typo rather than building
it literally). Old `.dzbackup`/`.zip` extensions still accepted on import so existing backups keep
working; nothing is written with them going forward. Found and cleaned up a stale leftover from
Decision 53 while in this file: backup.js's App Settings category still listed the removed gradient
meta keys.

Decisions made: 54, 55.

Next session start point: unchanged in spirit, more urgent in practice — this session touched the
Vault's actual security gate, which makes an on-device pass non-optional before trusting any of
Sessions 25 through this one further. Priority order if only some of it can be tested: (1) the Vault
gate fix — confirm tapping the Vault tab always asks for the PIN/biometric when locked and never
shows stale content, (2) biometric auto-prompt on both locks, (3) everything else already queued.

---

**Session 29**

Second visual pass, requested directly: drop Gradient mode entirely (keep dark mode), replace the
single long scrolling page with a proper modern layout, switches instead of checkboxes.

Gradient mode: removed end to end — CSS custom properties and rules, the JS that wrote them, the
toggle and two color pickers in Settings. Nothing to migrate; appearance was always stored as loose
key-value rows in the generic `meta` table, not schema columns, so the old rows just sit there
unread from now on, harmless, including inside any backup made before this session.

Layout: main-screen split into a Home panel (capture bar, search, timeline) and a Settings panel
(everything that used to be a wall of stacked `<details>` below the timeline on the same page), switched
by a new fixed bottom nav — Home / Vault / Settings. Vault needed no restructuring, it was already
its own screen; the nav button just calls the same `showScreen('vault-screen')` every existing
unlock path already called. `showScreen()` itself now also drives the nav's visibility and active
state, centrally, rather than leaving that to every call site.

Every standalone on/off setting is now a sliding switch — a pure CSS restyle of the existing
checkbox inputs (`appearance: none` + a `::before` thumb), no id or JS listener touched. Backup/
restore's multi-select category checkboxes deliberately stayed compact checkboxes rather than
switches — a different kind of choice (pick-several vs one on/off), and five switches in a row for
that would have read wrong. `<details>` sections in Settings got a custom rotating chevron and card
treatment instead of the browser's bare disclosure triangle, which was doing a lot of the "dated"
work by itself.

Checked contrast again before shipping, same as last time: found and fixed the bottom nav's active
and inactive tab-label colors, both slightly under AA at small text size — added a dedicated
per-theme active-color token and raised the inactive label's opacity rather than leaving either as a
near-miss. Also swapped two newer CSS features (`color-mix()`, `:has()`) that would render fine on a
recent Chrome for explicit per-theme tokens and an HTML class instead, given this app's minSdk 22
means some real device could plausibly carry an older system WebView.

Decisions made: 53.

Next session start point: unchanged — still need a real CI build and device pass covering
everything from Sessions 25 through this one before any of it moves from "reasoned through" to
"confirmed."

---

**Session 28**

Visual redesign, requested directly against two screenshots showing the actual on-device look — flat
grey/white, one blue accent, described accurately as dated. Rebuilt `style.css` around a colorful
default theme, kept fully separate from the existing opt-in Gradient mode (untouched, still exactly
what it was).

Design: one brand accent (indigo/violet) for primary actions, plus five category colors — one per
capture type (Text/Voice/Image/PDF/Files) — applied everywhere that type shows up: capture-bar
buttons, every list row's left edge, the Vault's filter tabs. Same five hues, same meaning, everywhere
they appear, so the color coding only has to be learned once. `app.js` gained `data-type="..."` on six
row-render call sites that previously only put the type in text, so the new CSS selectors have
something to match against — additive only, checked the type vocabulary already lined up with the
capture buttons' own `data-type` values before relying on it.

Checked accessibility before shipping, not after: computed real WCAG contrast ratios for every
text-on-color pairing in a sandbox rather than eyeballing it. Found and fixed two real failures —
white button-label text on the lighter category colors (amber/teal/green) in the Vault's capture bar,
and the primary-button gradient's lighter end in both light and dark theme. Fixed by separating
button-fill colors from brand-as-text colors (different contrast requirements: white-on-fill vs
text-on-page-background) rather than trying to satisfy both with one token.

Decisions made: 52.

Next session start point: unchanged — still need a real CI build and device pass covering Sessions
25–28 together (voice-recording permissions, biometric unlock, real per-build versioning, and now
this visual pass) before any of it can be called confirmed rather than reasoned-through.

---

**Session 27**

Two things this session. First, informational only: the app icon was replaced directly on GitHub by
hand (`resources/icon.png`) — no code or doc change needed, that's exactly the one-file swap
`native-setup.md` §2 already documents.

Second, a real bug: every build still installed as version 1.0 no matter what changed. Same root cause
as Decision 49, one layer over — extracted `@capacitor/cli`'s actual android template and confirmed
`android/app/build.gradle` unconditionally ships `versionCode 1` / `versionName "1.0"`, and since
`android/` is never committed (regenerated fresh every run), nothing had ever overridden that. Every
build since Session 1 has been identically versioned.

Fixed with the same pattern as `patch-manifest.js`: `scripts/patch-version.js` (new), run by CI right
after it. `versionCode` comes from GitHub's own run number — always increasing, no manual step, nothing
to forget. `versionName` is `package.json`'s version plus that same run number, so an installed build
can be identified from Settings > Apps without checking CI logs. Tested against the real extracted
Capacitor template in a sandbox: correct rewrite, correct overwrite on a second run with a different
number, correct refusal (not a silent guess) when the run number isn't set.

Decisions made: 51.

Next session start point: unchanged from Session 26 — get a build through CI and onto the device. This
build will be the first to carry a real version string, which should make it obvious at a glance
whether the device actually picked up the new APK before testing anything else in it (voice recording
permissions, biometric unlock, both locks independently).

---

**Session 26**

Built biometric (fingerprint/face) unlock as an alternative to typing the app-open password or Vault
PIN, requested explicitly — off by default, toggled independently per lock, never a fourth credential.

Plugin choice took real checking, not just picking the first match: the obvious package
(`capacitor-native-biometric`) turned out to target Capacitor 3 and depend on `jcenter()`, dead since
2021 — would likely have broken the CI build. Found and verified `@capgo/capacitor-native-biometric@6.0.4`
instead by downloading both packages and reading their manifests/gradle directly: peer dep
`@capacitor/core@^6.0.0`, modern `google()`/`mavenCentral()`-only gradle, matches this project exactly.

Also read the chosen plugin's native Java source before trusting its security model: its Keystore key
requires the device to be unlocked but does not require a fresh biometric check to decrypt — the actual
gate is enforced in `src/js/biometric.js`'s own call order (verify, then read), not by hardware on every
access. Documented this plainly rather than overselling it (`native-setup.md` §10, `ARCHITECTURE.md` §3).

Built: `src/js/biometric.js` (new — thin plugin wrapper); two new `credentials` columns plus `db.js`'s
first real migration helper (`ensureColumn()`, needed since the existing on-device test install's DB
predates these columns and `CREATE TABLE IF NOT EXISTS` doesn't retrofit them — same class of gap as
Decision 49, different layer); enable/disable/unlock wiring in `app.js`, reusing `attemptUnlock()` and
`unlockVault()` as-is rather than a second copy of "what counts as correct"; settings UI (toggle +
confirm-password/PIN sub-form) in both the App lock and Vault sections, plus a biometric button on the
lock screen and the Vault gate. Changing or removing either password/PIN now also clears its stored
biometric secret automatically, so a stale cached value can never unlock (or derive a vault key from)
a credential that's no longer correct.

Also removed `@capawesome-team/capacitor-android-foreground-service` from `package.json` — the dead
dependency flagged in Session 25, confirmed unused anywhere in `src/js/`.

Decisions made: 50. Fixed three stale `native-setup.md §10` cross-references (ARCHITECTURE.md,
DECISIONS.md, ROADMAP.md) left over from inserting the new §10 ahead of the old Google Drive section,
which shifted to §11.

Not done: no device test yet — this is new code on top of Session 25's not-yet-built permission fix, so
neither has been run through CI or a real device at this point. Native biometric prompts in particular
can't be meaningfully verified any other way (no emulated fingerprint sensor in this sandbox).

Next session start point: get a build through CI and onto the device. Three things need confirming
together, in order — (1) Session 25's manifest-permission fix (voice recording end-to-end), (2) this
session's biometric enable/unlock flow for both locks, (3) that enabling biometric for one lock doesn't
interfere with the other (they use separate `server` keys in the plugin's storage, but that's reasoning
from the code, not something confirmed on a real device yet). If biometric enrollment isn't available on
the test device, the settings rows should simply stay hidden (`isBiometricAvailable()` returning false) —
worth checking that path too, not just the happy one.

---

**Session 25**

Followed up on Session 24's flagged-but-unverified question: does `cap-voice-rec` self-declare
`RECORD_AUDIO`, or does the app's manifest need it added by hand? Answered by downloading the actual
package and reading its shipped `AndroidManifest.xml` rather than inferring from its README — it
self-declares neither `RECORD_AUDIO` nor any permission for the foreground service it does declare
(`foregroundServiceType="microphone"`).

That second half turned into the bigger finding. Capacitor 6's default `targetSdkVersion` is 34
(checked against Capacitor's own upgrade docs), and Android 14 requires `FOREGROUND_SERVICE` +
`FOREGROUND_SERVICE_MICROPHONE` declared for a microphone-typed foreground service or the OS throws a
`SecurityException` at `startForeground()` — a native-side crash no JS try/catch can catch, same shape
as Decision 47's GoogleAuth crash. Untested until now since Session 24 only built the recording UI.

Checking where to actually add these permissions surfaced a deeper, structural gap: **`android/` has
never been committed to the repo**, across all 24 prior sessions — `build-android.yml`'s "add platform
if missing" branch has been true every single run. `android-notes/native-setup.md` §3's permission list
has existed since Session 1 but had no mechanism to ever reach a real manifest; any hand-edit would be
silently thrown away the next CI run. This means every permission in that list — not just the two new
ones — has been documentation only, never actually built into any APK, including the ones already
confirmed working on-device (Sessions 22–24 only exercised file/note capture, which doesn't need any of
them; voice recording, reminders, and location would have been the first real test, and hadn't happened
yet).

Fix: `scripts/patch-manifest.js` (new), run by CI right after `npx cap add android` — inserts any of the
eight required permissions not already present in the freshly-generated manifest, idempotently. Verified
by running it against a representative sample manifest in a sandbox: correctly inserted all eight, then
correctly no-op'd on a second run. `build-android.yml` updated with one new step calling it.

Also noted, not removed: `package.json`'s `@capawesome-team/capacitor-android-foreground-service`
dependency is unused anywhere in `src/js/` — likely left over from before `cap-voice-rec` was chosen.
Flagged for a future cleanup pass, not urgent.

Decisions made: 49.

Next session start point: get a build through CI with this change and back on the device — this is the
first real test of voice recording, and the first time *any* of the documented manifest permissions will
have actually shipped in a built APK. If recording works end-to-end (permission prompt, record, stop,
save, playback), continue the standing test checklist: search, edit, local backup/restore, Vault. Also
worth a quick sanity check once on-device: confirm the permission *prompts* (not just presence in the
manifest) actually appear for RECORD_AUDIO/location/notifications at the expected first-use moments,
since a declared-but-never-requested permission is a different bug than what was just fixed here.

---

**Session 24**

Two real bugs reported from continued testing:

1. **PDF/image capture accepted literally any file type.** The file `<input>` for both had no
   `accept` attribute at all — same generic picker used for every non-text type. Fixed with a
   per-type `acceptForType()` helper (`image/*`, `application/pdf,.pdf`; `file` stays intentionally
   unrestricted).

2. **"Record voice" actually asked to upload an existing audio file instead of recording one.**
   Bigger gap: voice capture was routed through the exact same generic file-picker as image/pdf/file
   — there was never any actual recording UI built, matching Phase 5's already-documented
   "not implemented" status, but worth fixing now that it's blocking real testing. Added
   `cap-voice-rec` (Decision 48) after real verification, not assumption: queried npm directly for
   the actual current version (`6.0.1`, chosen specifically because its major version tracks
   Capacitor's own — the same version-mismatch mistake that caused the Google Sign-In crash last
   session was worth actively avoiding here), installed it in a sandbox, and read its actual shipped
   type definitions rather than trust its README, which had a real inconsistency about its own
   return shape (a `path` field mentioned in one section that doesn't exist in the actual types).
   Built a record/stop UI with a live timer, wired into both the main and vault capture bars.

Not done: the noise-reduction toggle from the original Phase 5 plan — `cap-voice-rec` has no
audio-source parameter to expose it. Tracked separately in `android-notes/native-setup.md` §5;
basic recording (what was actually broken) is fixed.

Verified the same way as every session since the crash saga began: ran a real `npm install` +
`vite build` after adding the new dependency, not just a syntax check — confirmed the plugin bundled
correctly with zero unresolved imports.

Decisions made: 48.

Next session start point: continue the test checklist — confirm voice recording actually works
end-to-end on-device (permission prompt, record, stop, save, playback), then search, edit, local
backup/restore, Vault. Also worth confirming on the next device test: whether `cap-voice-rec` needs
a manual `RECORD_AUDIO` manifest permission or self-declares it — flagged as unverified in
`android-notes/native-setup.md` §5.

---

**Session 23**

Real functional testing began — file, image, and note capture all confirmed working, tags display
correctly, and all five per-file actions render per entry. First real bug from actual usage rather
than a crash: every action button rendered full-width and stacked instead of sitting compactly in a
row. Cause: `.drive-backup-row`'s button-sizing CSS rule was scoped to `#drive-backup-list .drive-backup-row`
from when it was first written (Session 11), before the same class got reused generically across the
main timeline, vault list, and trash bins. Everywhere except the Drive list fell back to the
universal `input, button { width: 100% }` default. Fixed by removing the `#drive-backup-list` scope
so the rule applies everywhere the class is used, plus `flex-wrap` so a row of five buttons wraps
onto multiple lines on narrow screens instead of overflowing.

Verified the same way as the last several sessions: ran the actual Vite build after the fix, not
just eyeballed the CSS — bundles clean.

Decisions made: none — a scoping bug, not a design call.

Next session start point: continue the test checklist — search, edit, local backup/restore, Vault.

---

**Session 22**

**First successful device load, after three straight sessions of crashes (18–21).** Screenshots
confirm: first-run setup renders correctly (both optional-credential fields, matching the spec
exactly), the main screen shows digest/on-this-day/timeline/capture bar, "Select files" opens with
correct empty-state text rather than erroring on empty data, and all eight settings sections render
(Storage breakdown, Trash, App lock, Private Vault, Appearance, Backup & Restore, Google Drive
Backup, Append files from download).

This confirms the three fixes from the last three sessions weren't just individually correct but
actually work together in a real build: the SQLite import fix (Session 18), the Vite bundler
addition (Session 19), and the GoogleAuth null-check guard (Session 21). Nothing new built or fixed
this session — just recording the milestone, since it's the first time in this project's history
that anything has been confirmed running on an actual device.

Decisions made: none.

Next session start point: real functional testing, not crash-hunting. Priority order, cheapest and
most foundational first: capture one of each type and confirm it appears with all five actions;
search; tags; edit; local backup then restore (the one place a bug would be worst to discover late);
Vault setup, capture, search, its own trash; auto-lock (idle and backgrounding). Skip Drive and ads
for now — both still need manual setup that hasn't happened (OAuth client, AdMob unit), so failures
there are expected, not bugs to report.

---

**Session 21**

Got the real crash log via ADB (`adb logcat -d`, after some detours — a third-party crash-viewer app
couldn't read another app's logs at all, since that's an OS-level restriction on Android since 4.1,
not a tool problem). Root cause, confirmed in the actual stack trace, not inferred:

```
Caused by: java.lang.NullPointerException: Attempt to invoke virtual method
'android.content.Intent com.google.android.gms.auth.api.signin.GoogleSignInClient.getSignInIntent()'
on a null object reference
  at com.codetrixstudio.capacitor.GoogleAuth.GoogleAuth.signIn(GoogleAuth.java:81)
```

This is a narrower, later crash than the two from Sessions 18–19 — it only fires when
`GoogleAuth.signIn()` is actually called (tapping "Connect Google Drive"), and confirms both earlier
fixes (the SQLite import, the Vite bundling) were real and correct — the app is loading and running
fine otherwise. The plugin's native `signIn()` has no null-check on its internal sign-in client;
with no client ID configured (removed as a hedge last session), calling it throws an uncaught
`NullPointerException` **inside the plugin's own compiled Java code**, which kills the whole app
process before anything can reach JavaScript. Confirmed via the stack trace that no JS-side
try/catch could have caught this regardless of how it was written — the crash happens on Capacitor's
own "CapacitorPlugins" native thread, before a promise resolution/rejection is even possible.

Fixed with a `GOOGLE_DRIVE_CONFIGURED` guard in `gdrive.js` (currently `false`) that stops the app
from ever calling `GoogleAuth.signIn()` until it's manually flipped — documented alongside the
real-client-ID setup step in `android-notes/native-setup.md` §10 so both are done together, not one
forgotten. Also added try/catch around the two UI call sites (`drive-connect-btn`,
`handleDriveBackupNow`) that previously had none, for clean error display generally, though the
guard itself is what actually prevents the crash — a JS-side catch alone would not have been enough.

Verified the same way as last session, not just asserted: ran the real Vite build again after these
changes — still bundles cleanly, same benign warnings, zero errors.

Decisions made: 47.

Next session start point: back on the device for a fourth attempt. If this clears — three
distinct, confirmed root causes fixed across three sessions (SQLite import, missing bundler, Google
Auth null-check) — that's real, substantial forward motion after a long stretch of untested code.
Standing items otherwise unchanged: CI status, Phase 13's actual OAuth setup (still not done, by
design — the guard means that's fine to defer).

---

**Session 20**

Third device test — no longer a blank screen (confirms Session 19's Vite fix actually worked), but
a native "Arkly keeps stopping" crash instead. This is a different failure class entirely: JS
module loading now succeeds, and something is throwing at the native Android layer.

**No confirmed root cause this session — being explicit about that rather than shipping another
guess as if it were certain.** Investigated several plausible candidates against real documentation
rather than assuming:
- `@capacitor-community/sqlite`'s documented Android minimums (`minSdkVersion 22+`,
  `compileSdkVersion 33+`) — checked Capacitor 6's actual default `variables.gradle` values and
  confirmed they already satisfy this. Ruled out with reasonable confidence.
- `@codetrix-studio/capacitor-google-auth` reads its client ID from `capacitor.config.json` at
  native startup, and that file held a literal placeholder (`REPLACE_WITH_ANDROID_OAUTH_CLIENT_ID...`)
  since the Google Cloud setup isn't done yet. Couldn't confirm whether this crashes at plugin load
  or only fails later at sign-in time — but since Drive backup is unused until the OAuth setup is
  complete regardless, removed the `GoogleAuth` config block entirely as a no-regret hedge rather
  than carrying a guaranteed-invalid value for no benefit. Documented in
  `android-notes/native-setup.md` §10 to re-add once real credentials exist.

Recommended getting an actual stack trace via a free Play Store logcat-reader app (no root/computer
needed) rather than continuing to guess through plugin documentation one at a time — a real
exception trace will confirm which candidate (if either) is responsible, or reveal something not yet
considered.

Decisions made: none — investigation and one hedge, not a confirmed fix or a new design call.

Next session start point: get the actual crash log. Everything else stands until then — confirming
CI status, and now this native crash, are both blocking real verification of six-plus sessions of
accumulated app logic that's never actually run.

---

**Session 19**

Second device test, same blank screen. This time the cause went much deeper than a single fixable
line: **the app has never been able to load, in any session, on any real device or browser** —
`www/` had no bundler and no import map, and every file that imports a Capacitor plugin
(`notifications.js`, `backup.js`, `fileactions.js`, `gdrive.js`, and `app.js` after last session's
fix) uses `import { X } from '@capacitor/...'`, a bare specifier a browser's native ES module loader
cannot resolve on its own. ES module resolution happens before any code runs, so one unresolvable
import anywhere in the dependency graph blocks the whole script — exactly the blank-page symptom,
both times. Last session's `window.sqlitePlugin` fix was a real, necessary fix for a real bug, but
it replaced one crash with a normal `import` of the same package, which has the identical failure
mode underneath. The reason 18 sessions of `node --check` never caught this: Node's module
resolution *can* resolve bare specifiers from `node_modules`; a browser's cannot, without a bundler
or an import map. Checking with the wrong tool gave false confidence the whole time.

Fixed by adding Vite — the standard choice for exactly this situation. `src/` is now the real
source directory (every file that used to live in `www/` moved there, unchanged); `www/` becomes
Vite's build output (`vite.config.js`: `root: 'src'`, `outDir: '../www'`, so
`capacitor.config.json`'s `webDir` needed no change at all). `build-android.yml` now runs `npm run
build` before `cap sync`. Checked Vite's actual current version against npm data rather than
assuming from memory — it's on major version 7 now (`^7.3.2`), not the 5.x a stale assumption would
have produced.

**Verified this actually works, rather than asserting it and handing back a third blank screen:**
ran `npm install` and `npx vite build` for real in a sandbox before delivering anything. 82 modules
transformed, build succeeded, and the output was grepped for any remaining unresolved
`@capacitor`/`@zip`/`@codetrix` import statements — zero found. This is the first time in the
project's history that the actual bundled output has been confirmed loadable rather than assumed to
be, because it's the first time anything was actually built end-to-end outside of a GitHub Actions
runner I can't inspect.

No application code changed as part of this fix — every import statement across every file was
always correct JavaScript; the only thing missing was the build step that makes bare specifiers
resolvable in a real browser engine. Also added: `.gitignore` (didn't exist before — `node_modules/`
was never excluded, though nothing had committed it yet since nothing had ever run `npm install`
outside CI).

Decisions made: 46.

Next session start point: get this rebuilt and back on the device — third attempt, but the first one
built on a verified, actually-tested fix rather than a fix that only looked correct on paper. If a
screen finally renders, that's the real first signal after seven sessions of accumulated surface. Old
`www/*` files remain committed in the repo but are now stale/vestigial — safe to delete whenever
convenient, not urgent, since CI regenerates them fresh every run regardless of what's committed.

---

**Session 18**

First real device test, first real device bug — screenshot showed a completely blank screen on
launch. Cause: `bootstrap()` read `window.sqlitePlugin`, a global nothing anywhere ever set. It's a
leftover from the original pre-existing scaffold (predates every session in this log), never caught
because nothing had actually run the app on a device until this test. `SQLiteConnection` ended up
`undefined`, `new SQLiteConnection(...)` threw immediately inside `bootstrap()`, and since
`DOMContentLoaded` awaits `bootstrap()`, the whole script halted before any `showScreen()` call ever
ran — every screen stays `hidden` by default, so the result is exactly a blank page in the
background color. Fixed: import `CapacitorSQLite`/`SQLiteConnection` directly from
`@capacitor-community/sqlite` (already a real dependency) instead of reading a global.

Audited for the same bug shape before handing this back, rather than fixing only the one reported
symptom: found a second, separate bug of the identical class. Every `window.Arkly.X` function is
nested under that object, but several button handlers (Share/Download/Download-for-append/Edit,
restore-from-trash, permanently-delete) called bare `window.X()` — none of which exist at that path.
These would have thrown the moment anyone clicked past the (now-fixed) blank screen. Fixed all six
call sites to go through `window.Arkly.X`.

Also: `crypto.js` and `intents.js` had never been staged into the working sandbox across any prior
session (only ever read, never modified, so never copied in) — meaning no session's syntax checks or
audits had ever actually covered them. Staged and checked now: both clean, both have zero imports and
zero `window.` references, so neither is at risk of this bug class at all.

Checked `ads.js`'s `window.adSdk` reference too, since it's the same shape — confirmed safe, already
wrapped in try/catch with the correct no-fill fallback (Decision 14), unlike the two that broke.

Decisions made: none — bug fixes, not new design calls.

Next session start point: get this rebuilt and back on the device. If the blank screen is gone and
first-run setup renders, that's real progress — six sessions of untested surface just got its first
actual signal. Standing items unchanged otherwise: CI status, Phase 13's OAuth setup.

---

**Session 17**

Built the digest, on-this-day, and storage breakdown (ARCHITECTURE §6). `showDigest()` has had real
query logic since early on but nothing ever rendered it to `#digest` — fixed, and while fixing it,
found it also never excluded vault entries from its counts. A "3 notes today" digest counting 1
public + 2 vault notes would have hinted that vault activity happened, without revealing what — the
same class of leak Decision 40 (Session 13) already closed for search and autocomplete, just not
checked against this surface at the time. Fixed the same way: `is_private=0` added to the query.

`onThisDay()` and `storageBreakdown()` are new. Both exclude vault entries for the same reason as
the digest fix above — neither needed a new decision, just applying Decision 40 somewhere it hadn't
been checked yet. Storage breakdown reuses `fileactions.js`'s `getSelectableEntries()` for sizes
rather than computing them a second way; its "clear items older than 30 days" action reuses the
existing bulk-delete path (soft-delete into the 30-day trash, not permanent).

Also cleaned up: `onUnlocked()` was calling `showDigest()`/`showMainTimeline()` and discarding the
results — actual rendering has always happened via separate functions in `DOMContentLoaded`, so
those calls did nothing. Removed rather than left as confusing dead code.

Decisions made: none — applying Decision 40 to two surfaces it hadn't been checked against yet, not
a new design call.

Next session start point: same standing items — confirm the CI run is green, Phase 13 still blocked
on manual OAuth setup, nothing run on an actual device across six sessions of accumulated surface
now. Remaining Phase 9 items (data-transparency screen, quick-capture widget, expense charts,
backup-reminder nudge, map view, confidence-confirmation chip) are unblocked whenever picked up.

---

**Session 16**

Checked whether `credentials.auto_lock_minutes` — a column that's existed since Session 1 — was
actually enforced anywhere. It wasn't. Built it: `armAppAutoLock()`/`disarmAppAutoLock()`, reset via
one delegated document-level listener (click/keydown/input) rather than manually calling it from
every capture/search/browse function — the vault's own auto-lock (Session 13) needed several
follow-up patches specifically because it relied on remembering to call `armVaultAutoLock()` at every
touchpoint; this one is built to not repeat that mistake. No-op when quick access is enabled, since
there's nothing to lock back to.

Also found, while working in this area: `privateSessionKey`'s own comment has said "cleared on vault
lock/background" since the Vault pivot (Session 13), but nothing ever actually listened for the app
backgrounding — the vault would stay unlocked indefinitely across app-switches if someone left and
returned within the idle window. Added `@capacitor/app`'s `appStateChange` listener
(`registerBackgroundLock()`, called once in `bootstrap()`), which now immediately locks both the
vault and the app-level password screen on backgrounding, not just after idle timeout. New
dependency: `@capacitor/app`.

Added a Settings control (`#app-auto-lock-select`) mirroring the vault's existing one.

Decisions made: 45.

Next session start point: same standing items — confirm the CI run is green, Phase 13 still blocked
on manual OAuth setup, nothing run on an actual device yet. Phase 9's remaining items (digest,
on-this-day, storage breakdown, expense charts, map view, quick-capture widget,
confidence-confirmation chip, backup-reminder nudge) are all unblocked, unstarted work for whenever
device-testing priority (flagged last session) isn't the more pressing choice.

---

**Session 15**

Closed the one item left open from last session: Edit had no UI button anywhere. Wiring it exposed
two real bugs already sitting in `editEntry()` (fileactions.js), fixed before anything called it:

1. It expected `fields.text` for vault entries but `fields.body_text` for non-vault notes — a
   mismatch that meant calling it consistently from one UI (which is what building the Edit button
   required) would have silently no-op'd whichever side didn't match the field name it happened to
   check. Normalized on `fields.text` for both; non-vault notes map it to `body_text` internally.
2. Expense/reminder-specific fields (`amount`, `expense_category`, `fire_at`, `repeat_rule`) were
   checked — to decide whether to call the reminder-reschedule callback — but never actually written
   to the `updates` object, so editing a reminder's time or an expense's amount would have silently
   done nothing to the row at all. Fixed by copying any of those four present in `fields` into
   `updates`, same as `label` already was.

Built the shared `editEntryUI()` prompt flow (label always; text for notes, prefilled from
`body_text` or, for vault notes, from the in-memory index's `searchableText` — which is already the
note's own decrypted text; amount/category for expenses; date/time for reminders, parsed and handed
to `scheduleReminder` via the existing `rescheduleReminder` callback hook). Wired to both the main
timeline and vault list.

Decisions made: none — bug fixes and UI wiring for an already-flagged gap, not new design calls.

Next session start point: nothing specific left flagged from Phase 4/7/8's UI wiring. Standing items
unchanged: confirm the CI run is green, Phase 13 still blocked on manual OAuth setup, nothing run on
an actual device yet — that last one is worth prioritizing once the OAuth setup is done, since a
meaningful amount of untested surface has accumulated across several sessions now.

---

**Session 14**

Follow-on from the Vault pivot, checking for the same class of gap on the non-vault side and
finding it: the main app's capture bar had no click listeners at all (only the vault's got wired
during the pivot), and there was no equivalent of `captureToVault()` for the main app —
`captureText`/`saveNote` only ever handled typed text, never voice/image/pdf/file.

Built: `captureFile()` (mirrors `captureToVault`, unencrypted, writes to
`Directory.Data/files/<uuid>.<ext>`, the existing storage convention from Decision 20), wired to the
main capture bar. Rendered the main timeline for the first time — `showMainTimeline()` has returned
rows since early on, but nothing ever displayed them or attached the five per-file actions (built in
Phase 7, unused since) to anything. Now both the main timeline and vault list show Share/Download/
Download-for-append/Delete per entry, plus tags (one bulk `GROUP_CONCAT` query for the main
timeline, matching the bulk approach `vault.js`'s index already used for its own tags). Built a
shared `promptForTags()` — same `prompt()`-based rough edge as other one-offs already flagged
elsewhere, wired into both main and vault capture (vault capture previously collected no tags at
all).

Noted, not fixed: captured images/PDFs have no OCR text yet — that's genuinely Phase 5's job (native
plugin wiring), not something to fake here. Labels/tags still make everything findable meanwhile.

Decisions made: none — this was closing gaps already flagged in ROADMAP (Phase 4/7's missing
timeline UI), not new design calls.

Next session start point: Edit still has no UI button anywhere (function exists, nothing calls it).
Same standing items beyond that: confirm the CI run is green, Phase 13 still blocked on manual OAuth
setup, nothing in the app run on an actual device yet.

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
