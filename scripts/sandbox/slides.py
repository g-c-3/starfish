# Mounts the app's PowerPoint viewer on a .pptx in a real browser and saves a screenshot of each slide listed.
# Usage: python3 slides.py file.pptx [out_dir] [slide,slide,...]   Writes slide<N>.png (the slide canvas) and prints per slide the text that runs past its box.
# Needs: esbuild (setup.sh), playwright with chromium. The preferences plugin is replaced by a stub; nothing here is part of the app.
import base64, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

SRC = os.environ.get('SRC', '/home/claude/repo/src'); TOOLS = os.environ.get('TOOLS', '/home/claude/t')
f = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else '.'; want = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else [1]
os.makedirs(out, exist_ok=True); tmp = tempfile.mkdtemp()
open(f'{tmp}/stub.js', 'w').write("export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };")
open(f'{tmp}/entry.js', 'w').write(f"import {{ mountOffice }} from '{SRC}/js/office-render.js'; window.mountOffice = mountOffice;")
subprocess.run(['npx', 'esbuild', f'{tmp}/entry.js', '--bundle', '--format=iife', f'--alias:@capacitor/preferences={tmp}/stub.js', f'--outfile={tmp}/bundle.js', '--log-level=error'], cwd=TOOLS, check=True)
open(f'{tmp}/page.html', 'w').write(f'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://{SRC}/css/style.css"><div id="h" style="position:fixed;inset:0;display:flex;flex-direction:column"></div><script src="bundle.js"></script>')
b64 = base64.b64encode(open(f, 'rb').read()).decode()
with sync_playwright() as p:
    br = p.chromium.launch(args=['--allow-file-access-from-files', '--no-sandbox']); pg = br.new_page(viewport={'width': 1000, 'height': 700}, device_scale_factor=1)
    pg.goto(f'file://{tmp}/page.html')
    pg.evaluate("""(b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const ui = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => String(k)) }); window.mountOffice('pptx', u, document.getElementById('h'), { ui, edit: null }); }""", b64)
    time.sleep(1.5)
    cur = 1
    for k in want:
        pg.evaluate("document.querySelectorAll('.eo-navi')[0].click()"); time.sleep(0.15)
        for _ in range(k - 1): pg.evaluate("document.querySelectorAll('.eo-navi')[3].click()"); time.sleep(0.05)
        time.sleep(1.0)
        info = pg.evaluate("""() => { const cv = document.querySelector('.eo-canvas'); const r = cv.getBoundingClientRect(); const bad = [];
          for (const it of cv.querySelectorAll('.eo-it')) { const tx = it.querySelector(':scope > .eo-tx'); if (!tx) continue; const b = it.getBoundingClientRect();
            if (tx.scrollWidth > tx.clientWidth + 2 || tx.scrollHeight > tx.clientHeight + 2) bad.push((tx.textContent || '').slice(0, 30)); }
          return bad; }""")
        pg.query_selector('.eo-canvas').screenshot(path=f'{out}/slide{k}.png')
        print(k, 'overflow:', info)
    br.close()
