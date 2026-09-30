import { describe, it, expect } from "vitest";
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
  it("defaults when the host says nothing", () => {
    expect(resolveChunkDurationMs(undefined)).toBe(DEFAULT_CHUNK_DURATION_MS);
  });

  it("defaults to 30s, matching useAudioCapture", () => {
    expect(DEFAULT_CHUNK_DURATION_MS).toBe(30_000);
  });

  it("passes an in-range value through untouched", () => {
    expect(resolveChunkDurationMs(30_000)).toBe(30_000);
    expect(resolveChunkDurationMs(47_000)).toBe(47_000);
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

  // Clamped rather than rejected: refusing to record is a worse answer than
  // recording at the nearest usable cadence.
  it("clamps below the floor instead of firing every few hundred ms", () => {
    expect(resolveChunkDurationMs(100)).toBe(10_000);
    expect(resolveChunkDurationMs(9_999)).toBe(10_000);
  });

  it("clamps above the ceiling instead of risking minutes of audio per upload", () => {
    expect(resolveChunkDurationMs(600_000)).toBe(120_000);
    expect(resolveChunkDurationMs(120_001)).toBe(120_000);
  });

  it("keeps the exact boundary values", () => {
    expect(resolveChunkDurationMs(10_000)).toBe(10_000);
    expect(resolveChunkDurationMs(120_000)).toBe(120_000);
  });

  // Start and resume both read the resolved value, so the same input must
  // always give the same output — a resumed consultation chunking differently
  // from its first half would split the transcript at a different cadence.
  it("is deterministic", () => {
    const a = resolveChunkDurationMs(45_000);
    const b = resolveChunkDurationMs(45_000);
    expect(a).toBe(b);
  });
});
