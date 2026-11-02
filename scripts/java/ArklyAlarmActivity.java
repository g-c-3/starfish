package __PACKAGE__;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.lang.ref.WeakReference;

// The reminder screen that appears over the lock screen and turns the screen on when a reminder fires (Decision 368).
// It shows the reminder's text and a swipe track (Decision 371): swipe left to snooze, right to stop. They fire the same actions as the
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
        t.setTextColor(Color.WHITE); t.setTextSize(26); t.setGravity(Gravity.CENTER);
        root.addView(t);
        TextView x = new TextView(this);
        x.setText(text == null ? "" : text);
        x.setTextColor(Color.parseColor("#C9C9D6")); x.setTextSize(18); x.setGravity(Gravity.CENTER);
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
        SwipeTrack track = new SwipeTrack(this, d);
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
        TextView hint = new TextView(this);
        hint.setText("Swipe left to snooze, right to stop");
        hint.setTextColor(Color.parseColor("#8D8DA0")); hint.setTextSize(13); hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, pad / 2, 0, 0);
        root.addView(hint);
        setContentView(root);
    }

    // One track with a round handle in the middle: drag it to the left end to snooze, to the right end to stop. Let go before the end and it
    // springs back. Purple on the left, red on the right, each stronger the further the handle is pulled that way.
    static final class SwipeTrack extends View {
        interface Listener { void onSwipe(boolean snooze); }
        Listener listener;
        private final float d;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float offset = 0f; // handle position from the centre, -1 (snooze) to 1 (stop)
        private boolean done = false;

        SwipeTrack(Context c, float density) { super(c); d = density; }

        private float handleR() { return getHeight() / 2f - 6 * d; }
        private float span() { return Math.max(1f, getWidth() / 2f - getHeight() / 2f); }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), r = h / 2f;
            float s = Math.abs(offset);
            RectF box = new RectF(0, 0, w, h);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.parseColor("#26262F"));
            c.drawRoundRect(box, r, r, paint);
            int tint = offset < 0 ? Color.parseColor("#5B47E0") : Color.parseColor("#D93A3A"); // the side being pulled towards lights up
            paint.setColor(Color.argb((int) (230 * s), Color.red(tint), Color.green(tint), Color.blue(tint)));
            c.drawRoundRect(box, r, r, paint);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(15 * d);
            paint.setFakeBoldText(true);
            paint.setColor(Color.WHITE);
            c.drawText("\u2039 Snooze for 10 mins", w * 0.27f, h / 2f + 5 * d, paint);
            paint.setColor(Color.parseColor("#FF6B6B"));
            c.drawText("Stop \u203A", w * 0.86f, h / 2f + 5 * d, paint);
            float cx = w / 2f + offset * span(); // the handle
            paint.setColor(Color.WHITE);
            c.drawCircle(cx, h / 2f, handleR(), paint);
            paint.setColor(offset < 0 ? Color.parseColor("#5B47E0") : offset > 0 ? Color.parseColor("#D93A3A") : Color.parseColor("#3A3A48"));
            paint.setTextSize(22 * d);
            c.drawText("\u2194", cx, h / 2f + 8 * d, paint);
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (done) return true;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    offset = Math.max(-1f, Math.min(1f, (e.getX() - getWidth() / 2f) / span()));
                    invalidate();
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (e.getActionMasked() == MotionEvent.ACTION_UP && Math.abs(offset) >= 0.85f) {
                        done = true;
                        if (listener != null) listener.onSwipe(offset < 0);
                    } else {
                        ValueAnimator back = ValueAnimator.ofFloat(offset, 0f);
                        back.setDuration(180);
                        back.addUpdateListener((x) -> { offset = (float) x.getAnimatedValue(); invalidate(); });
                        back.start();
                    }
                    return true;
                default:
                    return true;
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (open != null && open.get() == this) open = null;
        super.onDestroy();
    }
}
