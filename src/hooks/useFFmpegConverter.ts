import { useState, useCallback, useRef } from "react";
import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg";
import { AUDIO_SAMPLE_RATE } from "../constants/audio";

interface FFmpegConverterOptions {
  quality?: number;
  bitRate?: number;
}

// Embedded FFmpeg Worker - no external files needed
const createFFmpegWorker = () => {
  const workerCode = `
    let ffmpegModule = null;
    
    const helperFunctions = {
      float32ToWavFile: function(left, sampleRate = 44100) {
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
      },
      
      processAudioData: function(audioBuffer, options = {}) {
        try {
          const { quality = 1, bitRate = 128000 } = options;
          const float32Array = new Float32Array(audioBuffer);
          const wavBuffer = this.float32ToWavFile(float32Array);
          
          return {
            buffer: wavBuffer,
            size: wavBuffer.byteLength,
            duration: float32Array.length / 44100
          };
        } catch (error) {
          throw new Error('Failed to process audio data: ' + error.message);
        }
      },
      
      removeSilenceFromAudio: function(audioBuffer, options = {}) {
        try {
          const {
            silenceThreshold = 0.005,    // Reduced from 0.01 to be less aggressive
            minSilenceDuration = 1.0,    // Increased from 0.5 to preserve natural pauses
            sampleRate = 44100
          } = options;
          
          const float32Array = new Float32Array(audioBuffer);
          const minSilenceSamples = Math.floor(minSilenceDuration * sampleRate);
          const result = [];
          
          let silenceStart = -1;
          let silenceLength = 0;
          let totalAudioSamples = 0;
          let totalSilentSamples = 0;
          
          // First pass: analyze audio content
          for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.abs(float32Array[i]);
            if (sample > silenceThreshold) {
              totalAudioSamples++;
            } else {
              totalSilentSamples++;
            }
          }
          
          const audioPercentage = totalAudioSamples / float32Array.length;
          console.log(\`[AUDIO] Audio content: \${(audioPercentage * 100).toFixed(2)}%\`);
          
          // If less than 5% is audio, skip silence removal to prevent over-processing
          if (audioPercentage < 0.05) {
            console.warn('[WARN] Audio content too low, skipping silence removal to preserve speech');
            const wavBuffer = this.float32ToWavFile(float32Array, sampleRate);
            return {
              buffer: wavBuffer,
              size: wavBuffer.byteLength,
              duration: float32Array.length / sampleRate,
              originalDuration: float32Array.length / sampleRate,
              reductionPercentage: 0
            };
          }
          
          // Second pass: remove long silences
          for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.abs(float32Array[i]);
            
            if (sample < silenceThreshold) {
              if (silenceStart === -1) {
                silenceStart = i;
              }
              silenceLength++;
            } else {
              // End of silence detected
              if (silenceStart !== -1) {
                if (silenceLength < minSilenceSamples) {
                  // Keep short silences (natural pauses)
                  for (let j = silenceStart; j < i; j++) {
                    result.push(float32Array[j]);
                  }
                } else {
                  // Replace long silences with shorter ones (0.3 seconds instead of 0.1)
                  const shortSilenceSamples = Math.floor(0.3 * sampleRate);
                  for (let j = 0; j < shortSilenceSamples; j++) {
                    result.push(0);
                  }
                }
                silenceStart = -1;
                silenceLength = 0;
              }
              
              // Add non-silent sample
              result.push(float32Array[i]);
            }
          }
          
          // Handle trailing silence
          if (silenceStart !== -1 && silenceLength >= minSilenceSamples) {
            const shortSilenceSamples = Math.floor(0.3 * sampleRate);
            for (let j = 0; j < shortSilenceSamples; j++) {
              result.push(0);
            }
          } else if (silenceStart !== -1) {
            for (let j = silenceStart; j < float32Array.length; j++) {
              result.push(float32Array[j]);
            }
          }
          
          const processedArray = new Float32Array(result);
          
          // Safety check: ensure we haven't removed too much content
          const reductionPercentage = Math.round((1 - processedArray.length / float32Array.length) * 100);
          if (reductionPercentage > 80) {
            console.warn('[WARN] Excessive silence removal detected, skipping to preserve speech naturalness');
            const wavBuffer = this.float32ToWavFile(float32Array, sampleRate);
            return {
              buffer: wavBuffer,
              size: wavBuffer.byteLength,
              duration: float32Array.length / sampleRate,
              originalDuration: float32Array.length / sampleRate,
              reductionPercentage: 0
            };
          }
          
          const wavBuffer = this.float32ToWavFile(processedArray, sampleRate);
          
          console.log(\`[SUCCESS] Silence removal complete. Original Duration: \${(float32Array.length / sampleRate).toFixed(2)}s, Processed Duration: \${(processedArray.length / sampleRate).toFixed(2)}s, Reduction: \${reductionPercentage}%\`);
          
          return {
            buffer: wavBuffer,
            size: wavBuffer.byteLength,
            duration: processedArray.length / sampleRate,
            originalDuration: float32Array.length / sampleRate,
            reductionPercentage: reductionPercentage
          };
        } catch (error) {
          throw new Error('Failed to remove silence: ' + error.message);
        }
      }
    };

    self.onmessage = function(e) {
      const { type, audioBuffer, options } = e.data;
      
      if (type === 'convertWav') {
        try {
          self.postMessage({ type: 'progress', data: { progress: 10, message: 'Starting conversion...' } });
          
          const result = helperFunctions.processAudioData(audioBuffer, options);
          
          self.postMessage({ type: 'progress', data: { progress: 50, message: 'Processing audio...' } });
          
          setTimeout(() => {
            self.postMessage({ type: 'progress', data: { progress: 90, message: 'Finalizing...' } });
            
            setTimeout(() => {
              self.postMessage({ 
                type: 'complete', 
                data: { 
                  buffer: result.buffer,
                  size: result.size,
                  duration: result.duration 
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
      } else if (type === 'removeSilence') {
        try {
          self.postMessage({ type: 'progress', progress: 10, message: 'Analyzing audio...' });
          
          const result = helperFunctions.removeSilenceFromAudio(audioBuffer, options);
          
          self.postMessage({ type: 'progress', progress: 70, message: 'Removing silence...' });
          
          setTimeout(() => {
            self.postMessage({ type: 'progress', progress: 90, message: 'Finalizing...' });
            
            setTimeout(() => {
              self.postMessage({ 
                type: 'complete', 
                result: {
                  data: result.buffer,
                  name: options.fileName || 'processed_audio.wav',
                  type: options.fileType || 'audio/wav',
                  stats: {
                    originalDuration: result.originalDuration,
                    processedDuration: result.duration,
                    reductionPercentage: result.reductionPercentage,
                    originalSize: options.originalSize || 0,
                    processedSize: result.size
                  }
                }
              });
            }, 100);
          }, 100);
          
        } catch (error) {
          self.postMessage({ 
            type: 'error', 
            error: error.message || 'Unknown silence removal error' 
          });
        }
      } else if (type === 'init') {
        // For compatibility with existing code
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
    sampleRate?: number,
    fileName?: string
  ) => Promise<File | null>;
  convertToFlac: (wavFile: File) => Promise<File | null>;
  removeSilence: (file: File) => Promise<File | null>;
  reset: () => void;
}

const useFFmpegConverter = (): UseFFmpegConverterReturn => {
  const [isLoaded, setIsLoaded] = useState(true); // Always loaded since we use embedded worker
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const loadFFmpeg = useCallback(async (): Promise<boolean> => {
    // Load FFmpeg WASM for FLAC conversion
    if (ffmpegRef.current && ffmpegLoaded) {
      return true;
    }

    try {
      setStatusMessage("Loading FFmpeg...");
      const ffmpeg = createFFmpeg({
        log: false,
        progress: ({ ratio }) => {
          setProgress(Math.round(ratio * 100));
        },
      });

      await ffmpeg.load();
      ffmpegRef.current = ffmpeg;
      setFfmpegLoaded(true);
      setIsLoaded(true);
      setStatusMessage("");
      console.log("FFmpeg WASM loaded successfully");
      return true;
    } catch (err) {
      console.error("Failed to load FFmpeg:", err);
      setError("Failed to load FFmpeg");
      setStatusMessage("");
      return false;
    }
  }, [ffmpegLoaded]);

  const convertToWav = useCallback(
    async (
      audioData: Float32Array,
      sampleRate: number = AUDIO_SAMPLE_RATE,
      fileName: string = "recording.wav"
    ): Promise<File | null> => {
      setIsConverting(true);
      setProgress(0);
      setError(null);
      setStatusMessage("Converting audio...");

      try {
        // Create worker dynamically
        const workerUrl = createFFmpegWorker();
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
            sampleRate,
            options: { quality: 1, bitRate: 128000 },
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
      if (!ffmpegRef.current || !ffmpegLoaded) {
        const loaded = await loadFFmpeg();
        if (!loaded) {
          console.error("Failed to load FFmpeg for FLAC conversion");
          return wavFile; // Return original WAV if FFmpeg fails to load
        }
      }

      const ffmpeg = ffmpegRef.current;
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
      console.warn(`File too large (${file.size} bytes), skipping silence removal`);
      return file; // Return original file
    }

    try {
      setIsConverting(true);
      setError(null);
      setProgress(0);
      setStatusMessage("Starting audio processing...");

      // Read the file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      console.log(`[INFO] Processing WAV file: ${file.size} bytes, name: ${file.name}`);

      // Parse WAV file header properly
      const dataView = new DataView(arrayBuffer);
      
      // Validate WAV file format
      const riffSignature = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1), 
        dataView.getUint8(2),
        dataView.getUint8(3)
      );
      
      if (riffSignature !== 'RIFF') {
        console.error('Invalid WAV file: Missing RIFF header');
        return file; // Return original file
      }
      
      const waveSignature = String.fromCharCode(
        dataView.getUint8(8),
        dataView.getUint8(9),
        dataView.getUint8(10),
        dataView.getUint8(11)
      );
      
      if (waveSignature !== 'WAVE') {
        console.error('Invalid WAV file: Missing WAVE signature');
        return file; // Return original file
      }
      
      // Find the data chunk
      let dataChunkOffset = 12;
      let audioDataStart = -1;
      let audioDataLength = 0;
      
      while (dataChunkOffset < arrayBuffer.byteLength - 8) {
        const chunkId = String.fromCharCode(
          dataView.getUint8(dataChunkOffset),
          dataView.getUint8(dataChunkOffset + 1),
          dataView.getUint8(dataChunkOffset + 2),
          dataView.getUint8(dataChunkOffset + 3)
        );
        
        const chunkSize = dataView.getUint32(dataChunkOffset + 4, true);
        
        if (chunkId === 'data') {
          audioDataStart = dataChunkOffset + 8;
          audioDataLength = chunkSize;
          break;
        }
        
        dataChunkOffset += 8 + chunkSize;
      }
      
      if (audioDataStart === -1) {
        console.error('No audio data chunk found in WAV file');
        return file; // Return original file
      }

      // Extract sample rate from WAV header (byte offset 24)
      const originalSampleRate = dataView.getUint32(24, true);
      console.log(`[AUDIO] Found audio data: start=${audioDataStart}, length=${audioDataLength} bytes, sampleRate=${originalSampleRate}Hz`);
      
      // Extract audio data (assuming 16-bit PCM)
      const audioData = new Int16Array(arrayBuffer, audioDataStart, audioDataLength / 2);
      
      // Validate extracted audio data
      if (audioData.length === 0) {
        console.error('No audio data extracted from WAV file');
        return file; // Return original file
      }

      // Convert to Float32Array for processing
      const float32Data = new Float32Array(audioData.length);
      let nonZeroCount = 0;
      for (let i = 0; i < audioData.length; i++) {
        float32Data[i] = audioData[i] / 32768; // Convert to -1 to 1 range
        if (Math.abs(float32Data[i]) > 0.001) nonZeroCount++;
      }
      
      const audioPercentage = nonZeroCount / float32Data.length;
      console.log(`[INFO] Audio validation: ${audioData.length} samples, ${nonZeroCount} non-zero samples (${(audioPercentage * 100).toFixed(2)}%)`);
      
      // If very little audio content, skip silence removal
      if (audioPercentage < 0.01) {
        console.warn(`[WARN] Very little audio content (${(audioPercentage * 100).toFixed(2)}%), skipping silence removal`);
        return file;
      }

      // Create worker dynamically
      const workerUrl = createFFmpegWorker();
      const worker = new Worker(workerUrl);

      return new Promise<File | null>((resolve, reject) => {
        const messageHandler = (e: MessageEvent) => {
          const { type, progress: workerProgress, message, result, error } = e.data;

          switch (type) {
            case "progress":
              setProgress(workerProgress);
              setStatusMessage(message);
              break;

            case "complete":
              worker.removeEventListener("message", messageHandler);
              worker.terminate();
              URL.revokeObjectURL(workerUrl);

              try {
                const processedFile = new File([new Uint8Array(result.data)], result.name, {
                  type: result.type,
                });

                console.log("[INFO] Silence removal + audio compression results:", result.stats);

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
              worker.terminate();
              URL.revokeObjectURL(workerUrl);
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
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          console.error("Worker error during processing:", workerError);
          setError("Worker processing failed");
          setIsConverting(false);
          setProgress(0);
          setStatusMessage("");
          resolve(file); // Return original file
        };

        // Start processing with original command structure
        // Use the original sample rate from the WAV file to preserve audio speed
        worker.postMessage({
          type: "removeSilence",
          audioBuffer: float32Data.buffer,
          options: {
            silenceThreshold: 0.01, // Amplitude threshold for silence
            minSilenceDuration: 0.5, // Minimum silence duration to remove (seconds)
            sampleRate: originalSampleRate, // Preserve original sample rate to avoid speed changes
            fileName: file.name,
            fileType: file.type,
            originalSize: file.size,
          },
        });        
        console.log(`🚀 Sent ${float32Data.length} samples to silence removal worker`);      });
    } catch (err) {
      console.error("Worker removeSilence failed:", err);
      setError("Audio processing failed");
      setIsConverting(false);
      setProgress(0);
      setStatusMessage("");
      return file; // Return original file
    }
  }, []);

  const reset = useCallback(() => {
    setIsConverting(false);
    setProgress(0);
    setError(null);
    setStatusMessage("");
  }, []);

  return {
    ffmpeg: ffmpegRef.current,
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
