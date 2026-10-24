// biometric.js — optional fingerprint/face unlock as an alternative to typing the app-open
// password or the Vault PIN. Convenience layer only: the password/PIN entered at setup time
// stays the real credential and the only one either recovery flow (ARCHITECTURE §3) ever
// touches. Off by default; app-open password and Vault PIN are enabled/disabled independently
// (the three credentials stay independent — same rule as everywhere else, Decision 50).
//
// Security note, stated plainly rather than oversold: @capgo/capacitor-native-biometric stores
// the secret AES-GCM-encrypted under an Android Keystore key that requires the device to be
// unlocked to use (`setUnlockedDeviceRequired`) — confirmed by reading its native source, not
// assumed. That key does NOT itself require a fresh biometric check to decrypt (no
// `setUserAuthenticationRequired` on the plugin's key). So the actual biometric gate here is
// enforced at the call-flow level: this module always calls `verifyIdentity()` and only calls
// `getCredentials()` after it resolves successfully. That matches how most consumer apps'
// "unlock with fingerprint" features work, but it is not a hardware-enforced guarantee against
// a modified client — worth knowing, not worth pretending otherwise. Manual password/PIN entry
// remains the actual security boundary; this is a convenience path on top of it.
//
// Also note: the plugin's key isn't invalidated when the device's biometric enrollment changes
// (no `setInvalidatedByBiometricEnrollment`), so a newly-added fingerprint isn't automatically
// blocked from this feature the way some other apps' equivalent behaves. Not fixable without
// forking the plugin; flagged, not solved.

import { NativeBiometric } from '@capgo/capacitor-native-biometric';

// Keystore entry names. Saved fingerprint enrolment is per install, so the rename to Arkly (Decision 273) starts clean.
const SERVER_APP = 'arkly.app-password';
const SERVER_VAULT = 'arkly.vault-pin';

// The system fingerprint screen is its own Activity, so showing it pauses this one and the app reports "went to background".
// The app's lock-on-background must ignore that pause: it would lock the app, or the Vault, right after a successful unlock.
// The pause event can also reach the page late, after the prompt has closed, hence the short grace period (Decision 210).
let promptsOpen = 0;
let quietUntil = 0;
const PROMPT_GRACE_MS = 1500;
const biometricPromptBusy = () => promptsOpen > 0 || Date.now() < quietUntil;
async function withPrompt(fn) {
  promptsOpen++;
  try { return await fn(); } finally { promptsOpen--; quietUntil = Date.now() + PROMPT_GRACE_MS; }
}

function serverFor(kind) {
  if (kind !== 'app' && kind !== 'vault') throw new Error(`biometric: unknown kind "${kind}"`);
  return kind === 'app' ? SERVER_APP : SERVER_VAULT;
}

async function isBiometricAvailable() {
  try {
    const result = await NativeBiometric.isAvailable();
    return result?.isAvailable === true;
  } catch {
    return false; // web/dev build, or plugin unavailable — never block manual entry over this
  }
}

// Stores `secret` (the real password or PIN, plaintext) behind a fresh biometric prompt shown
// right here, so enabling the feature itself proves the sensor actually works on this device.
// Caller must have already verified `secret` is correct — this module never validates
// credentials itself, only stores/retrieves whatever it's given.
async function enableBiometric(kind, secret) {
  const server = serverFor(kind);
  await withPrompt(async () => {
    await NativeBiometric.verifyIdentity({
      title: 'Confirm biometric unlock',
      description: kind === 'app' ? 'Use this to unlock Arkly' : 'Use this to unlock your Vault',
    });
    await NativeBiometric.setCredentials({ username: kind, password: secret, server });
  });
}

// The plugin's deleteCredentials clears every saved credential, not only the one named: turning the app fingerprint off or
// on wiped the Vault's, and the reverse (Decision 217). It is never called. The copy is overwritten with an unusable marker
// instead, and the setting in the database is what says whether the fingerprint is on.
const OFF_MARKER = 'off';
async function disableBiometric(kind) {
  const server = serverFor(kind);
  try {
    await NativeBiometric.setCredentials({ username: OFF_MARKER, password: OFF_MARKER, server });
  } catch {
    // Nothing stored or the store is unavailable — disabling an already-disabled lock is a no-op, not an error.
  }
}

// Never throws, so callers can always fall back to manual entry without their own try/catch. Resolves
//   { secret }                   the stored value, after the fingerprint was accepted
//   { reason: 'declined' }       cancelled, not recognised, locked out or not enrolled: nothing is wrong with the stored copy
//   { reason: 'unreadable' }     the fingerprint was accepted but the stored copy could not be read: it is gone or broken and
//                                the caller clears the setting, so the button never offers a fingerprint that cannot work
async function unlockWithBiometricEx(kind, retryMs = 600) {
  const server = serverFor(kind);
  return withPrompt(async () => {
    try {
      await NativeBiometric.verifyIdentity({ title: kind === 'app' ? 'Unlock Arkly' : 'Unlock Vault' });
    } catch {
      return { reason: 'declined' };
    }
    for (let attempt = 0; attempt < 2; attempt++) { // one retry: the key can be unavailable for a moment after the screen comes on
      try {
        const { password } = await NativeBiometric.getCredentials({ server });
        return password && password !== OFF_MARKER ? { secret: password } : { reason: 'unreadable' };
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, retryMs));
      }
    }
    return { reason: 'unreadable' };
  });
}
async function unlockWithBiometric(kind) {
  return (await unlockWithBiometricEx(kind)).secret ?? null;
}

// One attempt at a time (Decision 215): a caller that arrives while one runs gets that attempt's result, and `idle()` is false
// until `cooldownMs` after it ends, so a resume or a re-render cannot start a prompt of its own over the one that just closed.
function singleFlight(run, onError, cooldownMs = 2000) {
  let flight = null, quietUntil = 0;
  return {
    start() {
      if (flight) return flight;
      flight = (async () => run())().catch(onError).finally(() => { flight = null; quietUntil = Date.now() + cooldownMs; });
      return flight;
    },
    idle: () => !flight && Date.now() >= quietUntil
  };
}

export { isBiometricAvailable, enableBiometric, disableBiometric, unlockWithBiometric, unlockWithBiometricEx, biometricPromptBusy, singleFlight };
