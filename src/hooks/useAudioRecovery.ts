import React, { useCallback, useEffect, useRef } from "react";

interface AudioSession {
  id: string;
  audioChunks: Record<number, string>; // Change from array to object
  metadata: {
    patientId?: number;
    patientName?: string;
    patientHistory?: string;
    speciality: string;
    timestamp: number;
    totalChunks: number;
    completedChunks: number;
    chunkIndices: number[]; // Track which chunks we have
  };
  status: "recording" | "processing" | "failed" | "completed";
  retryCount: number;
  lastError?: string;
}

interface AudioRecoveryHookReturn {
  createSession: (
    sessionId: string,
    metadata: {
      patientId?: number;
      patientName?: string;
      patientHistory?: string;
      speciality: string;
    }
  ) => Promise<void>;
  appendAudioToSession: (
    sessionId: string,
    audioData: Float32Array,
    sequence: number
  ) => Promise<void>;
  markSessionComplete: (sessionId: string) => Promise<void>;
  markSessionFailed: (sessionId: string, error?: string) => Promise<void>;
  retrySession: (sessionId: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<void>;
  getFailedSession: () => Promise<AudioSession | null>;
  hasFailedSession: () => Promise<boolean>;
  clearFailedSessions: () => Promise<void>;
}

const useAudioRecovery = (
  reprocessSession: (
    audioChunks: Float32Array[],
    metadata: AudioSession["metadata"]
  ) => Promise<void>
): AudioRecoveryHookReturn => {
  const dbRef = useRef<IDBDatabase | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingOperations = useRef<Map<string, { resolve: Function; reject: Function }>>(new Map());

  const DB_NAME = "AudioSessionDB";
  const STORE_NAME = "audioSessions";
  const DB_VERSION = 1;
  const MAX_RETRY_COUNT = 3;

  // Initialize the encoding worker
  const initWorker = useCallback(() => {
    if (!workerRef.current) {
      try {
        workerRef.current = new Worker("/audio-encoding-worker.js");

        workerRef.current.onmessage = (e) => {
          const { type, id, result, error, progress, message } = e.data;
          const operation = pendingOperations.current.get(id);

          if (!operation) {
            console.warn(`No pending operation found for id: ${id}`);
            return;
          }

          switch (type) {
            case "progress":
              // Optional: You could emit progress events here
              break;

            case "complete":
              pendingOperations.current.delete(id);
              operation.resolve(result);
              break;

            case "error":
              pendingOperations.current.delete(id);
              operation.reject(new Error(error));
              break;
          }
        };

        workerRef.current.onerror = (error) => {
          console.error("Audio encoding worker error:", error);
          // Reject all pending operations
          for (const [id, operation] of pendingOperations.current) {
            operation.reject(new Error("Worker crashed"));
          }
          pendingOperations.current.clear();
          workerRef.current = null;
        };

        console.log("🎵 Audio encoding worker initialized");
      } catch (error) {
        console.error("Failed to initialize audio encoding worker:", error);
        workerRef.current = null;
      }
    }
    return workerRef.current;
  }, []);

  // Encode Float32Array to base64 using worker
  const encodeInWorker = useCallback(
    async (audioData: Float32Array): Promise<string> => {
      const worker = initWorker();

      if (!worker) {
        // Fallback to main thread if worker fails
        console.warn("Worker not available, falling back to main thread encoding");
        return float32ArrayToBase64(audioData);
      }

      const operationId = `encode_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<string>((resolve, reject) => {
        // Store the operation
        pendingOperations.current.set(operationId, { resolve, reject });

        // Set timeout for the operation
        const timeoutId = setTimeout(() => {
          if (pendingOperations.current.has(operationId)) {
            pendingOperations.current.delete(operationId);
            reject(new Error("Worker encoding timeout"));
          }
        }, 10000); // 10 second timeout

        // Override resolve/reject to clear timeout
        const originalResolve = resolve;
        const originalReject = reject;

        pendingOperations.current.set(operationId, {
          resolve: (result: string) => {
            clearTimeout(timeoutId);
            originalResolve(result);
          },
          reject: (error: Error) => {
            clearTimeout(timeoutId);
            originalReject(error);
          },
        });

        // Send work to worker
        worker.postMessage({
          command: "encodeFloat32ToBase64",
          id: operationId,
          data: {
            audioData: Array.from(audioData), // Convert to regular array for transfer
          },
        });
      });
    },
    [initWorker]
  );

  // Decode base64 to Float32Array using worker
  const decodeInWorker = useCallback(
    async (base64Data: string): Promise<Float32Array> => {
      const worker = initWorker();

      if (!worker) {
        // Fallback to main thread if worker fails
        console.warn("Worker not available, falling back to main thread decoding");
        return base64ToFloat32Array(base64Data);
      }

      const operationId = `decode_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      return new Promise<Float32Array>((resolve, reject) => {
        // Store the operation
        pendingOperations.current.set(operationId, { resolve, reject });

        // Set timeout for the operation
        const timeoutId = setTimeout(() => {
          if (pendingOperations.current.has(operationId)) {
            pendingOperations.current.delete(operationId);
            reject(new Error("Worker decoding timeout"));
          }
        }, 10000); // 10 second timeout

        // Override resolve/reject to clear timeout
        const originalResolve = resolve;
        const originalReject = reject;

        pendingOperations.current.set(operationId, {
          resolve: (result: number[]) => {
            clearTimeout(timeoutId);
            originalResolve(new Float32Array(result));
          },
          reject: (error: Error) => {
            clearTimeout(timeoutId);
            originalReject(error);
          },
        });

        // Send work to worker
        worker.postMessage({
          command: "decodeBase64ToFloat32",
          id: operationId,
          data: {
            base64Data,
          },
        });
      });
    },
    [initWorker]
  );

  // Initialize IndexedDB
  const initDB = useCallback(async (): Promise<IDBDatabase> => {
    if (dbRef.current) {
      return dbRef.current;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error("Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        dbRef.current = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("timestamp", "metadata.timestamp", { unique: false });
        }
      };
    });
  }, []);

  // Convert Float32Array to base64
  const float32ArrayToBase64 = useCallback((audioData: Float32Array): string => {
    const buffer = new ArrayBuffer(audioData.length * 4);
    const view = new Float32Array(buffer);
    view.set(audioData);

    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }, []);

  // Convert base64 back to Float32Array
  const base64ToFloat32Array = useCallback((base64: string): Float32Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
  }, []);

  // Create new session
  const createSession = useCallback(
    async (
      sessionId: string,
      metadata: {
        patientId?: number;
        patientName?: string;
        speciality: string;
      }
    ): Promise<void> => {
      try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const session: AudioSession = {
          id: sessionId,
          audioChunks: [],
          metadata: {
            ...metadata,
            timestamp: Date.now(),
            totalChunks: 0,
            completedChunks: 0,
            chunkIndices: [],
          },
          status: "recording",
          retryCount: 0,
        };

        await new Promise<void>((resolve, reject) => {
          const request = store.add(session);

          request.onsuccess = () => {
            console.log(`Created audio session ${sessionId}`);
            resolve();
          };

          request.onerror = () => {
            console.error("Failed to create session:", request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error("Error creating session:", error);
        throw error;
      }
    },
    [initDB]
  );

  const appendAudioToSession = useCallback(
    async (sessionId: string, audioData: Float32Array, sequence: number): Promise<void> => {
      try {
        const base64Audio = await encodeInWorker(audioData);
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        await new Promise<void>((resolve, reject) => {
          const getRequest = store.get(sessionId);

          getRequest.onsuccess = () => {
            const session = getRequest.result as AudioSession;
            if (!session) {
              resolve();
              return;
            }

            // Use object storage - no sparse arrays!
            const updatedSession = {
              ...session,
              audioChunks: { ...session.audioChunks },
              metadata: { ...session.metadata },
            };

            // Simply set the chunk
            updatedSession.audioChunks[sequence] = base64Audio;

            // Update metadata
            const chunkIndices = Object.keys(updatedSession.audioChunks)
              .map(Number)
              .sort((a, b) => a - b);
            updatedSession.metadata.chunkIndices = chunkIndices;
            updatedSession.metadata.completedChunks = chunkIndices.length;
            updatedSession.metadata.totalChunks = Math.max(
              updatedSession.metadata.totalChunks,
              sequence + 1
            );

            const updateRequest = store.put(updatedSession);
            updateRequest.onsuccess = () => resolve();
            updateRequest.onerror = () => reject(updateRequest.error);
          };

          getRequest.onerror = () => reject(getRequest.error);
        });
      } catch (error) {
        console.error(`Failed to append chunk ${sequence}:`, error);
      }
    },
    [initDB, encodeInWorker]
  );

  // Update retry to work with object storage
  const retrySession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);

        const session = await new Promise<AudioSession>((resolve, reject) => {
          const request = store.get(sessionId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        if (!session) return false;

        // Convert object chunks to ordered array
        const audioChunks: Float32Array[] = [];
        const chunkIndices = Object.keys(session.audioChunks)
          .map(Number)
          .sort((a, b) => a - b);

        console.log(
          `Found ${chunkIndices.length} chunks with indices: ${chunkIndices.slice(0, 10)}...`
        );

        for (const index of chunkIndices) {
          try {
            const base64Data = session.audioChunks[index];
            const float32Array = await decodeInWorker(base64Data);
            audioChunks.push(float32Array);
          } catch (error) {
            console.error(`Failed to decode chunk ${index}:`, error);
          }
        }

        if (audioChunks.length === 0) {
          console.error("No valid chunks found");
          return false;
        }

        await reprocessSession(audioChunks, session.metadata);
        return true;
      } catch (error) {
        console.error("Retry failed:", error);
        return false;
      }
    },
    [initDB, decodeInWorker, reprocessSession]
  );

  // Mark session as complete and delete it
  const markSessionComplete = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        await new Promise<void>((resolve, reject) => {
          const request = store.delete(sessionId);

          request.onsuccess = () => {
            console.log(`Deleted completed session ${sessionId}`);
            resolve();
          };

          request.onerror = () => {
            console.error("Failed to delete session:", request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error("Error marking session complete:", error);
        throw error;
      }
    },
    [initDB]
  );

  // Mark session as failed
  const markSessionFailed = useCallback(
    async (sessionId: string, error?: string): Promise<void> => {
      try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        // Get existing session
        const getRequest = store.get(sessionId);

        await new Promise<void>((resolve, reject) => {
          getRequest.onsuccess = () => {
            const session = getRequest.result as AudioSession;

            if (!session) {
              reject(new Error(`Session ${sessionId} not found`));
              return;
            }

            // Update session status
            session.status = "failed";
            session.lastError = error;

            const updateRequest = store.put(session);
            updateRequest.onsuccess = () => {
              console.log(`Marked session ${sessionId} as failed`);
              resolve();
            };
            updateRequest.onerror = () => reject(updateRequest.error);
          };

          getRequest.onerror = () => reject(getRequest.error);
        });
      } catch (error) {
        console.error("Error marking session failed:", error);
        throw error;
      }
    },
    [initDB]
  );

  // Delete specific session
  const deleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        await new Promise<void>((resolve, reject) => {
          const request = store.delete(sessionId);

          request.onsuccess = () => {
            console.log(`Deleted session ${sessionId}`);
            resolve();
          };

          request.onerror = () => {
            console.error("Failed to delete session:", request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error("Error deleting session:", error);
        throw error;
      }
    },
    [initDB]
  );

  // Get all failed sessions
  const getFailedSession = useCallback(async (): Promise<AudioSession | null> => {
    try {
      const db = await initDB();
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("status");

      return new Promise((resolve, reject) => {
        const request = index.getAll("failed");

        request.onsuccess = () => {
          resolve(request.result[0]);
        };

        request.onerror = () => {
          console.error("Failed to get failed sessions:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error getting failed sessions:", error);
      return null;
    }
  }, [initDB]);

  // Check if there are failed sessions
  const hasFailedSession = useCallback(async (): Promise<boolean> => {
    const failedSession = await getFailedSession();
    return !!failedSession;
  }, [getFailedSession]);

  // Clear failed sessions
  const clearFailedSessions = useCallback(async (): Promise<void> => {
    try {
      const db = await initDB();
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      await new Promise<void>((resolve, reject) => {
        const request = store.clear();

        request.onsuccess = () => {
          console.log("Cleared all audio sessions");
          resolve();
        };

        request.onerror = () => {
          console.error("Failed to clear sessions:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error clearing sessions:", error);
      throw error;
    }
  }, [initDB]);

  // Cleanup worker on unmount
  const cleanup = useCallback(() => {
    if (workerRef.current) {
      console.log("🧹 Cleaning up audio encoding worker");
      workerRef.current.terminate();
      workerRef.current = null;
    }
    pendingOperations.current.clear();

    if (dbRef.current) {
      dbRef.current.close();
      dbRef.current = null;
    }
  }, []);

  // Add cleanup effect
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    createSession,
    appendAudioToSession,
    markSessionComplete,
    markSessionFailed,
    retrySession,
    deleteSession,
    getFailedSession,
    hasFailedSession,
    clearFailedSessions,
  };
};

export default useAudioRecovery;
