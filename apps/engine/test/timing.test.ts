import { describe, expect, it } from 'vitest';
import { buildTimeMap, parseTimeline, RecorderEvent, voiceSpans } from '@studio/core';
import { fitTiming, MAX_SPEED } from '../src/timing';

const take = {
  id: 'take-1',
  video: 'v.mp4',
  events: 'e.jsonl',
  width: 1000,
  height: 600,
  fps: 30,
  duration: 30,
};
const line = (owner: string, duration: number) => ({
  id: `vo-${owner}`,
  owner,
  text: 'x',
  audio: `audio/${owner}.mp3`,
  start: 0.25,
  duration,
  words: [],
});
const bbox = { x: 0, y: 0, w: 10, h: 10 };
const events = RecorderEvent.array().parse([
  { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
  {
    kind: 'mouse',
    t: 9,
    points: [
      [9, 0, 0],
      [9.7, 5, 5],
    ],
  },
  { kind: 'click', t: 9.8, stepId: 's1', x: 5, y: 5, target: 'a', bbox },
  { kind: 'step-start', t: 10, stepId: 's2', title: 'Two' },
  { kind: 'click', t: 11, stepId: 's2', x: 5, y: 5, target: 'b', bbox },
  { kind: 'step-start', t: 20, stepId: 's3', title: 'Three' },
  { kind: 'click', t: 21, stepId: 's3', x: 5, y: 5, target: 'c', bbox },
]);

function timeline(segments: unknown[] = [{ kind: 'src', from: 0, to: 30 }]) {
  return parseTimeline({
    version: 1,
    takes: [take],
    scenes: [{ id: 'sc-1', kind: 'recording', take: 'take-1', segments }],
    steps: [
      { id: 's1', title: 'One', take: 'take-1', from: 0, to: 10 },
      { id: 's2', title: 'Two', take: 'take-1', from: 10, to: 20 },
      { id: 's3', title: 'Three', take: 'take-1', from: 20, to: 30 },
    ],
    voice: [line('s1', 12), line('s2', 3), line('s3', 4)],
  });
}

describe('fitTiming', () => {
  it('holds steps whose voice is longer, speeds up idle stretches of steps whose action is longer', () => {
    const tl = timeline();
    const before = voiceSpans(tl, buildTimeMap(tl));
    expect(before[0]!.end).toBeGreaterThan(10); // s1's line runs into s2

    const r = fitTiming(tl, events);
    const [s1, s2, s3] = r.steps;
    expect(s1).toMatchObject({ stepId: 's1', speed: 1, overrun: 0 });
    expect(s1!.hold).toBeCloseTo(0.25 + 12 + 0.35 - 10, 1);
    // s2 starts 0.2 s after s1's click, so its line waits until 0.6 s after it.
    expect(r.timeline.voice.find((v) => v.owner === 's2')!.start).toBeCloseTo(0.4, 3);
    expect(s2!.speed).toBe(MAX_SPEED);
    expect(r.timeline.scenes[0]!.kind === 'recording' && r.timeline.scenes[0]!.segments).toContainEqual(
      expect.objectContaining({ kind: 'speed', rate: MAX_SPEED }),
    );
    expect(s3).toMatchObject({ hold: 0, speed: MAX_SPEED, overrun: 0 });

    // No line overlaps the next step's action.
    const tm = buildTimeMap(r.timeline);
    const spans = voiceSpans(r.timeline, tm);
    const stepStart = (id: string) =>
      tm.toOutput('take-1', r.timeline.steps.find((s) => s.id === id)!.from)[0]!;
    expect(spans[0]!.end).toBeLessThanOrEqual(stepStart('s2'));
    expect(spans[1]!.end).toBeLessThanOrEqual(stepStart('s3'));
    // 30 s + s1's freeze - 2.8 s saved in each of s2 and s3 (8.4 s idle at 1.5×).
    expect(r.after).toBeCloseTo(30 + s1!.hold - 2.8 - 2.8, 1);
  });

  it('keeps cuts and replaces earlier fits instead of stacking them', () => {
    const cut = timeline([
      { kind: 'src', from: 0, to: 4 },
      { kind: 'src', from: 6, to: 30 },
    ]);
    const once = fitTiming(cut, events).timeline;
    const twice = fitTiming(once, events).timeline;
    expect(twice.scenes).toEqual(once.scenes);
    const shown = (twice.scenes[0]!.kind === 'recording' ? twice.scenes[0]!.segments : []).filter(
      (s) => s.kind !== 'hold',
    );
    expect(shown.some((s) => 'from' in s && s.from < 6 && s.to > 4)).toBe(false);
    expect(fitTiming(cut, events).steps[0]!.action).toBeCloseTo(8, 3);
  });

  it('leaves steps without a voice line alone', () => {
    const tl = { ...timeline(), voice: [] };
    const r = fitTiming(tl, events);
    expect(r.steps.every((s) => s.hold === 0 && s.speed === 1)).toBe(true);
    expect(r.after).toBe(30);
  });
});
