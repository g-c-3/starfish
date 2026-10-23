// Capture-only screen for the home-screen widget (Decisions 264-267). Its own layer above every screen: it reads no Home table,
// renders no timeline and shows no stored entry. Each capture is written to widget_inbox (widget-inbox.js) with a default name;
// there is no Save dialog, no tags, no suggestions and no drafts. The Vault is not reachable from here.
import { App } from '@capacitor/app';
import { VoiceRecorder } from 'cap-voice-rec';
import { Geolocation } from '@capacitor/geolocation';
import { scheduleReminder, cancelReminder } from './notifications.js';
import { saveBase64, removeFile } from './files.js';
import { addToInbox, inboxCount, transferInbox } from './widget-inbox.js';
import * as Money from './money.js';
import '../css/widget.css';

const LINK = /^arkly:\/\/capture\/(note|voice|image|money|more)\/?$/;
const TITLES = { note: 'Note', voice: 'Voice', image: 'Image', money: 'Money', more: 'More', reminder: 'Reminder', location: 'Location', pdf: 'PDF', file: 'File' };
const ICONS = { note: 'i-note', voice: 'i-voice', image: 'i-image', money: 'i-money', more: 'i-plus', reminder: 'i-reminder', location: 'i-location', pdf: 'i-pdf', file: 'i-file' };
const MORE_KINDS = ['reminder', 'location', 'pdf', 'file'];
const REPEATS = [['', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#${ICONS[k]}"/></svg>`;
const LEAVE_DELAY_MS = 900;

let root = null;
let current = null; // { kind, cancel(), dispose() } while a capture is open
let opening = false; // set before the first await in open(), so the flag below is never late

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const stamp = () => {
  const d = new Date();
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

function extensionForAudio(mime) {
  const map = { 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
  return map[mime] || map[String(mime || '').split(';')[0]] || 'aac';
}
function extensionForImage(file) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };
  return map[file.type] || (/\.([A-Za-z0-9]+)$/.exec(file.name || '') || [])[1]?.toLowerCase() || 'jpg';
}
function base64ToUrl(b64, mime) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error || new Error('Could not read the photo'));
    r.readAsDataURL(file);
  });
}

function ensureRoot() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'widget-screen';
  root.className = 'widget-screen hidden';
  document.body.appendChild(root);
  return root;
}

function show(kind, locked, bodyHtml) {
  const el = ensureRoot();
  el.innerHTML = `
    <div class="widget-head">
      <div class="widget-title"><span class="widget-disc" data-type="${kind === 'more' ? 'file' : kind}" ${kind === 'more' ? 'data-more="1"' : ''}>${icon(kind)}</span><h2>${esc(TITLES[kind])}</h2></div>
      <button type="button" id="widget-cancel" class="secondary-btn">Cancel</button>
    </div>
    ${locked ? '<p class="widget-note">Arkly is locked. This is added to Home when you unlock.</p>' : ''}
    <div class="widget-body">${bodyHtml}</div>
    <p class="widget-error" id="widget-error" role="alert"></p>`;
  el.classList.remove('hidden');
  window.arklyWidgetActive = true;
  return el;
}

function hide() {
  if (root) { root.classList.add('hidden'); root.innerHTML = ''; }
  window.arklyWidgetActive = false;
  opening = false;
  current = null;
}

// Per-kind builders return { save(): Promise<inboxItem|null>, dispose(), dirty() }. save() reports its own validation errors.
function buildNote(el) {
  const area = el.querySelector('#widget-text');
  setTimeout(() => area.focus(), 50);
  return {
    dirty: () => !!area.value.trim(),
    dispose() {},
    async save(fail) {
      const text = area.value.trim();
      if (!text) { fail('Write something first.'); return null; }
      const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
      return { type: 'note', label: first.slice(0, 40) || `Note ${stamp()}`, body_text: text };
    }
  };
}

function buildMoney(el, ctx, symbol) {
  const KINDS = Money.KINDS;
  let kind = 'spent';
  const amount = el.querySelector('#widget-amount');
  const note = el.querySelector('#widget-money-note');
  const chips = [...el.querySelectorAll('[data-kind]')];
  const paint = () => chips.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
  chips.forEach((b) => b.addEventListener('click', () => { if (KINDS.includes(b.dataset.kind)) { kind = b.dataset.kind; paint(); } }));
  paint();
  setTimeout(() => amount.focus(), 50);
  return {
    dirty: () => !!amount.value.trim() || !!note.value.trim(),
    dispose() {},
    async save(fail) {
      const a = Money.parseAmount(amount.value);
      if (!a.ok) { fail(a.error); return null; }
      const n = Money.normalize({ kind, amount: a.minor, category: '', method: '', at: Date.now() });
      if (!n.ok) { fail(n.error); return null; }
      return { type: 'money', label: Money.summary(n.value), description: note.value.trim() || null, money_json: Money.toJson(n.value) };
    }
  };
}

function buildVoice(el, ctx) {
  const stage = el.querySelector('#widget-voice');
  const saveBtn = el.querySelector('#widget-save');
  let state = 'ready', timer = null, startedAt = 0, taken = null, url = null, gone = false;

  const drop = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  const draw = () => {
    saveBtn.disabled = state !== 'review';
    if (state === 'ready') stage.innerHTML = '<button type="button" id="widget-rec">Start recording</button>';
    else if (state === 'recording') stage.innerHTML = '<div class="widget-timer" id="widget-timer">0:00</div><button type="button" id="widget-rec">Stop</button>';
    else if (state === 'stopping') stage.innerHTML = '<p class="widget-note">Finishing…</p>';
    else stage.innerHTML = `<audio controls src="${url}"></audio><button type="button" id="widget-rec" class="secondary-btn">Record again</button>`;
    stage.querySelector('#widget-rec')?.addEventListener('click', onRec);
  };
  const tick = () => { const t = stage.querySelector('#widget-timer'); if (t) t.textContent = clock(Date.now() - startedAt); };

  async function start(fail) {
    try {
      const has = await VoiceRecorder.hasAudioRecordingPermission();
      if (!has.value) {
        ctx.beginPickerLaunch(); // the permission prompt pauses the page; that must not count as leaving
        if (!(await VoiceRecorder.requestAudioRecordingPermission()).value) { fail('Microphone permission denied.'); return; }
      }
      const r = await VoiceRecorder.startRecording();
      if (!r.value) { fail('Could not start recording.'); return; }
    } catch (err) { fail(`Microphone unavailable: ${err.message || err}`); return; }
    if (gone) { VoiceRecorder.stopRecording().catch(() => {}); return; }
    state = 'recording'; startedAt = Date.now(); timer = setInterval(tick, 250); draw();
  }
  async function stop(fail) {
    clearInterval(timer); state = 'stopping'; draw();
    try {
      const res = (await VoiceRecorder.stopRecording()).value;
      if (gone) return;
      taken = { base64: res.recordDataBase64, mime: res.mimeType };
      drop(); url = base64ToUrl(taken.base64, taken.mime || 'audio/aac');
      state = 'review';
    } catch (err) { if (gone) return; fail(`Recording failed: ${err.message || err}`); state = 'ready'; }
    draw();
  }
  const fail = (m) => { const e = el.querySelector('#widget-error'); if (e) e.textContent = m; };
  function onRec() {
    fail('');
    if (state === 'ready' || state === 'review') { if (state === 'review') { taken = null; drop(); } start(fail).then(() => { if (state !== 'recording') { state = 'ready'; draw(); } }); }
    else if (state === 'recording') stop(fail);
  }
  draw();
  return {
    dirty: () => state === 'recording' || state === 'review',
    dispose() {
      gone = true; clearInterval(timer); drop();
      if (state === 'recording') VoiceRecorder.stopRecording().catch(() => {}); // the take is discarded
    },
    async save(failFn) {
      if (!taken) { failFn('Record something first.'); return null; }
      const saved = await saveBase64(taken.base64);
      return { type: 'voice', label: `Voice ${new Date().toLocaleTimeString()}`, extension: extensionForAudio(taken.mime), file_path: saved.path, file_key: saved.fileKey };
    }
  };
}

function buildImage(el, ctx) {
  const stage = el.querySelector('#widget-image');
  const saveBtn = el.querySelector('#widget-save');
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
  let picked = null, url = null;
  const drop = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  const draw = () => {
    saveBtn.disabled = !picked;
    stage.innerHTML = picked
      ? `<img alt="Photo to save" src="${url}"><button type="button" id="widget-shoot" class="secondary-btn">Retake</button>`
      : '<button type="button" id="widget-shoot">Take photo</button>';
    stage.querySelector('#widget-shoot').addEventListener('click', () => { ctx.beginPickerLaunch(); input.click(); });
  };
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const b64 = await readAsBase64(file);
      drop(); picked = { base64: b64, ext: extensionForImage(file) }; url = URL.createObjectURL(file);
      draw();
    } catch (err) { const e = el.querySelector('#widget-error'); if (e) e.textContent = String(err.message || err); }
  });
  draw();
  return {
    dirty: () => !!picked,
    dispose() { drop(); picked = null; },
    async save(fail) {
      if (!picked) { fail('Take a photo first.'); return null; }
      const saved = await saveBase64(picked.base64);
      return { type: 'image', label: `Image ${stamp()}`, extension: picked.ext, file_path: saved.path, file_key: saved.fileKey };
    }
  };
}


const localInput = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function buildReminder(el) {
  const what = el.querySelector('#widget-what');
  const when = el.querySelector('#widget-when');
  const repeat = el.querySelector('#widget-repeat');
  setTimeout(() => what.focus(), 50);
  return {
    dirty: () => !!what.value.trim(),
    dispose() {},
    async save(fail) {
      const label = what.value.trim();
      const at = new Date(when.value).getTime();
      if (!label) { fail('Say what to be reminded of.'); return null; }
      if (!Number.isFinite(at) || at < Date.now() + 5000) { fail('Pick a time in the future.'); return null; }
      const item = { id: crypto.randomUUID(), type: 'reminder', label, fire_at: at, repeat_rule: repeat.value || null };
      // Scheduled now, so it rings on time even if the app stays locked; the entry itself appears at unlock.
      try { await scheduleReminder({ id: item.id, label, fire_at: at, repeat_rule: item.repeat_rule }); }
      catch (err) { fail(`Could not set the reminder: ${err.message || err}`); return null; }
      return item;
    }
  };
}

function buildLocation(el, ctx) {
  const stage = el.querySelector('#widget-fix');
  const name = el.querySelector('#widget-loc-name');
  const saveBtn = el.querySelector('#widget-save');
  let fix = null, busy = false, gone = false;
  const fail = (m) => { const e = el.querySelector('#widget-error'); if (e) e.textContent = m; };
  const draw = () => {
    saveBtn.disabled = !fix;
    stage.innerHTML = fix
      ? `<p class="widget-fixline">${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}</p><button type="button" id="widget-locate" class="secondary-btn">Update</button>`
      : `<button type="button" id="widget-locate">${busy ? 'Finding…' : 'Use my location'}</button>`;
    stage.querySelector('#widget-locate').addEventListener('click', locate);
  };
  async function locate() {
    if (busy) return;
    busy = true; fail(''); draw();
    try {
      ctx.beginPickerLaunch(); // the permission prompt pauses the page; that must not count as leaving
      await Geolocation.requestPermissions();
      const c = (await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })).coords;
      if (!gone) fix = { lat: c.latitude, lng: c.longitude };
    } catch (err) { if (!gone) fail(`Could not get your location: ${err.message || err}`); }
    busy = false;
    if (!gone) draw();
  }
  draw();
  return {
    dirty: () => !!fix,
    dispose() { gone = true; },
    async save(failFn) {
      if (!fix) { failFn('Get your location first.'); return null; }
      return { type: 'location', label: name.value.trim() || `Location ${stamp()}`, latitude: fix.lat, longitude: fix.lng };
    }
  };
}

function buildPick(kind) {
  return (el, ctx) => {
    const stage = el.querySelector('#widget-pick');
    const saveBtn = el.querySelector('#widget-save');
    const input = document.createElement('input');
    input.type = 'file';
    if (kind === 'pdf') input.accept = 'application/pdf,.pdf';
    let picked = null;
    const fail = (m) => { const e = el.querySelector('#widget-error'); if (e) e.textContent = m; };
    const draw = () => {
      saveBtn.disabled = !picked;
      stage.innerHTML = picked
        ? `<p class="widget-fixline">${esc(picked.name)}</p><button type="button" id="widget-choose" class="secondary-btn">Choose another</button>`
        : `<button type="button" id="widget-choose">${kind === 'pdf' ? 'Choose a PDF' : 'Choose a file'}</button>`;
      stage.querySelector('#widget-choose').addEventListener('click', () => { ctx.beginPickerLaunch(); input.click(); });
    };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const base64 = await readAsBase64(file);
        const dot = file.name.lastIndexOf('.');
        const ext = kind === 'pdf' ? 'pdf' : (dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '') || 'bin';
        picked = { base64, ext, name: file.name, label: (dot > 0 ? file.name.slice(0, dot) : file.name).slice(0, 80) };
        draw();
      } catch (err) { fail(String(err.message || err)); }
    });
    draw();
    return {
      dirty: () => !!picked,
      dispose() { picked = null; },
      async save(failFn) {
        if (!picked) { failFn(kind === 'pdf' ? 'Choose a PDF first.' : 'Choose a file first.'); return null; }
        const saved = await saveBase64(picked.base64);
        return { type: kind, label: picked.label || (kind === 'pdf' ? 'PDF' : 'File'), extension: picked.ext, file_path: saved.path, file_key: saved.fileKey };
      }
    };
  };
}

function buildMore(el, ctx) {
  el.querySelectorAll('[data-more-kind]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.moreKind;
    if (!MORE_KINDS.includes(k)) return;
    hide();
    open(k, ctx).catch(() => hide());
  }));
  return { dirty: () => false, dispose() {}, async save() { return null; } };
}

const BODIES = {
  note: '<textarea id="widget-text" placeholder="Write a note" aria-label="Note"></textarea>',
  voice: '<div id="widget-voice"></div>',
  image: '<div id="widget-image"></div>',
  reminder: () => `
    <input id="widget-what" type="text" placeholder="Remind me to…" aria-label="Reminder" autocomplete="off">
    <input id="widget-when" type="datetime-local" value="${localInput(Math.ceil((Date.now() + 3600000) / 60000) * 60000)}" aria-label="When">
    <select id="widget-repeat" aria-label="Repeat">${REPEATS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`,
  location: `
    <div id="widget-fix"></div>
    <input id="widget-loc-name" type="text" placeholder="Name (optional)" aria-label="Name" autocomplete="off">`,
  pdf: '<div id="widget-pick"></div>',
  file: '<div id="widget-pick"></div>',
  more: `<div class="widget-tiles">${MORE_KINDS.map((k) => `<button type="button" class="widget-tile" data-type="${k}" data-more-kind="${k}"><span class="widget-disc">${icon(k)}</span><span>${esc(TITLES[k])}</span></button>`).join('')}</div>`,
  money: (symbol) => `
    <div class="widget-chips">${Money.KINDS.map((k) => `<button type="button" class="secondary-btn" data-kind="${k}" aria-pressed="false">${esc(Money.KIND_LABELS[k])}</button>`).join('')}</div>
    <div class="widget-amount"><span>${esc(symbol)}</span><input id="widget-amount" type="text" inputmode="decimal" placeholder="Amount" aria-label="Amount" autocomplete="off"></div>
    <input id="widget-money-note" type="text" placeholder="Note (optional)" aria-label="Note" autocomplete="off">`
};

async function open(kind, ctx) {
  if (current || opening) return; // one capture at a time
  opening = true;
  window.arklyWidgetActive = true; // at once: the fingerprint offer checks it and must not start during the awaits below
  let symbol = Money.DEFAULT_SYMBOL;
  if (kind === 'money') {
    try { symbol = Money.cleanSymbol(((await ctx.db.query(`SELECT value FROM meta WHERE key = 'currency_symbol'`)).values || [])[0]?.value); } catch { /* default */ }
  }
  const locked = !ctx.isUnlocked();
  const body = (typeof BODIES[kind] === 'function' ? BODIES[kind](symbol) : BODIES[kind]) + (kind === 'more' ? '' : '<div class="widget-actions"><button type="button" id="widget-save">Save</button></div>');
  const el = show(kind, locked, body);
  opening = false;
  const failMsg = (m) => { const e = el.querySelector('#widget-error'); if (e) e.textContent = m; };
  const view = ({ note: buildNote, money: buildMoney, voice: buildVoice, image: buildImage, reminder: buildReminder, location: buildLocation, pdf: buildPick('pdf'), file: buildPick('file'), more: buildMore })[kind](el, ctx, symbol);
  let busy = false;

  const close = () => { view.dispose(); hide(); };
  current = { kind, dispose: close, cancel: close };
  el.querySelector('#widget-cancel').addEventListener('click', close);

  el.querySelector('#widget-save')?.addEventListener('click', async () => {
    if (busy) return;
    busy = true; failMsg('');
    let item = null;
    try {
      item = await view.save(failMsg);
      if (!item) { busy = false; return; }
      await addToInbox(ctx.db, item);
    } catch (err) {
      if (item?.file_path) await removeFile(item); // the file would have no row
      if (item?.type === 'reminder') await cancelReminder(item.id).catch(() => {}); // the alarm would have no row
      failMsg(`Could not save: ${err.message || err}`); busy = false; return;
    }
    view.dispose();
    if (ctx.isUnlocked()) {
      await transferInbox(ctx.db).catch(() => 0);
      hide();
      ctx.toast('Saved');
      ctx.afterSave();
      return;
    }
    const waiting = await inboxCount(ctx.db).catch(() => 0);
    el.innerHTML = `<p class="widget-done">Saved.<br>${waiting} waiting. Added to Home at unlock.</p>`;
    setTimeout(() => { hide(); App.minimizeApp().catch(() => {}); }, LEAVE_DELAY_MS);
  });
}

// ctx: { db, isUnlocked(), beginPickerLaunch(), toast(msg), afterSave() }
async function initWidgetCapture(ctx) {
  const handle = (url) => { const m = LINK.exec(String(url || '')); if (m) open(m[1], ctx).catch(() => hide()); };
  App.addListener('appUrlOpen', ({ url }) => handle(url));
  try { const launch = await App.getLaunchUrl(); handle(launch?.url); } catch { /* no launch link */ }
}

// Back closes an open capture first. Returns true when it did.
function handleWidgetBack() {
  if (!current) return false;
  current.cancel();
  return true;
}

// A lock or backgrounding closes the screen; an unsaved capture is dropped (no drafts, Decision 265).
function closeWidgetCapture() { if (current) current.dispose(); }

export { initWidgetCapture, handleWidgetBack, closeWidgetCapture };
