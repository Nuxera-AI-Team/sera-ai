// Dedicated worker — encodes captured Float32 PCM into a 16-bit WAV file.
//
// Packaged, CSP-safe version: hosts under a strict CSP (MV3 extension) load this
// by URL via the `wavWorkerUrl` option instead of a blob: worker. It must stay
// in sync with the inline blob fallback in ../hooks/useFFmpegConverter.ts
// (createWavConversionWorker). The sample-rate bounds mirror
// ../constants/audio.ts (MIN_VALID_SAMPLE_RATE / MAX_VALID_SAMPLE_RATE).
const MIN_SAMPLE_RATE = 16000;
const MAX_SAMPLE_RATE = 48000;

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

self.onmessage = function (e) {
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
