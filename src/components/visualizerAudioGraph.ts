/**
 * The Web Audio graph behind the recording visualizer: a mic stream feeding an
 * analyser, plus the frequency buffer the render loop reads each frame.
 *
 * Kept out of the component so the lifecycle is explicit and testable. Every
 * graph owns an AudioContext, and browsers cap how many a document may have
 * open at once — so a host that starts and stops recording repeatedly (an
 * extension side panel, a long-lived SPA) must dispose each graph it creates.
 */
export interface VisualizerAudioGraph {
  analyser: AnalyserNode;
  /** Frequency buffer sized to the analyser, reused across frames. */
  dataArray: Uint8Array<ArrayBuffer>;
  /** Tears the graph down and releases its AudioContext. Safe to call twice. */
  dispose: () => void;
}

/**
 * Builds an analyser graph over `mediaStream`.
 *
 * @param fftSize FFT window size; the frequency buffer gets half as many bins.
 */
export function createVisualizerAudioGraph(
  mediaStream: MediaStream,
  fftSize = 512
): VisualizerAudioGraph {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = fftSize;

  const source = audioContext.createMediaStreamSource(mediaStream);
  source.connect(analyser);

  const dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;

    // A context torn down mid-teardown (page unload, an already-closed context)
    // throws from any of these. There is nothing left to salvage at that point,
    // so drop it rather than surfacing an error from a cleanup path.
    try {
      source.disconnect();
      analyser.disconnect();
      void Promise.resolve(audioContext.close()).catch(() => {});
    } catch {
      /* already torn down */
    }
  };

  return { analyser, dataArray, dispose };
}
