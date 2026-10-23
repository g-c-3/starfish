package __PACKAGE__;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;
import android.webkit.JavascriptInterface;
import java.security.MessageDigest;

// Startup signature check (patch-signature.js, Decision 261). Reachable from the app's own page only, as window.ArklySignature.
// Compares the SHA-256 of the certificate this install is signed with to the one the build was made with (written in at build time
// from the release keystore; a certificate fingerprint is public). It only informs: the page shows a notice, nothing is blocked.
// Raises the cost of a re-signed copy; it cannot stop someone who also edits this value (Decision 13).
public class ArklySignatureBridge {
    private static final String EXPECTED = "__CERT_SHA256__";
    private final Context ctx;

    public ArklySignatureBridge(Context ctx) {
        this.ctx = ctx;
    }

    // "match", "mismatch", or "unknown" (no expected value, no signature readable, or any error).
    @JavascriptInterface
    public String check() {
        try {
            if (EXPECTED.length() != 64) return "unknown";
            PackageManager pm = ctx.getPackageManager();
            String pkg = ctx.getPackageName();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                SigningInfo si = pi.signingInfo;
                if (si == null) return "unknown";
                sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
            } else {
                PackageInfo pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                sigs = pi.signatures;
            }
            if (sigs == null || sigs.length == 0) return "unknown";
            for (Signature s : sigs) {
                if (EXPECTED.equalsIgnoreCase(sha256(s.toByteArray()))) return "match";
            }
            return "mismatch";
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder b = new StringBuilder();
        for (byte x : d) b.append(String.format("%02x", x));
        return b.toString();
    }
}
