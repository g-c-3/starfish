// Mounts the app's Office viewer on a file in a simulated page and prints what it drew. Usage: node mount.mjs file [sheetOrSlide]
// Needs: jsdom, esbuild (setup.sh). The preferences plugin is replaced by a stub.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { JSDOM } from 'jsdom';
const SRC = process.env.SRC || '/home/claude/repo/src/js'; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-'));
fs.writeFileSync(path.join(tmp, 'stub.js'), 'export const Preferences = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };');
execFileSync('npx', ['esbuild', `${SRC}/office-render.js`, '--bundle', '--format=esm', `--alias:@capacitor/preferences=${tmp}/stub.js`, `--outfile=${tmp}/render.mjs`, '--log-level=error']);
const dom = new JSDOM('<!doctype html><body><div id="h"></div></body>', { pretendToBeVisual: true, url: 'https://example.org/' });
for (const k of ['document', 'window', 'DOMParser', 'HTMLElement', 'Node', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'localStorage']) { try { globalThis[k] = dom.window[k]; } catch { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true }); } }
globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
const { mountOffice } = await import(`${tmp}/render.mjs`);
const file = process.argv[2]; const kind = /\.(xls|xlsx|ods)$/.test(file) ? 'xlsx' : /\.(ppt|pptx|odp)$/.test(file) ? 'pptx' : 'docx';
const ui = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : typeof k === 'string' ? () => String(k) : undefined) });
const host = document.getElementById('h');
try { mountOffice(kind, new Uint8Array(fs.readFileSync(file)), host, { ui, edit: null }); } catch (e) { console.log('mount error:', e.message); }
if (kind === 'xlsx') { const ov = host.querySelector('.eo-xobjs'); console.log('sheet objects:', ov ? ov.children.length : 0); if (ov) for (const b of ov.children) console.log(' ', b.className, b.getAttribute('style'), '|', b.textContent.slice(0, 40), '|', b.firstChild && b.firstChild.tagName); }
else console.log('drawn elements:', host.querySelectorAll('*').length, '| text:', host.textContent.replace(/\s+/g, ' ').slice(0, 120));
fs.rmSync(tmp, { recursive: true, force: true });
