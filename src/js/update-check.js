// update-check.js — manual check against GitHub Releases, run only when the person taps "Check
// for updates" in Settings (Decision 72). No background/daily check: the once-a-day gate and its
// on/off setting from Decision 71 are gone — a check now happens only on that explicit tap, so
// there's nothing left to gate.
//
// Same network call it always was: a GET to GitHub's public REST API for one public repo's recent
// releases. No auth, no account, no personal data sent beyond what any HTTP request exposes
// (IP/User-Agent) — now only when tapped, never on app open.

const REPO = 'g-c-3/starfish';
const FETCH_TIMEOUT_MS = 5000;

// build-android.yml tags every release "v<package.json version>+<CI run number>" and
// scripts/patch-version.js stamps the same "+<run number>" suffix onto the installed app's own
// version string. The run number is a strictly increasing integer, so comparing it directly is
// exact and skips semver parsing entirely — a higher run number is a newer build, full stop.
function extractRunNumber(versionOrTag) {
  const match = /\+(\d+)$/.exec(versionOrTag || '');
  return match ? parseInt(match[1], 10) : null;
}

// Returns one of:
//   { status: 'up_to_date', version }
//   { status: 'update_available', version, url, downloadUrl }
//   { status: 'error', reason }  — 'offline' | 'network_error' | 'http_<code>' | 'unparseable_version'
//
// downloadUrl is the release's .apk asset link directly (Decision 75) — build-android.yml's
// "Create GitHub Release" step attaches exactly one file, the signed APK, so this is a straight
// lookup, not a guess. Falls back to the release page itself only if no .apk asset is found (would
// mean that CI step changed shape without this being updated to match).
async function checkForUpdate({ currentVersion, fetchImpl = fetch } = {}) {
  if (!navigator.onLine) return { status: 'error', reason: 'offline' };

  // Not /releases/latest (Decision 80): that endpoint ranks by commit date and is cached for 60s,
  // so builds pushed minutes apart can report an older one. The list is scanned for the highest
  // run number instead. The timestamp param and no-store keep a cached copy from being served.
  let release;
  try {
    const res = await Promise.race([
      fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=15&_=${Date.now()}`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store'
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS))
    ]);
    if (!res.ok) return { status: 'error', reason: `http_${res.status}` };
    const releases = await res.json();
    release = (Array.isArray(releases) ? releases : [])
      .filter((r) => !r.draft && !r.prerelease && extractRunNumber(r.tag_name) != null)
      .sort((a, b) => extractRunNumber(b.tag_name) - extractRunNumber(a.tag_name))[0];
  } catch (e) {
    return { status: 'error', reason: 'network_error' };
  }
  if (!release) return { status: 'error', reason: 'unparseable_version' };

  const latestRun = extractRunNumber(release.tag_name);
  const currentRun = extractRunNumber(currentVersion);
  if (latestRun == null || currentRun == null) {
    return { status: 'error', reason: 'unparseable_version' };
  }
  if (latestRun <= currentRun) {
    return { status: 'up_to_date', version: currentVersion };
  }
  const apkAsset = (release.assets || []).find((a) => a.name && a.name.endsWith('.apk'));
  return {
    status: 'update_available',
    version: release.tag_name,
    url: release.html_url,
    downloadUrl: apkAsset ? apkAsset.browser_download_url : release.html_url
  };
}

export { checkForUpdate };
