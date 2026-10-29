package __PACKAGE__;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.media.MediaMetadataRetriever;
import android.os.Environment;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;
import android.webkit.JavascriptInterface;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

// Phone photos and videos for the Gallery (patch-media.js, Decision 316). Reachable from the app's own page only, as
// window.ArklyMedia. Read-only: lists the phone's media, makes small thumbnails, opens the phone's camera app and lists what
// it just took. Nothing is written or deleted, nothing leaves the device. Needs the All files access the File explorer
// already asks for (Decision 207); the page checks it through window.ArklyExplorer before calling here.
public class ArklyMediaBridge {
    private static final Uri FILES = MediaStore.Files.getContentUri("external");
    private static final String KINDS = "media_type IN (1,3)"; // 1 image, 3 video
    private final Activity activity;
    private long launchedAt = 0;

    public ArklyMediaBridge(Activity activity) {
        this.activity = activity;
    }

    private static String s(Cursor c, String col) {
        int i = c.getColumnIndex(col);
        return i < 0 || c.isNull(i) ? "" : c.getString(i);
    }

    private static long n(Cursor c, String col) {
        int i = c.getColumnIndex(col);
        return i < 0 || c.isNull(i) ? 0L : c.getLong(i);
    }

    private static final String[] COLS = { "_id", "_display_name", "_data", "mime_type", "_size", "date_added", "datetaken", "duration", "media_type" };

    private static JSONObject row(Cursor c) throws Exception {
        JSONObject o = new JSONObject();
        long added = n(c, "date_added") * 1000L;
        long taken = n(c, "datetaken");
        o.put("id", n(c, "_id"));
        o.put("name", s(c, "_display_name"));
        o.put("path", s(c, "_data"));
        o.put("mime", s(c, "mime_type"));
        o.put("size", n(c, "_size"));
        o.put("taken", taken > 0 ? taken : added);
        o.put("dur", n(c, "duration"));
        o.put("video", n(c, "media_type") == 3);
        return o;
    }

    // {"total":n,"items":[{id,name,path,mime,size,taken,dur,video}]} newest first; bucketId "" = every album.
    @JavascriptInterface
    public String list(String bucketId, int offset, int limit) {
        JSONObject out = new JSONObject();
        try {
            String sel = KINDS;
            String[] args = null;
            if (bucketId != null && !bucketId.isEmpty()) {
                sel += " AND bucket_id=?";
                args = new String[] { bucketId };
            }
            ContentResolver cr = activity.getContentResolver();
            int total = 0;
            Cursor cc = cr.query(FILES, new String[] { "_id" }, sel, args, null);
            if (cc != null) { total = cc.getCount(); cc.close(); }
            Cursor c;
            if (Build.VERSION.SDK_INT >= 30) {
                Bundle q = new Bundle();
                q.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel);
                if (args != null) q.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
                q.putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS, new String[] { "datetaken", "date_added", "_id" });
                q.putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION, ContentResolver.QUERY_SORT_DIRECTION_DESCENDING);
                q.putInt(ContentResolver.QUERY_ARG_LIMIT, limit);
                q.putInt(ContentResolver.QUERY_ARG_OFFSET, offset);
                c = cr.query(FILES, COLS, q, null);
            } else {
                c = cr.query(FILES, COLS, sel, args, "datetaken DESC, date_added DESC, _id DESC LIMIT " + limit + " OFFSET " + offset);
            }
            JSONArray items = new JSONArray();
            if (c != null) {
                while (c.moveToNext()) items.put(row(c));
                c.close();
            }
            out.put("total", total);
            out.put("items", items);
        } catch (Exception e) {
            try { out.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return out.toString();
    }

    // [{id,name,count}] one entry per album (folder) that holds a photo or video.
    @JavascriptInterface
    public String albums() {
        JSONArray out = new JSONArray();
        try {
            Map<String, Object[]> map = new LinkedHashMap<String, Object[]>();
            Cursor c = activity.getContentResolver().query(FILES, new String[] { "bucket_id", "bucket_display_name" }, KINDS, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String id = s(c, "bucket_id");
                    if (id.isEmpty()) continue;
                    Object[] e = map.get(id);
                    if (e == null) { e = new Object[] { s(c, "bucket_display_name"), 0 }; map.put(id, e); }
                    e[1] = (Integer) e[1] + 1;
                }
                c.close();
            }
            for (Map.Entry<String, Object[]> en : map.entrySet()) {
                JSONObject o = new JSONObject();
                o.put("id", en.getKey());
                o.put("name", en.getValue()[0]);
                o.put("count", en.getValue()[1]);
                out.put(o);
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    // A small JPEG as a data: URL, or "" when none can be made.
    @JavascriptInterface
    public String thumb(long id, boolean video, int px) {
        try {
            Uri table = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            ContentResolver cr = activity.getContentResolver();
            Bitmap b;
            if (Build.VERSION.SDK_INT >= 29) {
                b = cr.loadThumbnail(ContentUris.withAppendedId(table, id), new Size(px, px), null);
            } else if (video) {
                b = MediaStore.Video.Thumbnails.getThumbnail(cr, id, MediaStore.Video.Thumbnails.MINI_KIND, null);
            } else {
                b = MediaStore.Images.Thumbnails.getThumbnail(cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null);
            }
            if (b == null) return "";
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.JPEG, 72, bos);
            return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    // Opens the phone's own camera app (every mode and setting it has). true when one started.
    @JavascriptInterface
    public boolean openCamera() {
        launchedAt = System.currentTimeMillis() / 1000L - 2L;
        final boolean[] ok = { false };
        final CountDownLatch done = new CountDownLatch(1);
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String[] actions = { MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA, MediaStore.INTENT_ACTION_VIDEO_CAMERA, MediaStore.ACTION_IMAGE_CAPTURE };
                for (String a : actions) {
                    try {
                        activity.startActivity(new Intent(a));
                        ok[0] = true;
                        break;
                    } catch (Exception ignored) { }
                }
                done.countDown();
            }
        });
        try { done.await(3, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        return ok[0];
    }

    // Epoch seconds the camera was opened (minus a little clock slack).
    @JavascriptInterface
    public long launchedAt() {
        return launchedAt;
    }

    // Photos and videos added to a DCIM folder since the given epoch second, oldest first (same shape as list items).
    @JavascriptInterface
    public String since(long sinceSec) {
        JSONArray out = new JSONArray();
        try {
            Cursor c = activity.getContentResolver().query(FILES, COLS,
                    KINDS + " AND date_added>=? AND _data LIKE '%/DCIM/%'", new String[] { String.valueOf(sinceSec) }, "date_added ASC, _id ASC");
            if (c != null) {
                while (c.moveToNext()) out.put(row(c));
                c.close();
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    // ---- Reading the DCIM folder directly (Decision 320). The media index can list a new camera file seconds after it was
    // written; the folder itself is always current. Skips hidden and half-written files (names starting with a dot, files
    // changed in the last 1.5 s). id is the path, so the page can tell what it has already saved.
    private static final String[] IMG_EXT = { "jpg", "jpeg", "png", "heic", "heif", "webp", "dng", "gif", "avif" };
    private static final String[] VID_EXT = { "mp4", "mov", "3gp", "mkv", "webm", "m4v" };

    private static String extOf(String name) {
        int i = name.lastIndexOf('.');
        return i < 0 ? "" : name.substring(i + 1).toLowerCase();
    }

    private static boolean in(String[] list, String v) {
        for (String s : list) if (s.equals(v)) return true;
        return false;
    }

    private static void walk(File dir, int depth, long sinceMs, long nowMs, ArrayList<File> out) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File f : kids) {
            String name = f.getName();
            if (name.startsWith(".")) continue;
            if (f.isDirectory()) {
                if (depth < 4) walk(f, depth + 1, sinceMs, nowMs, out);
                continue;
            }
            String e = extOf(name);
            if (!in(IMG_EXT, e) && !in(VID_EXT, e)) continue;
            long m = f.lastModified();
            if (m >= sinceMs && nowMs - m >= 1500 && f.length() > 0) out.add(f);
        }
    }

    // Same shape as since(); id is the file path (a string).
    @JavascriptInterface
    public String sinceFs(long sinceSec) {
        JSONArray out = new JSONArray();
        try {
            ArrayList<File> hits = new ArrayList<File>();
            walk(new File(Environment.getExternalStorageDirectory(), "DCIM"), 0, sinceSec * 1000L, System.currentTimeMillis(), hits);
            Collections.sort(hits, new Comparator<File>() {
                @Override
                public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); }
            });
            for (File f : hits) {
                String e = extOf(f.getName());
                boolean video = in(VID_EXT, e);
                JSONObject o = new JSONObject();
                o.put("id", f.getAbsolutePath());
                o.put("name", f.getName());
                o.put("path", f.getAbsolutePath());
                o.put("mime", (video ? "video/" : "image/") + (e.equals("jpg") ? "jpeg" : e.equals("mov") ? "quicktime" : e));
                o.put("size", f.length());
                o.put("taken", f.lastModified());
                o.put("dur", 0);
                o.put("video", video);
                out.put(o);
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    private String thumbError = "";

    @JavascriptInterface
    public String thumbError() {
        return thumbError;
    }

    private static Bitmap fit(Bitmap b, int px) {
        int w = b.getWidth(), h = b.getHeight();
        float k = Math.min(1f, (float) px / Math.max(w, h));
        if (k >= 1f) return b;
        return Bitmap.createScaledBitmap(b, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true);
    }

    private static String jpegUrl(Bitmap b) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 72, bos);
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    }

    // A small JPEG data URL made from a file path: a video frame (any codec the phone can play, no WebView decoder involved) or a
    // photo with its rotation applied. "" when none can be made; thumbError() then says why.
    @JavascriptInterface
    public String thumbFile(String path, boolean video, int px) {
        thumbError = "";
        try {
            if (video) {
                MediaMetadataRetriever r = new MediaMetadataRetriever();
                try {
                    r.setDataSource(path);
                    long durMs = 0;
                    try { durMs = Long.parseLong(r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)); } catch (Exception ignored) { }
                    long at = durMs > 0 ? Math.min(1000000L, durMs * 250L) : 0L; // microseconds: about 1 s in, or a quarter of a short clip
                    Bitmap b = r.getFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                    if (b == null) b = r.getFrameAtTime();
                    if (b == null) { thumbError = "no video frame"; return ""; }
                    return jpegUrl(fit(b, px));
                } finally {
                    try { r.release(); } catch (Exception ignored) { }
                }
            }
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, o);
            int longest = Math.max(o.outWidth, o.outHeight);
            if (longest <= 0) { thumbError = "photo not readable"; return ""; }
            int sample = 1;
            while (longest / (sample * 2) >= px) sample *= 2;
            BitmapFactory.Options d = new BitmapFactory.Options();
            d.inSampleSize = sample;
            Bitmap b = BitmapFactory.decodeFile(path, d);
            if (b == null) { thumbError = "photo not decodable"; return ""; }
            try {
                int ori = new ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                int deg = ori == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : ori == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : ori == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
                if (deg != 0) {
                    Matrix m = new Matrix();
                    m.postRotate(deg);
                    b = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
                }
            } catch (Exception ignored) { }
            return jpegUrl(fit(b, px));
        } catch (Throwable e) {
            thumbError = String.valueOf(e.getMessage());
            return "";
        }
    }
}
