# Mounts the app's Word viewer on a .docx in a real browser and reports, per sheet, how far its content runs past the sheet (Decision 530).
# Usage: python3 browser.py file.docx [out_dir] [sheet,sheet,...]   Writes sheets.json (per-sheet height, overflow, text) and sheet<N>.png for the sheets listed.
# Needs: esbuild (setup.sh), playwright with chromium. The preferences plugin is replaced by a stub; nothing here is part of the app.
import base64, json, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

SRC = os.environ.get('SRC', '/home/claude/repo/src'); TOOLS = os.environ.get('TOOLS', '/home/claude/t')
f = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else '.'; want = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else []
os.makedirs(out, exist_ok=True); tmp = tempfile.mkdtemp()
open(f'{tmp}/stub.js', 'w').write("export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };")
open(f'{tmp}/entry.js', 'w').write(f"import {{ mountOffice }} from '{SRC}/js/office-render.js'; window.mountOffice = mountOffice;")
subprocess.run(['npx', 'esbuild', f'{tmp}/entry.js', '--bundle', '--format=iife', f'--alias:@capacitor/preferences={tmp}/stub.js', f'--outfile={tmp}/bundle.js', '--log-level=error'], cwd=TOOLS, check=True)
open(f'{tmp}/page.html', 'w').write(f'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://{SRC}/css/style.css"><div id="h" style="position:fixed;inset:0;display:flex;flex-direction:column"></div><script src="bundle.js"></script>')
b64 = base64.b64encode(open(f, 'rb').read()).decode()
with sync_playwright() as p:
    br = p.chromium.launch(args=['--allow-file-access-from-files', '--no-sandbox']); pg = br.new_page(viewport={'width': 900, 'height': 1400})
    pg.goto(f'file://{tmp}/page.html')
    pg.evaluate("""(b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const ui = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => String(k)) }); window.mountOffice('docx', u, document.getElementById('h'), { ui, edit: null }); }""", b64)
    for i in range(120):  # layout is done when sheets exist and the "Laying out" banner is gone
        n = pg.evaluate("document.querySelectorAll('.eo-sheet').length"); busy = pg.evaluate("!![...document.querySelectorAll('.ev-banner')].find(e => /Laying out/.test(e.textContent))")
        if n and not busy and i > 3: break
        time.sleep(1)
    time.sleep(2)
    res = pg.evaluate("""async () => { const sh = [...document.querySelectorAll('.eo-sheet')];
      for (const s of sh) { s.scrollIntoView(); await new Promise((x) => setTimeout(x, 15)); } await new Promise((x) => setTimeout(x, 300));
      return sh.map((s, i) => { const mh = parseFloat(s.style.minHeight); const c = s.querySelector('.eo-sh-content');
        return { i: i + 1, h: s.offsetHeight, min: mh, over: s.offsetHeight - mh, txt: c ? c.textContent : '' }; }); }""")
    json.dump(res, open(f'{out}/sheets.json', 'w'))
    over = [x for x in res if x['over'] > 1]
    print('sheets', len(res), '| overflowing', len(over))
    for x in over: print(' ', x['i'], round(x['over']), x['txt'][:50].replace('\n', ' '))
    for k in want:
        pg.evaluate(f"document.querySelectorAll('.eo-sheet')[{k - 1}].scrollIntoView()"); time.sleep(1.2)
        pg.query_selector_all('.eo-sheet')[k - 1].screenshot(path=f'{out}/sheet{k}.png')
    br.close()
