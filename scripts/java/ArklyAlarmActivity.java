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
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;
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
        setContentView(root);
    }

    // One track with a round handle in the middle holding a ringing golden bell: drag it to the left end to snooze, to the right end to stop.
    // Let go before the end and it springs back. Purple glow pulses outwards on the left, red on the right, like the bell's ringing
    // lines; each side lights up more the further the handle is pulled that way (Decision 372).
    static final class SwipeTrack extends View {
        interface Listener { void onSwipe(boolean snooze); }
        Listener listener;
        private final float d;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private float offset = 0f; // handle position from the centre, -1 (snooze) to 1 (stop)
        private float phase = 0f;  // 0..1, loops: drives the glow and the bell's swing
        private boolean done = false;
        private ValueAnimator pulse;
        private static final int PURPLE = 0xFF6E5BF0, RED = 0xFFE24848, GOLD = 0xFFFFC83D, GOLD_DARK = 0xFFE0A21B, GOLD_RIM = 0xFFC98F12;

        SwipeTrack(Context c, float density) { super(c); d = density; }

        @Override
        protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            pulse = ValueAnimator.ofFloat(0f, 1f);
            pulse.setDuration(1500); pulse.setRepeatCount(ValueAnimator.INFINITE); pulse.setInterpolator(new LinearInterpolator());
            pulse.addUpdateListener((x) -> { phase = (float) x.getAnimatedValue(); invalidate(); });
            pulse.start();
        }

        @Override
        protected void onDetachedFromWindow() {
            if (pulse != null) pulse.cancel();
            super.onDetachedFromWindow();
        }

        private float handleR() { return getHeight() / 2f - 6 * d; }
        private float span() { return Math.max(1f, getWidth() / 2f - getHeight() / 2f); }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), r = h / 2f;
            float s = Math.abs(offset);
            RectF box = new RectF(0, 0, w, h);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xFF26262F);
            c.drawRoundRect(box, r, r, paint);
            int tint = offset < 0 ? PURPLE : RED; // the side being pulled towards lights up
            paint.setColor(Color.argb((int) (235 * s), Color.red(tint), Color.green(tint), Color.blue(tint)));
            c.drawRoundRect(box, r, r, paint);
            // the two words, large, each centred in its side
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setFakeBoldText(true);
            paint.setTextSize(23 * d);
            paint.setColor(0xFFC9BFFF);
            c.drawText("Snooze", w * 0.25f, h / 2f + 8 * d, paint);
            paint.setColor(0xFFFF7A7A);
            c.drawText("Stop", w * 0.75f, h / 2f + 8 * d, paint);
            float cx = w / 2f + offset * span(), cy = h / 2f, hr = handleR();
            // pulsing lines, outwards in turn: purple to the left, red to the right
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeWidth(4 * d);
            float front = phase * 3.4f;
            for (int k = 0; k < 3; k++) {
                float lit = Math.max(0f, 1f - Math.abs(front - (k + 0.5f)) / 1.1f);
                float rad = hr + (8 + k * 8.5f) * d;
                RectF arc = new RectF(cx - rad, cy - rad, cx + rad, cy + rad);
                paint.setColor(PURPLE); paint.setAlpha((int) (255 * (0.18f + 0.82f * lit)));
                c.drawArc(arc, 150f, 60f, false, paint);
                paint.setColor(RED); paint.setAlpha((int) (255 * (0.18f + 0.82f * lit)));
                c.drawArc(arc, -30f, 60f, false, paint);
            }
            // the handle and the bell
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xFFFFFFFF);
            c.drawCircle(cx, cy, hr, paint);
            float unit = hr * 0.58f;
            c.save();
            c.rotate((float) (9 * Math.sin(phase * 2 * Math.PI * 3)), cx, cy - unit * 0.7f); // the bell swings from its top
            bell(c, cx, cy + unit * 0.05f, unit);
            c.restore();
        }

        private void bell(Canvas c, float cx, float cy, float u) {
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(GOLD);
            path.reset();
            path.moveTo(cx - 0.86f * u, cy + 0.55f * u);
            path.cubicTo(cx - 0.55f * u, cy + 0.25f * u, cx - 0.72f * u, cy - 0.62f * u, cx, cy - 0.68f * u);
            path.cubicTo(cx + 0.72f * u, cy - 0.62f * u, cx + 0.55f * u, cy + 0.25f * u, cx + 0.86f * u, cy + 0.55f * u);
            path.close();
            c.drawPath(path, paint);
            paint.setColor(0xFFFFE9A0); // a soft highlight down the left
            path.reset();
            path.moveTo(cx - 0.45f * u, cy + 0.3f * u);
            path.cubicTo(cx - 0.42f * u, cy - 0.05f * u, cx - 0.4f * u, cy - 0.42f * u, cx - 0.1f * u, cy - 0.52f * u);
            path.cubicTo(cx - 0.3f * u, cy - 0.35f * u, cx - 0.3f * u, cy - 0.0f * u, cx - 0.33f * u, cy + 0.3f * u);
            path.close();
            c.drawPath(path, paint);
            paint.setColor(GOLD_DARK); // the flared rim
            c.drawOval(new RectF(cx - 0.9f * u, cy + 0.42f * u, cx + 0.9f * u, cy + 0.72f * u), paint);
            paint.setColor(GOLD_RIM);
            c.drawOval(new RectF(cx - 0.78f * u, cy + 0.5f * u, cx + 0.78f * u, cy + 0.68f * u), paint);
            paint.setColor(GOLD);
            c.drawCircle(cx, cy - 0.78f * u, 0.13f * u, paint); // the top ring
            paint.setColor(GOLD_DARK);
            c.drawCircle(cx, cy + 0.86f * u, 0.2f * u, paint);  // the clapper
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
