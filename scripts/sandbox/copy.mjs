// Makes the .pptx copy of an old .ppt, as the app does. Usage: node copy.mjs in.ppt out.pptx
import fs from 'fs';
const SRC = process.env.SRC || '/home/claude/repo/src/js';
const { readPpt } = await import(`${SRC}/office-ppt.js`); const { pptToPptx } = await import(`${SRC}/office-convert.js`);
const r = pptToPptx(readPpt(new Uint8Array(fs.readFileSync(process.argv[2])))); fs.writeFileSync(process.argv[3], r.bytes);
console.log('bytes', r.bytes.length, r.warnings);
