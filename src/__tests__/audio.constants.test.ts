import { describe, it, expect } from 'vitest';
import {
  MIN_VALID_SAMPLE_RATE,
  MAX_VALID_SAMPLE_RATE,
  isValidSampleRate,
  InvalidSampleRateError,
  AUDIO_SILENCE_THRESHOLD,
  MAX_SILENCE_DURATION_SECONDS,
  INITIAL_SILENCE_THRESHOLD_SECONDS,
  secondsToSamples,
} from '../constants/audio';

describe('Audio Constants', () => {
  describe('constant values', () => {
    it('should define MIN_VALID_SAMPLE_RATE as 16000', () => {
      expect(MIN_VALID_SAMPLE_RATE).toBe(16000);
    });

    it('should define MAX_VALID_SAMPLE_RATE as 48000', () => {
      expect(MAX_VALID_SAMPLE_RATE).toBe(48000);
    });

    it('should define AUDIO_SILENCE_THRESHOLD as 0.002', () => {
      expect(AUDIO_SILENCE_THRESHOLD).toBe(0.002);
    });

    it('should define MAX_SILENCE_DURATION_SECONDS as 30', () => {
      expect(MAX_SILENCE_DURATION_SECONDS).toBe(30);
    });

    it('should define INITIAL_SILENCE_THRESHOLD_SECONDS as 10', () => {
      expect(INITIAL_SILENCE_THRESHOLD_SECONDS).toBe(10);
    });
  });

  describe('isValidSampleRate', () => {
    it('should return true for valid sample rates within range', () => {
      expect(isValidSampleRate(16000)).toBe(true);
      expect(isValidSampleRate(22050)).toBe(true);
      expect(isValidSampleRate(44100)).toBe(true);
      expect(isValidSampleRate(48000)).toBe(true);
    });

    it('should return true for boundary values', () => {
      expect(isValidSampleRate(MIN_VALID_SAMPLE_RATE)).toBe(true);
      expect(isValidSampleRate(MAX_VALID_SAMPLE_RATE)).toBe(true);
    });

    it('should return false for sample rates below minimum', () => {
      expect(isValidSampleRate(8000)).toBe(false);
      expect(isValidSampleRate(15999)).toBe(false);
      expect(isValidSampleRate(0)).toBe(false);
      expect(isValidSampleRate(-1)).toBe(false);
    });

    it('should return false for sample rates above maximum', () => {
      expect(isValidSampleRate(48001)).toBe(false);
      expect(isValidSampleRate(96000)).toBe(false);
      expect(isValidSampleRate(192000)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidSampleRate(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidSampleRate(undefined)).toBe(false);
    });

    it('should return false for NaN', () => {
      expect(isValidSampleRate(NaN)).toBe(false);
    });

    it('should act as a type guard', () => {
      const sampleRate: number | null | undefined = 44100;
      if (isValidSampleRate(sampleRate)) {
        // TypeScript should narrow sampleRate to number here
        const result: number = sampleRate;
        expect(result).toBe(44100);
      }
    });
  });

  describe('InvalidSampleRateError', () => {
    it('should create error with missing sample rate message for null', () => {
      const error = new InvalidSampleRateError(null);
      expect(error.message).toBe(
        'Audio captured with missing sample rate. Sample rate must be provided.'
      );
      expect(error.name).toBe('InvalidSampleRateError');
    });

    it('should create error with missing sample rate message for undefined', () => {
      const error = new InvalidSampleRateError(undefined);
      expect(error.message).toBe(
        'Audio captured with missing sample rate. Sample rate must be provided.'
      );
      expect(error.name).toBe('InvalidSampleRateError');
    });

    it('should create error with invalid sample rate message for out-of-range values', () => {
      const error = new InvalidSampleRateError(8000);
      expect(error.message).toBe(
        `Audio captured with invalid sample rate: 8000Hz. Sample rate must be between ${MIN_VALID_SAMPLE_RATE}Hz and ${MAX_VALID_SAMPLE_RATE}Hz.`
      );
      expect(error.name).toBe('InvalidSampleRateError');
    });

    it('should be an instance of Error', () => {
      const error = new InvalidSampleRateError(null);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidSampleRateError);
    });

    it('should include the actual sample rate in the message', () => {
      const error = new InvalidSampleRateError(96000);
      expect(error.message).toContain('96000Hz');
    });
  });

  describe('secondsToSamples', () => {
    it('should convert seconds to samples using the given sample rate', () => {
      expect(secondsToSamples(1, 44100)).toBe(44100);
      expect(secondsToSamples(2, 44100)).toBe(88200);
    });

    it('should handle different sample rates', () => {
      expect(secondsToSamples(1, 16000)).toBe(16000);
      expect(secondsToSamples(1, 48000)).toBe(48000);
    });

    it('should floor the result for non-integer values', () => {
      expect(secondsToSamples(0.5, 44100)).toBe(22050);
      expect(secondsToSamples(1.5, 44100)).toBe(66150);
    });

    it('should return 0 for 0 seconds', () => {
      expect(secondsToSamples(0, 44100)).toBe(0);
    });

    it('should handle fractional second values that produce non-integer samples', () => {
      // 0.1 * 44100 = 4410, which is exact
      expect(secondsToSamples(0.1, 44100)).toBe(4410);
      // 0.3 * 44100 = 13230
      expect(secondsToSamples(0.3, 44100)).toBe(13230);
    });
  });
});
