/* eslint-disable */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._isStopped = false;
    this._isPaused = false;
    this._uploadChunk = false;
    this._uploadingChunk = false;
    
    // Audio level monitoring - adjusted for medical scenarios
    this._audioLevelCheckInterval = 0;
    this._audioLevelCheckFrequency = 128; // Check every 128 samples (roughly 3ms at 44.1kHz)
    this._silentSampleCount = 0;
    this._maxSilentSamples = 44100 * 30; // 30 seconds for medical scenarios (was 5)
    this._audioThreshold = 0.001; // Minimum audio level threshold
    this._hasDetectedAudio = false; // Track if we've ever detected audio
    this._totalSilentTime = 0; // Track total silent time
    this._lastAudioTime = 0; // Track when we last detected audio
    this._recordingStartTime = Date.now(); // Track when recording started

    // Medical scenario specific thresholds
    this._initialSilenceThreshold = 44100 * 10; // 10 seconds if no audio detected at start
    this._isInitialPhase = true; // Track if we're in the initial phase

    this.port.onmessage = (event) => {
      if (event.data.command === "stop") {
        this._isStopped = true;
        // Always send final chunk when stopped, even if paused
        // Send whatever audio we have accumulated
        const flat = Float32Array.from(this._buffer.flat());
        this.port.postMessage(
          {
            command: "finalChunk",
            audioBuffer: flat.buffer,
          },
          [flat.buffer]
        );
        this._buffer = [];
      }

      if (event.data.command === "uploadChunk") {
        this._uploadChunk = true;
      }

      if (event.data.command === "resetUploadChunk") {
        this._uploadChunk = false;
        this._uploadingChunk = false;
        this._buffer = []; // reset buffer to upload only the next chunk on the preceding calls
      }

      if (event.data.command === "pause") {
        this._isPaused = true;
        // Send current buffer as pause chunk
        if (this._buffer.length > 0) {
          const flat = Float32Array.from(this._buffer.flat());
          this.port.postMessage(
            {
              command: "pauseChunk",
              audioBuffer: flat.buffer,
            },
            [flat.buffer]
          );
          this._buffer = [];
        }
      }

      if (event.data.command === "resume") {
        this._isPaused = false;
        // Reset silence counter when resuming
        this._silentSampleCount = 0;
        this._isInitialPhase = true; // Reset initial phase on resume
        this._recordingStartTime = Date.now();
      }
    };
  }

  process(inputs, outputs, parameters) {
    // Remove the stop handling from here since we handle it in onmessage now
    if (this._isStopped) {
      return false;
    }

    if (this._uploadChunk) {
      if (this._buffer.length > 0) {
        // Send all accumulated audio as a single chunk when stopped
        if (!this._uploadingChunk) {
          const flat = Float32Array.from(this._buffer.flat());
          this.port.postMessage(
            {
              command: "uploadChunk",
              audioBuffer: flat.buffer,
            },
            [flat.buffer]
          );
          this._uploadingChunk = true;
        }
      }
      return true;
    }

    // Only process audio when not paused
    if (!this._isPaused) {
      const input = inputs[0];
      
      // Check if we have valid input
      if (input && input.length > 0 && input[0] && input[0].length > 0) {
        const audioData = input[0];
        
        // Calculate RMS (Root Mean Square) for better audio level detection
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
          sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        
        // Check audio level against threshold
        if (rms > this._audioThreshold) {
          // Audio detected - reset silence counter and mark that we've detected audio
          this._silentSampleCount = 0;
          this._hasDetectedAudio = true;
          this._lastAudioTime = Date.now();
          this._isInitialPhase = false; // We've detected audio, no longer in initial phase
        } else {
          // No audio detected - increment silence counter
          this._silentSampleCount += audioData.length;
        }
        
        // Monitor audio levels - send updates every _audioLevelCheckFrequency samples
        this._audioLevelCheckInterval += audioData.length;
        if (this._audioLevelCheckInterval >= this._audioLevelCheckFrequency) {
          this._audioLevelCheckInterval = 0;
          
          // Send audio level for visualization
          this.port.postMessage({
            command: "audioLevel",
            level: rms
          });
          
          // Calculate silent duration
          const silentDuration = this._silentSampleCount / 44100; // duration in seconds
          const totalRecordingTime = (Date.now() - this._recordingStartTime) / 1000;
          
          // Different thresholds based on scenario
          let shouldTriggerNoAudio = false;
          let warningMessage = "";
          
          if (this._isInitialPhase && !this._hasDetectedAudio) {
            // Initial phase - stricter detection for setup issues
            if (this._silentSampleCount >= this._initialSilenceThreshold) {
              shouldTriggerNoAudio = true;
              warningMessage = `No audio detected for ${Math.round(silentDuration)} seconds. Please check your microphone setup.`;
            }
          } else if (this._hasDetectedAudio) {
            // We've detected audio before, so longer silence is acceptable
            // Only warn after very long silence (30+ seconds)
            if (this._silentSampleCount >= this._maxSilentSamples) {
              // Don't immediately stop - just send a warning
              this.port.postMessage({
                command: "prolongedSilence",
                silentDuration: silentDuration,
                totalRecordingTime: totalRecordingTime,
                lastAudioTime: (Date.now() - this._lastAudioTime) / 1000
              });
              
              // Reset to avoid repeated warnings every few seconds
              this._silentSampleCount = this._maxSilentSamples - (44100 * 10); // Reset to 20 seconds ago
            }
          }
          
          if (shouldTriggerNoAudio) {
            console.log(`Medical scenario - ${warningMessage}`);
            
            this.port.postMessage({
              command: "noAudioDetected",
              silentDuration: silentDuration,
              hasDetectedAudio: this._hasDetectedAudio,
              isInitialPhase: this._isInitialPhase,
              totalRecordingTime: totalRecordingTime
            });
            
            // Reset to avoid repeated messages
            this._silentSampleCount = 0;
          }
        }
        
        // Save the audio data
        this._buffer.push([...audioData]);
      } else {
        // No input data available - count as silence
        this._silentSampleCount += 128; // Approximate frame size
        
        // Only check for no audio in initial phase without input
        if (this._isInitialPhase && !this._hasDetectedAudio && this._silentSampleCount >= this._initialSilenceThreshold) {
          this.port.postMessage({
            command: "noAudioDetected",
            silentDuration: this._silentSampleCount / 44100,
            hasDetectedAudio: this._hasDetectedAudio,
            isInitialPhase: this._isInitialPhase,
            totalRecordingTime: (Date.now() - this._recordingStartTime) / 1000
          });
          this._silentSampleCount = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
