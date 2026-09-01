// Encode one chunk of Float32 PCM into a complete Ogg Opus file, using
// opus-recorder's encoderWorker (libopus compiled to wasm, embedded in the
// worker script). Each call runs a full init → encode → done cycle, so the
// result is a standalone, independently-decodable .opus file — exactly what the
// stateless per-chunk POST /api/transcribe/v2 needs.
//
// The worker script (encoderWorker.min.js, shipped in dist/workers) is loaded
// from `workerUrl`. Hosts under a strict CSP (an MV3 extension) pass a packaged
// chrome-extension:// URL; the embedded wasm instantiates under
// `wasm-unsafe-eval`. There is no blob: fallback — opus mode requires a
// packaged worker URL.

export interface OpusEncodeOptions {
  /** Sample rate of the captured PCM, in Hz. */
  sampleRate: number;
  /** URL of encoderWorker.min.js (packaged; e.g. chrome.runtime.getURL(...)). */
  workerUrl: string;
  /** Output filename. Defaults to "chunk.opus". */
  fileName?: string;
  /** Opus stream sample rate (8000/12000/16000/24000/48000). Defaults to 16000. */
  encoderSampleRate?: number;
  /** Optional fixed bitrate; omit to let Opus choose (VBR). */
  bitRate?: number;
  /** Encode timeout in ms (safety net so a stuck worker never hangs uploads). */
  timeoutMs?: number;
}

const OPUS_APPLICATION_AUDIO = 2049; // opus-recorder's default application

/**
 * Encode `audioData` (mono Float32 PCM) to a complete Ogg Opus File.
 * Rejects on worker error, empty output, or timeout.
 */
export async function encodePcmToOpus(
  audioData: Float32Array,
  opts: OpusEncodeOptions,
): Promise<File> {
  const encoderSampleRate = opts.encoderSampleRate ?? 16000;
  const fileName = opts.fileName ?? "chunk.opus";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise<File>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(opts.workerUrl);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Failed to create opus encoder worker"));
      return;
    }

    const pages: Uint8Array[] = [];
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* noop */ }
    };
    const succeed = (file: File) => { if (!settled) { settled = true; cleanup(); resolve(file); } };
    const fail = (err: Error) => { if (!settled) { settled = true; cleanup(); reject(err); } };

    const timer = setTimeout(() => fail(new Error("Opus encoding timed out")), timeoutMs);

    worker.onerror = (ev) =>
      fail(new Error(`Opus encoder worker error: ${ev.message || "unknown"}`));

    worker.onmessage = (e: MessageEvent) => {
      const data = (e.data ?? {}) as { message?: string; page?: Uint8Array };
      switch (data.message) {
        case "ready":
          // Emit the OpusHead + OpusTags header pages FIRST (opus-recorder's
          // Recorder does this on start) — without them the Ogg Opus stream has
          // no identification header and decoders reject it as corrupted. Then
          // feed the PCM (single channel) and finalize.
          worker.postMessage({ command: "getHeaderPages" });
          worker.postMessage({ command: "encode", buffers: [audioData] });
          worker.postMessage({ command: "done" });
          break;
        case "page":
          if (data.page) pages.push(data.page);
          break;
        case "done": {
          const total = pages.reduce((n, p) => n + p.length, 0);
          if (total === 0) { fail(new Error("Opus encoding produced no data")); return; }
          const blob = new Blob(pages as BlobPart[], { type: "audio/ogg; codecs=opus" });
          succeed(new File([blob], fileName, { type: "audio/ogg; codecs=opus" }));
          break;
        }
        default:
          // 'flushed' and any other control messages are ignored.
          break;
      }
    };

    // Kick off: the worker replies with { message: "ready" }.
    worker.postMessage({
      command: "init",
      encoderApplication: OPUS_APPLICATION_AUDIO,
      encoderSampleRate,
      originalSampleRate: opts.sampleRate,
      numberOfChannels: 1,
      maxFramesPerPage: 40,
      resampleQuality: 3,
      ...(opts.bitRate ? { encoderBitRate: opts.bitRate } : {}),
    });
  });
}
