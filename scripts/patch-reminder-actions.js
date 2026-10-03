#!/usr/bin/env node
// Makes the reminder notification's Snooze and Done buttons work without launching the app (Decision 102).
//
// Cause: @capacitor/local-notifications 6.x builds every action button with PendingIntent.getActivity, so a tap
// always starts the Activity. This script, run in CI after `npm install` and `cap add android`:
//   1. writes ReminderActionReceiver.java next to MainActivity.java,
//   2. registers it in AndroidManifest.xml (not exported),
//   3. patches the plugin's LocalNotificationManager.java (in node_modules) so the "snooze" and "done" buttons
//      send a broadcast to that receiver instead. Every other action id keeps the stock activity intent.
// The receiver dismisses the notification, cancels or schedules the alarms through the plugin's own classes,
// and queues {a: action, e: entryId, t: time} under `dz_ra:*` keys in the Capacitor Preferences store. The app
// applies the queue to the database (app.js, drainQueuedReminderActions), so no database is opened natively.
//
// Why a script: android/ and node_modules/ are not committed (see patch-manifest.js). Idempotent; each step
// checks its own marker and aborts loudly if the file shape is not the one it was written against.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JAVA_ROOT = path.join(ROOT, 'android', 'app', 'src', 'main', 'java');
const MANIFEST = path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const PLUGIN_JAVA = path.join(ROOT, 'node_modules', '@capacitor', 'local-notifications', 'android', 'src', 'main',
  'java', 'com', 'capacitorjs', 'plugins', 'localnotifications', 'LocalNotificationManager.java');
const RECEIVER = 'ReminderActionReceiver';
const MARKER = 'dumpzone-reminder-action';

function fail(msg) { console.error(`patch-reminder-actions.js: ${msg}`); process.exit(1); }

function findMainActivity(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === 'MainActivity.java') return full;
  }
  return null;
}

for (const p of [JAVA_ROOT, MANIFEST, PLUGIN_JAVA]) if (!fs.existsSync(p)) fail(`${p} not found — run after "npm install" and "cap add android".`);
const mainActivity = findMainActivity(JAVA_ROOT);
if (!mainActivity) fail('no MainActivity.java found.');
const pkg = (fs.readFileSync(mainActivity, 'utf8').match(/^package\s+([\w.]+);/m) || [])[1];
if (!pkg) fail('package declaration not found in MainActivity.java.');
const receiverClass = `${pkg}.${RECEIVER}`;

// 1. Receiver ------------------------------------------------------------------------------------------------
const receiverPath = path.join(path.dirname(mainActivity), `${RECEIVER}.java`);
const receiverSource = `package ${pkg};

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

// ${MARKER} (patch-reminder-actions.js) — handles the Snooze and Done buttons of a reminder notification
// without starting the Activity. The database is not touched here: the action is queued for the app (Decision 102).
public class ${RECEIVER} extends BroadcastReceiver {
    private static final String PREFS = "CapacitorStorage"; // the Capacitor Preferences store, read by app.js
    private static final String KEY_PREFIX = "dz_ra:";
    private static final long SNOOZE_MS = 10L * 60L * 1000L;
    private static final int MAX_OCCURRENCES = 30; // same as notifications.js

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            int shownId = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Integer.MIN_VALUE);
            String action = intent.getStringExtra(LocalNotificationManager.ACTION_INTENT_KEY);
            String source = intent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY);
            if (shownId == Integer.MIN_VALUE || action == null || source == null) return;

            JSONObject notification = new JSONObject(source);
            JSONObject extra = notification.optJSONObject("extra");
            String entryId = extra == null ? "" : extra.optString("entryId", "");
            if (entryId.isEmpty()) return;

            long now = System.currentTimeMillis();
            int mainId = hashIdToInt(entryId);
            int snoozeId = hashIdToInt(entryId + ":snooze");
            NotificationStorage storage = new NotificationStorage(context);
            NotificationManagerCompat.from(context).cancel(shownId);

            if ("done".equals(action)) {
                // Same effect as cancelReminder() in notifications.js: the reminder and its snooze both go.
                int[] ids = new int[MAX_OCCURRENCES + 1];
                ids[0] = snoozeId;
                for (int k = 0; k < MAX_OCCURRENCES; k++) ids[k + 1] = k == 0 ? mainId : hashIdToInt(entryId + ":r" + k); // repeating occurrences
                for (int id : ids) {
                    NotificationManagerCompat.from(context).cancel(id);
                    cancelTimer(context, id);
                    storage.deleteNotification(Integer.toString(id));
                }
            } else if ("snooze".equals(action)) {
                // A one-off copy under the snooze id, so a repeating schedule is never replaced.
                SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                JSONObject schedule = new JSONObject();
                schedule.put("at", iso.format(new java.util.Date(now + SNOOZE_MS)));
                schedule.put("allowWhileIdle", true);
                notification.put("id", snoozeId);
                notification.put("schedule", schedule);
                List<LocalNotification> list = new ArrayList<>();
                list.add(LocalNotification.buildNotificationFromJSObject(new JSObject(notification.toString())));
                LocalNotificationManager manager = new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context));
                manager.schedule(null, list);
                storage.appendNotifications(list);
            } else {
                return;
            }

            JSONObject queued = new JSONObject();
            queued.put("a", action);
            queued.put("e", entryId);
            queued.put("t", now);
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_PREFIX + now + "-" + System.nanoTime(), queued.toString()).apply();
        } catch (Exception ignored) {
            // A failed action leaves the reminder as it was.
        }
    }

    // Mirrors LocalNotificationManager.cancelTimerForNotification (private in the plugin).
    private static void cancelTimer(Context context, int id) {
        Intent timer = new Intent(context, TimedNotificationPublisher.class);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent pi = PendingIntent.getBroadcast(context, id, timer, flags);
        if (pi != null) ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(pi);
    }

    // Same hash as hashIdToInt() in notifications.js (32-bit overflow, then absolute value).
    private static int hashIdToInt(String s) {
        int h = 0;
        for (int i = 0; i < s.length(); i++) h = h * 31 + s.charAt(i);
        return Math.abs(h);
    }
}
`;
if (fs.existsSync(receiverPath) && fs.readFileSync(receiverPath, 'utf8').includes(MARKER)) {
  console.log('patch-reminder-actions.js: receiver already present.');
} else {
  fs.writeFileSync(receiverPath, receiverSource, 'utf8');
  console.log(`patch-reminder-actions.js: wrote ${receiverPath}`);
}

// 2. Manifest ------------------------------------------------------------------------------------------------
let xml = fs.readFileSync(MANIFEST, 'utf8');
if (xml.includes(receiverClass)) {
  console.log('patch-reminder-actions.js: manifest entry already present.');
} else {
  const close = xml.lastIndexOf('</application>');
  if (close === -1) fail('no </application> in AndroidManifest.xml.');
  xml = xml.slice(0, close) + `    <receiver android:name="${receiverClass}" android:exported="false" />\n    ` + xml.slice(close);
  fs.writeFileSync(MANIFEST, xml, 'utf8');
  console.log('patch-reminder-actions.js: registered receiver in manifest.');
}

// 3. Plugin action intents -----------------------------------------------------------------------------------
let plugin = fs.readFileSync(PLUGIN_JAVA, 'utf8');
if (plugin.includes(MARKER)) {
  console.log('patch-reminder-actions.js: plugin already patched.');
} else {
  const stock = /PendingIntent actionPendingIntent = PendingIntent\.getActivity\(\s*context,\s*localNotification\.getId\(\) \+ notificationAction\.getId\(\)\.hashCode\(\),\s*actionIntent,\s*flags\s*\);/;
  if (!stock.test(plugin)) fail('action PendingIntent block not in the expected shape (plugin version changed?) — aborting rather than guessing.');
  const replacement = `int actionRequestCode = localNotification.getId() + notificationAction.getId().hashCode();
                PendingIntent actionPendingIntent;
                if ("snooze".equals(notificationAction.getId()) || "done".equals(notificationAction.getId())) {
                    // ${MARKER}: broadcast to the app's receiver, no Activity launch (Decision 102)
                    Intent dumpzoneIntent = new Intent();
                    dumpzoneIntent.setComponent(new android.content.ComponentName(context.getPackageName(), "${receiverClass}"));
                    dumpzoneIntent.putExtras(actionIntent);
                    actionPendingIntent = PendingIntent.getBroadcast(context, actionRequestCode, dumpzoneIntent, flags);
                } else {
                    actionPendingIntent = PendingIntent.getActivity(context, actionRequestCode, actionIntent, flags);
                }`;
  plugin = plugin.replace(stock, () => replacement);
  if (!plugin.includes(MARKER)) fail('plugin replacement did not apply.');
  fs.writeFileSync(PLUGIN_JAVA, plugin, 'utf8');
  console.log('patch-reminder-actions.js: patched plugin action intents.');
}
