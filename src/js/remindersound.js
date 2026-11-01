// remindersound.js — the Reminder sound dialog and its bridge to the native side (Decision 359).
// window.ArklySound exists only in the Android app (patch-reminder-sound.js). Without it the dialog says so and nothing changes.
// The choice is kept natively, so it is there when a reminder fires with the app closed. No network, nothing leaves the phone.

const bridge = () => (typeof window !== 'undefined' && window.ArklySound) || null;
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_FILE_BYTES = 12 * 1024 * 1024; // the native side refuses more

// The channel reminders are scheduled on: the native one for a chosen sound, else `fallback` (the plain banner channel).
function currentChannelId(fallback) {
  const b = bridge();
  if (!b) return fallback;
  try { return parse(b.getConfig(), { mode: 'default' }).mode === 'default' ? fallback : (b.channelId() || fallback); } catch { return fallback; }
}

// Ends a reminder sound that is playing (Done or Snooze tapped in the app).
function stopSound() { try { bridge()?.stop(); } catch { /* nothing playing */ } }

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// register({ finish }) / register(null) lets a lock or Back close it. leaving(): the file chooser must not count as leaving the app.
// onApplied(): called after a saved choice so every reminder is scheduled again on the new channel.
function openSoundDialog({ toast, register, leaving, onApplied }) {
  return new Promise(async (resolve) => {
    const b = bridge();
    const el = document.createElement('div');
    el.id = 'reminder-sound-dialog';
    el.className = 'modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { b?.stopPreview(); } catch { /* none */ } el.remove(); if (register) register(null); resolve(v); };
    if (!b) {
      el.innerHTML = `<div class="modal-box rs-box"><h3>Reminder sound</h3><p class="rs-note">Sound settings are available in the Android app.</p><button type="button" class="rs-cancel">Close</button></div>`;
      document.body.appendChild(el);
      el.querySelector('.rs-cancel').onclick = () => finish(false);
      if (register) register({ finish: () => finish(false) });
      return;
    }
    const cfg = parse(b.getConfig(), { mode: 'default' });
    const notif = parse(b.listSounds('notification'), []);
    const alarm = parse(b.listSounds('alarm'), []);
    const opts = (list, sel) => list.map((s) => `<option value="${esc(s.u)}"${s.u === sel ? ' selected' : ''}>${esc(s.t)}</option>`).join('');
    const radio = (v, label) => `<label class="rs-opt"><input type="radio" name="rs-mode" value="${v}"${(cfg.mode || 'default') === v ? ' checked' : ''}> ${label}</label>`;
    el.innerHTML = `<div class="modal-box rs-box">
      <h3>Reminder sound</h3>
      ${radio('default', 'Default: the phone\'s notification sound')}
      ${radio('notification', 'A phone notification sound')}
      <select class="rs-notif" aria-label="Notification sound">${opts(notif, cfg.mode === 'notification' ? cfg.uri : '')}</select>
      ${radio('alarm', 'A phone alarm sound')}
      <select class="rs-alarm" aria-label="Alarm sound">${opts(alarm, cfg.mode === 'alarm' ? cfg.uri : '')}</select>
      ${radio('file', 'An audio file from the phone')}
      <div class="rs-filerow"><button type="button" class="secondary-btn rs-pick">Choose file</button><span class="rs-fname">${cfg.hasFile ? esc(cfg.fileTitle || 'Saved file') : 'No file chosen'}</span></div>
      <input type="file" class="rs-file hidden" accept="audio/*">
      <label class="rs-opt rs-rise"><input type="checkbox" class="rs-riseck"${cfg.rise ? ' checked' : ''}> Rise gradually (alarm sound and audio file)</label>
      <p class="rs-note">An alarm sound or audio file plays on the alarm volume, for up to a minute or until you tap Done, Snooze or swipe the reminder away. The default and a notification sound play once.</p>
      <p class="rs-err" aria-live="polite"></p>
      <button type="button" class="secondary-btn rs-test">Test</button>
      <button type="button" class="rs-save">Save</button>
      <button type="button" class="secondary-btn rs-cancel">Cancel</button>
    </div>`;
    document.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    const err = q('.rs-err');
    const mode = () => (el.querySelector('input[name="rs-mode"]:checked') || {}).value || 'default';
    const pickSelect = (sel, m) => { q(sel).onfocus = () => { el.querySelector(`input[name="rs-mode"][value="${m}"]`).checked = true; }; };
    pickSelect('.rs-notif', 'notification'); pickSelect('.rs-alarm', 'alarm');
    const label = (sel) => { const s = q(sel); return s.options[s.selectedIndex]?.text || ''; };
    q('.rs-cancel').onclick = () => finish(false);
    q('.rs-pick').onclick = () => { if (leaving) leaving(); q('.rs-file').click(); };
    q('.rs-file').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      err.textContent = '';
      if (f.size > MAX_FILE_BYTES) { err.textContent = 'That file is over 12 MB. Choose a shorter one.'; return; }
      try {
        const name = b.saveFile(f.name, toBase64(new Uint8Array(await f.arrayBuffer())));
        if (!name) { err.textContent = 'That file could not be saved.'; return; }
        q('.rs-fname').textContent = name;
        el.querySelector('input[name="rs-mode"][value="file"]').checked = true;
        cfg.hasFile = true;
      } catch { err.textContent = 'That file could not be read.'; }
    };
    q('.rs-test').onclick = () => {
      err.textContent = '';
      const m = mode();
      if (m === 'default') { err.textContent = 'The default sound plays when a reminder is due.'; return; }
      const ok = m === 'file' ? b.preview('file', '', true) : b.preview('uri', q(m === 'alarm' ? '.rs-alarm' : '.rs-notif').value, m === 'alarm');
      if (!ok) err.textContent = m === 'file' && !cfg.hasFile ? 'Choose an audio file first.' : 'That sound could not be played.';
    };
    q('.rs-save').onclick = async () => {
      err.textContent = '';
      const m = mode();
      if (m === 'file' && !cfg.hasFile) { err.textContent = 'Choose an audio file first.'; return; }
      const sel = m === 'alarm' ? '.rs-alarm' : '.rs-notif';
      const uri = m === 'alarm' || m === 'notification' ? q(sel).value : '';
      const title = m === 'file' ? (q('.rs-fname').textContent || '') : (uri ? label(sel) : '');
      const channel = b.setConfig(m, uri, title, q('.rs-riseck').checked && (m === 'alarm' || m === 'file'));
      if (!channel) { err.textContent = 'That choice could not be saved.'; return; }
      try { if (onApplied) await onApplied(); } catch { /* the next launch schedules again */ }
      if (toast) toast('Reminder sound saved');
      finish(true);
    };
    if (register) register({ finish: () => finish(false) });
  });
}

export { openSoundDialog, currentChannelId, stopSound };
