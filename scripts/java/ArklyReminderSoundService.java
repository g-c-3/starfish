package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

// Plays the reminder's alarm sound or audio file (patch-reminder-sound.js, Decisions 359, 363). A foreground service of type
// mediaPlayback, so the phone lets it run while the app is closed. Android requires such a service to show a notice; it is kept
// as quiet as the system allows (minimum importance: no status-bar icon, no sound, hidden on the lock screen) with a Stop button. The sound
// loops for at most CAP_MS and rises from silence over RISE_MS when the owner chose that. Plays on the alarm volume.
public class ArklyReminderSoundService extends Service {
    public static final String ACTION_PLAY = "arkly.reminder.sound.PLAY";
    public static final String ACTION_STOP = "arkly.reminder.sound.STOP";
    private static final int NOTICE_ID = 7458001;
    private static final long CAP_MS = 60000L;
    private static final long RISE_MS = 20000L;
    private static final long TICK_MS = 400L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private PowerManager.WakeLock wake; // keeps the phone awake while the sound is prepared and played, so it also sounds with the screen off
    private long startedAt;
    private boolean rise;
    private final Runnable stopper = this::finish;
    private final Runnable ramp = new Runnable() {
        @Override public void run() {
            if (player == null) return;
            float v = Math.min(1f, (System.currentTimeMillis() - startedAt) / (float) RISE_MS);
            v = v * v; // gentle start
            try { player.setVolume(v, v); } catch (Throwable ignored) { return; }
            if (v < 1f) handler.postDelayed(this, TICK_MS);
        }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) { finish(); return START_NOT_STICKY; }
        holdAwake();
        showNotice(intent.getIntExtra("nid", 0));
        release();
        String src = intent.getStringExtra("src");
        if (src == null || src.isEmpty()) { finish(); return START_NOT_STICKY; }
        rise = intent.getBooleanExtra("rise", false);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            if ("file".equals(intent.getStringExtra("kind"))) player.setDataSource(src); else player.setDataSource(this, Uri.parse(src));
            player.setLooping(true);
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            player.setVolume(rise ? 0f : 1f, rise ? 0f : 1f);
            player.setOnPreparedListener((m) -> {
                m.start();
                startedAt = System.currentTimeMillis();
                if (rise) handler.post(ramp);
            });
            player.setOnErrorListener((m, what, extra) -> { finish(); return true; });
            player.prepareAsync();
            handler.removeCallbacks(stopper);
            handler.postDelayed(stopper, CAP_MS);
        } catch (Throwable t) {
            finish();
        }
        return START_NOT_STICKY;
    }

    // The reminder's own notification runs the service in the foreground, so there is one notification, not two (Decision 365).
    // Only when it is not available does the service show a small notice of its own.
    private void showNotice(int nid) {
        Notification own = nid != 0 ? ArklyReminderSound.takePending(nid) : null;
        if (own != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(nid, own, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                else startForeground(nid, own);
                return;
            } catch (Throwable ignored) { /* fall back to the service's own notice */ }
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(ArklyReminderSound.PLAYING_CHANNEL, "Reminder sound playing", NotificationManager.IMPORTANCE_MIN);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            nm.createNotificationChannel(ch);
            nm.deleteNotificationChannel("arkly_rem_playing_v1"); // the earlier, more visible one
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, ArklyReminderSoundService.class).setAction(ACTION_STOP), flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, ArklyReminderSound.PLAYING_CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("Reminder sound").setOngoing(true).setVisibility(Notification.VISIBILITY_SECRET)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stop);
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTICE_ID, n);
    }

    private void holdAwake() {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null) wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "arkly:reminder-sound");
            }
            if (wake != null) wake.acquire(CAP_MS + 5000L);
        } catch (Throwable ignored) { /* no wake lock: the sound may wait for the screen */ }
    }

    // Ends the sound; the reminder notification stays (detached from the service) unless the app removes it.
    private void finish() {
        try { stopForeground(Service.STOP_FOREGROUND_DETACH); } catch (Throwable ignored) { /* not in the foreground */ }
        stopSelf();
    }

    private void release() {
        handler.removeCallbacks(ramp);
        if (player != null) {
            try { player.stop(); } catch (Throwable ignored) { /* not started */ }
            try { player.release(); } catch (Throwable ignored) { /* already released */ }
            player = null;
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(stopper);
        release();
        try { stopForeground(Service.STOP_FOREGROUND_DETACH); } catch (Throwable ignored) { /* already out of the foreground */ }
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable ignored) { /* released */ }
        super.onDestroy();
    }
}
