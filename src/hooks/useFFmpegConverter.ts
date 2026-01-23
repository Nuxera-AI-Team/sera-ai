import { useState, useCallback } from "react";
import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg";
import { MIN_VALID_SAMPLE_RATE, MAX_VALID_SAMPLE_RATE } from "../constants/audio";

interface FFmpegConverterOptions {
  quality?: number;
  bitRate?: number;
}

// Embedded Worker for WAV conversion only (silence removal now uses FFmpeg WASM)
const createWavConversionWorker = () => {
  const minSampleRate = MIN_VALID_SAMPLE_RATE;
  const maxSampleRate = MAX_VALID_SAMPLE_RATE;

  const workerCode = `
    const MIN_SAMPLE_RATE = ${minSampleRate};
    const MAX_SAMPLE_RATE = ${maxSampleRate};

    const validateSampleRate = (sampleRate) => {
      if (!sampleRate || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
        throw new Error('Audio captured with invalid sample rate: ' + sampleRate + '. Sample rate must be between ' + MIN_SAMPLE_RATE + 'Hz and ' + MAX_SAMPLE_RATE + 'Hz.');
      }
    };

    const float32ToWavFile = (left, sampleRate) => {
      validateSampleRate(sampleRate);
      const length = left.length;
      const buffer = new ArrayBuffer(44 + length * 2);
      const view = new DataView(buffer);

      const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      const floatTo16BitPCM = (output, offset, input) => {
        for (let i = 0; i < input.length; i++, offset += 2) {
          const s = Math.max(-1, Math.min(1, input[i]));
          output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + length * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, length * 2, true);

      floatTo16BitPCM(view, 44, left);

      return buffer;
    };

    self.onmessage = function(e) {
      const { type, audioBuffer, options } = e.data;

      if (type === 'convertWav') {
        try {
          self.postMessage({ type: 'progress', data: { progress: 10, message: 'Starting conversion...' } });

          const { sampleRate } = options;
          validateSampleRate(sampleRate);
          const float32Array = new Float32Array(audioBuffer);
          const wavBuffer = float32ToWavFile(float32Array, sampleRate);

          self.postMessage({ type: 'progress', data: { progress: 50, message: 'Processing audio...' } });

          setTimeout(() => {
            self.postMessage({ type: 'progress', data: { progress: 90, message: 'Finalizing...' } });

            setTimeout(() => {
              self.postMessage({
                type: 'complete',
                data: {
                  buffer: wavBuffer,
                  size: wavBuffer.byteLength,
                  duration: float32Array.length / sampleRate
                }
              });
            }, 100);
          }, 100);

        } catch (error) {
          self.postMessage({
            type: 'error',
            error: error.message || 'Unknown conversion error'
          });
        }
      } else if (type === 'init') {
        self.postMessage({ type: 'ready' });
      }
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};

// Legacy interface compatibility for existing code
interface UseFFmpegConverterReturn {
  ffmpeg: FFmpeg | null;
  isLoaded: boolean;
  ffmpegLoaded: boolean;
  isConverting: boolean;
  progress: number;
  error: string | null;
  statusMessage: string;
  loadFFmpeg: () => Promise<boolean>;
  convertToWav: (
    audioData: Float32Array,
    sampleRate: number,
    fileName?: string
  ) => Promise<File | null>;
  convertToFlac: (wavFile: File) => Promise<File | null>;
  removeSilence: (file: File) => Promise<File | null>;
  reset: () => void;
}

// Module-level state to share FFmpeg instance across all hook instances
let ffmpegLoadingPromise: Promise<boolean> | null = null;
let ffmpegInstance: FFmpeg | null = null;

const useFFmpegConverter = (): UseFFmpegConverterReturn => {
  const [isLoaded, setIsLoaded] = useState(true); // Always loaded since we use embedded worker
  const [ffmpegLoaded, setFfmpegLoaded] = useState(ffmpegInstance !== null);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const loadFFmpeg = useCallback(async (): Promise<boolean> => {
    // Already loaded
    if (ffmpegInstance) {
      console.log("[FFmpeg] Already loaded, skipping");
      setFfmpegLoaded(true);
      return true;
    }

    // If already loading, wait for that promise
    if (ffmpegLoadingPromise) {
      console.log("[FFmpeg] Already loading, waiting for existing promise");
      const result = await ffmpegLoadingPromise;
      if (result) {
        setFfmpegLoaded(true);
      }
      return result;
    }

    // Start loading
    ffmpegLoadingPromise = (async () => {
      try {
        const cdnCorePath = 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';
        console.log("[FFmpeg] Loading from CDN:", cdnCorePath);
        setStatusMessage("Loading FFmpeg...");
        const ffmpeg = createFFmpeg({
          log: false,
          corePath: cdnCorePath,
          progress: ({ ratio }) => {
            setProgress(Math.round(ratio * 100));
          },
        });

        await ffmpeg.load();
        ffmpegInstance = ffmpeg;
        setFfmpegLoaded(true);
        setIsLoaded(true);
        setStatusMessage("");
        console.log("[FFmpeg] WASM loaded successfully from CDN");
        return true;
      } catch (err) {
        console.error("Failed to load FFmpeg:", err);
        setError("Failed to load FFmpeg");
        setStatusMessage("");
        ffmpegLoadingPromise = null; // Allow retry on failure
        return false;
      }
    })();

    return ffmpegLoadingPromise;
  }, []);

  const convertToWav = useCallback(
    async (
      audioData: Float32Array,
      sampleRate: number,
      fileName: string = "recording.wav"
    ): Promise<File | null> => {
      setIsConverting(true);
      setProgress(0);
      setError(null);
      setStatusMessage("Converting audio...");

      try {
        // Create worker dynamically
        const workerUrl = createWavConversionWorker();
        const worker = new Worker(workerUrl);

        return new Promise<File>((resolve, reject) => {
          worker.onmessage = (e) => {
            const { type, data, error: workerError } = e.data;

            if (type === "progress") {
              setProgress(data.progress);
              setStatusMessage(data.message || `Converting... ${data.progress}%`);
            } else if (type === "complete") {
              setIsConverting(false);
              setProgress(100);
              setStatusMessage("Conversion complete");
              worker.terminate();
              URL.revokeObjectURL(workerUrl);

              const blob = new Blob([data.buffer], { type: "audio/wav" });
              const file = new File([blob], fileName, { type: "audio/wav" });
              resolve(file);
            } else if (type === "error") {
              setIsConverting(false);
              setError(workerError);
              setStatusMessage("Conversion failed");
              worker.terminate();
              URL.revokeObjectURL(workerUrl);
              reject(new Error(workerError));
            }
          };

          worker.onerror = (err) => {
            setIsConverting(false);
            setError("Worker error occurred");
            setStatusMessage("Conversion failed");
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            reject(err);
          };

          worker.postMessage({
            type: "convertWav",
            audioBuffer: audioData.buffer,
            options: { quality: 1, bitRate: 128000, sampleRate },
          });
        });
      } catch (err) {
        setIsConverting(false);
        setError(err instanceof Error ? err.message : "Unknown error");
        setStatusMessage("Conversion failed");
        throw err;
      }
    },
    []
  );

  const convertToFlac = useCallback(
    async (wavFile: File): Promise<File | null> => {
      // Ensure FFmpeg is loaded
      if (!ffmpegInstance || !ffmpegLoaded) {
        const loaded = await loadFFmpeg();
        if (!loaded) {
          console.error("Failed to load FFmpeg for FLAC conversion");
          return wavFile; // Return original WAV if FFmpeg fails to load
        }
      }

      const ffmpeg = ffmpegInstance;
      if (!ffmpeg) {
        console.error("FFmpeg not available");
        return wavFile;
      }

      try {
        setIsConverting(true);
        setProgress(0);
        setError(null);
        setStatusMessage("Converting to FLAC...");

        const inputFileName = "input.wav";
        const outputFileName = "output.flac";

        // Write WAV file to FFmpeg's virtual filesystem
        const wavData = await fetchFile(wavFile);
        ffmpeg.FS("writeFile", inputFileName, wavData);

        setProgress(30);
        setStatusMessage("Encoding FLAC...");

        // Convert WAV to FLAC with high quality settings
        await ffmpeg.run(
          "-i", inputFileName,
          "-c:a", "flac",
          "-compression_level", "5", // 0-12, higher = smaller file but slower
          outputFileName
        );

        setProgress(80);
        setStatusMessage("Finalizing...");

        // Read the output FLAC file
        const flacData = ffmpeg.FS("readFile", outputFileName);

        // Clean up virtual filesystem
        ffmpeg.FS("unlink", inputFileName);
        ffmpeg.FS("unlink", outputFileName);

        // Create File object from FLAC data
        const flacBlob = new Blob([new Uint8Array(flacData)], { type: "audio/flac" });
        const flacFileName = wavFile.name.replace(/\.wav$/i, ".flac");
        const flacFile = new File([flacBlob], flacFileName, { type: "audio/flac" });

        setProgress(100);
        setStatusMessage("FLAC conversion complete");
        console.log(`[FLAC] Converted ${wavFile.size} bytes WAV to ${flacFile.size} bytes FLAC (${Math.round((1 - flacFile.size / wavFile.size) * 100)}% reduction)`);

        setTimeout(() => {
          setIsConverting(false);
          setProgress(0);
          setStatusMessage("");
        }, 500);

        return flacFile;
      } catch (err) {
        console.error("FLAC conversion failed:", err);
        setError("FLAC conversion failed");
        setIsConverting(false);
        setProgress(0);
        setStatusMessage("");
        return wavFile; // Return original WAV on failure
      }
    },
    [ffmpegLoaded, loadFFmpeg]
  );

  const removeSilence = useCallback(async (file: File): Promise<File | null> => {
    // Validate input file
    if (!file) {
      setError("No file provided for processing");
      return null;
    }

    // Check file size - 50MB limit
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxFileSize) {
      console.warn(`[SILENCE] File too large (${file.size} bytes), skipping silence removal`);
      return file;
    }

    try {
      setIsConverting(true);
      setError(null);
      setProgress(0);
      setStatusMessage("Removing silence...");

      console.log(`[SILENCE] Processing file: ${file.size} bytes, name: ${file.name}`);

      // Ensure FFmpeg is loaded
      if (!ffmpegInstance) {
        setStatusMessage("Loading FFmpeg for silence removal...");
        const loaded = await loadFFmpeg();
        if (!loaded || !ffmpegInstance) {
          console.error("[SILENCE] Failed to load FFmpeg");
          setIsConverting(false);
          setProgress(0);
          setStatusMessage("");
          return file;
        }
      }

      setProgress(10);
      setStatusMessage("Writing audio to FFmpeg...");

      const inputFileName = "input-silence.wav";
      const outputFileName = "output-nosilence.wav";

      // Write input file to FFmpeg virtual filesystem
      const wavData = await fetchFile(file);
      ffmpegInstance.FS("writeFile", inputFileName, wavData);

      const originalSize = file.size;
      console.log(`[SILENCE] Input file written: ${originalSize} bytes`);

      setProgress(30);
      setStatusMessage("Analyzing and removing silence...");

      // Run FFmpeg with same filter as server:
      // silenceremove=stop_periods=-1:stop_threshold=-35dB:stop_duration=0.5:detection=peak,apad=pad_dur=0.5
      await ffmpegInstance.run(
        "-i", inputFileName,
        "-af", "silenceremove=stop_periods=-1:stop_threshold=-35dB:stop_duration=0.5:detection=peak,apad=pad_dur=0.5",
        "-acodec", "pcm_s16le",
        outputFileName
      );

      setProgress(80);
      setStatusMessage("Reading processed audio...");

      // Read the output file
      const outputData = ffmpegInstance.FS("readFile", outputFileName);

      // Cleanup virtual filesystem
      try {
        ffmpegInstance.FS("unlink", inputFileName);
        ffmpegInstance.FS("unlink", outputFileName);
      } catch (cleanupErr) {
        console.warn("[SILENCE] Cleanup warning:", cleanupErr);
      }

      const processedSize = outputData.length;
      const reductionPercent = Math.round((1 - processedSize / originalSize) * 100);

      console.log(`[SILENCE] Complete: ${originalSize} bytes -> ${processedSize} bytes (${reductionPercent}% reduction)`);

      // Create the output file
      const processedFile = new File(
        [new Uint8Array(outputData)],
        file.name,
        { type: "audio/wav" }
      );

      setProgress(100);
      setStatusMessage("Silence removal complete");

      setTimeout(() => {
        setIsConverting(false);
        setProgress(0);
        setStatusMessage("");
      }, 500);

      return processedFile;
    } catch (err) {
      console.error("[SILENCE] FFmpeg silence removal failed:", err);
      setError("Silence removal failed");
      setIsConverting(false);
      setProgress(0);
      setStatusMessage("");
      return file; // Return original file on error
    }
  }, [loadFFmpeg]);

  const reset = useCallback(() => {
    setIsConverting(false);
    setProgress(0);
    setError(null);
    setStatusMessage("");
  }, []);

  return {
    ffmpeg: ffmpegInstance,
    isLoaded,
    ffmpegLoaded,
    isConverting,
    progress,
    error,
    statusMessage,
    loadFFmpeg,
    convertToWav,
    convertToFlac,
    removeSilence,
    reset,
  };
};

export default useFFmpegConverter;
