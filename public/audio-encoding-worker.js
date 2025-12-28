// public/audio-encoding-worker.js
console.log("🚀 Audio encoding worker loaded");

self.onmessage = function (e) {
  const { command, data, id } = e.data;

  try {
    switch (command) {
      case "encodeFloat32ToBase64":
        const { audioData } = data;

        // Progress update
        self.postMessage({
          type: "progress",
          id,
          message: "Converting audio data...",
        });

        // Convert array back to Float32Array if needed
        const float32Array =
          audioData instanceof Float32Array ? audioData : new Float32Array(audioData);

        // Convert Float32Array to ArrayBuffer
        const buffer = new ArrayBuffer(float32Array.length * 4);
        const view = new Float32Array(buffer);
        view.set(float32Array);

        // Convert to Uint8Array for base64 encoding
        const bytes = new Uint8Array(buffer);

        // Convert to base64 in chunks to avoid stack overflow for large arrays
        const chunkSize = 8192; // Process 8KB at a time
        let binary = "";

        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.slice(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));

          // Yield control periodically for very large arrays
          if (i % (chunkSize * 10) === 0 && i > 0) {
            // Give other operations a chance to run
            const progress = Math.round((i / bytes.length) * 100);
            self.postMessage({
              type: "progress",
              id,
              progress,
              message: `Encoding... ${progress}%`,
            });
          }
        }

        // Convert to base64
        const base64 = btoa(binary);

        self.postMessage({
          type: "complete",
          id,
          result: base64,
        });
        break;

      case "decodeBase64ToFloat32":
        const { base64Data } = data;

        self.postMessage({
          type: "progress",
          id,
          message: "Decoding audio data...",
        });

        try {
          // Decode base64 to binary string
          const binary = atob(base64Data);

          // Convert to Uint8Array
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          // Convert to Float32Array
          const float32Result = new Float32Array(bytes.buffer);

          self.postMessage({
            type: "complete",
            id,
            result: Array.from(float32Result), // Convert to regular array for transfer
          });
        } catch (decodeError) {
          self.postMessage({
            type: "error",
            id,
            error: `Decode failed: ${decodeError.message}`,
          });
        }
        break;

      default:
        self.postMessage({
          type: "error",
          id,
          error: `Unknown command: ${command}`,
        });
    }
  } catch (error) {
    console.error("Worker error:", error);
    self.postMessage({
      type: "error",
      id,
      error: error.message,
      stack: error.stack,
    });
  }
};

self.onerror = function (error) {
  console.error("Worker script error:", error);
  self.postMessage({
    type: "error",
    error: error.message || "Unknown worker error",
  });
};
