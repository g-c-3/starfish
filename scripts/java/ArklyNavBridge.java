package __PACKAGE__;

import android.content.ContentResolver;
import android.content.Context;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

// Which way the phone's Back is given (patch-nav.js, Decision 287): window.ArklyNav.mode() answers "gesture", "buttons" or
// "unknown". The page only uses it to word the "again to exit" notice. Reads three phone settings, needs no permission,
// touches nothing and sends nothing. Any gesture signal wins, then any buttons signal.
// window.ArklyNav.textLock(true|false) (Decision 525): while a document is open the web view's text size is fixed at 100 percent, so the
// text of a Word, Excel or PowerPoint file keeps the size the file states and its pages break where other readers break them; false puts
// the phone's own text size back. The page calls it when a document opens and when it closes; the rest of the app is not touched.
public class ArklyNavBridge {
    private final Context ctx;
    private int baseZoom = -1; // the web view's text size before the lock; touched on the main thread only

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

    @JavascriptInterface
    public void textLock(final boolean on) {
        if (!(ctx instanceof com.getcapacitor.BridgeActivity)) return;
        final com.getcapacitor.BridgeActivity act = (com.getcapacitor.BridgeActivity) ctx;
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    android.webkit.WebSettings st = act.getBridge().getWebView().getSettings();
                    if (on) {
                        if (baseZoom < 0) baseZoom = st.getTextZoom();
                        st.setTextZoom(100);
                    } else if (baseZoom >= 0) {
                        st.setTextZoom(baseZoom);
                        baseZoom = -1;
                    }
                } catch (Exception e) {
                    // the text size stays as it was
                }
                done.countDown();
            }
        });
        try {
            done.await(500, java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
