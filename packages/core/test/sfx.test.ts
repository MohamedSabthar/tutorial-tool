import { describe, expect, it } from 'vitest';
import { parseTimeline, RecorderEvent, renderSfxTrack, sfxCues, synthSfx, wavBytes } from '../src/index';

const take = { id: 'take-1', video: 'v.mp4', events: 'e.jsonl', width: 100, height: 60, fps: 30, duration: 20 };
const bbox = { x: 0, y: 0, w: 1, h: 1 };
const events = RecorderEvent.array().parse([
  { kind: 'click', t: 1, stepId: 's1', x: 0, y: 0, target: 'Create', bbox },
  { kind: 'type', t: 2, stepId: 's1', text: 'ab c', target: 'Name', bbox },
  { kind: 'key', t: 3, stepId: 's1', key: 'Enter' },
  { kind: 'click', t: 6, stepId: 's1', x: 0, y: 0, target: 'Cut', bbox },
  { kind: 'type', t: 12, stepId: 's1', text: 'fast', target: 'Name', bbox },
  { kind: 'click', t: 13, stepId: 's1', x: 0, y: 0, target: 'Run', bbox },
]);
const timeline = (segments: unknown[]) =>
  parseTimeline({
    version: 1,
    takes: [take],
    scenes: [{ id: 'sc', kind: 'recording', take: 'take-1', segments }],
  });

describe('click and typing sounds', () => {
  it('places a sound for each click, key and typed character, in output time', () => {
    // 5–7 s is cut out; 10–20 s plays at 4×.
    const tl = timeline([
      { kind: 'src', from: 0, to: 5 },
      { kind: 'src', from: 7, to: 10 },
      { kind: 'speed', from: 10, to: 20, rate: 4 },
    ]);
    const cues = sfxCues(tl, { 'take-1': events });
    expect(cues.map((c) => [c.kind, c.t])).toEqual([
      ['click', 1],
      ['key', 2],
      ['key', 2.071],
      ['key', 2.143],
      ['key', 2.243],
      ['key', 3],
      // The cut click makes no sound, the fast-forwarded typing is left out, the click stays.
      ['click', 8 + 3 / 4],
    ]);
    expect(new Set(cues.map((c) => c.variant)).size).toBeGreaterThan(1);
    expect(tl.sfx).toEqual({ enabled: true, volume: 0.5 });
  });

  it('makes short, deterministic sounds and lays them on one track', () => {
    const click = synthSfx('click', 0, 48_000);
    const key = synthSfx('key', 1, 48_000);
    expect(click.length).toBe(0.12 * 48_000);
    expect(Array.from(click)).toEqual(Array.from(synthSfx('click', 0, 48_000)));
    expect(Array.from(click)).not.toEqual(Array.from(synthSfx('click', 1, 48_000)));
    const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak(click)).toBeGreaterThan(0.2);
    expect(peak(click)).toBeLessThan(1);
    expect(peak(key)).toBeLessThan(peak(click));

    const track = renderSfxTrack([{ t: 1, kind: 'click', variant: 0 }], 2, 48_000, 0.5);
    expect(track.length).toBe(96_000);
    expect(peak(track.subarray(0, 48_000))).toBe(0);
    expect(peak(track.subarray(48_000))).toBeCloseTo(peak(click) * 0.5, 5);

    const wav = wavBytes(track, 48_000);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + 96_000 * 2);
  });
});
