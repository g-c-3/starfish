package __PACKAGE__;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

// Video full screen (patch-screen.js, Decisions 326, 328, 331): window.ArklyScreen.immersive(on, landscape). On: system bars hidden
// (a swipe from the edge shows them briefly), the window behind the page black, and the screen turned to landscape when asked.
// Off: those three put back; with no On before it, Off does nothing. It never changes how the window lays out its content (no
// layout flags, no cutout mode), so the page's insets are the ones the app always had. No permission, touches no data, sends nothing.
public class ArklyScreenBridge {
    private final Activity act;
    private boolean active = false;
    private int prevOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private Drawable prevBackground = null;

    public ArklyScreenBridge(Activity act) {
        this.act = act;
    }

    @JavascriptInterface
    public void immersive(final boolean on, final boolean landscape) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window w = act.getWindow();
                    View decor = w.getDecorView();
                    WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, decor);
                    if (on) {
                        if (!active) {
                            active = true;
                            prevOrientation = act.getRequestedOrientation();
                            prevBackground = decor.getBackground();
                            decor.setBackgroundColor(Color.BLACK);
                            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                        }
                        if (landscape) act.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                        c.hide(WindowInsetsCompat.Type.systemBars());
                    } else if (active) {
                        active = false;
                        c.show(WindowInsetsCompat.Type.systemBars());
                        decor.setBackground(prevBackground);
                        prevBackground = null;
                        act.setRequestedOrientation(prevOrientation);
                    }
                } catch (Exception e) {
                    // the page keeps its window-filling mode
                }
            }
        });
    }
}
