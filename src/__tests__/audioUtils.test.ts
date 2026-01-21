import { describe, it, expect } from 'vitest';
import { combineAudioChunks, float32ToWavFile, float32ToWavBuffer } from '../utils/audioUtils';

describe('combineAudioChunks', () => {
  it('should combine multiple Float32Arrays into one', () => {
    const chunk1 = new Float32Array([1, 2, 3]);
    const chunk2 = new Float32Array([4, 5, 6]);
    const chunk3 = new Float32Array([7, 8, 9]);

    const result = combineAudioChunks([chunk1, chunk2, chunk3]);

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(9);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('should return empty Float32Array when given empty array', () => {
    const result = combineAudioChunks([]);

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it('should handle single chunk', () => {
    const chunk = new Float32Array([1, 2, 3, 4, 5]);

    const result = combineAudioChunks([chunk]);

    expect(result.length).toBe(5);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle chunks of different sizes', () => {
    const chunk1 = new Float32Array([1]);
    const chunk2 = new Float32Array([2, 3, 4, 5, 6]);
    const chunk3 = new Float32Array([7, 8]);

    const result = combineAudioChunks([chunk1, chunk2, chunk3]);

    expect(result.length).toBe(8);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('should handle empty chunks in the array', () => {
    const chunk1 = new Float32Array([1, 2]);
    const emptyChunk = new Float32Array([]);
    const chunk2 = new Float32Array([3, 4]);

    const result = combineAudioChunks([chunk1, emptyChunk, chunk2]);

    expect(result.length).toBe(4);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it('should preserve floating point values', () => {
    const chunk1 = new Float32Array([0.5, -0.5, 0.123456]);
    const chunk2 = new Float32Array([-0.999, 0.001]);

    const result = combineAudioChunks([chunk1, chunk2]);

    expect(result.length).toBe(5);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(-0.5);
    expect(result[2]).toBeCloseTo(0.123456);
    expect(result[3]).toBeCloseTo(-0.999);
    expect(result[4]).toBeCloseTo(0.001);
  });
});

describe('float32ToWavFile', () => {
  it('should create a File object with correct type', () => {
    const samples = new Float32Array([0.5, -0.5, 0.25, -0.25]);

    const result = float32ToWavFile(samples);

    expect(result).toBeInstanceOf(File);
    expect(result.type).toBe('audio/wav');
  });

  it('should create a file with correct name pattern', () => {
    const samples = new Float32Array([0.1, 0.2]);

    const result = float32ToWavFile(samples);

    expect(result.name).toMatch(/^audio-chunk-\d+\.wav$/);
  });

  it('should create correct WAV header size (44 bytes header + data)', () => {
    const samples = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const expectedSize = 44 + samples.length * 2; // 44 byte header + 2 bytes per sample (16-bit)

    const result = float32ToWavFile(samples);

    expect(result.size).toBe(expectedSize);
  });

  it('should handle empty samples array', () => {
    const samples = new Float32Array([]);
    const expectedSize = 44; // Just the header

    const result = float32ToWavFile(samples);

    expect(result.size).toBe(expectedSize);
    expect(result.type).toBe('audio/wav');
  });
});

describe('float32ToWavBuffer', () => {
  it('should use default sample rate of 44100 when not specified', () => {
    const samples = new Float32Array([0.5]);

    const view = float32ToWavBuffer(samples);

    // Sample rate is at byte offset 24 (little-endian uint32)
    const sampleRate = view.getUint32(24, true);
    expect(sampleRate).toBe(44100);
  });

  it('should use custom sample rate when specified', () => {
    const samples = new Float32Array([0.5]);
    const customSampleRate = 48000;

    const view = float32ToWavBuffer(samples, customSampleRate);

    const sampleRate = view.getUint32(24, true);
    expect(sampleRate).toBe(customSampleRate);
  });

  it('should have correct RIFF header', () => {
    const samples = new Float32Array([0.5, -0.5]);

    const view = float32ToWavBuffer(samples);

    // Check "RIFF" at offset 0
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    expect(riff).toBe('RIFF');

    // Check "WAVE" at offset 8
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(wave).toBe('WAVE');
  });

  it('should have correct fmt subchunk', () => {
    const samples = new Float32Array([0.5]);

    const view = float32ToWavBuffer(samples);

    // Check "fmt " at offset 12
    const fmt = String.fromCharCode(
      view.getUint8(12),
      view.getUint8(13),
      view.getUint8(14),
      view.getUint8(15)
    );
    expect(fmt).toBe('fmt ');

    // Subchunk1Size (16 for PCM)
    expect(view.getUint32(16, true)).toBe(16);

    // AudioFormat (1 = PCM)
    expect(view.getUint16(20, true)).toBe(1);

    // NumChannels (1 = mono)
    expect(view.getUint16(22, true)).toBe(1);

    // BitsPerSample (16)
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('should have correct data subchunk header', () => {
    const samples = new Float32Array([0.5, -0.5, 0.25]);

    const view = float32ToWavBuffer(samples);

    // Check "data" at offset 36
    const data = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39)
    );
    expect(data).toBe('data');

    // Subchunk2Size (samples.length * 2)
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('should clamp values outside -1 to 1 range', () => {
    // Values outside the -1 to 1 range should be clamped
    const samples = new Float32Array([2.0, -2.0, 1.5, -1.5]);

    const view = float32ToWavBuffer(samples);

    // Read 16-bit samples starting at offset 44
    const sample1 = view.getInt16(44, true);
    const sample2 = view.getInt16(46, true);
    const sample3 = view.getInt16(48, true);
    const sample4 = view.getInt16(50, true);

    // Clamped to max positive (0x7FFF = 32767)
    expect(sample1).toBe(32767);
    // Clamped to max negative (-0x8000 = -32768)
    expect(sample2).toBe(-32768);
    // Also clamped
    expect(sample3).toBe(32767);
    expect(sample4).toBe(-32768);
  });

  it('should correctly convert sample values', () => {
    const samples = new Float32Array([0.0, 1.0, -1.0, 0.5, -0.5]);

    const view = float32ToWavBuffer(samples);

    // Read 16-bit samples starting at offset 44
    const sample0 = view.getInt16(44, true); // 0.0
    const sample1 = view.getInt16(46, true); // 1.0
    const sample2 = view.getInt16(48, true); // -1.0
    const sample3 = view.getInt16(50, true); // 0.5
    const sample4 = view.getInt16(52, true); // -0.5

    // 0.0 should map to 0
    expect(sample0).toBe(0);
    // 1.0 should map to 32767 (0x7FFF)
    expect(sample1).toBe(32767);
    // -1.0 should map to -32768 (-0x8000)
    expect(sample2).toBe(-32768);
    // 0.5 should map to approximately 16383
    expect(sample3).toBeGreaterThan(16000);
    expect(sample3).toBeLessThan(17000);
    // -0.5 should map to approximately -16384
    expect(sample4).toBeLessThan(-16000);
    expect(sample4).toBeGreaterThan(-17000);
  });

  it('should create correct buffer size', () => {
    const samples = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const expectedSize = 44 + samples.length * 2; // 44 byte header + 2 bytes per sample

    const view = float32ToWavBuffer(samples);

    expect(view.byteLength).toBe(expectedSize);
  });

  it('should handle empty samples array', () => {
    const samples = new Float32Array([]);

    const view = float32ToWavBuffer(samples);

    expect(view.byteLength).toBe(44); // Just the header
    // Data size should be 0
    expect(view.getUint32(40, true)).toBe(0);
  });
});
