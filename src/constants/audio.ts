/**
 * Audio configuration constants used throughout the application.
 * Centralizing these values ensures consistency in audio recording,
 * processing, and recovery operations.
 */

/**
 * Default audio sample rate in Hz.
 * 48000 Hz (48 kHz) is the standard for most browser AudioContext:
 * - Matches most hardware default sample rates (44100 or 48000 Hz)
 * - Used as fallback when actual sample rate cannot be determined
 * - Ensures audio playback speed is correct if fallback is needed
 * - Note: The actual recording uses audioContext.sampleRate which is stored
 *   in recordingSampleRateRef for use throughout the recording session
 */
export const AUDIO_SAMPLE_RATE = 48000;

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
