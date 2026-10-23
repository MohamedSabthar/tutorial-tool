import type { Rect } from '@studio/core';

/**
 * Coordinates:
 * - source px: pixels of the recorded frame (events, bboxes)
 * - stage px: the 1920×1080 composition; the source frame is fitted inside with a margin, as
 *   a window on the backdrop (`FRAME`)
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

/**
 * How the recording sits on the stage at rest: inset by `inset` stage px on its tighter side,
 * with rounded corners and a soft shadow over the backdrop. Recordings rarely match 16:9 (a
 * MacBook screen is about 3:2), so the free space reads as a deliberate frame, not black bars.
 */
export const FRAME = {
  inset: 44,
  radius: 18,
  backdrop: 'radial-gradient(120% 120% at 15% 0%, #FFFFFF 0%, #F3F3F3 45%, #E4EEF6 100%)',
  shadow: '0 30px 80px rgba(19, 33, 59, 0.22), 0 6px 18px rgba(19, 33, 59, 0.12)',
} as const;

export function fitSource(
  src: { width: number; height: number },
  stage: { width: number; height: number },
  inset: number = FRAME.inset,
): Fit {
  const scale = Math.min((stage.width - 2 * inset) / src.width, (stage.height - 2 * inset) / src.height);
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

/** Moves closer than this glide from one target to the next instead of zooming out between. */
export const CHAIN_GAP = 1.5;
/** How much the camera keeps pushing in while it holds on a target (fraction of the zoom). */
const HOLD_DRIFT = 0.03;

const clamp01 = (u: number) => Math.min(Math.max(u, 0), 1);
/** Cubic ease-in-out: softer starts and stops than a quintic smoothstep. */
const ease = (u: number) => {
  const x = clamp01(u);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/**
 * Camera between two states. A zoom pivots about the one stage point that sits at the same
 * screen position in both views, so the target grows in place instead of sliding while the
 * zoom changes (zoom is interpolated in log space, which reads as constant speed). A pan at
 * one zoom dips out slightly in the middle, like a camera operator re-framing.
 */
export function blendCamera(
  a: CameraState,
  b: CameraState,
  u: number,
  stage: { width: number },
): CameraState {
  const k = ease(u);
  const ratio = Math.log(b.zoom / a.zoom);
  const pan = (): CameraState => {
    const dist = Math.hypot(b.focusX - a.focusX, b.focusY - a.focusY);
    const dip = Math.min(0.12, (dist * a.zoom) / stage.width / 4);
    return {
      zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k)) * (1 - dip * Math.sin(Math.PI * k)),
      focusX: lerp(a.focusX, b.focusX, k),
      focusY: lerp(a.focusY, b.focusY, k),
    };
  };
  const pivot = (): CameraState => {
    const zoom = Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k));
    const px = (b.focusX * b.zoom - a.focusX * a.zoom) / (b.zoom - a.zoom);
    const py = (b.focusY * b.zoom - a.focusY * a.zoom) / (b.zoom - a.zoom);
    return {
      zoom,
      focusX: px + ((a.focusX - px) * a.zoom) / zoom,
      focusY: py + ((a.focusY - py) * a.zoom) / zoom,
    };
  };
  // Nearly equal zooms pan (the pivot would be far away); clearly different ones zoom about the
  // pivot. In between, the two cross-fade, so a ratio that drifts across the line (a glide
  // between two holds that push in) never switches formulas in one frame.
  const w = clamp01((Math.abs(ratio) - 0.01) / 0.04);
  if (w === 0) return pan();
  if (w === 1) return pivot();
  const p = pan();
  const q = pivot();
  return {
    zoom: Math.exp(lerp(Math.log(p.zoom), Math.log(q.zoom), w)),
    focusX: lerp(p.focusX, q.focusX, w),
    focusY: lerp(p.focusY, q.focusY, w),
  };
}

/**
 * Camera at time t. Moves become shots: ease in from rest (or glide from the previous shot when
 * the gap is under CHAIN_GAP), hold with a slow push-in, ease back out.
 *
 * The path is smooth in position and speed: the ease-in blends towards the drifting hold (so it
 * arrives already moving with the push-in, instead of popping to it), the ease-out starts from
 * it, and only the shots' own states are clamped to the video. Clamping every frame made the
 * pan speed jump where the clamp switched on (around ×1.1, once the view no longer showed the
 * frame margin); the pivot path between a clamped shot and rest stays inside the stage anyway.
 */
export function cameraAt(
  t: number,
  moves: CameraMove[],
  rest: CameraState,
  bounds: Rect,
  stage: { width: number; height: number },
): CameraState {
  const shots = [...moves]
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start)
    .map((m) => ({
      ...m,
      to: clampCamera(m.to, bounds, stage),
      e: Math.min(m.ease ?? 0.9, (m.end - m.start) / 2),
    }));
  const held = (s: (typeof shots)[number], at: number): CameraState => {
    const span = Math.max(s.end - s.start, 1e-3);
    const z = s.to.zoom * (1 + HOLD_DRIFT * clamp01((at - s.start) / span));
    return clampCamera({ ...s.to, zoom: z }, bounds, stage);
  };
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    const prev = shots[i - 1];
    const next = shots[i + 1];
    const chainedIn = !!prev && s.start - prev.end < CHAIN_GAP;
    const chainedOut = !!next && next.start - s.end < CHAIN_GAP;
    const holdStart = s.start + s.e;
    // Overlapping moves: leave this shot no later than the next one starts.
    const outStart = chainedOut ? Math.min(s.end - s.e, next!.start) : s.end - s.e;
    const outEnd = chainedOut ? Math.max(next!.start + next!.e, outStart + 0.2) : s.end;
    if (t < holdStart) {
      // A chained shot is entered by the previous shot's glide (handled on its iteration).
      if (chainedIn) continue;
      if (t < s.start) return rest;
      return blendCamera(rest, held(s, t), (t - s.start) / s.e, stage);
    }
    if (t <= outStart) return held(s, t);
    if (t <= outEnd) {
      // From the still-drifting hold, towards the next shot's (drifting) hold or rest.
      const to = chainedOut ? held(next!, Math.max(t, next!.start)) : rest;
      return blendCamera(held(s, t), to, (t - outStart) / (outEnd - outStart), stage);
    }
  }
  return rest;
}
