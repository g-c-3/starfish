package __PACKAGE__;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

// Display cutout strip (patch-cutout.js, Decision 336): the window is allowed to draw into the cutout on the short edges (set once when
// the app starts, never changed or restored), and the window background, which is what shows beside the camera, is painted with the
// app's own background colour instead of black. window.ArklyCutout.background("#rrggbb") is called by the page on start and on a
// theme change. It never touches the content's layout or insets. No permission, touches no data, sends nothing.
public class ArklyCutoutBridge {
    private final Activity act;

    public ArklyCutoutBridge(Activity act) {
        this.act = act;
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                Window w = act.getWindow();
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(lp);
            }
        } catch (Exception e) {
            // the window keeps its default cutout handling
        }
    }

    @JavascriptInterface
    public void background(final String color) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    act.getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor(color)));
                } catch (Exception e) {
                    // the window background stays as it was
                }
            }
        });
    }
}
