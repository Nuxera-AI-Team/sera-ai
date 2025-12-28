"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface UseFFmpegConverterReturn {
  ffmpeg: null; // Always null since we use worker
  isLoaded: boolean;
  isConverting: boolean;
  progress: number;
  error: string | null;
  statusMessage: string;
  loadFFmpeg: () => Promise<boolean>;
  convertToWav: (
    audioData: Float32Array,
    sampleRate?: number,
    fileName?: string
  ) => Promise<File | null>;
  removeSilence: (file: File) => Promise<File | null>;
  reset: () => void;
}

const useFFmpegConverter = (): UseFFmpegConverterReturn => {
  const workerRef = useRef<Worker | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isInitializing, setIsInitializing] = useState(false);

  // Add a ref to track if we've completed initialization
  const initializationCompleteRef = useRef(false);
  const activeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isLoadedRef = useRef(isLoaded);

  useEffect(() => {
    isLoadedRef.current = isLoaded;
    if (isLoaded) {
      initializationCompleteRef.current = true;
    }
    console.log(`🔄 FFmpeg Worker isLoadedRef updated to: ${isLoaded}`);
  }, [isLoaded]);

  const loadFFmpeg = useCallback(async (): Promise<boolean> => {
    // Prevent multiple initialization attempts
    if (isInitializing) {
      console.log("FFmpeg worker initialization already in progress...");
      return false;
    }

    if (isLoaded && workerRef.current) {
      console.log("FFmpeg worker already loaded");
      return true;
    }

    // If initialization was completed but somehow state got reset
    if (initializationCompleteRef.current && workerRef.current) {
      console.log("FFmpeg worker was previously initialized, returning true");
      setIsLoaded(true);
      return true;
    }

    setIsInitializing(true);
    setError(null);

    try {
      console.log("🚀 Initializing FFmpeg worker...");
      setStatusMessage("Creating worker...");

      const worker = new Worker("/ffmpeg-worker.js");
      workerRef.current = worker;

      return new Promise<boolean>((resolve, reject) => {
        let isResolved = false; // Prevent multiple resolutions

        const resolveOnce = (result: boolean, error?: Error) => {
          if (isResolved) return;
          isResolved = true;

          setIsInitializing(false);

          // Clear the active timeout
          if (activeTimeoutRef.current) {
            clearTimeout(activeTimeoutRef.current);
            activeTimeoutRef.current = null;
          }

          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        };

        worker.onmessage = (e) => {
          const { type, message, success, error, fallback } = e.data;

          switch (type) {
            case "moduleProgress":
              setStatusMessage(message);
              break;

            case "moduleLoaded":
              if (success) {
                console.log("✅ FFmpeg module loaded in worker, initializing...");
                setStatusMessage("Module loaded, initializing...");
                worker.postMessage({ command: "init" });
              } else {
                console.error("❌ Failed to load FFmpeg module in worker:", error);
                setError(error || "Failed to load FFmpeg module in worker");
                resolveOnce(false, new Error(error || "Failed to load FFmpeg module"));
              }
              break;

            case "initProgress":
              setStatusMessage(message);
              break;

            case "initComplete":
              if (success) {
                initializationCompleteRef.current = true; // Mark as completed
                setIsLoaded(true);
                setError(null);
                setStatusMessage("");
                console.log("🎉 FFmpeg worker initialization complete!");
                resolveOnce(true);
              } else {
                setError(error || "Failed to initialize FFmpeg worker");
                setIsLoaded(false);
                setStatusMessage("");
                resolveOnce(false, new Error(error || "Failed to initialize FFmpeg worker"));
              }
              break;

            case "error":
              setError(error || "Worker error");
              setIsLoaded(false);
              setStatusMessage("");
              resolveOnce(false, new Error(error || "Worker error"));
              break;
          }
        };

        worker.onerror = (error) => {
          console.error("💥 FFmpeg worker error:", error);
          setError("Worker failed to start");
          setIsLoaded(false);
          setStatusMessage("");
          resolveOnce(false, new Error("Worker failed to start"));
        };

        // Start by loading the FFmpeg module
        worker.postMessage({ command: "loadFFmpeg" });

        // Set timeout and store reference
        activeTimeoutRef.current = setTimeout(() => {
          // Only timeout if we haven't already resolved
          if (!isResolved && !initializationCompleteRef.current) {
            console.log("⏰ Worker initialization timeout after 45s");
            setError("Worker initialization timeout");
            setStatusMessage("");
            resolveOnce(false, new Error("Worker initialization timeout"));
          }
        }, 45000);
      });
    } catch (e) {
      console.error("💥 Failed to create FFmpeg worker:", e);
      setIsInitializing(false);
      setError("Failed to create worker");
      return false;
    }
  }, [isLoaded, isInitializing]);

  // Cleanup worker and timeout on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        console.log("🧹 Cleaning up FFmpeg worker");
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current);
        activeTimeoutRef.current = null;
      }
      initializationCompleteRef.current = false;
    };
  }, []);

  // Add convertToWav function using the worker
  const convertToWav = useCallback(
    async (
      audioData: Float32Array,
      sampleRate = 44100,
      fileName?: string
    ): Promise<File | null> => {
      if (!workerRef.current) {
        console.error("FFmpeg worker not available for WAV conversion");
        setError("Worker not available");
        return null;
      }

      if (!audioData || audioData.length === 0) {
        setError("No audio data provided for WAV conversion");
        return null;
      }

      try {
        setIsConverting(true);
        setError(null);
        setProgress(0);
        setStatusMessage("Converting to WAV...");

        return new Promise<File | null>((resolve) => {
          const worker = workerRef.current!;

          const messageHandler = (e: MessageEvent) => {
            const { type, progress: workerProgress, message, result, error } = e.data;

            switch (type) {
              case "progress":
                setProgress(workerProgress);
                setStatusMessage(message);
                break;

              case "complete":
                worker.removeEventListener("message", messageHandler);

                try {
                  const wavFile = new File([new Uint8Array(result.data)], result.name, {
                    type: result.type,
                  });

                  setProgress(100);
                  setStatusMessage("WAV conversion complete!");

                  setTimeout(() => {
                    setIsConverting(false);
                    setProgress(0);
                    setStatusMessage("");
                  }, 1000);

                  resolve(wavFile);
                } catch (fileError) {
                  console.error("Error creating WAV file:", fileError);
                  setIsConverting(false);
                  setProgress(0);
                  setStatusMessage("");
                  resolve(null);
                }
                break;

              case "error":
                worker.removeEventListener("message", messageHandler);
                console.error("Worker WAV conversion error:", error);
                setError(`WAV conversion failed: ${error}`);
                setIsConverting(false);
                setProgress(0);
                setStatusMessage("");
                resolve(null);
                break;
            }
          };

          worker.addEventListener("message", messageHandler);

          worker.onerror = (workerError) => {
            worker.removeEventListener("message", messageHandler);
            console.error("Worker error during WAV conversion:", workerError);
            setError("Worker WAV conversion failed");
            setIsConverting(false);
            setProgress(0);
            setStatusMessage("");
            resolve(null);
          };

          // Start conversion
          worker.postMessage({
            command: "convertToWav",
            data: {
              audioData: Array.from(audioData), // Convert to regular array for transfer
              sampleRate,
              fileName: fileName || `audio-${Date.now()}.wav`,
            },
          });
        });
      } catch (err) {
        console.error("Worker WAV conversion failed:", err);
        setError("WAV conversion failed");
        setIsConverting(false);
        setProgress(0);
        setStatusMessage("");
        return null;
      }
    },
    []
  );

  const removeSilence = useCallback(async (file: File): Promise<File | null> => {
    if (!isLoadedRef.current || !workerRef.current) {
      console.error("FFmpeg worker not loaded");
      setError("FFmpeg worker not loaded");
      return file; // Return original file
    }

    if (!file) {
      setError("No file provided for processing");
      return null;
    }

    // Check file size
    const maxFileSize = 50 * 1024 * 1024; // 50MB limit
    if (file.size > maxFileSize) {
      console.warn(`File too large (${file.size} bytes), skipping silence removal`);
      return file;
    }

    try {
      setIsConverting(true);
      setError(null);
      setProgress(0);
      setStatusMessage("Starting audio processing...");

      return new Promise<File | null>((resolve, reject) => {
        const worker = workerRef.current!;

        const messageHandler = (e: MessageEvent) => {
          const { type, progress: workerProgress, message, result, error } = e.data;

          switch (type) {
            case "progress":
              setProgress(workerProgress);
              setStatusMessage(message);
              break;

            case "complete":
              worker.removeEventListener("message", messageHandler);

              try {
                const processedFile = new File([new Uint8Array(result.data)], result.name, {
                  type: result.type,
                });

                console.log("📊 Silence removal + FLAC compression results:", result.stats);

                setProgress(100);
                setStatusMessage("Processing complete!");

                setTimeout(() => {
                  setIsConverting(false);
                  setProgress(0);
                  setStatusMessage("");
                }, 1000);

                resolve(processedFile);
              } catch (fileError) {
                console.error("Error creating processed file:", fileError);
                setIsConverting(false);
                setProgress(0);
                setStatusMessage("");
                resolve(file); // Return original file
              }
              break;

            case "error":
              worker.removeEventListener("message", messageHandler);
              console.error("Worker processing error:", error);
              setError(`Processing failed: ${error}`);
              setIsConverting(false);
              setProgress(0);
              setStatusMessage("");
              resolve(file); // Return original file instead of failing
              break;
          }
        };

        worker.addEventListener("message", messageHandler);

        worker.onerror = (workerError) => {
          worker.removeEventListener("message", messageHandler);
          console.error("Worker error during processing:", workerError);
          setError("Worker processing failed");
          setIsConverting(false);
          setProgress(0);
          setStatusMessage("");
          resolve(file); // Return original file
        };

        // Start processing
        worker.postMessage({
          command: "removeSilence",
          data: {
            file,
            fileName: file.name,
            fileType: file.type,
          },
        });
      });
    } catch (err) {
      console.error("Worker removeSilence failed:", err);
      setError("Audio processing failed");
      setIsConverting(false);
      setProgress(0);
      setStatusMessage("");
      return file; // Return original file
    }
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        console.log("🧹 Cleaning up FFmpeg worker");
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  return {
    ffmpeg: null, // Worker only, no direct ffmpeg access
    isLoaded,
    isConverting,
    progress,
    error,
    statusMessage,
    loadFFmpeg,
    convertToWav,
    removeSilence,
    reset: useCallback(() => {
      setError(null);
      setProgress(0);
      setIsConverting(false);
      setStatusMessage("");
    }, []),
  };
};

export default useFFmpegConverter;
