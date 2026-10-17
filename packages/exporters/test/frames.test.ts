import { describe, expect, it } from 'vitest';
import { renderFrames, type RenderHost } from '../src/node';

/** A host that returns the requested time as the "PNG", with errors at chosen times. */
function fakeHost(errorsAt: Record<number, Record<string, string>> = {}) {
  const asked: number[] = [];
  const host = {
    frame: async (_slug: string, t: number) => {
      asked.push(t);
      return { t, png: Buffer.from(String(t)), errors: errorsAt[t] ?? {} };
    },
  } as unknown as RenderHost;
  return { host, asked };
}

describe('renderFrames', () => {
  it('renders frames from–to in order at i / fps', async () => {
    const { host, asked } = fakeHost();
    const got: [number, string][] = [];
    await renderFrames(
      host,
      'p',
      { from: 3, to: 6, fps: 30 },
      (i, png) => void got.push([i, png.toString()]),
    );
    expect(asked).toEqual([0.1, 0.133333, 0.166667, 0.2]);
    expect(got.map(([i]) => i)).toEqual([3, 4, 5, 6]);
  });

  it('stops at the first frame with an error', async () => {
    const { host } = fakeHost({ 0.2: { recording: 'decode failed' } });
    const got: number[] = [];
    await expect(
      renderFrames(host, 'p', { from: 0, to: 10, fps: 10 }, (i) => void got.push(i)),
    ).rejects.toThrow('frame 2 (0.200 s): recording: decode failed');
    expect(got).toEqual([0, 1]);
  });
});
