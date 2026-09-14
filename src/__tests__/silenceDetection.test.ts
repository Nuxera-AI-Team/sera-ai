// Behaviour of the AudioWorklet's silence detection.
//
// What this exists to prevent: the check used to answer ANY 30s of quiet with
// noAudioDetected, and useAudioRecorder answers that by calling stopRecording().
// A clinician who examined a patient quietly for half a minute therefore lost the
// recording mid-consultation — and because the capture stream is opened with
// noiseSuppression and autoGainControl on, the ambient floor that would have kept
// the counter reset is actively suppressed. A clinician who simply didn't speak
// for the first 10s lost it too.
//
// The rule is now split by whether anything has EVER been heard:
//   - nothing ever heard  -> noAudioDetected. Stopping is right: the input is
//     dead and there is nothing to capture.
//   - heard, then quiet   -> prolongedSilence, and capture continues. A quiet
//     stretch mid-consultation is normal and must never cost the recording.
//
// The suite runs against all three copies of the detection block that ship in
// this package. They are duplicated because two are embedded as blob-worker
// source and one is a real file loaded by URL under a strict CSP; running one
// behavioural suite over all three is what keeps them from drifting apart.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIO_SILENCE_THRESHOLD,
  MAX_SILENCE_DURATION_SECONDS,
  INITIAL_SILENCE_THRESHOLD_SECONDS,
  SUSTAINED_AUDIO_QUANTA,
} from '../constants/audio';

const RATE = 16000;
/** An AudioWorklet render quantum is always 128 frames. */
const QUANTUM = 128;
const ROOT = join(__dirname, '..');

/** The processor source shipped as a loadable file, for CSP-bound hosts. */
function packagedSource(): string {
  return readFileSync(join(ROOT, 'workers', 'audio-processor.js'), 'utf8');
}

/** The same processor, embedded as blob-worker source inside a hook. */
function embeddedSource(hook: string): string {
  const file = readFileSync(join(ROOT, 'hooks', `${hook}.ts`), 'utf8');
  const opened = file.indexOf('const workerCode = `');
  const start = file.indexOf('`', opened) + 1;
  const end = file.indexOf('`', start);
  const source = file.slice(start, end);
  if (!source.includes('AudioWorkletProcessor')) {
    throw new Error(`could not extract the embedded worklet from ${hook}`);
  }
  return source;
}

type Message = {
  command: string;
  message?: string;
  level?: number;
  silentDuration?: number;
  isInitialPhase?: boolean;
  hasDetectedAudio?: boolean;
};

/** Instantiate a processor from source, with just enough worklet global scope. */
function load(source: string) {
  const messages: Message[] = [];
  const port = { postMessage: (m: Message) => messages.push(m), onmessage: null };
  const Base = class {
    port = port;
  };
  const name = /class (\w+) extends AudioWorkletProcessor/.exec(source)?.[1];
  if (!name) throw new Error('no processor class found in source');
  const build = new Function(
    'AudioWorkletProcessor',
    'sampleRate',
    'registerProcessor',
    `${source.replace(/registerProcessor\([^)]*\);?/s, '')}\nreturn ${name};`,
  );
  const Processor = build(Base, RATE, () => {});
  return { node: new Processor({ processorOptions: { sampleRate: RATE } }), messages };
}

/** One render quantum at a given mean absolute amplitude. */
const quantum = (level: number) => [[new Float32Array(QUANTUM).fill(level)]];

const LOUD = AUDIO_SILENCE_THRESHOLD * 25;
const SILENT = 0;
const quantaFor = (seconds: number) => Math.ceil((seconds * RATE) / QUANTUM);

/** Feed `seconds` of audio at `level`, returning everything the worklet posted. */
function feed(
  node: { process: (i: unknown, o: unknown) => boolean },
  messages: Message[],
  seconds: number,
  level: number,
): Message[] {
  const before = messages.length;
  for (let q = 0; q < quantaFor(seconds); q++) node.process(quantum(level), []);
  return messages.slice(before);
}

const of = (messages: Message[], command: string) =>
  messages.filter((m) => m.command === command);

const SOURCES: Array<[string, () => string]> = [
  ['packaged worklet file', packagedSource],
  ['useAudioRecorder embedded copy', () => embeddedSource('useAudioRecorder')],
  ['useAudioCapture embedded copy', () => embeddedSource('useAudioCapture')],
];

describe.each(SOURCES)('silence detection — %s', (_label, source) => {
  describe('an input that never delivers audio', () => {
    it('reports it once the initial window passes', () => {
      const { node, messages } = load(source());
      const posted = feed(node, messages, INITIAL_SILENCE_THRESHOLD_SECONDS + 1, SILENT);
      expect(of(posted, 'noAudioDetected')).toHaveLength(1);
    });

    it('says nothing before that window is up', () => {
      const { node, messages } = load(source());
      const posted = feed(node, messages, INITIAL_SILENCE_THRESHOLD_SECONDS - 1, SILENT);
      expect(of(posted, 'noAudioDetected')).toHaveLength(0);
    });

    // It used to post on every render quantum — about 125 messages a second, each
    // one re-entering stopRecording() and scheduling its own teardown timer.
    it('reports it once, not once per quantum', () => {
      const { node, messages } = load(source());
      const posted = feed(node, messages, INITIAL_SILENCE_THRESHOLD_SECONDS + 20, SILENT);
      expect(of(posted, 'noAudioDetected')).toHaveLength(1);
    });

    // The consumer builds its message out of these. All three used to be absent,
    // so what reached the clinician was assembled around a NaN.
    it('carries the state the consumer describes it with', () => {
      const { node, messages } = load(source());
      const [posted] = of(
        feed(node, messages, INITIAL_SILENCE_THRESHOLD_SECONDS + 1, SILENT),
        'noAudioDetected',
      );
      expect(posted.isInitialPhase).toBe(true);
      expect(posted.hasDetectedAudio).toBe(false);
      expect(posted.silentDuration).toBeGreaterThanOrEqual(
        INITIAL_SILENCE_THRESHOLD_SECONDS,
      );
      expect(Number.isFinite(posted.silentDuration)).toBe(true);
    });
  });

  describe('a live input that goes quiet', () => {
    /** Establish that the input is working, then let it go quiet. */
    const afterSpeech = (quietSeconds: number) => {
      const { node, messages } = load(source());
      feed(node, messages, 1, LOUD);
      return feed(node, messages, quietSeconds, SILENT);
    };

    // The regression this whole suite exists for.
    it('never reports it as a dead input', () => {
      const posted = afterSpeech(MAX_SILENCE_DURATION_SECONDS + 30);
      expect(of(posted, 'noAudioDetected')).toHaveLength(0);
    });

    it('reports prolonged silence instead, once', () => {
      const posted = afterSpeech(MAX_SILENCE_DURATION_SECONDS + 20);
      expect(of(posted, 'prolongedSilence')).toHaveLength(1);
    });

    it('stays quiet through a pause shorter than the window', () => {
      const posted = afterSpeech(MAX_SILENCE_DURATION_SECONDS - 1);
      expect(of(posted, 'prolongedSilence')).toHaveLength(0);
    });

    it('says the input is live, so the consumer can tell the two apart', () => {
      const [posted] = of(afterSpeech(MAX_SILENCE_DURATION_SECONDS + 1), 'prolongedSilence');
      expect(posted.isInitialPhase).toBe(false);
      expect(posted.hasDetectedAudio).toBe(true);
      expect(posted.silentDuration).toBeGreaterThanOrEqual(MAX_SILENCE_DURATION_SECONDS);
    });

    it('reports each quiet stretch, not just the first', () => {
      const { node, messages } = load(source());
      feed(node, messages, 1, LOUD);
      feed(node, messages, MAX_SILENCE_DURATION_SECONDS + 1, SILENT);
      feed(node, messages, 1, LOUD);
      const second = feed(node, messages, MAX_SILENCE_DURATION_SECONDS + 1, SILENT);
      expect(of(second, 'prolongedSilence')).toHaveLength(1);
    });
  });

  describe('an input delivering stray blips but no real audio', () => {
    // A dead-ish input picking up the odd electrical click used to reset the
    // counter on a single 8ms quantum, so the check never fired at all — the
    // failure it exists to catch was the one it reliably missed.
    it('is still reported as dead', () => {
      const { node, messages } = load(source());
      for (let s = 0; s < INITIAL_SILENCE_THRESHOLD_SECONDS + 2; s++) {
        node.process(quantum(LOUD), []); // one isolated quantum — a click
        feed(node, messages, 1, SILENT);
      }
      expect(of(messages, 'noAudioDetected')).toHaveLength(1);
    });

    it('treats sustained audio as real', () => {
      const { node, messages } = load(source());
      for (let s = 0; s < INITIAL_SILENCE_THRESHOLD_SECONDS + 2; s++) {
        for (let q = 0; q < SUSTAINED_AUDIO_QUANTA; q++) node.process(quantum(LOUD), []);
        feed(node, messages, 1, SILENT);
      }
      expect(of(messages, 'noAudioDetected')).toHaveLength(0);
    });
  });

  it('ignores a paused recording entirely', () => {
    const { node, messages } = load(source());
    (node as unknown as { _isPaused: boolean })._isPaused = true;
    const posted = feed(node, messages, INITIAL_SILENCE_THRESHOLD_SECONDS + 5, SILENT);
    expect(of(posted, 'noAudioDetected')).toHaveLength(0);
    expect(of(posted, 'prolongedSilence')).toHaveLength(0);
  });
});

// A consumer may know something the worklet cannot: that its clinicians often
// spend the opening of a visit settling a patient before anyone speaks. With
// noiseSuppression active the room floor can sit under the threshold for that
// whole stretch, and the default 10s window would end the recording. Hosts can
// widen it rather than fork the worklet.
describe.each(SOURCES)('configurable windows — %s', (_label, source) => {
  function withOptions(opts: Record<string, number>) {
    const messages: Message[] = [];
    const port = { postMessage: (m: Message) => messages.push(m), onmessage: null };
    const Base = class {
      port = port;
    };
    const src = source();
    const name = /class (\w+) extends AudioWorkletProcessor/.exec(src)![1];
    const build = new Function(
      'AudioWorkletProcessor',
      'sampleRate',
      'registerProcessor',
      `${src.replace(/registerProcessor\([^)]*\);?/s, '')}\nreturn ${name};`,
    );
    const Processor = build(Base, RATE, () => {});
    return {
      node: new Processor({ processorOptions: { sampleRate: RATE, ...opts } }),
      messages,
    };
  }

  it('honours a widened initial window', () => {
    const { node, messages } = withOptions({ initialSilenceSeconds: 45 });
    expect(
      of(feed(node, messages, 30, SILENT), 'noAudioDetected'),
    ).toHaveLength(0);
    expect(of(feed(node, messages, 20, SILENT), 'noAudioDetected')).toHaveLength(1);
  });

  it('honours a widened quiet-stretch window', () => {
    const { node, messages } = withOptions({ prolongedSilenceSeconds: 60 });
    feed(node, messages, 1, LOUD);
    expect(of(feed(node, messages, 40, SILENT), 'prolongedSilence')).toHaveLength(0);
    expect(of(feed(node, messages, 25, SILENT), 'prolongedSilence')).toHaveLength(1);
  });

  it('falls back to the package defaults when the host says nothing', () => {
    const { node, messages } = withOptions({});
    expect(
      of(feed(node, messages, INITIAL_SILENCE_THRESHOLD_SECONDS + 1, SILENT), 'noAudioDetected'),
    ).toHaveLength(1);
  });
});
