import React, { useEffect, useRef, useState, useCallback, MutableRefObject } from "react";
import useFFmpegConverter from "./useFFmpegConverter";
import useAudioRecovery from "./useAudioRecovery";
import pRetry, { AbortError } from "p-retry";
import useHL7FHIRConverter from "./useHL7FHIRConverter";
import { ClassificationInfoResponse } from "../types";

interface AudioRecorderHookProps {
  apiKey: string;
  speciality: string;
  patientId?: number;
  patientName?: string;
  selectedFormat?: "json" | "hl7" | "fhir";
  skipDiarization?: boolean;
  silenceRemoval?: boolean;
  onTranscriptionUpdate: (text: string, sessionId: string) => void;
  onTranscriptionComplete: (
    text: string,
    classification: ClassificationInfoResponse,
    sessionId: string
  ) => void;
}

interface UseAudioRecorderReturn {
  mediaStreamRef: MutableRefObject<MediaStream | null>;
  startRecording: () => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  isRecording: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  error: string | null;
  transcriptionDone: boolean;
  // New microphone properties
  availableDevices: MediaDeviceInfo[];
  currentDeviceId: string | null;
  selectMicrophone: (deviceId: string) => Promise<void>;
  validateMicrophoneAccess: () => Promise<boolean>;
  audioLevel: number;
  noAudioDetected: boolean;

  // Recovery-related properties
  showRetrySessionPrompt: boolean;
  isRetryingSession: boolean;
  retryFailedSession: () => Promise<void>;
  clearAllSessions: () => Promise<void>;

  // Add FFmpeg status properties
  isConverting: boolean;
  progress: number;
  statusMessage: string;
}

const useAudioRecorder = ({
  apiKey,
  speciality,
  patientId,
  patientName,
  selectedFormat = "json",
  skipDiarization = true,
  silenceRemoval = true,
  onTranscriptionUpdate,
  onTranscriptionComplete,
}: AudioRecorderHookProps): UseAudioRecorderReturn => {
  const [uploadChunkInterval, setUploadChunkInterval] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyDoneTranscription, setAlreadyDoneTranscription] = useState("");
  const [transcriptionDone, setTranscriptionDone] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);

  // Add new state for audio monitoring
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [noAudioDetected, setNoAudioDetected] = useState(false);

  const audioSamplesRef = useRef<Float32Array[]>([]);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const processorRef = React.useRef<AudioWorkletNode | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const sessionIdRef = React.useRef<string | null>(null); // This will be server session ID
  const localSessionIdRef = React.useRef<string | null>(null); // This will be our IndexedDB session ID

  const doctorName = "asad";

  const [selectedModel, setSelectedModel] = React.useState<string>("new-large");

  const [isRetryingSession, setIsRetryingSession] = React.useState(false);
  const [showRetrySessionPrompt, setShowRetrySessionPrompt] = React.useState(false);

  // Use the provided apiKey or fall back to selectedApiKey
  const effectiveApiKey = apiKey;

  const {
    convertTranscriptionResponse,
    conversionError,
    clearError,
    createHL7TranscriptionRequest,
    createFHIRTranscriptionRequest,
  } = useHL7FHIRConverter();

  // Add helper function to combine audio chunks (moved before useAudioRecovery)
  const combineAudioChunks = React.useCallback((audioChunks: Float32Array[]): Float32Array => {
    const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of audioChunks) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    return combinedAudio;
  }, []);

  // Create a ref for uploadChunkToServer to avoid closure issues
  const uploadChunkToServerRef = React.useRef<
    | ((
        audioData: Float32Array,
        isFirst: boolean,
        sequence: number,
        isFinal: boolean,
        isPaused?: boolean
      ) => Promise<void>)
    | null
  >(null);

  // Update the useAudioRecovery callback with better logging
  const {
    createSession,
    appendAudioToSession,
    markSessionComplete,
    markSessionFailed,
    retrySession,
    deleteSession,
    getFailedSession,
    hasFailedSession,
    clearFailedSessions,
  } = useAudioRecovery(async (audioChunks, metadata) => {
    // Reprocess session callback - send combined audio as single final chunk
    try {
      console.log("🔄 Retry callback started with audio chunks:", {
        chunksCount: audioChunks.length,
        totalSamples: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
        chunkDetails: audioChunks.map((chunk, idx) => ({
          index: idx,
          length: chunk.length,
          hasData: chunk.length > 0,
        })),
      });

      if (audioChunks.length === 0) {
        throw new Error("No audio chunks provided for retry");
      }

      // Combine all audio chunks into one
      const combinedAudio = combineAudioChunks(audioChunks);

      console.log("🔊 Combined audio for retry:", {
        combinedLength: combinedAudio.length,
        hasAudio: combinedAudio.length > 0,
      });

      if (combinedAudio.length === 0) {
        throw new Error("Combined audio is empty");
      }

      // Check if uploadChunkToServer is available
      if (!uploadChunkToServerRef.current) {
        throw new Error("Upload function not yet initialized");
      }

      // Generate a fresh session ID for retry (server will create new session)
      const newSessionId = `session_retry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log("🆔 Generated new retry session ID:", newSessionId);

      // Send as first AND final chunk to create complete new session
      await uploadChunkToServerRef.current(combinedAudio, true, 0, true, false);

      console.log("✅ Retry upload completed successfully");
    } catch (error) {
      console.error("❌ Retry session failed:", error);
      throw error;
    }
  });

  const chunkQueueRef = React.useRef<
    {
      chunk: Float32Array | null;
      isFinal: boolean;
      sequence: number;
      isPaused?: boolean;
    }[]
  >([]);
  const isProcessingQueueRef = React.useRef(false);
  const sequenceCounterRef = React.useRef(0);
  const receivedTranscriptionsRef = React.useRef<Map<number, string>>(new Map());
  const nextExpectedSequenceRef = React.useRef(0);

  const selectedModelRef = React.useRef(selectedModel);
  const skipDiarizationRef = React.useRef(skipDiarization);
  const removeSilenceRef = React.useRef(silenceRemoval);
  const selectedFormatRef = React.useRef(selectedFormat);

  const {
    removeSilence,
    isLoaded,
    isConverting,
    loadFFmpeg,
    progress,
    statusMessage,
    convertToWav,
  } = useFFmpegConverter();

  // Add ref to track the current isLoaded value
  const isLoadedRef = React.useRef(isLoaded);

  // Update the ref whenever isLoaded changes
  React.useEffect(() => {
    isLoadedRef.current = isLoaded;
    console.log(`🔄 isLoadedRef updated to: ${isLoaded}`);
  }, [isLoaded]);

  React.useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  React.useEffect(() => {
    skipDiarizationRef.current = skipDiarization;
  }, [skipDiarization]);

  React.useEffect(() => {
    removeSilenceRef.current = silenceRemoval;
  }, [silenceRemoval]);

  React.useEffect(() => {
    selectedFormatRef.current = selectedFormat;
  }, [selectedFormat]);

  React.useEffect(() => {
    // Use server session ID for callbacks, fallback to local session ID
    onTranscriptionUpdate(
      alreadyDoneTranscription,
      sessionIdRef.current || localSessionIdRef.current || ""
    );
  }, [alreadyDoneTranscription, onTranscriptionUpdate]);

  // Add useEffect to track speciality changes
  React.useEffect(() => {
    console.log("Speciality changed in useAudioRecorder:", speciality);
  }, [speciality]);

  React.useEffect(() => {
    let isMounted = true;

    // Only initialize FFmpeg once
    if (!isLoadedRef.current) {
      (async () => {
        console.log("Initializing FFmpeg…");
        try {
          const ok = await loadFFmpeg();
          if (isMounted) {
            console.log("FFmpeg init returned:", ok);
            if (ok) {
              console.log("FFmpeg initialized successfully for audio recorder");
            }
          }
        } catch (error) {
          if (isMounted) {
            console.error("FFmpeg initialization failed:", error);
          }
        }
      })();
    } else {
      console.log("FFmpeg already initialized, skipping");
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Microphone validation and detection
  const validateMicrophoneAccess = React.useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices.filter((device) => device.kind === "audioinput");

      setAvailableDevices(audioInputDevices);

      if (audioInputDevices.length === 0) {
        throw new Error("No microphone devices detected. Please connect a microphone.");
      }

      // Test microphone access with actual getUserMedia call
      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined,
        },
      });

      // Get device information
      const audioTracks = testStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        const settings = track.getSettings();
        setCurrentDeviceId(settings.deviceId || null);
        console.log("Microphone validated:", track.label, settings.deviceId);
      }

      // Clean up test stream
      testStream.getTracks().forEach((track) => track.stop());
      setError(null); // Clear any previous errors
      return true;
    } catch (error) {
      console.error("Microphone validation failed:", error);

      if (error instanceof Error) {
        let errorMessage = "";

        if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          errorMessage = "No microphone found. Please connect a microphone and refresh.";
        } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
          errorMessage =
            "Microphone access denied. Please allow microphone permissions in your browser settings.";
        } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
          errorMessage = "Microphone is busy. Please close other apps using the microphone.";
        } else if (error.name === "OverconstrainedError") {
          errorMessage = "Selected microphone is unavailable. Please choose another device.";
        } else {
          errorMessage = error.message;
        }
        setError(errorMessage); // Set the main error state
      } else {
        const errorMessage = "Microphone access error occurred.";
        setError(errorMessage);
      }

      return false;
    }
  }, [currentDeviceId]);

  // Initial microphone check - only when component mounts or speciality changes
  React.useEffect(() => {
    if (speciality) {
      // Don't validate immediately, wait for user interaction
      console.log("Speciality set, microphone validation will happen on recording start");
    }
  }, [speciality]);

  // Check for failed sessions on component mount instead of chunks
  React.useEffect(() => {
    const checkFailedSessions = async () => {
      const failedSession = await hasFailedSession();
      if (failedSession) {
        setShowRetrySessionPrompt(true);
      }
    };
    checkFailedSessions();
  }, [hasFailedSession]);

  // Update clear function to work with sessions
  const clearAllSessions = React.useCallback(async () => {
    await clearFailedSessions();
    setShowRetrySessionPrompt(false);
  }, [clearFailedSessions]);

  // Update the uploadChunkToServer function
  const uploadChunkToServer = React.useCallback(
    async (
      audioData: Float32Array | null,
      isFinalChunk: boolean,
      sequence: number,
      retry = false,
      isPausedChunk = false
    ) => {
      const currentIsLoaded = isLoadedRef.current;

      console.log("🔧 uploadChunkToServer called with:", {
        isLoaded: currentIsLoaded,
        silenceRemovalEnabled: removeSilenceRef.current,
        hasRemoveSilenceFunction: typeof removeSilence === "function",
        isFinalChunk,
        sequence,
        audioDataLength: audioData?.length,
        requestFormat: selectedFormatRef.current, // Log the request format
      });

      processorRef.current?.port.postMessage({ command: "resetUploadChunk" });

      // Save chunk to local session first
      if (audioData && localSessionIdRef.current && !retry) {
        try {
          await appendAudioToSession(localSessionIdRef.current, audioData, sequence);
          console.log(`✅ Successfully saved audio chunk ${sequence} to local session`);
        } catch (error) {
          console.error(`❌ Failed to save audio to local session:`, error);
        }
      }

      // Wrap the server call in p-retry
      try {
        const data = await pRetry(
          async (attemptNumber) => {
            console.log(`🔄 Transcribe attempt ${attemptNumber} for sequence ${sequence}`);

            // Prepare audio file first
            if (!audioData || audioData.length === 0) {
              if (retry) {
                throw new AbortError("No audio data provided for retry");
              }
              throw new Error("No audio data provided");
            }

            const sampleRate = audioContextRef.current?.sampleRate || 16000;
            const timestamp = Date.now();
            const fileName = `audio-chunk-${timestamp}.wav`;

            let wavFile: File | null = await convertToWav(audioData, sampleRate, fileName);

            if (!wavFile) {
              throw new Error("WAV conversion failed through FFmpeg");
            }

            // Apply silence removal if enabled
            if (currentIsLoaded && removeSilenceRef.current) {
              try {
                console.log("Attempting to remove silence from audio chunk...");
                const processedFile = await removeSilence(wavFile);
                if (processedFile) {
                  console.log("Silence removed successfully");
                  wavFile = processedFile;
                } else {
                  console.warn("Silence removal returned null, using original file");
                }
              } catch (silenceError) {
                console.warn("Silence removal failed, using original file:", silenceError);
              }
            }

            // Prepare request data
            const requestData = {
              sessionId: retry ? undefined : sessionIdRef.current || undefined,
              model: selectedModelRef.current,
              doctorName: doctorName,
              patientName: patientName || "",
              patientId: patientId,
              removeSilence: removeSilenceRef.current,
              skipDiarization: skipDiarizationRef.current,
              isFinalChunk: isFinalChunk,
              isPaused: isPausedChunk,
              sequence: sequence,
              speciality: speciality,
              retry: retry,
            };

            let formData: FormData;
            let contentType: string | undefined;

            // Create request body based on selected format
            switch (selectedFormatRef.current) {
              case "hl7":
                formData = createHL7TranscriptionRequest(wavFile, requestData);
                contentType = "multipart/form-data; hl7-request=true";
                console.log("Created HL7-formatted request");
                console.log("HL7 FormData entries:", Array.from(formData.entries()));
                break;

              case "fhir":
                formData = createFHIRTranscriptionRequest(wavFile, requestData);
                contentType = "multipart/form-data; fhir-request=true";
                console.log("Created FHIR-formatted request");
                console.log("FHIR FormData entries:", Array.from(formData.entries()));
                break;

              case "json":
              default:
                // Original JSON format
                formData = new FormData();

                if (retry) {
                  formData.append("retry", "true");
                } else if (sessionIdRef.current) {
                  formData.append("sessionId", sessionIdRef.current);
                }

                formData.append("audio", wavFile);
                formData.append("model", selectedModelRef.current);
                formData.append("doctorName", doctorName);
                formData.append("patientName", patientName || "");
                if (patientId) formData.append("patientId", patientId.toString());
                formData.append("removeSilence", removeSilenceRef.current.toString());
                formData.append("skipDiarization", skipDiarizationRef.current.toString());
                formData.append("isFinalChunk", isFinalChunk.toString());
                formData.append("isPaused", isPausedChunk.toString());
                formData.append("sequence", sequence.toString());
                formData.append("speciality", speciality);

                console.log("Created JSON-formatted request");
                break;
            }

            // Prepare headers
            const headers: Record<string, string> = {
              "x-api-key": effectiveApiKey || "",
              "x-response-format": selectedFormatRef.current,
              "x-request-format": selectedFormatRef.current, // Add request format header
            };

            // Don't set Content-Type for FormData - let browser set it with boundary
            // if (contentType) {
            //   headers["Content-Type"] = contentType;
            // }

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_BACKEND}/api/transcribe`, {
              method: "POST",
              headers: headers,
              body: formData,
            });

            // Handle different types of errors
            if (!response.ok) {
              const errorText = await response.text();

              console.error("Transcription server error response:", {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
              });

              let errorMessage = `HTTP ${response.status}`;

              try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.message || errorMessage;
              } catch {
                errorMessage = errorText || errorMessage;
              }

              if (response.status === 401) {
                throw new AbortError(
                  "Transcription service authentication failed. Please check your API key configuration."
                );
              } else if (response.status >= 400 && response.status < 500) {
                throw new AbortError(`Client error: ${errorMessage}`);
              } else {
                throw new Error(`Server error: ${errorMessage}`);
              }
            }

            // Handle different response formats based on Content-Type

            let responseData: any;

            if (selectedFormatRef.current === "json") {
              responseData = await response.json();
              console.log("Parsed JSON response:", responseData);
            } else if (selectedFormatRef.current === "hl7") {
              responseData = await response.text();
              console.log("Received HL7 response:", responseData);
            } else if (selectedFormatRef.current === "fhir") {
              responseData = await response.json(); // FHIR is JSON-based
              console.log("Received FHIR response:", responseData);
            } else {
              const responseText = await response.text();
              try {
                responseData = JSON.parse(responseText);
                console.log("Fallback: Parsed as JSON:", responseData);
              } catch {
                responseData = responseText;
                console.log("Fallback: Using as text:", responseData);
              }
            }

            // Convert the response using our converter hook
            const convertedData = convertTranscriptionResponse(
              responseData,
              selectedFormatRef.current
            );
            console.log("Original response:", responseData);
            console.log("Converted response:", convertedData);

            return convertedData;
          },
          {
            retries: 3,
            factor: 2,
            minTimeout: 1000,
            maxTimeout: 10000,
            randomize: true,
            onFailedAttempt: (error) => {
              console.warn(
                `⚠️ Transcribe attempt ${error.attemptNumber} failed for sequence ${sequence}:`,
                {
                  error: error,
                  retriesLeft: error.retriesLeft,
                }
              );

              if (error.retriesLeft > 0) {
                setError(
                  `Network issue detected. Retrying... (${error.retriesLeft} attempts remaining)`
                );
              }
            },
          }
        );

        // Clear any conversion errors on success
        if (conversionError) {
          clearError();
        }

        // Clear any retry-related error messages on success
        if (error && error.includes("Retrying")) {
          setError(null);
        }

        // Update server session ID when received from server
        if (retry && data.sessionId) {
          console.log("✅ Retry successful - received new server session ID:", data.sessionId);
          sessionIdRef.current = data.sessionId;
        } else if (!retry && data.sessionId && !sessionIdRef.current) {
          console.log("✅ Received initial server session ID:", data.sessionId);
          sessionIdRef.current = data.sessionId;
        }

        receivedTranscriptionsRef.current.set(sequence, data.transcription);

        // Append in order
        while (receivedTranscriptionsRef.current.has(nextExpectedSequenceRef.current)) {
          const t = receivedTranscriptionsRef.current.get(nextExpectedSequenceRef.current)!;
          setAlreadyDoneTranscription(t);
          receivedTranscriptionsRef.current.delete(nextExpectedSequenceRef.current);
          nextExpectedSequenceRef.current++;
        }

        if (isFinalChunk) {
          setTranscriptionDone(true);
          // Pass the converted data to the callback
          onTranscriptionComplete(data.transcription, data.classifiedInfo, sessionIdRef.current!);

          // Clear LOCAL session only on successful final chunk + medical note generation
          if (localSessionIdRef.current) {
            await markSessionComplete(localSessionIdRef.current);
            setShowRetrySessionPrompt(false);
          }
        }
      } catch (err) {
        console.error(`❌ Upload error occurred after all retries:`, err);

        // Include conversion errors in error handling
        if (conversionError) {
          console.error("Conversion error during upload:", conversionError);
          setError(`Data conversion failed: ${conversionError}`);
        }

        const isAbortError = err instanceof Error && err.name === "AbortError";
        const statusCode =
          err instanceof Error && err.message.includes("HTTP")
            ? parseInt(err.message.split("HTTP")[1].trim())
            : null;

        // Mark LOCAL session as failed but keep the audio data for retry
        if (localSessionIdRef.current) {
          await markSessionFailed(
            localSessionIdRef.current,
            err instanceof Error ? err.message : "Unknown error"
          );

          if (isFinalChunk) {
            setShowRetrySessionPrompt(true);
          }
        }

        // Set appropriate error messages for different scenarios
        if (
          err instanceof Error &&
          (err.message.includes("authentication failed") || statusCode === 401)
        ) {
          setError(
            "Authentication failed. Audio saved offline - please check your API key and retry."
          );
        } else if (
          err instanceof Error &&
          (err.message === "Failed to fetch" || err.name === "TypeError" || !navigator.onLine)
        ) {
          setError(
            "No internet connection. Audio saved offline - transcription will start when connection is restored."
          );
        } else if (
          err instanceof Error &&
          (err.message.includes("HTTP 5") || err.message.includes("Server error"))
        ) {
          setError(
            "Server error occurred after multiple attempts. Audio saved offline - you can retry transcription."
          );
        } else if (isAbortError) {
          setError(
            err instanceof Error
              ? err.message.replace(
                  "Transcription service authentication failed. Please check your API key configuration.",
                  "Authentication failed. Audio saved offline - please check your API key and retry."
                )
              : "Request failed. Audio saved offline - you can retry."
          );
        } else {
          setError(
            "Transcription failed after multiple attempts. Audio saved offline - you can retry transcription."
          );
        }
      } finally {
        if (isFinalChunk) setIsProcessing(false);
      }
    },
    [
      selectedModel,
      silenceRemoval,
      skipDiarization,
      selectedFormat,
      patientName,
      onTranscriptionComplete,
      speciality,
      removeSilence,
      convertToWav,
      appendAudioToSession,
      markSessionComplete,
      markSessionFailed,
      getFailedSession,
      error,
      convertTranscriptionResponse,
      conversionError,
      clearError,
      createHL7TranscriptionRequest, // Add new dependencies
      createFHIRTranscriptionRequest,
    ]
  );

  // Assign the function to the ref for use in callbacks
  uploadChunkToServerRef.current = uploadChunkToServer;

  // Update the retry function to work with sessions
  const retryFailedSession = React.useCallback(async () => {
    setIsRetryingSession(true);
    try {
      const failedSession = await getFailedSession();

      if (failedSession) {
        const success = await retrySession(failedSession.id);
        if (success) {
          console.log(`Successfully retried session ${failedSession.id}`);
          setError(null);
        }
      }
    } catch (error) {
      console.error("Error retrying failed sessions:", error);
      setError("Failed to retry sessions. Please try again.");
    } finally {
      setIsRetryingSession(false);
    }
  }, [retrySession, getFailedSession]);

  const startRecording = React.useCallback(async () => {
    try {
      // Clear any previous errors
      setError(null);
      setNoAudioDetected(false);

      // Pre-flight microphone check
      const micValid = await validateMicrophoneAccess();
      if (!micValid) {
        return;
      }

      audioSamplesRef.current = [];

      // Always create a new session when starting recording
      if (!isPaused) {
        setAlreadyDoneTranscription("");
        setTranscriptionDone(false);
        // Reset sequence tracking
        sequenceCounterRef.current = 0;
        nextExpectedSequenceRef.current = 0;
        receivedTranscriptionsRef.current.clear();

        // Create new LOCAL session ID for IndexedDB storage
        const localSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localSessionIdRef.current = localSessionId;

        // Reset server session ID (will be set when server responds)
        sessionIdRef.current = null;

        console.log("Created local session ID for IndexedDB:", localSessionId);

        await createSession(localSessionId, {
          patientId,
          patientName: patientName || undefined,
          speciality,
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // Track device info
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        const settings = track.getSettings();
        setCurrentDeviceId(settings.deviceId || null);
        console.log("Recording started with local session:", localSessionIdRef.current);

        // Monitor for device disconnection
        track.addEventListener("ended", () => {
          console.log("Audio track ended - device disconnected");
          setError("Microphone disconnected. Session saved - please reconnect and retry.");
          stopRecording();
        });
      }

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioContext.audioWorklet.addModule("/audio-processor.js");

      const processor = new AudioWorkletNode(audioContext, "audio-processor");

      processor.port.onmessage = (event) => {
        const {
          command,
          audioBuffer,
          level,
          silentDuration,
          hasDetectedAudio,
          isInitialPhase,
          totalRecordingTime,
          lastAudioTime,
        } = event.data;
        const sequence = sequenceCounterRef.current++;

        if (command === "finalChunk" && audioBuffer) {
          console.log("Received finalChunk with audioBuffer", audioBuffer);
          enqueueChunk(new Float32Array(audioBuffer), true, sequence);
        } else if (command === "uploadChunk" && audioBuffer) {
          enqueueChunk(new Float32Array(audioBuffer), false, sequence);
        } else if (command === "pauseChunk" && audioBuffer) {
          console.log("Received pauseChunk with audioBuffer", audioBuffer);
          enqueueChunk(new Float32Array(audioBuffer), false, sequence, true);
        } else if (command === "audioLevel") {
          setAudioLevel(level);
        } else if (command === "prolongedSilence") {
          console.log(
            `Prolonged silence detected: ${Math.round(silentDuration)}s silent, ${Math.round(
              totalRecordingTime
            )}s total, last audio ${Math.round(lastAudioTime)}s ago`
          );
        } else if (command === "noAudioDetected") {
          console.log(
            `No audio detected: ${Math.round(
              silentDuration
            )}s silent, hasDetectedAudio: ${hasDetectedAudio}, isInitialPhase: ${isInitialPhase}`
          );
          setNoAudioDetected(true);

          let errorMessage;
          if (isInitialPhase && !hasDetectedAudio) {
            errorMessage = `No audio input detected for ${Math.round(
              silentDuration
            )} seconds. Please check your microphone setup.`;
          } else {
            errorMessage = `Extended silence detected (${Math.round(
              silentDuration
            )} seconds). Recording has been stopped.`;
          }

          setError(errorMessage);
          stopRecording();
        }
      };

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(processor);

      audioContextRef.current = audioContext;
      processorRef.current = processor;
      setIsRecording(true);

      const intervalId = window.setInterval(() => {
        processorRef.current?.port.postMessage({ command: "uploadChunk" });
      }, 47000);
      setUploadChunkInterval(intervalId);
    } catch (err) {
      console.error("Recording start failed:", err);
      // Error handling remains the same...
    }
  }, [
    validateMicrophoneAccess,
    isPaused,
    createSession,
    patientId,
    patientName,
    speciality,
    currentDeviceId,
  ]);

  const stopRecording = React.useCallback(async () => {
    console.log("Stopping recording...");

    if (uploadChunkInterval) {
      clearInterval(uploadChunkInterval);
      setUploadChunkInterval(null);
    }

    if (processorRef.current) {
      console.log("Stopping recording and sending final chunk --> ", isPaused ? "paused" : "final");
      processorRef.current.port.postMessage({ command: "stop" });

      setTimeout(async () => {
        if (processorRef.current) {
          processorRef.current.disconnect();
          processorRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
      }, 500);
    }

    setIsRecording(false);
  }, [uploadChunkInterval]);

  // Device change monitoring
  React.useEffect(() => {
    const handleDeviceChange = async () => {
      console.log("Audio device change detected");

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputDevices = devices.filter((device) => device.kind === "audioinput");
        setAvailableDevices(audioInputDevices);

        // If no audio devices are available, set error
        if (audioInputDevices.length === 0) {
          setError("No microphone devices detected. Please connect a microphone.");
          return;
        }

        // Check if current device is still available during recording
        if (isRecording && currentDeviceId) {
          const currentDeviceExists = audioInputDevices.some(
            (device) => device.deviceId === currentDeviceId
          );
          if (!currentDeviceExists) {
            setError("Microphone disconnected during recording. Please reconnect and restart.");
            stopRecording();
          }
        }
      } catch (error) {
        console.error("Device change detection failed:", error);
        setError("Unable to detect audio devices. Please check your microphone permissions.");
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [isRecording, currentDeviceId, stopRecording]);

  // Device selection handler
  const selectMicrophone = React.useCallback(
    async (deviceId: string) => {
      try {
        setCurrentDeviceId(deviceId);

        // Restart recording with new device if currently recording
        if (isRecording) {
          stopRecording();
          setTimeout(() => {
            startRecording();
          }, 1000);
        }
      } catch (error) {
        console.error("Device selection failed:", error);
        setError("Failed to switch to selected microphone.");
      }
    },
    [isRecording, stopRecording, startRecording]
  );

  const pauseRecording = React.useCallback(() => {
    if (!isRecording || isPaused) return;

    // Stop the upload chunk timer
    if (uploadChunkInterval) {
      clearInterval(uploadChunkInterval);
      setUploadChunkInterval(null);
    }

    setIsPaused(true);

    // Suspend the worklet processor (this will automatically send pauseChunk)
    if (processorRef.current) {
      processorRef.current.port.postMessage({ command: "pause" });
    }

    setIsRecording(false);
  }, [isRecording, isPaused, uploadChunkInterval]);

  // Add resumeRecording update to reset no audio detection
  const resumeRecording = React.useCallback(() => {
    if (!isPaused) return;
    setIsPaused(false);
    setIsRecording(true);
    setNoAudioDetected(false); // Reset no audio detection when resuming

    // Resume the worklet processor
    if (processorRef.current) {
      processorRef.current.port.postMessage({ command: "resume" });
    }

    // Restart the upload chunk timer
    const intervalId = window.setInterval(() => {
      processorRef.current?.port.postMessage({ command: "uploadChunk" });
    }, 47000);
    setUploadChunkInterval(intervalId);
  }, [isPaused]);

  const processNextChunkInQueue = React.useCallback(() => {
    if (isProcessingQueueRef.current || chunkQueueRef.current.length === 0) return;

    const { chunk, isFinal, sequence, isPaused = false } = chunkQueueRef.current.shift()!;
    isProcessingQueueRef.current = true;

    uploadChunkToServer(chunk, isFinal, sequence, false, isPaused).finally(() => {
      isProcessingQueueRef.current = false;
      processNextChunkInQueue();
    });
  }, [uploadChunkToServer, isLoaded]);

  const enqueueChunk = React.useCallback(
    (
      audioData: Float32Array | null,
      isFinalChunk: boolean,
      sequence: number,
      isPausedChunk = false
    ) => {
      if (isFinalChunk) {
        console.log("Enqueuing final chunk:", sequence);
        setIsProcessing(true);
      }

      chunkQueueRef.current.push({
        chunk: audioData,
        isFinal: isFinalChunk,
        sequence,
        isPaused: isPausedChunk,
      });
      processNextChunkInQueue();
    },
    [processNextChunkInQueue, isLoaded]
  );

  const float32ToWavFile = (samples: Float32Array): File => {
    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    // Create File instead of Blob
    const timestamp = Date.now();
    const filename = `audio-chunk-${timestamp}.wav`;

    return new File([view], filename, {
      type: "audio/wav",
      lastModified: timestamp,
    });
  };

  return {
    mediaStreamRef,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    isProcessing,
    error: error,
    transcriptionDone,
    // New microphone features
    availableDevices,
    currentDeviceId,
    selectMicrophone,
    validateMicrophoneAccess,
    // Add audio monitoring properties
    audioLevel,
    noAudioDetected,
    // Add recovery-related properties
    showRetrySessionPrompt,
    isRetryingSession,
    retryFailedSession,
    clearAllSessions,
    // Add FFmpeg status - THIS IS THE MISSING PART
    isConverting,
    progress,
    statusMessage,
  };
};

export default useAudioRecorder;
