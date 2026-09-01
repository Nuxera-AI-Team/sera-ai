// Copy the worker assets the package must ship as loadable files:
//   - AudioWorklet processor + WAV encoder worker (src/workers) → dist/workers
//   - Opus encoder worker (from opus-recorder)                  → dist/workers/opus-encoder-worker.js
//
// Hosts under a strict CSP (an MV3 browser extension) load these from packaged
// chrome-extension:// URLs. Runs from tsup's onSuccess.
//
// NOTE: the ffmpeg-wasm core is intentionally NOT shipped — web hosts use the
// CDN default (see useFFmpegConverter), and the extension runs without ffmpeg.
// Bundling the 24 MB core in the npm package was dead weight for both.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "dist", "workers");

mkdirSync(outDir, { recursive: true });

/** Copy one file into dist/workers; exit non-zero if a required source is missing. */
function copy(from, toName, required) {
  if (!existsSync(from)) {
    if (required) {
      console.error(`[copy-runtime-assets] missing required asset: ${from}`);
      process.exit(1);
    }
    console.warn(`[copy-runtime-assets] skipping missing ${from}`);
    return 0;
  }
  copyFileSync(from, join(outDir, toName));
  return 1;
}

let copied = 0;
copied += copy(join(root, "src", "workers", "audio-processor.js"), "audio-processor.js", true);
copied += copy(join(root, "src", "workers", "wav-encoder.js"), "wav-encoder.js", true);
copied += copy(
  join(root, "node_modules", "opus-recorder", "dist", "encoderWorker.min.js"),
  "opus-encoder-worker.js",
  true
);

console.log(`[copy-runtime-assets] copied ${copied} worker file(s) to dist/workers`);
