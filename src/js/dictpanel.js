// dictpanel.js — the dictation panel of the notes editor (Decision 412): a glass panel at the bottom, as the PDF mark bar. A language
// menu (Recent, a separator, then every language the service has), one Start/Stop button, the phrase being spoken, a level meter and
// a timer. Text goes into the note through onInsert, so the note saves it like typing. The voice goes to Google's speech service
// while it runs (Decision 411); nothing else is sent.
import '../css/dictation.css';
import { speechPrepare, speechMessage, dictate } from './speech.js';
import { SPEECH_LANGS, langName, nativeName, defaultLanguage } from './speechlangs.js';

const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// host: the element it sits in. store: { get(key, fallback), set(key, value) } (the app's settings). onInsert(text, { newline }).
// confirmFirstUse(): resolves true once the person has accepted where the voice goes. phoneTags: the phone's own languages.
export function createDictationPanel({ host, store, onInsert, confirmFirstUse, toast, phoneTags = [], onOpenChange = () => {} }) {
  const el = document.createElement('div');
  el.className = 'dict-panel';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Dictation');
  el.innerHTML = `
    <div class="dict-head">
      <strong>Dictation</strong>
      <span class="dict-status" data-s="status">Ready</span>
      <button type="button" class="dict-x" data-a="close" aria-label="Close dictation">&times;</button>
    </div>
    <div class="dict-lang">
      <button type="button" class="dict-langbtn" data-a="menu" aria-haspopup="listbox" aria-expanded="false">
        <span class="dict-langname" data-s="lang"></span><span class="dict-chev" aria-hidden="true">&#9662;</span>
      </button>
      <div class="dict-menu hidden" role="listbox">
        <input type="search" class="dict-search" placeholder="Search languages" aria-label="Search languages" autocomplete="off">
        <div class="dict-list" data-s="list"></div>
      </div>
    </div>
    <div class="dict-live" data-s="live"><span class="dict-hint">Your words appear in the note as you speak.</span></div>
    <div class="dict-row">
      <div class="dict-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <span class="dict-time" data-s="time">0:00</span>
      <label class="dict-nl"><input type="checkbox" data-s="nl"><span>New line</span></label>
    </div>
    <button type="button" class="dict-go" data-a="go"><span data-s="gotext">Start</span></button>`;
  host.appendChild(el);
  const $s = (k) => el.querySelector(`[data-s="${k}"]`);
  const menu = el.querySelector('.dict-menu'), search = el.querySelector('.dict-search'), bars = Array.from(el.querySelectorAll('.dict-meter i'));
  let lang = 'en-US', recent = [], run = null, listening = false, busy = false, secs = 0, clockT = null, open = false, destroyed = false;

  const setStatus = (t) => { $s('status').textContent = t; };
  const setLive = (t) => { const n = $s('live'); n.textContent = ''; if (t) { n.textContent = t; n.classList.add('on'); } else { n.classList.remove('on'); n.innerHTML = '<span class="dict-hint">Your words appear in the note as you speak.</span>'; } };
  const level = (v) => bars.forEach((b, i) => { const on = Math.max(0, Math.min(1, v * 1.15 - i * 0.12)); b.style.transform = `scaleY(${(0.18 + on * 0.82).toFixed(2)})`; b.style.opacity = String(0.35 + on * 0.65); });
  const paintGo = () => {
    const b = el.querySelector('[data-a="go"]');
    b.classList.toggle('stop', listening);
    b.disabled = busy;
    $s('gotext').textContent = busy ? 'Starting…' : listening ? 'Stop' : 'Start';
    el.querySelector('[data-a="menu"]').disabled = listening || busy;
    setStatus(busy ? 'Connecting…' : listening ? 'Listening' : 'Ready');
    el.classList.toggle('listening', listening);
  };
  const paintLang = () => { $s('lang').textContent = langName(lang); };

  const renderList = (q = '') => {
    const needle = q.trim().toLowerCase();
    const match = (t) => !needle || langName(t).toLowerCase().includes(needle) || nativeName(t).toLowerCase().includes(needle) || t.toLowerCase().includes(needle);
    const row = (t) => `<button type="button" class="dict-opt${t === lang ? ' sel' : ''}" role="option" aria-selected="${t === lang}" data-t="${esc(t)}"><span>${esc(langName(t))}</span>${nativeName(t) ? `<small>${esc(nativeName(t))}</small>` : ''}</button>`;
    const rec = recent.filter(match), all = SPEECH_LANGS.filter(match).sort((a, b) => langName(a).localeCompare(langName(b)));
    let h = '';
    if (rec.length) h += `<div class="dict-sec">Recent</div>${rec.map(row).join('')}<div class="dict-sep" role="separator"></div>`;
    h += all.length ? `<div class="dict-sec">All languages</div>${all.map(row).join('')}` : '<div class="dict-none">No language matches</div>';
    $s('list').innerHTML = h;
  };
  const setMenu = (on) => {
    menu.classList.toggle('hidden', !on);
    el.querySelector('[data-a="menu"]').setAttribute('aria-expanded', String(on));
    if (on) { search.value = ''; renderList(); const sel = $s('list').querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'center' }); }
  };
  const remember = async (t) => {
    recent = [t, ...recent.filter((x) => x !== t)].slice(0, 5);
    try { await store.set('dictation_recent', JSON.stringify(recent)); } catch { /* kept for this session */ }
  };

  const reset = () => {
    listening = false; busy = false; run = null;
    clearInterval(clockT); clockT = null; secs = 0; $s('time').textContent = '0:00';
    level(0); setLive(''); if (!destroyed) paintGo();
  };
  const stop = () => { if (run) { run.stop(); } listening = false; paintGo(); setStatus('Finishing…'); };
  const start = async () => {
    if (busy || listening || destroyed) return;
    busy = true; paintGo();
    try {
      if (!(await confirmFirstUse())) { reset(); return; }
      const info = await speechPrepare();
      if (destroyed) return;
      if (!info.ok) { reset(); toast(speechMessage(info.reason)); return; }
      await remember(lang);
      const nl = $s('nl').checked;
      run = dictate({
        language: lang,
        onPartial: (t) => { if (listening) setLive(t); },
        onFinal: (t) => { setLive(''); onInsert(t, { newline: nl }); },
        onLevel: (v) => { if (listening) level(v); },
        onError: (reason) => { toast(speechMessage(reason)); },
        onEnd: () => reset()
      });
      listening = true; busy = false; secs = 0;
      clockT = setInterval(() => { secs += 1; $s('time').textContent = clock(secs); }, 1000);
      paintGo();
    } catch (err) { reset(); toast(`Dictation could not start: ${(err && err.message) || err}`); }
  };

  el.addEventListener('click', (e) => {
    const opt = e.target.closest('.dict-opt');
    if (opt) { lang = opt.dataset.t; paintLang(); setMenu(false); return; }
    const a = e.target.closest('[data-a]');
    if (!a) { if (!menu.classList.contains('hidden') && !e.target.closest('.dict-menu')) setMenu(false); return; }
    if (a.dataset.a === 'go') { if (listening) stop(); else start(); }
    else if (a.dataset.a === 'menu') setMenu(menu.classList.contains('hidden'));
    else if (a.dataset.a === 'close') api.close();
  });
  search.addEventListener('input', () => renderList(search.value));

  (async () => {
    try { const r = JSON.parse(await store.get('dictation_recent', '[]')); recent = Array.isArray(r) ? r.filter((t) => SPEECH_LANGS.includes(t)).slice(0, 5) : []; } catch { recent = []; }
    try { $s('nl').checked = (await store.get('dictation_newline', 'false')) === 'true'; } catch { /* off */ }
    lang = defaultLanguage(recent, phoneTags); paintLang(); paintGo();
  })();
  $s('nl').addEventListener('change', () => { try { store.set('dictation_newline', String($s('nl').checked)); } catch { /* kept for this session */ } });

  const api = {
    isOpen: () => open,
    isListening: () => listening || busy,
    open() { if (destroyed) return; open = true; void el.offsetWidth; el.classList.add('open'); onOpenChange(true); },
    stop,
    close() { if (listening) stop(); setMenu(false); open = false; el.classList.remove('open'); onOpenChange(false); },
    toggle() { if (open) api.close(); else api.open(); },
    destroy() { destroyed = true; try { if (run) run.stop(); } catch { /* gone */ } clearInterval(clockT); el.remove(); }
  };
  return api;
}
