package __PACKAGE__;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Rings an unattended reminder again (Decision 372). Started by the alarm ArklyReminderSound schedules ten minutes after a ring.
public class ArklyRepeatReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        try { ArklyReminderSound.repeat(c, i.getIntExtra("nid", 0), i.getIntExtra("count", 2)); } catch (Throwable ignored) { /* nothing to ring */ }
    }
}
