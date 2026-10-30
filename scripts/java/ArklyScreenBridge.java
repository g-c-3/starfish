package __PACKAGE__;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

// Video full screen (patch-screen.js, Decisions 326, 327): window.ArklyScreen.immersive(on, landscape). On: system bars hidden
// (a swipe from the edge shows them briefly), content drawn under the display cutout, and the screen turned to landscape when
// asked. Off: only what On changed is put back; with nothing changed, Off does nothing. Window flags are never written directly,
// so the layout the app had before is the layout it gets back. No permission, touches no data, sends nothing.
public class ArklyScreenBridge {
    private final Activity act;
    private boolean active = false;
    private int prevOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private int prevCutout = 0;

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
                    WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
                    if (on) {
                        if (!active) {
                            active = true;
                            prevOrientation = act.getRequestedOrientation();
                            if (Build.VERSION.SDK_INT >= 28) {
                                WindowManager.LayoutParams lp = w.getAttributes();
                                prevCutout = lp.layoutInDisplayCutoutMode;
                                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                                w.setAttributes(lp);
                            }
                            WindowCompat.setDecorFitsSystemWindows(w, false);
                            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                        }
                        if (landscape) act.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                        c.hide(WindowInsetsCompat.Type.systemBars());
                    } else if (active) {
                        active = false;
                        c.show(WindowInsetsCompat.Type.systemBars());
                        WindowCompat.setDecorFitsSystemWindows(w, true);
                        if (Build.VERSION.SDK_INT >= 28) {
                            WindowManager.LayoutParams lp = w.getAttributes();
                            lp.layoutInDisplayCutoutMode = prevCutout;
                            w.setAttributes(lp);
                        }
                        act.setRequestedOrientation(prevOrientation);
                        w.getDecorView().requestApplyInsets();
                    }
                } catch (Exception e) {
                    // the page keeps its window-filling mode
                }
            }
        });
    }
}
