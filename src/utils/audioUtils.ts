/**
 * Audio utility functions for processing audio data
 */

/**
 * Combines multiple Float32Array audio chunks into a single Float32Array
 * @param audioChunks - Array of Float32Array audio chunks to combine
 * @returns Combined Float32Array containing all audio data
 */
export function combineAudioChunks(audioChunks: Float32Array[]): Float32Array {
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combinedAudio = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of audioChunks) {
    combinedAudio.set(chunk, offset);
    offset += chunk.length;
  }

  return combinedAudio;
}

/**
 * Converts Float32Array audio samples to a WAV ArrayBuffer
 * This is the core conversion logic, separated for testability
 * @param samples - Float32Array of audio samples (values between -1 and 1)
 * @param sampleRate - Sample rate in Hz (default: 44100)
 * @returns DataView containing WAV data
 */
export function float32ToWavBuffer(samples: Float32Array, sampleRate: number = 44100): DataView {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");

  // fmt subchunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 = mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true);  // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample

  // data subchunk
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true); // Subchunk2Size

  // Write audio data
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp sample to -1 to 1 range
    const sample = Math.max(-1, Math.min(1, samples[i]));
    // Convert to 16-bit signed integer
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return view;
}

/**
 * Converts Float32Array audio samples to a WAV file
 * @param samples - Float32Array of audio samples (values between -1 and 1)
 * @param sampleRate - Sample rate in Hz (default: 44100)
 * @returns WAV File object
 */
export function float32ToWavFile(samples: Float32Array, sampleRate: number = 44100): File {
  const view = float32ToWavBuffer(samples, sampleRate);
  const timestamp = Date.now();
  const filename = `audio-chunk-${timestamp}.wav`;

  return new File([view.buffer as ArrayBuffer], filename, {
    type: "audio/wav",
    lastModified: timestamp,
  });
}
