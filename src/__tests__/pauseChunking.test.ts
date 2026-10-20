// Behaviour of pause-based chunking in the AudioWorklet.
//
// What this exists to protect: the recorder normally ends a chunk when the
// interval elapses, wherever that happens to fall. A boundary landing mid-word
// is transcribed either as two halves or as nothing at all, and nothing
// downstream can tell which happened — a lost word leaves no trace. Cutting in
// a gap avoids causing the damage instead of trying to repair it afterwards.
//
// Several of these cases are failures that actually happened while this was
// being built, and each one looked like success from the outside:
//
//   - a floor allowed to reach zero made every sample read as speech, so no
//     pause was ever found. The detector looked like it was working and simply
//     reporting a talkative speaker.
//   - a single threshold instead of two cut on the dips between syllables,
//     reporting a clean pause at a boundary that went through a word.
//   - a window measured in absolute seconds fought the host's own interval
//     once that became configurable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 16000;
/** An AudioWorklet render quantum is always 128 frames. */
const QUANTUM = 128;
const ROOT = join(__dirname, '..');

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

type Message = { command: string; cutReason?: string | null; cutDepthDb?: number | null };

function load(options: Record<string, unknown> = {}) {
  const source = embeddedSource('useAudioRecorder');
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
  const node = new Processor({
    processorOptions: { sampleRate: RATE, chunkIntervalMs: 47_000, ...options },
  });
  return { node, messages };
}

/**
 * One quantum of a 1 kHz tone at the given amplitude.
 *
 * The frequency matters. The detector only listens between 300 and 3400 Hz, so
 * a signal outside that band — a DC offset, or the alternating-sign square wave
 * that first seemed the obvious way to write this — is filtered away and reads
 * as silence no matter how loud it is.
 */
let phase = 0;
const quantum = (level: number) => {
  const buf = new Float32Array(QUANTUM);
  for (let i = 0; i < QUANTUM; i++) {
    buf[i] = level * Math.sin((2 * Math.PI * 1000 * phase) / RATE);
    phase++;
  }
  return [[buf]];
};

const quantaFor = (seconds: number) => Math.ceil((seconds * RATE) / QUANTUM);

function feed(node: { process: (i: unknown, o: unknown) => boolean }, seconds: number, level: number) {
  for (let q = 0; q < quantaFor(seconds); q++) node.process(quantum(level), []);
}

const SPEECH = 0.3;
const SILENCE = 0.0008;
const ON = { pauseChunking: { enabled: true } };

describe('pause chunking', () => {
  it('is off unless the host asks for it', () => {
    const { node, messages } = load();
    feed(node, 40, SPEECH);
    feed(node, 3, SILENCE);
    // Without the option the worklet must behave exactly as before: nothing is
    // flushed until the host's own timer posts uploadChunk.
    expect(messages.filter((m) => m.command === 'chunk')).toHaveLength(0);
  });

  it('cuts once a pause arrives inside the window', () => {
    const { node, messages } = load(ON);
    feed(node, 30, SPEECH); // past 55% of 47s
    feed(node, 1, SILENCE);
    const cuts = messages.filter((m) => m.command === 'chunk');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].cutReason).toBe('pause');
  });

  it('never cuts before the window opens, however long the speaker is quiet', () => {
    const { node, messages } = load(ON);
    feed(node, 2, SPEECH);
    feed(node, 20, SILENCE); // silent well past the pause requirement
    expect(messages.filter((m) => m.command === 'chunk')).toHaveLength(0);
  });

  it('sizes the window against the host interval rather than fixed seconds', () => {
    // At a 60s interval the window opens at 33s, so a pause at 20s is too early
    // and the same pause at 40s is not. Sizing in absolute seconds would fight
    // whatever interval the host has configured.
    const early = load({ ...ON, chunkIntervalMs: 60_000 });
    feed(early.node, 20, SPEECH);
    feed(early.node, 1, SILENCE);
    expect(early.messages.filter((m) => m.command === 'chunk')).toHaveLength(0);

    const late = load({ ...ON, chunkIntervalMs: 60_000 });
    feed(late.node, 40, SPEECH);
    feed(late.node, 1, SILENCE);
    expect(late.messages.filter((m) => m.command === 'chunk')).toHaveLength(1);
  });

  it('ignores a gap shorter than the quiet requirement', () => {
    const { node, messages } = load(ON);
    feed(node, 30, SPEECH);
    feed(node, 0.2, SILENCE); // under the 500ms default
    feed(node, 2, SPEECH);
    expect(messages.filter((m) => m.command === 'chunk')).toHaveLength(0);
  });

  it('rides over the dips between syllables', () => {
    // A single threshold would see each dip as the start of a pause and cut
    // mid-word while reporting a clean boundary. The two thresholds exist for
    // exactly this, so the test alternates speech and brief quiet.
    const { node, messages } = load(ON);
    feed(node, 30, SPEECH);
    for (let i = 0; i < 20; i++) {
      feed(node, 0.08, SILENCE);
      feed(node, 0.15, SPEECH);
    }
    expect(messages.filter((m) => m.command === 'chunk')).toHaveLength(0);
  });

  it('still finds a pause when the room is noisy', () => {
    // The bar is a multiple of the tracked room level, not a fixed loudness,
    // so a raised floor must not stop detection. Speech and "silence" are both
    // scaled up here; only their ratio matters.
    const { node, messages } = load(ON);
    feed(node, 30, SPEECH * 4);
    feed(node, 1, SILENCE * 4);
    const cuts = messages.filter((m) => m.command === 'chunk');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].cutReason).toBe('pause');
  });

  it('does not treat digital silence as speech', () => {
    // The tracked floor falls toward whatever it hears. Allowed to reach zero,
    // every sample is then infinitely above it and reads as speech, so no pause
    // is ever found — which looks identical to a working detector listening to
    // someone who never stops talking. The floor has a hard minimum for this.
    const { node, messages } = load(ON);
    feed(node, 30, 0);
    const cuts = messages.filter((m) => m.command === 'chunk');
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts[0].cutReason).toBe('pause');
  });

  it('reports how far below the speaker the cut fell', () => {
    const { node, messages } = load(ON);
    feed(node, 30, SPEECH);
    feed(node, 1, SILENCE);
    const cut = messages.find((m) => m.command === 'chunk');
    expect(cut).toBeDefined();
    expect(typeof cut!.cutDepthDb).toBe('number');
    // Quiet is three orders of magnitude below speech here; the exact figure
    // depends on where the trackers have settled, so only the direction and a
    // generous bound are asserted.
    expect(cut!.cutDepthDb!).toBeLessThan(-20);
  });

  it('measures the next chunk from the cut, not from the start', () => {
    const { node, messages } = load(ON);
    feed(node, 30, SPEECH);
    feed(node, 1, SILENCE);
    expect(messages.filter((m) => m.command === 'chunk')).toHaveLength(1);
    // A second pause immediately after must not cut again: the window has to
    // reopen from the new boundary.
    feed(node, 2, SPEECH);
    feed(node, 1, SILENCE);
    expect(messages.filter((m) => m.command === 'chunk')).toHaveLength(1);
  });
});
