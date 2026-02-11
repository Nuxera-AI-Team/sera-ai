import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mockMediaDevices, MockMediaStream, mockFetch } from './setup';

// Hoisted mock functions for the converter
const mockConverterFns = vi.hoisted(() => ({
  createHL7DictationRequest: vi.fn(() => {
    const formData = new FormData();
    formData.append('audio', new Blob(['audio']), 'dictation.wav');
    formData.append('hl7_request', new Blob(['hl7 message']), 'dictation_request.hl7');
    return formData;
  }),
  createFHIRDictationRequest: vi.fn(() => {
    const formData = new FormData();
    formData.append('audio', new Blob(['audio']), 'dictation.wav');
    formData.append('fhir_request', new Blob(['fhir bundle']), 'dictation_request.json');
    return formData;
  }),
  convertDictationResponse: vi.fn((data: any) => ({
    dictation: data?.dictation || 'converted dictation text',
    sessionId: data?.sessionId || 'mock-session',
    confidence: 0.95,
    language: 'en-US',
  })),
}));

vi.mock('../hooks/useHL7FHIRConverter', () => ({
  default: () => ({
    createHL7DictationRequest: mockConverterFns.createHL7DictationRequest,
    createFHIRDictationRequest: mockConverterFns.createFHIRDictationRequest,
    convertDictationResponse: mockConverterFns.convertDictationResponse,
    convertTranscriptionResponse: vi.fn(),
    conversionError: null,
    clearError: vi.fn(),
    isConverting: false,
    createHL7TranscriptionRequest: vi.fn(),
    createFHIRTranscriptionRequest: vi.fn(),
    convertHL7DictationToJson: vi.fn(),
    convertFHIRDictationToJson: vi.fn(),
  }),
}));

import useAudioDictation from '../hooks/useAudioDictation';

describe('useAudioDictation', () => {
  const defaultProps = {
    onDictationComplete: vi.fn(),
    onDictationStart: vi.fn(),
    onProcessingStart: vi.fn(),
    onError: vi.fn(),
    apiKey: 'test-api-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMediaDevices.getUserMedia.mockResolvedValue(new MockMediaStream());

    // Reset fetch mock with dictation response
    (mockFetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === 'content-type') return 'application/json';
            return null;
          },
        },
        json: () =>
          Promise.resolve({
            dictation: 'Patient has chronic headache',
            sessionId: 'dict-session-1',
          }),
        text: () => Promise.resolve(''),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state values', () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      expect(result.current.isDictating).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.dictationError).toBeNull();
    });

    it('should expose all expected methods', () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      expect(typeof result.current.startDictating).toBe('function');
      expect(typeof result.current.stopDictating).toBe('function');
    });
  });

  describe('startDictating', () => {
    it('should request microphone access', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    it('should set isDictating to true on success', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(result.current.isDictating).toBe(true);
    });

    it('should call onDictationStart callback', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(defaultProps.onDictationStart).toHaveBeenCalled();
    });

    it('should clear previous errors when starting', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      // The dictationError should be null at start
      expect(result.current.dictationError).toBeNull();

      await act(async () => {
        await result.current.startDictating();
      });

      expect(result.current.dictationError).toBeNull();
    });

    it('should set error when getUserMedia fails', async () => {
      mockMediaDevices.getUserMedia.mockRejectedValue(new Error('Permission denied'));

      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(result.current.isDictating).toBe(false);
      expect(result.current.dictationError).toBe('An error occurred while starting dictation');
      expect(defaultProps.onError).toHaveBeenCalledWith('An error occurred while starting dictation');
    });
  });

  describe('stopDictating', () => {
    it('should set isDictating to false', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      // Start dictating first
      await act(async () => {
        await result.current.startDictating();
      });

      expect(result.current.isDictating).toBe(true);

      await act(async () => {
        await result.current.stopDictating();
      });

      expect(result.current.isDictating).toBe(false);
    });

    it('should handle case when no audio data is available', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      // Call stopDictating without starting (no audio data)
      await act(async () => {
        await result.current.stopDictating();
      });

      expect(result.current.isDictating).toBe(false);
      expect(result.current.dictationError).toBe('No audio data to process');
      expect(defaultProps.onError).toHaveBeenCalledWith('No audio data to process');
    });
  });

  describe('format options', () => {
    it('should work with json format (default)', () => {
      const props = { ...defaultProps, selectedFormat: 'json' as const };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should work with hl7 format', () => {
      const props = { ...defaultProps, selectedFormat: 'hl7' as const };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should work with fhir format', () => {
      const props = { ...defaultProps, selectedFormat: 'fhir' as const };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });
  });

  describe('optional props', () => {
    it('should work with minimal required props', () => {
      const minimalProps = {
        onDictationComplete: vi.fn(),
      };
      const { result } = renderHook(() => useAudioDictation(minimalProps));

      expect(result.current.isDictating).toBe(false);
      expect(result.current.dictationError).toBeNull();
    });

    it('should accept custom apiBaseUrl', () => {
      const props = { ...defaultProps, apiBaseUrl: 'https://custom.api.com' };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should accept appendMode option', () => {
      const props = { ...defaultProps, appendMode: false };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should accept doctorName option', () => {
      const props = { ...defaultProps, doctorName: 'Dr. Smith' };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should accept patientId option', () => {
      const props = { ...defaultProps, patientId: 'patient-123' };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should accept sessionId option', () => {
      const props = { ...defaultProps, sessionId: 'session-456' };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should accept language option', () => {
      const props = { ...defaultProps, language: 'en-US' };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });

    it('should accept specialty option', () => {
      const props = { ...defaultProps, specialty: 'neurology' };
      const { result } = renderHook(() => useAudioDictation(props));

      expect(result.current.dictationError).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on unmount', async () => {
      const { result, unmount } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });

    it('should clean up even when not recording on unmount', () => {
      const { unmount } = renderHook(() => useAudioDictation(defaultProps));

      expect(() => unmount()).not.toThrow();
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

    it('should set up the audio pipeline on startDictating', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(result.current.isDictating).toBe(true);
      expect(capturedProcessor).not.toBeNull();
      expect(capturedProcessor!.port.onmessage).not.toBeNull();
    });

    it('should send stop command to processor on stopDictating', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(capturedProcessor).not.toBeNull();

      await act(async () => {
        await result.current.stopDictating();
      });

      expect(capturedProcessor!.port.postMessage).toHaveBeenCalledWith({
        command: 'stop',
      });
    });

    it('should accumulate audio samples from processor messages', async () => {
      const { result } = renderHook(() => useAudioDictation(defaultProps));

      await act(async () => {
        await result.current.startDictating();
      });

      expect(capturedProcessor).not.toBeNull();

      // Simulate audio data arriving
      const audioData = new Float32Array([0.1, 0.2, 0.3]);
      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'audioData',
            audioBuffer: audioData.buffer,
          },
        });
      });

      // The hook should accumulate samples internally
      // We verify it didn't throw
      expect(result.current.isDictating).toBe(true);
    });
  });
});
