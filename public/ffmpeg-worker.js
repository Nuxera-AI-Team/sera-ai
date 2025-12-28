// public/ffmpeg-worker.js
let ffmpeg = null;
let isLoaded = false;
let FFmpegModule = null;

// Helper functions
function uint8ToFile(u8, name, type) {
  return {
    data: u8,
    name: name,
    type: type,
    size: u8.byteLength,
  };
}

function getFileExtension(filename) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

// Move float32ToWavFile to worker
function float32ToWavFile(samples, sampleRate = 44100) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
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

  return new Uint8Array(view.buffer);
}

self.onmessage = async function (e) {
  const { command, data } = e.data;

  try {
    switch (command) {
      case "loadFFmpeg":
        await loadFFmpegModule();
        break;
      case "init":
        await initFFmpeg();
        break;
      case "removeSilence":
        await removeSilenceInWorker(data);
        break;
      case "convertToWav":
        await convertToWavInWorker(data);
        break;
      default:
        self.postMessage({
          type: "error",
          error: `Unknown command: ${command}`,
        });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error.message,
      stack: error.stack,
    });
  }
};

// New function to handle WAV conversion
async function convertToWavInWorker({ audioData, sampleRate, fileName }) {
  try {
    self.postMessage({ type: "progress", progress: 50, message: "Converting to WAV..." });

    const wavData = float32ToWavFile(new Float32Array(audioData), sampleRate);
    const timestamp = Date.now();
    const wavFileName = fileName ? fileName.replace(/\.[^.]+$/, ".wav") : `audio-${timestamp}.wav`;

    self.postMessage({ type: "progress", progress: 100, message: "WAV conversion complete" });

    self.postMessage({
      type: "complete",
      result: {
        data: wavData,
        name: wavFileName,
        type: "audio/wav",
      },
    });
  } catch (error) {
    throw new Error(`WAV conversion failed: ${error.message}`);
  }
}

async function loadFFmpegModule() {
  if (FFmpegModule) {
    self.postMessage({ type: "moduleLoaded", success: true });
    return;
  }

  try {
    self.postMessage({ type: "moduleProgress", message: "Loading FFmpeg module..." });

    // Method 1: Try to fetch and evaluate the script
    try {
      const response = await fetch("https://unpkg.com/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js");
      if (!response.ok) {
        throw new Error(`Failed to fetch FFmpeg script: ${response.statusText}`);
      }

      const scriptText = await response.text();

      // Create a clean global scope for the script
      const originalWindow = self.window;
      const originalDocument = self.document;
      const originalNavigator = self.navigator;

      // Mock minimal DOM-like objects that FFmpeg might expect
      self.window = self;
      self.document = {
        createElement: () => ({}),
        createElementNS: () => ({}),
        getElementById: () => null,
        getElementsByTagName: () => [],
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      self.navigator = self.navigator || { userAgent: "Worker" };

      // Evaluate the script
      eval(scriptText);

      // Restore original values
      self.window = originalWindow;
      self.document = originalDocument;
      self.navigator = originalNavigator;

      // Check if FFmpeg is available
      if (typeof FFmpeg !== "undefined") {
        FFmpegModule = FFmpeg;
        self.postMessage({ type: "moduleLoaded", success: true });
        return;
      }
    } catch (evalError) {
      console.log("Script evaluation failed:", evalError.message);
    }

    // Method 2: Try importScripts as fallback (might work in some environments)
    try {
      importScripts("https://unpkg.com/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js");
      if (typeof FFmpeg !== "undefined") {
        FFmpegModule = FFmpeg;
        self.postMessage({ type: "moduleLoaded", success: true });
        return;
      }
    } catch (importError) {
      console.log("importScripts failed:", importError.message);
    }

    // Method 3: Create a minimal FFmpeg-like object that signals we need fallback
    throw new Error("Could not load FFmpeg in worker environment");
  } catch (error) {
    self.postMessage({
      type: "moduleLoaded",
      success: false,
      error: error.message,
      fallback: true, // Signal to use main thread
    });
  }
}

async function initFFmpeg() {
  if (isLoaded) {
    self.postMessage({ type: "initComplete", success: true });
    return;
  }

  if (!FFmpegModule || !FFmpegModule.createFFmpeg) {
    throw new Error("FFmpeg module not loaded");
  }

  try {
    self.postMessage({ type: "initProgress", message: "Creating FFmpeg instance..." });

    const { createFFmpeg } = FFmpegModule;
    ffmpeg = createFFmpeg({
      corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js",
      log: false,
    });

    self.postMessage({ type: "initProgress", message: "Loading FFmpeg core..." });

    await ffmpeg.load();
    isLoaded = true;

    self.postMessage({ type: "initComplete", success: true });
  } catch (error) {
    self.postMessage({ type: "initComplete", success: false, error: error.message });
  }
}

async function removeSilenceInWorker({ file, fileName, fileType }) {
  if (!isLoaded || !ffmpeg) {
    throw new Error("FFmpeg not initialized");
  }

  const fileData = new Uint8Array(await file.arrayBuffer());

  const timestamp = Date.now();
  const fileExt = getFileExtension(fileName);
  const isMP3 = fileType === "audio/mp3" || fileType === "audio/mpeg" || fileExt === "mp3";

  const inputFileName = `input-${timestamp}.${fileExt}`;
  const intermediateWavFileName = isMP3 ? `converted-${timestamp}.wav` : null;
  const silenceRemovedFileName = `nosilence-${timestamp}.wav`;
  const outputFlacFileName = `output-${timestamp}-nosilence.flac`;

  try {
    // Step 1: File preparation (10% progress)
    self.postMessage({ type: "progress", progress: 10, message: "Preparing file..." });

    ffmpeg.FS("writeFile", inputFileName, new Uint8Array(fileData));

    // Step 2: MP3 to WAV conversion if needed (30% progress)
    let silenceRemovalInput = inputFileName;
    if (isMP3) {
      self.postMessage({ type: "progress", progress: 20, message: "Converting MP3 to WAV..." });

      await ffmpeg.run("-y", "-i", inputFileName, "-acodec", "pcm_s16le", intermediateWavFileName);

      ffmpeg.FS("unlink", inputFileName);
      silenceRemovalInput = intermediateWavFileName;
      self.postMessage({ type: "progress", progress: 30, message: "MP3 conversion complete" });
    } else {
      self.postMessage({ type: "progress", progress: 30, message: "File ready for processing" });
    }

    // Step 3: Silence detection (50% progress)
    self.postMessage({ type: "progress", progress: 40, message: "Detecting silence..." });

    await ffmpeg.run(
      "-y",
      "-i",
      silenceRemovalInput,
      "-af",
      "silencedetect=noise=-35dB:d=0.5",
      "-f",
      "null",
      "-"
    );

    self.postMessage({ type: "progress", progress: 50, message: "Silence detection complete" });

    // Step 4: Silence removal (70% progress)
    self.postMessage({ type: "progress", progress: 60, message: "Removing silence..." });

    await ffmpeg.run(
      "-y",
      "-i",
      silenceRemovalInput,
      "-af",
      "silenceremove=stop_periods=-1:stop_threshold=-35dB:stop_duration=0.5:detection=peak,apad=pad_dur=0.5",
      "-acodec",
      "pcm_s16le",
      silenceRemovedFileName
    );

    self.postMessage({ type: "progress", progress: 70, message: "Silence removal complete" });

    // Step 5: Read WAV data for size comparison
    const wavData = ffmpeg.FS("readFile", silenceRemovedFileName);
    const wavSize = wavData.byteLength;

    self.postMessage({ type: "progress", progress: 80, message: "Compressing to FLAC..." });

    // Step 6: FLAC conversion
    await ffmpeg.run(
      "-y",
      "-i",
      silenceRemovedFileName,
      "-acodec",
      "flac",
      "-compression_level",
      "5",
      outputFlacFileName
    );

    const outputData = ffmpeg.FS("readFile", outputFlacFileName);

    self.postMessage({ type: "progress", progress: 90, message: "Finalizing..." });

    // Cleanup
    if (isMP3 && intermediateWavFileName) {
      try {
        ffmpeg.FS("unlink", intermediateWavFileName);
      } catch (e) {}
    }
    if (!isMP3) {
      try {
        ffmpeg.FS("unlink", inputFileName);
      } catch (e) {}
    }
    try {
      ffmpeg.FS("unlink", silenceRemovedFileName);
    } catch (e) {}
    try {
      ffmpeg.FS("unlink", outputFlacFileName);
    } catch (e) {}

    // Send results
    self.postMessage({
      type: "complete",
      result: {
        data: outputData,
        name: fileName.replace(/\.[^.]+$/, "_nosilence.flac"),
        type: "audio/flac",
        stats: {
          originalSize: fileData.byteLength,
          afterSilenceRemoval: wavSize,
          finalFlacSize: outputData.byteLength,
          silenceReduction:
            (((fileData.byteLength - wavSize) / fileData.byteLength) * 100).toFixed(2) + "%",
          flacCompression: (((wavSize - outputData.byteLength) / wavSize) * 100).toFixed(2) + "%",
          totalReduction:
            (((fileData.byteLength - outputData.byteLength) / fileData.byteLength) * 100).toFixed(
              2
            ) + "%",
        },
      },
    });
  } catch (error) {
    // Cleanup on error
    try {
      if (isMP3 && intermediateWavFileName) ffmpeg.FS("unlink", intermediateWavFileName);
      if (!isMP3) ffmpeg.FS("unlink", inputFileName);
      ffmpeg.FS("unlink", silenceRemovedFileName);
      ffmpeg.FS("unlink", outputFlacFileName);
    } catch (e) {}

    throw error;
  }
}
