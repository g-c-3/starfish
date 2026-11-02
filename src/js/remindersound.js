// remindersound.js — sound and vibration settings for reminders and their bridge to the native side (Decisions 359, 363).
// window.ArklySound exists only in the Android app (patch-reminder-sound.js). Without it the dialog says so and nothing changes.
// One setting for all reminders and, optionally, one for a single reminder; both are kept natively, so they are there when a
// reminder fires with the app closed. They are device settings and are not part of backups. No network, nothing leaves the phone.

const bridge = () => (typeof window !== 'undefined' && window.ArklySound) || null;
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_FILE_BYTES = 12 * 1024 * 1024; // the native side refuses more

// The channel a reminder is scheduled on: the native one for its setting (its own, else the global one), else `fallback`
// (the plain banner channel, when there is no native side).
function currentChannelId(fallback, entryId = '') {
  const b = bridge();
  if (!b) return fallback;
  try { return (entryId ? b.channelForEntry(entryId) : b.channelId()) || fallback; } catch { return fallback; }
}

// Ends a reminder sound that is playing (Done or Snooze tapped in the app).
function stopSound() { try { bridge()?.stop(); } catch { /* nothing playing */ } }

// A reminder's own setting ({ mode, uri, title, rise, vibrate }), or null when it follows the global one.
function getReminderAlert(entryId) {
  const b = bridge();
  if (!b || !entryId) return null;
  try { return parse(b.getReminderConfig(entryId), null) || null; } catch { return null; }
}
// cfg null: follow the global setting again. Returns false when the choice was refused or there is no native side.
function setReminderAlert(entryId, cfg) {
  const b = bridge();
  if (!b || !entryId) return false;
  try { return !!b.setReminderConfig(entryId, cfg ? JSON.stringify(cfg) : ''); } catch { return false; }
}
// 'all' (follows the global setting), 'custom', or 'silent' (its own setting with no sound and no vibration); null without a native side.
function reminderAlertState(entryId) {
  if (!bridge()) return null;
  const c = getReminderAlert(entryId);
  if (!c) return 'all';
  return c.mode === 'none' && !c.vibrate ? 'silent' : 'custom';
}
const MODE_TEXT = { default: 'Phone notification sound', notification: 'Notification sound', alarm: 'Alarm sound', file: 'Audio file', none: 'No sound' };
const alertSummary = (c) => (c ? `${(MODE_TEXT[c.mode] || MODE_TEXT.default)}${c.vibrate ? ' + vibrate' : ''}` : 'Same as all reminders');

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// The dialog. With no `reminder` option it edits the setting for all reminders and applies it itself (resolves true when saved).
// With `reminder: { initial }` it edits one reminder's own setting and does not apply it: it resolves { cfg } (cfg null = follow the
// global setting) or null when cancelled; the caller keeps it or hands it to setReminderAlert.
// register({ finish }) / register(null) lets a lock or Back close it. leaving(): the file chooser must not count as leaving the app.
// onApplied(): after a saved global choice, so every reminder is scheduled again on its channel.
function openSoundDialog({ toast, register, leaving, onApplied, reminder = null } = {}) {
  return new Promise(async (resolve) => {
    const b = bridge();
    const single = !!reminder;
    const el = document.createElement('div');
    el.id = 'reminder-sound-dialog';
    el.className = 'modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { b?.stopPreview(); } catch { /* none */ } el.remove(); if (register) register(null); resolve(v); };
    const title = single ? 'Sound for this reminder' : 'Reminder sound';
    if (!b) {
      el.innerHTML = `<div class="modal-box rs-box"><h3>${title}</h3><p class="rs-note">Sound and vibration settings are available in the Android app.</p><button type="button" class="rs-cancel">Close</button></div>`;
      document.body.appendChild(el);
      el.querySelector('.rs-cancel').onclick = () => finish(single ? null : false);
      if (register) register({ finish: () => finish(single ? null : false) });
      return;
    }
    const glob = parse(b.getConfig(), { mode: 'default' });
    const own = single ? (reminder.initial || null) : null;
    const cfg = own || glob; // what the controls start from
    const notif = parse(b.listSounds('notification'), []);
    const alarm = parse(b.listSounds('alarm'), []);
    const opts = (list, sel) => list.map((s) => `<option value="${esc(s.u)}"${s.u === sel ? ' selected' : ''}>${esc(s.t)}</option>`).join('');
    const radio = (v, label, extra = '') => `<label class="rs-opt"><input type="radio" name="rs-mode" value="${v}"${(cfg.mode || 'default') === v && !(single && !own) ? ' checked' : ''}${extra}> ${label}</label>`;
    const fileLine = single
      ? `<span class="rs-fname">${glob.hasFile ? esc(glob.fileTitle || 'Saved file') : 'None saved. Choose one in the Reminder sound settings.'}</span>`
      : `<div class="rs-filerow"><button type="button" class="secondary-btn rs-pick">Choose file</button><span class="rs-fname">${glob.hasFile ? esc(glob.fileTitle || 'Saved file') : 'No file chosen'}</span></div><input type="file" class="rs-file hidden" accept="audio/*">`;
    el.innerHTML = `<div class="modal-box rs-box">
      <h3>${title}</h3>
      ${single ? `<label class="rs-opt rs-same"><input type="radio" name="rs-mode" value="same"${own ? '' : ' checked'}> Same as all reminders</label>` : ''}
      <div class="rs-group">
      ${radio('default', 'Phone notification sound')}
      ${radio('notification', 'Choose a notification sound')}
      <select class="rs-notif" aria-label="Notification sound">${opts(notif, cfg.mode === 'notification' ? cfg.uri : '')}</select>
      ${radio('alarm', 'Choose an alarm sound')}
      <select class="rs-alarm" aria-label="Alarm sound">${opts(alarm, cfg.mode === 'alarm' ? cfg.uri : '')}</select>
      ${radio('file', single ? 'The saved audio file' : 'An audio file from the phone', single && !glob.hasFile ? ' disabled' : '')}
      ${fileLine}
      ${radio('none', 'No sound')}
      <label class="rs-opt rs-rise"><input type="checkbox" class="rs-riseck"${cfg.rise ? ' checked' : ''}> Rise gradually (alarm sound and audio file)</label>
      <label class="rs-opt rs-vib"><input type="checkbox" class="rs-vibck"${cfg.vibrate ? ' checked' : ''}> Vibrate</label>
      </div>
      <p class="rs-note">${single ? 'These apply to this reminder only. ' : ''}An alarm sound or audio file plays on the alarm volume, for up to a minute or until you tap Done, Snooze or swipe the reminder away. The others play once.</p>
      <p class="rs-err" aria-live="polite"></p>
      <button type="button" class="secondary-btn rs-test">Test</button>
      <button type="button" class="rs-save">Save</button>
      <button type="button" class="secondary-btn rs-cancel">Cancel</button>
    </div>`;
    document.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    const err = q('.rs-err');
    const mode = () => (el.querySelector('input[name="rs-mode"]:checked') || {}).value || 'default';
    const syncSame = () => q('.rs-group').classList.toggle('rs-dim', mode() === 'same');
    el.addEventListener('change', syncSame); syncSame();
    const pickSelect = (sel, m) => { q(sel).onfocus = () => { el.querySelector(`input[name="rs-mode"][value="${m}"]`).checked = true; syncSame(); }; };
    pickSelect('.rs-notif', 'notification'); pickSelect('.rs-alarm', 'alarm');
    const label = (sel) => { const s = q(sel); return s.options[s.selectedIndex]?.text || ''; };
    q('.rs-cancel').onclick = () => finish(single ? null : false);
    if (!single) {
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
          glob.hasFile = true;
        } catch { err.textContent = 'That file could not be read.'; }
      };
    }
    q('.rs-test').onclick = () => {
      err.textContent = '';
      const m = mode();
      if (m === 'same') { err.textContent = 'This reminder follows the setting for all reminders.'; return; }
      if (q('.rs-vibck').checked) { try { b.vibrateTest(); } catch { /* an older build */ } }
      if (m === 'none') { err.textContent = q('.rs-vibck').checked ? '' : 'No sound is played.'; return; }
      if (m === 'default') { const first = notif[0]; if (!first || !b.preview('uri', first.u, false)) err.textContent = 'That sound could not be played.'; return; }
      const ok = m === 'file' ? b.preview('file', '', true) : b.preview('uri', q(m === 'alarm' ? '.rs-alarm' : '.rs-notif').value, m === 'alarm');
      if (!ok) err.textContent = m === 'file' && !glob.hasFile ? 'Choose an audio file first.' : 'That sound could not be played.';
    };
    q('.rs-save').onclick = async () => {
      err.textContent = '';
      const m = mode();
      if (single && m === 'same') { finish({ cfg: null }); return; }
      if (m === 'file' && !glob.hasFile) { err.textContent = 'Choose an audio file first.'; return; }
      const sel = m === 'alarm' ? '.rs-alarm' : '.rs-notif';
      const uri = m === 'alarm' || m === 'notification' ? q(sel).value : '';
      const name = m === 'file' ? (glob.fileTitle || q('.rs-fname')?.textContent || '') : (uri ? label(sel) : '');
      const rise = q('.rs-riseck').checked && (m === 'alarm' || m === 'file');
      const vibrate = q('.rs-vibck').checked;
      if (single) { finish({ cfg: { mode: m, uri, title: name, rise, vibrate } }); return; }
      const channel = b.setConfig(m, uri, name, rise, vibrate);
      if (!channel) { err.textContent = 'That choice could not be saved.'; return; }
      try { if (onApplied) await onApplied(); } catch { /* the next launch schedules again */ }
      if (toast) toast('Reminder sound saved');
      finish(true);
    };
    if (register) register({ finish: () => finish(single ? null : false) });
  });
}

export { openSoundDialog, currentChannelId, stopSound, getReminderAlert, setReminderAlert, reminderAlertState, alertSummary };
