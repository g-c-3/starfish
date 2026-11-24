# Tests the PowerPoint viewer's slide number button (overview of all slides), full screen, long-press hide and show, Back, and the fill in landscape,
# in a real browser with touch. Usage: python3 slidefull.py file.pptx   Needs: esbuild (setup.sh), playwright with chromium.
import base64, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
SRC = os.environ.get('SRC', '/home/claude/repo/src'); TOOLS = os.environ.get('TOOLS', '/home/claude/t'); tmp = tempfile.mkdtemp()
open(f'{tmp}/stub.js', 'w').write("export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };")
open(f'{tmp}/entry.js', 'w').write(f"import {{ mountOffice }} from '{SRC}/js/office-render.js'; window.mountOffice = mountOffice;")
subprocess.run(['npx', 'esbuild', f'{tmp}/entry.js', '--bundle', '--format=iife', f'--alias:@capacitor/preferences={tmp}/stub.js', f'--outfile={tmp}/bundle.js', '--log-level=error'], cwd=TOOLS, check=True)
css = f'<link rel="stylesheet" href="file://{SRC}/css/style.css"><link rel="stylesheet" href="file://{SRC}/css/motion.css">'
open(f'{tmp}/page.html', 'w').write(f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">{css}<div id="top" style="position:fixed;inset:0;display:flex;flex-direction:column"><div style="height:56px;background:#333;color:#fff">app header</div><div id="h" class="eo-host"></div><style>#top #h {{ flex: 1; min-height: 0; position: relative; overflow: hidden; }}</style></div><script src="bundle.js"></script>')
b64 = base64.b64encode(open(sys.argv[1], 'rb').read()).decode()
res = []
def check(name, good, info=''):
    res.append(good); print('PASS' if good else 'FAIL', name, info)
with sync_playwright() as p:
    br = p.chromium.launch(args=['--allow-file-access-from-files', '--no-sandbox']); cx = br.new_context(viewport={'width': 400, 'height': 800}, has_touch=True); pg = cx.new_page()
    pg.goto(f'file://{tmp}/page.html')
    pg.evaluate("""(b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const ui = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => String(k)) });
      window.m = window.mountOffice('pptx', u, document.getElementById('h'), { ui, edit: null }); }""", b64)
    time.sleep(1.5)
    q = lambda js: pg.evaluate(js)
    pill = lambda: q("document.querySelector('.eo-slidecount').textContent")
    check('pill shows slide number / total', pill() == '1/41', pill())
    # overview
    pg.click('.eo-slidecount'); time.sleep(1.2)
    n = q("document.querySelectorAll('.eo-ovp').length"); painted = q("[...document.querySelectorAll('.eo-ovp')].filter(i => i.firstChild.firstChild).length")
    check('overview lists all slides, painted only near the view', n == 41 and 0 < painted < 41, f'{n} slides, {painted} painted')
    check('each slide carries its number', q("document.querySelectorAll('.eo-ovp')[40].querySelector('.eo-ovn').textContent") == '41/41')
    q("document.querySelector('.eo-ovw').scrollTop = document.querySelectorAll('.eo-ovp')[29].offsetTop - 100"); time.sleep(0.8)
    check('the pill follows the scrolling', pill() in ('29/41', '30/41', '31/41'), pill())
    pg.screenshot(path='/tmp/ovw.png')
    pg.touchscreen.tap(200, 400); time.sleep(1.2)
    cur = q("window.m.closeTop(), 0") if False else None
    check('a tap on a slide opens it', q("document.querySelector('.eo-ovw').classList.contains('hidden')") and pill() != '1/41', pill())
    # pill again: overview, then back
    pg.click('.eo-slidecount'); time.sleep(0.8); pg.click('.eo-slidecount'); time.sleep(0.8)
    check('the pill toggles the overview', q("document.querySelector('.eo-ovw').classList.contains('hidden')"))
    # full screen
    pg.click('.eo-navi:nth-child(6)'); time.sleep(0.8)
    check('full screen hides the bar, header area is covered', q("getComputedStyle(document.querySelector('.eo-slidebar')).display") == 'none' and q("document.querySelector('#h').getBoundingClientRect().top") == 0)
    check('exit button and number visible', q("getComputedStyle(document.querySelector('.eo-exitfull')).opacity") == '1' and q("getComputedStyle(document.querySelector('.eo-slidecount')).opacity") == '1')
    # landscape fill
    pg.set_viewport_size({'width': 900, 'height': 400}); time.sleep(0.8)
    g = q("(() => { const s = document.querySelector('.eo-pscroll').getBoundingClientRect(); const c = document.querySelector('.eo-canvas').getBoundingClientRect(); return [s.width, s.height, c.width, c.height]; })()")
    fill = max(g[2] / g[0], g[3] / g[1])
    check('landscape: the slide fills the screen on its limiting side', fill > 0.97 and g[2] <= g[0] + 1 and g[3] <= g[1] + 1, str([round(x) for x in g]))
    pg.screenshot(path='/tmp/land.png'); pg.set_viewport_size({'width': 400, 'height': 800}); time.sleep(0.6)
    # long press
    cdp = cx.new_cdp_session(pg)
    def hold(ms):
        pt = [{'x': 200, 'y': 400}]; cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pt}); time.sleep(ms / 1000); cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.6)
    before = pill(); hold(750)
    check('long press hides the controls', q("getComputedStyle(document.querySelector('.eo-exitfull')).opacity") == '0' and q("getComputedStyle(document.querySelector('.eo-slidecount')).opacity") == '0')
    check('the lift after a long press changes no slide', pill() == before, pill())
    hold(750)
    check('another long press brings them back', q("getComputedStyle(document.querySelector('.eo-exitfull')).opacity") == '1' and q("getComputedStyle(document.querySelector('.eo-slidecount')).opacity") == '1')
    # overview inside full screen, then Back order
    pg.click('.eo-slidecount'); time.sleep(0.8)
    check('overview opens in full screen', not q("document.querySelector('.eo-ovw').classList.contains('hidden')"))
    ok1 = q("window.m.closeTop()") is True
    check('Back leaves full screen first', ok1 and not q("document.querySelector('#h').classList.contains('eo-full')"))
    ok2 = q("window.m.closeTop()") is True; time.sleep(0.6)
    check('Back then closes the overview', ok2 and q("document.querySelector('.eo-ovw').classList.contains('hidden')"))
    check('Back then leaves the viewer (nothing left to close)', q("window.m.closeTop()") is False)
    # Back at any time: hidden controls
    pg.click('.eo-navi:nth-child(6)'); time.sleep(0.6); hold(750)
    check('Back leaves full screen with the controls hidden', q("window.m.closeTop()") is True and not q("document.querySelector('#h').classList.contains('eo-full')"))
    br.close(); sys.exit(0 if all(res) else 1)
