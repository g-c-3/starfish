package __PACKAGE__;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
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

// Archive bridge (patch-archive.js, Decisions 220, 221). Reachable from the app's own page only, as window.ArklyArchive.
// Opening: openArchive() scans the archive's entry list once; children() answers one folder at a time. Extracting: a job on a
// background thread, polled with status(); all, some entries, or one entry into the app's cache for the viewers. Nothing leaves
// the phone.
// Formats: zip (zip4j: password, AES), 7z (password), rar and cbr (junrar, RAR 4 and earlier; password), tar, tar.gz, tar.bz2,
// tar.xz, and single gz, bz2, xz files.
public class ArklyArchiveBridge {
    private static final int BUF = 65536;
    private static final long RESERVE = 32L * 1024 * 1024; // free space always left on the storage
    private static final long CHECK_EVERY = 8L * 1024 * 1024;
    private static final int MAX_ENTRIES = 200000;

    private final Map<String, Job> jobs = new ConcurrentHashMap<String, Job>();
    private final Map<String, Browse> browses = new ConcurrentHashMap<String, Browse>();
    private final AtomicInteger seq = new AtomicInteger();
    private final File cacheRoot; // single entries opened from inside an archive; emptied at start, on clearCache() and when the screen closes

    public ArklyArchiveBridge(Activity activity) {
        this(new File(activity.getCacheDir(), "arkly-archive"));
    }

    ArklyArchiveBridge(File cacheRoot) {
        this.cacheRoot = cacheRoot;
        deleteTree(cacheRoot);
    }

    // Extracts everything into a new folder beside the archive. Returns the job id, or "" when the file is missing or another
    // job is still running.
    @JavascriptInterface
    public String start(String archivePath, String password) {
        return launch(archivePath, password, null, null);
    }

    // Extracts only the listed entries (a folder entry brings what is inside it). entriesCsv: URL-encoded paths, comma separated.
    @JavascriptInterface
    public String startSelected(String archivePath, String password, String entriesCsv) {
        try {
            Set<String> filter = new HashSet<String>();
            for (String part : (entriesCsv == null ? "" : entriesCsv).split(",")) {
                String n = normalize(URLDecoder.decode(part, "UTF-8"));
                if (n.length() > 0) {
                    filter.add(n);
                }
            }
            if (filter.isEmpty()) {
                return "";
            }
            return launch(archivePath, password, null, filter);
        } catch (Exception e) {
            return "";
        }
    }

    // Extracts into the folder named after the archive when it already exists (Decision 295). mode: "merge" asks about every file
    // that already exists (status state "conflict", answered with answer()); "replace" replaces them without asking; anything else
    // makes a new numbered folder, as start() does. entriesCsv: URL-encoded paths, or empty for everything.
    @JavascriptInterface
    public String startMode(String archivePath, String password, String entriesCsv, String mode) {
        return startModeIn(archivePath, password, entriesCsv, mode, "");
    }

    // The same, with the folder to extract into named: the new folder is made inside destParent instead of beside the archive (an
    // archive opened from inside another one sits in the app's cache; its files go beside the outer archive, Decision 297).
    @JavascriptInterface
    public String startModeIn(String archivePath, String password, String entriesCsv, String mode, String destParent) {
        try {
            File into = destParent == null || destParent.length() == 0 ? null : new File(destParent);
            if (into != null && !into.isDirectory()) {
                return "";
            }
            Set<String> filter = null;
            if (entriesCsv != null && entriesCsv.length() > 0) {
                filter = new HashSet<String>();
                for (String part : entriesCsv.split(",")) {
                    String n = normalize(URLDecoder.decode(part, "UTF-8"));
                    if (n.length() > 0) {
                        filter.add(n);
                    }
                }
                if (filter.isEmpty()) {
                    return "";
                }
            }
            int m = "merge".equals(mode) ? Job.ASK : "replace".equals(mode) ? Job.REPLACE : Job.NEW;
            return launch(archivePath, password, null, filter, m, into);
        } catch (Exception e) {
            return "";
        }
    }

    // Answers a "conflict" state: "replace", "skip", "replaceAll" or "skipAll" (the last two stay in force for the rest of the run).
    @JavascriptInterface
    public void answer(String id, String choice) {
        Job j = id == null ? null : jobs.get(id);
        if (j != null && choice != null) {
            j.giveAnswer(choice);
        }
    }

    // Extracts one entry into the app's cache, for the viewers. status(id).dest is the folder it was written under; the file is
    // dest + "/" + entryPath.
    @JavascriptInterface
    public String startEntry(String archivePath, String password, String entryPath) {
        String n = normalize(entryPath == null ? "" : entryPath);
        if (n.length() == 0) {
            return "";
        }
        Set<String> filter = new HashSet<String>();
        filter.add(n);
        return launch(archivePath, password, new File(cacheRoot, "e" + seq.incrementAndGet()), filter);
    }

    private String launch(String archivePath, String password, File destOverride, Set<String> filter) {
        return launch(archivePath, password, destOverride, filter, Job.NEW, null);
    }

    private String launch(String archivePath, String password, File destOverride, Set<String> filter, int mode, File destParent) {
        try {
            File archive = new File(archivePath);
            if (!archive.isFile()) {
                return "";
            }
            for (Job j : jobs.values()) {
                if ("running".equals(j.state) || "conflict".equals(j.state)) {
                    return "";
                }
            }
            String id = "j" + seq.incrementAndGet();
            Job job = new Job(archive, password == null ? "" : password, destOverride, filter, mode, destParent);
            jobs.put(id, job);
            Thread t = new Thread(job, "arkly-extract");
            t.setPriority(Thread.NORM_PRIORITY - 1);
            t.start();
            return id;
        } catch (Exception e) {
            return "";
        }
    }

    // ---- browsing ----

    // Reads the archive's entry list in the background. Returns a browse id, or "" when the file is missing.
    @JavascriptInterface
    public String openArchive(String archivePath, String password) {
        try {
            File archive = new File(archivePath);
            if (!archive.isFile()) {
                return "";
            }
            String id = "b" + seq.incrementAndGet();
            Browse b = new Browse(archive, password == null ? "" : password);
            browses.put(id, b);
            Thread t = new Thread(b, "arkly-browse");
            t.setPriority(Thread.NORM_PRIORITY - 1);
            t.start();
            return id;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String browseStatus(String id) {
        Browse b = id == null ? null : browses.get(id);
        if (b == null) {
            return "{\"state\":\"error\",\"code\":\"gone\",\"message\":\"The archive is no longer open.\",\"count\":0}";
        }
        return "{\"state\":\"" + b.state + "\",\"code\":\"" + esc(b.code) + "\",\"message\":\"" + esc(b.message) + "\",\"count\":" + b.count + "}";
    }

    // The entries directly inside one folder of an open archive ("" is the top), as a JSON array of {n: name, d: folder, s: size}.
    @JavascriptInterface
    public String children(String id, String prefix) {
        Browse b = id == null ? null : browses.get(id);
        if (b == null || !"ready".equals(b.state)) {
            return "[]";
        }
        return b.children(normalize(prefix == null ? "" : prefix));
    }

    @JavascriptInterface
    public void closeArchive(String id) {
        Browse b = id == null ? null : browses.remove(id);
        if (b != null) {
            b.cancelled = true;
        }
    }

    // Removes the copies opened from inside archives.
    @JavascriptInterface
    public void clearCache() {
        deleteTree(cacheRoot);
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
                b.append(String.format("\\u%04x", (int) c));
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }

    // An entry path as kept in lists and filters: forward slashes, no leading or trailing slash.
    static String normalize(String name) {
        String n = name.replace('\\', '/');
        while (n.startsWith("/")) {
            n = n.substring(1);
        }
        while (n.endsWith("/")) {
            n = n.substring(0, n.length() - 1);
        }
        return n;
    }

    static boolean unsafe(String normalized) {
        for (String seg : normalized.split("/")) {
            if (seg.equals("..")) {
                return true;
            }
        }
        return false;
    }

    // The decoder in front of a tar or a single compressed file.
    static InputStream decoder(int fmt, File archive) throws IOException {
        InputStream raw = new BufferedInputStream(new FileInputStream(archive), BUF);
        switch (fmt) {
            case TAR_GZ:
            case GZ:
                return new GZIPInputStream(raw, BUF);
            case TAR_BZ2:
            case BZ2:
                return new BZip2CompressorInputStream(raw);
            case TAR_XZ:
            case XZ:
                return new XZCompressorInputStream(raw);
            default:
                return raw;
        }
    }

    // A failure turned into what the page needs: a code, a message, or "cancelled".
    static class Failure {
        String code = "";
        String message = "";
        boolean cancelled = false;
    }

    static Failure describe(Throwable e, String password, String archiveName) {
        Failure out = new Failure();
        Fail fail = null;
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof Cancel) {
                out.cancelled = true;
            } else if (t instanceof Fail && fail == null) {
                fail = (Fail) t;
            }
        }
        if (out.cancelled) {
            return out;
        }
        if (fail != null) {
            out.code = fail.code;
            out.message = fail.getMessage();
            return out;
        }
        if (e instanceof OutOfMemoryError) {
            out.code = "io";
            out.message = "Not enough memory to read this archive.";
            return out;
        }
        String cls = e.getClass().getName();
        String msg = e.getMessage() == null ? "" : e.getMessage();
        int fmt = formatOf(archiveName.toLowerCase(Locale.ROOT));
        if (cls.contains("V5")) {
            out.code = "rar5";
            out.message = "This RAR archive uses the newer RAR 5 format, which is not supported.";
        } else if (cls.contains("PasswordRequired") || msg.toLowerCase(Locale.ROOT).contains("password")) {
            out.code = "password";
            out.message = "A password is needed.";
        } else if (password.length() > 0 && (fmt == SEVENZ || fmt == RAR)) {
            out.code = "password";
            out.message = "Wrong password or damaged archive.";
        } else {
            out.code = "io";
            out.message = msg.length() == 0 ? "The archive could not be read." : msg;
        }
        return out;
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
        private final Set<String> filter; // null: everything
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
        // Decision 295: NEW makes a numbered folder; ASK and REPLACE write into the existing folder of the archive's name.
        static final int NEW = 0, ASK = 1, REPLACE = 2;
        private final int mode;
        private final boolean merging; // writing into a folder that was already there: a failed run must not delete it
        private final Object lock = new Object();
        private volatile String pending = "";
        private volatile String answer = "";
        private String sticky = "";
        private File partial = null;
        volatile int kept = 0;
        volatile int replaced = 0;

        Job(File archive, String password, File destOverride, Set<String> filter, int mode, File destParent) {
            this.archive = archive;
            this.password = password;
            this.filter = filter;
            File parent = destParent != null ? destParent : archive.getParentFile();
            File named = new File(parent, baseName(archive.getName()));
            boolean into = destOverride == null && mode != NEW && named.isDirectory();
            this.mode = into ? mode : NEW;
            this.merging = into;
            this.dest = destOverride != null ? destOverride : (into ? named : uniqueDir(parent, baseName(archive.getName())));
            File space = this.dest.getParentFile();
            while (space != null && !space.exists()) {
                space = space.getParentFile();
            }
            this.startFree = (space != null ? space : parent).getUsableSpace();
        }

        // Whether an entry is part of this run: always, or when it is one of the chosen paths or inside a chosen folder.
        private boolean wanted(String entryName) {
            if (filter == null) {
                return true;
            }
            String n = normalize(entryName);
            for (String f : filter) {
                if (n.equals(f) || n.startsWith(f + "/")) {
                    return true;
                }
            }
            return false;
        }

        void giveAnswer(String choice) {
            synchronized (lock) {
                answer = choice;
                lock.notifyAll();
            }
        }

        // What to do with a file that already exists: "replace" or "skip". Waits for the page's answer unless one is in force.
        private String decide(File t) throws IOException {
            if (mode == REPLACE || "replace".equals(sticky)) {
                return "replace";
            }
            if ("skip".equals(sticky)) {
                return "skip";
            }
            String base = dest.getAbsolutePath();
            String full = t.getAbsolutePath();
            pending = full.startsWith(base + File.separator) ? full.substring(base.length() + 1) : t.getName();
            String got;
            synchronized (lock) {
                answer = "";
                state = "conflict";
                try {
                    while (answer.length() == 0 && !cancelled) {
                        lock.wait(250);
                    }
                } catch (InterruptedException ie) {
                    cancelled = true;
                }
                got = answer;
                state = "running";
            }
            pending = "";
            if (cancelled) {
                throw new Cancel();
            }
            if ("replaceAll".equals(got)) {
                sticky = "replace";
                return "replace";
            }
            if ("skipAll".equals(got)) {
                sticky = "skip";
                return "skip";
            }
            return "replace".equals(got) ? "replace" : "skip";
        }

        String json() {
            return "{\"state\":\"" + state + "\",\"code\":\"" + esc(code) + "\",\"message\":\"" + esc(message) + "\",\"files\":" + files
                    + ",\"skipped\":" + skipped + ",\"kept\":" + kept + ",\"replaced\":" + replaced + ",\"pending\":\"" + esc(pending) + "\",\"merging\":" + merging
                    + ",\"bytes\":" + written + ",\"current\":\"" + esc(current) + "\",\"dest\":\"" + esc(dest.getAbsolutePath()) + "\"}";
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
                    case TAR: case TAR_GZ: case TAR_BZ2: case TAR_XZ: doTar(decoder(fmt, archive)); break;
                    default: doSingle(decoder(fmt, archive)); break;
                }
                current = "";
                state = "done";
            } catch (Throwable e) {
                fail(e);
            }
        }

        // Maps any failure to a state and code, and removes what was written: a failed or cancelled run keeps nothing.
        private void fail(Throwable e) {
            Failure f = describe(e, password, archive.getName());
            if (partial != null) {
                partial.delete(); // the file being written when the run stopped
            }
            if (created && !merging) {
                deleteTree(dest);
            }
            if (f.cancelled) {
                state = "cancelled";
                return;
            }
            code = f.code;
            message = f.message;
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
            String n = normalize(entryName);
            if (n.length() == 0) {
                return null;
            }
            if (unsafe(n)) {
                skipped++;
                return null;
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

            private boolean failed = false;

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                try {
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
                } catch (IOException e) {
                    failed = true;
                    throw e;
                }
            }

            @Override
            public void close() throws IOException {
                out.close();
                if (!failed) {
                    partial = null; // written whole: a later failure must not delete it
                }
            }
        }

        // Reads and drops the bytes of an entry that is not written (an existing file that is kept).
        private class Discard extends OutputStream {
            @Override
            public void write(int b) {
            }

            @Override
            public void write(byte[] b, int off, int len) throws IOException {
                if (cancelled) {
                    throw new Cancel();
                }
            }
        }

        private OutputStream open(File t) throws IOException {
            boolean replacing = false;
            if (merging && t.exists()) {
                if (t.isDirectory() || "skip".equals(decide(t))) {
                    kept++;
                    return new Discard();
                }
                replacing = true;
            }
            if (++files > MAX_ENTRIES) {
                throw new Fail("entries", "The archive holds too many files.");
            }
            File p = t.getParentFile();
            if (p != null && !p.isDirectory() && !p.mkdirs()) {
                throw new Fail("io", "Could not create a folder for " + t.getName() + ".");
            }
            current = t.getName();
            if (replacing) {
                replaced++;
            }
            partial = t;
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
                if (!wanted(name)) {
                    continue;
                }
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
                    if (!wanted(e.getName())) {
                        continue;
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
                    if (!wanted(name)) {
                        continue;
                    }
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
                    if (!wanted(e.getName())) {
                        continue;
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

    // ---- the entry list of an open archive ----

    static class Entry {
        final String name;
        final boolean dir;
        final long size;

        Entry(String name, boolean dir, long size) {
            this.name = name;
            this.dir = dir;
            this.size = size;
        }
    }

    static class Browse implements Runnable {
        private final File archive;
        private final String password;
        private final ArrayList<Entry> entries = new ArrayList<Entry>();
        volatile String state = "running";
        volatile String code = "";
        volatile String message = "";
        volatile int count = 0;
        volatile boolean cancelled = false;

        Browse(File archive, String password) {
            this.archive = archive;
            this.password = password;
        }

        @Override
        public void run() {
            try {
                scan();
                state = "ready";
            } catch (Throwable e) {
                Failure f = describe(e, password, archive.getName());
                if (f.cancelled || cancelled) {
                    state = "cancelled";
                } else {
                    code = f.code;
                    message = f.message;
                    state = "error";
                }
            }
        }

        private void add(String raw, boolean dir, long size) throws IOException {
            if (cancelled) {
                throw new Cancel();
            }
            String n = normalize(raw);
            if (n.length() == 0 || unsafe(n)) { // a name that could not be extracted is not listed either
                return;
            }
            if (entries.size() >= MAX_ENTRIES) {
                throw new Fail("entries", "The archive holds too many files to open.");
            }
            entries.add(new Entry(n, dir, size));
            count = entries.size();
        }

        private void scan() throws Exception {
            int fmt = formatOf(archive.getName().toLowerCase(Locale.ROOT));
            switch (fmt) {
                case ZIP: {
                    net.lingala.zip4j.ZipFile zf = new net.lingala.zip4j.ZipFile(archive);
                    for (net.lingala.zip4j.model.FileHeader h : zf.getFileHeaders()) {
                        add(h.getFileName(), h.isDirectory(), h.getUncompressedSize());
                    }
                    break;
                }
                case SEVENZ: {
                    SevenZFile sz = password.length() == 0 ? new SevenZFile(archive) : new SevenZFile(archive, password.toCharArray());
                    try {
                        for (SevenZArchiveEntry e : sz.getEntries()) {
                            add(e.getName(), e.isDirectory(), e.getSize());
                        }
                    } finally {
                        sz.close();
                    }
                    break;
                }
                case RAR: {
                    com.github.junrar.Archive a = password.length() == 0 ? new com.github.junrar.Archive(archive) : new com.github.junrar.Archive(archive, password);
                    try {
                        com.github.junrar.rarfile.FileHeader h;
                        while ((h = a.nextFileHeader()) != null) {
                            add(h.getFileName(), h.isDirectory(), h.getFullUnpackSize());
                        }
                    } finally {
                        a.close();
                    }
                    break;
                }
                case TAR: case TAR_GZ: case TAR_BZ2: case TAR_XZ: {
                    TarArchiveInputStream tin = new TarArchiveInputStream(decoder(fmt, archive));
                    try {
                        TarArchiveEntry e;
                        while ((e = tin.getNextTarEntry()) != null) {
                            if (!e.isSymbolicLink() && !e.isLink()) {
                                add(e.getName(), e.isDirectory(), e.getSize());
                            }
                        }
                    } finally {
                        tin.close();
                    }
                    break;
                }
                case GZ: case BZ2: case XZ:
                    decoder(fmt, archive).close(); // fails early for a damaged file
                    add(baseName(archive.getName()), false, 0);
                    break;
                default:
                    throw new Fail("format", "This archive type is not supported.");
            }
        }

        // One folder's contents: files, folders written in the archive, and folders only implied by deeper paths.
        String children(String prefix) {
            String head = prefix.length() == 0 ? "" : prefix + "/";
            LinkedHashMap<String, Entry> out = new LinkedHashMap<String, Entry>();
            for (Entry e : entries) {
                if (!e.name.startsWith(head) || e.name.length() == head.length()) {
                    continue;
                }
                String rest = e.name.substring(head.length());
                int slash = rest.indexOf('/');
                if (slash < 0) {
                    Entry old = out.get(rest);
                    if (old == null || e.dir) {
                        out.put(rest, new Entry(rest, e.dir, e.size));
                    }
                } else {
                    String folder = rest.substring(0, slash);
                    if (!out.containsKey(folder)) {
                        out.put(folder, new Entry(folder, true, 0));
                    }
                }
            }
            StringBuilder b = new StringBuilder("[");
            boolean first = true;
            for (Entry e : out.values()) {
                if (!first) {
                    b.append(',');
                }
                first = false;
                b.append("{\"n\":\"").append(esc(e.name)).append("\",\"d\":").append(e.dir ? "true" : "false").append(",\"s\":").append(e.size < 0 ? 0 : e.size).append('}');
            }
            return b.append(']').toString();
        }
    }
}
