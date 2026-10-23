package __PACKAGE__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

// Home-screen quick-capture widget (patch-widget.js, Decision 266). Four buttons; each opens the app on arkly://capture/<kind>
// through an explicit, immutable PendingIntent. Reads no data, makes no network call.
public class ArklyWidgetProvider extends AppWidgetProvider {
    private static final String[] KINDS = { "note", "voice", "image", "money" };
    private static final int[] IDS = { R.id.arkly_w_note, R.id.arkly_w_voice, R.id.arkly_w_image, R.id.arkly_w_money };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.arkly_widget);
            for (int i = 0; i < KINDS.length; i++) {
                Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("arkly://capture/" + KINDS[i]));
                open.setClass(context, MainActivity.class);
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent pending = PendingIntent.getActivity(context, i, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                views.setOnClickPendingIntent(IDS[i], pending);
            }
            manager.updateAppWidget(widgetId, views);
        }
    }
}
