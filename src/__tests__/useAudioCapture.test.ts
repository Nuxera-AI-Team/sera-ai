import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mockMediaDevices, MockMediaStream } from './setup';

// Hoisted mock functions
const mockFFmpegFns = vi.hoisted(() => ({
  removeSilence: vi.fn((file: File) => Promise.resolve(file)),
  loadFFmpeg: vi.fn(() => Promise.resolve(true)),
  convertToWav: vi.fn((_audioData: Float32Array, _sampleRate: number, fileName?: string) =>
    Promise.resolve(new File(['mock-wav'], fileName || 'recording.wav', { type: 'audio/wav' }))
  ),
  convertToFlac: vi.fn((_wavFile: File) =>
    Promise.resolve(new File(['mock-flac'], 'audio.flac', { type: 'audio/flac' }))
  ),
}));

// Mock the FFmpeg converter dependency
vi.mock('../hooks/useFFmpegConverter', () => ({
  default: () => ({
    removeSilence: mockFFmpegFns.removeSilence,
    isLoaded: true,
    ffmpegLoaded: true,
    isConverting: false,
    loadFFmpeg: mockFFmpegFns.loadFFmpeg,
    progress: 0,
    statusMessage: '',
    convertToWav: mockFFmpegFns.convertToWav,
    convertToFlac: mockFFmpegFns.convertToFlac,
  }),
}));

import useAudioCapture from '../hooks/useAudioCapture';

describe('useAudioCapture', () => {
  const defaultProps = {
    onAudioChunk: vi.fn(),
    onAudioComplete: vi.fn(),
    onAudioFile: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMediaDevices.enumerateDevices.mockResolvedValue([
      {
        deviceId: 'mock-device-id',
        kind: 'audioinput',
        label: 'Mock Microphone',
        groupId: 'mock-group-id',
        toJSON: () => ({}),
      },
    ]);

    mockMediaDevices.getUserMedia.mockResolvedValue(new MockMediaStream());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state values', () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.currentDeviceId).toBeNull();
      expect(result.current.availableDevices).toEqual([]);
      expect(result.current.audioLevel).toBe(0);
      expect(result.current.noAudioDetected).toBe(false);
      expect(result.current.isConverting).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.statusMessage).toBe('');
      expect(result.current.recordingDuration).toBe(0);
      expect(result.current.totalChunks).toBe(0);
    });

    it('should expose all expected methods', () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      expect(typeof result.current.startRecording).toBe('function');
      expect(typeof result.current.stopRecording).toBe('function');
      expect(typeof result.current.pauseRecording).toBe('function');
      expect(typeof result.current.resumeRecording).toBe('function');
      expect(typeof result.current.selectMicrophone).toBe('function');
      expect(typeof result.current.validateMicrophoneAccess).toBe('function');
    });

    it('should expose mediaStreamRef', () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      expect(result.current.mediaStreamRef).toBeDefined();
      expect(result.current.mediaStreamRef.current).toBeNull();
    });
  });

  describe('validateMicrophoneAccess', () => {
    it('should return true when microphone access is granted', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = false;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(true);
      expect(mockMediaDevices.enumerateDevices).toHaveBeenCalled();
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalled();
    });

    it('should populate availableDevices', async () => {
      const mockDevices = [
        {
          deviceId: 'device-1',
          kind: 'audioinput',
          label: 'Mic 1',
          groupId: 'group-1',
          toJSON: () => ({}),
        },
        {
          deviceId: 'device-2',
          kind: 'audioinput',
          label: 'Mic 2',
          groupId: 'group-2',
          toJSON: () => ({}),
        },
      ];
      mockMediaDevices.enumerateDevices.mockResolvedValue(mockDevices);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.availableDevices).toHaveLength(2);
    });

    it('should set currentDeviceId after validation', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.currentDeviceId).toBe('mock-device-id');
    });

    it('should return false when no microphones found', async () => {
      mockMediaDevices.enumerateDevices.mockResolvedValue([]);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('No microphone');
    });

    it('should handle NotFoundError', async () => {
      const notFoundError = new Error('No devices');
      notFoundError.name = 'NotFoundError';
      mockMediaDevices.getUserMedia.mockRejectedValue(notFoundError);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('No microphone devices found');
    });

    it('should handle NotAllowedError', async () => {
      const permError = new Error('Permission denied');
      permError.name = 'NotAllowedError';
      mockMediaDevices.getUserMedia.mockRejectedValue(permError);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Microphone permission denied');
    });

    it('should handle NotReadableError', async () => {
      const busyError = new Error('Device busy');
      busyError.name = 'NotReadableError';
      mockMediaDevices.getUserMedia.mockRejectedValue(busyError);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Microphone is busy');
    });

    it('should handle OverconstrainedError', async () => {
      const constraintError = new Error('Constraints not met');
      constraintError.name = 'OverconstrainedError';
      mockMediaDevices.getUserMedia.mockRejectedValue(constraintError);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Selected microphone device is not available');
    });

    it('should handle generic Error', async () => {
      const genericError = new Error('Something went wrong');
      mockMediaDevices.getUserMedia.mockRejectedValue(genericError);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Something went wrong');
    });

    it('should handle non-Error thrown values', async () => {
      mockMediaDevices.getUserMedia.mockRejectedValue('string error');

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toBe('Microphone access error occurred.');
    });

    it('should filter only audioinput devices', async () => {
      const mixedDevices = [
        { deviceId: 'a1', kind: 'audioinput', label: 'Mic', groupId: 'g1', toJSON: () => ({}) },
        { deviceId: 'v1', kind: 'videoinput', label: 'Cam', groupId: 'g2', toJSON: () => ({}) },
        { deviceId: 'a2', kind: 'audiooutput', label: 'Speaker', groupId: 'g3', toJSON: () => ({}) },
      ];
      mockMediaDevices.enumerateDevices.mockResolvedValue(mixedDevices);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.availableDevices).toHaveLength(1);
      expect(result.current.availableDevices[0].kind).toBe('audioinput');
    });
  });

  describe('selectMicrophone', () => {
    it('should update currentDeviceId', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.selectMicrophone('new-device-id');
      });

      expect(result.current.currentDeviceId).toBe('new-device-id');
    });

    it('should not restart recording when not recording', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      expect(result.current.isRecording).toBe(false);

      await act(async () => {
        await result.current.selectMicrophone('new-device-id');
      });

      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('pauseRecording', () => {
    it('should not change state when not recording', () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      act(() => {
        result.current.pauseRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('resumeRecording', () => {
    it('should not change state when not paused', () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      act(() => {
        result.current.resumeRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('stopRecording', () => {
    it('should be callable when not recording without error', () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      act(() => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('startRecording', () => {
    it('should validate microphone access before starting', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });

      expect(mockMediaDevices.enumerateDevices).toHaveBeenCalled();
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalled();
    });

    it('should not start recording when validation fails', async () => {
      mockMediaDevices.enumerateDevices.mockResolvedValue([]);

      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toContain('No microphone');
    });

    it('should clear previous errors when starting', async () => {
      // First cause an error
      mockMediaDevices.enumerateDevices.mockResolvedValue([]);
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.error).not.toBeNull();

      // Reset mocks and start again
      mockMediaDevices.enumerateDevices.mockResolvedValue([
        { deviceId: 'mock-device-id', kind: 'audioinput', label: 'Mic', groupId: 'g1', toJSON: () => ({}) },
      ]);
      mockMediaDevices.getUserMedia.mockResolvedValue(new MockMediaStream());

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.error).toBeNull();
    });

    it('should request audio with correct constraints including device ID', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      // Select a specific device first
      await act(async () => {
        await result.current.selectMicrophone('specific-device-id');
      });

      await act(async () => {
        await result.current.startRecording();
      });

      const calls = mockMediaDevices.getUserMedia.mock.calls;
      const recordingCall = calls[calls.length - 1];

      expect(recordingCall[0].audio).toEqual(
        expect.objectContaining({
          deviceId: { exact: 'specific-device-id' },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })
      );
    });
  });

  describe('custom options', () => {
    it('should accept silenceRemoval option', () => {
      const props = { ...defaultProps, silenceRemoval: true };
      const { result } = renderHook(() => useAudioCapture(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept chunkDuration option', () => {
      const props = { ...defaultProps, chunkDuration: 15 };
      const { result } = renderHook(() => useAudioCapture(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept wav format option', () => {
      const props = { ...defaultProps, format: 'wav' as const };
      const { result } = renderHook(() => useAudioCapture(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept raw format option', () => {
      const props = { ...defaultProps, format: 'raw' as const };
      const { result } = renderHook(() => useAudioCapture(props));

      expect(result.current.error).toBeNull();
    });

    it('should work without any callbacks', () => {
      const { result } = renderHook(() => useAudioCapture({}));

      expect(result.current.error).toBeNull();
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('audio processing pipeline', () => {
    let capturedProcessor: {
      port: {
        postMessage: ReturnType<typeof vi.fn>;
        onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
      };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    } | null;
    let OriginalAudioWorkletNode: typeof globalThis.AudioWorkletNode;

    beforeEach(() => {
      capturedProcessor = null;
      OriginalAudioWorkletNode = globalThis.AudioWorkletNode;

      (globalThis as any).AudioWorkletNode = class {
        port = {
          postMessage: vi.fn(),
          onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        };
        connect = vi.fn();
        disconnect = vi.fn();
        constructor() {
          capturedProcessor = this as any;
        }
      };
    });

    afterEach(() => {
      (globalThis as any).AudioWorkletNode = OriginalAudioWorkletNode;
    });

    it('should process audio chunks from the worklet', async () => {
      const onAudioChunk = vi.fn();
      const { result } = renderHook(() =>
        useAudioCapture({ onAudioChunk })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);
      expect(capturedProcessor).not.toBeNull();

      // Simulate chunk message from worklet
      const audioData = new Float32Array([0.5, 0.3, 0.1]);
      await act(async () => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'chunk',
            audioBuffer: audioData.buffer,
          },
        });
      });

      await waitFor(() => {
        expect(onAudioChunk).toHaveBeenCalledTimes(1);
      });

      // Verify the callback received the correct arguments
      expect(onAudioChunk).toHaveBeenCalledWith(
        expect.any(Float32Array),
        0, // sequence number
        false, // isFinal
        44100, // sampleRate from mock AudioContext
      );
    });

    it('should handle audioLevel messages from the worklet', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });

      expect(capturedProcessor).not.toBeNull();

      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'audioLevel',
            level: 0.75,
          },
        });
      });

      expect(result.current.audioLevel).toBe(0.75);
    });

    it('should handle noAudioDetected messages', async () => {
      const { result } = renderHook(() => useAudioCapture(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });

      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'noAudioDetected',
            message: 'No audio input detected',
          },
        });
      });

      expect(result.current.noAudioDetected).toBe(true);
      expect(result.current.error).toBe('No audio input detected');
    });

    it('should increment totalChunks for each chunk received', async () => {
      const { result } = renderHook(() => useAudioCapture({ onAudioChunk: vi.fn() }));

      await act(async () => {
        await result.current.startRecording();
      });

      const audioData = new Float32Array([0.5]);

      await act(async () => {
        capturedProcessor!.port.onmessage!({
          data: { command: 'chunk', audioBuffer: audioData.buffer },
        });
      });

      await waitFor(() => {
        expect(result.current.totalChunks).toBe(1);
      });

      await act(async () => {
        capturedProcessor!.port.onmessage!({
          data: { command: 'chunk', audioBuffer: audioData.buffer },
        });
      });

      await waitFor(() => {
        expect(result.current.totalChunks).toBe(2);
      });
    });
  });
});
