#!/usr/bin/env node
// Turns on code shrinking and renaming (R8) for the release build (Decision 259). android/ is never committed, so CI writes it here.
//
// 1. android/app/build.gradle: release buildType gets `minifyEnabled true`. Resource shrinking stays off: notification icons and
//    tones are looked up by name, which the resource shrinker cannot see.
// 2. android/app/proguard-rules.pro: replaced with the rules below, once (marker line). They keep what is reached by name or
//    annotation at run time: Capacitor plugins and their methods, the window.Arkly* bridges, the database engine, the Cordova layer.
//    Third-party warnings about optional classes are silenced; nothing here reaches the network.
// Idempotent. To go back, remove this step from build-android.yml.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'android', 'app');
const GRADLE = process.env.PATCH_GRADLE || path.join(ROOT, 'build.gradle');
const RULES = process.env.PATCH_RULES || path.join(ROOT, 'proguard-rules.pro');
const MARK = '# arkly-r8';

const die = (msg) => { console.error(`patch-r8.js: ${msg}`); process.exit(1); };
if (!fs.existsSync(GRADLE)) die(`${GRADLE} not found — did "cap add android" run first?`);

let gradle = fs.readFileSync(GRADLE, 'utf8');
if (/minifyEnabled\s+true/.test(gradle)) {
  console.log('patch-r8.js: minifyEnabled already true.');
} else {
  const re = /(buildTypes\s*\{\s*release\s*\{[^}]*?)minifyEnabled\s+false/;
  if (!re.test(gradle)) die('no release buildType with minifyEnabled false in build.gradle — template changed, aborting.');
  gradle = gradle.replace(re, '$1minifyEnabled true');
  if (!/minifyEnabled\s+true/.test(gradle)) die('minifyEnabled did not apply — aborting.');
  fs.writeFileSync(GRADLE, gradle, 'utf8');
}

const rules = `${MARK}
# Read by name or annotation at run time: keep.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor core, the Cordova layer it carries, and every plugin class and method the web side calls.
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod <methods>; }
-keepclassmembers class * { @com.getcapacitor.annotation.PermissionCallback <methods>; }
-keepclassmembers class * { @com.getcapacitor.annotation.ActivityCallback <methods>; }

# window.Arkly* bridges (File explorer, archive, file operations): called from JavaScript by name.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keep class **.Arkly* { *; }
-keep class * extends android.content.BroadcastReceiver { *; }

# Database engine (encrypted SQLite) and its native glue.
-keep class net.zetetic.** { *; }
-keep class net.sqlcipher.** { *; }
-keep class com.getcapacitor.community.database.sqlite.** { *; }

# Plugin packages that are loaded by class name.
-keep class ee.forgr.** { *; }
-keep class com.codetrixstudio.** { *; }
-keep class com.xitronix.** { *; }
-keep class com.ryltsov.** { *; }
-keep class com.capacitorjs.** { *; }

# Archive libraries: optional classes they mention are not shipped.
-dontwarn org.apache.commons.compress.**
-dontwarn org.tukaani.**
-dontwarn net.lingala.**
-dontwarn com.github.junrar.**
-dontwarn org.slf4j.**
-dontwarn org.brotli.**
-dontwarn com.github.luben.**
-dontwarn org.objectweb.asm.**
-dontwarn org.osgi.**
-dontwarn javax.annotation.**
-dontwarn kotlin.**
-ignorewarnings
`;
const current = fs.existsSync(RULES) ? fs.readFileSync(RULES, 'utf8') : '';
if (!current.includes(MARK)) fs.writeFileSync(RULES, rules, 'utf8');
console.log('patch-r8.js: release build shrinks and renames; keep rules written.');
