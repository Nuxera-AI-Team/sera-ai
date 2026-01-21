/**
 * Audio configuration constants used throughout the application.
 * Centralizing these values ensures consistency in audio recording,
 * processing, and recovery operations.
 */

/**
 * Default audio sample rate in Hz.
 * 16000 Hz (16 kHz) is optimal for speech recognition:
 * - Standard for telephony and speech processing
 * - Captures frequencies up to 8 kHz (sufficient for human speech)
 * - Smaller file sizes compared to 44100 Hz
 * - Compatible with most speech-to-text APIs
 */
export const AUDIO_SAMPLE_RATE = 16000;

/**
 * Silence detection threshold in amplitude (0-1 range).
 * Values below this are considered silence.
 */
export const AUDIO_SILENCE_THRESHOLD = 0.002;

/**
 * Maximum duration of silence before auto-stopping (in seconds).
 */
export const MAX_SILENCE_DURATION_SECONDS = 30;

/**
 * Initial silence threshold before first audio detection (in seconds).
 * Allows time for user to start speaking.
 */
export const INITIAL_SILENCE_THRESHOLD_SECONDS = 10;

/**
 * Calculate samples from seconds using the default sample rate.
 */
export const secondsToSamples = (seconds: number, sampleRate: number = AUDIO_SAMPLE_RATE): number => {
  return Math.floor(seconds * sampleRate);
};
