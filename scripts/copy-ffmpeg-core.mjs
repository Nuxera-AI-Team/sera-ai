// Copy the ffmpeg-wasm core into dist/ffmpeg so the package ships it.
//
// Hosts that run under a strict CSP (an MV3 browser extension, where remote
// script loading is blocked) can't fetch the core from a CDN. They copy these
// files out of node_modules/sera-ai/dist/ffmpeg into their own bundle and pass
// the local URL as `corePath` to useAudioRecorder. Runs from tsup's onSuccess.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "node_modules", "@ffmpeg", "core", "dist");
const outDir = join(root, "dist", "ffmpeg");

const FILES = ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"];

if (!existsSync(srcDir)) {
  console.error(
    `[copy-ffmpeg-core] @ffmpeg/core not found at ${srcDir}. Is it installed?`
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const file of FILES) {
  const from = join(srcDir, file);
  if (!existsSync(from)) {
    console.warn(`[copy-ffmpeg-core] skipping missing ${file}`);
    continue;
  }
  copyFileSync(from, join(outDir, file));
  copied++;
}

console.log(`[copy-ffmpeg-core] copied ${copied}/${FILES.length} core file(s) to dist/ffmpeg`);
