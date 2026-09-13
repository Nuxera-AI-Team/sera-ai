import { describe, it, expect } from "vitest";
import { resolveVisualizerSurface } from "./visualizerSurface";

describe("resolveVisualizerSurface", () => {
  describe("without a background prop (theme-driven, unchanged behaviour)", () => {
    it("paints white in light mode", () => {
      const surface = resolveVisualizerSurface(undefined, false);

      expect(surface.transparent).toBe(false);
      expect(surface.fill).toBe("#ffffff");
      expect(surface.canvasBackground).toBe("white");
      expect(surface.discBackground).toBe("white");
      expect(surface.canvasShadow).toBe("none");
      expect(surface.discShadow).toBe("inset 0 0 10px rgba(0, 0, 0, 0.05)");
    });

    it("paints the dark surface in dark mode", () => {
      const surface = resolveVisualizerSurface(undefined, true);

      expect(surface.transparent).toBe(false);
      expect(surface.fill).toBe("#121826");
      expect(surface.canvasBackground).toContain("linear-gradient");
      expect(surface.discBackground).toContain("linear-gradient");
      expect(surface.canvasShadow).toBe("inset 0 0 20px rgba(13, 18, 30, 0.8)");
      expect(surface.discShadow).toBe("inset 0 0 30px rgba(0, 0, 0, 0.5)");
    });
  });

  describe("with an explicit colour", () => {
    it("uses it for both the canvas fill and the surrounding disc", () => {
      const surface = resolveVisualizerSurface("#0A0A0A", false);

      expect(surface.transparent).toBe(false);
      expect(surface.fill).toBe("#0A0A0A");
      expect(surface.canvasBackground).toBe("#0A0A0A");
      expect(surface.discBackground).toBe("#0A0A0A");
    });

    it("drops the theme's inset shadows, which assume a white or near-black surface", () => {
      const surface = resolveVisualizerSurface("#0A0A0A", true);

      expect(surface.canvasShadow).toBe("none");
      expect(surface.discShadow).toBe("none");
    });

    it("overrides the theme in either mode", () => {
      expect(resolveVisualizerSurface("rebeccapurple", false).fill).toBe("rebeccapurple");
      expect(resolveVisualizerSurface("rebeccapurple", true).fill).toBe("rebeccapurple");
    });
  });

  describe('with background="transparent"', () => {
    // A null fill tells the render loop to clear the frame instead of painting
    // over it, and the canvas must then be created with an alpha channel.
    it("clears rather than fills, and asks for an alpha channel", () => {
      const surface = resolveVisualizerSurface("transparent", true);

      expect(surface.transparent).toBe(true);
      expect(surface.fill).toBeNull();
    });

    it("stops both elements painting a background", () => {
      const surface = resolveVisualizerSurface("transparent", false);

      expect(surface.canvasBackground).toBe("transparent");
      expect(surface.discBackground).toBe("transparent");
      expect(surface.canvasShadow).toBe("none");
      expect(surface.discShadow).toBe("none");
    });

    it("is recognised regardless of casing or surrounding whitespace", () => {
      expect(resolveVisualizerSurface("  TRANSPARENT ", false).transparent).toBe(true);
      expect(resolveVisualizerSurface("Transparent", false).transparent).toBe(true);
    });
  });
});
