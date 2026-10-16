import { describe, expect, it } from 'vitest';
import { clickPoint, moveDuration, mousePath, rng, typingDelays } from '../src/human';

describe('human motion', () => {
  it('is deterministic for a seed', () => {
    const a = mousePath({ x: 0, y: 0 }, { x: 400, y: 300 }, rng(1));
    const b = mousePath({ x: 0, y: 0 }, { x: 400, y: 300 }, rng(1));
    expect(a).toEqual(b);
  });

  it('ends exactly on the target and stays near the straight line', () => {
    const path = mousePath({ x: 0, y: 0 }, { x: 400, y: 0 }, rng(3));
    expect(path.at(-1)).toEqual({ x: 400, y: 0 });
    for (const p of path) expect(Math.abs(p.y)).toBeLessThan(400 * 0.07);
  });

  it('takes longer for longer moves, within bounds', () => {
    const short = moveDuration({ x: 0, y: 0 }, { x: 10, y: 0 });
    const long = moveDuration({ x: 0, y: 0 }, { x: 1500, y: 0 });
    expect(short).toBeGreaterThanOrEqual(220);
    expect(long).toBeLessThanOrEqual(750);
    expect(long).toBeGreaterThan(short);
  });

  it('clicks inside the box', () => {
    const r = rng(9);
    for (let i = 0; i < 50; i++) {
      const p = clickPoint({ x: 100, y: 50, width: 80, height: 20 }, r);
      expect(p.x).toBeGreaterThan(100);
      expect(p.x).toBeLessThan(180);
      expect(p.y).toBeGreaterThan(50);
      expect(p.y).toBeLessThan(70);
    }
  });

  it('types at roughly the requested speed', () => {
    const delays = typingDelays('a'.repeat(200), 10, rng(2));
    const avg = delays.reduce((s, d) => s + d, 0) / delays.length;
    expect(avg).toBeGreaterThan(80);
    expect(avg).toBeLessThan(120);
  });
});
