package __PACKAGE__;

import android.webkit.JavascriptInterface;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZFile;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream;

// Archive extraction bridge (patch-archive.js, Decision 220). Reachable from the app's own page only, as window.ArklyArchive.
// Extracts one archive into a new folder beside it, on a background thread; the page polls status(). Nothing leaves the phone.
// Formats: zip (zip4j: password, AES), 7z (password), rar and cbr (junrar, RAR 4 and earlier; password), tar, tar.gz, tar.bz2,
// tar.xz, and single gz, bz2, xz files.
public class ArklyArchiveBridge {
    private static final int BUF = 65536;
    private static final long RESERVE = 32L * 1024 * 1024; // free space always left on the storage
    private static final long CHECK_EVERY = 8L * 1024 * 1024;
    private static final int MAX_ENTRIES = 200000;

    private final Map<String, Job> jobs = new ConcurrentHashMap<String, Job>();
    private final AtomicInteger seq = new AtomicInteger();

    // Starts an extraction; returns the job id, or "" when the file is missing or another job is still running.
    @JavascriptInterface
    public String start(String archivePath, String password) {
        try {
            File archive = new File(archivePath);
            if (!archive.isFile()) {
                return "";
            }
            for (Job j : jobs.values()) {
                if ("running".equals(j.state)) {
                    return "";
                }
            }
            String id = "j" + seq.incrementAndGet();
            Job job = new Job(archive, password == null ? "" : password);
            jobs.put(id, job);
            Thread t = new Thread(job, "arkly-extract");
            t.setPriority(Thread.NORM_PRIORITY - 1);
            t.start();
            return id;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String status(String id) {
        Job j = id == null ? null : jobs.get(id);
        if (j == null) {
            return "{\"state\":\"error\",\"code\":\"gone\",\"message\":\"The extraction is no longer known.\"}";
        }
        return j.json();
    }

    @JavascriptInterface
    public void cancel(String id) {
        Job j = id == null ? null : jobs.get(id);
        if (j != null) {
            j.cancelled = true;
        }
    }

    @JavascriptInterface
    public void release(String id) {
        if (id != null) {
            jobs.remove(id);
        }
    }

    // ---- helpers shared with the checks ----

    static final int ZIP = 1, SEVENZ = 2, RAR = 3, TAR = 4, TAR_GZ = 5, TAR_BZ2 = 6, TAR_XZ = 7, GZ = 8, BZ2 = 9, XZ = 10;

    static int formatOf(String lower) {
        if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return TAR_GZ;
        if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2") || lower.endsWith(".tbz")) return TAR_BZ2;
        if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return TAR_XZ;
        if (lower.endsWith(".tar")) return TAR;
        if (lower.endsWith(".zip") || lower.endsWith(".cbz") || lower.endsWith(".jar")) return ZIP;
        if (lower.endsWith(".7z")) return SEVENZ;
        if (lower.endsWith(".rar") || lower.endsWith(".cbr")) return RAR;
        if (lower.endsWith(".gz")) return GZ;
        if (lower.endsWith(".bz2")) return BZ2;
        if (lower.endsWith(".xz")) return XZ;
        return 0;
    }

    // The archive's name without its archive ending (a.tar.gz -> a, a.zip -> a).
    static String baseName(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        String[] endings = { ".tar.gz", ".tar.bz2", ".tar.xz", ".tgz", ".tbz2", ".tbz", ".txz", ".tar", ".zip", ".cbz", ".jar", ".7z", ".rar", ".cbr", ".gz", ".bz2", ".xz" };
        for (String e : endings) {
            if (lower.endsWith(e) && name.length() > e.length()) {
                return name.substring(0, name.length() - e.length());
            }
        }
        return name;
    }

    // A folder name that does not exist yet: name, name (1), name (2), ...
    static File uniqueDir(File parent, String base) {
        File f = new File(parent, base);
        for (int i = 1; f.exists() && i < 1000; i++) {
            f = new File(parent, base + " (" + i + ")");
        }
        return f;
    }

    static String esc(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c < 0x20) {
                b.append(' ');
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) {
            for (File k : kids) {
                deleteTree(k);
            }
        }
        f.delete();
    }

    // Failure with a code the page maps to a message: password, format, rar5, space, entries, io.
    static class Fail extends IOException {
        final String code;

        Fail(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    static class Cancel extends IOException {
        Cancel() {
            super("cancelled");
        }
    }

    // ---- the job ----

    static class Job implements Runnable {
        private final File archive;
        private final String password;
        private final File dest;
        private final long startFree;
        volatile String state = "running";
        volatile String code = "";
        volatile String message = "";
        volatile String current = "";
        volatile boolean cancelled = false;
        volatile int files = 0;
        volatile int skipped = 0;
        volatile long written = 0;
        private long lastCheck = 0;
        private boolean created = false;
        private String destRoot = null;

        Job(File archive, String password) {
            this.archive = archive;
            this.password = password;
            File parent = archive.getParentFile();
            this.dest = uniqueDir(parent, baseName(archive.getName()));
            this.startFree = parent.getUsableSpace();
        }

        String json() {
            return "{\"state\":\"" + state + "\",\"code\":\"" + esc(code) + "\",\"message\":\"" + esc(message) + "\",\"files\":" + files
                    + ",\"skipped\":" + skipped + ",\"bytes\":" + written + ",\"current\":\"" + esc(current) + "\",\"dest\":\"" + esc(dest.getAbsolutePath()) + "\"}";
        }

        @Override
        public void run() {
            try {
                int fmt = formatOf(archive.getName().toLowerCase(Locale.ROOT));
                if (fmt == 0) {
                    throw new Fail("format", "This archive type is not supported.");
                }
                switch (fmt) {
                    case ZIP: doZip(); break;
                    case SEVENZ: do7z(); break;
                    case RAR: doRar(); break;
                    case TAR: doTar(new BufferedInputStream(new FileInputStream(archive), BUF)); break;
                    case TAR_GZ: doTar(new GZIPInputStream(new BufferedInputStream(new FileInputStream(archive), BUF), BUF)); break;
                    case TAR_BZ2: doTar(new BZip2CompressorInputStream(new BufferedInputStream(new FileInputStream(archive), BUF))); break;
                    case TAR_XZ: doTar(new XZCompressorInputStream(new BufferedInputStream(new FileInputStream(archive), BUF))); break;
                    case GZ: doSingle(new GZIPInputStream(new BufferedInputStream(new FileInputStream(archive), BUF), BUF)); break;
                    case BZ2: doSingle(new BZip2CompressorInputStream(new BufferedInputStream(new FileInputStream(archive), BUF))); break;
                    default: doSingle(new XZCompressorInputStream(new BufferedInputStream(new FileInputStream(archive), BUF))); break;
                }
                current = "";
                state = "done";
            } catch (Throwable e) {
                fail(e);
            }
        }

        // Maps any failure to a state and code, and removes what was written: a failed or cancelled run keeps nothing.
        private void fail(Throwable e) {
            Fail fail = null;
            boolean canceled = false;
            for (Throwable t = e; t != null; t = t.getCause()) {
                if (t instanceof Cancel) {
                    canceled = true;
                } else if (t instanceof Fail && fail == null) {
                    fail = (Fail) t;
                }
            }
            if (created) {
                deleteTree(dest);
            }
            if (canceled) {
                state = "cancelled";
                return;
            }
            if (fail != null) {
                code = fail.code;
                message = fail.getMessage();
            } else if (e instanceof OutOfMemoryError) {
                code = "io";
                message = "Not enough memory to extract this archive.";
            } else {
                String cls = e.getClass().getName();
                String msg = e.getMessage() == null ? "" : e.getMessage();
                String low = msg.toLowerCase(Locale.ROOT);
                if (cls.contains("V5")) {
                    code = "rar5";
                    message = "This RAR archive uses the newer RAR 5 format, which is not supported.";
                } else if (cls.contains("PasswordRequired") || low.contains("password")) {
                    code = "password";
                    message = "A password is needed.";
                } else if (password.length() > 0 && (formatOf(archive.getName().toLowerCase(Locale.ROOT)) == SEVENZ || formatOf(archive.getName().toLowerCase(Locale.ROOT)) == RAR)) {
                    code = "password";
                    message = "Wrong password or damaged archive.";
                } else {
                    code = "io";
                    message = msg.length() == 0 ? "The archive could not be read." : msg;
                }
            }
            state = "error";
        }

        // ---- output ----

        private void ensureDest() throws IOException {
            if (created) {
                return;
            }
            if (!dest.mkdirs() && !dest.isDirectory()) {
                throw new Fail("io", "Could not create the folder " + dest.getName() + ".");
            }
            created = true;
            destRoot = dest.getCanonicalPath() + File.separator;
        }

        // The file for an entry name, or null for an unsafe one (absolute, "..", or resolving outside the new folder).
        File target(String entryName) throws IOException {
            String n = entryName.replace('\\', '/');
            while (n.startsWith("/")) {
                n = n.substring(1);
            }
            if (n.length() == 0) {
                return null;
            }
            for (String seg : n.split("/")) {
                if (seg.equals("..")) {
                    skipped++;
                    return null;
                }
            }
            ensureDest();
            File f = new File(dest, n);
            if (!f.getCanonicalPath().startsWith(destRoot)) {
                skipped++;
                return null;
            }
            return f;
        }

        private void dir(String entryName) throws IOException {
            File d = target(entryName);
            if (d != null && !d.isDirectory() && !d.mkdirs()) {
                throw new Fail("io", "Could not create the folder " + d.getName() + ".");
            }
        }

        // Counts bytes, honours Cancel, and stops before the storage fills up.
        private class Sink extends OutputStream {
            private final OutputStream out;

            Sink(OutputStream out) {
                this.out = out;
            }

            @Override
            public void write(int b) throws IOException {
                write(new byte[] { (byte) b }, 0, 1);
            }

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                if (cancelled) {
                    throw new Cancel();
                }
                written += len;
                if (written - lastCheck > CHECK_EVERY) {
                    lastCheck = written;
                    if (written > startFree - RESERVE) {
                        throw new Fail("space", "There is not enough free space on this storage.");
                    }
                }
                out.write(b, off, len);
            }

            @Override
            public void close() throws IOException {
                out.close();
            }
        }

        private OutputStream open(File t) throws IOException {
            if (++files > MAX_ENTRIES) {
                throw new Fail("entries", "The archive holds too many files.");
            }
            File p = t.getParentFile();
            if (p != null && !p.isDirectory() && !p.mkdirs()) {
                throw new Fail("io", "Could not create a folder for " + t.getName() + ".");
            }
            current = t.getName();
            return new Sink(new FileOutputStream(t));
        }

        private void copy(InputStream in, File t) throws IOException {
            OutputStream out = open(t);
            try {
                byte[] b = new byte[BUF];
                int n;
                while ((n = in.read(b)) != -1) {
                    out.write(b, 0, n);
                }
            } finally {
                out.close();
            }
        }

        // ---- formats ----

        private void doZip() throws Exception {
            net.lingala.zip4j.ZipFile zf = new net.lingala.zip4j.ZipFile(archive);
            if (zf.isEncrypted()) {
                if (password.length() == 0) {
                    throw new Fail("password", "This archive needs a password.");
                }
                zf.setPassword(password.toCharArray());
            }
            List<net.lingala.zip4j.model.FileHeader> headers = zf.getFileHeaders();
            for (net.lingala.zip4j.model.FileHeader h : headers) {
                if (cancelled) {
                    throw new Cancel();
                }
                String name = h.getFileName();
                if (h.isDirectory()) {
                    dir(name);
                    continue;
                }
                File t = target(name);
                if (t == null) {
                    continue;
                }
                InputStream in = zf.getInputStream(h);
                try {
                    copy(in, t);
                } finally {
                    in.close();
                }
            }
        }

        private void do7z() throws Exception {
            SevenZFile sz = password.length() == 0 ? new SevenZFile(archive) : new SevenZFile(archive, password.toCharArray());
            try {
                SevenZArchiveEntry e;
                while ((e = sz.getNextEntry()) != null) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    if (e.isDirectory()) {
                        dir(e.getName());
                        continue;
                    }
                    File t = target(e.getName());
                    if (t == null) {
                        continue;
                    }
                    OutputStream out = open(t);
                    try {
                        byte[] b = new byte[BUF];
                        int n;
                        while ((n = sz.read(b)) != -1) {
                            out.write(b, 0, n);
                        }
                    } finally {
                        out.close();
                    }
                }
            } finally {
                sz.close();
            }
        }

        private void doRar() throws Exception {
            com.github.junrar.Archive a = password.length() == 0 ? new com.github.junrar.Archive(archive) : new com.github.junrar.Archive(archive, password);
            try {
                com.github.junrar.rarfile.FileHeader h;
                while ((h = a.nextFileHeader()) != null) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    String name = h.getFileName();
                    if (h.isDirectory()) {
                        dir(name);
                        continue;
                    }
                    if (h.isEncrypted() && password.length() == 0) {
                        throw new Fail("password", "This archive needs a password.");
                    }
                    File t = target(name);
                    if (t == null) {
                        continue;
                    }
                    OutputStream out = open(t);
                    try {
                        a.extractFile(h, out);
                    } finally {
                        out.close();
                    }
                }
            } finally {
                a.close();
            }
        }

        private void doTar(InputStream in) throws Exception {
            TarArchiveInputStream tin = new TarArchiveInputStream(in);
            try {
                TarArchiveEntry e;
                while ((e = tin.getNextTarEntry()) != null) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    if (e.isDirectory()) {
                        dir(e.getName());
                        continue;
                    }
                    if (e.isSymbolicLink() || e.isLink()) { // never created: a link could point out of the new folder
                        skipped++;
                        continue;
                    }
                    File t = target(e.getName());
                    if (t != null) {
                        copy(tin, t);
                    }
                }
            } finally {
                tin.close();
            }
        }

        private void doSingle(InputStream in) throws Exception {
            try {
                File t = target(baseName(archive.getName()));
                if (t != null) {
                    copy(in, t);
                }
            } finally {
                in.close();
            }
        }
    }
}
