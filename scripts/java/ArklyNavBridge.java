package __PACKAGE__;

import android.content.ContentResolver;
import android.content.Context;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

// Which way the phone's Back is given (patch-nav.js, Decision 287): window.ArklyNav.mode() answers "gesture", "buttons" or
// "unknown". The page only uses it to word the "again to exit" notice. Reads three phone settings, needs no permission,
// touches nothing and sends nothing. Any gesture signal wins, then any buttons signal.
public class ArklyNavBridge {
    private final Context ctx;

    public ArklyNavBridge(Context ctx) {
        this.ctx = ctx;
    }

    @JavascriptInterface
    public String mode() {
        try {
            ContentResolver cr = ctx.getContentResolver();
            int nav = Settings.Secure.getInt(cr, "navigation_mode", -1);   // Android 10+: 0 three buttons, 1 two buttons, 2 gestures
            int fsg = Settings.Global.getInt(cr, "force_fsg_nav_bar", -1); // Xiaomi: 1 full-screen gestures, 0 buttons
            int sam = Settings.Global.getInt(cr, "navigation_bar_gesture_while_hidden", -1); // Samsung: 1 swipe gestures, 0 buttons
            if (nav == 2 || fsg == 1 || sam == 1) return "gesture";
            if (nav == 0 || nav == 1 || fsg == 0 || sam == 0) return "buttons";
            return "unknown";
        } catch (Exception e) {
            return "unknown";
        }
    }
}
