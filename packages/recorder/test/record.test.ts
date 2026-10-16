import { describe, expect, it } from 'vitest';
import { concatList } from '../src/record';

describe('take encoding timeline', () => {
  const frames = [
    { file: '/take/frames/000001.jpg', ts: 99.5 },
    { file: '/take/frames/000002.jpg', ts: 100.2 },
    { file: '/take/frames/000003.jpg', ts: 101.0 },
    { file: '/take/frames/000004.jpg', ts: 103.0 },
  ];

  it('starts at t0 with the latest earlier frame and ends at t1', () => {
    const list = concatList(frames, 100, 102, '/take');
    const durations = [...list.matchAll(/duration ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(list).toContain("file 'frames/000001.jpg'");
    expect(list).not.toContain('000004.jpg');
    expect(durations.map((d) => d.toFixed(1))).toEqual(['0.2', '0.8', '1.0']);
    expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 5);
  });

  it('fails clearly without frames', () => {
    expect(() => concatList([], 0, 1, '/take')).toThrow(/no frames/);
  });
});
