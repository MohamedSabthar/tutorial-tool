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

import {
  blendCamera,
  cameraAt,
  clampCamera,
  FRAME,
  fitSource,
  project,
  restCamera,
  sourceToStage,
} from '../src/camera';

describe('camera math', () => {
  const stage = { width: 1920, height: 1080 };
  const fit = fitSource({ width: 2268, height: 1472 }, stage);

  it('fits a taller-than-16:9 recording by height inside the frame inset, centred', () => {
    expect(fit.rect.h).toBeCloseTo(1080 - 2 * FRAME.inset);
    expect(fit.rect.y).toBeCloseTo(FRAME.inset);
    expect(fit.rect.w).toBeCloseTo(2268 * ((1080 - 2 * FRAME.inset) / 1472));
    expect(fitSource({ width: 1920, height: 1080 }, stage, 0).rect).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(fit.rect.x).toBeCloseTo((1920 - fit.rect.w) / 2);
    expect(sourceToStage({ x: 0, y: 0, w: 2268, h: 1472 }, fit)).toEqual(fit.rect);
  });

  it('projects the focus point to the stage centre at any zoom', () => {
    const cam = { zoom: 2.5, focusX: 700, focusY: 400 };
    expect(project({ x: 700, y: 400 }, cam, stage)).toEqual({ x: 960, y: 540 });
    expect(project({ x: 710, y: 400 }, cam, stage).x).toBeCloseTo(985);
  });

  it('never shows outside the video when zoomed', () => {
    const c = clampCamera({ zoom: 2, focusX: fit.rect.x, focusY: 0 }, fit.rect, stage);
    expect(c.focusX).toBeCloseTo(fit.rect.x + 480);
    expect(c.focusY).toBeCloseTo(fit.rect.y + 270);
  });

  it('eases into a move, holds with a slow push-in, and eases back', () => {
    const rest = restCamera(stage);
    const moves = [{ start: 2, end: 6, to: { zoom: 2, focusX: 900, focusY: 500 }, ease: 1 }];
    expect(cameraAt(1, moves, rest, fit.rect, stage).zoom).toBe(1);
    // Log-space zoom: halfway is the geometric mean.
    expect(cameraAt(2.5, moves, rest, fit.rect, stage).zoom).toBeCloseTo(Math.SQRT2, 2);
    const hold = cameraAt(4, moves, rest, fit.rect, stage).zoom;
    expect(hold).toBeGreaterThan(2);
    expect(hold).toBeLessThan(2.05);
    expect(cameraAt(6.5, moves, rest, fit.rect, stage).zoom).toBe(1);
  });

  it('zooms about a fixed point, so the target grows in place instead of sliding', () => {
    const rest = restCamera(stage);
    const target = { zoom: 2, focusX: 900, focusY: 500 };
    // The pivot: the stage point at the same screen position in both views.
    const pivot = { x: (900 * 2 - 960) / (2 - 1), y: (500 * 2 - 540) / (2 - 1) };
    const at = (u: number) => project(pivot, blendCamera(rest, target, u, stage), stage);
    expect(at(0.3).x).toBeCloseTo(at(0.8).x, 6);
    expect(at(0.3).y).toBeCloseTo(at(0.8).y, 6);
  });

  it('glides between close moves instead of returning to rest', () => {
    const rest = restCamera(stage);
    const moves = [
      { start: 2, end: 4, to: { zoom: 1.8, focusX: 700, focusY: 400 }, ease: 0.8 },
      { start: 4.8, end: 7, to: { zoom: 1.8, focusX: 1100, focusY: 600 }, ease: 0.8 },
    ];
    for (let t = 3.3; t <= 5.6; t += 0.1)
      expect(cameraAt(t, moves, rest, fit.rect, stage).zoom).toBeGreaterThan(1.5);
    const far = [moves[0]!, { ...moves[1]!, start: 8, end: 10 }];
    expect(cameraAt(6, far, rest, fit.rect, stage).zoom).toBe(1);
  });
});
