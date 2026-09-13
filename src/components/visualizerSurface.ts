/**
 * Resolves what the visualizer paints behind its animation.
 *
 * By default the surface follows the host's light/dark theme, which assumes the
 * host is white or near-black. Hosts on a fixed theme of their own (a browser
 * extension side panel, a branded dashboard) pass an explicit colour — or
 * "transparent" to let their own background show through.
 */
export interface VisualizerSurface {
  /** Whether the canvas needs an alpha channel — i.e. nothing is painted behind. */
  transparent: boolean;
  /** Colour the render loop fills each frame with, or null to clear instead. */
  fill: string | null;
  /** CSS background for the canvas element. */
  canvasBackground: string;
  /** CSS background for the disc sitting behind the canvas. */
  discBackground: string;
  canvasShadow: string;
  discShadow: string;
}

const TRANSPARENT: VisualizerSurface = {
  transparent: true,
  fill: null,
  canvasBackground: "transparent",
  discBackground: "transparent",
  canvasShadow: "none",
  discShadow: "none",
};

const LIGHT: VisualizerSurface = {
  transparent: false,
  fill: "#ffffff",
  canvasBackground: "white",
  discBackground: "white",
  canvasShadow: "none",
  discShadow: "inset 0 0 10px rgba(0, 0, 0, 0.05)",
};

const DARK: VisualizerSurface = {
  transparent: false,
  fill: "#121826",
  canvasBackground: "linear-gradient(135deg, rgba(13, 18, 30, 1) 0%, rgba(13, 18, 30, 1) 100%)",
  discBackground: "linear-gradient(135deg, rgba(17, 24, 39, 0.4) 0%, rgba(17, 24, 39, 0.2) 100%)",
  canvasShadow: "inset 0 0 20px rgba(13, 18, 30, 0.8)",
  discShadow: "inset 0 0 30px rgba(0, 0, 0, 0.5)",
};

/**
 * @param background CSS colour, "transparent", or undefined to follow the theme.
 * @param isDarkMode Only consulted when `background` is undefined.
 */
export function resolveVisualizerSurface(
  background: string | undefined,
  isDarkMode: boolean
): VisualizerSurface {
  if (background === undefined) {
    return isDarkMode ? DARK : LIGHT;
  }

  if (background.trim().toLowerCase() === "transparent") {
    return TRANSPARENT;
  }

  return {
    transparent: false,
    fill: background,
    canvasBackground: background,
    discBackground: background,
    // The theme's inset shadows are tuned to a white or near-black surface and
    // read as grime over anything else.
    canvasShadow: "none",
    discShadow: "none",
  };
}
