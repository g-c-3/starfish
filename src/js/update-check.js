// update-check.js — manual check against GitHub Releases, run only when the person taps "Check
// for updates" in Settings (Decision 72). No background/daily check: the once-a-day gate and its
// on/off setting from Decision 71 are gone — a check now happens only on that explicit tap, so
// there's nothing left to gate.
//
// One GET to GitHub's REST API for the private repo's recent releases (Decision 164), authenticated with the
// read-only token the owner saved in Settings. The token goes to api.github.com only, only on this tap. No
// token saved -> no request is made.

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
//   { status: 'update_available', version, downloadUrl }
//   { status: 'error', reason }  — 'no_token' | 'token_rejected' | 'offline' | 'network_error' | 'http_<code>'
//                                   | 'unparseable_version' | 'no_apk'
//
// downloadUrl is the .apk asset's API url, not browser_download_url: on a private repo the browser link needs a
// browser session, while the API url downloads with the token and Accept: application/octet-stream
// (update-install.js). build-android.yml attaches exactly one file, the signed APK.
async function checkForUpdate({ currentVersion, token, fetchImpl = fetch } = {}) {
  if (!token) return { status: 'error', reason: 'no_token' };
  if (!navigator.onLine) return { status: 'error', reason: 'offline' };

  // Not /releases/latest (Decision 80): that endpoint ranks by commit date and is cached for 60s,
  // so builds pushed minutes apart can report an older one. The list is scanned for the highest
  // run number instead. The timestamp param and no-store keep a cached copy from being served.
  let release;
  try {
    const res = await Promise.race([
      fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=15&_=${Date.now()}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
        cache: 'no-store'
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS))
    ]);
    // A private repo answers 404 to a token that cannot see it, so 404 reads as a rejected token too.
    if (res.status === 401 || res.status === 403 || res.status === 404) return { status: 'error', reason: 'token_rejected' };
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
  if (!apkAsset) return { status: 'error', reason: 'no_apk' };
  return { status: 'update_available', version: release.tag_name, downloadUrl: apkAsset.url };
}

export { checkForUpdate };
