import { describe, it, expect, afterEach, vi } from "vitest";
import { encodePcmToOpus } from "./opusEncoder";

// Minimal stand-in for opus-recorder's encoderWorker: replies "ready" to init,
// and on "done" emits page(s) then "done" — the real protocol.
type Handler = ((e: { data: unknown }) => void) | null;

class MockWorker {
  static instances: MockWorker[] = [];
  static behavior: "ok" | "empty" | "error" = "ok";
  onmessage: Handler = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: any[] = [];
  terminated = false;

  constructor(public url: string) {
    MockWorker.instances.push(this);
  }
  postMessage(msg: any) {
    this.posted.push(msg);
    if (msg.command === "init") {
      if (MockWorker.behavior === "error") {
        queueMicrotask(() => this.onerror?.({ message: "boom" }));
        return;
      }
      queueMicrotask(() => this.onmessage?.({ data: { message: "ready" } }));
    } else if (msg.command === "getHeaderPages") {
      // OpusHead/OpusTags header pages ("OggS" magic), emitted before audio.
      if (MockWorker.behavior === "ok") {
        queueMicrotask(() =>
          this.onmessage?.({ data: { message: "page", page: new Uint8Array([79, 103, 103, 83]) } })
        );
      }
    } else if (msg.command === "done") {
      queueMicrotask(() => {
        if (MockWorker.behavior === "ok") {
          this.onmessage?.({ data: { message: "page", page: new Uint8Array([1, 2, 3, 4]) } });
        }
        this.onmessage?.({ data: { message: "done" } });
      });
    }
  }
  terminate() { this.terminated = true; }
}

afterEach(() => {
  MockWorker.instances = [];
  MockWorker.behavior = "ok";
  vi.unstubAllGlobals();
});

describe("encodePcmToOpus", () => {
  it("drives init→encode→done and returns a complete Opus File", async () => {
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
    const pcm = new Float32Array([0.1, -0.2, 0.3]);

    const file = await encodePcmToOpus(pcm, {
      sampleRate: 16000,
      workerUrl: "chrome-extension://x/opus-encoder-worker.js",
      fileName: "audio-chunk-1.opus",
    });

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("audio-chunk-1.opus");
    expect(file.type).toContain("opus");
    expect(file.size).toBe(8); // header page (4B) + audio page (4B)

    const w = MockWorker.instances[0];
    expect(w.url).toBe("chrome-extension://x/opus-encoder-worker.js");
    const init = w.posted.find((m) => m.command === "init");
    expect(init).toMatchObject({
      encoderSampleRate: 16000,
      originalSampleRate: 16000,
      numberOfChannels: 1,
    });
    // Header pages must be requested before encoding, or the Opus stream is
    // headerless and decoders reject it as corrupted.
    const order = w.posted.map((m) => m.command);
    expect(order.indexOf("getHeaderPages")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("getHeaderPages")).toBeLessThan(order.indexOf("encode"));
    const encode = w.posted.find((m) => m.command === "encode");
    expect(encode.buffers[0]).toBe(pcm);
    expect(w.posted.some((m) => m.command === "done")).toBe(true);
    expect(w.terminated).toBe(true); // worker cleaned up
  });

  it("rejects when the encoder produces no data", async () => {
    MockWorker.behavior = "empty";
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);

    await expect(
      encodePcmToOpus(new Float32Array([0]), {
        sampleRate: 16000,
        workerUrl: "u",
      })
    ).rejects.toThrow(/no data/i);
  });

  it("rejects on worker error", async () => {
    MockWorker.behavior = "error";
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);

    await expect(
      encodePcmToOpus(new Float32Array([0]), { sampleRate: 16000, workerUrl: "u" })
    ).rejects.toThrow(/worker error/i);
  });
});
