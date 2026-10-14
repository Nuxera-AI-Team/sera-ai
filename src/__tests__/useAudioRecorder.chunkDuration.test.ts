import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveChunkDurationMs,
  DEFAULT_CHUNK_DURATION_MS,
} from "../hooks/useAudioRecorder";

/**
 * The chunk interval is the one thing a server cannot correct after the fact:
 * it receives whatever the timer produced. A host passing a bad value must
 * still end up recording at a sane cadence rather than not chunking at all.
 */
describe("resolveChunkDurationMs", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("defaults when the host says nothing, without warning", () => {
    expect(resolveChunkDurationMs(undefined)).toBe(DEFAULT_CHUNK_DURATION_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults to 47s, the cadence the recorder has always used", () => {
    expect(DEFAULT_CHUNK_DURATION_MS).toBe(47_000);
  });

  it("passes an in-range value through untouched, without warning", () => {
    expect(resolveChunkDurationMs(30_000)).toBe(30_000);
    expect(resolveChunkDurationMs(47_000)).toBe(47_000);
    expect(warn).not.toHaveBeenCalled();
  });

  // A host reading this from an env var gets a string through an unchecked
  // Number(), and an unset var yields NaN. Chunking every NaN milliseconds
  // means never chunking, so the whole recording would arrive as one upload at
  // the end — or not at all.
  it("defaults rather than trusting NaN", () => {
    expect(resolveChunkDurationMs(Number("not-a-number"))).toBe(
      DEFAULT_CHUNK_DURATION_MS
    );
  });

  it("defaults on zero and negatives", () => {
    expect(resolveChunkDurationMs(0)).toBe(DEFAULT_CHUNK_DURATION_MS);
    expect(resolveChunkDurationMs(-5_000)).toBe(DEFAULT_CHUNK_DURATION_MS);
  });

  it("defaults on Infinity", () => {
    expect(resolveChunkDurationMs(Infinity)).toBe(DEFAULT_CHUNK_DURATION_MS);
  });

  it("warns when an unusable value is replaced by the default", () => {
    resolveChunkDurationMs(NaN);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // The server accepts at most 120 chunks per session, so a 10s interval
  // would stop capturing a consultation at 20 minutes.
  it("clamps below the floor so 120 chunks still cover an hour", () => {
    expect(resolveChunkDurationMs(10_000)).toBe(30_000);
    expect(resolveChunkDurationMs(29_999)).toBe(30_000);
  });

  it("clamps above the ceiling instead of risking minutes of audio per upload", () => {
    expect(resolveChunkDurationMs(600_000)).toBe(120_000);
    expect(resolveChunkDurationMs(120_001)).toBe(120_000);
  });

  it("warns when the value is clamped", () => {
    resolveChunkDurationMs(10_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("10000");
  });

  it("keeps the exact boundary values", () => {
    expect(resolveChunkDurationMs(30_000)).toBe(30_000);
    expect(resolveChunkDurationMs(120_000)).toBe(120_000);
    expect(warn).not.toHaveBeenCalled();
  });
});
