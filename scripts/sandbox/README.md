# Sandbox tools

Development aids for testing the Office readers without a device. Not part of the app: nothing here is bundled or imported by `src/`.

- `setup.sh`: installs node and python packages, links `node_modules` for the repo's source.
- `make_ppt.py`, `make_xls.py`: build sample files (styled text, pictures, backgrounds and master shapes, gradients, free-forms; pictures, five charts, shapes, a plain workbook) and convert them to `.ppt` / `.xls` with the office suite.
- `dump.mjs`: prints what the `.ppt` or `.xls` reader makes of a file.
- `copy.mjs`: makes the `.pptx` copy of a `.ppt`.
- `mount.mjs`: mounts the app's viewer on a file in a simulated page and prints what it drew.
- `browser.py`: mounts the Word viewer on a `.docx` in a real browser and prints, per sheet, how far its content runs past the sheet; saves screenshots of chosen sheets (Decision 530).
- `slides.py`: mounts the PowerPoint viewer on a `.pptx` in a real browser, saves a screenshot of each slide listed and prints the text that runs past its shape (Decision 564).
- `slidetap.py`: taps the PowerPoint viewer with real touch events (left half, right half, quick taps) and checks that a slide is put on the stage with its pictures decoded (Decision 564).
- `slidefull.py`: tests the slide number button and overview, full screen, long press, Back and the landscape fill with real touch events (Decisions 565 to 567).
- `charts.mjs`: draws the charts of an `.xls` to SVG with the app's chart code.

Typical run: `sh setup.sh`, `python3 make_xls.py /tmp/s`, `node dump.mjs /tmp/s/in8.xls`, `node mount.mjs /tmp/s/in9.xls`.
`SRC` sets the source folder (default `/home/claude/repo/src/js`).
