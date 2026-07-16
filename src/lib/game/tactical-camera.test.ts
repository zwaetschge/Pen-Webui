import { describe, expect, it } from "vitest";
import { cameraForWorldAnchor, fitCameraToViewport } from "./tactical-camera";

describe("tactical camera", () => {
  it("fits the complete square map inside a 1080p TV viewport", () => {
    const camera = fitCameraToViewport({
      viewportWidth: 1920,
      viewportHeight: 1080,
      contentWidth: 1408,
      contentHeight: 1408,
      padding: 16,
    });

    expect(camera.scale).toBeCloseTo(1048 / 1408, 6);
    expect(camera.x).toBeCloseTo(436, 6);
    expect(camera.y).toBeCloseTo(16, 6);
  });

  it("also fits the complete map at a 720p Chromecast resolution", () => {
    const camera = fitCameraToViewport({
      viewportWidth: 1280,
      viewportHeight: 720,
      contentWidth: 1408,
      contentHeight: 1408,
      padding: 16,
    });

    expect(camera.scale).toBeCloseTo(688 / 1408, 6);
    expect(camera.x).toBeCloseTo(296, 6);
    expect(camera.y).toBeCloseTo(16, 6);
  });

  it("keeps a pinched world point under the moving finger midpoint", () => {
    expect(
      cameraForWorldAnchor({
        worldAnchor: { x: 400, y: 300 },
        viewportPoint: { x: 210, y: 180 },
        scale: 1.5,
        minScale: 0.35,
        maxScale: 3,
      }),
    ).toEqual({ x: -390, y: -270, scale: 1.5 });
  });

  it("clamps gesture zoom to the supported range", () => {
    expect(
      cameraForWorldAnchor({
        worldAnchor: { x: 10, y: 20 },
        viewportPoint: { x: 100, y: 100 },
        scale: 9,
        minScale: 0.35,
        maxScale: 3,
      }).scale,
    ).toBe(3);
  });
});
