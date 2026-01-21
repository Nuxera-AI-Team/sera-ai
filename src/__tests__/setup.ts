import { vi } from 'vitest';
import '@testing-library/react';

// Mock global Web APIs that don't exist in jsdom

// Mock AudioContext
class MockAudioContext {
  sampleRate = 44100;
  state = 'running';

  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));

  createAnalyser = vi.fn(() => ({
    fftSize: 256,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
  }));

  close = vi.fn(() => Promise.resolve());

  audioWorklet = {
    addModule: vi.fn(() => Promise.resolve()),
  };
}

// Mock AudioWorkletNode
class MockAudioWorkletNode {
  port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };

  connect = vi.fn();
  disconnect = vi.fn();
}

// Mock MediaStream
class MockMediaStream {
  id = 'mock-stream-id';

  private tracks: MediaStreamTrack[] = [];

  constructor() {
    this.tracks = [
      {
        kind: 'audio',
        id: 'mock-track-id',
        enabled: true,
        readyState: 'live',
        stop: vi.fn(),
        getSettings: vi.fn(() => ({
          deviceId: 'mock-device-id',
          sampleRate: 44100,
          channelCount: 1,
        })),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaStreamTrack,
    ];
  }

  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks.filter(t => t.kind === 'audio');
  getVideoTracks = () => [] as MediaStreamTrack[];
}

// Mock MediaDevices
const mockMediaDevices = {
  getUserMedia: vi.fn(() => Promise.resolve(new MockMediaStream())),
  enumerateDevices: vi.fn(() => Promise.resolve([
    {
      deviceId: 'mock-device-id',
      kind: 'audioinput',
      label: 'Mock Microphone',
      groupId: 'mock-group-id',
      toJSON: () => ({}),
    },
  ])),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Mock URL.createObjectURL and revokeObjectURL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();

// Mock fetch
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      sessionId: 'mock-session-id',
      transcription: 'mock transcription',
      classifiedInfo: {},
    }),
    text: () => Promise.resolve(''),
  })
);

// Apply mocks to global scope
Object.defineProperty(globalThis, 'AudioContext', {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(globalThis, 'webkitAudioContext', {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(globalThis, 'AudioWorkletNode', {
  writable: true,
  value: MockAudioWorkletNode,
});

Object.defineProperty(globalThis, 'MediaStream', {
  writable: true,
  value: MockMediaStream,
});

Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  writable: true,
  value: mockMediaDevices,
});

Object.defineProperty(globalThis.URL, 'createObjectURL', {
  writable: true,
  value: mockCreateObjectURL,
});

Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
  writable: true,
  value: mockRevokeObjectURL,
});

Object.defineProperty(globalThis, 'fetch', {
  writable: true,
  value: mockFetch,
});

// Export mocks for test files to use/modify
export {
  MockAudioContext,
  MockAudioWorkletNode,
  MockMediaStream,
  mockMediaDevices,
  mockCreateObjectURL,
  mockRevokeObjectURL,
  mockFetch,
};
