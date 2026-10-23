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

/**
 * When a scene's closing moment (a reply, a result) lands after its n steps: on beat n when the
 * narration has a line for it, otherwise a little after the last step and before the end.
 */
export function afterSteps(timing: SceneTiming, n: number, duration: number): number {
  if (timing.order[n] !== undefined) return timing.beats[timing.order[n]!]!;
  const last = n > 0 ? stepTime(timing, n - 1, n, duration) : 0;
  return Math.min(Math.max(last + 1.2, duration - 1.8), Math.max(last + 0.4, duration - 0.6));
}

/** Overshooting ease-out (0..1, peaks a little above 1): for things that pop in. */
export function pop(t: number, a: number, b: number, overshoot = 1.6): number {
  if (b <= a) return t >= b ? 1 : 0;
  const x = clamp01((t - a) / (b - a)) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

/** Ease-out (cubic), 0..1 for t between a and b. */
export function easeOut(t: number, a: number, b: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  return 1 - Math.pow(1 - clamp01((t - a) / (b - a)), 3);
}
