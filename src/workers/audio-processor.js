// AudioWorklet processor — captures raw PCM, tracks audio level / silence, and
// posts chunks on demand ("uploadChunk") and on stop ("finalChunk").
//
// This is the packaged, CSP-safe version of the worklet: hosts under a strict
// CSP (e.g. an MV3 browser extension, where a blob: worklet is blocked by
// script-src) load this file by URL via the `workletUrl` option. It must stay
// in sync with the inline blob fallback in ../hooks/useAudioRecorder.ts
// (createAudioProcessorWorker).
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

  process(inputs, _outputs) {
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
