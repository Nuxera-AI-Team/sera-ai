/**
 * Audio configuration constants used throughout the application.
 * Centralizing these values ensures consistency in audio recording,
 * processing, and recovery operations.
 */

/**
 * Minimum valid audio sample rate in Hz.
 * 16000 Hz is the minimum for good speech recognition quality.
 */
export const MIN_VALID_SAMPLE_RATE = 16000;

/**
 * Maximum valid audio sample rate in Hz.
 * 48000 Hz is the standard browser AudioContext sample rate.
 */
export const MAX_VALID_SAMPLE_RATE = 48000;

/**
 * Validates that a sample rate is present and within acceptable range.
 * @param sampleRate - The sample rate to validate
 * @returns true if valid, false otherwise
 */
export const isValidSampleRate = (sampleRate: number | null | undefined): sampleRate is number => {
  return (
    sampleRate !== null &&
    sampleRate !== undefined &&
    !isNaN(sampleRate) &&
    sampleRate >= MIN_VALID_SAMPLE_RATE &&
    sampleRate <= MAX_VALID_SAMPLE_RATE
  );
};

/**
 * Error class for invalid sample rate conditions.
 */
export class InvalidSampleRateError extends Error {
  constructor(sampleRate: number | null | undefined) {
    const message = sampleRate === null || sampleRate === undefined
      ? "Audio captured with missing sample rate. Sample rate must be provided."
      : `Audio captured with invalid sample rate: ${sampleRate}Hz. Sample rate must be between ${MIN_VALID_SAMPLE_RATE}Hz and ${MAX_VALID_SAMPLE_RATE}Hz.`;
    super(message);
    this.name = "InvalidSampleRateError";
  }
}

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
 * Calculate samples from seconds using the provided sample rate.
 * @param seconds - Duration in seconds
 * @param sampleRate - The sample rate in Hz (required)
 */
export const secondsToSamples = (seconds: number, sampleRate: number): number => {
  return Math.floor(seconds * sampleRate);
};
