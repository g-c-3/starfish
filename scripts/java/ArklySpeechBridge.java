package __PACKAGE__;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

// Voice to text for the notes editor (patch-speech.js, Decision 408): window.ArklySpeech. Only the phone's ON-DEVICE recognizer is ever
// created (Android 13 or newer, a language pack already on the phone); there is no fallback to the online recognizer, so no audio leaves
// the phone. The page polls: status() for permission, availability and the installed languages, poll() for partial and final text.
// Needs the microphone permission (RECORD_AUDIO, already declared for the voice recorder). Reads nothing else, stores nothing.
@SuppressLint("NewApi")
public class ArklySpeechBridge {
    private final Activity act;
    private ActivityResultLauncher<String> permLauncher = null;
    private volatile String perm = "idle";      // idle | pending | granted | denied
    private volatile String prep = "idle";      // idle | preparing | ready | unavailable
    private volatile String reason = "";        // android | device | packs | check
    private volatile List<String> installed = new ArrayList<>();
    private SpeechRecognizer rec = null;
    private final Object lock = new Object();
    private String partial = "";
    private final List<String> finals = new ArrayList<>();
    private volatile String run = "idle";       // idle | listening | ended | error
    private volatile String err = "";

    public ArklySpeechBridge(Activity act) {
        this.act = act;
        try {
            if (act instanceof ComponentActivity) {
                permLauncher = ((ComponentActivity) act).registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    granted -> perm = granted ? "granted" : "denied");
            }
        } catch (Exception e) {
            permLauncher = null;
        }
    }

    @JavascriptInterface
    public boolean hasPermission() {
        try {
            return act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void requestPermission() {
        if (hasPermission()) { perm = "granted"; return; }
        if (permLauncher == null) { perm = "denied"; return; }
        perm = "pending";
        act.runOnUiThread(() -> {
            try { permLauncher.launch(Manifest.permission.RECORD_AUDIO); } catch (Exception e) { perm = "denied"; }
        });
    }

    // Starts the check of what this phone can do on-device. Read the answer with status().
    @JavascriptInterface
    public void prepare() {
        if (Build.VERSION.SDK_INT < 33) { prep = "unavailable"; reason = "android"; return; }
        try {
            if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(act)) { prep = "unavailable"; reason = "device"; return; }
        } catch (Exception e) { prep = "unavailable"; reason = "device"; return; }
        prep = "preparing"; reason = "";
        act.runOnUiThread(this::check);
    }

    private void check() {
        try {
            final SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(act);
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            r.checkRecognitionSupport(i, act.getMainExecutor(), new RecognitionSupportCallback() {
                @Override public void onSupportResult(RecognitionSupport s) {
                    installed = new ArrayList<>(s.getInstalledOnDeviceLanguages());
                    if (installed.isEmpty()) { prep = "unavailable"; reason = "packs"; } else { prep = "ready"; reason = ""; }
                    try { r.destroy(); } catch (Exception e) { /* nothing to free */ }
                }
                @Override public void onError(int error) {
                    prep = "unavailable"; reason = "check";
                    try { r.destroy(); } catch (Exception e) { /* nothing to free */ }
                }
            });
        } catch (Exception e) {
            prep = "unavailable"; reason = "check";
        }
    }

    @JavascriptInterface
    public String status() {
        try {
            JSONObject o = new JSONObject();
            o.put("perm", perm); o.put("prep", prep); o.put("reason", reason);
            o.put("languages", new JSONArray(installed));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // One recognition: ends after a pause in speech (run becomes "ended"); the page starts the next one while the mic is on.
    @JavascriptInterface
    public void start(final String language) {
        synchronized (lock) { partial = ""; err = ""; run = "listening"; }
        act.runOnUiThread(() -> {
            try {
                destroyRec();
                if (Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(act)) { fail("device"); return; }
                rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(act);
                rec.setRecognitionListener(listener);
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                rec.startListening(i);
            } catch (Exception e) {
                fail("start");
            }
        });
    }

    @JavascriptInterface
    public void stop() {
        act.runOnUiThread(() -> { try { if (rec != null) rec.stopListening(); } catch (Exception e) { /* already stopped */ } });
    }

    @JavascriptInterface
    public void cancel() {
        act.runOnUiThread(() -> {
            destroyRec();
            synchronized (lock) { run = "idle"; partial = ""; }
        });
    }

    @JavascriptInterface
    public String poll() {
        try {
            JSONObject o = new JSONObject();
            synchronized (lock) {
                o.put("run", run); o.put("partial", partial); o.put("error", err);
                o.put("finals", new JSONArray(finals));
                finals.clear();
            }
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private void destroyRec() {
        try { if (rec != null) { rec.cancel(); rec.destroy(); } } catch (Exception e) { /* nothing to free */ }
        rec = null;
    }

    private void fail(String code) {
        synchronized (lock) { err = code; run = "error"; }
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }
        @Override public void onPartialResults(Bundle b) {
            ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (l != null && !l.isEmpty()) synchronized (lock) { partial = l.get(0); }
        }
        @Override public void onResults(Bundle b) {
            ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            synchronized (lock) {
                if (l != null && !l.isEmpty() && l.get(0) != null && !l.get(0).trim().isEmpty()) finals.add(l.get(0).trim());
                partial = ""; run = "ended";
            }
        }
        @Override public void onError(int code) {
            synchronized (lock) {
                partial = "";
                if (code == 6 || code == 7) { run = "ended"; return; } // no speech or no match: the next round starts
                err = code == 12 || code == 13 ? "language" : code == 9 ? "permission" : code == 8 ? "busy" : "other";
                run = "error";
            }
        }
    };
}
