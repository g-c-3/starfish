package __PACKAGE__;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

// Reminder sound (patch-reminder-sound.js, Decision 359). The chosen sound lives in app-private preferences so it is
// readable when a reminder fires with the app closed. Modes:
//   default       the plain banner channel made by notifications.js (Decision 96); this class stays out of the way.
//   notification  a channel whose sound is the chosen phone notification sound; Android plays it once.
//   alarm, file   a silent channel plus ArklyReminderSoundService, which plays the phone alarm sound or the saved audio file,
//                 looping for at most a minute, optionally rising from silent. Done, Snooze and a swipe-away stop it.
// Nothing here reads the network or any content of the app's data.
public final class ArklyReminderSound {
    static final String PREFS = "arkly_reminder_sound";
    static final String DEFAULT_CHANNEL = "arkly_reminders_v2"; // same id as notifications.js
    static final String SILENT_CHANNEL = "arkly_rem_silent_v1";
    static final String TONE_PREFIX = "arkly_rem_t_";
    static final String OWN_PREFIX = "arkly_rem_";
    static final String PLAYING_CHANNEL = "arkly_rem_playing_v1"; // the service's own notice; never removed here
    private static Ringtone fallback;

    private ArklyReminderSound() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String mode(Context c) {
        return prefs(c).getString("mode", "default");
    }

    public static void save(Context c, String mode, String uri, String title, boolean rise) {
        prefs(c).edit().putString("mode", mode).putString("uri", uri == null ? "" : uri)
            .putString("title", title == null ? "" : title).putBoolean("rise", rise).apply();
    }

    public static String channelId(Context c) {
        String mode = mode(c);
        if ("alarm".equals(mode) || "file".equals(mode)) return SILENT_CHANNEL;
        if ("notification".equals(mode)) return TONE_PREFIX + Integer.toHexString(prefs(c).getString("uri", "").hashCode());
        return DEFAULT_CHANNEL;
    }

    // Creates the channel for the saved choice and removes the other Arkly sound channels. Notifications already
    // scheduled on a removed channel are dropped by Android, so the app schedules every reminder again afterwards.
    public static String applyChannel(Context c) {
        String id = channelId(c);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return id;
        if (!DEFAULT_CHANNEL.equals(id)) {
            NotificationChannel ch = new NotificationChannel(id, "Reminders", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Arkly reminder alerts");
            ch.setLockscreenVisibility(1); // show full content, as notifications.js does
            if (id.startsWith(TONE_PREFIX)) {
                AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
                ch.setSound(Uri.parse(prefs(c).getString("uri", "")), aa);
            } else {
                ch.setSound(null, null); // the service plays the sound
            }
            nm.createNotificationChannel(ch);
        }
        List<String> drop = new ArrayList<>();
        for (NotificationChannel ch : nm.getNotificationChannels()) {
            String n = ch.getId();
            if (n.startsWith(OWN_PREFIX) && !n.equals(id) && !n.equals(PLAYING_CHANNEL)) drop.add(n);
        }
        for (String n : drop) nm.deleteNotificationChannel(n);
        return id;
    }

    public static File savedFile(Context c) {
        String path = prefs(c).getString("file", "");
        File f = path.isEmpty() ? null : new File(path);
        return f != null && f.isFile() ? f : null;
    }

    public static void rememberFile(Context c, String path, String title) {
        prefs(c).edit().putString("file", path == null ? "" : path).putString("file_title", title == null ? "" : title).apply();
    }

    // Called by the patched TimedNotificationPublisher right after a reminder notification is posted.
    public static void onFire(Context c, int notificationId) {
        String mode = mode(c);
        boolean isFile = "file".equals(mode);
        if (!isFile && !"alarm".equals(mode)) return;
        SharedPreferences p = prefs(c);
        String src = isFile ? (savedFile(c) == null ? "" : savedFile(c).getAbsolutePath()) : p.getString("uri", "");
        if (src.isEmpty()) return;
        boolean rise = p.getBoolean("rise", false);
        try {
            Intent i = new Intent(c, ArklyReminderSoundService.class).setAction(ArklyReminderSoundService.ACTION_PLAY)
                .putExtra("kind", isFile ? "file" : "uri").putExtra("src", src).putExtra("rise", rise);
            ContextCompat.startForegroundService(c, i);
        } catch (Throwable t) {
            // The service could not start (background limits): the phone's own ringtone player, once, at full volume.
            try {
                stopFallback();
                fallback = RingtoneManager.getRingtone(c, isFile ? Uri.fromFile(new File(src)) : Uri.parse(src));
                if (fallback != null) fallback.play();
            } catch (Throwable ignored) { /* no sound; the banner still shows */ }
        }
    }

    private static void stopFallback() {
        try { if (fallback != null) fallback.stop(); } catch (Throwable ignored) { /* already stopped */ }
        fallback = null;
    }

    // Done, Snooze, a swipe-away or the Stop button end the sound.
    public static void stop(Context c) {
        stopFallback();
        try { c.stopService(new Intent(c, ArklyReminderSoundService.class)); } catch (Throwable ignored) { /* not running */ }
    }
}
