// haptics.js — optional short vibration on a few actions. On by default; Settings switch, stored like every other
// on/off setting (metaGet/metaSet in app.js, key "haptics_enabled"). Decision 173.
// @capacitor/haptics 6.0.3: reviewed its shipped Android source before adopting. It only calls the system Vibrator; no network,
// no storage, no dependency. Its manifest adds the install-time VIBRATE permission (normal level, no prompt).
// Fire and forget: a failure or the web stub never blocks the action it accompanies.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

let enabled = true;

export function setHapticsEnabled(on) { enabled = !!on; }

// kind: 'tick' (selection started), 'saved' (a save went through), 'delete' (moved to trash), 'warning' (wrong password or PIN)
export function haptic(kind) {
  if (!enabled) return;
  try {
    let p;
    if (kind === 'tick') p = Haptics.impact({ style: ImpactStyle.Light });
    else if (kind === 'saved') p = Haptics.notification({ type: NotificationType.Success });
    else if (kind === 'delete') p = Haptics.impact({ style: ImpactStyle.Medium });
    else if (kind === 'warning') p = Haptics.notification({ type: NotificationType.Warning });
    p?.catch(() => {});
  } catch { /* not available here */ }
}
