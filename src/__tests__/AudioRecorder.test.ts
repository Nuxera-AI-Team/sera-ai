import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AudioRecorder from '../AudioRecorder';
import { mockMediaDevices, MockMediaStream } from './setup';

// The component is driven through its own buttons here; the hook's pipeline
// is covered in useAudioRecorder.test.ts. These mocks only keep ffmpeg and
// IndexedDB, which jsdom can't run, out of the way.
const mockFFmpegFns = vi.hoisted(() => ({
  removeSilence: vi.fn((file: File) => Promise.resolve(file)),
  loadFFmpeg: vi.fn(() => Promise.resolve(true)),
  convertToWav: vi.fn(() => Promise.resolve(null)),
  convertToFlac: vi.fn((file: File) => Promise.resolve(file)),
}));

vi.mock('../hooks/useFFmpegConverter', () => ({
  default: () => ({
    ...mockFFmpegFns,
    isLoaded: true,
    ffmpegLoaded: true,
    isConverting: false,
    progress: 0,
    statusMessage: '',
  }),
}));

const mockRecoveryFns = vi.hoisted(() => ({
  createSession: vi.fn(() => Promise.resolve()),
  appendAudioToSession: vi.fn(() => Promise.resolve()),
  markSessionComplete: vi.fn(() => Promise.resolve()),
  markSessionFailed: vi.fn(() => Promise.resolve()),
  retrySession: vi.fn(() => Promise.resolve(true)),
  deleteSession: vi.fn(() => Promise.resolve()),
  getFailedSession: vi.fn(() => Promise.resolve(null)),
  clearFailedSessions: vi.fn(() => Promise.resolve()),
}));

vi.mock('../hooks/useAudioRecovery', () => ({
  default: () => mockRecoveryFns,
}));

// The canvas visualizer draws through a 2D context jsdom doesn't implement.
vi.mock('../components/AudioVisualizerImproved', () => ({
  default: () => null,
}));

const renderRecorder = (onRecordingStateChange = vi.fn()) => {
  const view = render(
    React.createElement(AudioRecorder, {
      apiKey: 'test-api-key',
      speciality: 'general',
      onRecordingStateChange,
    })
  );
  const states = () => onRecordingStateChange.mock.calls.map(([state]) => state);
  return { ...view, states };
};

describe('AudioRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaDevices.getUserMedia.mockImplementation(() => Promise.resolve(new MockMediaStream()));
  });

  // Testing Library only cleans up on its own when the runner exposes a
  // global afterEach, which this config doesn't.
  afterEach(() => {
    cleanup();
  });

  it('tells the host when a recording starts', async () => {
    const { getByRole, states } = renderRecorder();

    fireEvent.click(getByRole('button', { name: /start transcription/i }));

    await waitFor(() => expect(states()).toEqual(['recording']));
  });

  it('turns the microphone off when it unmounts mid-recording', async () => {
    const recording = new MockMediaStream();
    // The first call is the access check; the second opens the recording's stream.
    mockMediaDevices.getUserMedia
      .mockImplementationOnce(() => Promise.resolve(new MockMediaStream()))
      .mockImplementationOnce(() => Promise.resolve(recording));
    const { getByRole, findByRole, unmount, states } = renderRecorder();
    fireEvent.click(getByRole('button', { name: /start transcription/i }));
    await findByRole('button', { name: /stop/i });

    unmount();

    expect(recording.getTracks()[0].stop).toHaveBeenCalled();
    expect(states()).toEqual(['recording', 'idle']);
  });
});
