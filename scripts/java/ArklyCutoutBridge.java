package __PACKAGE__;

import android.app.Activity;
import android.os.Build;
import android.view.DisplayCutout;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import java.util.Locale;

// Display cutout for the whole app (patch-cutout.js, Decision 336): the window is allowed to draw into the cutout on the short
// edges, set once when the app starts and never changed or restored afterwards. window.ArklyCutout.insets() returns the cutout's
// safe insets as "left,top,right,bottom" in CSS pixels; the page keeps its controls clear of them. Read only; no permission,
// touches no data, sends nothing.
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
            // the window keeps its default cutout handling and the insets read as zero
        }
    }

    @JavascriptInterface
    public String insets() {
        try {
            if (Build.VERSION.SDK_INT < 28) return "0,0,0,0";
            WindowInsets wi = act.getWindow().getDecorView().getRootWindowInsets();
            if (wi == null) return "0,0,0,0";
            DisplayCutout dc = wi.getDisplayCutout();
            if (dc == null) return "0,0,0,0";
            float d = act.getResources().getDisplayMetrics().density;
            if (d <= 0f) d = 1f;
            return String.format(Locale.US, "%.2f,%.2f,%.2f,%.2f",
                dc.getSafeInsetLeft() / d, dc.getSafeInsetTop() / d, dc.getSafeInsetRight() / d, dc.getSafeInsetBottom() / d);
        } catch (Exception e) {
            return "0,0,0,0";
        }
    }
}
