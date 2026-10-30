package __PACKAGE__;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

// Video full screen (patch-screen.js, Decision 326): window.ArklyScreen.immersive(on, landscape). On: system bars hidden,
// content drawn under the display cutout, and the screen turned to landscape when asked. Off: everything put back as it was.
// Changes the window only, needs no permission, touches no data and sends nothing.
public class ArklyScreenBridge {
    private final Activity act;
    private int prevOrientation = Integer.MIN_VALUE;
    private int prevCutout = -1;

    public ArklyScreenBridge(Activity act) {
        this.act = act;
    }

    @JavascriptInterface
    public void immersive(final boolean on, final boolean landscape) {
        act.runOnUiThread(new Runnable() {
            @Override
            @SuppressWarnings("deprecation")
            public void run() {
                try {
                    Window w = act.getWindow();
                    View v = w.getDecorView();
                    WindowManager.LayoutParams lp = w.getAttributes();
                    if (on) {
                        if (prevOrientation == Integer.MIN_VALUE) prevOrientation = act.getRequestedOrientation();
                        if (landscape) act.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                        if (Build.VERSION.SDK_INT >= 28) {
                            if (prevCutout < 0) prevCutout = lp.layoutInDisplayCutoutMode;
                            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                            w.setAttributes(lp);
                        }
                        v.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                    } else {
                        v.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                        if (Build.VERSION.SDK_INT >= 28 && prevCutout >= 0) {
                            lp.layoutInDisplayCutoutMode = prevCutout;
                            w.setAttributes(lp);
                        }
                        prevCutout = -1;
                        if (prevOrientation != Integer.MIN_VALUE) act.setRequestedOrientation(prevOrientation);
                        prevOrientation = Integer.MIN_VALUE;
                    }
                } catch (Exception e) {
                    // the page keeps its window-filling mode
                }
            }
        });
    }
}
