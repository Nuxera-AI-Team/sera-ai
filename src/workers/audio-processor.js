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
    this._maxSilentSamples =
      this._sampleRate * (options?.processorOptions?.prolongedSilenceSeconds || 30);
    this._audioThreshold = 0.002; // Increased from 0.001 to better detect speech
    this._hasDetectedAudio = false;
    this._totalSilentTime = 0;
    this._lastAudioTime = 0;
    this._recordingStartTime = Date.now();
    // A host whose clinicians routinely open a visit in silence can widen
    // these rather than fork the worklet; both default to the package values.
    this._initialSilenceThreshold =
      this._sampleRate * (options?.processorOptions?.initialSilenceSeconds || 10);
    this._isInitialPhase = true;
    // Consecutive above-threshold quanta seen so far, and how many it takes to
    // call the input live. One loud quantum is as likely to be a click or a
    // knock as speech.
    this._consecutiveAudioQuanta = 0;
    this._sustainedAudioQuanta = 3;
    // Each signal is reported once per stretch, not once per render quantum.
    this._noAudioReported = false;
    this._silenceReported = false;
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
        // A single loud quantum used to clear the silence counter outright, so an
        // input emitting the odd electrical blip was never reported dead — the one
        // failure this check exists to catch was the one it reliably missed.
        this._consecutiveAudioQuanta++;
        if (this._consecutiveAudioQuanta >= this._sustainedAudioQuanta) {
          this._hasDetectedAudio = true;
          this._isInitialPhase = false;
          this._silentSampleCount = 0;
          this._lastAudioTime = Date.now();
          this._silenceReported = false;
        } else {
          this._silentSampleCount += samples.length;
        }
      } else {
        this._consecutiveAudioQuanta = 0;
        this._silentSampleCount += samples.length;
        const silentDuration = this._silentSampleCount / this._sampleRate;

        if (this._isInitialPhase) {
          // Nothing has ever arrived, so there is nothing to capture and the
          // consumer is expected to stop the recording on this.
          if (!this._noAudioReported && this._silentSampleCount > this._initialSilenceThreshold) {
            this._noAudioReported = true;
            this.port.postMessage({
              command: "noAudioDetected",
              message: "No audio input detected after " + Math.round(silentDuration) + " seconds. Please check your microphone.",
              silentDuration: silentDuration,
              isInitialPhase: true,
              hasDetectedAudio: false
            });
          }
        } else if (!this._silenceReported && this._silentSampleCount > this._maxSilentSamples) {
          // The input works and simply went quiet. This must NOT stop the
          // recording: a quiet examination mid-consultation is normal, and
          // answering it with noAudioDetected cost the clinician the rest of
          // the visit.
          this._silenceReported = true;
          this.port.postMessage({
            command: "prolongedSilence",
            message: "No audio detected for " + Math.round(silentDuration) + " seconds.",
            silentDuration: silentDuration,
            isInitialPhase: false,
            hasDetectedAudio: true
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
