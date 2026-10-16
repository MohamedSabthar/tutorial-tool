import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPlayer, installVirtualClock, Stage, useStageTime } from '../src/index';

describe('virtual clock', () => {
  it('controls Date, performance.now and timers', () => {
    const clock = installVirtualClock();
    try {
      const fired: number[] = [];
      setTimeout(() => fired.push(performance.now()), 100);
      const iv = setInterval(() => fired.push(performance.now()), 40);
      expect(performance.now()).toBe(0);
      const d0 = Date.now();
      clock.advanceTo(130);
      expect(fired).toEqual([40, 80, 100, 120]);
      expect(Date.now() - d0).toBe(130);
      expect(new Date().getTime()).toBe(Date.now());
      clearInterval(iv);
      clock.advanceTo(500);
      expect(fired).toHaveLength(4);
    } finally {
      clock.restore();
    }
    expect(Date.now()).toBeGreaterThan(1_700_000_000_000);
  });

  it('runs animation-frame callbacks once per advance with the virtual time', () => {
    const g = globalThis as typeof globalThis & {
      requestAnimationFrame?: (cb: (t: number) => void) => number;
    };
    const clock = installVirtualClock();
    try {
      const seen: number[] = [];
      const loop = (t: number) => {
        seen.push(t);
        g.requestAnimationFrame!(loop);
      };
      g.requestAnimationFrame!(loop);
      clock.advanceTo(16);
      clock.advanceTo(33);
      expect(seen).toEqual([16, 33]);
    } finally {
      clock.restore();
    }
  });
});

describe('player', () => {
  function fakeRaf() {
    let wall = 0;
    const queue: ((ms: number) => void)[] = [];
    return {
      deps: { raf: (cb: (ms: number) => void) => queue.push(cb), caf: () => {}, now: () => wall },
      step(ms: number) {
        wall += ms;
        queue.splice(0).forEach((cb) => cb(wall));
      },
    };
  }

  it('plays at the given rate and stops at the end', () => {
    const f = fakeRaf();
    const p = createPlayer(2, f.deps);
    p.play();
    f.step(500);
    expect(p.get().t).toBeCloseTo(0.5);
    p.setRate(2);
    f.step(500);
    expect(p.get().t).toBeCloseTo(1.5);
    f.step(1000);
    expect(p.get()).toMatchObject({ t: 2, playing: false });
  });

  it('seeks, scrubs backwards and loops', () => {
    const f = fakeRaf();
    const p = createPlayer(2, f.deps);
    p.seek(1.5);
    p.seek(0.25);
    expect(p.get().t).toBe(0.25);
    p.seek(99);
    expect(p.get().t).toBe(2);
    p.setLoop(true);
    p.seek(1.8);
    p.play();
    f.step(400);
    expect(p.get().t).toBeCloseTo(0.2);
    expect(p.get().playing).toBe(true);
  });
});

describe('stage determinism', () => {
  function Probe() {
    const { t } = useStageTime();
    // A pure function of t: position and opacity.
    return (
      <div
        style={{ transform: `translateX(${Math.round(Math.sin(t) * 400)}px)`, opacity: (t % 1).toFixed(3) }}
      >
        {t.toFixed(3)}
      </div>
    );
  }
  const render = (t: number) =>
    renderToStaticMarkup(
      <Stage t={t} mode="export">
        <Probe />
      </Stage>,
    );

  it('renders identical markup for the same t, including after scrubbing back', () => {
    const forward = [0, 0.5, 1.25, 3].map(render);
    const backward = [3, 1.25, 0.5, 0].map(render).reverse();
    expect(backward).toEqual(forward);
    expect(new Set(forward).size).toBe(4);
  });
});
