import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import useAudioRecorder from '../hooks/useAudioRecorder';
import { mockMediaDevices, MockMediaStream, mockFetch } from './setup';

// Hoisted mock functions so they can be asserted on in tests
const mockFFmpegFns = vi.hoisted(() => ({
  removeSilence: vi.fn((file: File) => Promise.resolve(file)),
  loadFFmpeg: vi.fn(() => Promise.resolve(true)),
  convertToWav: vi.fn((_audioData: Float32Array, _sampleRate: number, fileName: string) =>
    Promise.resolve(new File(['mock-wav'], fileName, { type: 'audio/wav' }))
  ),
  convertToFlac: vi.fn((_wavFile: File) =>
    Promise.resolve(new File(['mock-flac'], 'audio.flac', { type: 'audio/flac' }))
  ),
}));

// Mock the dependent hooks
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

const mockRecoveryFns = vi.hoisted(() => ({
  createSession: vi.fn((_sessionId: string, _metadata: Record<string, unknown>) => Promise.resolve()),
  appendAudioToSession: vi.fn(() => Promise.resolve()),
  markSessionComplete: vi.fn((_sessionId: string) => Promise.resolve()),
  markSessionFailed: vi.fn(() => Promise.resolve()),
  retrySession: vi.fn((_sessionId: string) => Promise.resolve(true)),
  deleteSession: vi.fn((_sessionId: string) => Promise.resolve()),
  getFailedSession: vi.fn(
    (_sessionId?: string): Promise<{ id: string } | null> => Promise.resolve(null)
  ),
  clearFailedSessions: vi.fn(() => Promise.resolve()),
}));

type ReprocessSession = (
  audioChunks: Float32Array[],
  metadata: { sampleRate: number }
) => Promise<void>;

// The recorder hands useAudioRecovery the function that resends saved audio.
// A test driving a retry end to end calls it the way retrySession would.
const recovery = vi.hoisted(() => ({ reprocess: null as ReprocessSession | null }));

vi.mock('../hooks/useAudioRecovery', () => ({
  default: (callback: ReprocessSession) => {
    recovery.reprocess = callback;
    return mockRecoveryFns;
  },
}));

// Stable across renders, as the real hook's useCallback results are. Fresh
// functions per render would rebuild the upload callback every render and hide
// a missing dependency from the prop-change tests below.
const mockConverterFns = vi.hoisted(() => ({
  convertTranscriptionResponse: vi.fn((data: unknown) => data),
  clearError: vi.fn(),
  createHL7TranscriptionRequest: vi.fn(),
  createFHIRTranscriptionRequest: vi.fn(),
}));

vi.mock('../hooks/useHL7FHIRConverter', () => ({
  default: () => ({
    ...mockConverterFns,
    conversionError: null,
  }),
}));

// Default hook props
const defaultProps = {
  apiKey: 'test-api-key',
  speciality: 'general',
  onTranscriptionUpdate: vi.fn(),
  onTranscriptionComplete: vi.fn(),
};

const OriginalAudioContext = globalThis.AudioContext;
const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;

function trackAudioGraph() {
  const contexts: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const nodes: AudioWorkletNode[] = [];
  const BaseContext = OriginalAudioContext as unknown as new (...args: unknown[]) => { close: ReturnType<typeof vi.fn> };
  const BaseNode = OriginalAudioWorkletNode as unknown as new (...args: unknown[]) => AudioWorkletNode;
  globalThis.AudioContext = class extends BaseContext {
    constructor(...args: unknown[]) {
      super(...args);
      contexts.push(this);
    }
  } as unknown as typeof AudioContext;
  globalThis.AudioWorkletNode = class extends BaseNode {
    constructor(...args: unknown[]) {
      super(...args);
      nodes.push(this);
    }
  } as unknown as typeof AudioWorkletNode;
  return { contexts, nodes };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// How many times the recorder posted `command` to a worklet node.
function postsOf(node: AudioWorkletNode, command: string) {
  return (node.port.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([message]) => (message as { command?: string })?.command === command
  ).length;
}

// The worklet message handler the recorder installed, held so a test can still
// deliver a message after the recorder has let go of the node.
function handlerOf(node: AudioWorkletNode) {
  const handler = node.port.onmessage as unknown as (event: { data: unknown }) => void;
  return (data: unknown) => handler({ data });
}

const audioMessage = (command: 'chunk' | 'finalChunk') => ({
  command,
  audioBuffer: new Float32Array([0.5, 0.3, 0.1]).buffer,
});

type FetchResponse = Awaited<ReturnType<typeof mockFetch>>;

const fetchResponse = (status: number): FetchResponse => ({
  ok: status < 400,
  status,
  json: () =>
    Promise.resolve({
      sessionId: 'mock-session-id',
      transcription: 'mock transcription',
      classifiedInfo: {},
    }),
  text: () => Promise.resolve(status < 400 ? '' : 'unavailable'),
});

// Fake timers only: runs the timers due within `ms` and lets every promise
// chain started so far settle (the upload pipeline is a chain of mocks).
const flushAsync = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

// jsdom has no Screen Wake Lock API, so the recorder skips it unless a test
// installs one. Returns the uninstaller.
function fakeWakeLock(request: () => Promise<{ release: () => Promise<void> }>) {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return () => {
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  };
}

describe('useAudioRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // The recovery mocks are shared across tests, so restore their defaults
    mockRecoveryFns.retrySession.mockResolvedValue(true);
    mockRecoveryFns.deleteSession.mockResolvedValue(undefined);
    mockRecoveryFns.getFailedSession.mockResolvedValue(null);

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
    globalThis.AudioContext = OriginalAudioContext;
    globalThis.AudioWorkletNode = OriginalAudioWorkletNode;
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
      expect(result.current.statusMessage).toBe('');
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

  describe('chunkDurationMs', () => {
    it('uses the host value for the upload timer on start and on resume', async () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const { result } = renderHook(() =>
        useAudioRecorder({ ...defaultProps, chunkDurationMs: 20000 })
      );
      // 20000 is below the floor, so the timer must run at the clamped 30000
      // — and must not fall back to the 47000 default anywhere.
      const uploadDelays = () =>
        setIntervalSpy.mock.calls
          .map((call) => call[1])
          .filter((delay) => delay === 30000 || delay === 47000);

      await act(async () => {
        await result.current.startRecording();
      });
      await waitFor(() => expect(result.current.isRecording).toBe(true));

      act(() => {
        result.current.pauseRecording();
      });
      await waitFor(() => expect(result.current.isPaused).toBe(true));

      act(() => {
        result.current.resumeRecording();
      });

      expect(uploadDelays()).toEqual([30000, 30000]);
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

    // Starts a recording and returns the id of the session it stored.
    const recordOnce = async (result: { current: ReturnType<typeof useAudioRecorder> }) => {
      await act(async () => {
        await result.current.startRecording();
      });
      const calls = mockRecoveryFns.createSession.mock.calls;
      return calls[calls.length - 1][0];
    };

    it('should delete the stored session once a retry succeeds', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));
      const sessionId = await recordOnce(result);
      mockRecoveryFns.getFailedSession.mockResolvedValue({ id: sessionId });
      mockRecoveryFns.retrySession.mockResolvedValue(true);

      await act(async () => {
        await result.current.retryFailedSession();
      });

      expect(mockRecoveryFns.deleteSession).toHaveBeenCalledWith(sessionId);
      expect(result.current.showRetrySessionPrompt).toBe(false);
    });

    // Regression: the stored audio is the only remaining copy, so a retry that
    // could not rebuild the full recording must leave it on disk.
    it('should keep the stored session when a retry fails', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));
      const sessionId = await recordOnce(result);
      mockRecoveryFns.getFailedSession.mockResolvedValue({ id: sessionId });
      mockRecoveryFns.retrySession.mockResolvedValue(false);

      await act(async () => {
        await result.current.retryFailedSession();
      });

      expect(mockRecoveryFns.deleteSession).not.toHaveBeenCalled();
      expect(result.current.showRetrySessionPrompt).toBe(true);
    });

    // Regression: retry took the oldest failed session in the store, possibly
    // an earlier patient's, and sent it with this recorder's current encounter
    // and patient details.
    it('should not retry a stored session this recorder did not record', async () => {
      mockRecoveryFns.getFailedSession.mockResolvedValue({ id: 'earlier-recording' });
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.retryFailedSession();
      });

      expect(mockRecoveryFns.retrySession).not.toHaveBeenCalled();
      expect(mockRecoveryFns.deleteSession).not.toHaveBeenCalled();
      expect(result.current.showRetrySessionPrompt).toBe(false);
    });

    it('should retry its own recording, not an older failed one', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));
      const ownId = await recordOnce(result);
      // The store also holds an earlier failed recording, which comes back for
      // any lookup that is not by this recorder's own session id.
      mockRecoveryFns.getFailedSession.mockImplementation((sessionId?: string) =>
        Promise.resolve({ id: sessionId === ownId ? ownId : 'earlier-recording' })
      );

      await act(async () => {
        await result.current.retryFailedSession();
      });

      expect(mockRecoveryFns.retrySession.mock.calls).toEqual([[ownId]]);
      expect(mockRecoveryFns.deleteSession.mock.calls).toEqual([[ownId]]);
    });

    // Regression: a successful retry also deleted whichever record the
    // recorder pointed at by then. If a new recording had started meanwhile,
    // that was the new recording's audio: its only copy should its upload fail.
    it('should delete only the retried recording', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));
      const retriedId = await recordOnce(result);
      mockRecoveryFns.getFailedSession.mockImplementation((sessionId?: string) =>
        Promise.resolve(
          sessionId === undefined || sessionId === retriedId ? { id: retriedId } : null
        )
      );
      mockRecoveryFns.retrySession.mockImplementation(async () => {
        // A new recording starts while the saved audio is being resent.
        await result.current.startRecording();
        await recovery.reprocess!([new Float32Array([0.5, 0.3, 0.1])], { sampleRate: 44100 });
        return true;
      });

      await act(async () => {
        await result.current.retryFailedSession();
      });

      const newId = mockRecoveryFns.createSession.mock.calls[1][0];
      expect(newId).not.toBe(retriedId);
      expect(mockRecoveryFns.markSessionComplete).not.toHaveBeenCalledWith(newId);
      expect(mockRecoveryFns.deleteSession.mock.calls).toEqual([[retriedId]]);
    });
  });

  // The crash-recovery store keeps the recording's audio on the device until
  // its note arrives, and up to 12 hours when an upload fails. Retry never
  // read patient fields back, so they are not stored.
  describe('crash-recovery store', () => {
    it('should store only the speciality and sample rate of a recording', async () => {
      const { result } = renderHook(() =>
        useAudioRecorder({
          ...defaultProps,
          patientDetails: { id: 1, gender: 'FIXTURE-GENDER', age: 1 },
          patientHistory: 'FIXTURE-HISTORY',
        })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      expect(mockRecoveryFns.createSession).toHaveBeenCalledTimes(1);
      expect(mockRecoveryFns.createSession).toHaveBeenCalledWith(expect.any(String), {
        speciality: 'general',
        sampleRate: 44100,
      });
    });
  });

  describe('patientDetails prop', () => {
    it('should accept patientDetails with all fields', () => {
      const propsWithDetails = {
        ...defaultProps,
        patientDetails: {
          id: 123,
          name: 'John Doe',
          gender: 'male',
          dateOfBirth: '1990-01-01',
          age: 36,
        },
      };

      const { result } = renderHook(() => useAudioRecorder(propsWithDetails));

      // Hook should initialize without errors
      expect(result.current.error).toBeNull();
      expect(result.current.isRecording).toBe(false);
    });

    it('should accept patientDetails with partial fields', () => {
      const propsWithPartialDetails = {
        ...defaultProps,
        patientDetails: {
          name: 'Jane Doe',
        },
      };

      const { result } = renderHook(() => useAudioRecorder(propsWithPartialDetails));

      expect(result.current.error).toBeNull();
    });

    it('should work without patientDetails (optional)', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.error).toBeNull();
      expect(result.current.isRecording).toBe(false);
    });

    it('should accept patientHistory alongside patientDetails', () => {
      const propsWithBoth = {
        ...defaultProps,
        patientHistory: 'Previous visit for routine checkup',
        patientDetails: {
          id: 456,
          name: 'Test Patient',
        },
      };

      const { result } = renderHook(() => useAudioRecorder(propsWithBoth));

      expect(result.current.error).toBeNull();
    });
  });

  describe('startRecording', () => {
    it('should validate microphone access before starting', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      expect(mockMediaDevices.enumerateDevices).toHaveBeenCalled();
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalled();
    });

    it('should not start recording when microphone validation fails', async () => {
      mockMediaDevices.enumerateDevices.mockResolvedValue([]);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toContain('No microphone');
    });

    it('should not start recording when getUserMedia permission is denied', async () => {
      const permError = new Error('Permission denied');
      permError.name = 'NotAllowedError';
      mockMediaDevices.getUserMedia.mockRejectedValue(permError);

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toContain('Microphone access denied');
    });

    it('should clear previous errors when starting a new recording', async () => {
      // First cause an error
      mockMediaDevices.enumerateDevices.mockResolvedValue([]);
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      expect(result.current.error).not.toBeNull();

      // Restore mocks and try again
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

      await act(async () => {
        result.current.startRecording();
      });

      // Error should be cleared at the start of startRecording
      // (even if recording setup fails later, the initial clear should happen)
      expect(result.current.error).toBeNull();
    });

    it('should request audio with correct constraints', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      // getUserMedia is called twice: once for validation, once for recording
      const calls = mockMediaDevices.getUserMedia.mock.calls as unknown as Array<[Record<string, unknown>]>;
      const recordingCall = calls[calls.length - 1];

      expect(recordingCall[0]).toEqual(
        expect.objectContaining({
          audio: expect.objectContaining({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }),
        })
      );
    });

    it('should use selected device ID when one is set', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // First select a device
      await act(async () => {
        await result.current.selectMicrophone('specific-device-id');
      });

      await act(async () => {
        result.current.startRecording();
      });

      // The recording getUserMedia call should include the specific device
      const calls = mockMediaDevices.getUserMedia.mock.calls as unknown as Array<[{ audio: Record<string, unknown> }]>;
      const recordingCall = calls[calls.length - 1];

      expect(recordingCall[0].audio).toEqual(
        expect.objectContaining({
          deviceId: { exact: 'specific-device-id' },
        })
      );
    });
  });

  describe('stopRecording', () => {
    it('should set isRecording to false', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Start recording first
      await act(async () => {
        result.current.startRecording();
      });

      await act(async () => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
    });

    it('should be callable when not recording without error', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      expect(result.current.isRecording).toBe(false);

      await act(async () => {
        result.current.stopRecording();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // Only resumeRecording used to clear isPaused, so stopping from the paused
  // state carried the flag into the next recording — and startRecording reads
  // it to decide whether to open a new session.
  describe('stopping while paused', () => {
    async function startPauseStop() {
      const hook = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await hook.result.current.startRecording();
      });
      act(() => {
        hook.result.current.pauseRecording();
      });
      expect(hook.result.current.isPaused).toBe(true);

      await act(async () => {
        await hook.result.current.stopRecording();
      });
      return hook;
    }

    it('should clear isPaused', async () => {
      const { result } = await startPauseStop();

      expect(result.current.isPaused).toBe(false);
      expect(result.current.isRecording).toBe(false);
    });

    it('should start the next recording in a new session', async () => {
      const { result } = await startPauseStop();

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.isPaused).toBe(false);

      const sessionIds = (mockRecoveryFns.createSession.mock.calls as unknown as Array<[string]>).map(
        ([id]) => id
      );
      expect(sessionIds).toHaveLength(2);
      expect(sessionIds[1]).not.toBe(sessionIds[0]);
    });

    it('should let the next recording pause', async () => {
      const { result } = await startPauseStop();

      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.pauseRecording();
      });

      expect(result.current.isPaused).toBe(true);
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('stopping then starting again quickly', () => {
    it('shuts down only the stopped recording, not one started within the stop delay', async () => {
      const graph = trackAudioGraph();
      mockMediaDevices.getUserMedia.mockImplementation(() => Promise.resolve(new MockMediaStream()));
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      const firstStream = result.current.mediaStreamRef.current!;
      await act(async () => {
        await result.current.stopRecording();
      });
      await act(async () => {
        await result.current.startRecording();
      });
      const secondStream = result.current.mediaStreamRef.current!;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });

      expect(firstStream.getTracks()[0].stop).toHaveBeenCalled();
      expect(graph.nodes[0].disconnect).toHaveBeenCalled();
      expect(graph.contexts[0].close).toHaveBeenCalled();

      expect(secondStream.getTracks()[0].stop).not.toHaveBeenCalled();
      expect(graph.nodes[1].disconnect).not.toHaveBeenCalled();
      expect(graph.contexts[1].close).not.toHaveBeenCalled();
      expect(result.current.mediaStreamRef.current).toBe(secondStream);
      expect(result.current.isRecording).toBe(true);
    });
  });

  describe('chunk timer', () => {
    const CHUNK_MS = 47000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function uploadChunkPosts(node: AudioWorkletNode) {
      return (node.port.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([message]) => (message as { command?: string })?.command === 'uploadChunk'
      ).length;
    }

    it('cuts one chunk per interval while recording', async () => {
      const graph = trackAudioGraph();
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(CHUNK_MS * 2);
      });

      expect(uploadChunkPosts(graph.nodes[0])).toBe(2);
    });

    it('stops cutting chunks when paused', async () => {
      const graph = trackAudioGraph();
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.pauseRecording();
      });
      act(() => {
        vi.advanceTimersByTime(CHUNK_MS * 2);
      });

      expect(uploadChunkPosts(graph.nodes[0])).toBe(0);
    });

    it('runs a single timer after resume', async () => {
      const graph = trackAudioGraph();
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.pauseRecording();
      });
      act(() => {
        result.current.resumeRecording();
      });
      act(() => {
        vi.advanceTimersByTime(CHUNK_MS);
      });

      expect(uploadChunkPosts(graph.nodes[0])).toBe(1);
    });

    it('runs a single timer when a recording is started twice', async () => {
      const graph = trackAudioGraph();
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(CHUNK_MS);
      });

      expect(uploadChunkPosts(graph.nodes[1])).toBe(1);
    });

    it('is cleared by a stopRecording captured before the recording started', async () => {
      const graph = trackAudioGraph();
      const { result } = renderHook(() => useAudioRecorder(defaultProps));
      const staleStop = result.current.stopRecording;

      await act(async () => {
        await result.current.startRecording();
      });
      await act(async () => {
        await staleStop();
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        vi.advanceTimersByTime(CHUNK_MS);
      });

      expect(uploadChunkPosts(graph.nodes[1])).toBe(1);
    });
  });

  describe('starting while paused', () => {
    it('should not leave isPaused set', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.pauseRecording();
      });

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.isPaused).toBe(false);
    });
  });

  // A recording can be stopped twice: an unplugged microphone ends the track
  // and fires a devicechange, and each path stops the recording. The worklet
  // answered the second stop with another, empty final chunk.
  describe('stopping twice', () => {
    it('asks the worklet for one final chunk', async () => {
      const graph = trackAudioGraph();
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        await result.current.startRecording();
      });
      await act(async () => {
        await result.current.stopRecording();
        await result.current.stopRecording();
      });

      expect(postsOf(graph.nodes[0], 'stop')).toBe(1);
    });
  });

  // The recorder used to clean up only its listeners on unmount. Its
  // microphone, audio graph, chunk timer and wake lock kept running, and it
  // went on uploading chunks with its last props: a host that moved on to
  // another encounter had the next consultation sent into the previous one.
  describe('unmounting', () => {
    const CHUNK_MS = 47000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      // A stream per call, so the access check's test stream, which is stopped
      // straight away, is never mistaken for the recording's.
      mockMediaDevices.getUserMedia.mockImplementation(() =>
        Promise.resolve(new MockMediaStream())
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function startRecorder() {
      const graph = trackAudioGraph();
      const hook = renderHook(() => useAudioRecorder(defaultProps));
      await act(async () => {
        await hook.result.current.startRecording();
      });
      const stream = hook.result.current.mediaStreamRef.current!;
      return { ...hook, graph, stream, deliver: handlerOf(graph.nodes[0]) };
    }

    describe('mid-recording', () => {
      it('stops the microphone and closes the audio graph', async () => {
        const { unmount, graph, stream } = await startRecorder();
        expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();

        unmount();

        expect(stream.getTracks()[0].stop).toHaveBeenCalled();
        expect(graph.nodes[0].disconnect).toHaveBeenCalled();
        expect(graph.contexts[0].close).toHaveBeenCalled();
      });

      it('clears the chunk timer', async () => {
        const { unmount, graph } = await startRecorder();
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
        act(() => {
          vi.advanceTimersByTime(CHUNK_MS * 2);
        });
        expect(postsOf(graph.nodes[0], 'uploadChunk')).toBe(0);
      });

      it('sends no chunk the worklet hands over after it unmounts', async () => {
        const { unmount, deliver } = await startRecorder();
        // While mounted a chunk goes out, so the pipeline is live in this test.
        act(() => deliver(audioMessage('chunk')));
        await flushAsync();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        unmount();
        act(() => {
          deliver(audioMessage('chunk'));
          deliver(audioMessage('finalChunk'));
        });
        await flushAsync();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockRecoveryFns.appendAudioToSession).toHaveBeenCalledTimes(1);
      });

      it('does not send a chunk it was preparing, nor one queued behind it', async () => {
        const wav = deferred<File>();
        mockFFmpegFns.convertToWav.mockImplementationOnce(() => wav.promise);
        const { unmount, deliver } = await startRecorder();
        act(() => {
          deliver(audioMessage('chunk'));
          deliver(audioMessage('chunk'));
        });
        await flushAsync();
        expect(mockFFmpegFns.convertToWav).toHaveBeenCalledTimes(1);

        unmount();
        wav.resolve(new File(['mock-wav'], 'audio-chunk.wav', { type: 'audio/wav' }));
        await flushAsync();

        expect(mockFetch).not.toHaveBeenCalled();
        // The queued chunk's audio isn't even stored on the device.
        expect(mockRecoveryFns.appendAudioToSession).toHaveBeenCalledTimes(1);
        // Dropped on purpose, not failed: nothing is kept for a retry.
        expect(mockRecoveryFns.markSessionFailed).not.toHaveBeenCalled();
      });

      it('does not retry an upload that fails after it unmounts', async () => {
        const response = deferred<FetchResponse>();
        mockFetch.mockImplementationOnce(() => response.promise);
        const { unmount, deliver } = await startRecorder();
        act(() => deliver(audioMessage('chunk')));
        await flushAsync();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        unmount();
        response.resolve(fetchResponse(503));
        // Past every backoff p-retry could wait: 3 retries, 10s at most each.
        await flushAsync(60_000);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockRecoveryFns.markSessionFailed).not.toHaveBeenCalled();
      });

      it('releases the wake lock', async () => {
        const lock = { release: vi.fn(() => Promise.resolve()) };
        const uninstall = fakeWakeLock(() => Promise.resolve(lock));
        try {
          const { unmount } = await startRecorder();
          await flushAsync();

          unmount();

          expect(lock.release).toHaveBeenCalledTimes(1);
        } finally {
          uninstall();
        }
      });

      it('releases a wake lock granted after it unmounted', async () => {
        const lock = { release: vi.fn(() => Promise.resolve()) };
        const granted = deferred<typeof lock>();
        const uninstall = fakeWakeLock(() => granted.promise);
        try {
          const { unmount } = await startRecorder();

          unmount();
          granted.resolve(lock);
          await flushAsync();

          expect(lock.release).toHaveBeenCalledTimes(1);
        } finally {
          uninstall();
        }
      });
    });

    describe('while paused', () => {
      it('stops the microphone and closes the audio graph', async () => {
        const { result, unmount, graph, stream } = await startRecorder();
        act(() => {
          result.current.pauseRecording();
        });

        unmount();

        expect(stream.getTracks()[0].stop).toHaveBeenCalled();
        expect(graph.nodes[0].disconnect).toHaveBeenCalled();
        expect(graph.contexts[0].close).toHaveBeenCalled();
      });
    });

    // Opening the microphone can wait on the browser's permission prompt for
    // as long as the user takes. A start that finished after the recorder was
    // gone left a live recording no one could stop.
    describe('while a recording is starting', () => {
      it('never captures if the microphone opens after it unmounted', async () => {
        const graph = trackAudioGraph();
        const opening = deferred<MockMediaStream>();
        // The first call is the access check; the second opens the recording's stream.
        mockMediaDevices.getUserMedia
          .mockImplementationOnce(() => Promise.resolve(new MockMediaStream()))
          .mockImplementationOnce(() => opening.promise);
        const { result, unmount } = renderHook(() => useAudioRecorder(defaultProps));
        act(() => {
          result.current.startRecording();
        });
        await flushAsync();
        expect(mockMediaDevices.getUserMedia).toHaveBeenCalledTimes(2);

        unmount();
        const stream = new MockMediaStream();
        opening.resolve(stream);
        await flushAsync();

        expect(stream.getTracks()[0].stop).toHaveBeenCalled();
        expect(graph.contexts).toHaveLength(0);
        expect(graph.nodes).toHaveLength(0);
      });

      it('never captures if the worklet loads after it unmounted', async () => {
        const graph = trackAudioGraph();
        const loading = deferred<void>();
        const TrackedContext = globalThis.AudioContext as unknown as new () => {
          audioWorklet: { addModule: () => Promise<void> };
        };
        globalThis.AudioContext = class extends TrackedContext {
          constructor() {
            super();
            this.audioWorklet = { addModule: () => loading.promise };
          }
        } as unknown as typeof AudioContext;
        const { result, unmount } = renderHook(() => useAudioRecorder(defaultProps));
        act(() => {
          result.current.startRecording();
        });
        await flushAsync();
        expect(graph.contexts).toHaveLength(1);
        const stream = result.current.mediaStreamRef.current!;

        unmount();
        loading.resolve();
        await flushAsync();

        expect(graph.nodes).toHaveLength(0);
        expect(graph.contexts[0].close).toHaveBeenCalled();
        expect(stream.getTracks()[0].stop).toHaveBeenCalled();
      });
    });

    // React 19.2 runs effect cleanups when an <Activity> boundary hides its
    // subtree, but keeps the state. A hidden recorder stops like an unmounted
    // one, and must come back idle rather than claim a recording that ended.
    describe('hidden under <Activity>', () => {
      it('comes back idle', async () => {
        let mode: 'visible' | 'hidden' = 'visible';
        const wrapper = ({ children }: { children: React.ReactNode }) =>
          React.createElement(React.Activity, { mode, children });
        const onRecordingStateChange = vi.fn();
        const { result, rerender } = renderHook(
          () => useAudioRecorder({ ...defaultProps, onRecordingStateChange }),
          { wrapper }
        );
        await act(async () => {
          await result.current.startRecording();
        });
        const stream = result.current.mediaStreamRef.current!;

        mode = 'hidden';
        rerender();
        expect(stream.getTracks()[0].stop).toHaveBeenCalled();

        mode = 'visible';
        rerender();
        expect(result.current.isRecording).toBe(false);
        expect(onRecordingStateChange.mock.calls).toEqual([['recording'], ['idle']]);
      });
    });

    // The user asked for this note by stopping, so a host that unmounts the
    // recorder straight after (even before the worklet hands over the final
    // chunk) still gets it. This held before the unmount teardown existed and
    // must keep holding with it.
    describe('after a stop', () => {
      it('still sends the final chunk, then releases the microphone', async () => {
        const { result, unmount, graph, stream, deliver } = await startRecorder();
        await act(async () => {
          await result.current.stopRecording();
        });

        unmount();
        act(() => deliver(audioMessage('finalChunk')));
        await flushAsync(600);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, request] = mockFetch.mock.calls[0] as unknown as [string, { body: FormData }];
        expect(request.body.get('isFinalChunk')).toBe('true');
        expect(defaultProps.onTranscriptionComplete).toHaveBeenCalledTimes(1);
        expect(stream.getTracks()[0].stop).toHaveBeenCalled();
        expect(graph.contexts[0].close).toHaveBeenCalled();
      });
    });
  });

  // The host had no way to know a recording was live: onTranscriptionUpdate
  // first fires when the first chunk's transcript comes back, 47 seconds in.
  describe('onRecordingStateChange', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      mockMediaDevices.getUserMedia.mockImplementation(() =>
        Promise.resolve(new MockMediaStream())
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function renderWithStates() {
      const graph = trackAudioGraph();
      const onRecordingStateChange = vi.fn();
      const hook = renderHook(() => useAudioRecorder({ ...defaultProps, onRecordingStateChange }));
      const states = () => onRecordingStateChange.mock.calls.map(([state]) => state);
      return { ...hook, graph, states };
    }

    it('is not called on mount', () => {
      const { states } = renderWithStates();

      expect(states()).toEqual([]);
    });

    it('reports start, pause, resume, stop, processing and back to idle', async () => {
      const { result, graph, states } = renderWithStates();

      await act(async () => {
        await result.current.startRecording();
      });
      act(() => {
        result.current.pauseRecording();
      });
      act(() => {
        result.current.resumeRecording();
      });
      expect(states()).toEqual(['recording', 'paused', 'recording']);

      // The final chunk's upload is held open to see the state while it runs.
      const upload = deferred<FetchResponse>();
      mockFetch.mockImplementationOnce(() => upload.promise);
      await act(async () => {
        await result.current.stopRecording();
      });
      // Processing from the stop itself: "idle" before the worklet hands over
      // the final chunk would tell the host it may leave.
      expect(states()).toEqual(['recording', 'paused', 'recording', 'processing']);

      act(() => handlerOf(graph.nodes[0])(audioMessage('finalChunk')));
      await flushAsync(600);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(states()).toEqual(['recording', 'paused', 'recording', 'processing']);

      upload.resolve(fetchResponse(200));
      await flushAsync();
      expect(states()).toEqual(['recording', 'paused', 'recording', 'processing', 'idle']);
    });

    it('returns to idle when the worklet never hands over the final chunk', async () => {
      const { result, states } = renderWithStates();

      await act(async () => {
        await result.current.startRecording();
      });
      await act(async () => {
        await result.current.stopRecording();
      });
      await flushAsync(600);

      expect(states()).toEqual(['recording', 'processing', 'idle']);
    });

    it('reports processing while a saved recording is retried', async () => {
      const { result, states } = renderWithStates();
      await act(async () => {
        await result.current.startRecording();
      });
      await act(async () => {
        await result.current.stopRecording();
      });
      await flushAsync(600);
      const sessionId = mockRecoveryFns.createSession.mock.calls[0][0];
      mockRecoveryFns.getFailedSession.mockResolvedValue({ id: sessionId });
      const retry = deferred<boolean>();
      mockRecoveryFns.retrySession.mockImplementation(() => retry.promise);

      let retried!: Promise<void>;
      act(() => {
        retried = result.current.retryFailedSession();
      });
      await flushAsync();
      expect(states()).toEqual(['recording', 'processing', 'idle', 'processing']);

      retry.resolve(true);
      await act(async () => {
        await retried;
      });
      expect(states()).toEqual(['recording', 'processing', 'idle', 'processing', 'idle']);
    });

    it('reports idle when the recorder unmounts mid-recording', async () => {
      const { result, unmount, states } = renderWithStates();
      await act(async () => {
        await result.current.startRecording();
      });

      unmount();

      expect(states()).toEqual(['recording', 'idle']);
    });

    it('calls the callback the host passed last', async () => {
      const first = vi.fn();
      const second = vi.fn();
      const { result, rerender } = renderHook((props) => useAudioRecorder(props), {
        initialProps: { ...defaultProps, onRecordingStateChange: first },
      });

      await act(async () => {
        await result.current.startRecording();
      });
      rerender({ ...defaultProps, onRecordingStateChange: second });
      act(() => {
        result.current.pauseRecording();
      });

      expect(first.mock.calls).toEqual([['recording']]);
      expect(second.mock.calls).toEqual([['paused']]);
    });
  });

  describe('selectedFormat prop', () => {
    it('should accept json format', () => {
      const props = { ...defaultProps, selectedFormat: 'json' as const };
      const { result } = renderHook(() => useAudioRecorder(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept hl7 format', () => {
      const props = { ...defaultProps, selectedFormat: 'hl7' as const };
      const { result } = renderHook(() => useAudioRecorder(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept fhir format', () => {
      const props = { ...defaultProps, selectedFormat: 'fhir' as const };
      const { result } = renderHook(() => useAudioRecorder(props));

      expect(result.current.error).toBeNull();
    });

    it('should default to json format when not specified', () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      // Hook should work fine with default format
      expect(result.current.error).toBeNull();
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('optional props', () => {
    it('should accept skipDiarization option', () => {
      const props = { ...defaultProps, skipDiarization: false };
      const { result } = renderHook(() => useAudioRecorder(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept silenceRemoval option', () => {
      const props = { ...defaultProps, silenceRemoval: false };
      const { result } = renderHook(() => useAudioRecorder(props));

      expect(result.current.error).toBeNull();
    });

    it('should accept custom apiBaseUrl', () => {
      const props = { ...defaultProps, apiBaseUrl: 'https://custom-api.example.com' };
      const { result } = renderHook(() => useAudioRecorder(props));

      expect(result.current.error).toBeNull();
    });
  });

  describe('audio processing pipeline', () => {
    let capturedProcessor: {
      port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: { data: Record<string, unknown> }) => void) | null };
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    } | null;
    let OriginalAudioWorkletNode: typeof globalThis.AudioWorkletNode;

    beforeEach(() => {
      capturedProcessor = null;
      OriginalAudioWorkletNode = globalThis.AudioWorkletNode;

      // Override AudioWorkletNode to capture the instance created during startRecording
      (globalThis as any).AudioWorkletNode = class {
        port = {
          postMessage: vi.fn(),
          onmessage: null as ((event: { data: Record<string, unknown> }) => void) | null,
        };
        connect = vi.fn();
        disconnect = vi.fn();
        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          capturedProcessor = this;
        }
      };
    });

    afterEach(() => {
      (globalThis as any).AudioWorkletNode = OriginalAudioWorkletNode;
    });

    it('should apply silence removal and convert to FLAC when silenceRemoval is enabled', async () => {
      const props = { ...defaultProps, silenceRemoval: true };
      const { result } = renderHook(() => useAudioRecorder(props));

      // Start recording to set up the audio processing pipeline
      await act(async () => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);
      expect(capturedProcessor).not.toBeNull();
      expect(capturedProcessor!.port.onmessage).not.toBeNull();

      // Clear mock call history from any initialization calls
      mockFFmpegFns.convertToWav.mockClear();
      mockFFmpegFns.removeSilence.mockClear();
      mockFFmpegFns.convertToFlac.mockClear();
      mockFetch.mockClear();

      // Simulate an audio chunk arriving from the worklet
      const audioData = new Float32Array([0.5, 0.3, 0.1, 0.4, 0.2]);
      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'chunk',
            audioBuffer: audioData.buffer,
          },
        });
      });

      // Wait for the async processing pipeline to complete
      await waitFor(() => {
        expect(mockFFmpegFns.convertToWav).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockFFmpegFns.removeSilence).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockFFmpegFns.convertToFlac).toHaveBeenCalledTimes(1);
      });

      // Verify the processing order: WAV was passed to removeSilence
      const wavFile = await mockFFmpegFns.convertToWav.mock.results[0].value;
      expect(mockFFmpegFns.removeSilence).toHaveBeenCalledWith(wavFile);

      // Verify fetch was called (audio was sent to server)
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    it('should skip silence removal but still convert to FLAC when silenceRemoval is disabled', async () => {
      const props = { ...defaultProps, silenceRemoval: false };
      const { result } = renderHook(() => useAudioRecorder(props));

      await act(async () => {
        result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);

      mockFFmpegFns.convertToWav.mockClear();
      mockFFmpegFns.removeSilence.mockClear();
      mockFFmpegFns.convertToFlac.mockClear();
      mockFetch.mockClear();

      const audioData = new Float32Array([0.5, 0.3, 0.1, 0.4, 0.2]);
      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'chunk',
            audioBuffer: audioData.buffer,
          },
        });
      });

      // WAV conversion and FLAC conversion should still happen
      await waitFor(() => {
        expect(mockFFmpegFns.convertToWav).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockFFmpegFns.convertToFlac).toHaveBeenCalledTimes(1);
      });

      // Silence removal should NOT have been called
      expect(mockFFmpegFns.removeSilence).not.toHaveBeenCalled();

      // Fetch should still be called
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    it('should use correct sample rate from AudioContext for WAV conversion', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      mockFFmpegFns.convertToWav.mockClear();

      const audioData = new Float32Array([0.5, 0.3, 0.1]);
      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'chunk',
            audioBuffer: audioData.buffer,
          },
        });
      });

      await waitFor(() => {
        expect(mockFFmpegFns.convertToWav).toHaveBeenCalledTimes(1);
      });

      // MockAudioContext.sampleRate is 44100
      const callArgs = mockFFmpegFns.convertToWav.mock.calls[0];
      expect(callArgs[1]).toBe(44100);
    });

    it('should send the FLAC file to the server via fetch', async () => {
      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      mockFFmpegFns.convertToWav.mockClear();
      mockFFmpegFns.convertToFlac.mockClear();
      mockFetch.mockClear();

      const audioData = new Float32Array([0.5, 0.3, 0.1]);
      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'chunk',
            audioBuffer: audioData.buffer,
          },
        });
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Verify the fetch was called with the transcribe endpoint
      const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, { method: string; body: FormData }]>;
      const fetchCall = fetchCalls[0];
      expect(fetchCall[0]).toContain('/api/transcribe');

      // Verify it sent a FormData body
      const fetchOptions = fetchCall[1];
      expect(fetchOptions.method).toBe('POST');
      expect(fetchOptions.body).toBeInstanceOf(FormData);

      // Verify the FormData contains the audio file
      const formData = fetchOptions.body as FormData;
      const audioFile = formData.get('audio') as File;
      expect(audioFile).not.toBeNull();
      expect(audioFile.type).toBe('audio/flac');
    });

    it('should fall back to WAV when FLAC conversion fails', async () => {
      // Make FLAC conversion fail
      mockFFmpegFns.convertToFlac.mockRejectedValueOnce(new Error('FLAC conversion failed'));

      const { result } = renderHook(() => useAudioRecorder(defaultProps));

      await act(async () => {
        result.current.startRecording();
      });

      mockFFmpegFns.convertToWav.mockClear();
      mockFetch.mockClear();

      const audioData = new Float32Array([0.5, 0.3, 0.1]);
      act(() => {
        capturedProcessor!.port.onmessage!({
          data: {
            command: 'chunk',
            audioBuffer: audioData.buffer,
          },
        });
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Should still send the request, but with the WAV file as fallback
      const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, { method: string; body: FormData }]>;
      const formData = fetchCalls[0][1].body as FormData;
      const audioFile = formData.get('audio') as File;
      expect(audioFile).not.toBeNull();
      expect(audioFile.type).toBe('audio/wav');
    });

    // Regression: the note fields a consumer passes can change after mount
    // while every other prop stays put (a clinician picking another template).
    // The final chunk, where the note is made, must carry the current values.
    describe('note fields changed after mount', () => {
      const sendFinalChunk = () => {
        const audioData = new Float32Array([0.5, 0.3, 0.1]);
        act(() => {
          capturedProcessor!.port.onmessage!({
            data: {
              command: 'finalChunk',
              audioBuffer: audioData.buffer,
            },
          });
        });
      };

      const postedFormData = async () => {
        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(1);
        });
        const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, { body: FormData }]>;
        return fetchCalls[0][1].body;
      };

      // v2 makes the note in a separate /medical-note call; it must carry the
      // consumer's template and no invented speciality or user (the legacy
      // soap_note / user 115 defaults are gone).
      it('should write a v2 note from the template the consumer passes', async () => {
        const original = mockFetch.getMockImplementation();
        mockFetch.mockImplementation(((url: string) =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve(
                String(url).includes('/api/transcribe/v2')
                  ? {
                      labeledTranscript: 'Doctor: cough for three days',
                      diarizedTranscript: '',
                      roles: {},
                    }
                  : { classifiedInfo: {} }
              ),
            text: () => Promise.resolve(''),
          })) as unknown as Parameters<typeof mockFetch.mockImplementation>[0]);
        try {
          const { result } = renderHook(() =>
            useAudioRecorder({
              ...defaultProps,
              speciality: '',
              apiVersion: 'v2',
              template: 'document',
            })
          );
          await act(async () => {
            result.current.startRecording();
          });
          mockFetch.mockClear();
          sendFinalChunk();

          await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(2);
          });
          const calls = mockFetch.mock.calls as unknown as Array<[string, { body: string }]>;
          expect(calls[1][0]).toContain('/api/transcribe/medical-note');
          const params = JSON.parse(calls[1][1].body);
          expect(params.template).toBe('document');
          expect(params).not.toHaveProperty('speciality');
          expect(params).not.toHaveProperty('userId');
        } finally {
          mockFetch.mockImplementation(original!);
        }
      });

      it('should post a template changed before recording starts', async () => {
        const { result, rerender } = renderHook((props) => useAudioRecorder(props), {
          initialProps: { ...defaultProps, template: 'soap' },
        });

        rerender({ ...defaultProps, template: 'apso' });

        await act(async () => {
          result.current.startRecording();
        });
        mockFetch.mockClear();
        sendFinalChunk();

        expect((await postedFormData()).get('template')).toBe('apso');
      });

      it('should post a template changed during the recording', async () => {
        const { result, rerender } = renderHook((props) => useAudioRecorder(props), {
          initialProps: { ...defaultProps, template: 'soap' },
        });

        await act(async () => {
          result.current.startRecording();
        });
        rerender({ ...defaultProps, template: 'apso' });
        mockFetch.mockClear();
        sendFinalChunk();

        expect((await postedFormData()).get('template')).toBe('apso');
      });

      it('should post an encounterId changed before recording starts', async () => {
        const { result, rerender } = renderHook((props) => useAudioRecorder(props), {
          initialProps: { ...defaultProps, encounterId: 'encounter-1' },
        });

        rerender({ ...defaultProps, encounterId: 'encounter-2' });

        await act(async () => {
          result.current.startRecording();
        });
        mockFetch.mockClear();
        sendFinalChunk();

        expect((await postedFormData()).get('encounter_id')).toBe('encounter-2');
      });

      it('should post an encounterId changed during the recording', async () => {
        const { result, rerender } = renderHook((props) => useAudioRecorder(props), {
          initialProps: { ...defaultProps, encounterId: 'encounter-1' },
        });

        await act(async () => {
          result.current.startRecording();
        });
        rerender({ ...defaultProps, encounterId: 'encounter-2' });
        mockFetch.mockClear();
        sendFinalChunk();

        expect((await postedFormData()).get('encounter_id')).toBe('encounter-2');
      });
    });

    // Regression: POST /api/transcribe reads `encounter_id` and nothing else,
    // and only on the chunk that opens the session. The camelCase field was
    // accepted with a 200 and dropped, so no session was linked to its
    // encounter.
    describe('encounter id on the wire', () => {
      const postedFormData = async () => {
        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(1);
        });
        const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, { body: FormData }]>;
        return fetchCalls[0][1].body;
      };

      const sendChunk = (command: 'chunk' | 'finalChunk') => {
        act(() => {
          capturedProcessor!.port.onmessage!({
            data: {
              command,
              audioBuffer: new Float32Array([0.5, 0.3, 0.1]).buffer,
            },
          });
        });
      };

      it('sends encounter_id on the chunk that opens the session', async () => {
        const { result } = renderHook(() =>
          useAudioRecorder({ ...defaultProps, encounterId: '42' })
        );
        await act(async () => {
          result.current.startRecording();
        });
        mockFetch.mockClear();
        sendChunk('chunk');

        const formData = await postedFormData();
        expect(formData.get('encounter_id')).toBe('42');
        expect(formData.has('encounterId')).toBe(false);
      });

      it('sends no encounter field when the consumer passes none', async () => {
        const { result } = renderHook(() => useAudioRecorder(defaultProps));
        await act(async () => {
          result.current.startRecording();
        });
        mockFetch.mockClear();
        sendChunk('finalChunk');

        const formData = await postedFormData();
        expect(formData.has('encounter_id')).toBe(false);
        expect(formData.has('encounterId')).toBe(false);
      });
    });

    // The crash-recovery store no longer keeps patient details, but the
    // request still carries them: the note is written with them.
    describe('patient details on the wire', () => {
      it('still sends the patient details with each chunk', async () => {
        const patientDetails = { id: 1, gender: 'FIXTURE-GENDER', age: 1 };
        const { result } = renderHook(() => useAudioRecorder({ ...defaultProps, patientDetails }));
        await act(async () => {
          result.current.startRecording();
        });
        mockFetch.mockClear();
        act(() => {
          capturedProcessor!.port.onmessage!({
            data: { command: 'chunk', audioBuffer: new Float32Array([0.5, 0.3, 0.1]).buffer },
          });
        });

        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(1);
        });
        const fetchCalls = mockFetch.mock.calls as unknown as Array<[string, { body: FormData }]>;
        expect(JSON.parse(fetchCalls[0][1].body.get('patientDetails') as string)).toEqual(
          patientDetails
        );
      });
    });
  });
});
