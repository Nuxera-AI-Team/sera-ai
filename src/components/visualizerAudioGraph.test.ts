import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createVisualizerAudioGraph } from "./visualizerAudioGraph";

// Minimal stand-ins for the Web Audio nodes the graph touches. Node has no
// Web Audio implementation, so the graph reads `AudioContext` off the global
// at call time and we swap in these fakes.
class FakeAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAnalyser extends FakeAudioNode {
  fftSize = 2048;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static closeBehavior: "resolve" | "reject" | "throw" = "resolve";

  state: "running" | "closed" = "running";
  analyser = new FakeAnalyser();
  source = new FakeAudioNode();
  sourcedFrom: unknown = null;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createAnalyser = vi.fn(() => this.analyser);

  createMediaStreamSource = vi.fn((stream: unknown) => {
    this.sourcedFrom = stream;
    return this.source;
  });

  close = vi.fn(() => {
    if (FakeAudioContext.closeBehavior === "throw") {
      throw new Error("InvalidStateError");
    }
    if (FakeAudioContext.closeBehavior === "reject") {
      return Promise.reject(new Error("InvalidStateError"));
    }
    this.state = "closed";
    return Promise.resolve();
  });
}

const stream = { id: "fake-stream" } as unknown as MediaStream;

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.closeBehavior = "resolve";
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe("createVisualizerAudioGraph", () => {
  it("wires the stream into an analyser at the requested resolution", () => {
    const graph = createVisualizerAudioGraph(stream, 512);
    const ctx = FakeAudioContext.instances[0];

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(ctx.sourcedFrom).toBe(stream);
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(graph.analyser.fftSize).toBe(512);
  });

  it("sizes the frequency buffer to the analyser's bin count", () => {
    const graph = createVisualizerAudioGraph(stream, 512);

    expect(graph.dataArray).toBeInstanceOf(Uint8Array);
    expect(graph.dataArray.length).toBe(graph.analyser.frequencyBinCount);
  });

  it("closes the AudioContext on dispose", async () => {
    const graph = createVisualizerAudioGraph(stream, 512);
    const ctx = FakeAudioContext.instances[0];

    graph.dispose();
    await Promise.resolve();

    expect(ctx.source.disconnect).toHaveBeenCalled();
    expect(ctx.analyser.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe("closed");
  });

  // The visualizer remounts its audio graph on every recording start/stop. A
  // context that outlives its graph is never reclaimed, and browsers cap the
  // number of AudioContexts per document — a long-lived host (a browser
  // extension side panel) would eventually fail to open a new one.
  it("leaves no context open across repeated create/dispose cycles", async () => {
    for (let i = 0; i < 8; i++) {
      createVisualizerAudioGraph(stream, 512).dispose();
    }
    await Promise.resolve();

    expect(FakeAudioContext.instances).toHaveLength(8);
    expect(FakeAudioContext.instances.every((c) => c.state === "closed")).toBe(true);
  });

  it("is idempotent — disposing twice closes once and does not throw", async () => {
    const graph = createVisualizerAudioGraph(stream, 512);
    const ctx = FakeAudioContext.instances[0];

    graph.dispose();
    expect(() => graph.dispose()).not.toThrow();
    await Promise.resolve();

    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("swallows a close() that rejects or throws", async () => {
    FakeAudioContext.closeBehavior = "reject";
    const rejecting = createVisualizerAudioGraph(stream, 512);
    expect(() => rejecting.dispose()).not.toThrow();
    await Promise.resolve();

    FakeAudioContext.closeBehavior = "throw";
    const throwing = createVisualizerAudioGraph(stream, 512);
    expect(() => throwing.dispose()).not.toThrow();
  });
});
