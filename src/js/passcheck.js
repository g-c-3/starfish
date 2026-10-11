// passcheck.js — advisory strength check for the three credentials (Decision 170). Pure: no storage, no DOM, nothing logged.
// It never blocks. The caller shows the message and lets the person keep the secret or change it.

const MIN = { password: 8, pin: 6, passkey: 10 };        // characters
const NAME = { password: 'password', pin: 'Vault PIN', passkey: 'backup passkey' };

// -> { title, text } when the secret is weak, null when it passes (or is empty: nothing is being set).
function weakness(kind, secret) {
  if (!MIN[kind]) return null;
  const chars = Array.from(String(secret || ''));
  if (!chars.length) return null;
  const title = `Weak ${NAME[kind]}`;
  if (chars.length < MIN[kind]) return { title, text: `${chars.length} character${chars.length === 1 ? '' : 's'}. A ${NAME[kind]} of ${MIN[kind]} or more is harder to guess.` };
  if (new Set(chars).size === 1) return { title, text: 'One character repeated is easy to guess.' };
  return null;
}

export { MIN, weakness };
