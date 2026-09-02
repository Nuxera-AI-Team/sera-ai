import { useEffect, useRef, useState } from "react";
import useHL7FHIRConverter from "./useHL7FHIRConverter";
import { isValidSampleRate, InvalidSampleRateError } from "../constants/audio";

const API_BASE_URL = "https://nuxera.cloud";

// Embedded Audio Processor Worker for dictation - no external files needed
const createDictationProcessorWorker = () => {
  const workerCode = `
    class DictationProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this._buffer = [];
        this._isStopped = false;
        this._bufferSize = 0;

        // Get sample rate from processor options or use sampleRate from AudioWorkletGlobalScope
        this._sampleRate = options?.processorOptions?.sampleRate || sampleRate;

        this.port.onmessage = (event) => {
          if (event.data.command === "stop") {
            this._isStopped = true;
            this._sendFinalChunk();
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
        if (this._isStopped) {
          return true;
        }

        const input = inputs[0];
        if (input && input.length > 0) {
          const samples = input[0];
          this._buffer.push(new Float32Array(samples));
          this._bufferSize += samples.length;
        }

        return true;
      }
    }

    registerProcessor("dictation-processor", DictationProcessor);
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};

interface AudioDictationHookProps {
  onDictationComplete: (message: string) => void;
  onDictationStart?: () => void;
  onProcessingStart?: () => void;
  onError?: (error: string) => void;

  apiKey?: string;
  apiBaseUrl?: string;
  appendMode?: boolean;
  // Add new props for HL7/FHIR support
  doctorName?: string;
  patientId?: string;
  sessionId?: string;
  language?: string;
  specialty?: string;
  selectedFormat?: "json" | "hl7" | "fhir";
}

const useAudioDictation = ({
  onDictationComplete,
  onDictationStart,
  onProcessingStart,
  onError,
  apiKey,
  apiBaseUrl = API_BASE_URL,
  doctorName = "asad",
  patientId,
  sessionId,
  language,
  specialty,
  selectedFormat = "json",
}: AudioDictationHookProps) => {
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Store sample rate separately so it's available even after audioContext is closed
  const recordingSampleRateRef = useRef<number | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioSamplesRef = useRef<Float32Array[]>([]);

  const [audioBuffer, setAudioBuffer] = useState<Float32Array | null>(null);

  const { createHL7DictationRequest, createFHIRDictationRequest, convertDictationResponse } =
    useHL7FHIRConverter();

  // Use the provided apiKey or fall back to selectedApiKey
  const effectiveApiKey = apiKey;

  // Add cleanup effect for audio resources
  useEffect(() => {
    return () => {
      // Clean up on component unmount
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (processorRef.current) {
        try {
          processorRef.current.disconnect();
        } catch (e) {
          console.error("Error disconnecting processor:", e);
        }
        processorRef.current = null;
      }

      // Only close if the context is not already closed
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        try {
          audioContextRef.current.close();
        } catch (e) {
          console.error("Error closing AudioContext:", e);
        }
      }
      audioContextRef.current = null;
    };
  }, []);

  const startDictating = async () => {
    try {
      console.log("Starting recording");
      // Reset audio chunks and buffer
      setAudioBuffer(null);
      audioSamplesRef.current = [];

      // Clear any previous errors
      setDictationError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();

      // Create embedded audio processor worker dynamically
      const processorUrl = createDictationProcessorWorker();
      try {
        await audioContext.audioWorklet.addModule(processorUrl);
        console.log("Dictation audio worklet module loaded successfully");
      } catch (err) {
        console.error("Error loading dictation audio worklet module:", err);
        throw err;
      } finally {
        // Clean up the blob URL
        URL.revokeObjectURL(processorUrl);
      }

      const processor = new AudioWorkletNode(audioContext, "dictation-processor", {
        processorOptions: { sampleRate: audioContext.sampleRate }
      });
      processor.port.onmessage = (event) => {
        console.log("Received message from processor:", event.data.command);

        if (event.data.audioBuffer) {
          console.log("Received audio buffer", event.data.audioBuffer.length);
          audioSamplesRef.current.push(new Float32Array(event.data.audioBuffer));
        }

        if (event.data.command === "finalChunk") {
          console.log("Received final chunk");

          // Combine all samples into a single buffer
          // Note: the audio buffer was already pushed above by the generic audioBuffer check
          const totalLength = audioSamplesRef.current.reduce(
            (acc, buffer) => acc + buffer.length,
            0
          );

          if (totalLength > 0) {
            const combinedBuffer = new Float32Array(totalLength);
            let offset = 0;

            audioSamplesRef.current.forEach((buffer) => {
              combinedBuffer.set(buffer, offset);
              offset += buffer.length;
            });

            console.log("Combined buffer length:", combinedBuffer.length);
            setAudioBuffer(combinedBuffer);
          } else {
            console.warn("Final chunk received but no audio data accumulated");
            const errorMessage = "No audio data was recorded";
            setDictationError(errorMessage);
            onError?.(errorMessage);
          }
        }
      };

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(processor);

      audioContextRef.current = audioContext;
      // Store sample rate for use even after audioContext is closed
      recordingSampleRateRef.current = audioContext.sampleRate;
      processorRef.current = processor;

      setIsDictating(true);
      onDictationStart?.();
      console.log("Recording started successfully");
    } catch (error) {
      console.error("Error starting dictation:", error);
      setIsDictating(false);
      const errorMessage = "An error occurred while starting dictation";
      setDictationError(errorMessage);
      onError?.(errorMessage);
    }
  };

  // Updated function to stop dictation
  const stopDictating = async () => {
    console.log("Stopping dictation");

    try {
      // Send stop command to processor FIRST (before stopping tracks)
      if (processorRef.current) {
        console.log("Sending stop command to processor");
        processorRef.current.port.postMessage({ command: "stop" });

        // Wait a bit for the processor to send the final chunk
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // THEN stop media stream tracks
      if (mediaStreamRef.current) {
        console.log("Stopping media stream tracks");
        mediaStreamRef.current.getTracks().forEach((track) => {
          track.stop();
          console.log("Track stopped:", track.kind, track.readyState);
        });
        mediaStreamRef.current = null;
      }

      // Clean up processor
      if (processorRef.current) {
        console.log("Disconnecting processor");
        try {
          processorRef.current.disconnect();
          processorRef.current = null;
        } catch (e) {
          console.error("Error disconnecting processor:", e);
          processorRef.current = null;
        }
      }

      // Close audio context
      if (audioContextRef.current) {
        console.log("Closing audio context, current state:", audioContextRef.current.state);
        try {
          if (audioContextRef.current.state !== "closed") {
            await audioContextRef.current.close();
            console.log("Audio context closed successfully");
          }
        } catch (e) {
          console.error("Error closing AudioContext:", e);
        }
        audioContextRef.current = null;
      }

      // Wait a bit more to ensure audioBuffer state is updated
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check if we have audio data
      if (audioBuffer && audioBuffer.length > 0) {
        console.log(`Processing audio buffer of size ${audioBuffer.length} samples`);
        await processDictationAudio(audioBuffer);
      } else if (audioSamplesRef.current.length > 0) {
        console.log("No audio buffer but have samples, combining now");
        const totalLength = audioSamplesRef.current.reduce((acc, buffer) => acc + buffer.length, 0);

        if (totalLength > 0) {
          const combinedBuffer = new Float32Array(totalLength);
          let offset = 0;

          audioSamplesRef.current.forEach((buffer) => {
            combinedBuffer.set(buffer, offset);
            offset += buffer.length;
          });

          console.log(`Created combined buffer of size ${combinedBuffer.length} samples`);
          await processDictationAudio(combinedBuffer);
        } else {
          console.error("No valid audio data found");
          const errorMessage = "No audio data recorded";
          setDictationError(errorMessage);
          onError?.(errorMessage);
        }
      } else {
        console.error("No audio data to process");
        const errorMessage = "No audio data to process";
        setDictationError(errorMessage);
        onError?.(errorMessage);
      }
    } catch (error) {
      console.error("Error stopping recording:", error);
      const errorMessage = "An error occurred while stopping dictation";
      setDictationError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsDictating(false);
      audioSamplesRef.current = [];
      setAudioBuffer(null);
    }
  };

  // Move encodeWAV function (unchanged)
  const encodeWAV = (samples: Float32Array) => {
    console.log(`Encoding WAV with ${samples.length} samples`);
    const sampleRate = recordingSampleRateRef.current ?? audioContextRef.current?.sampleRate;
    if (!isValidSampleRate(sampleRate)) {
      throw new InvalidSampleRateError(sampleRate);
    }
    console.log(`Using sample rate: ${sampleRate}Hz`);

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

    const wavBlob = new Blob([view], { type: "audio/wav" });
    console.log(`Created WAV blob: ${(wavBlob.size / 1024).toFixed(2)} KB`);
    return wavBlob;
  };

  // Updated processDictationAudio function to support different formats
  const processDictationAudio = async (audioData: Float32Array) => {
    try {
      console.log(`Processing dictation with audio data length: ${audioData.length}`);
      console.log(`Using format: ${selectedFormat}`);
      setIsProcessing(true);
      onProcessingStart?.();

      const wavBlob = encodeWAV(audioData);
      console.log(`Sending audio to dictation API (${wavBlob.size / 1024} KB)`);

      // Prepare request data
      const requestData = {
        doctorName,
        patientId,
        sessionId,
        language,
        specialty,
      };

      let requestBody: FormData;
      const headers: Record<string, string> = {
        "x-api-key": effectiveApiKey || "",
      };

      // Create request based on selected format
      switch (selectedFormat) {
        case "hl7":
          requestBody = createHL7DictationRequest(
            new File([wavBlob], "dictation.wav", { type: "audio/wav" }),
            requestData
          );
          headers["x-request-format"] = "hl7";
          headers["x-response-format"] = "hl7";
          console.log("Created HL7-formatted dictation request");
          break;

        case "fhir":
          requestBody = createFHIRDictationRequest(
            new File([wavBlob], "dictation.wav", { type: "audio/wav" }),
            requestData
          );
          headers["x-request-format"] = "fhir";
          headers["x-response-format"] = "fhir";
          console.log("Created FHIR-formatted dictation request");
          break;

        case "json":
        default:
          requestBody = new FormData();
          requestBody.append("audio", wavBlob);
          requestBody.append("doctorName", doctorName);
          if (patientId) requestBody.append("patientId", patientId);
          if (sessionId) requestBody.append("sessionId", sessionId);
          if (language) requestBody.append("language", language);
          if (specialty) requestBody.append("specialty", specialty);

          headers["x-request-format"] = "json";
          headers["x-response-format"] = "json";
          console.log("Created JSON-formatted dictation request");
          break;
      }

      console.log("Request headers:", headers);
      console.log("Sending request to API...");

      const response = await fetch(`${apiBaseUrl}/api/dictate`, {
        method: "POST",
        body: requestBody,
        headers,
      });

      console.log("API response status:", response.status);
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      // Handle different response formats
      let responseData: unknown;
      const contentType = response.headers.get("content-type") || "";

      if (selectedFormat === "json" || contentType.includes("application/json")) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      console.log("Raw API response data:", responseData);

      // Convert response using the converter
      const convertedData = convertDictationResponse(responseData, selectedFormat);
      console.log("Converted response data:", convertedData);

      if (convertedData.dictation) {
        console.log("Dictation text received:", convertedData.dictation);
        // Pass the dictation text to the callback
        // The parent component will handle appending/replacing
        onDictationComplete(convertedData.dictation);
      } else {
        console.error("No dictation text in response");
        const errorMessage = "No dictation text in response";
        setDictationError(errorMessage);
        onError?.(errorMessage);
      }
    } catch (error) {
      console.error("Error processing dictation audio:", error);
      const errorMessage = "An error occurred while processing dictation";
      setDictationError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsProcessing(false);
      setIsDictating(false);
    }
  };

  return { startDictating, stopDictating, dictationError, isDictating, isProcessing };
};

export default useAudioDictation;
