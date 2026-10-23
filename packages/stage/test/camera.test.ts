import { describe, expect, it } from 'vitest';
import { cameraAt, restCamera, type CameraMove } from '../src/camera';

const STAGE = { width: 1920, height: 1080 };
// The video sits in a framed margin, smaller than the stage (as fitSource lays it out).
const BOUNDS = { x: 96, y: 54, w: 1728, h: 972 };

/** The largest one-frame change in zoom speed (log/s) and pan speed (screen px/s) at 60 fps. */
function maxJumps(moves: CameraMove[], from: number, to: number) {
  const dt = 1 / 60;
  let prev: { z: number; x: number; y: number; vz: number; vx: number; vy: number } | null = null;
  let dz = 0;
  let dp = 0;
  for (let t = from; t < to; t += dt) {
    const c = cameraAt(t, moves, restCamera(STAGE), BOUNDS, STAGE);
    const z = Math.log(c.zoom);
    if (prev) {
      const vz: number = (z - prev.z) / dt;
      const vx: number = (c.focusX - prev.x) / dt;
      const vy: number = (c.focusY - prev.y) / dt;
      if (prev.vz !== null) {
        dz = Math.max(dz, Math.abs(vz - prev.vz));
        dp = Math.max(dp, Math.hypot(vx - prev.vx, vy - prev.vy) * c.zoom);
      }
      prev = { z, x: c.focusX, y: c.focusY, vz, vx, vy };
    } else prev = { z, x: c.focusX, y: c.focusY, vz: 0, vx: 0, vy: 0 };
  }
  return { dz, dp };
}

describe('camera path', () => {
  it('zooms in, holds and out without a pop or a lurch, even near the edge of the video', () => {
    const near = { focusX: 260, focusY: 980, zoom: 1.55 }; // a control near the bottom-left corner
    const { dz, dp } = maxJumps([{ start: 1, end: 4, to: near }], 0, 5);
    expect(dz).toBeLessThan(0.25);
    expect(dp).toBeLessThan(200);
  });

  it('glides between back-to-back zooms without switching motion in a frame', () => {
    const moves: CameraMove[] = [
      { start: 1, end: 3.4, to: { focusX: 500, focusY: 300, zoom: 1.55 } },
      { start: 3.4, end: 5.6, to: { focusX: 1400, focusY: 700, zoom: 1.55 } },
      { start: 5.6, end: 7.8, to: { focusX: 1300, focusY: 650, zoom: 1.33 } },
    ];
    const { dz, dp } = maxJumps(moves, 0, 9);
    expect(dz).toBeLessThan(0.25);
    expect(dp).toBeLessThan(200);
  });

  it('starts and ends at rest, and holds on the target', () => {
    const to = { focusX: 900, focusY: 500, zoom: 1.5 };
    const moves = [{ start: 1, end: 4, to }];
    expect(cameraAt(0.5, moves, restCamera(STAGE), BOUNDS, STAGE)).toEqual(restCamera(STAGE));
    expect(cameraAt(4.5, moves, restCamera(STAGE), BOUNDS, STAGE)).toEqual(restCamera(STAGE));
    const mid = cameraAt(2.5, moves, restCamera(STAGE), BOUNDS, STAGE);
    expect(mid.zoom).toBeGreaterThan(1.5);
    expect(mid.zoom).toBeLessThan(1.5 * 1.031);
  });
});
