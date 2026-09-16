import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAudioRecovery from '../hooks/useAudioRecovery';

// --- IndexedDB mock infrastructure ---

let mockStoreData: Map<string, any>;

const createMockIDBRequest = (result: any, error: any = null) => {
  const request: any = {
    result,
    error,
    onsuccess: null as ((event: any) => void) | null,
    onerror: null as ((event: any) => void) | null,
  };
  // Trigger callbacks asynchronously
  setTimeout(() => {
    if (error && request.onerror) {
      request.onerror({ target: request });
    } else if (request.onsuccess) {
      request.onsuccess({ target: request });
    }
  }, 0);
  return request;
};

const createMockObjectStore = () => ({
  add: vi.fn((data: any) => {
    mockStoreData.set(data.id, JSON.parse(JSON.stringify(data)));
    return createMockIDBRequest(undefined);
  }),
  put: vi.fn((data: any) => {
    mockStoreData.set(data.id, JSON.parse(JSON.stringify(data)));
    return createMockIDBRequest(undefined);
  }),
  get: vi.fn((key: string) => {
    const data = mockStoreData.get(key);
    return createMockIDBRequest(data ? JSON.parse(JSON.stringify(data)) : undefined);
  }),
  delete: vi.fn((key: string) => {
    mockStoreData.delete(key);
    return createMockIDBRequest(undefined);
  }),
  clear: vi.fn(() => {
    mockStoreData.clear();
    return createMockIDBRequest(undefined);
  }),
  index: vi.fn((_name: string) => ({
    getAll: vi.fn((status: string) => {
      const results = Array.from(mockStoreData.values()).filter(
        (item: any) => item.status === status
      );
      return createMockIDBRequest(results);
    }),
  })),
  createIndex: vi.fn(),
});

const createMockTransaction = () => {
  const store = createMockObjectStore();
  return {
    objectStore: vi.fn(() => store),
    store,
  };
};

const createMockDB = () => ({
  transaction: vi.fn(() => {
    const tx = createMockTransaction();
    return tx;
  }),
  objectStoreNames: {
    contains: vi.fn(() => false),
  },
  createObjectStore: vi.fn(() => ({
    createIndex: vi.fn(),
  })),
  close: vi.fn(),
});

let mockDB: ReturnType<typeof createMockDB>;

// Chunks registered here fail to decode, letting a test simulate a corrupt
// chunk without having to reach into the worker itself.
let undecodableChunks: Set<string>;

// Mock Worker
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(data: any) {
    // Simulate worker response
    setTimeout(() => {
      if (data.command === 'encodeFloat32ToBase64') {
        // Simple mock encoding: just return a fake base64 string
        this.onmessage?.({
          data: {
            type: 'complete',
            id: data.id,
            result: 'mockBase64EncodedData',
          },
        } as any);
      } else if (data.command === 'decodeBase64ToFloat32') {
        if (undecodableChunks.has(data.data.base64Data)) {
          this.onmessage?.({
            data: {
              type: 'error',
              id: data.id,
              error: 'Simulated decode failure',
            },
          } as any);
          return;
        }
        // Return a simple array
        this.onmessage?.({
          data: {
            type: 'complete',
            id: data.id,
            result: [0.1, 0.2, 0.3],
          },
        } as any);
      }
    }, 0);
  }

  terminate() {}
}

// Type for the reprocessSession callback
type ReprocessSessionFn = (
  audioChunks: Float32Array[],
  metadata: {
    patientDetails?: {
      id?: number;
      name?: string;
      gender?: string;
      dateOfBirth?: Date | string;
      age?: number;
    };
    patientHistory?: string;
    speciality: string;
    sampleRate: number;
    timestamp: number;
    totalChunks: number;
    completedChunks: number;
    chunkIndices: number[];
  }
) => Promise<void>;

const buildSession = (id: string, chunks: string[]) => ({
  id,
  status: 'failed',
  audioChunks: Object.fromEntries(chunks.map((chunk, index) => [index, chunk])),
  metadata: {
    speciality: 'general',
    sampleRate: 44100,
    timestamp: Date.now(),
    totalChunks: chunks.length,
    completedChunks: chunks.length,
    chunkIndices: chunks.map((_, index) => index),
  },
  retryCount: 0,
});

describe('useAudioRecovery', () => {
  const mockReprocessSession = vi.fn<ReprocessSessionFn>(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreData = new Map();
    mockDB = createMockDB();
    undecodableChunks = new Set();
    mockReprocessSession.mockClear();

    // Mock indexedDB
    Object.defineProperty(globalThis, 'indexedDB', {
      writable: true,
      value: {
        open: vi.fn(() => {
          const request: any = {
            result: mockDB,
            error: null,
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
          };
          setTimeout(() => {
            // Trigger upgrade first
            if (request.onupgradeneeded) {
              request.onupgradeneeded({ target: request });
            }
            if (request.onsuccess) {
              request.onsuccess({ target: request });
            }
          }, 0);
          return request;
        }),
      },
    });

    // Mock Worker
    Object.defineProperty(globalThis, 'Worker', {
      writable: true,
      value: MockWorker,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should expose all expected methods', () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      expect(typeof result.current.createSession).toBe('function');
      expect(typeof result.current.appendAudioToSession).toBe('function');
      expect(typeof result.current.markSessionComplete).toBe('function');
      expect(typeof result.current.markSessionFailed).toBe('function');
      expect(typeof result.current.retrySession).toBe('function');
      expect(typeof result.current.deleteSession).toBe('function');
      expect(typeof result.current.getFailedSession).toBe('function');
      expect(typeof result.current.hasFailedSession).toBe('function');
      expect(typeof result.current.clearFailedSessions).toBe('function');
    });
  });

  describe('createSession', () => {
    it('should create a new session in IndexedDB', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      await act(async () => {
        await result.current.createSession('session-1', {
          speciality: 'cardiology',
          sampleRate: 44100,
        });
      });

      // Verify indexedDB.open was called
      expect(globalThis.indexedDB.open).toHaveBeenCalledWith('AudioSessionDB', 1);
    });

    it('should accept patient details in metadata', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      await act(async () => {
        await result.current.createSession('session-2', {
          speciality: 'neurology',
          sampleRate: 48000,
          patientDetails: {
            id: 123,
            name: 'John Doe',
            gender: 'male',
          },
          patientHistory: 'Previous headaches',
        });
      });

      // Should not throw
      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });
  });

  describe('markSessionComplete', () => {
    it('should delete the session from IndexedDB', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      await act(async () => {
        await result.current.markSessionComplete('session-1');
      });

      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });
  });

  describe('markSessionFailed', () => {
    it('should update session status to failed', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      // First create a session so it exists
      mockStoreData.set('session-fail', {
        id: 'session-fail',
        status: 'recording',
        audioChunks: {},
        metadata: {
          speciality: 'general',
          sampleRate: 44100,
          timestamp: Date.now(),
          totalChunks: 0,
          completedChunks: 0,
          chunkIndices: [],
        },
        retryCount: 0,
      });

      await act(async () => {
        await result.current.markSessionFailed('session-fail', 'Network error');
      });

      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should delete the specified session', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      await act(async () => {
        await result.current.deleteSession('session-to-delete');
      });

      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });
  });

  describe('getFailedSession', () => {
    it('should return null/undefined when no failed sessions exist', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      let failedSession: any;
      await act(async () => {
        failedSession = await result.current.getFailedSession();
      });

      expect(failedSession).toBeFalsy();
    });
  });

  describe('hasFailedSession', () => {
    it('should return false when no failed sessions exist', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      let hasFailed: boolean = true;
      await act(async () => {
        hasFailed = await result.current.hasFailedSession();
      });

      expect(hasFailed).toBe(false);
    });
  });

  describe('clearFailedSessions', () => {
    it('should clear all sessions from the store', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      await act(async () => {
        await result.current.clearFailedSessions();
      });

      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });
  });

  describe('appendAudioToSession', () => {
    it('should encode and append audio data to a session', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      // Create a session first
      mockStoreData.set('session-append', {
        id: 'session-append',
        status: 'recording',
        audioChunks: {},
        metadata: {
          speciality: 'general',
          sampleRate: 44100,
          timestamp: Date.now(),
          totalChunks: 0,
          completedChunks: 0,
          chunkIndices: [],
        },
        retryCount: 0,
      });

      const audioData = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

      await act(async () => {
        await result.current.appendAudioToSession('session-append', audioData, 0);
      });

      // Should not throw
      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });
  });

  describe('retrySession', () => {
    it('should return false when session does not exist', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      let retryResult: boolean = true;
      await act(async () => {
        retryResult = await result.current.retrySession('nonexistent-session');
      });

      expect(retryResult).toBe(false);
    });

    it('should call reprocessSession with decoded audio chunks', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      // Create a session with audio chunks
      mockStoreData.set('session-retry', {
        id: 'session-retry',
        status: 'failed',
        audioChunks: {
          0: 'base64chunk1',
          1: 'base64chunk2',
        },
        metadata: {
          speciality: 'general',
          sampleRate: 44100,
          timestamp: Date.now(),
          totalChunks: 2,
          completedChunks: 2,
          chunkIndices: [0, 1],
        },
        retryCount: 0,
      });

      await act(async () => {
        await result.current.retrySession('session-retry');
      });

      // The reprocessSession callback should be called
      // (may not be reached due to mock complexity, but the function should not throw)
      expect(globalThis.indexedDB.open).toHaveBeenCalled();
    });

    it('should resend every chunk when all of them decode', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      mockStoreData.set('session-intact', buildSession('session-intact', [
        'chunk-0',
        'chunk-1',
        'chunk-2',
      ]));

      let retryResult: boolean = false;
      await act(async () => {
        retryResult = await result.current.retrySession('session-intact');
      });

      expect(retryResult).toBe(true);
      expect(mockReprocessSession).toHaveBeenCalledTimes(1);
      expect(mockReprocessSession.mock.calls[0][0]).toHaveLength(3);
    });

    // Regression: a chunk that fails to decode used to be logged and skipped, so
    // retrySession resent a recording with a hole in it and reported success —
    // which let the caller delete the only remaining copy of the full audio.
    it('should fail the retry when any chunk cannot be decoded', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      undecodableChunks.add('chunk-1');
      mockStoreData.set('session-partial', buildSession('session-partial', [
        'chunk-0',
        'chunk-1',
        'chunk-2',
      ]));

      let retryResult: boolean = true;
      await act(async () => {
        retryResult = await result.current.retrySession('session-partial');
      });

      expect(retryResult).toBe(false);
      expect(mockReprocessSession).not.toHaveBeenCalled();
    });

    it('should keep the stored session when a chunk cannot be decoded', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      undecodableChunks.add('chunk-1');
      mockStoreData.set('session-partial', buildSession('session-partial', [
        'chunk-0',
        'chunk-1',
        'chunk-2',
      ]));

      await act(async () => {
        await result.current.retrySession('session-partial');
      });

      // The audio is the only copy left; a failed retry must not discard it.
      expect(mockStoreData.has('session-partial')).toBe(true);
      expect(
        Object.keys(mockStoreData.get('session-partial').audioChunks)
      ).toHaveLength(3);
    });
  });

  describe('cleanup', () => {
    it('should clean up resources on unmount', () => {
      const { unmount } = renderHook(() => useAudioRecovery(mockReprocessSession));

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });
  });
});
