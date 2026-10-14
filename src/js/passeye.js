// passeye.js — show/hide control on password fields (Decision 200).
// Wraps each input[type=password] once; a field marked data-no-eye is skipped (lock screen).
// Revealed text is plain DOM state: hidden again on lock, on clear, on close and when the app leaves the foreground.

const SVG_NS = 'http://www.w3.org/2000/svg';

function paintEye(input, btn) {
  const shown = input.dataset.pwShown === '1';
  btn.setAttribute('aria-label', shown ? 'Hide' : 'Show');
  btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
  btn.querySelector('use').setAttribute('href', shown ? '#i-eyeoff' : '#i-eye');
}

function setShown(input, shown) {
  const btn = input.nextElementSibling;
  if (!btn || !btn.classList.contains('pw-eye')) return;
  const hadFocus = document.activeElement === input;
  let a = null, b = null;
  try { a = input.selectionStart; b = input.selectionEnd; } catch (e) { /* not selectable */ }
  input.type = shown ? 'text' : 'password';
  input.dataset.pwShown = shown ? '1' : '0';
  paintEye(input, btn);
  if (hadFocus) {
    input.focus();
    try { if (a !== null) input.setSelectionRange(a, b); } catch (e) { /* not selectable */ }
  }
}

export function attachEye(input) {
  if (!input || input.dataset.pw || input.hasAttribute('data-no-eye')) return;
  const parent = input.parentNode;
  if (!parent) return;
  const hadFocus = document.activeElement === input;
  const wrap = document.createElement('span');
  wrap.className = 'pw-field';
  const cs = getComputedStyle(input);
  wrap.style.margin = cs.margin; // spacing moves to the wrapper so the button centres on the input
  input.style.margin = '0';
  input.dataset.pw = '1';
  input.dataset.pwShown = '0';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  svg.appendChild(document.createElementNS(SVG_NS, 'use'));
  btn.appendChild(svg);
  const keepFocus = (e) => e.preventDefault(); // the keyboard stays up and the caret stays put
  btn.addEventListener('pointerdown', keepFocus);
  btn.addEventListener('mousedown', keepFocus);
  btn.addEventListener('click', () => setShown(input, input.dataset.pwShown !== '1'));
  parent.insertBefore(wrap, input);
  wrap.appendChild(input);
  wrap.appendChild(btn);
  paintEye(input, btn);
  if (hadFocus) input.focus();
}

// Hide revealed fields. No argument: every wrapped field.
export function hidePasswords(els = null) {
  const list = els || document.querySelectorAll('input[data-pw]');
  for (const el of list) if (el && el.dataset && el.dataset.pw && el.dataset.pwShown === '1') setShown(el, false);
}

// For one shared field that is a password only some of the time (the single-field text sheet).
export function setPasswordField(input, isPassword) {
  if (!input) return;
  if (isPassword) {
    attachEye(input);
    if (input.dataset.pw) { input.parentNode.classList.remove('pw-off'); setShown(input, false); }
    input.type = 'password';
  } else {
    if (input.dataset.pw) { input.parentNode.classList.add('pw-off'); input.dataset.pwShown = '0'; }
    input.type = 'text';
  }
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches('input[type="password"]')) attachEye(root);
  root.querySelectorAll('input[type="password"]').forEach(attachEye);
}

export function initPasswordEyes() {
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hidePasswords(); });
}
