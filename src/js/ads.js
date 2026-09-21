// ads.js — daily rewarded-ad gate. Never blocks the app when no ad is available.
// Assumes an AdMob Capacitor plugin (e.g. capacitor-community/admob) is wired natively;
// this module only contains the GATE DECISION LOGIC, kept separate so it's easy to test/reason about.

const LOAD_TIMEOUT_MS = 5000;

// `adSdk` is an injected adapter so this logic has no hard dependency on a specific plugin.
// Expected shape: { loadRewarded(): Promise<boolean>, showRewarded(): Promise<void> }
async function runDailyAdGateIfDue(adSdk, metaStore) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lastShownDate = await metaStore.get('ad_last_shown_date');

  if (lastShownDate === today) {
    return { shown: false, reason: 'already-shown-today' };
  }

  if (!navigator.onLine) {
    return { shown: false, reason: 'offline' };
  }

  let loaded = false;
  try {
    loaded = await Promise.race([
      adSdk.loadRewarded(),
      new Promise((resolve) => setTimeout(() => resolve(false), LOAD_TIMEOUT_MS))
    ]);
  } catch (e) {
    loaded = false;
  }

  if (!loaded) {
    return { shown: false, reason: 'no-fill' };
  }

  // Ad loaded successfully — show it, non-skippable, must complete before caller proceeds.
  await adSdk.showRewarded();
  await metaStore.set('ad_last_shown_date', today);
  return { shown: true, reason: 'completed' };
}

export { runDailyAdGateIfDue };
