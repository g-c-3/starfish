package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.HashMap;
import java.util.Map;

// The reminder card shown in the middle of the screen over whatever app is open, when the phone is unlocked (Decision 373). One window holds
// every card, newest at the bottom, so several due reminders stack. Each card shows the reminder's text and the swipe track; swiping fires the
// notification's own Snooze or Done action, which also clears the notification. A card goes at once if its
// notification goes (Done, Snooze or a swipe-away elsewhere). Added also while the phone is locked: it is then under the lock screen and is
// the first thing seen after unlocking, or on opening the app. It stays until the reminder is dealt with (Decision 374). Shows only what the notification shows ("Vault Reminder" for Vault reminders).
// Needs the "display over other apps" permission; without it nothing is shown and the notification does its work.
public final class ArklyReminderCard {
    private static final long CHECK_MS = 2000L;
    private static final Handler H = new Handler(Looper.getMainLooper());
    private static final Map<Integer, LinearLayout> CARDS = new HashMap<>();
    private static LinearLayout container;
    private static WindowManager wm;

    private ArklyReminderCard() {}

    public static boolean allowed(Context c) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(c);
    }

    public static void show(Context ctx, final int id, Notification n) {
        try {
            final Context c = ctx.getApplicationContext();
            if (n == null || !allowed(c)) return;
            remove(id);
            CharSequence title = n.extras != null ? n.extras.getCharSequence(Notification.EXTRA_TITLE) : null;
            CharSequence text = n.extras != null ? n.extras.getCharSequence(Notification.EXTRA_TEXT) : null;
            PendingIntent snooze = null, stop = null;
            if (n.actions != null) {
                for (Notification.Action a : n.actions) {
                    String s = String.valueOf(a.title).toLowerCase();
                    if (s.contains("snooze")) snooze = a.actionIntent; else if (stop == null) stop = a.actionIntent;
                }
            }
            final PendingIntent snoozeIntent = snooze, stopIntent = stop;
            float d = c.getResources().getDisplayMetrics().density;
            int pad = (int) (18 * d);

            LinearLayout card = new LinearLayout(c);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setGravity(Gravity.CENTER_HORIZONTAL);
            card.setPadding(pad, pad, pad, pad);
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.parseColor("#F2191920")); bg.setCornerRadius(28 * d);
            card.setBackground(bg);
            card.setElevation(12 * d);
            TextView t = new TextView(c);
            t.setText(title == null || title.length() == 0 ? "Reminder" : title);
            t.setTextColor(Color.parseColor("#8D8DA0")); t.setTextSize(12); t.setGravity(Gravity.CENTER);
            card.addView(t);
            TextView x = new TextView(c);
            x.setText(text == null ? "" : text);
            x.setTextColor(Color.WHITE); x.setTextSize(24); x.setTypeface(null, Typeface.BOLD); x.setGravity(Gravity.CENTER);
            x.setPadding(0, (int) (6 * d), 0, (int) (16 * d));
            card.addView(x);
            ArklySwipeTrack track = new ArklySwipeTrack(c, d);
            track.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) (76 * d)));
            track.listener = (isSnooze) -> {
                PendingIntent action = isSnooze ? snoozeIntent : stopIntent;
                try { if (action != null) action.send(); } catch (Throwable ignored) { /* the notification's own button still works */ }
                ArklyReminderSound.stop(c);
                if (action == null) {
                    try { ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id); } catch (Throwable ignored) { /* gone */ }
                }
                remove(id);
            };
            card.addView(track);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, 0, (int) (10 * d));

            if (container == null) {
                wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
                container = new LinearLayout(c);
                container.setOrientation(LinearLayout.VERTICAL);
                container.setPadding((int) (14 * d), 0, (int) (14 * d), 0);
                int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
                WindowManager.LayoutParams wp = new WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
                wp.gravity = Gravity.CENTER;
                wm.addView(container, wp);
            }
            container.addView(card, lp);
            CARDS.put(id, card);
            H.postDelayed(new Runnable() {
                @Override public void run() {
                    if (!CARDS.containsKey(id)) return;
                    if (!stillShowing(c, id)) { remove(id); return; }
                    H.postDelayed(this, CHECK_MS);
                }
            }, CHECK_MS);
        } catch (Throwable ignored) { /* no card; the notification stands */ }
    }

    private static boolean stillShowing(Context c, int id) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            for (android.service.notification.StatusBarNotification s : nm.getActiveNotifications()) if (s.getId() == id) return true;
            return false;
        } catch (Throwable t) { return true; }
    }

    public static void remove(int id) {
        try {
            LinearLayout card = CARDS.remove(id);
            if (card != null && container != null) container.removeView(card);
            if (CARDS.isEmpty() && container != null && wm != null) { wm.removeView(container); container = null; }
        } catch (Throwable ignored) { /* already gone */ }
    }
}
