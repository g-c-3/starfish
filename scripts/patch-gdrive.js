#!/usr/bin/env node
// Turns Google Drive on for this build (Decision 272). Runs before the web build and before "cap sync".
//
// GDRIVE_WEB_CLIENT_ID (a repository variable, not a secret: a client ID is embedded in the APK) holds the OAuth *Web application*
// client ID. The sign-in plugin passes it to Google Sign-In's ID-token request, which needs the Web client, not the Android one.
// Set: the GoogleAuth block is written into capacitor.config.json in this workspace only (never committed) and
// ARKLY_GDRIVE_CONFIGURED=true is exported so the web build switches the guard in gdrive.js on.
// Not set: nothing changes and Drive stays off, because the plugin crashes the whole app if signIn() runs with no client ID.
const fs = require('fs');
const path = require('path');

const CONFIG = path.join(__dirname, '..', 'capacitor.config.json');
const id = (process.env.GDRIVE_WEB_CLIENT_ID || '').trim();

if (!id) {
  console.log('patch-gdrive.js: GDRIVE_WEB_CLIENT_ID is not set. Google Drive stays off in this build.');
  process.exit(0);
}
if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) {
  console.error('::error::GDRIVE_WEB_CLIENT_ID is not a client ID (expected <digits>-<letters>.apps.googleusercontent.com). Fix the repository variable, or delete it to keep Drive off.');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
cfg.plugins = cfg.plugins || {};
cfg.plugins.GoogleAuth = {
  scopes: ['https://www.googleapis.com/auth/drive.file'], // the only scope; the app sees only files it created (Decision 26)
  grantOfflineAccess: false, // no refresh token of our own (Decision 30)
  androidClientId: id
};
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, 'ARKLY_GDRIVE_CONFIGURED=true\n');
console.log('patch-gdrive.js: Google Drive is on in this build.');
