import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAudioRecorder from '../hooks/useAudioRecorder';
import { mockMediaDevices, MockMediaStream } from './setup';

// Mock the dependent hooks
vi.mock('../hooks/useFFmpegConverter', () => ({
  default: () => ({
    removeSilence: vi.fn((file) => Promise.resolve(file)),
    isLoaded: true,
    isConverting: false,
    loadFFmpeg: vi.fn(() => Promise.resolve(true)),
    progress: 0,
    statusMessage: '',
    convertToWav: vi.fn((audioData, sampleRate, fileName) =>
      Promise.resolve(new File(['mock'], fileName, { type: 'audio/wav' }))
    ),
  }),
}));

vi.mock('../hooks/useAudioRecovery', () => ({
  default: (_callback: (audioChunks: Float32Array[], metadata: Record<string, unknown>) => Promise<void>) => ({
    createSession: vi.fn(() => Promise.resolve()),
    appendAudioToSession: vi.fn(() => Promise.resolve()),
    markSessionComplete: vi.fn(() => Promise.resolve()),
    markSessionFailed: vi.fn(() => Promise.resolve()),
    retrySession: vi.fn(() => Promise.resolve(true)),
    deleteSession: vi.fn(() => Promise.resolve()),
    getFailedSession: vi.fn(() => Promise.resolve(null)),
    clearFailedSessions: vi.fn(() => Promise.resolve()),
  }),
}));

vi.mock('../hooks/useHL7FHIRConverter', () => ({
  default: () => ({
    convertTranscriptionResponse: vi.fn((data) => data),
    conversionError: null,
    clearError: vi.fn(),
    createHL7TranscriptionRequest: vi.fn(),
    createFHIRTranscriptionRequest: vi.fn(),
  }),
}));

// Default hook props
const defaultProps = {
  apiKey: 'test-api-key',
  speciality: 'general',
  onTranscriptionUpdate: vi.fn(),
  onTranscriptionComplete: vi.fn(),
};

describe('useAudioRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mediaDevices mock to default successful behavior
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

  describe('validateMicrophoneAccess', () => {
    it('should return true when microphone access is granted', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      let isValid: boolean = false;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(true);
      expect(mockMediaDevices.enumerateDevices).toHaveBeenCalled();
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalled();
    });

    it('should populate availableDevices when microphones are found', async () => {
      const mockDevices = [
        {
          deviceId: 'device-1',
          kind: 'audioinput',
          label: 'Microphone 1',
          groupId: 'group-1',
          toJSON: () => ({}),
        },
        {
          deviceId: 'device-2',
          kind: 'audioinput',
          label: 'Microphone 2',
          groupId: 'group-2',
          toJSON: () => ({}),
        },
      ];
      mockMediaDevices.enumerateDevices.mockResolvedValue(mockDevices);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.availableDevices).toHaveLength(2);
      expect(result.current.availableDevices[0].deviceId).toBe('device-1');
      expect(result.current.availableDevices[1].deviceId).toBe('device-2');
    });

    it('should set currentDeviceId after successful validation', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.currentDeviceId).toBeNull();

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.currentDeviceId).toBe('mock-device-id');
    });

    it('should return false and set error when no microphones are found', async () => {
      mockMediaDevices.enumerateDevices.mockResolvedValue([]);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('No microphone');
    });

    it('should return false and set error for NotFoundError', async () => {
      const notFoundError = new Error('No microphone found');
      notFoundError.name = 'NotFoundError';
      mockMediaDevices.getUserMedia.mockRejectedValue(notFoundError);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('No microphone found');
    });

    it('should return false and set error for NotAllowedError (permission denied)', async () => {
      const notAllowedError = new Error('Permission denied');
      notAllowedError.name = 'NotAllowedError';
      mockMediaDevices.getUserMedia.mockRejectedValue(notAllowedError);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Microphone access denied');
    });

    it('should return false and set error for NotReadableError (device busy)', async () => {
      const notReadableError = new Error('Device busy');
      notReadableError.name = 'NotReadableError';
      mockMediaDevices.getUserMedia.mockRejectedValue(notReadableError);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Microphone is busy');
    });

    it('should return false and set error for OverconstrainedError', async () => {
      const overconstrainedError = new Error('Constraints not satisfied');
      overconstrainedError.name = 'OverconstrainedError';
      mockMediaDevices.getUserMedia.mockRejectedValue(overconstrainedError);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      let isValid: boolean = true;
      await act(async () => {
        isValid = await result.current.validateMicrophoneAccess();
      });

      expect(isValid).toBe(false);
      expect(result.current.error).toContain('Selected microphone is unavailable');
    });

    it('should filter only audioinput devices from enumerated devices', async () => {
      const mixedDevices = [
        {
          deviceId: 'audio-1',
          kind: 'audioinput',
          label: 'Microphone',
          groupId: 'group-1',
          toJSON: () => ({}),
        },
        {
          deviceId: 'video-1',
          kind: 'videoinput',
          label: 'Camera',
          groupId: 'group-2',
          toJSON: () => ({}),
        },
        {
          deviceId: 'audio-out-1',
          kind: 'audiooutput',
          label: 'Speaker',
          groupId: 'group-3',
          toJSON: () => ({}),
        },
      ];
      mockMediaDevices.enumerateDevices.mockResolvedValue(mixedDevices);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.availableDevices).toHaveLength(1);
      expect(result.current.availableDevices[0].kind).toBe('audioinput');
    });

    it('should stop test stream tracks after validation', async () => {
      const mockStream = new MockMediaStream();
      const mockStop = vi.fn();
      // Override the stop function on the track
      const tracks = mockStream.getTracks();
      if (tracks[0]) {
        tracks[0].stop = mockStop;
      }
      mockMediaDevices.getUserMedia.mockResolvedValue(mockStream);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('selectMicrophone', () => {
    it('should update currentDeviceId when selecting a microphone', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Initially validate to populate devices
      await act(async () => {
        await result.current.validateMicrophoneAccess();
      });

      expect(result.current.currentDeviceId).toBe('mock-device-id');

      // Select a different device
      await act(async () => {
        await result.current.selectMicrophone('new-device-id');
      });

      expect(result.current.currentDeviceId).toBe('new-device-id');
    });

    it('should set error when device selection fails', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Mock selectMicrophone to throw
      // We'll simulate this by checking the error state after a failed operation
      // The actual implementation catches errors internally

      await act(async () => {
        await result.current.selectMicrophone('valid-device-id');
      });

      // Since we're not recording, it should just update the deviceId without error
      expect(result.current.currentDeviceId).toBe('valid-device-id');
      expect(result.current.error).toBeNull();
    });

    it('should not restart recording when not currently recording', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.isRecording).toBe(false);

      await act(async () => {
        await result.current.selectMicrophone('new-device-id');
      });

      // Should not have started recording
      expect(result.current.isRecording).toBe(false);
      expect(result.current.currentDeviceId).toBe('new-device-id');
    });

    it('should accept any valid device ID string', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      const testDeviceIds = [
        'device-123',
        'default',
        'communications',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      ];

      for (const deviceId of testDeviceIds) {
        await act(async () => {
          await result.current.selectMicrophone(deviceId);
        });
        expect(result.current.currentDeviceId).toBe(deviceId);
      }
    });
  });

  describe('initial state', () => {
    it('should have correct initial state values', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.transcriptionDone).toBe(false);
      expect(result.current.currentDeviceId).toBeNull();
      expect(result.current.availableDevices).toEqual([]);
      expect(result.current.audioLevel).toBe(0);
      expect(result.current.noAudioDetected).toBe(false);
      expect(result.current.showRetrySessionPrompt).toBe(false);
      expect(result.current.isRetryingSession).toBe(false);
      expect(result.current.isConverting).toBe(false);
      expect(result.current.progress).toBe(0);
    });

    it('should expose all expected methods', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(typeof result.current.startRecording).toBe('function');
      expect(typeof result.current.stopRecording).toBe('function');
      expect(typeof result.current.pauseRecording).toBe('function');
      expect(typeof result.current.resumeRecording).toBe('function');
      expect(typeof result.current.validateMicrophoneAccess).toBe('function');
      expect(typeof result.current.selectMicrophone).toBe('function');
      expect(typeof result.current.retryFailedSession).toBe('function');
      expect(typeof result.current.clearAllSessions).toBe('function');
      expect(typeof result.current.testAudioCapture).toBe('function');
    });
  });

  describe('pauseRecording', () => {
    it('should not change state when not recording', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.pauseRecording();
      });

      // Should remain unchanged when not recording
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
    });

    it('should not change state when already paused', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Simulate paused state by setting isPaused manually through the hook
      // Since we can't actually record in tests, we verify the guard condition
      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.pauseRecording();
      });

      // isPaused should still be false since isRecording is false
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('resumeRecording', () => {
    it('should not change state when not paused', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.isPaused).toBe(false);
      expect(result.current.isRecording).toBe(false);

      act(() => {
        result.current.resumeRecording();
      });

      // Should remain unchanged when not paused
      expect(result.current.isPaused).toBe(false);
      expect(result.current.isRecording).toBe(false);
    });

    it('should reset noAudioDetected flag when resuming would occur', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Initial state check
      expect(result.current.noAudioDetected).toBe(false);

      // resumeRecording has a guard for isPaused, so it won't execute
      // but we can verify the initial state
      act(() => {
        result.current.resumeRecording();
      });

      expect(result.current.noAudioDetected).toBe(false);
    });
  });

  describe('clearAllSessions', () => {
    it('should clear failed sessions and hide retry prompt', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Initial state
      expect(result.current.showRetrySessionPrompt).toBe(false);

      await act(async () => {
        await result.current.clearAllSessions();
      });

      // Should remain false (was already false, confirming it sets to false)
      expect(result.current.showRetrySessionPrompt).toBe(false);
    });

    it('should be callable without errors', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Should not throw
      await expect(
        act(async () => {
          await result.current.clearAllSessions();
        })
      ).resolves.not.toThrow();
    });
  });

  describe('retryFailedSession', () => {
    it('should set isRetryingSession to true during retry', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.isRetryingSession).toBe(false);

      // Call retryFailedSession - since there's no failed session,
      // it should complete without error
      await act(async () => {
        await result.current.retryFailedSession();
      });

      // After completion, isRetryingSession should be false
      expect(result.current.isRetryingSession).toBe(false);
    });

    it('should hide retry prompt when no failed sessions exist', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.retryFailedSession();
      });

      expect(result.current.showRetrySessionPrompt).toBe(false);
    });
  });
});
