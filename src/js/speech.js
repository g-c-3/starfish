// speech.js — dictation for the notes editor (Decision 408). Talks to window.ArklySpeech (patch-speech.js), which only ever uses the
// phone's on-device recognizer: Android 13 or newer, a language pack already on the phone. Nothing is sent anywhere; without the
// native bridge (a browser) there is no Mic. The spoken language is never guessed: the person chooses it.
const B = () => window.ArklySpeech || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };

export const speechPresent = () => !!B();

const MESSAGES = {
  native: 'Dictation is not available here',
  android: 'Dictation needs Android 13 or newer',
  device: 'This phone has no on-device speech recognizer',
  packs: 'No offline speech pack is on this phone. Add one in the phone settings (Languages, Speech), then try again',
  permission: 'Dictation needs the microphone',
  check: 'The phone could not tell which speech languages it has',
  language: 'That language is not available offline',
  busy: 'The speech recognizer is busy; try again',
  start: 'Dictation could not start',
  other: 'Dictation stopped'
};
export const speechMessage = (reason) => MESSAGES[reason] || MESSAGES.other;

// Permission, then the check of installed languages. { ok: true, languages: [BCP-47 tags] } or { ok: false, reason }.
export async function speechPrepare() {
  const b = B();
  if (!b) return { ok: false, reason: 'native' };
  if (!b.hasPermission()) {
    b.requestPermission();
    for (let i = 0; i < 600; i++) { const p = J(b.status()).perm; if (p === 'granted' || p === 'denied') break; await sleep(100); }
    if (!b.hasPermission()) return { ok: false, reason: 'permission' };
  }
  b.prepare();
  for (let i = 0; i < 80; i++) {
    const s = J(b.status());
    if (s.prep === 'ready') return { ok: true, languages: Array.isArray(s.languages) ? s.languages : [] };
    if (s.prep === 'unavailable') return { ok: false, reason: s.reason || 'device' };
    await sleep(100);
  }
  return { ok: false, reason: 'check' };
}

export function languageLabel(tag) {
  try {
    const n = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(tag);
    if (n && n !== tag) return `${n} (${tag})`;
  } catch { /* the tag is shown as it is */ }
  return tag;
}

// Dictation until stop(): each pause in speech ends one round and the next starts, so it runs on until the person taps again.
// onFinal(text) once per phrase; onPartial(text) while speaking; onError(reason) ends it. Returns { stop }.
export function dictate({ language, onPartial, onFinal, onError }) {
  const b = B();
  let active = true, done = false, lastStart = 0, quick = 0;
  const begin = () => { lastStart = Date.now(); b.start(language); };
  const finish = () => { if (done) return; done = true; active = false; clearInterval(timer); try { b.cancel(); } catch { /* gone */ } };
  begin();
  const timer = setInterval(() => {
    if (done) return;
    const r = J(b.poll());
    for (const t of r.finals || []) if (t) onFinal(t);
    if (onPartial) onPartial(r.partial || '');
    if (r.run === 'error') { finish(); onError(r.error || 'other'); return; }
    if (r.run === 'ended') {
      if (!active) { finish(); return; }
      quick = Date.now() - lastStart < 700 ? quick + 1 : 0; // rounds that end at once: something is wrong, do not loop
      if (quick >= 5) { finish(); onError('other'); return; }
      begin();
    }
  }, 120);
  return {
    stop() {
      if (!active || done) return;
      active = false;
      try { b.stop(); } catch { /* gone */ }
      setTimeout(finish, 3000); // the last phrase arrives first; this only guards a recognizer that never answers
    }
  };
}
