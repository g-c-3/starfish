#!/usr/bin/env node
// Adds the File explorer's native bridge (Decisions 206, 207): "All files access" check and request, and the list of mounted
// storage volumes (internal, SD card, USB drive). Exposed to the page as window.ArklyExplorer through a WebView JavaScript
// interface, the same no-plugin route as patch-screenlock.js: android/ is never committed, so CI writes the Java here.
//
// Writes ArklyExplorerBridge.java next to MainActivity.java and registers it in MainActivity.onCreate(). Runs after
// patch-screenlock.js, which guarantees an onCreate() exists. Idempotent: the bridge file is rewritten, the registration
// line is added once.
const fs = require('fs');
const path = require('path');

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const f = findMainActivity(full); if (f) return f; }
    else if (entry.name === 'MainActivity.java') return full;
  }
  return null;
}

const JAVA_ROOT = process.env.PATCH_JAVA_ROOT || path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java');
if (!fs.existsSync(JAVA_ROOT)) { console.error(`patch-explorer.js: ${JAVA_ROOT} not found — did "cap add android" run first?`); process.exit(1); }
const mainPath = findMainActivity(JAVA_ROOT);
if (!mainPath) { console.error('patch-explorer.js: no MainActivity.java found — aborting.'); process.exit(1); }

let main = fs.readFileSync(mainPath, 'utf8');
const pkg = (main.match(/^package\s+([^;]+);/m) || [])[1];
if (!pkg) { console.error('patch-explorer.js: no package line in MainActivity.java — aborting.'); process.exit(1); }

const BRIDGE = `package ${pkg};

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONObject;

// File explorer bridge (patch-explorer.js). Reachable from the app's own page only, as window.ArklyExplorer.
public class ArklyExplorerBridge {
    private static final String READ = "android.permission.READ_EXTERNAL_STORAGE";
    private static final String WRITE = "android.permission.WRITE_EXTERNAL_STORAGE";
    private final Activity activity;

    public ArklyExplorerBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean hasAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(activity, READ) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(activity, WRITE) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestAllFilesAccess() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 30) {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:" + activity.getPackageName()));
                        activity.startActivity(intent);
                    } else {
                        ActivityCompat.requestPermissions(activity, new String[] { READ, WRITE }, 7101);
                    }
                } catch (Exception e) {
                    try {
                        if (Build.VERSION.SDK_INT >= 30) {
                            activity.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                        }
                    } catch (Exception ignored) {
                        // no settings screen to show; the page keeps its Allow button
                    }
                }
            }
        });
    }

    // JSON array of mounted volumes: path, name, primary, removable, usb, total, free.
    @JavascriptInterface
    public String volumes() {
        JSONArray out = new JSONArray();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                StorageManager sm = (StorageManager) activity.getSystemService(Context.STORAGE_SERVICE);
                for (StorageVolume v : sm.getStorageVolumes()) {
                    String state = v.getState();
                    if (!Environment.MEDIA_MOUNTED.equals(state) && !Environment.MEDIA_MOUNTED_READ_ONLY.equals(state)) {
                        continue;
                    }
                    File dir = v.getDirectory();
                    if (dir == null) {
                        continue;
                    }
                    out.put(volumeJson(dir, v.getDescription(activity), v.isPrimary(), v.isRemovable()));
                }
            } else {
                File[] dirs = activity.getExternalFilesDirs(null);
                for (int i = 0; i < dirs.length; i++) {
                    File d = dirs[i];
                    if (d == null) {
                        continue;
                    }
                    String p = d.getAbsolutePath();
                    int k = p.indexOf("/Android/data");
                    if (k <= 0) {
                        continue;
                    }
                    out.put(volumeJson(new File(p.substring(0, k)), i == 0 ? "Internal storage" : "SD card or USB drive", i == 0, i != 0));
                }
            }
        } catch (Exception ignored) {
            // an empty list: the page shows "No storage was found"
        }
        return out.toString();
    }

    private JSONObject volumeJson(File dir, String description, boolean primary, boolean removable) throws Exception {
        JSONObject o = new JSONObject();
        String lower = description == null ? "" : description.toLowerCase();
        o.put("path", dir.getAbsolutePath());
        o.put("name", primary ? "Internal storage" : (description == null || description.isEmpty() ? "Storage" : description));
        o.put("primary", primary);
        o.put("removable", removable);
        o.put("usb", removable && lower.contains("usb"));
        try {
            StatFs fs = new StatFs(dir.getAbsolutePath());
            o.put("total", fs.getTotalBytes());
            o.put("free", fs.getAvailableBytes());
        } catch (Exception e) {
            o.put("total", 0);
            o.put("free", 0);
        }
        return o;
    }
}
`;

const bridgePath = path.join(path.dirname(mainPath), 'ArklyExplorerBridge.java');
fs.writeFileSync(bridgePath, BRIDGE, 'utf8');

if (main.includes('ArklyExplorer')) {
  console.log('patch-explorer.js: bridge rewritten; MainActivity already registers it.');
  process.exit(0);
}
const LINE = '        getBridge().getWebView().addJavascriptInterface(new ArklyExplorerBridge(this), "ArklyExplorer");\n';
const re = /(public void onCreate\(Bundle savedInstanceState\)\s*\{\s*\n\s*super\.onCreate\(savedInstanceState\);\n)/;
if (!re.test(main)) { console.error('patch-explorer.js: MainActivity.onCreate() not found — run patch-screenlock.js first. Aborting.'); process.exit(1); }
main = main.replace(re, `$1${LINE}`);
if (!main.includes('ArklyExplorer')) { console.error('patch-explorer.js: registration did not apply — aborting.'); process.exit(1); }
fs.writeFileSync(mainPath, main, 'utf8');
console.log(`patch-explorer.js: wrote ${bridgePath} and registered it in ${mainPath}`);
