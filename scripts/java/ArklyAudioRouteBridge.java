package __PACKAGE__;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

// Speaker or earpiece for voice playback (patch-audioroute.js, Decision 283). Reachable from the app's own page only, as
// window.ArklyAudioRoute. set(true) moves playback to the earpiece; set(false) puts the phone's audio mode back to normal.
// Nothing here reads audio, touches the network or asks for a permission beyond MODIFY_AUDIO_SETTINGS (a normal permission).
public class ArklyAudioRouteBridge {
    private final Context ctx;
    private int previousMode = AudioManager.MODE_NORMAL;
    private boolean active = false;

    public ArklyAudioRouteBridge(Context ctx) {
        this.ctx = ctx;
    }

    private AudioManager am() {
        return (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    // true when the earpiece route is on (or, for false, the normal mode is back); false on any error or no earpiece.
    @JavascriptInterface
    public synchronized boolean set(boolean earpiece) {
        try {
            AudioManager am = am();
            if (am == null) return false;
            if (earpiece) {
                if (!active) previousMode = am.getMode();
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                boolean ok = true;
                if (Build.VERSION.SDK_INT >= 31) {
                    ok = false;
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) { ok = am.setCommunicationDevice(d); break; }
                    }
                } else {
                    am.setSpeakerphoneOn(false);
                }
                active = true;
                if (!ok) { restore(am); return false; }
                return true;
            }
            restore(am);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void restore(AudioManager am) {
        if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
        else am.setSpeakerphoneOn(false);
        am.setMode(previousMode);
        active = false;
    }
}
