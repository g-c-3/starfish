package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.Priority;

// Device location switch (patch-location.js, Decision 340): window.ArklyLocation.
// isEnabled(): whether the phone's location switch is on.
// request(): asks the system's own "turn on location" dialog (Play services settings check for high accuracy); the answer is read with
// state(): "idle", "pending", "on", "off" or "settings" (no dialog available: the phone's location settings were opened instead).
// Reads and changes nothing but that switch, with the person's tap in the dialog. No permission, no data, sends nothing.
public class ArklyLocationBridge {
    private final Activity act;
    private volatile String state = "idle";
    private ActivityResultLauncher<IntentSenderRequest> launcher = null;

    public ArklyLocationBridge(Activity act) {
        this.act = act;
        try {
            if (act instanceof ComponentActivity) {
                launcher = ((ComponentActivity) act).registerForActivityResult(
                    new ActivityResultContracts.StartIntentSenderForResult(),
                    result -> state = (result.getResultCode() == Activity.RESULT_OK) ? "on" : "off");
            }
        } catch (Exception e) {
            launcher = null; // the settings screen is used instead
        }
    }

    @JavascriptInterface
    public boolean isEnabled() {
        try {
            LocationManager lm = (LocationManager) act.getSystemService(Activity.LOCATION_SERVICE);
            if (lm == null) return true;
            if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return true; // unknown: let the location request report it
        }
    }

    @JavascriptInterface
    public String state() {
        return state;
    }

    @JavascriptInterface
    public void request() {
        state = "pending";
        act.runOnUiThread(() -> {
            try {
                LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000).build();
                LocationSettingsRequest sr = new LocationSettingsRequest.Builder().addLocationRequest(req).build();
                LocationServices.getSettingsClient(act).checkLocationSettings(sr)
                    .addOnSuccessListener(r -> state = "on")
                    .addOnFailureListener(e -> {
                        if (e instanceof ResolvableApiException && launcher != null) {
                            try {
                                launcher.launch(new IntentSenderRequest.Builder(((ResolvableApiException) e).getResolution()).build());
                                return;
                            } catch (Exception ignore) {
                                // falls through to the settings screen
                            }
                        }
                        openSettings();
                    });
            } catch (Throwable t) {
                openSettings();
            }
        });
    }

    private void openSettings() {
        try {
            act.startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
            state = "settings";
        } catch (Exception e) {
            state = "off";
        }
    }
}
