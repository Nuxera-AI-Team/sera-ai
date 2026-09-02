import { useCallback, useEffect, useRef } from "react";

interface AudioSession {
  id: string;
  audioChunks: Record<number, string>; // Change from array to object
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
    sampleRate: number; // Store original sample rate for correct WAV conversion on retry
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

/**
 * One in-flight worker request. The payloads differ per operation (an encoded
 * string for one, a number[] for another) and the rejecters take a concrete
 * Error, so no single precise parameter type covers them: `unknown` is rejected
 * at the call sites because a function parameter cannot be widened.
 */
type PendingOperation = {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  /* eslint-enable @typescript-eslint/no-explicit-any */
};

const useAudioRecovery = (
  reprocessSession: (
    audioChunks: Float32Array[],
    metadata: AudioSession["metadata"]
  ) => Promise<void>
): AudioRecoveryHookReturn => {
  const dbRef = useRef<IDBDatabase | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingOperations = useRef<Map<string, PendingOperation>>(new Map());

  const DB_NAME = "AudioSessionDB";
  const STORE_NAME = "audioSessions";
  const DB_VERSION = 1;

  const createAudioEncodingWorker = () => {
    const workerCode = `
      console.log("[SERA] Audio encoding worker loaded");

      self.onmessage = function (e) {
        const { command, data, id } = e.data;

        try {
          switch (command) {
            case "encodeFloat32ToBase64": {
              const { audioData } = data;

              self.postMessage({
                type: "progress",
                id,
                message: "Converting audio data...",
              });

              const float32Array =
                audioData instanceof Float32Array ? audioData : new Float32Array(audioData);

              console.log("[SERA] Worker encoding audio | samples=" + float32Array.length);

              const buffer = new ArrayBuffer(float32Array.length * 4);
              const view = new Float32Array(buffer);
              view.set(float32Array);

              const bytes = new Uint8Array(buffer);
              const chunkSize = 8192;
              let binary = "";

              for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.slice(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, Array.from(chunk));

                if (i % (chunkSize * 10) === 0 && i > 0) {
                  const progress = Math.round((i / bytes.length) * 100);
                  self.postMessage({
                    type: "progress",
                    id,
                    progress,
                    message: "Encoding... " + progress + "%",
                  });
                }
              }

              const base64 = btoa(binary);

              self.postMessage({
                type: "complete",
                id,
                result: base64,
              });
              break;
            }

            case "decodeBase64ToFloat32": {
              const { base64Data } = data;

              self.postMessage({
                type: "progress",
                id,
                message: "Decoding audio data...",
              });

              try {
                const binary = atob(base64Data);

                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }

                const float32Result = new Float32Array(bytes.buffer);

                console.log("[SERA] Worker decoded audio | samples=" + float32Result.length);

                self.postMessage({
                  type: "complete",
                  id,
                  result: Array.from(float32Result),
                });
              } catch (decodeError) {
                self.postMessage({
                  type: "error",
                  id,
                  error: "Decode failed: " + decodeError.message,
                });
              }
              break;
            }

            default:
              self.postMessage({
                type: "error",
                id,
                error: "Unknown command: " + command,
              });
          }
        } catch (error) {
          console.error("[SERA] Audio encoding worker error:", error);
          self.postMessage({
            type: "error",
            id,
            error: error.message,
            stack: error.stack,
          });
        }
      };

      self.onerror = function (error) {
        console.error("[SERA] Audio encoding worker script error:", error);
        self.postMessage({
          type: "error",
          error: error.message || "Unknown worker error",
        });
      };
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    return URL.createObjectURL(blob);
  };

  // Initialize the encoding worker
  const initWorker = useCallback(() => {
    if (!workerRef.current) {
      try {
        const workerUrl = createAudioEncodingWorker();
        workerRef.current = new Worker(workerUrl);
        URL.revokeObjectURL(workerUrl);

        workerRef.current.onmessage = (e) => {
          const { type, id, result, error } = e.data;
          const operation = pendingOperations.current.get(id);

          if (!operation) {
            console.warn(`[SERA] No pending worker operation found | id=${id}`);
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
          console.error("[SERA] Audio encoding worker error:", error);
          // Reject all pending operations
          for (const operation of pendingOperations.current.values()) {
            operation.reject(new Error("Worker crashed"));
          }
          pendingOperations.current.clear();
          workerRef.current = null;
        };

        console.log("[SERA] Audio encoding worker initialized");
      } catch (error) {
        console.error("[SERA] Audio encoding worker initialization failed:", error);
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
        console.warn("[SERA] Worker not available, falling back to main thread encoding");
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
        console.warn("[SERA] Worker not available, falling back to main thread decoding");
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
        console.error("[SERA] Failed to open IndexedDB:", request.error);
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
      }
    ): Promise<void> => {
      try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const session: AudioSession = {
          id: sessionId,
          audioChunks: {},
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
            console.log(`[SERA] Audio session created | sessionId=${sessionId}`);
            resolve();
          };

          request.onerror = () => {
            console.error("[SERA] Failed to create audio session:", request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error("[SERA] Error creating audio session:", error);
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
        console.error(`[SERA] Failed to append audio chunk | sequence=${sequence}:`, error);
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

        console.log(`[SERA] Retrying session | sessionId=${sessionId}, chunks=${chunkIndices.length}`);

        for (const index of chunkIndices) {
          try {
            const base64Data = session.audioChunks[index];
            const float32Array = await decodeInWorker(base64Data);
            audioChunks.push(float32Array);
          } catch (error) {
            console.error(`[SERA] Failed to decode audio chunk | index=${index}:`, error);
          }
        }

        if (audioChunks.length === 0) {
          console.error("[SERA] No valid audio chunks found for retry");
          return false;
        }

        await reprocessSession(audioChunks, session.metadata);
        return true;
      } catch (error) {
        console.error("[SERA] Session retry failed:", error);
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
            console.log(`[SERA] Deleted completed session | sessionId=${sessionId}`);
            resolve();
          };

          request.onerror = () => {
            console.error("[SERA] Failed to delete session:", request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error("[SERA] Error marking session complete:", error);
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
              console.log(`[SERA] Session marked as failed | sessionId=${sessionId}`);
              resolve();
            };
            updateRequest.onerror = () => reject(updateRequest.error);
          };

          getRequest.onerror = () => reject(getRequest.error);
        });
      } catch (error) {
        console.error("[SERA] Error marking session failed:", error);
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
            console.log(`[SERA] Deleted session | sessionId=${sessionId}`);
            resolve();
          };

          request.onerror = () => {
            console.error("[SERA] Failed to delete session:", request.error);
            reject(request.error);
          };
        });
      } catch (error) {
        console.error("[SERA] Error deleting session:", error);
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
          console.error("[SERA] Failed to get failed sessions:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("[SERA] Error getting failed sessions:", error);
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
          console.log("[SERA] Cleared all audio sessions");
          resolve();
        };

        request.onerror = () => {
          console.error("[SERA] Failed to clear sessions:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("[SERA] Error clearing sessions:", error);
      throw error;
    }
  }, [initDB]);

  // Cleanup worker on unmount
  const cleanup = useCallback(() => {
    if (workerRef.current) {
      console.log("[SERA] Cleaning up audio encoding worker");
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
