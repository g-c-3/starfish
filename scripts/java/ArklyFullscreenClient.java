package __PACKAGE__;

import android.app.Activity;
import android.app.Application;
import android.app.Dialog;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.content.DialogInterface;
import android.webkit.WebChromeClient;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

// WebView fullscreen request (patch-fullscreen.js, Decision 334): the page's element.requestFullscreen() is shown in a black dialog
// window of its own, system bars hidden, display cutout enabled for that window only. The app window and the page's layout are never
// touched, so nothing is restored on exit. Back and the app leaving the foreground close it. Any failure refuses the request and the
// player keeps its window-filling mode. Keeps every other behaviour of Capacitor's client. No permission, touches no data, sends nothing.
public class ArklyFullscreenClient extends BridgeWebChromeClient {
    private final Activity act;
    private Dialog dialog = null;
    private WebChromeClient.CustomViewCallback cb = null;

    public ArklyFullscreenClient(Bridge bridge, Activity act) {
        super(bridge);
        this.act = act;
        try {
            act.getApplication().registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
                @Override public void onActivityPaused(Activity a) { if (a == ArklyFullscreenClient.this.act) close(true); }
                @Override public void onActivityCreated(Activity a, Bundle b) {}
                @Override public void onActivityStarted(Activity a) {}
                @Override public void onActivityResumed(Activity a) {}
                @Override public void onActivityStopped(Activity a) {}
                @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
                @Override public void onActivityDestroyed(Activity a) {}
            });
        } catch (Exception e) {
            // Back still closes it
        }
    }

    @Override
    public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        try {
            close(true);
            Dialog d = new Dialog(act, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            Window w = d.getWindow();
            WindowCompat.setDecorFitsSystemWindows(w, false);
            WindowManager.LayoutParams lp = w.getAttributes();
            if (Build.VERSION.SDK_INT >= 30) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            else if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
            d.setContentView(view, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            d.setCancelable(false);
            d.setOnKeyListener(new DialogInterface.OnKeyListener() {
                @Override
                public boolean onKey(DialogInterface di, int keyCode, KeyEvent ev) {
                    if (keyCode != KeyEvent.KEYCODE_BACK) return false;
                    if (ev.getAction() == KeyEvent.ACTION_UP) close(true);
                    return true;
                }
            });
            dialog = d;
            cb = callback;
            d.show();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } catch (Exception e) {
            dialog = null;
            cb = null;
            try { callback.onCustomViewHidden(); } catch (Exception ignored) { }
        }
    }

    @Override
    public void onHideCustomView() {
        close(false);
        super.onHideCustomView();
    }

    private void close(boolean notify) {
        Dialog d = dialog;
        WebChromeClient.CustomViewCallback c = cb;
        dialog = null;
        cb = null;
        if (d != null) {
            try { d.dismiss(); } catch (Exception ignored) { }
        }
        if (notify && c != null) {
            try { c.onCustomViewHidden(); } catch (Exception ignored) { }
        }
    }
}
