// Copy runtime assets the package must ship as loadable files:
//   - the ffmpeg-wasm core            → dist/ffmpeg
//   - the AudioWorklet + WAV worker    → dist/workers
//
// Hosts under a strict CSP (an MV3 browser extension) can't load these from a
// CDN or from blob: URLs. They copy these files into their own bundle and pass
// the local URLs (corePath / workletUrl / wavWorkerUrl) to useAudioRecorder.
// Runs from tsup's onSuccess.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function copyFiles(label, srcDir, outDir, files, failIfMissingDir) {
  if (!existsSync(srcDir)) {
    if (failIfMissingDir) {
      console.error(`[copy-assets] ${label}: source not found at ${srcDir}`);
      process.exit(1);
    }
    console.warn(`[copy-assets] ${label}: source not found at ${srcDir}, skipping`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const file of files) {
    const from = join(srcDir, file);
    if (!existsSync(from)) {
      console.warn(`[copy-assets] ${label}: skipping missing ${file}`);
      continue;
    }
    copyFileSync(from, join(outDir, file));
    copied++;
  }
  console.log(`[copy-assets] ${label}: copied ${copied}/${files.length} file(s) to ${outDir.replace(root + "/", "")}`);
}

// ffmpeg-wasm core (from the installed @ffmpeg/core package)
copyFiles(
  "ffmpeg-core",
  join(root, "node_modules", "@ffmpeg", "core", "dist"),
  join(root, "dist", "ffmpeg"),
  ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"],
  true
);

// AudioWorklet + WAV worker (standalone source files, shipped verbatim)
copyFiles(
  "workers",
  join(root, "src", "workers"),
  join(root, "dist", "workers"),
  ["audio-processor.js", "wav-encoder.js"],
  true
);
