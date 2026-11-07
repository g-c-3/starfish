// dictpanel.js — the dictation panel of the notes editor (Decisions 412 and 413): a glass panel at the bottom, as the PDF mark bar.
// One header line holds the title and state, the voice level and timer, the New line switch, Start or Stop, and Close; under it the
// language menu (Recent, a separator, then every language the service has).
// Text goes into the note through onInsert, so the note saves it like typing. The voice goes to Google's speech service while it runs
// (Decision 411); nothing else is sent. Pressing the panel never takes the focus from the note, so its cursor stays visible.
import '../css/dictation.css';
import { speechPrepare, speechMessage, dictate } from './speech.js';
import { SPEECH_LANGS, langName, nativeName, defaultLanguage } from './speechlangs.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// host: the element it sits in. store: { get(key, fallback), set(key, value) }. onInsert(text, { newline }). confirmFirstUse(): true once
// the person has accepted where the voice goes. keepFocus(): gives the focus back to the note. onOpenChange(open), onResize().
export function createDictationPanel({ host, store, onInsert, confirmFirstUse, toast, phoneTags = [], keepFocus = () => {}, onOpenChange = () => {}, onResize = () => {} }) {
  const el = document.createElement('div');
  el.className = 'dict-panel';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Dictation');
  el.innerHTML = `
    <div class="dict-head">
      <div class="dict-zone dict-left">
        <div class="dict-title"><strong>Dictation</strong><span class="dict-status" data-s="status">Ready</span></div>
        <div class="dict-mt"><div class="dict-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span class="dict-time" data-s="time">0:00</span></div>
      </div>
      <button type="button" class="dict-go" data-a="go"><span data-s="gotext">Start</span></button>
      <div class="dict-zone dict-right">
        <div class="dict-nlbox"><button type="button" class="dict-nl" data-a="nl" aria-pressed="false" title="Start a new line after each phrase">New line</button></div>
        <button type="button" class="dict-x" data-a="close" aria-label="Close dictation">&times;</button>
      </div>
    </div>
    <div class="dict-lang">
      <button type="button" class="dict-langbtn" data-a="menu" aria-haspopup="listbox" aria-expanded="false">
        <span class="dict-langname" data-s="lang"></span><span class="dict-chev" aria-hidden="true">&#9662;</span>
      </button>
      <div class="dict-menu hidden" role="listbox">
        <input type="search" class="dict-search" placeholder="Search languages" aria-label="Search languages" autocomplete="off">
        <div class="dict-list" data-s="list"></div>
      </div>
    </div>`;
  host.appendChild(el);
  const $s = (k) => el.querySelector(`[data-s="${k}"]`);
  const menu = el.querySelector('.dict-menu'), search = el.querySelector('.dict-search'), bars = Array.from(el.querySelectorAll('.dict-meter i'));
  let lang = 'en-US', recent = [], newline = false, run = null, listening = false, busy = false, secs = 0, clockT = null, open = false, destroyed = false;

  const setStatus = (t) => { $s('status').textContent = t; };
  const level = (v) => bars.forEach((b, i) => { const on = Math.max(0, Math.min(1, v * 1.15 - i * 0.12)); b.style.transform = `scaleY(${(0.18 + on * 0.82).toFixed(2)})`; b.style.opacity = String(0.35 + on * 0.65); });
  const paintGo = (note) => {
    const b = el.querySelector('[data-a="go"]');
    b.classList.toggle('stop', listening);
    b.disabled = busy;
    $s('gotext').textContent = busy ? 'Starting' : listening ? 'Stop' : 'Start';
    el.querySelector('[data-a="menu"]').disabled = listening || busy;
    setStatus(note || (busy ? 'Connecting' : listening ? 'Listening' : 'Ready'));
    el.classList.toggle('listening', listening);
    el.querySelector('[data-a="nl"]').classList.toggle('on', newline);
    el.querySelector('[data-a="nl"]').setAttribute('aria-pressed', String(newline));
  };

  const paintLang = () => { $s('lang').textContent = langName(lang); };

  const renderList = (q = '') => {
    const needle = q.trim().toLowerCase();
    const match = (t) => !needle || langName(t).toLowerCase().includes(needle) || nativeName(t).toLowerCase().includes(needle) || t.toLowerCase().includes(needle);
    const row = (t, label, sub, cls = '') => `<button type="button" class="dict-opt${t === lang ? ' sel' : ''}${cls}" role="option" aria-selected="${t === lang}" data-t="${esc(t)}"><span class="dict-on">${esc(label)}</span>${sub ? `<small class="dict-os">${esc(sub)}</small>` : ''}</button>`;
    const lr = (t) => row(t, langName(t), nativeName(t));
    const rec = recent.filter(match), all = SPEECH_LANGS.filter(match).sort((a, b) => langName(a).localeCompare(langName(b)));
    let h = '';
    if (rec.length) h += `<div class="dict-sec">Recent</div>${rec.map(lr).join('')}`;
    if (all.length) h += `${h ? '<div class="dict-sep" role="separator"></div>' : ''}<div class="dict-sec">All languages</div>${all.map(lr).join('')}`;
    if (!h) h = '<div class="dict-none">No language matches</div>';
    $s('list').innerHTML = h;
  };
  const setMenu = (on) => {
    menu.classList.toggle('hidden', !on);
    el.querySelector('[data-a="menu"]').setAttribute('aria-expanded', String(on));
    if (on) { search.value = ''; renderList(); const sel = $s('list').querySelector('.sel'); if (sel) sel.scrollIntoView({ block: 'center' }); }
    onResize();
  };
  const remember = async (t) => {
    recent = [t, ...recent.filter((x) => x !== t)].slice(0, 5);
    try { await store.set('dictation_recent', JSON.stringify(recent)); } catch { /* kept for this session */ }
  };

  const reset = (note) => {
    listening = false; busy = false; run = null;
    clearInterval(clockT); clockT = null; secs = 0; $s('time').textContent = '0:00';
    level(0); if (!destroyed) paintGo(note);
  };
  const stop = () => { if (run) run.stop(); listening = false; paintGo('Finishing'); };
  const start = async () => {
    if (busy || listening || destroyed) return;
    if (navigator.onLine === false) { paintGo('Offline'); return; } // said in the panel, not as a message
    busy = true; paintGo();
    try {
      if (!(await confirmFirstUse())) { reset(); return; }
      const info = await speechPrepare();
      if (destroyed) return;
      if (!info.ok) { reset(); toast(speechMessage(info.reason)); return; }
      await remember(lang);
      run = dictate({
        language: lang,
        onFinal: (t) => { onInsert(t, { newline }); },
        onLevel: (v) => { if (listening) level(v); },
        onError: (reason) => { if (reason === 'network') { paintGo('Stopped'); return; } toast(speechMessage(reason)); }, // a dropped connection is never a message
        onEnd: () => reset(el.querySelector('.dict-status').textContent === 'Stopped' ? 'Stopped' : undefined)
      });
      listening = true; busy = false; secs = 0;
      clockT = setInterval(() => { secs += 1; $s('time').textContent = clock(secs); }, 1000);
      paintGo();
    } catch (err) { reset(); toast(`Dictation could not start: ${(err && err.message) || err}`); }
  };

  // Pressing the panel must not move the focus from the note (its cursor stays), except in the search field.
  el.addEventListener('mousedown', (e) => { if (!e.target.closest('.dict-search')) e.preventDefault(); });
  el.addEventListener('click', (e) => {
    const opt = e.target.closest('.dict-opt');
    if (opt) { lang = opt.dataset.t; paintLang(); setMenu(false); keepFocus(); return; }
    const a = e.target.closest('[data-a]');
    if (!a) { if (!menu.classList.contains('hidden') && !e.target.closest('.dict-menu')) setMenu(false); return; }
    if (a.dataset.a === 'go') { if (listening) stop(); else start(); }
    else if (a.dataset.a === 'menu') setMenu(menu.classList.contains('hidden'));
    else if (a.dataset.a === 'nl') { newline = !newline; paintGo(el.querySelector('.dict-status').textContent); try { store.set('dictation_newline', String(newline)); } catch { /* kept for this session */ } }
    else if (a.dataset.a === 'close') api.close();
    if (a.dataset.a !== 'menu') keepFocus();
  });
  search.addEventListener('input', () => renderList(search.value));
  search.addEventListener('blur', () => { if (!menu.classList.contains('hidden')) setTimeout(keepFocus, 0); });

  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => onResize()); ro.observe(el); }

  (async () => {
    try { const r = JSON.parse(await store.get('dictation_recent', '[]')); recent = Array.isArray(r) ? r.filter((t) => SPEECH_LANGS.includes(t)).slice(0, 5) : []; } catch { recent = []; }
    try { newline = (await store.get('dictation_newline', 'false')) === 'true'; } catch { newline = false; }
    lang = defaultLanguage(recent, phoneTags);
    paintLang(); paintGo();
  })();

  const api = {
    element: el,
    isOpen: () => open,
    isListening: () => listening || busy,
    open() { if (destroyed) return; open = true; void el.offsetWidth; el.classList.add('open'); onOpenChange(true); },
    stop,
    close() { if (listening) stop(); setMenu(false); open = false; el.classList.remove('open'); onOpenChange(false); },
    toggle() { if (open) api.close(); else api.open(); },
    destroy() { destroyed = true; try { if (run) run.stop(); } catch { /* gone */ } clearInterval(clockT); if (ro) ro.disconnect(); el.remove(); }
  };
  return api;
}
