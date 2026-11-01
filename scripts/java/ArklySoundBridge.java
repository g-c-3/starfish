package __PACKAGE__;

import android.content.Context;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;

// Reminder sound settings for the app's own page only, as window.ArklySound (patch-reminder-sound.js, Decision 359).
// Lists the phone's notification and alarm sounds, keeps one audio file the owner picked inside the app's private folder,
// and saves the choice natively so it is there when a reminder fires with the app closed. No network, no extra permission.
public class ArklySoundBridge {
    private static final int MAX_FILE_BYTES = 12 * 1024 * 1024;
    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer preview;

    public ArklySoundBridge(Context ctx) {
        this.ctx = ctx;
    }

    // [{t: title, u: uri}] for "notification" or "alarm"; the phone's default first.
    @JavascriptInterface
    public String listSounds(String kind) {
        JSONArray out = new JSONArray();
        try {
            int type = "alarm".equals(kind) ? RingtoneManager.TYPE_ALARM : RingtoneManager.TYPE_NOTIFICATION;
            out.put(new JSONObject().put("t", "Phone default").put("u", RingtoneManager.getDefaultUri(type).toString()));
            RingtoneManager rm = new RingtoneManager(ctx);
            rm.setType(type);
            Cursor c = rm.getCursor();
            while (c != null && c.moveToNext()) {
                out.put(new JSONObject().put("t", c.getString(RingtoneManager.TITLE_COLUMN_INDEX)).put("u", rm.getRingtoneUri(c.getPosition()).toString()));
            }
        } catch (Throwable ignored) { /* the list stays as far as it got */ }
        return out.toString();
    }

    // {mode, uri, title, rise, fileTitle, hasFile}
    @JavascriptInterface
    public String getConfig() {
        try {
            android.content.SharedPreferences p = ctx.getSharedPreferences(ArklyReminderSound.PREFS, Context.MODE_PRIVATE);
            return new JSONObject().put("mode", p.getString("mode", "default")).put("uri", p.getString("uri", ""))
                .put("title", p.getString("title", "")).put("rise", p.getBoolean("rise", false))
                .put("fileTitle", p.getString("file_title", "")).put("hasFile", ArklyReminderSound.savedFile(ctx) != null).toString();
        } catch (Throwable t) {
            return "{\"mode\":\"default\"}";
        }
    }

    // Saves the choice and makes its channel. Returns the channel id the app schedules reminders on, or "" on a refused choice.
    @JavascriptInterface
    public String setConfig(String mode, String uri, String title, boolean rise) {
        try {
            if (!("default".equals(mode) || "notification".equals(mode) || "alarm".equals(mode) || "file".equals(mode))) return "";
            if (("notification".equals(mode) || "alarm".equals(mode)) && (uri == null || uri.isEmpty())) return "";
            if ("file".equals(mode) && ArklyReminderSound.savedFile(ctx) == null) return "";
            ArklyReminderSound.save(ctx, mode, uri, title, rise);
            return ArklyReminderSound.applyChannel(ctx);
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public String channelId() {
        return ArklyReminderSound.channelId(ctx);
    }

    // Keeps one picked audio file (base64 from the page). Returns its name as stored, or "" when too large or unwritable.
    @JavascriptInterface
    public String saveFile(String name, String base64) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            if (data.length == 0 || data.length > MAX_FILE_BYTES) return "";
            String ext = "audio";
            int dot = name == null ? -1 : name.lastIndexOf('.');
            if (dot >= 0 && name.length() - dot - 1 <= 5 && name.substring(dot + 1).matches("[A-Za-z0-9]+")) ext = name.substring(dot + 1).toLowerCase();
            File dir = ctx.getFilesDir();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (f.getName().startsWith("reminder_sound.")) f.delete();
            File out = new File(dir, "reminder_sound." + ext);
            try (FileOutputStream os = new FileOutputStream(out)) { os.write(data); }
            String shown = name == null || name.isEmpty() ? out.getName() : name;
            ArklyReminderSound.rememberFile(ctx, out.getAbsolutePath(), shown);
            return shown;
        } catch (Throwable t) {
            return "";
        }
    }

    // Plays a sound for a few seconds so the owner can hear it. kind "file" plays the saved file; otherwise `src` is a sound uri.
    @JavascriptInterface
    public synchronized boolean preview(String kind, String src, boolean alarm) {
        stopPreview();
        try {
            MediaPlayer m = new MediaPlayer();
            m.setAudioAttributes(new AudioAttributes.Builder().setUsage(alarm ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            if ("file".equals(kind)) {
                File f = ArklyReminderSound.savedFile(ctx);
                if (f == null) { m.release(); return false; }
                m.setDataSource(f.getAbsolutePath());
            } else {
                m.setDataSource(ctx, Uri.parse(src));
            }
            m.setOnPreparedListener(MediaPlayer::start);
            m.setOnCompletionListener((x) -> stopPreview());
            m.setOnErrorListener((x, w, e) -> { stopPreview(); return true; });
            m.prepareAsync();
            preview = m;
            main.postDelayed(this::stopPreview, 6000L);
            return true;
        } catch (Throwable t) {
            stopPreview();
            return false;
        }
    }

    @JavascriptInterface
    public synchronized void stopPreview() {
        if (preview == null) return;
        try { preview.stop(); } catch (Throwable ignored) { /* not started */ }
        try { preview.release(); } catch (Throwable ignored) { /* already released */ }
        preview = null;
    }

    // Ends a reminder sound that is playing (Done or Snooze tapped in the app).
    @JavascriptInterface
    public void stop() {
        ArklyReminderSound.stop(ctx);
    }
}
