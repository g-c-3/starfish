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

const SERVER_APP = 'dumpzone.app-password';
const SERVER_VAULT = 'dumpzone.vault-pin';

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
  await NativeBiometric.verifyIdentity({
    title: 'Confirm biometric unlock',
    description: kind === 'app' ? 'Use this to unlock Dumpzone' : 'Use this to unlock your Vault',
  });
  await NativeBiometric.setCredentials({ username: kind, password: secret, server });
}

async function disableBiometric(kind) {
  const server = serverFor(kind);
  try {
    await NativeBiometric.deleteCredentials({ server });
  } catch {
    // Nothing was stored — disabling an already-disabled lock is a no-op, not an error.
  }
}

// Resolves with the stored secret on success, null on cancel/failure/not-enrolled — never
// throws, so callers can always fall back to manual entry without their own try/catch.
async function unlockWithBiometric(kind) {
  const server = serverFor(kind);
  try {
    await NativeBiometric.verifyIdentity({
      title: kind === 'app' ? 'Unlock Dumpzone' : 'Unlock Vault',
    });
    const { password } = await NativeBiometric.getCredentials({ server });
    return password;
  } catch {
    return null;
  }
}

export { isBiometricAvailable, enableBiometric, disableBiometric, unlockWithBiometric };
