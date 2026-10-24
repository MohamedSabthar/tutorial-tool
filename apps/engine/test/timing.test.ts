import { describe, expect, it } from 'vitest';
import { buildTimeMap, parseTimeline, RecorderEvent, voiceSpans } from '@studio/core';
import { autoOverlays } from '../src/autoOverlays';
import { fitTiming, GRACE, MAX_SPEED, MAX_WAIT_SPEED, TAIL, WAIT_KEEP } from '../src/timing';

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
  it('holds steps whose voice is longer, fast-forwards product waits after a shorter line', () => {
    const tl = timeline();
    const before = voiceSpans(tl, buildTimeMap(tl));
    expect(before[0]!.end).toBeGreaterThan(10); // s1's line runs into s2

    const r = fitTiming(tl, events);
    const [s1, s2, s3] = r.steps;
    expect(s1).toMatchObject({ stepId: 's1', speed: 1, saved: 0, overrun: 0 });
    expect(s1!.hold).toBeCloseTo(0.25 + 12 + 0.35 - 10, 1);
    // s2 starts 0.2 s after s1's click, so its line waits until 0.6 s after it.
    expect(r.timeline.voice.find((v) => v.owner === 's2')!.start).toBeCloseTo(0.4, 3);
    // s2: the line and a second of grace play as recorded, the wait after it is skipped over.
    const voiced = 0.4 + 3 + 0.35 + GRACE;
    const segs = r.timeline.scenes[0]!.kind === 'recording' ? r.timeline.scenes[0]!.segments : [];
    expect(segs).toContainEqual({ kind: 'speed', from: 10 + voiced, to: 20, rate: expect.any(Number) });
    expect(s2!.saved).toBeCloseTo(10 - voiced - WAIT_KEEP, 1);
    expect(s3).toMatchObject({ hold: 0, overrun: 0 });

    // No line overlaps the next step's action.
    const tm = buildTimeMap(r.timeline);
    const spans = voiceSpans(r.timeline, tm);
    const stepStart = (id: string) =>
      tm.toOutput('take-1', r.timeline.steps.find((s) => s.id === id)!.from)[0]!;
    expect(spans[0]!.end).toBeLessThanOrEqual(stepStart('s2'));
    expect(spans[1]!.end).toBeLessThanOrEqual(stepStart('s3'));
    expect(stepStart('s3') - spans[1]!.end).toBeLessThan(TAIL + GRACE + WAIT_KEEP + 0.1);
  });

  it('saves a fit whose product waits play faster than 4× (the timeline accepts them)', () => {
    // s2's 5 s wait after its line is played down to about WAIT_KEEP: well past 4×.
    const r = fitTiming(timeline(), events);
    const segs = r.timeline.scenes[0]!.kind === 'recording' ? r.timeline.scenes[0]!.segments : [];
    const fastest = Math.max(...segs.map((s) => (s.kind === 'speed' ? s.rate : 1)));
    expect(fastest).toBeGreaterThan(4);
    expect(fastest).toBeLessThanOrEqual(MAX_WAIT_SPEED);
    expect(() => parseTimeline(JSON.parse(JSON.stringify(r.timeline)))).not.toThrow();
  });

  it('fast-forwards unnarrated action after a line at 2–4× and badges it', () => {
    // s3 keeps clicking for 8 s after its 4 s line.
    const busy = RecorderEvent.array().parse(
      Array.from({ length: 17 }, (_, i) => ({
        kind: 'click',
        t: 26 + i * 0.25,
        stepId: 's3',
        x: 5,
        y: 5,
        target: `t${i}`,
        bbox,
      })),
    );
    const all = [...events, ...busy];
    const r = fitTiming(timeline(), all);
    const s3 = r.steps[2]!;
    expect(s3.speed).toBeGreaterThanOrEqual(2);
    expect(s3.speed).toBeLessThanOrEqual(MAX_SPEED);
    const badges = autoOverlays(r.timeline, all).filter((o) => o.component === 'core:FastForward');
    expect(badges.some((b) => (b.props as { rate: number }).rate === s3.speed)).toBe(true);
  });

  it("plays a paced take's voiced part as recorded, so its clicks stay on their words", () => {
    const paced = [{ kind: 'marker' as const, t: 0, name: 'start', data: { paced: true } }, ...events];
    const r = fitTiming(timeline(), paced);
    const segs = r.timeline.scenes[0]!.kind === 'recording' ? r.timeline.scenes[0]!.segments : [];
    const voicedEnd = 10 + 0.4 + 3 + 0.35 + GRACE;
    for (const s of segs) if (s.kind === 'speed') expect(s.from).toBeGreaterThanOrEqual(voicedEnd - 1e-3);
    expect(r.steps[0]!.hold).toBeGreaterThan(0);
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

  it('keeps pieces edited by hand (speed, freeze, cuts) and fits around them', () => {
    // s3 (20–30 s) has its first 4 s at 8× by hand and a hand-made 1.5 s freeze at 25 s.
    const tl = timeline([
      { kind: 'src', from: 0, to: 20 },
      { kind: 'speed', from: 20, to: 24, rate: 8, manual: true },
      { kind: 'src', from: 24, to: 25 },
      { kind: 'hold', at: 25, duration: 1.5, manual: true },
      { kind: 'src', from: 25, to: 30 },
    ]);
    const once = fitTiming(tl, events).timeline;
    const segs = once.scenes[0]!.kind === 'recording' ? once.scenes[0]!.segments : [];
    expect(segs).toContainEqual({ kind: 'speed', from: 20, to: 24, rate: 8, manual: true });
    expect(segs).toContainEqual({ kind: 'hold', at: 25, duration: 1.5, manual: true });
    // The freeze still sits between the pieces either side of 25 s.
    const h = segs.findIndex((s) => s.kind === 'hold' && s.manual);
    expect(segs[h - 1]).toMatchObject({ to: 25 });
    expect(segs[h + 1]).toMatchObject({ from: 25 });
    // Fitting again changes nothing, and the result is a valid timeline.
    expect(fitTiming(once, events).timeline.scenes).toEqual(once.scenes);
    expect(() => parseTimeline(JSON.parse(JSON.stringify(once)))).not.toThrow();
  });

  it('fits a step to its last line when it has hand-placed lines, and keeps their start', () => {
    // s3 (20–30 s): its 4 s line, plus a hand-written 2 s line placed 7 s in.
    const tl = timeline();
    tl.voice.push({ ...line('s3', 2), id: 'vo-hand', start: 7, manual: true });
    const r = fitTiming(tl, events);
    expect(r.timeline.voice.find((v) => v.id === 'vo-hand')!.start).toBe(7);
    // Nothing under the hand-written line is fast-forwarded: s3 needs 7 + 2 + TAIL seconds.
    const s3 = r.steps[2]!;
    expect(s3.needed).toBeCloseTo(7 + 2 + TAIL, 3);
    const segs = r.timeline.scenes[0]!.kind === 'recording' ? r.timeline.scenes[0]!.segments : [];
    for (const sg of segs)
      if (sg.kind === 'speed' && sg.to > 20) expect(sg.from).toBeGreaterThanOrEqual(20 + 9);
  });

  it('leaves steps without a voice line alone', () => {
    const tl = { ...timeline(), voice: [] };
    const r = fitTiming(tl, events);
    expect(r.steps.every((s) => s.hold === 0 && s.speed === 1 && s.saved === 0)).toBe(true);
    expect(r.after).toBe(30);
  });
});
