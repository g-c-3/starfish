package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.provider.Settings;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

// Reminder sound and vibration (patch-reminder-sound.js, Decisions 359, 363). Everything lives in app-private preferences so it is
// readable when a reminder fires with the app closed. A setting is { mode, uri, title, rise, vibrate }:
//   mode default       the phone's notification sound, played once by the notification channel.
//   mode notification  a chosen phone notification sound, played once by the channel.
//   mode alarm, file   a silent channel plus ArklyReminderSoundService, which plays the phone alarm sound or the saved audio file,
//                      looping for at most a minute, optionally rising from silent. Done, Snooze and a swipe-away stop it.
//   mode none          no sound; vibration only when on.
// There is one setting for all reminders and, optionally, one per reminder (keyed by the entry id). A channel is made per distinct
// setting (an Android channel's sound and vibration are fixed once created); its setting is stored beside it, so the service can
// be started from the channel a fired notification was posted on. Nothing here reads the network or any content of the app's data.
public final class ArklyReminderSound {
    static final String PREFS = "arkly_reminder_sound";
    static final String ALERTS = "arkly_reminder_alerts";
    static final String OWN_PREFIX = "arkly_rem_";
    static final String CHANNEL_PREFIX = "arkly_rem_c_";
    static final String OLD_SILENT_CHANNEL = "arkly_rem_silent_v1";
    static final String PLAYING_CHANNEL = "arkly_rem_playing_v2"; // the service's own notice; never removed here
    private static Ringtone fallback;
    private static Notification pending; // the fired reminder notification, handed to the sound service to run in the foreground
    private static int pendingId;
    private static Notification shown; // the reminder notification as posted, for the lock-screen reminder screen to read its buttons from
    private static int shownId;

    private ArklyReminderSound() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static SharedPreferences alerts(Context c) { return c.getSharedPreferences(ALERTS, Context.MODE_PRIVATE); }

    public static void save(Context c, String mode, String uri, String title, boolean rise, boolean vibrate) {
        prefs(c).edit().putString("mode", mode).putString("uri", uri == null ? "" : uri)
            .putString("title", title == null ? "" : title).putBoolean("rise", rise).putBoolean("vibrate", vibrate).apply();
    }

    public static JSONObject globalConfig(Context c) {
        SharedPreferences p = prefs(c);
        try {
            return new JSONObject().put("mode", p.getString("mode", "default")).put("uri", p.getString("uri", ""))
                .put("title", p.getString("title", "")).put("rise", p.getBoolean("rise", false)).put("vibrate", p.getBoolean("vibrate", false));
        } catch (Throwable t) { return new JSONObject(); }
    }

    // The setting of one reminder when it has its own, else null (it follows the global one).
    public static JSONObject reminderConfig(Context c, String entryId) {
        if (entryId == null || entryId.isEmpty()) return null;
        String s = alerts(c).getString(entryId, "");
        if (s.isEmpty()) return null;
        try { return new JSONObject(s); } catch (Throwable t) { return null; }
    }

    public static void saveReminderConfig(Context c, String entryId, JSONObject cfg) {
        if (cfg == null) alerts(c).edit().remove(entryId).apply(); else alerts(c).edit().putString(entryId, cfg.toString()).apply();
    }

    public static JSONObject effective(Context c, String entryId) {
        JSONObject own = reminderConfig(c, entryId);
        return own != null ? own : globalConfig(c);
    }

    // The path of the audio file for a setting in file mode.
    private static String sourceOf(Context c, JSONObject cfg) {
        String mode = cfg.optString("mode", "default");
        if ("file".equals(mode)) { File f = savedFile(c); return f == null ? "" : f.getAbsolutePath(); }
        if ("notification".equals(mode) || "alarm".equals(mode)) return cfg.optString("uri", "");
        return "";
    }

    private static String channelIdOf(Context c, JSONObject cfg) {
        String mode = cfg.optString("mode", "default");
        String key = "v4|" + mode + "|" + sourceOf(c, cfg) + "|" + cfg.optBoolean("vibrate", false) + "|" + cfg.optBoolean("rise", false);
        return CHANNEL_PREFIX + Integer.toHexString(key.hashCode());
    }

    // Makes (when missing) the channel for a setting and remembers the setting beside it. Returns the channel id.
    public static String channelFor(Context c, JSONObject cfg) {
        String id = channelIdOf(c, cfg);
        String mode = cfg.optString("mode", "default");
        boolean rise = cfg.optBoolean("rise", false);
        try {
            alerts(c).edit().putString("chan_" + id, new JSONObject().put("mode", mode).put("src", sourceOf(c, cfg)).put("rise", rise).put("vib", cfg.optBoolean("vibrate", false)).toString()).apply();
        } catch (Throwable ignored) { /* the service then follows the global setting */ }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(id) != null) return id;
        NotificationChannel ch = new NotificationChannel(id, "Reminders", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Arkly reminder alerts");
        ch.setLockscreenVisibility(1); // show full content, as notifications.js does
        if ("default".equals(mode) || "notification".equals(mode)) {
            AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            Uri u = "notification".equals(mode) && !sourceOf(c, cfg).isEmpty() ? Uri.parse(sourceOf(c, cfg)) : Settings.System.DEFAULT_NOTIFICATION_URI;
            ch.setSound(u, aa);
        } else {
            ch.setSound(null, null); // the service plays it, or there is no sound
        }
        ch.enableVibration(false); // the pattern is played by onFire (see vibrate), so the two never overlap
        nm.createNotificationChannel(ch);
        return id;
    }

    public static String channelForEntry(Context c, String entryId) { return channelFor(c, effective(c, entryId)); }

    // After the global setting changed: makes its channel and removes every other Arkly sound channel that no reminder uses.
    // Notifications already scheduled on a removed channel are dropped by Android, so the app schedules every reminder again afterwards.
    public static String applyChannel(Context c) {
        String id = channelFor(c, globalConfig(c));
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return id;
        Set<String> keep = new HashSet<>();
        keep.add(id); keep.add(PLAYING_CHANNEL);
        Map<String, ?> all = alerts(c).getAll();
        for (Map.Entry<String, ?> e : all.entrySet()) {
            if (e.getKey().startsWith("chan_") || !(e.getValue() instanceof String)) continue;
            try { keep.add(channelFor(c, new JSONObject((String) e.getValue()))); } catch (Throwable ignored) { /* skipped */ }
        }
        List<String> drop = new ArrayList<>();
        for (NotificationChannel ch : nm.getNotificationChannels()) {
            String n = ch.getId();
            if (n.startsWith(OWN_PREFIX) && !keep.contains(n)) drop.add(n);
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

    // Called by the patched TimedNotificationPublisher right after a reminder notification is posted; channelId is the one it was
    // posted on, notification the posted notification itself.
    public static void onFire(Context c, int notificationId, String channelId, Notification notification) {
        fire(c, notificationId, channelId, notification, 1);
    }

    // One ring. `count` is which ring this is (1 to REPEATS); the next one is scheduled ten minutes on while there are rings left.
    private static void fire(Context c, int notificationId, String channelId, Notification notification, int count) {
        String mode, src; boolean rise, vib;
        String stored = channelId == null ? "" : alerts(c).getString("chan_" + channelId, "");
        try {
            if (!stored.isEmpty()) {
                JSONObject j = new JSONObject(stored);
                mode = j.optString("mode", "default"); src = j.optString("src", ""); rise = j.optBoolean("rise", false); vib = j.optBoolean("vib", false);
            } else if (OLD_SILENT_CHANNEL.equals(channelId)) { // posted before Decision 363: the global setting
                JSONObject g = globalConfig(c);
                mode = g.optString("mode", "default"); src = sourceOf(c, g); rise = g.optBoolean("rise", false); vib = g.optBoolean("vibrate", false);
            } else return;
        } catch (Throwable t) { return; }
        if (vib) vibrate(c);
        shown = notification; shownId = notificationId;
        wakeScreen(c);
        scheduleRepeat(c, notificationId, count + 1);
        showCard(c, notificationId, notification);
        boolean isFile = "file".equals(mode);
        if (!isFile && !"alarm".equals(mode)) { startHold(c, notificationId, notification); return; }
        if (src.isEmpty()) { startHold(c, notificationId, notification); return; }
        try {
            pending = notification; pendingId = notificationId;
            Intent i = new Intent(c, ArklyReminderSoundService.class).setAction(ArklyReminderSoundService.ACTION_PLAY)
                .putExtra("kind", isFile ? "file" : "uri").putExtra("src", src).putExtra("rise", rise).putExtra("nid", notificationId);
            ContextCompat.startForegroundService(c, i);
        } catch (Throwable t) {
            pending = null;
            // The service could not start (background limits): the phone's own ringtone player, once, at full volume.
            try {
                stopFallback();
                fallback = RingtoneManager.getRingtone(c, isFile ? Uri.fromFile(new File(src)) : Uri.parse(src));
                if (fallback != null) fallback.play();
            } catch (Throwable ignored) { /* no sound; the banner still shows */ }
        }
    }

    // Called by the patched publisher just BEFORE it posts the reminder notification (Decision 370): returns it with a full-screen intent,
    // so it is posted once, as a new notification. With the phone locked or the screen off, Android then turns the screen on and opens
    // ArklyAlarmActivity over the lock screen; with the screen on it stays a banner. Returned unchanged when this is not possible (older
    // Android, or full-screen notifications switched off for the app).
    public static Notification prepare(Context c, int id, Notification n) {
        shown = n; shownId = id;
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || n == null) return n;
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return n;
            if (Build.VERSION.SDK_INT >= 34 && !nm.canUseFullScreenIntent()) return n;
            CharSequence title = n.extras != null ? n.extras.getCharSequence(Notification.EXTRA_TITLE) : null;
            CharSequence text = n.extras != null ? n.extras.getCharSequence(Notification.EXTRA_TEXT) : null;
            Intent i = new Intent(c, ArklyAlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("nid", id).putExtra("title", title == null ? "" : title.toString()).putExtra("text", text == null ? "" : text.toString());
            PendingIntent pi = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification out = Notification.Builder.recoverBuilder(c, n).setFullScreenIntent(pi, true).build();
            shown = out;
            return out;
        } catch (Throwable t) { return n; }
    }

    // If the screen is off, turns it on for ten seconds, so the reminder is on the lock screen even when the phone does not open the
    // full-screen reminder. (Needs the WAKE_LOCK permission, already added.)
    private static void wakeScreen(Context c) {
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            if (pm == null || pm.isInteractive()) return;
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock w = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "arkly:reminder-screen");
            w.acquire(10000L);
        } catch (Throwable ignored) { /* the screen stays off */ }
    }

    public static Notification shownNotification(int id) { return shownId == id ? shown : null; }

    // The reminder card over the open app (Decision 374). Also added when the phone is locked or the screen is off: it waits under the lock
    // screen and is the first thing seen after unlocking. The full-screen reminder (Decision 368) covers the locked phone for the first minute.
    private static void showCard(Context c, int id, Notification n) {
        try { ArklyReminderCard.show(c, id, n); } catch (Throwable ignored) { /* no card */ }
    }

    // A reminder without a looping sound has no service to keep the app running, so the card would go when the phone ends the app. Start the
    // service in its holding mode while a card is showing (Decision 375). It uses the reminder notification as its foreground notification.
    private static void startHold(Context c, int id, Notification n) {
        try {
            if (!ArklyReminderCard.hasCards()) return;
            pending = n; pendingId = id;
            Intent i = new Intent(c, ArklyReminderSoundService.class).setAction(ArklyReminderSoundService.ACTION_HOLD).putExtra("nid", id);
            ContextCompat.startForegroundService(c, i);
        } catch (Throwable ignored) { /* the card lives as long as the app does */ }
    }

    static final int REPEATS = 3;                // rings in all for a reminder nobody answers (Decision 372)
    static final long REPEAT_MS = 10 * 60 * 1000L;

    // Ten minutes after a ring, ring again, up to REPEATS rings. Nothing is scheduled once the reminder is dealt with: the alarm finds its
    // notification gone (Done, Snooze or a swipe-away remove it) and does nothing.
    private static void scheduleRepeat(Context c, int id, int nextCount) {
        if (nextCount > REPEATS || id == 0) return;
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = PendingIntent.getBroadcast(c, id, new Intent(c, ArklyRepeatReceiver.class).putExtra("nid", id).putExtra("count", nextCount),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            long at = System.currentTimeMillis() + REPEAT_MS;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
            else am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
        } catch (Throwable ignored) { /* no repeat */ }
    }

    // The repeat alarm: ring again if the reminder's notification is still showing.
    public static void repeat(Context c, int id, int count) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || id == 0) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification n = null;
        for (android.service.notification.StatusBarNotification s : nm.getActiveNotifications()) { if (s.getId() == id) { n = s.getNotification(); break; } }
        if (n == null) return;
        String chan = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? n.getChannelId() : null;
        try { nm.notify(id, n); } catch (Throwable ignored) { /* the first posting stands */ } // a new alert: the channel's sound, and the reminder screen on a locked phone
        fire(c, id, chan, n, count);
    }

    // The fired notification for the service to show as its foreground notice, so only one notification appears. Null when none is waiting.
    public static Notification takePending(int id) {
        Notification n = pendingId == id ? pending : null;
        pending = null;
        return n;
    }

    private static Vibrator vibrator(Context c) {
        Vibrator v = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.os.VibratorManager vm = (android.os.VibratorManager) c.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) v = vm.getDefaultVibrator();
            }
            if (v == null) v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Throwable ignored) { /* none */ }
        return v != null && v.hasVibrator() ? v : null;
    }

    // One minute of vibration: a 3 s wait, then a burst of three 0.6 s buzzes with 0.7 s between them (about 3 s), a 3 s pause, the next
    // burst, and so on. The pattern is finite, so it ends by itself; Done, Snooze and the sound's Stop cancel it (stop below).
    // Played on the alarm vibration channel, so a silent ringer does not mute it.
    public static void vibrate(Context c) {
        try {
            Vibrator v = vibrator(c);
            if (v == null) return;
            java.util.ArrayList<Long> t = new java.util.ArrayList<>();
            t.add(3000L); // the wait before the first buzz
            long total = 3000;
            while (total + 3200 <= 60000) {
                t.add(600L); t.add(700L); t.add(600L); t.add(700L); t.add(600L); // a burst: three buzzes
                total += 3200;
                if (total + 3000 + 3200 > 60000) break;
                t.add(3000L); total += 3000; // the pause before the next burst
            }
            long[] pattern = new long[t.size()];
            for (int k = 0; k < pattern.length; k++) pattern[k] = t.get(k);
            play(v, pattern);
        } catch (Throwable ignored) { /* no vibrator or no permission */ }
    }

    public static void cancelVibration(Context c) {
        try { Vibrator v = vibrator(c); if (v != null) v.cancel(); } catch (Throwable ignored) { /* not vibrating */ }
    }

    // Two short buzzes (0.3 s, 0.3 s apart) for the Test button, then it stops.
    public static void vibrateShort(Context c) {
        try {
            Vibrator v = vibrator(c);
            if (v != null) play(v, new long[] { 0, 300, 300, 300 });
        } catch (Throwable ignored) { /* no vibrator or no permission */ }
    }

    private static void play(Vibrator v, long[] pattern) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            VibrationEffect e = VibrationEffect.createWaveform(pattern, -1);
            try {
                v.vibrate(e, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            } catch (Throwable first) {
                v.vibrate(e); // without the alarm usage
            }
        } else {
            v.vibrate(pattern, -1);
        }
    }

    private static void stopFallback() {
        try { if (fallback != null) fallback.stop(); } catch (Throwable ignored) { /* already stopped */ }
        fallback = null;
    }

    // Done, Snooze, a swipe-away or the Stop button end the sound and the vibration.
    public static void stop(Context c) {
        stopFallback();
        try { Vibrator v = vibrator(c); if (v != null) v.cancel(); } catch (Throwable ignored) { /* not vibrating */ }
        try { ArklyAlarmActivity.closeIfOpen(); } catch (Throwable ignored) { /* none open */ }
        try { c.stopService(new Intent(c, ArklyReminderSoundService.class)); } catch (Throwable ignored) { /* not running */ }
    }
}
