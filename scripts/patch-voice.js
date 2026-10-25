#!/usr/bin/env node
// Noise reduction for the voice recorder (Decision 281). cap-voice-rec always records from AudioSource.MIC and its
// startRecording() reads no audio-source option. This patches the plugin source in node_modules so that
// startRecording({ noiseReduction: true }) records from AudioSource.VOICE_COMMUNICATION, which turns on the phone's own
// noise suppression where the device has it. No option, or false, records from MIC exactly as before.
//
// 1. CustomMediaRecorder.java: a static flag and the audio source chosen from it.
// 2. VoiceRecorder.java: startRecording() reads `noiseReduction` from the call and sets the flag before the recorder is built.
// Idempotent. Fails loudly if the plugin source no longer has the lines it expects. To go back, remove this step from build-android.yml.
const fs = require('fs');
const path = require('path');

const DIR = process.env.PATCH_VOICE_DIR ||
  path.join(__dirname, '..', 'node_modules', 'cap-voice-rec', 'android', 'src', 'main', 'java', 'com', 'xitronix', 'capacitorvoicerecorder');
const REC = path.join(DIR, 'CustomMediaRecorder.java');
const PLUGIN = path.join(DIR, 'VoiceRecorder.java');
const MARK = 'arkly-noise-reduction';

const die = (msg) => { console.error(`patch-voice.js: ${msg}`); process.exit(1); };
for (const f of [REC, PLUGIN]) if (!fs.existsSync(f)) die(`${f} not found — did "npm ci" run, and did the plugin layout change?`);

let rec = fs.readFileSync(REC, 'utf8');
if (rec.includes(MARK)) {
  console.log('patch-voice.js: CustomMediaRecorder.java already patched.');
} else {
  const cls = 'public class CustomMediaRecorder {\n';
  const src = 'mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);';
  if (!rec.includes(cls) || !rec.includes(src)) die('CustomMediaRecorder.java: expected class line or setAudioSource(MIC) not found — plugin changed, aborting.');
  rec = rec.replace(cls, `${cls}\n    // ${MARK}\n    private static boolean noiseReduction = false;\n\n    public static void setNoiseReduction(boolean on) {\n        noiseReduction = on;\n    }\n`);
  rec = rec.replace(src, 'mediaRecorder.setAudioSource(noiseReduction ? MediaRecorder.AudioSource.VOICE_COMMUNICATION : MediaRecorder.AudioSource.MIC);');
  if (!rec.includes('VOICE_COMMUNICATION')) die('CustomMediaRecorder.java: patch did not apply — aborting.');
  fs.writeFileSync(REC, rec, 'utf8');
  console.log('patch-voice.js: CustomMediaRecorder.java patched.');
}

let plugin = fs.readFileSync(PLUGIN, 'utf8');
if (plugin.includes(MARK)) {
  console.log('patch-voice.js: VoiceRecorder.java already patched.');
} else {
  const build = 'mediaRecorder = new CustomMediaRecorder(getContext());';
  if (plugin.split(build).length !== 2) die('VoiceRecorder.java: expected exactly one "new CustomMediaRecorder(getContext())" — plugin changed, aborting.');
  plugin = plugin.replace(build, `// ${MARK}\n            CustomMediaRecorder.setNoiseReduction(Boolean.TRUE.equals(call.getBoolean("noiseReduction", false)));\n            ${build}`);
  if (!plugin.includes('setNoiseReduction')) die('VoiceRecorder.java: patch did not apply — aborting.');
  fs.writeFileSync(PLUGIN, plugin, 'utf8');
  console.log('patch-voice.js: VoiceRecorder.java patched.');
}
