import { createContext, useContext } from 'react';
import type { Rect } from '@studio/core';
import { useCamera, useStageTime } from '@studio/stage';

/** Per-instance context the host provides around each overlay. */
export interface OverlayInstanceContext {
  id: string;
  start: number;
  end: number;
  /** The anchored element's box in stage px (before the camera), if the instance has an anchor. */
  anchor: Rect | null;
}

export const OverlayContext = createContext<OverlayInstanceContext | null>(null);

function useInstance(): OverlayInstanceContext {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('overlay hooks must be used inside an overlay rendered by the stage');
  return ctx;
}

export interface OverlayTime {
  /** Seconds since the instance started (clamped to [0, duration]). */
  t: number;
  /** 0..1 through the instance. */
  progress: number;
  duration: number;
  /** Output time of the whole tutorial. */
  global: number;
}

/** Overlay-local time. The only clock an overlay may use. */
export function useOverlayTime(): OverlayTime {
  const { t } = useStageTime();
  const { start, end } = useInstance();
  const duration = Math.max(end - start, 0.001);
  const local = Math.min(Math.max(t - start, 0), duration);
  return { t: local, progress: local / duration, duration, global: t };
}

/**
 * The anchored element in stage px, before the camera. Place content with it inside
 * `<DomLayer follow>` (or a ThreeLayer) and it stays attached during zooms.
 */
export function useAnchor(): Rect | null {
  return useInstance().anchor;
}

/** Stage size in stage px (1920×1080 by default). */
export function useStageSize() {
  const { width, height } = useStageTime();
  return { width, height };
}

export { useCamera };
export const useOverlayInstance = useInstance;
