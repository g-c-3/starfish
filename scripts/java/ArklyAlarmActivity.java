package __PACKAGE__;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.lang.ref.WeakReference;

// The reminder screen that appears over the lock screen and turns the screen on when a reminder fires (Decision 368).
// It shows the reminder's text and a swipe track (Decisions 371, 372): swipe left to snooze, right to stop. They fire the same actions as the
// notification's buttons, so the app handles Snooze and Done exactly as it does from the notification. Nothing is read from the app's data: the text is
// what the notification already shows on the lock screen ("Vault Reminder" for Vault reminders). Built in code, no layout file.
public class ArklyAlarmActivity extends Activity {
    private static WeakReference<ArklyAlarmActivity> open;

    // Closes the screen when the reminder was dealt with elsewhere (Done or Snooze in the notification or the app).
    public static void closeIfOpen() {
        ArklyAlarmActivity a = open == null ? null : open.get();
        if (a != null) a.finish();
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        open = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        final int nid = getIntent().getIntExtra("nid", 0);
        String title = getIntent().getStringExtra("title"), text = getIntent().getStringExtra("text");

        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(Color.parseColor("#14141A"));

        TextView t = new TextView(this);
        t.setText(title == null || title.isEmpty() ? "Reminder" : title);
        t.setTextColor(Color.parseColor("#8D8DA0")); t.setTextSize(12); t.setAllCaps(false); t.setGravity(Gravity.CENTER); t.setPadding(0, 0, 0, pad / 3);
        root.addView(t);
        TextView x = new TextView(this);
        x.setText(text == null ? "" : text);
        x.setTextColor(Color.WHITE); x.setTextSize(30); x.setTypeface(null, android.graphics.Typeface.BOLD); x.setGravity(Gravity.CENTER);
        x.setPadding(0, pad / 2, 0, pad * 2);
        root.addView(x);

        Notification n = ArklyReminderSound.shownNotification(nid);
        Notification.Action snooze = null, stop = null;
        if (n != null && n.actions != null) {
            for (Notification.Action act : n.actions) {
                String s = String.valueOf(act.title).toLowerCase();
                if (s.contains("snooze")) snooze = act; else if (stop == null) stop = act;
            }
        }
        final PendingIntent snoozeIntent = snooze != null ? snooze.actionIntent : null;
        final PendingIntent stopIntent = stop != null ? stop.actionIntent : null;
        float d = getResources().getDisplayMetrics().density;
        ArklySwipeTrack track = new ArklySwipeTrack(this, d);
        track.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (84 * d)));
        track.listener = (isSnooze) -> {
            PendingIntent action = isSnooze ? snoozeIntent : stopIntent;
            try { if (action != null) action.send(); } catch (Throwable ignored) { /* the notification's own button still works */ }
            ArklyReminderSound.stop(this);
            if (action == null) {
                try { ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(nid); } catch (Throwable ignored) { /* gone */ }
            }
            finish();
        };
        root.addView(track);
        setContentView(root);
        // Shown for one minute only, like the sound; the notification stays (Decision 373).
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(this::finish, 60000L);
    }

    @Override
    protected void onDestroy() {
        if (open != null && open.get() == this) open = null;
        super.onDestroy();
    }
}
