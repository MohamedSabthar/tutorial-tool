import type { Rect } from '@studio/core';

/**
 * Coordinates:
 * - source px: pixels of the recorded frame (events, bboxes)
 * - stage px: the 1920×1080 composition; the source frame is fitted inside (letterbox)
 * - the camera zooms around a focus point in stage px: at zoom z, stage point `focus`
 *   appears at the stage centre and everything is scaled by z.
 */
export interface Fit {
  /** Source → stage scale. */
  scale: number;
  /** Where the fitted source frame sits on the stage. */
  rect: Rect;
}

/** The composition size every overlay and export uses (stage px). */
export const STAGE_SIZE = { width: 1920, height: 1080 } as const;

export function fitSource(
  src: { width: number; height: number },
  stage: { width: number; height: number },
): Fit {
  const scale = Math.min(stage.width / src.width, stage.height / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  return { scale, rect: { x: (stage.width - w) / 2, y: (stage.height - h) / 2, w, h } };
}

export function sourceToStage(r: Rect, fit: Fit): Rect {
  return {
    x: fit.rect.x + r.x * fit.scale,
    y: fit.rect.y + r.y * fit.scale,
    w: r.w * fit.scale,
    h: r.h * fit.scale,
  };
}

export interface CameraState {
  zoom: number;
  /** Stage point shown at the centre of the stage. */
  focusX: number;
  focusY: number;
}

export const restCamera = (stage: { width: number; height: number }): CameraState => ({
  zoom: 1,
  focusX: stage.width / 2,
  focusY: stage.height / 2,
});

/** Where a stage point appears on screen (stage px) under the camera. */
export function project(
  p: { x: number; y: number },
  cam: CameraState,
  stage: { width: number; height: number },
) {
  return {
    x: (p.x - cam.focusX) * cam.zoom + stage.width / 2,
    y: (p.y - cam.focusY) * cam.zoom + stage.height / 2,
  };
}

export function projectRect(r: Rect, cam: CameraState, stage: { width: number; height: number }): Rect {
  const a = project({ x: r.x, y: r.y }, cam, stage);
  return { x: a.x, y: a.y, w: r.w * cam.zoom, h: r.h * cam.zoom };
}

/**
 * Keeps the visible window inside `bounds` (the fitted video), so zooming never reveals the
 * letterbox around the recording.
 */
export function clampCamera(
  cam: CameraState,
  bounds: Rect,
  stage: { width: number; height: number },
): CameraState {
  const halfW = stage.width / 2 / cam.zoom;
  const halfH = stage.height / 2 / cam.zoom;
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
  return {
    zoom: cam.zoom,
    focusX: clamp(cam.focusX, bounds.x + halfW, bounds.x + bounds.w - halfW),
    focusY: clamp(cam.focusY, bounds.y + halfH, bounds.y + bounds.h - halfH),
  };
}

/** A camera move: from `start` it eases to `to` over `ease`, holds, then eases back by `end`. */
export interface CameraMove {
  start: number;
  end: number;
  /** Target in stage px (usually the centre of an anchored element) and zoom. */
  to: CameraState;
  /** Seconds to ease in and out. */
  ease?: number;
}

const smooth = (u: number) => {
  const x = Math.min(Math.max(u, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Camera at time t from a list of non-overlapping moves (later moves win on overlap). */
export function cameraAt(
  t: number,
  moves: CameraMove[],
  rest: CameraState,
  bounds: Rect,
  stage: { width: number; height: number },
): CameraState {
  let cam = rest;
  for (const m of moves) {
    if (t < m.start || t > m.end) continue;
    const e = Math.min(m.ease ?? 0.6, (m.end - m.start) / 2);
    const u = t < m.start + e ? smooth((t - m.start) / e) : t > m.end - e ? smooth((m.end - t) / e) : 1;
    cam = {
      zoom: lerp(rest.zoom, m.to.zoom, u),
      focusX: lerp(rest.focusX, m.to.focusX, u),
      focusY: lerp(rest.focusY, m.to.focusY, u),
    };
  }
  return clampCamera(cam, bounds, stage);
}
