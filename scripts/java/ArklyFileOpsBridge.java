package __PACKAGE__;

import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

// Copy and move for the File explorer (patch-fileops.js, Decision 222). Reachable from the app's own page only, as
// window.ArklyFileOps. One job at a time on a background thread, polled with status(); streamed, with progress and cancel.
// Nothing is ever overwritten: a taken name gets " (1)", " (2)", ... A move on the same storage is a rename; across storages it is
// a copy, and each original is removed only after its copy is complete. Links are skipped, never followed or created.
public class ArklyFileOpsBridge {
    private static final int BUF = 65536;
    private static final long RESERVE = 32L * 1024 * 1024;
    private static final long CHECK_EVERY = 8L * 1024 * 1024;
    private static final int MAX_FILES = 500000;
    static final String TRASH = ".arkly-trash";

    // Test hook: pretend a rename never works, as across two storages.
    static boolean noRename = false;

    private final Map<String, Job> jobs = new ConcurrentHashMap<String, Job>();
    private final AtomicInteger seq = new AtomicInteger();

    // op: "copy" or "move". pathsCsv: URL-encoded absolute paths, comma separated. Returns a job id, or "" when the arguments are
    // unusable or another job is still running.
    @JavascriptInterface
    public String start(String op, String destDir, String pathsCsv) {
        try {
            boolean move = "move".equals(op);
            if (!move && !"copy".equals(op)) {
                return "";
            }
            File dest = new File(destDir);
            if (!dest.isDirectory()) {
                return "";
            }
            List<File> sources = new ArrayList<File>();
            for (String part : (pathsCsv == null ? "" : pathsCsv).split(",")) {
                String p = URLDecoder.decode(part, "UTF-8");
                if (p.length() > 0) {
                    sources.add(new File(p));
                }
            }
            if (sources.isEmpty()) {
                return "";
            }
            for (Job j : jobs.values()) {
                if ("running".equals(j.state)) {
                    return "";
                }
            }
            String id = "o" + seq.incrementAndGet();
            Job job = new Job(move, dest, sources);
            jobs.put(id, job);
            Thread t = new Thread(job, "arkly-fileops");
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
            return "{\"state\":\"error\",\"code\":\"gone\",\"message\":\"The job is no longer known.\"}";
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

    // name, name (1), name (2), ... For a file the number goes before the last extension; a folder keeps its whole name.
    static File uniqueIn(File dir, String name, boolean isDir) {
        File f = new File(dir, name);
        if (!f.exists()) {
            return f;
        }
        int dot = name.lastIndexOf('.');
        String stem = !isDir && dot > 0 ? name.substring(0, dot) : name;
        String ext = !isDir && dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 10000; i++) {
            f = new File(dir, stem + " (" + i + ")" + ext);
            if (!f.exists()) {
                return f;
            }
        }
        return new File(dir, stem + " (" + System.nanoTime() + ")" + ext);
    }

    // A link is never followed: its canonical path differs from where it sits.
    static boolean isLink(File f) throws IOException {
        File parent = f.getParentFile();
        File probe = parent == null ? f : new File(parent.getCanonicalFile(), f.getName());
        return !probe.getCanonicalFile().equals(probe.getAbsoluteFile());
    }

    // Anything at or under a folder named .arkly-trash (the explorer's trash) is off limits as a source and as a destination.
    static boolean inTrash(File f) throws IOException {
        for (String seg : f.getCanonicalPath().split("/")) {
            if (seg.equals(TRASH)) {
                return true;
            }
        }
        return false;
    }

    static boolean inside(File child, File ancestor) throws IOException {
        String c = child.getCanonicalPath() + File.separator;
        String a = ancestor.getCanonicalPath() + File.separator;
        return c.startsWith(a);
    }

    static void deleteTree(File f) {
        try {
            if (f.isDirectory() && !isLink(f)) {
                File[] kids = f.listFiles();
                if (kids != null) {
                    for (File k : kids) {
                        deleteTree(k);
                    }
                }
            }
        } catch (IOException e) {
            // fall through: delete the entry itself
        }
        f.delete();
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

    static class Job implements Runnable {
        private final boolean move;
        private final File dest;
        private final List<File> sources;
        volatile String state = "running";
        volatile String code = "";
        volatile String message = "";
        volatile String current = "";
        volatile boolean cancelled = false;
        volatile int items = 0;       // top-level items finished
        volatile int failed = 0;
        volatile int skipped = 0;     // links
        volatile long bytes = 0;
        volatile long bytesTotal = 0;
        private long lastCheck = 0;
        private int fileCount = 0;
        private final long startFree;

        Job(boolean move, File dest, List<File> sources) {
            this.move = move;
            this.dest = dest;
            this.sources = sources;
            this.startFree = dest.getUsableSpace();
        }

        String json() {
            return "{\"state\":\"" + state + "\",\"code\":\"" + esc(code) + "\",\"message\":\"" + esc(message) + "\",\"items\":" + items
                    + ",\"total\":" + sources.size() + ",\"failed\":" + failed + ",\"skipped\":" + skipped + ",\"bytes\":" + bytes
                    + ",\"bytesTotal\":" + bytesTotal + ",\"current\":\"" + esc(current) + "\"}";
        }

        @Override
        public void run() {
            try {
                if (inTrash(dest)) {
                    throw new Fail("protected", "Nothing can be copied or moved into the trash folder.");
                }
                if (!move) {
                    for (File s : sources) {
                        bytesTotal += sizeOf(s);
                    }
                    needSpace(bytesTotal);
                }
                for (File s : sources) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    current = s.getName();
                    try {
                        one(s);
                        items++;
                    } catch (Cancel c) {
                        throw c;
                    } catch (Fail f) {
                        if ("space".equals(f.code)) {
                            throw f;
                        }
                        failed++;
                        if (message.length() == 0) {
                            message = f.getMessage();
                        }
                    } catch (IOException e) {
                        failed++;
                        if (message.length() == 0) {
                            message = e.getMessage() == null ? "An item could not be copied." : e.getMessage();
                        }
                    }
                }
                current = "";
                state = "done";
            } catch (Cancel c) {
                state = "cancelled";
            } catch (Fail f) {
                code = f.code;
                message = f.getMessage();
                state = "error";
            } catch (Throwable e) {
                code = "io";
                message = e instanceof OutOfMemoryError ? "Not enough memory." : (e.getMessage() == null ? "The job failed." : e.getMessage());
                state = "error";
            }
        }

        private void needSpace(long need) throws Fail {
            if (need > startFree - RESERVE) {
                throw new Fail("space", "There is not enough free space on the destination.");
            }
        }

        // ---- one top-level item ----

        private void one(File src) throws IOException {
            if (!src.exists()) {
                throw new Fail("missing", "\"" + src.getName() + "\" no longer exists.");
            }
            if (inTrash(src)) {
                throw new Fail("protected", "The trash folder cannot be copied or moved.");
            }
            if (isLink(src)) {
                skipped++;
                return;
            }
            if (src.isDirectory() && inside(dest, src)) {
                throw new Fail("inside", "\"" + src.getName() + "\" cannot go into itself.");
            }
            if (move && src.getParentFile() != null && src.getParentFile().getCanonicalFile().equals(dest.getCanonicalFile())) {
                return; // already there
            }
            File target = uniqueIn(dest, src.getName(), src.isDirectory());
            if (move && !noRename && src.renameTo(target)) {
                return;
            }
            if (move) { // another storage: copy, then remove the original once the copy is whole
                long size = sizeOf(src);
                bytesTotal += size;
                needSpace(bytes + size);
            }
            boolean ok = false;
            try {
                copyTree(src, target);
                ok = true;
            } finally {
                if (!ok) {
                    deleteTree(target); // a failed or cancelled item leaves no half copy
                }
            }
            if (move) {
                deleteTree(src);
                if (src.exists()) {
                    failed++;
                    if (message.length() == 0) {
                        message = "\"" + src.getName() + "\" was copied, but the original could not be removed.";
                    }
                }
            }
        }

        private long sizeOf(File f) throws IOException {
            if (isLink(f)) {
                return 0;
            }
            if (f.isFile()) {
                return f.length();
            }
            long total = 0;
            File[] kids = f.listFiles();
            if (kids != null) {
                for (File k : kids) {
                    if (cancelled) {
                        throw new Cancel();
                    }
                    if (++fileCount > MAX_FILES) {
                        throw new Fail("entries", "There are too many files to copy in one go.");
                    }
                    total += sizeOf(k);
                }
            }
            return total;
        }

        private void copyTree(File src, File target) throws IOException {
            if (cancelled) {
                throw new Cancel();
            }
            if (isLink(src)) {
                skipped++;
                return;
            }
            if (src.isDirectory()) {
                if (!target.mkdir() && !target.isDirectory()) {
                    throw new Fail("io", "Could not create the folder \"" + target.getName() + "\".");
                }
                File[] kids = src.listFiles();
                if (kids != null) {
                    for (File k : kids) {
                        copyTree(k, new File(target, k.getName()));
                    }
                }
                target.setLastModified(src.lastModified());
                return;
            }
            current = src.getName();
            InputStream in = new FileInputStream(src);
            try {
                OutputStream out = new FileOutputStream(target);
                try {
                    byte[] b = new byte[BUF];
                    int n;
                    while ((n = in.read(b)) != -1) {
                        if (cancelled) {
                            throw new Cancel();
                        }
                        out.write(b, 0, n);
                        bytes += n;
                        if (bytes - lastCheck > CHECK_EVERY) {
                            lastCheck = bytes;
                            needSpace(bytes);
                        }
                    }
                } finally {
                    out.close();
                }
            } finally {
                in.close();
            }
            target.setLastModified(src.lastModified());
        }
    }
}
