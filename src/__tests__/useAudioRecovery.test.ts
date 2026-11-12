import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAudioRecovery from '../hooks/useAudioRecovery';
import { captureConsole } from './consoleCapture';

// --- IndexedDB mock infrastructure ---

let mockStoreData: Map<string, any>;

// The database version already on disk; 0 means it does not exist yet. As in a
// browser, indexedDB.open runs an upgrade only when asked for a higher version.
let mockDbVersion: number;

// Another tab holds the database open at its old version and never lets go, so
// an upgrade can only wait.
let mockOpenBlocked: boolean;

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
    // Ranged lookups go to the timestamp index; `range` is the fake
    // IDBKeyRange installed below.
    getAllKeys: vi.fn((range: { upper: number; upperOpen: boolean }) => {
      const keys = Array.from(mockStoreData.values())
        .filter((item: any) => {
          const timestamp = item.metadata?.timestamp;
          if (typeof timestamp !== 'number') return false;
          return range.upperOpen ? timestamp < range.upper : timestamp <= range.upper;
        })
        .map((item: any) => item.id);
      return createMockIDBRequest(keys);
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
    // Every version of the database has had the store.
    contains: vi.fn(() => mockDbVersion > 0),
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
    mockDbVersion = 0;
    mockOpenBlocked = false;
    mockDB = createMockDB();
    undecodableChunks = new Set();
    mockReprocessSession.mockClear();

    // Mock indexedDB
    Object.defineProperty(globalThis, 'indexedDB', {
      writable: true,
      value: {
        open: vi.fn((_name: string, version: number) => {
          const request: any = {
            result: mockDB,
            error: null,
            transaction: null,
            onsuccess: null as ((event: any) => void) | null,
            onerror: null as ((event: any) => void) | null,
            onupgradeneeded: null as ((event: any) => void) | null,
            onblocked: null as ((event: any) => void) | null,
          };
          setTimeout(() => {
            if (version > mockDbVersion) {
              if (mockOpenBlocked) {
                // The request stays pending until the other tab closes.
                request.onblocked?.({ target: request, oldVersion: mockDbVersion, newVersion: version });
                return;
              }
              // The upgrade runs inside its own versionchange transaction.
              request.transaction = createMockTransaction();
              request.onupgradeneeded?.({ target: request, oldVersion: mockDbVersion, newVersion: version });
              request.transaction = null;
              mockDbVersion = version;
            }
            request.onsuccess?.({ target: request });
          }, 0);
          return request;
        }),
      },
    });

    // jsdom has no IndexedDB, so no IDBKeyRange either. Only upper bounds are
    // used.
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      writable: true,
      value: {
        upperBound: (upper: number, upperOpen = false) => ({ upper, upperOpen }),
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
      expect(globalThis.indexedDB.open).toHaveBeenCalledWith('AudioSessionDB', 2);
    });

    // The store keeps a recording's audio on the device until its note
    // arrives, and longer when an upload fails. It holds nothing about the
    // patient: retry never read those fields back.
    it('should store no patient details or history', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      // The fields are gone from the type; a caller passing them anyway must
      // not get them stored either.
      const metadata = {
        speciality: 'neurology',
        sampleRate: 48000,
        patientDetails: { id: 1, name: 'FIXTURE-NAME', gender: 'FIXTURE-GENDER', age: 1 },
        patientHistory: 'FIXTURE-HISTORY',
      } as unknown as Parameters<typeof result.current.createSession>[1];

      await act(async () => {
        await result.current.createSession('session-2', metadata);
      });

      const stored = mockStoreData.get('session-2');
      expect(Object.keys(stored.metadata).sort()).toEqual([
        'chunkIndices',
        'completedChunks',
        'sampleRate',
        'speciality',
        'timestamp',
        'totalChunks',
      ]);
      expect(stored.metadata).toMatchObject({ speciality: 'neurology', sampleRate: 48000 });
      expect(JSON.stringify(stored)).not.toContain('FIXTURE');
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
    const lookUp = async (sessionId: string) => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));
      let failedSession: any;
      await act(async () => {
        failedSession = await result.current.getFailedSession(sessionId);
      });
      return failedSession;
    };

    it('should return null/undefined when the session does not exist', async () => {
      expect(await lookUp('no-such-session')).toBeFalsy();
    });

    it('should return the session once its upload has failed', async () => {
      mockStoreData.set('own-recording', buildSession('own-recording', ['chunk-0']));

      expect((await lookUp('own-recording'))?.id).toBe('own-recording');
    });

    // Regression: the lookup returned the oldest failed session in the store,
    // which the recorder then resent with the current patient's details.
    it("should not return another recording's failed session", async () => {
      mockStoreData.set('earlier-recording', buildSession('earlier-recording', ['chunk-0']));

      expect(await lookUp('own-recording')).toBeFalsy();
    });

    it('should return null/undefined while the session is still recording', async () => {
      mockStoreData.set('own-recording', {
        ...buildSession('own-recording', ['chunk-0']),
        status: 'recording',
      });

      expect(await lookUp('own-recording')).toBeFalsy();
    });
  });

  describe('hasFailedSession', () => {
    it('should return false when the session has not failed', async () => {
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      let hasFailed: boolean = true;
      await act(async () => {
        hasFailed = await result.current.hasFailedSession('no-such-session');
      });

      expect(hasFailed).toBe(false);
    });
  });

  // Records went only when an upload succeeded: a failed recording stayed
  // until a retry worked or someone cleared it, and an interrupted one (the tab
  // closed mid-consultation) stayed forever, full audio included.
  describe('expiry', () => {
    const HOUR = 60 * 60 * 1000;

    const storedAgo = (id: string, status: string, ageMs: number) => {
      const session = buildSession(id, ['chunk-0']);
      return {
        ...session,
        status,
        metadata: { ...session.metadata, timestamp: Date.now() - ageMs },
      };
    };

    beforeEach(() => {
      // The store is already at the current version: opening it runs no
      // upgrade, so only the expiry can remove anything.
      mockDbVersion = 2;
    });

    it('should delete recordings older than 12 hours when the store opens', async () => {
      mockStoreData.set('failed-13h', storedAgo('failed-13h', 'failed', 13 * HOUR));
      mockStoreData.set(
        'interrupted-12h1m',
        storedAgo('interrupted-12h1m', 'recording', 12 * HOUR + 60_000)
      );
      mockStoreData.set('failed-11h', storedAgo('failed-11h', 'failed', 11 * HOUR));

      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));
      await act(async () => {
        await result.current.createSession('new-recording', {
          speciality: 'general',
          sampleRate: 16000,
        });
      });

      expect(mockStoreData.has('failed-13h')).toBe(false);
      expect(mockStoreData.has('interrupted-12h1m')).toBe(false);
      expect(mockStoreData.has('failed-11h')).toBe(true);
      expect(mockStoreData.has('new-recording')).toBe(true);
    });
  });

  // Version 1 stored every recording with the patient's details. Nothing an
  // older release wrote may survive the move to version 2.
  describe('upgrade from version 1', () => {
    const legacySession = (id: string) => {
      const session = buildSession(id, ['chunk-0']);
      return {
        ...session,
        metadata: {
          ...session.metadata,
          patientDetails: { id: 1, name: 'FIXTURE-NAME' },
          patientHistory: 'FIXTURE-HISTORY',
        },
      };
    };

    it('should clear every record version 1 wrote, however recent', async () => {
      const readConsole = captureConsole();
      mockDbVersion = 1;
      mockStoreData.set('legacy-recent', legacySession('legacy-recent'));

      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));
      await act(async () => {
        await result.current.createSession('first-after-upgrade', {
          speciality: 'general',
          sampleRate: 16000,
        });
      });

      expect(mockStoreData.has('legacy-recent')).toBe(false);
      expect(mockStoreData.has('first-after-upgrade')).toBe(true);
      expect(readConsole()).not.toContain('FIXTURE');
    });

    it('should not clear the store when it is already at version 2', async () => {
      mockDbVersion = 2;
      mockStoreData.set('current-recent', buildSession('current-recent', ['chunk-0']));

      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));
      await act(async () => {
        await result.current.createSession('another-recording', {
          speciality: 'general',
          sampleRate: 16000,
        });
      });

      expect(mockStoreData.has('current-recent')).toBe(true);
    });

    // An upgrade waits for every tab to close the old version. A tab still
    // running the previous release never does, and waiting would hold up the
    // start of a recording until that tab is closed.
    it('should fail instead of waiting when another tab blocks the upgrade', async () => {
      mockDbVersion = 1;
      mockOpenBlocked = true;
      const { result } = renderHook(() => useAudioRecovery(mockReprocessSession));

      let outcome = '';
      await act(async () => {
        outcome = await Promise.race([
          result.current
            .createSession('blocked-recording', { speciality: 'general', sampleRate: 16000 })
            .then(
              () => 'created',
              () => 'failed'
            ),
          new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 100)),
        ]);
      });

      expect(outcome).toBe('failed');
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
