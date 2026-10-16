/**
 * Human-looking pointer motion and typing rhythm. Deterministic for a given seed, so a
 * re-recorded tutorial moves the same way.
 */
export interface Pt {
  x: number;
  y: number;
}

/** A small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** Movement duration in ms from distance (Fitts-like), clamped to 220–750 ms. */
export function moveDuration(from: Pt, to: Pt): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(Math.min(750, Math.max(220, 180 + 110 * Math.log2(1 + d / 40))));
}

/**
 * Points along a gently curved path from `from` to `to`, one per ~16 ms. The curve bows to
 * one side by a few percent of the distance, the way a hand does.
 */
export function mousePath(from: Pt, to: Pt, random: () => number, durationMs = moveDuration(from, to)): Pt[] {
  const steps = Math.max(2, Math.round(durationMs / 16));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = (random() - 0.5) * 0.12 * dist;
  const ctrl = { x: from.x + dx / 2 - (dy / dist) * bow, y: from.y + dy / 2 + (dx / dist) * bow };
  const pts: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const u = easeInOut(i / steps);
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    pts.push({ x: a * from.x + b * ctrl.x + c * to.x, y: a * from.y + b * ctrl.y + c * to.y });
  }
  return pts;
}

/** A click point inside a box: near the centre, never at the exact pixel centre. */
export function clickPoint(
  box: { x: number; y: number; width: number; height: number },
  random: () => number,
): Pt {
  const jx = (random() - 0.5) * Math.min(box.width * 0.3, 12);
  const jy = (random() - 0.5) * Math.min(box.height * 0.3, 6);
  return { x: box.x + box.width / 2 + jx, y: box.y + box.height / 2 + jy };
}

/** Per-character delays (ms) for typing at roughly `cps` characters per second. */
export function typingDelays(text: string, cps: number, random: () => number): number[] {
  const base = 1000 / cps;
  return [...text].map((ch) => {
    const pause = ch === ' ' ? 1.4 : /[./:_-]/.test(ch) ? 1.25 : 1;
    return Math.round(base * pause * (0.7 + random() * 0.6));
  });
}
