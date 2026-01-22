import React, { useEffect, useRef, useState, useCallback, MutableRefObject } from "react";
import useFFmpegConverter from "./useFFmpegConverter";
import useAudioRecovery from "./useAudioRecovery";
import pRetry, { AbortError } from "p-retry";
import useHL7FHIRConverter from "./useHL7FHIRConverter";
import { ClassificationInfoResponse } from "../types";
import { AUDIO_SAMPLE_RATE } from "../constants/audio";

interface AudioRecorderHookProps {
  apiKey: string;
  apiBaseUrl?: string;
  speciality: string;
  patientId?: number;
  patientName?: string;
  patientHistory?: string;
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

  // Add test function for debugging
  testAudioCapture: () => Promise<void>;
}

// Internal API configuration - this will be used by the npm package
// Change this URL to match your actual API endpoint before publishing
const API_BASE_URL = "https://nuxera.cloud";

// Embedded Audio Processor Worker - no external files needed
const createAudioProcessorWorker = () => {
  const workerCode = `
    class AudioProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this._buffer = [];
        this._isStopped = false;
        this._isPaused = false;
        this._uploadChunk = false;
        this._uploadingChunk = false;

        // Get sample rate from processor options or use sampleRate from AudioWorkletGlobalScope
        this._sampleRate = options?.processorOptions?.sampleRate || sampleRate;

        this._audioLevelCheckInterval = 0;
        this._audioLevelCheckFrequency = 128;
        this._silentSampleCount = 0;
        this._maxSilentSamples = this._sampleRate * 30;
        this._audioThreshold = 0.002; // Increased from 0.001 to better detect speech
        this._hasDetectedAudio = false;
        this._totalSilentTime = 0;
        this._lastAudioTime = 0;
        this._recordingStartTime = Date.now();
        this._initialSilenceThreshold = this._sampleRate * 10;
        this._isInitialPhase = true;
        this._bufferSize = 0; // Track total samples in buffer

        this.port.onmessage = (event) => {
          if (event.data.command === "stop") {
            this._isStopped = true;
            // Ensure we have valid audio data before sending
            if (this._buffer.length > 0) {
              // Properly flatten the buffer by concatenating Float32Arrays
              let totalLength = 0;
              for (let i = 0; i < this._buffer.length; i++) {
                totalLength += this._buffer[i].length;
              }
              
              const flat = new Float32Array(totalLength);
              let offset = 0;
              for (let i = 0; i < this._buffer.length; i++) {
                flat.set(this._buffer[i], offset);
                offset += this._buffer[i].length;
              }
              
              this.port.postMessage(
                {
                  command: "finalChunk",
                  audioBuffer: flat.buffer,
                },
                [flat.buffer]
              );
            } else {
              // Send empty final chunk to complete the session
              const emptyBuffer = new Float32Array(1000);
              this.port.postMessage(
                {
                  command: "finalChunk", 
                  audioBuffer: emptyBuffer.buffer,
                },
                [emptyBuffer.buffer]
              );
            }
            this._buffer = [];
          }

          if (event.data.command === "uploadChunk") {
            this._uploadChunk = true;
          }

          if (event.data.command === "resetUploadChunk") {
            // Only reset the upload flags, NOT the buffer
            // The buffer is cleared after chunk data is extracted and sent
            this._uploadChunk = false;
            this._uploadingChunk = false;
            // NOTE: Do NOT clear buffer here - it's cleared in the chunk upload logic after data is sent
          }

          if (event.data.command === "pause") {
            this._isPaused = true;
          }

          if (event.data.command === "resume") {
            this._isPaused = false;
          }
        };
      }

      process(inputs, outputs) {
        if (this._isStopped || this._isPaused) {
          return true;
        }

        const input = inputs[0];
        if (input && input.length > 0) {
          const samples = input[0];
          
          let audioLevel = 0;
          for (let i = 0; i < samples.length; i++) {
            audioLevel += Math.abs(samples[i]);
          }
          audioLevel /= samples.length;

          this._audioLevelCheckInterval++;
          if (this._audioLevelCheckInterval >= this._audioLevelCheckFrequency) {
            this.port.postMessage({
              command: "audioLevel",
              level: audioLevel,
            });
            this._audioLevelCheckInterval = 0;
            
            // Debug: Log audio capture status every few seconds
            if (this._audioLevelCheckInterval % 1000 === 0) {
            }
          }

          if (audioLevel > this._audioThreshold) {
            this._hasDetectedAudio = true;
            this._isInitialPhase = false;
            this._silentSampleCount = 0;
            this._lastAudioTime = Date.now();
          } else {
            this._silentSampleCount += samples.length;
            
            if (this._isInitialPhase && this._silentSampleCount > this._initialSilenceThreshold) {
              this.port.postMessage({
                command: "noAudioDetected",
                message: "No audio input detected after 10 seconds. Please check your microphone."
              });
              return true;
            }
            
            if (this._hasDetectedAudio && this._silentSampleCount > this._maxSilentSamples) {
              this.port.postMessage({
                command: "noAudioDetected",
                message: "No audio detected for 30 seconds. Recording may have issues."
              });
            }
          }

          this._buffer.push(new Float32Array(samples));
          this._bufferSize += samples.length;

          if (this._uploadChunk && !this._uploadingChunk) {
            this._uploadingChunk = true;

            // Properly flatten the buffer by concatenating Float32Arrays
            let totalLength = 0;
            for (let i = 0; i < this._buffer.length; i++) {
              totalLength += this._buffer[i].length;
            }

            const flat = new Float32Array(totalLength);
            let offset = 0;
            for (let i = 0; i < this._buffer.length; i++) {
              flat.set(this._buffer[i], offset);
              offset += this._buffer[i].length;
            }

            // Always send chunks to server - let server handle silence filtering
            if (this._bufferSize > 0) {
              this.port.postMessage(
                {
                  command: "chunk",
                  audioBuffer: flat.buffer,
                  bufferDuration: this._bufferSize / this._sampleRate
                },
                [flat.buffer]
              );
              console.log('[UPLOAD] Sending chunk: ' + (this._bufferSize / this._sampleRate).toFixed(1) + 's');
              // Clear buffer after upload
              this._buffer = [];
              this._bufferSize = 0;
            }

            this._uploadChunk = false;
            this._uploadingChunk = false;
          }
        }

        return true;
      }
    }

    registerProcessor("audio-processor", AudioProcessor);
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};

const useAudioRecorder = ({
  apiKey,
  apiBaseUrl = API_BASE_URL,
  speciality,
  patientId,
  patientName,
  patientHistory,
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

  // Track if a chunk upload has failed during the current recording session
  // If true, we skip further uploads but continue recording audio to IndexedDB
  const sessionHasFailedChunkRef = React.useRef(false);

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
        isPaused?: boolean,
        sampleRateOverride?: number
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

      console.log("[AUDIO] Combined audio for retry:", {
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
      await uploadChunkToServerRef.current(
        combinedAudio,
        true,
        0,
        true,
        false,
        metadata.sampleRate
      );

      console.log("[SUCCESS] Retry upload completed successfully");
    } catch (error) {
      console.error("[ERROR] Retry session failed:", error);
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
    convertToFlac,
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
    console.log("Triggering onTranscriptionUpdate with:", {
      alreadyDoneTranscription,
      sessionId: sessionIdRef.current,
      localSessionId: localSessionIdRef.current,
    });
    if (alreadyDoneTranscription.length > 0) {
      onTranscriptionUpdate(
        alreadyDoneTranscription,
        sessionIdRef.current || localSessionIdRef.current || ""
      );
    }
  }, [alreadyDoneTranscription]);

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
  const validateMicrophoneAccess = React.useCallback(async (): Promise<boolean> => {
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
        console.log();
      }

      // Clean up the test stream
      testStream.getTracks().forEach((track) => track.stop());

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

  // NOTE: We no longer show retry prompt on mount - only when user stops recording after a failure
  // This ensures the user isn't interrupted with retry prompts from previous sessions
  // Failed sessions remain in IndexedDB and can be retried if the user starts a new recording

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
      isPausedChunk = false,
      sampleRateOverride?: number
    ) => {
      const currentIsLoaded = isLoadedRef.current;

      console.log("🔧 uploadChunkToServer called with:", {
        isLoaded: currentIsLoaded,
        silenceRemovalEnabled: removeSilenceRef.current,
        hasRemoveSilenceFunction: typeof removeSilence === "function",
        isFinalChunk,
        sequence,
        audioDataLength: audioData?.length,
        requestFormat: selectedFormatRef.current,
        sessionHasFailed: sessionHasFailedChunkRef.current,
      });

      processorRef.current?.port.postMessage({ command: "resetUploadChunk" });

      // Save chunk to local session first (always save to IndexedDB regardless of failure state)
      if (audioData && localSessionIdRef.current && !retry) {
        try {
          console.log(`[DB] Saving chunk ${sequence} to IndexedDB session ${localSessionIdRef.current}`);
          await appendAudioToSession(localSessionIdRef.current, audioData, sequence);
          console.log(`[DB] ✓ Successfully saved audio chunk ${sequence} to IndexedDB (${audioData.length} samples)`);
        } catch (error) {
          console.error(`[DB] ✗ Failed to save audio chunk ${sequence} to IndexedDB:`, error);
        }
      } else {
        console.log(`[DB] Skipping IndexedDB save: audioData=${!!audioData}, sessionId=${localSessionIdRef.current}, retry=${retry}`);
      }

      // If a previous chunk has failed, skip server upload but continue recording
      // Show retry UI only when user stops recording (isFinalChunk)
      if (sessionHasFailedChunkRef.current && !retry) {
        console.log(`[SKIP] Session has failed chunk - skipping server upload for sequence ${sequence}, continuing to record audio`);
        if (isFinalChunk) {
          // User has stopped recording - now show the retry UI
          setShowRetrySessionPrompt(true);
          setIsProcessing(false);
        }
        return;
      }

      // Wrap the server call in p-retry
      try {
        const data = await pRetry(
          async (attemptNumber) => {
            console.log(`🔄 Transcribe attempt ${attemptNumber} for sequence ${sequence}`);

            // Prepare audio file first
            if (!audioData || audioData.length === 0) {
              console.log();
              if (retry) {
                throw new AbortError("No audio data provided for retry");
              }
              throw new Error("No audio data provided");
            }

            console.log();

            const currentSampleRate = sampleRateOverride ?? (audioContextRef.current?.sampleRate || AUDIO_SAMPLE_RATE);
            console.log(
              `[PROCESSING] Processing audio chunk: ${audioData.length} samples (${(audioData.length / currentSampleRate).toFixed(2)}s)`
            );

            // Log audio content for debugging (no longer skipping chunks)
            let maxAmplitude = 0;
            let nonZeroSamples = 0;

            for (let i = 0; i < audioData.length; i++) {
              const amplitude = Math.abs(audioData[i]);
              if (amplitude > maxAmplitude) maxAmplitude = amplitude;
              if (amplitude > 0.001) {
                nonZeroSamples++;
              }
            }

            const audioPercentage = nonZeroSamples / audioData.length;
            console.log(
              `[AUDIO] Audio stats: maxAmplitude=${maxAmplitude.toFixed(4)}, audioContent=${(audioPercentage * 100).toFixed(2)}%, sequence=${sequence}, isFinal=${isFinalChunk}`
            );

            const sampleRate = sampleRateOverride ?? (audioContextRef.current?.sampleRate || AUDIO_SAMPLE_RATE);
            const timestamp = Date.now();
            const fileName = `audio-chunk-${timestamp}.wav`;

            let wavFile: File | null = await convertToWav(audioData, sampleRate, fileName);

            if (!wavFile) {
              throw new Error("WAV conversion failed through FFmpeg");
            }

            console.log(`[INFO] Original WAV file: ${wavFile.size} bytes, ${wavFile.name}`);

            // Apply silence removal if enabled
            if (currentIsLoaded && removeSilenceRef.current) {
              try {
                console.log("[SILENCE] Attempting to remove silence from audio chunk...");
                const processedFile = await removeSilence(wavFile);
                if (processedFile) {
                  console.log(
                    `[SUCCESS] Silence removed successfully: ${processedFile.size} bytes (was ${wavFile.size} bytes)`
                  );

                  // Check if the processed file is too small (less than 1KB indicates likely over-processing)
                  if (processedFile.size < 1000) {
                    console.warn(
                      `[WARN] Processed file very small (${processedFile.size} bytes), using original file`
                    );
                    // Use original file if processed file is suspiciously small
                  } else {
                    wavFile = processedFile;
                  }
                } else {
                  console.warn("Silence removal returned null, using original file");
                }
              } catch (silenceError) {
                console.warn("Silence removal failed, using original file:", silenceError);
              }
            } else {
              console.log("[SILENCE] Silence removal disabled or not loaded");
            }

            // Convert WAV to FLAC for upload
            let audioFile: File = wavFile;
            try {
              console.log("[FLAC] Converting WAV to FLAC...");
              const flacFile = await convertToFlac(wavFile);
              if (flacFile && flacFile.type === "audio/flac") {
                audioFile = flacFile;
                console.log(
                  `[FLAC] Conversion successful: ${wavFile.size} bytes WAV → ${flacFile.size} bytes FLAC`
                );
              } else {
                console.warn("[FLAC] Conversion failed, using WAV file");
              }
            } catch (flacError) {
              console.warn("[FLAC] Conversion error, using WAV file:", flacError);
            }

            console.log(
              `[OUT] Final file for transcription: ${audioFile.size} bytes, ${audioFile.name}`
            );

            // Log warning for very small files but don't skip them - let server decide
            if (audioFile.size < 500) {
              console.warn(
                `[WARN] Small audio file (${audioFile.size} bytes) - may contain minimal audio data, sending to server anyway`
              );
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
                formData = createHL7TranscriptionRequest(audioFile, requestData);
                contentType = "multipart/form-data; hl7-request=true";
                console.log("Created HL7-formatted request");
                console.log("HL7 FormData entries:", Array.from(formData.entries()));
                break;

              case "fhir":
                formData = createFHIRTranscriptionRequest(audioFile, requestData);
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

                formData.append("audio", audioFile);
                formData.append("model", selectedModelRef.current);
                formData.append("doctorName", doctorName);
                formData.append("patientName", patientName || "");
                if (patientHistory) formData.append("patientHistory", patientHistory);
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

            const response = await fetch(`${apiBaseUrl}/api/transcribe`, {
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
                `[WARN] Transcribe attempt ${error.attemptNumber} failed for sequence ${sequence}:`,
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
        if (!data) {
          throw new Error("No data received from transcription server");
        }

        console.log(`[SUCCESS] Received transcription for sequence ${sequence}:`, data);

        // Update server session ID when received from server
        if (retry && data.sessionId) {
          console.log(
            "[SUCCESS] Retry successful - received new server session ID:",
            data.sessionId
          );
          sessionIdRef.current = data.sessionId;
        } else if (!retry && data.sessionId && !sessionIdRef.current) {
          console.log("[SUCCESS] Received initial server session ID:", data.sessionId);
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
        console.error(`[ERROR] Upload error occurred after all retries:`, err);

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
        // Set the failed flag so subsequent chunks skip server upload but continue recording
        if (localSessionIdRef.current && !retry) {
          sessionHasFailedChunkRef.current = true;
          await markSessionFailed(
            localSessionIdRef.current,
            err instanceof Error ? err.message : "Unknown error"
          );
          console.log(`[FAIL] Chunk ${sequence} failed - session marked as failed, will continue recording audio locally`);

          // Only show retry UI when user stops recording (final chunk)
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

        // Re-throw error when this is a retry attempt so the caller knows it failed
        if (retry) {
          throw err;
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
      patientHistory,
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
    let retrySucceeded = false;
    let failedSessionId: string | null = null;

    try {
      const failedSession = await getFailedSession();
      failedSessionId = failedSession?.id || null;

      if (failedSession) {
        const success = await retrySession(failedSession.id);
        if (success) {
          console.log(`Successfully retried session ${failedSession.id}`);
          // Delete the session from IndexedDB after successful retry
          await deleteSession(failedSession.id);
          console.log(`Deleted session ${failedSession.id} from IndexedDB after successful retry`);
          setError(null);
          retrySucceeded = true;
        } else {
          // Retry failed - will show retry UI in finally block
          console.log(`Retry failed for session ${failedSession.id} - will show retry UI`);
          setError("Retry failed. Please check your connection and try again.");
        }
      }
    } catch (error) {
      console.error("Error retrying failed sessions:", error);
      setError("Failed to retry sessions. Please try again.");
    } finally {
      setIsRetryingSession(false);
      // Set retry prompt visibility AFTER isRetryingSession is set to false
      // This ensures the UI updates correctly
      if (retrySucceeded) {
        setShowRetrySessionPrompt(false);
      } else if (failedSessionId) {
        // Only show retry UI if there was a failed session to retry
        setShowRetrySessionPrompt(true);
      } else {
        // No failed session found
        setShowRetrySessionPrompt(false);
      }
    }
  }, [retrySession, getFailedSession, deleteSession]);

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

        // Reset failed chunk flag for new recording session
        sessionHasFailedChunkRef.current = false;
        chunkQueueRef.current = []; // Clear any pending chunks

        // Create new LOCAL session ID for IndexedDB storage
        const localSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localSessionIdRef.current = localSessionId;

        // Reset server session ID (will be set when server responds)
        sessionIdRef.current = null;

        console.log("Created local session ID for IndexedDB:", localSessionId);
        // Note: Session will be created after audio context is initialized (need sampleRate)
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

      // Create session with actual sample rate now that we have audioContext
      if (!isPaused && localSessionIdRef.current) {
        await createSession(localSessionIdRef.current, {
          patientId,
          patientName: patientName || undefined,
          patientHistory: patientHistory || undefined,
          speciality,
          sampleRate: audioContext.sampleRate,
        });
      }

      // Create audio processor worker dynamically
      const processorUrl = createAudioProcessorWorker();
      await audioContext.audioWorklet.addModule(processorUrl);

      // Clean up the blob URL
      URL.revokeObjectURL(processorUrl);

      const processor = new AudioWorkletNode(audioContext, "audio-processor", {
        processorOptions: { sampleRate: audioContext.sampleRate }
      });

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

        // Handle chunk messages (increment sequence only for actual chunks)
        if (command === "finalChunk" && audioBuffer) {
          const sequence = sequenceCounterRef.current++;
          const audioArray = new Float32Array(audioBuffer);
          console.log(`[RECEIVE] Final chunk: ${audioArray.length} samples, sequence: ${sequence}`);
          enqueueChunk(audioArray, true, sequence);
        } else if (command === "chunk" && audioBuffer) {
          const sequence = sequenceCounterRef.current++;
          const audioArray = new Float32Array(audioBuffer);
          console.log(`[RECEIVE] Chunk: ${audioArray.length} samples, sequence: ${sequence}`);
          enqueueChunk(audioArray, false, sequence);
        } else if (command === "pauseChunk" && audioBuffer) {
          const sequence = sequenceCounterRef.current++;
          console.log(`[RECEIVE] Pause chunk with audioBuffer, sequence: ${sequence}`);
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
    patientHistory,
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

    // Check if session failed during recording - if so, show retry UI
    console.log("🔍 Stop recording - checking for failed session:", {
      hasSessionFailed: sessionHasFailedChunkRef.current,
      localSessionId: localSessionIdRef.current,
    });
    if (sessionHasFailedChunkRef.current && localSessionIdRef.current) {
      console.log("⚠️ Recording stopped with failed session - showing retry UI");
      setShowRetrySessionPrompt(true);
    }
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

  const processNextChunkInQueue = React.useCallback(async () => {
    // Don't process if already processing or queue is empty
    if (isProcessingQueueRef.current || chunkQueueRef.current.length === 0) {
      return;
    }

    const { chunk, isFinal, sequence, isPaused = false } = chunkQueueRef.current.shift()!;
    console.log(`[QUEUE] Processing chunk ${sequence} from queue, remaining: ${chunkQueueRef.current.length}`);
    isProcessingQueueRef.current = true;

    // uploadChunkToServer handles:
    // 1. Saving to IndexedDB (always, regardless of session failure state)
    // 2. Uploading to server (only if session hasn't failed)
    // 3. Marking session as failed on error
    uploadChunkToServer(chunk, isFinal, sequence, false, isPaused)
      .finally(() => {
        isProcessingQueueRef.current = false;
        processNextChunkInQueue(); // Continue processing remaining chunks
      });
  }, [uploadChunkToServer, isLoaded]);

  const enqueueChunk = React.useCallback(
    (
      audioData: Float32Array | null,
      isFinalChunk: boolean,
      sequence: number,
      isPausedChunk = false
    ) => {
      console.log(`[QUEUE] Enqueuing ${isFinalChunk ? 'FINAL' : isPausedChunk ? 'PAUSED' : 'regular'} chunk ${sequence}, samples: ${audioData?.length || 0}, queue size: ${chunkQueueRef.current.length}`);

      if (isFinalChunk) {
        // Only set processing state if session hasn't failed
        // If session has failed, we're just saving to IndexedDB (no server processing)
        if (!sessionHasFailedChunkRef.current) {
          setIsProcessing(true);
        } else {
          console.log("⚠️ Session has failed - skipping processing state (IndexedDB save only)");
        }
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
    const sampleRate = audioContextRef.current?.sampleRate || AUDIO_SAMPLE_RATE;
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

  // Add a test function to verify audio capture
  const testAudioCapture = useCallback(async () => {
    try {
      console.log("Audio Test Starting audio capture test...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      console.log("Audio Test Got media stream:", stream.id);

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      let testCount = 0;
      const testInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const max = Math.max(...dataArray);

        console.log(
          `Audio Test Frame ${testCount}: avg=${average.toFixed(2)}, max=${max}, hasSound=${max > 10 ? "YES" : "NO"}`
        );

        testCount++;
        if (testCount >= 10) {
          clearInterval(testInterval);
          stream.getTracks().forEach((track) => track.stop());
          audioContext.close();
          console.log("Audio Test Audio capture test complete");
        }
      }, 500);
    } catch (error) {
      console.error("Audio Test Audio capture test failed:", error);
    }
  }, []);

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
    // Add test function for debugging
    testAudioCapture,
  };
};

export default useAudioRecorder;
