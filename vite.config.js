// vite.config.js — src/ is the real source now; www/ is build OUTPUT, not hand-edited source.
// capacitor.config.json's webDir stays "www" unchanged — Vite just writes there instead of a
// person typing files there directly. Root cause this exists for: browsers cannot resolve bare
// npm-package specifiers (e.g. `import { X } from '@capacitor/filesystem'`) on their own — only a
// bundler or a hand-authored import map can. Every file in this project that imports a Capacitor
// plugin needs this; there is no bundler-free alternative once npm packages beyond your own
// relative files are involved.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: '', // relative asset paths — this loads from a file:// -style WebView root, not a web server path
  build: {
    outDir: '../www',
    emptyOutDir: true, // www/ is fully regenerated each build — never hand-edit files there anymore
    sourcemap: false // keep the shipped bundle from including source maps in a release build
  }
});
