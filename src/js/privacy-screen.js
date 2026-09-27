// privacy-screen.js — optional, user-toggled "hide app content in Recents & block screenshots".
// Off by default (Decision 64), stored the same way as every other on/off setting (metaGet/metaSet
// in app.js, key "privacy_screen_enabled"), applied once at bootstrap and again immediately whenever
// the Settings toggle changes.
//
// Replaces Decision 62/63's approach entirely: that version hand-patched a native MainActivity.java
// via a CI script (scripts/patch-mainactivity.js), which only ever set FLAG_SECURE once at process
// start — no way for the person to turn it off without a rebuild, which is exactly what got in the
// way during development (Decision 63). @capacitor-community/privacy-screen exposes the same native
// FLAG_SECURE toggle as real enable()/disable() calls the JS layer can flip at any time, so this
// is a genuine runtime setting instead of a build-time one. Verified by downloading the actual
// 5.2.0 tarball and reading its shipped Android source (not just its README) before adopting it:
// PrivacyScreen.java's enable()/disable() do exactly `window.addFlags`/`clearFlags(FLAG_SECURE)`
// on the current Activity, nothing more. Pinned to 5.2.0 specifically — its peerDependencies is
// `@capacitor/core ^6.0.0`, the only version line of this plugin that matches this project's
// Capacitor 6; the maintained-going-forward major versions (6.x, 8.x) require Capacitor 7/8.
//
// capacitor.config.json sets this plugin's own "enable" startup config to false, so native startup
// itself never turns it on — app.js's bootstrap is what applies the stored preference, right after
// unlock succeeds. That leaves one known gap, stated plainly rather than glossed over: on a cold
// launch there are one or two frames between the WebView first painting and this module's first
// enable() call resolving, during which the setting (if on) isn't in effect yet. Not fixable
// without native code reading a persisted native-side flag before onCreate() finishes — out of
// scope for what's otherwise a plain web-layer setting toggle.
import { PrivacyScreen } from '@capacitor-community/privacy-screen';

export async function setPrivacyScreen(enabled) {
  try {
    await (enabled ? PrivacyScreen.enable() : PrivacyScreen.disable());
  } catch (e) {
    // Expected in a browser preview — the plugin's web stub throws "unimplemented" for both
    // methods rather than silently no-op'ing (there's no equivalent behavior to fake on the web).
    // Also the only path taken if cap sync hasn't run yet on native. Never worth blocking the rest
    // of bootstrap over either way.
    console.warn('privacy-screen: enable/disable not available here', e);
  }
}
