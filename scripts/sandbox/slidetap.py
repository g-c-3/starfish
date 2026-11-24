# Tests the PowerPoint viewer's gestures in a real browser with touch: a tap on the left half goes back, on the right half forward, each tap one slide;
# and that a slide is put on the stage only when its pictures are decoded. Usage: python3 slidetap.py file.pptx   Needs: esbuild (setup.sh), playwright with chromium.
import base64, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
SRC = os.environ.get('SRC', '/home/claude/repo/src'); TOOLS = os.environ.get('TOOLS', '/home/claude/t'); tmp = tempfile.mkdtemp()
open(f'{tmp}/stub.js', 'w').write("export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };")
open(f'{tmp}/entry.js', 'w').write(f"import {{ mountOffice }} from '{SRC}/js/office-render.js'; window.mountOffice = mountOffice;")
subprocess.run(['npx', 'esbuild', f'{tmp}/entry.js', '--bundle', '--format=iife', f'--alias:@capacitor/preferences={tmp}/stub.js', f'--outfile={tmp}/bundle.js', '--log-level=error'], cwd=TOOLS, check=True)
open(f'{tmp}/page.html', 'w').write(f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="file://{SRC}/css/style.css"><div id="h" style="position:fixed;inset:0;display:flex;flex-direction:column"></div><script src="bundle.js"></script>')
b64 = base64.b64encode(open(sys.argv[1], 'rb').read()).decode()
with sync_playwright() as p:
    br = p.chromium.launch(args=['--allow-file-access-from-files', '--no-sandbox']); cx = br.new_context(viewport={'width': 400, 'height': 800}, has_touch=True); pg = cx.new_page()
    pg.goto(f'file://{tmp}/page.html')
    pg.evaluate("""(b64) => { window.counts = []; window.swaps = []; const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const ui = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => String(k)) });
      window.mountOffice('pptx', u, document.getElementById('h'), { ui, edit: null, setCount: (c) => window.counts.push(c) });
      const scroll = document.querySelector('.eo-pscroll'); const stage = scroll.querySelector('.eo-zoomer > div');
      new MutationObserver(() => { const cv = stage.querySelector('.eo-canvas'); if (!cv) return; const imgs = [...cv.querySelectorAll('img')]; const bg = /url/.test(cv.style.backgroundImage);
        window.swaps.push({ imgs: imgs.length, ready: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, bg }); }).observe(stage, { childList: true }); }""", b64)
    time.sleep(1.5)
    box = pg.evaluate("(() => { const r = document.querySelector('.eo-pscroll').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    L = (box[0] + box[2] * 0.25, box[1] + box[3] / 2); R = (box[0] + box[2] * 0.75, box[1] + box[3] / 2)
    cur = lambda: pg.evaluate("window.counts[window.counts.length - 1]")
    ok = True
    def check(name, want):
        global ok; time.sleep(1.2); got = cur(); good = got == want; ok &= good; print(('PASS' if good else 'FAIL'), name, '->', got, '(want', want + ')')
    check('start', '1/41')
    pg.touchscreen.tap(*R); check('tap right', '2/41')
    pg.touchscreen.tap(*R); pg.touchscreen.tap(*R); pg.touchscreen.tap(*R); check('three quick taps right', '5/41')
    pg.touchscreen.tap(*L); check('tap left', '4/41')
    pg.touchscreen.tap(*L); pg.touchscreen.tap(*L); check('two quick taps left', '2/41')
    pg.touchscreen.tap(*L); pg.touchscreen.tap(*L); pg.touchscreen.tap(*L); check('taps left stop at the first slide', '1/41')
    bad = [s for s in pg.evaluate("window.swaps") if s['ready'] != s['imgs']]
    print('PASS' if not bad else 'FAIL', 'slides put on the stage with undecoded pictures:', len(bad), 'of', len(pg.evaluate("window.swaps")))
    br.close(); sys.exit(0 if ok and not bad else 1)
