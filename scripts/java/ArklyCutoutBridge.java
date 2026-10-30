package __PACKAGE__;

import android.app.Activity;
import android.os.Build;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.core.graphics.Insets;
import androidx.core.view.OnApplyWindowInsetsListener;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.Locale;

// Display cutout (patch-cutout.js, Decision 336), set once when the app starts and never changed or restored afterwards:
// 1. the window may draw into the cutout on the short edges;
// 2. the system stops padding the content for its insets, and this class pads the content by hand instead: top = status bar (or the
//    cutout if larger), bottom = navigation bar or the keyboard if larger, left and right = a navigation bar on that side. The
//    cutout's side strips are not padded, so the page fills them.
// window.ArklyCutout.insets() returns the cutout's safe insets as "left,top,right,bottom" in CSS pixels (read only), for the page's
// own clearance rules. No permission, touches no data, sends nothing. If anything fails before the system padding is turned off,
// the system padding stays.
public class ArklyCutoutBridge {
    private final Activity act;

    public ArklyCutoutBridge(Activity act) {
        this.act = act;
        try {
            Window w = act.getWindow();
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(lp);
            }
            final View content = act.findViewById(android.R.id.content);
            if (content == null) return;
            ViewCompat.setOnApplyWindowInsetsListener(content, new OnApplyWindowInsetsListener() {
                @Override
                public WindowInsetsCompat onApplyWindowInsets(View v, WindowInsetsCompat insets) {
                    Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                    Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                    Insets cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
                    v.setPadding(bars.left, Math.max(bars.top, cut.top), bars.right, Math.max(bars.bottom, ime.bottom));
                    return WindowInsetsCompat.CONSUMED;
                }
            });
            WindowCompat.setDecorFitsSystemWindows(w, false);
            ViewCompat.requestApplyInsets(content);
        } catch (Exception e) {
            // the system keeps padding the content
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
