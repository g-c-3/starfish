// haptics.js — optional short vibration on a few actions. On by default; Settings switch, stored like every other
// on/off setting (metaGet/metaSet in app.js, key "haptics_enabled"). Decision 173.
// @capacitor/haptics 6.0.3: reviewed its shipped Android source before adopting. It only calls the system Vibrator; no network,
// no storage, no dependency. Its manifest adds the install-time VIBRATE permission (normal level, no prompt).
// Uses vibrate({ duration }) only: the plugin's impact/notification patterns are 20 to 60 ms pulses behind a zero-amplitude
// segment, too short for many phone motors to produce anything. A one-shot of a chosen length is felt on any motor.
// Two routes, same length: the plugin (native Vibrator) and the web view's navigator.vibrate. A new vibration replaces the one
// running, so a phone that honours either gives one buzz. First device test: the plugin answered with no error and the phone
// did not vibrate, so the system dropped that request; the second route is the other way in.
// Fire and forget: a failure or the web stub never blocks the action it accompanies; the last failure is kept for the Settings test.
import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';

let enabled = true;
let lastError = null;

// milliseconds per kind: 'tick' (selection started), 'saved' (a save went through), 'delete' (moved to trash), 'warning' (wrong password or PIN)
const DURATION_MS = { tick: 40, saved: 70, delete: 90, warning: 220 };

export function setHapticsEnabled(on) { enabled = !!on; }

function webVibrate(ms) {
  try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? navigator.vibrate(ms) : null; }
  catch { return false; }
}

export function haptic(kind) {
  if (!enabled || !DURATION_MS[kind]) return;
  const ms = DURATION_MS[kind];
  try {
    Haptics.vibrate({ duration: ms }).catch((e) => { lastError = String(e?.message || e); });
  } catch (e) { lastError = String(e?.message || e); }
  webVibrate(ms);
}

// Settings test: ignores the on/off switch, one 300 ms buzz, returns what the plugin answered. Nothing is stored or sent.
export async function testHaptics() {
  const info = { platform: Capacitor.getPlatform(), pluginAvailable: Capacitor.isPluginAvailable('Haptics'), lastError };
  let result;
  try {
    await Haptics.vibrate({ duration: 300 });
    result = { ok: true, ...info };
  } catch (e) {
    result = { ok: false, error: String(e?.message || e), ...info };
  }
  const w = webVibrate(300); // true = accepted, false = refused, null = not available
  return { ...result, web: w === null ? 'not available' : w ? 'accepted' : 'refused' };
}
