// update-install.js — downloads the update APK from the private repo and hands it to the system installer (Decision 164).
// A browser cannot send the token, so the download is native: Filesystem.downloadFile follows GitHub's redirect to the
// signed asset URL without the page's CORS rules. The token goes with the asset request to api.github.com only.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

const DIR = 'update';
const APK_MIME = 'application/vnd.android.package-archive';

async function purgeUpdateDownload() {
  try { await Filesystem.rmdir({ path: DIR, directory: Directory.Cache, recursive: true }); }
  catch { /* nothing to remove */ }
}

// assetUrl: the asset's API url from checkForUpdate. Throws an Error with a plain message.
async function downloadAndInstallUpdate({ assetUrl, token }) {
  if (!token) throw new Error('Add a GitHub access token first.');
  await purgeUpdateDownload();
  const path = `${DIR}/dumpzone-update.apk`;
  try {
    await Filesystem.downloadFile({
      url: assetUrl, path, directory: Directory.Cache, recursive: true,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' }
    });
  } catch (err) {
    throw new Error(`Download failed: ${err?.message || err}`);
  }
  try {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await FileOpener.open({ filePath: uri, contentType: APK_MIME, openWithDefault: true });
  } catch (err) {
    throw new Error(`Could not open the installer: ${err?.message || err}`);
  }
}

export { downloadAndInstallUpdate, purgeUpdateDownload };
