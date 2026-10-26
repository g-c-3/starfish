package __PACKAGE__;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import net.lingala.zip4j.io.outputstream.ZipOutputStream;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.model.enums.AesKeyStrength;
import net.lingala.zip4j.model.enums.CompressionLevel;
import net.lingala.zip4j.model.enums.CompressionMethod;
import net.lingala.zip4j.model.enums.EncryptionMethod;
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZMethod;
import org.apache.commons.compress.archivers.sevenz.SevenZMethodConfiguration;
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile;
import org.tukaani.xz.LZMA2Options;

// Compress bridge (patch-archive.js, Decision 295). Reachable from the app's own page only, as window.ArklyPack.
// A job on a background thread, polled with status(): the chosen files and folders, all from one folder, become one .zip
// (zip4j; optional password, AES-256) or one .7z (commons-compress, LZMA2; no password). The archive is written beside the
// sources under a name that is not taken yet; a failed or cancelled run removes it. Nothing leaves the phone.
public class ArklyPackBridge {
    private static final int BUF = 65536;
    private static final long RESERVE = 32L * 1024 * 1024; // free space always left on the storage
    private static final long CHECK_EVERY = 8L * 1024 * 1024;
    private static final int MAX_ENTRIES = 200000;

    private final Map<String, Pack> jobs = new ConcurrentHashMap<String, Pack>();
    private final AtomicInteger seq = new AtomicInteger();

    public ArklyPackBridge(Activity activity) {
    }

    ArklyPackBridge() {
    }

    // format: "zip" or "7z". level: 1 fastest, 2 standard, 3 best. password: zip only, empty for none. pathsCsv: URL-encoded
    // absolute paths, comma separated, all in destDir. baseName: the archive name without its ending. Returns the job id, or ""
    // when the request is not valid or another compression is still running.
    @JavascriptInterface
    public String start(String destDir, String baseName, String format, int level, String password, String pathsCsv) {
        try {
            File dir = new File(destDir == null ? "" : destDir);
            if (!dir.isDirectory()) {
                return "";
            }
            boolean zip = "zip".equals(format);
            if (!zip && !"7z".equals(format)) {
                return "";
            }
            String pw = password == null ? "" : password;
            if (!zip && pw.length() > 0) {
                return "";
            }
            List<File> sources = new ArrayList<File>();
            for (String part : (pathsCsv == null ? "" : pathsCsv).split(",")) {
                if (part.length() == 0) {
                    continue;
                }
                File f = new File(URLDecoder.decode(part, "UTF-8"));
                File parent = f.getParentFile();
                if (!f.exists() || parent == null || !parent.getCanonicalFile().equals(dir.getCanonicalFile())) {
                    return "";
                }
                sources.add(f);
            }
            if (sources.isEmpty()) {
                return "";
            }
            for (Pack j : jobs.values()) {
                if ("running".equals(j.state)) {
                    return "";
                }
            }
            String id = "p" + seq.incrementAndGet();
            Pack job = new Pack(dir, cleanName(baseName), zip, Math.max(1, Math.min(3, level)), pw, sources);
            jobs.put(id, job);
            Thread t = new Thread(job, "arkly-pack");
            t.setPriority(Thread.NORM_PRIORITY - 1);
            t.start();
            return id;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public String status(String id) {
        Pack j = id == null ? null : jobs.get(id);
        if (j == null) {
            return "{\"state\":\"error\",\"code\":\"gone\",\"message\":\"The compression is no longer known.\"}";
        }
        return j.json();
    }

    @JavascriptInterface
    public void cancel(String id) {
        Pack j = id == null ? null : jobs.get(id);
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

    // A file name that holds no path characters; "Archive" when nothing is left.
    static String cleanName(String s) {
        String n = (s == null ? "" : s).replace('/', '_').replace('\\', '_').trim();
        while (n.startsWith(".")) {
            n = n.substring(1);
        }
        return n.length() == 0 ? "Archive" : n;
    }

    // base.ext, or base (1).ext, base (2).ext ... when that name is taken.
    static File uniqueFile(File dir, String base, String ext) {
        File f = new File(dir, base + "." + ext);
        for (int i = 1; f.exists() && i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")." + ext);
        }
        return f;
    }

    // Symbolic links are left out: a link to a parent folder would loop.
    static boolean isLink(File f) {
        try {
            File parent = f.getParentFile();
            if (parent == null) {
                return false;
            }
            return !f.getCanonicalPath().equals(new File(parent.getCanonicalFile(), f.getName()).getPath());
        } catch (IOException e) {
            return true;
        }
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

    static void deleteQuiet(File f) {
        if (f != null) {
            f.delete();
        }
    }

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

    // One file or folder to store: the file on disk, its name inside the archive (a folder ends with "/").
    static class Item {
        final File file;
        final String name;
        final boolean dir;

        Item(File file, String name, boolean dir) {
            this.file = file;
            this.name = name;
            this.dir = dir;
        }
    }

    static class Pack implements Runnable {
        private final File dir;
        private final boolean zip;
        private final int level;
        private final String password;
        private final List<File> sources;
        private final File out;
        private final long startFree;
        volatile String state = "running";
        volatile String code = "";
        volatile String message = "";
        volatile String current = "";
        volatile boolean cancelled = false;
        volatile int files = 0;
        volatile int total = 0;
        volatile int skipped = 0;
        volatile long read = 0;
        volatile long bytesTotal = 0;
        private long lastCheck = 0;
        private boolean started = false;

        Pack(File dir, String base, boolean zip, int level, String password, List<File> sources) {
            this.dir = dir;
            this.zip = zip;
            this.level = level;
            this.password = password;
            this.sources = sources;
            this.out = uniqueFile(dir, base, zip ? "zip" : "7z");
            this.startFree = dir.getUsableSpace();
        }

        String json() {
            return "{\"state\":\"" + state + "\",\"code\":\"" + esc(code) + "\",\"message\":\"" + esc(message) + "\",\"files\":" + files
                    + ",\"total\":" + total + ",\"skipped\":" + skipped + ",\"bytes\":" + read + ",\"bytesTotal\":" + bytesTotal
                    + ",\"current\":\"" + esc(current) + "\",\"dest\":\"" + esc(out.getAbsolutePath()) + "\"}";
        }

        @Override
        public void run() {
            try {
                List<Item> items = new ArrayList<Item>();
                for (File f : sources) {
                    collect(f, f.getName(), items);
                }
                if (items.isEmpty()) {
                    throw new Fail("empty", "There is nothing to compress.");
                }
                if (items.size() > MAX_ENTRIES) {
                    throw new Fail("entries", "There are too many files to compress at once.");
                }
                for (Item it : items) {
                    if (!it.dir) {
                        total++;
                        bytesTotal += it.file.length();
                    }
                }
                started = true;
                if (zip) {
                    writeZip(items);
                } else {
                    write7z(items);
                }
                current = "";
                state = "done";
            } catch (Throwable e) {
                fail(e);
            }
        }

        private void fail(Throwable e) {
            if (started) {
                deleteQuiet(out);
            }
            boolean cancel = false;
            Fail fail = null;
            for (Throwable t = e; t != null; t = t.getCause()) {
                if (t instanceof Cancel) {
                    cancel = true;
                } else if (t instanceof Fail && fail == null) {
                    fail = (Fail) t;
                }
            }
            if (cancel) {
                state = "cancelled";
                return;
            }
            if (fail != null) {
                code = fail.code;
                message = fail.getMessage();
            } else if (e instanceof OutOfMemoryError) {
                code = "memory";
                message = "This phone ran out of memory. Try the Fastest level, or fewer files at once.";
            } else {
                code = "io";
                String m = e.getMessage();
                message = m == null || m.length() == 0 ? "The archive could not be written." : m;
            }
            state = "error";
        }

        // Folders first, then what is inside them; links and unreadable entries are counted and left out.
        private void collect(File f, String name, List<Item> items) throws IOException {
            if (cancelled) {
                throw new Cancel();
            }
            if (isLink(f) || !f.canRead()) {
                skipped++;
                return;
            }
            if (f.isDirectory()) {
                items.add(new Item(f, name + "/", true));
                File[] kids = f.listFiles();
                if (kids != null) {
                    Arrays.sort(kids);
                    for (File k : kids) {
                        collect(k, name + "/" + k.getName(), items);
                        if (items.size() > MAX_ENTRIES) {
                            return;
                        }
                    }
                }
            } else if (f.isFile()) {
                items.add(new Item(f, name, false));
            } else {
                skipped++;
            }
        }

        // Counts the bytes read, honours Cancel and stops before the storage fills up.
        private void account(int n) throws IOException {
            if (cancelled) {
                throw new Cancel();
            }
            read += n;
            if (read - lastCheck > CHECK_EVERY) {
                lastCheck = read;
                if (out.length() > startFree - RESERVE) {
                    throw new Fail("space", "There is not enough free space on this storage.");
                }
            }
        }

        private void writeZip(List<Item> items) throws IOException {
            boolean encrypt = password.length() > 0;
            OutputStream raw = new BufferedOutputStream(new FileOutputStream(out), BUF);
            ZipOutputStream zos = encrypt ? new ZipOutputStream(raw, password.toCharArray()) : new ZipOutputStream(raw);
            try {
                for (Item it : items) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    ZipParameters zp = new ZipParameters();
                    zp.setFileNameInZip(it.name);
                    zp.setLastModifiedFileTime(it.file.lastModified());
                    if (it.dir) {
                        zp.setCompressionMethod(CompressionMethod.STORE);
                        zp.setEncryptFiles(false);
                        zos.putNextEntry(zp);
                        zos.closeEntry();
                        continue;
                    }
                    zp.setCompressionMethod(CompressionMethod.DEFLATE);
                    zp.setCompressionLevel(level == 1 ? CompressionLevel.FASTEST : level == 3 ? CompressionLevel.MAXIMUM : CompressionLevel.NORMAL);
                    if (encrypt) {
                        zp.setEncryptFiles(true);
                        zp.setEncryptionMethod(EncryptionMethod.AES);
                        zp.setAesKeyStrength(AesKeyStrength.KEY_STRENGTH_256);
                    }
                    current = it.file.getName();
                    zos.putNextEntry(zp);
                    InputStream in = new BufferedInputStream(new FileInputStream(it.file), BUF);
                    try {
                        byte[] b = new byte[BUF];
                        int n;
                        while ((n = in.read(b)) != -1) {
                            account(n);
                            zos.write(b, 0, n);
                        }
                    } finally {
                        in.close();
                    }
                    zos.closeEntry();
                    files++;
                }
            } finally {
                zos.close();
            }
        }

        // LZMA2 preset 1, 4 or 6: about 2, 19 or 94 MB of memory while compressing. Higher presets need several hundred MB.
        private void write7z(List<Item> items) throws IOException {
            int preset = level == 1 ? 1 : level == 3 ? 6 : 4;
            SevenZOutputFile sz = new SevenZOutputFile(out);
            try {
                sz.setContentMethods(Arrays.asList(new SevenZMethodConfiguration(SevenZMethod.LZMA2, new LZMA2Options(preset))));
                for (Item it : items) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    String name = it.dir ? it.name.substring(0, it.name.length() - 1) : it.name;
                    SevenZArchiveEntry e = sz.createArchiveEntry(it.file, name);
                    sz.putArchiveEntry(e);
                    if (!it.dir) {
                        current = it.file.getName();
                        InputStream in = new BufferedInputStream(new FileInputStream(it.file), BUF);
                        try {
                            byte[] b = new byte[BUF];
                            int n;
                            while ((n = in.read(b)) != -1) {
                                account(n);
                                sz.write(b, 0, n);
                            }
                        } finally {
                            in.close();
                        }
                        files++;
                    }
                    sz.closeArchiveEntry();
                }
                sz.finish();
            } finally {
                sz.close();
            }
        }
    }
}
