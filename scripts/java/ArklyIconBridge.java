package __PACKAGE__;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.webkit.JavascriptInterface;

// Launcher icon choice and widget logo (patch-launcher-icon.js, Decisions 583, 584, 586).
// window.ArklyIcon.get() answers "white" or "dark": which launcher alias is enabled. set("white"|"dark") enables that alias and disables
// the other without stopping the app, then redraws the home-screen widget, whose logo follows the same alias; a launcher may close the
// app or show the new icon after a moment. Needs no permission, reads no app data, sends nothing.
public class ArklyIconBridge {
    private static final String WHITE = "__PACKAGE__.LauncherWhite";
    private static final String DARK = "__PACKAGE__.LauncherDark";
    private final Context ctx;

    public ArklyIconBridge(Context ctx) {
        this.ctx = ctx;
    }

    private ComponentName alias(String cls) {
        return new ComponentName(ctx.getPackageName(), cls);
    }

    @JavascriptInterface
    public String get() {
        try {
            int state = ctx.getPackageManager().getComponentEnabledSetting(alias(DARK));
            return state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ? "dark" : "white";
        } catch (Exception e) {
            return "white";
        }
    }

    @JavascriptInterface
    public boolean set(String which) {
        try {
            boolean dark = "dark".equals(which);
            PackageManager pm = ctx.getPackageManager();
            pm.setComponentEnabledSetting(alias(dark ? DARK : WHITE), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(alias(dark ? WHITE : DARK), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            refreshWidgets();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void refreshWidgets() {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
            int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, ArklyWidgetProvider.class));
            if (ids == null || ids.length == 0) return;
            Intent refresh = new Intent(ctx, ArklyWidgetProvider.class);
            refresh.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            refresh.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(refresh);
        } catch (Exception e) {
            // the widget keeps the logo it has
        }
    }
}
