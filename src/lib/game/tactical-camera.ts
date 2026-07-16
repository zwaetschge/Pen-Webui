export type CameraTransform = {
  x: number;
  y: number;
  scale: number;
};

export type Point = { x: number; y: number };

export function fitCameraToViewport(input: {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  padding?: number;
  minScale?: number;
  maxScale?: number;
}): CameraTransform {
  const viewportWidth = positive(input.viewportWidth);
  const viewportHeight = positive(input.viewportHeight);
  const contentWidth = positive(input.contentWidth);
  const contentHeight = positive(input.contentHeight);
  const padding = Math.max(
    0,
    Math.min(
      finite(input.padding, 16),
      Math.min(viewportWidth, viewportHeight) / 2,
    ),
  );
  const minScale = Math.max(0.01, finite(input.minScale, 0.1));
  const maxScale = Math.max(minScale, finite(input.maxScale, 1));
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = clamp(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
    minScale,
    maxScale,
  );

  return {
    x: (viewportWidth - contentWidth * scale) / 2,
    y: (viewportHeight - contentHeight * scale) / 2,
    scale,
  };
}

export function cameraForWorldAnchor(input: {
  worldAnchor: Point;
  viewportPoint: Point;
  scale: number;
  minScale?: number;
  maxScale?: number;
}): CameraTransform {
  const minScale = Math.max(0.01, finite(input.minScale, 0.1));
  const maxScale = Math.max(minScale, finite(input.maxScale, 3));
  const scale = clamp(finite(input.scale, 1), minScale, maxScale);
  return {
    x: input.viewportPoint.x - input.worldAnchor.x * scale,
    y: input.viewportPoint.y - input.worldAnchor.y * scale,
    scale,
  };
}

function positive(value: number) {
  return Math.max(1, finite(value, 1));
}

function finite(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
