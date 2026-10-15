// update-install.js — downloads the update APK from the public repo's release and hands it to the system installer (Decisions 164, 214).
// The download is native: Filesystem.downloadFile follows GitHub's redirect to the asset without the page's CORS rules.
// No token and no header: the release is public.

import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

const DIR = 'update';
const APK_MIME = 'application/vnd.android.package-archive';

async function purgeUpdateDownload() {
  try { await Filesystem.rmdir({ path: DIR, directory: Directory.Cache, recursive: true }); }
  catch { /* nothing to remove */ }
}

// assetUrl: the asset's browser_download_url from checkForUpdate. Throws an Error with a plain message.
async function downloadAndInstallUpdate({ assetUrl }) {
  await purgeUpdateDownload();
  const path = `${DIR}/arkly-update.apk`;
  // downloadFile opens the target directly and ignores `recursive` (plugin 6.0.4), so the folder must exist first.
  try { await Filesystem.mkdir({ path: DIR, directory: Directory.Cache, recursive: true }); }
  catch { /* already there */ }
  try {
    await Filesystem.downloadFile({
      url: assetUrl, path, directory: Directory.Cache
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
