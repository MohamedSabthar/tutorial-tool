import type { SceneTiming } from '@studio/core';

/**
 * The time of step k (0-based) of n: the scene's k-th beat when it has one, otherwise spread
 * evenly over the scene (so a built-in still animates before its narration exists).
 */
export function stepTime(timing: SceneTiming, k: number, n: number, duration: number): number {
  const id = timing.order[k];
  if (id !== undefined) return timing.beats[id]!;
  return (duration * (k + 0.5)) / Math.max(n, 1);
}

/** Index of the step that has started at t (−1 before the first). */
export function activeStep(timing: SceneTiming, n: number, duration: number, t: number): number {
  let k = -1;
  for (let i = 0; i < n; i++) if (t >= stepTime(timing, i, n, duration) - 1e-6) k = i;
  return k;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
