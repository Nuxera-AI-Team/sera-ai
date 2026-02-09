import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted mock functions for @ffmpeg/ffmpeg
const mockFFmpegFns = vi.hoisted(() => ({
  mockFFmpegRun: vi.fn(() => Promise.resolve()),
  mockFFmpegLoad: vi.fn(() => Promise.resolve()),
  mockFFmpegFS: vi.fn((operation: string, _filename?: string, _data?: any) => {
    if (operation === 'readFile') {
      return new Uint8Array([0, 1, 2, 3, 4, 5]);
    }
  }),
  mockFetchFile: vi.fn(() => Promise.resolve(new Uint8Array([0, 1, 2]))),
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  createFFmpeg: vi.fn(() => ({
    load: mockFFmpegFns.mockFFmpegLoad,
    run: mockFFmpegFns.mockFFmpegRun,
    FS: mockFFmpegFns.mockFFmpegFS,
    isLoaded: vi.fn(() => true),
  })),
  fetchFile: mockFFmpegFns.mockFetchFile,
}));

// Mock Worker class for the WAV conversion worker
class MockConversionWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(data: any) {
    if (data.type === 'convertWav') {
      // Simulate progress messages
      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: 'progress',
            data: { progress: 50, message: 'Processing...' },
          },
        } as any);
      }, 0);

      // Simulate completion
      setTimeout(() => {
        const sampleRate = data.options?.sampleRate || 44100;
        const audioBuffer = data.audioBuffer;
        const float32 = new Float32Array(audioBuffer);
        const wavBuffer = new ArrayBuffer(44 + float32.length * 2);

        this.onmessage?.({
          data: {
            type: 'complete',
            data: {
              buffer: wavBuffer,
              size: wavBuffer.byteLength,
              duration: float32.length / sampleRate,
            },
          },
        } as any);
      }, 10);
    } else if (data.type === 'init') {
      setTimeout(() => {
        this.onmessage?.({
          data: { type: 'ready' },
        } as any);
      }, 0);
    }
  }

  terminate() {}
}

// Must come after vi.mock
import useFFmpegConverter from '../hooks/useFFmpegConverter';

describe('useFFmpegConverter', () => {
  let OriginalWorker: typeof globalThis.Worker;

  beforeEach(() => {
    vi.clearAllMocks();
    OriginalWorker = globalThis.Worker;
    (globalThis as any).Worker = MockConversionWorker;
  });

  afterEach(() => {
    (globalThis as any).Worker = OriginalWorker;
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useFFmpegConverter());

      expect(result.current.isLoaded).toBe(true);
      expect(result.current.isConverting).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBeNull();
      expect(result.current.statusMessage).toBe('');
    });

    it('should expose all expected methods', () => {
      const { result } = renderHook(() => useFFmpegConverter());

      expect(typeof result.current.loadFFmpeg).toBe('function');
      expect(typeof result.current.convertToWav).toBe('function');
      expect(typeof result.current.convertToFlac).toBe('function');
      expect(typeof result.current.removeSilence).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });

    it('should expose ffmpeg and ffmpegLoaded properties', () => {
      const { result } = renderHook(() => useFFmpegConverter());

      // ffmpeg may be null initially (module-level singleton)
      expect('ffmpeg' in result.current).toBe(true);
      expect('ffmpegLoaded' in result.current).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const { result } = renderHook(() => useFFmpegConverter());

      act(() => {
        result.current.reset();
      });

      expect(result.current.isConverting).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.error).toBeNull();
      expect(result.current.statusMessage).toBe('');
    });
  });

  describe('convertToWav', () => {
    it('should convert Float32Array to WAV file using worker', async () => {
      const { result } = renderHook(() => useFFmpegConverter());

      const audioData = new Float32Array([0.5, -0.5, 0.25, -0.25]);
      let wavFile: File | null = null;

      await act(async () => {
        wavFile = await result.current.convertToWav(audioData, 44100, 'test.wav');
      });

      expect(wavFile).not.toBeNull();
      expect(wavFile!).toBeInstanceOf(File);
      expect(wavFile!.name).toBe('test.wav');
      expect(wavFile!.type).toBe('audio/wav');
    });

    it('should use default filename when not provided', async () => {
      const { result } = renderHook(() => useFFmpegConverter());

      const audioData = new Float32Array([0.1, 0.2]);
      let wavFile: File | null = null;

      await act(async () => {
        wavFile = await result.current.convertToWav(audioData, 44100);
      });

      expect(wavFile).not.toBeNull();
      expect(wavFile!.name).toBe('recording.wav');
    });

    it('should set error state when worker reports error', async () => {
      // Override Worker to simulate error
      (globalThis as any).Worker = class {
        onmessage: any = null;
        onerror: any = null;

        postMessage() {
          setTimeout(() => {
            this.onmessage?.({
              data: {
                type: 'error',
                error: 'Conversion failed in worker',
              },
            });
          }, 0);
        }

        terminate() {}
      };

      const { result } = renderHook(() => useFFmpegConverter());
      const audioData = new Float32Array([0.5]);

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.convertToWav(audioData, 44100);
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Conversion failed in worker');
      expect(result.current.error).toBe('Conversion failed in worker');
      expect(result.current.isConverting).toBe(false);
    });
  });

  describe('removeSilence', () => {
    it('should return null when no file is provided', async () => {
      const { result } = renderHook(() => useFFmpegConverter());

      let processedFile: File | null = null;
      await act(async () => {
        processedFile = await result.current.removeSilence(null as any);
      });

      expect(processedFile).toBeNull();
      expect(result.current.error).toBe('No file provided for processing');
    });

    it('should return original file when file exceeds 50MB', async () => {
      const { result } = renderHook(() => useFFmpegConverter());

      // Create a mock file that reports large size
      const largeFile = new File(['x'], 'large.wav', { type: 'audio/wav' });
      Object.defineProperty(largeFile, 'size', { value: 60 * 1024 * 1024 }); // 60MB

      let processedFile: File | null = null;
      await act(async () => {
        processedFile = await result.current.removeSilence(largeFile);
      });

      expect(processedFile).toBe(largeFile);
    });
  });

  describe('loadFFmpeg', () => {
    it('should be a callable function', () => {
      const { result } = renderHook(() => useFFmpegConverter());
      expect(typeof result.current.loadFFmpeg).toBe('function');
    });
  });

  describe('convertToFlac', () => {
    it('should be a callable function', () => {
      const { result } = renderHook(() => useFFmpegConverter());
      expect(typeof result.current.convertToFlac).toBe('function');
    });
  });
});
