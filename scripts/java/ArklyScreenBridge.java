package __PACKAGE__;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

// Video full screen (patch-screen.js, Decisions 326 to 329): window.ArklyScreen.immersive(on, landscape, edge).
// on: system bars hidden (a swipe from the edge shows them briefly), the window behind the page black, the screen turned to
// landscape when asked. Off: those put back; with no on before it, off does nothing.
// edge (off unless the viewer asks for it, never kept between sessions): also draws under the display cutout. This is the only
// part that changes how the window lays out its content, so it is undone on its own the moment edge goes false or on goes false,
// and the insets are sent to the page again.
// Touches no data, needs no permission, sends nothing.
public class ArklyScreenBridge {
    private final Activity act;
    private boolean active = false;
    private boolean edgeOn = false;
    private int prevOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private int prevCutout = 0;
    private Drawable prevBackground = null;

    public ArklyScreenBridge(Activity act) {
        this.act = act;
    }

    private void refreshInsets(final View root) {
        ViewCompat.requestApplyInsets(root);
        root.postDelayed(new Runnable() {
            @Override
            public void run() {
                ViewCompat.requestApplyInsets(root);
            }
        }, 150);
        root.postDelayed(new Runnable() {
            @Override
            public void run() {
                ViewCompat.requestApplyInsets(root);
            }
        }, 500);
    }

    private void edge(Window w, View decor, boolean on) {
        if (on == edgeOn) return;
        edgeOn = on;
        if (on) {
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = w.getAttributes();
                prevCutout = lp.layoutInDisplayCutoutMode;
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(lp);
            }
            WindowCompat.setDecorFitsSystemWindows(w, false);
        } else {
            WindowCompat.setDecorFitsSystemWindows(w, true);
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode = prevCutout;
                w.setAttributes(lp);
            }
            refreshInsets(decor);
        }
    }

    @JavascriptInterface
    public void immersive(final boolean on, final boolean landscape, final boolean edgeToEdge) {
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
                        edge(w, decor, edgeToEdge);
                        c.hide(WindowInsetsCompat.Type.systemBars());
                    } else if (active) {
                        active = false;
                        edge(w, decor, false);
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
