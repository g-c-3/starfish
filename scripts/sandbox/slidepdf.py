# Tests the PowerPoint viewer's PDF copy in a real browser: taps "PDF copy", waits for the file the viewer hands to the app, saves it.
# Usage: python3 slidepdf.py file.pptx out.pdf   Needs: esbuild (setup.sh), playwright with chromium. Then e.g. pdftoppm out.pdf page to look at the pages.
import base64, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
SRC = os.environ.get('SRC', '/home/claude/repo/src'); TOOLS = os.environ.get('TOOLS', '/home/claude/t'); tmp = tempfile.mkdtemp()
open(f'{tmp}/stub.js', 'w').write("export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };")
open(f'{tmp}/entry.js', 'w').write(f"import {{ mountOffice }} from '{SRC}/js/office-render.js'; window.mountOffice = mountOffice;")
subprocess.run(['npx', 'esbuild', f'{tmp}/entry.js', '--bundle', '--format=iife', f'--alias:@capacitor/preferences={tmp}/stub.js', f'--outfile={tmp}/bundle.js', '--log-level=error'], cwd=TOOLS, check=True)
css = f'<link rel="stylesheet" href="file://{SRC}/css/style.css"><link rel="stylesheet" href="file://{SRC}/css/motion.css">'
open(f'{tmp}/page.html', 'w').write(f'<!doctype html><meta charset="utf-8">{css}<div id="h" class="eo-host" style="position:fixed;inset:0"></div><script src="bundle.js"></script>')
b64 = base64.b64encode(open(sys.argv[1], 'rb').read()).decode(); out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/out.pdf'
with sync_playwright() as p:
    br = p.chromium.launch(args=['--allow-file-access-from-files', '--no-sandbox']); pg = br.new_page(viewport={'width': 420, 'height': 800}); pg.on('console', lambda m: print('console:', m.text[:200]) if m.type == 'error' else None)
    pg.goto(f'file://{tmp}/page.html')
    pg.evaluate("""(b64) => { window.toasts = []; window.pdf = null; const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const ui = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => String(k)) });
      window.m = window.mountOffice('pptx', u, document.getElementById('h'), { ui, edit: null, toast: (t) => window.toasts.push(t), openWith: () => {}, pdfCopy: async (bytes) => { window.pdf = btoa(String.fromCharCode(...bytes.subarray(0, 8))) + '|' + bytes.length; window.pdfBytes = bytes; } }); }""", b64)
    time.sleep(1.5)
    n = pg.evaluate("[...document.querySelectorAll('.eo-segbtn')].map(b => b.textContent)"); print('menu buttons:', n)
    t0 = time.time(); pg.evaluate("[...document.querySelectorAll('.eo-segbtn')].find(b => b.textContent === 'PDF copy').click()")
    last = ''
    while time.time() - t0 < 240:
        time.sleep(1.0); st = pg.evaluate("(document.querySelector('.eo-pdfprog') || {}).textContent || ''")
        if st != last and st: print(st, round(time.time() - t0), 's'); last = st
        if pg.evaluate("!!window.pdf") or pg.evaluate("window.toasts.length > 0"): break
    print('toasts:', pg.evaluate("window.toasts")); print('seconds:', round(time.time() - t0, 1))
    if pg.evaluate("!!window.pdf"):
        b = pg.evaluate("new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(new Blob([window.pdfBytes])); })"); data = base64.b64decode(b); open(out, 'wb').write(data); print('PDF', len(data), 'bytes ->', out)
    br.close()
