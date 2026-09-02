import { useState, useRef, useCallback, MutableRefObject } from "react";
import useFFmpegConverter from "./useFFmpegConverter";
import { isValidSampleRate, InvalidSampleRateError } from "../constants/audio";

interface AudioCaptureHookProps {
  onAudioChunk?: (
    audioData: Float32Array,
    sequence: number,
    isFinal: boolean,
    sampleRate: number
  ) => void;
  onAudioComplete?: (finalAudio: Float32Array, sampleRate: number) => void;
  onAudioFile?: (audioFile: File) => void;
  silenceRemoval?: boolean;
  chunkDuration?: number; // Duration in seconds for each chunk
  format?: "raw" | "wav"; // Output format
}

interface UseAudioCaptureReturn {
  mediaStreamRef: MutableRefObject<MediaStream | null>;
  startRecording: () => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  isRecording: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  error: string | null;
  
  // Microphone properties
  availableDevices: MediaDeviceInfo[];
  currentDeviceId: string | null;
  selectMicrophone: (deviceId: string) => Promise<void>;
  validateMicrophoneAccess: () => Promise<boolean>;
  audioLevel: number;
  noAudioDetected: boolean;

  // FFmpeg status properties
  isConverting: boolean;
  progress: number;
  statusMessage: string;

  // Audio data properties
  recordingDuration: number;
  totalChunks: number;
}

// Embedded Audio Processor Worker for capturing audio
const createAudioCaptureWorker = () => {
  const workerCode = `
    class AudioCaptureProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this._buffer = [];
        this._isStopped = false;
        this._isPaused = false;
        this._chunkReady = false;
        this._processingChunk = false;

        // Get sample rate from processor options or use sampleRate from AudioWorkletGlobalScope
        this._sampleRate = options?.processorOptions?.sampleRate || sampleRate;

        this._audioLevelCheckInterval = 0;
        this._audioLevelCheckFrequency = 128;
        this._silentSampleCount = 0;
        this._maxSilentSamples = this._sampleRate * 30;
        this._audioThreshold = 0.002;
        this._hasDetectedAudio = false;
        this._lastAudioTime = 0;
        this._recordingStartTime = Date.now();
        this._initialSilenceThreshold = this._sampleRate * 10;
        this._isInitialPhase = true;
        this._bufferSize = 0;

        this.port.onmessage = (event) => {
          if (event.data.command === "stop") {
            this._isStopped = true;
            this._sendFinalChunk();
          }

          if (event.data.command === "getChunk") {
            this._chunkReady = true;
          }

          if (event.data.command === "resetChunk") {
            this._chunkReady = false;
            this._processingChunk = false;
            this._buffer = [];
            this._bufferSize = 0;
          }

          if (event.data.command === "pause") {
            this._isPaused = true;
          }

          if (event.data.command === "resume") {
            this._isPaused = false;
          }
        };
      }

      _sendFinalChunk() {
        if (this._buffer.length > 0) {
          const flat = this._flattenBuffer();
          this.port.postMessage({
            command: "finalChunk",
            audioBuffer: flat.buffer,
            duration: this._bufferSize / this._sampleRate
          }, [flat.buffer]);
        } else {
          // Send empty final chunk
          const emptyBuffer = new Float32Array(1000);
          this.port.postMessage({
            command: "finalChunk", 
            audioBuffer: emptyBuffer.buffer,
            duration: 0
          }, [emptyBuffer.buffer]);
        }
        this._buffer = [];
        this._bufferSize = 0;
      }

      _flattenBuffer() {
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
        return flat;
      }

      process(inputs, outputs) {
        if (this._isStopped || this._isPaused) {
          return true;
        }

        const input = inputs[0];
        if (input && input.length > 0) {
          const samples = input[0];
          
          // Calculate audio level
          let audioLevel = 0;
          for (let i = 0; i < samples.length; i++) {
            audioLevel += Math.abs(samples[i]);
          }
          audioLevel /= samples.length;

          // Send audio level updates
          this._audioLevelCheckInterval++;
          if (this._audioLevelCheckInterval >= this._audioLevelCheckFrequency) {
            this.port.postMessage({
              command: "audioLevel",
              level: audioLevel,
            });
            this._audioLevelCheckInterval = 0;
          }

          // Check for audio activity
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
          }

          // Buffer the audio
          this._buffer.push(new Float32Array(samples));
          this._bufferSize += samples.length;

          // Send chunk if ready
          if (this._chunkReady && !this._processingChunk) {
            this._processingChunk = true;

            const flat = this._flattenBuffer();
            this.port.postMessage({
              command: "chunk",
              audioBuffer: flat.buffer,
              duration: this._bufferSize / this._sampleRate,
              hasActivity: audioLevel > this._audioThreshold
            }, [flat.buffer]);
            
            this._buffer = [];
            this._bufferSize = 0;
            this._chunkReady = false;
            this._processingChunk = false;
          }
        }

        return true;
      }
    }

    registerProcessor("audio-capture-processor", AudioCaptureProcessor);
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};

const useAudioCapture = ({
  onAudioChunk,
  onAudioComplete,
  onAudioFile,
  silenceRemoval = false,
  chunkDuration = 30, // Default 30 seconds per chunk
  format = "raw"
}: AudioCaptureHookProps): UseAudioCaptureReturn => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [noAudioDetected, setNoAudioDetected] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Store sample rate separately so it's available even after audioContext is closed
  const recordingSampleRateRef = useRef<number | null>(null);
  const chunkIntervalRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<number | null>(null);
  const sequenceCounterRef = useRef(0);
  const allAudioChunksRef = useRef<Float32Array[]>([]);

  const {
    removeSilence,
    isLoaded,
    isConverting,
    progress,
    statusMessage,
    convertToWav,
  } = useFFmpegConverter();

  // Validate microphone access
  const validateMicrophoneAccess = useCallback(async (): Promise<boolean> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices.filter((device) => device.kind === "audioinput");

      setAvailableDevices(audioInputDevices);

      if (audioInputDevices.length === 0) {
        throw new Error("No microphone devices detected. Please connect a microphone.");
      }

      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined,
        },
      });

      const audioTracks = testStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        const settings = track.getSettings();
        setCurrentDeviceId(settings.deviceId || null);
      }

      testStream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.error("Microphone validation failed:", error);

      if (error instanceof Error) {
        let errorMessage = "";
        if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          errorMessage = "No microphone devices found. Please connect a microphone.";
        } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
          errorMessage = "Microphone permission denied. Please allow access and try again.";
        } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
          errorMessage = "Microphone is busy or unavailable. Please close other applications using the microphone.";
        } else if (error.name === "OverconstrainedError") {
          errorMessage = "Selected microphone device is not available. Please select a different device.";
        } else {
          errorMessage = `Microphone error: ${error.message}`;
        }
        setError(errorMessage);
      } else {
        setError("Microphone access error occurred.");
      }
      return false;
    }
  }, [currentDeviceId]);

  // Process audio chunk
  const processAudioChunk = useCallback(async (
    audioData: Float32Array,
    sequence: number,
    isFinal: boolean
  ) => {
    try {
      setIsProcessing(true);
      
      let processedAudio = audioData;

      // Apply silence removal if enabled and FFmpeg is loaded
      if (silenceRemoval && isLoaded && typeof removeSilence === "function") {
        console.log("Applying silence removal to audio chunk...");
        
        // Convert Float32Array to temporary file for processing
        const tempFile = float32ToWavFile(audioData);
        const processedFile = await removeSilence(tempFile);
        
        if (processedFile) {
          // Convert processed file back to Float32Array
          const arrayBuffer = await processedFile.arrayBuffer();
          const dataView = new DataView(arrayBuffer);
          
          // Skip WAV header (44 bytes) and convert back to Float32Array
          const samples = new Float32Array((arrayBuffer.byteLength - 44) / 2);
          for (let i = 0; i < samples.length; i++) {
            const int16 = dataView.getInt16(44 + i * 2, true);
            samples[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
          }
          processedAudio = samples;
        }
      }

      // Store chunk for final combination
      if (!isFinal) {
        allAudioChunksRef.current.push(processedAudio);
      }

      // Call chunk callback
      if (onAudioChunk) {
        const sampleRate =
          recordingSampleRateRef.current ?? audioContextRef.current?.sampleRate;
        if (!isValidSampleRate(sampleRate)) {
          throw new InvalidSampleRateError(sampleRate);
        }
        onAudioChunk(processedAudio, sequence, isFinal, sampleRate);
      }

      // If final chunk, combine all audio and call completion callbacks
      if (isFinal) {
        // Combine all chunks
        const totalLength = allAudioChunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
        const finalAudio = new Float32Array(totalLength);
        let offset = 0;

        for (const chunk of allAudioChunksRef.current) {
          finalAudio.set(chunk, offset);
          offset += chunk.length;
        }

        // Call completion callback with raw audio
        if (onAudioComplete) {
          const sampleRate =
            recordingSampleRateRef.current ?? audioContextRef.current?.sampleRate;
          if (!isValidSampleRate(sampleRate)) {
            throw new InvalidSampleRateError(sampleRate);
          }
          onAudioComplete(finalAudio, sampleRate);
        }

        // Convert to file format if requested
        if (onAudioFile && format === "wav") {
          const wavFile = await createWavFile(finalAudio);
          onAudioFile(wavFile);
        } else if (onAudioFile && format === "raw") {
          const rawFile = createRawFile(finalAudio);
          onAudioFile(rawFile);
        }

        // Clear stored chunks
        allAudioChunksRef.current = [];
      }

    } catch (error) {
      console.error("Error processing audio chunk:", error);
      setError(`Audio processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [silenceRemoval, isLoaded, removeSilence, onAudioChunk, onAudioComplete, onAudioFile, format]);

  // Create WAV file from Float32Array
  const createWavFile = useCallback(async (samples: Float32Array): Promise<File> => {
    const sampleRate = recordingSampleRateRef.current ?? audioContextRef.current?.sampleRate;
    if (!isValidSampleRate(sampleRate)) {
      throw new InvalidSampleRateError(sampleRate);
    }
    if (isLoaded && typeof convertToWav === "function") {
      // Use FFmpeg for better quality conversion
      const result = await convertToWav(samples, sampleRate);
      return result || float32ToWavFile(samples); // Fallback if conversion fails
    } else {
      // Fallback to manual WAV creation
      return float32ToWavFile(samples);
    }
  }, [isLoaded, convertToWav]);

  // Create raw audio file
  const createRawFile = useCallback((samples: Float32Array): File => {
    const timestamp = Date.now();
    const filename = `audio-recording-${timestamp}.raw`;

    // Create a new ArrayBuffer and copy the data to ensure compatibility
    const buffer = new ArrayBuffer(samples.byteLength);
    const uint8Array = new Uint8Array(buffer);
    const sourceArray = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    uint8Array.set(sourceArray);

    return new File([buffer], filename, {
      type: "application/octet-stream",
      lastModified: timestamp,
    });
  }, []);

  // Manual WAV file creation
  const float32ToWavFile = (samples: Float32Array): File => {
    const sampleRate = recordingSampleRateRef.current ?? audioContextRef.current?.sampleRate;
    if (!isValidSampleRate(sampleRate)) {
      throw new InvalidSampleRateError(sampleRate);
    }
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

    const timestamp = Date.now();
    const filename = `audio-recording-${timestamp}.wav`;

    return new File([view], filename, {
      type: "audio/wav",
      lastModified: timestamp,
    });
  };

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setNoAudioDetected(false);

      // Validate microphone access
      const micValid = await validateMicrophoneAccess();
      if (!micValid) return;

      // Reset counters
      sequenceCounterRef.current = 0;
      allAudioChunksRef.current = [];
      setTotalChunks(0);
      setRecordingDuration(0);
      recordingStartTimeRef.current = Date.now();

      // Get media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: currentDeviceId ? { exact: currentDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // Create audio context and processor
      const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
      const processorUrl = createAudioCaptureWorker();
      await audioContext.audioWorklet.addModule(processorUrl);
      URL.revokeObjectURL(processorUrl);

      const processor = new AudioWorkletNode(audioContext, "audio-capture-processor", {
        processorOptions: { sampleRate: audioContext.sampleRate }
      });

      processor.port.onmessage = (event) => {
        if (event.data.command === "chunk") {
          const audioData = new Float32Array(event.data.audioBuffer);
          const sequence = sequenceCounterRef.current++;
          setTotalChunks(sequence + 1);
          processAudioChunk(audioData, sequence, false);
        } else if (event.data.command === "finalChunk") {
          const audioData = new Float32Array(event.data.audioBuffer);
          const sequence = sequenceCounterRef.current++;
          processAudioChunk(audioData, sequence, true);
        } else if (event.data.command === "audioLevel") {
          setAudioLevel(event.data.level);
        } else if (event.data.command === "noAudioDetected") {
          setNoAudioDetected(true);
          setError(event.data.message);
        }
      };

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(processor);

      audioContextRef.current = audioContext;
      // Store sample rate for use even after audioContext is closed
      recordingSampleRateRef.current = audioContext.sampleRate;
      processorRef.current = processor;
      setIsRecording(true);

      // Start chunk timer
      const chunkIntervalId = window.setInterval(() => {
        processor.port.postMessage({ command: "getChunk" });
      }, chunkDuration * 1000);
      chunkIntervalRef.current = chunkIntervalId;

      // Start duration timer
      const durationIntervalId = window.setInterval(() => {
        const elapsed = (Date.now() - recordingStartTimeRef.current) / 1000;
        setRecordingDuration(elapsed);
      }, 100);
      durationIntervalRef.current = durationIntervalId;

    } catch (err) {
      console.error("Recording start failed:", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
    }
  }, [validateMicrophoneAccess, currentDeviceId, chunkDuration, processAudioChunk]);

  // Stop recording
  const stopRecording = useCallback(() => {
    console.log("Stopping recording...");

    // Clear intervals
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Send final chunk
    if (processorRef.current) {
      processorRef.current.port.postMessage({ command: "stop" });
    }

    // Cleanup
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    processorRef.current = null;
    setIsRecording(false);
  }, []);

  // Pause recording
  const pauseRecording = useCallback(() => {
    if (!isRecording || isPaused) return;

    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setIsPaused(true);

    if (processorRef.current) {
      processorRef.current.port.postMessage({ command: "pause" });
    }

    setIsRecording(false);
  }, [isRecording, isPaused]);

  // Resume recording
  const resumeRecording = useCallback(() => {
    if (!isPaused) return;

    setIsPaused(false);
    setIsRecording(true);
    setNoAudioDetected(false);

    if (processorRef.current) {
      processorRef.current.port.postMessage({ command: "resume" });
    }

    // Restart timers
    const chunkIntervalId = window.setInterval(() => {
      processorRef.current?.port.postMessage({ command: "getChunk" });
    }, chunkDuration * 1000);
    chunkIntervalRef.current = chunkIntervalId;

    const durationIntervalId = window.setInterval(() => {
      const elapsed = (Date.now() - recordingStartTimeRef.current) / 1000;
      setRecordingDuration(elapsed);
    }, 100);
    durationIntervalRef.current = durationIntervalId;
  }, [isPaused, chunkDuration]);

  // Select microphone
  const selectMicrophone = useCallback(async (deviceId: string) => {
    try {
      setCurrentDeviceId(deviceId);

      if (isRecording) {
        await stopRecording();
        await startRecording();
      }
    } catch (error) {
      console.error("Device selection failed:", error);
      setError("Failed to switch to selected microphone.");
    }
  }, [isRecording, stopRecording, startRecording]);

  return {
    mediaStreamRef,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    isProcessing,
    error,
    availableDevices,
    currentDeviceId,
    selectMicrophone,
    validateMicrophoneAccess,
    audioLevel,
    noAudioDetected,
    isConverting,
    progress,
    statusMessage,
    recordingDuration,
    totalChunks,
  };
};

export default useAudioCapture;
