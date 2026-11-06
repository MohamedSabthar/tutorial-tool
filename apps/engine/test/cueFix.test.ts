import { describe, expect, it } from 'vitest';
import { buildTimeMap, parseTimeline, RecorderEvent } from '@studio/core';
import { MAX_CUE_SPEED, planCueFixes } from '../src/cueFix';
import { busyIntervals, fitTiming } from '../src/timing';

const bbox = { x: 0, y: 0, w: 10, h: 10 };
const take = {
  id: 'take-1',
  video: 'v.mp4',
  events: 'e.jsonl',
  width: 1000,
  height: 600,
  fps: 30,
  duration: 20,
};

function timeline() {
  return parseTimeline({
    version: 1,
    takes: [take],
    scenes: [{ id: 'sc-1', kind: 'recording', take: 'take-1', segments: [{ kind: 'src', from: 0, to: 20 }] }],
    steps: [{ id: 's1', title: 'One', take: 'take-1', from: 0, to: 20 }],
    voice: [{ id: 'vo-s1', owner: 's1', text: 'x', audio: 'a.mp3', start: 0.25, duration: 9, words: [] }],
  });
}

const move = (from: number, to: number) => ({
  kind: 'mouse',
  t: from,
  points: [
    [from, 0, 0],
    [to, 5, 5],
  ],
});
const click = (t: number, at: number, word: string) => ({
  kind: 'click',
  t,
  stepId: 's1',
  x: 5,
  y: 5,
  target: word,
  bbox,
  cue: { word, at },
});

// "Run" was planned at 3.5 s but the build kept the script waiting until 6 s; "Open" is on time.
const events = RecorderEvent.array().parse([
  { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
  move(5.5, 5.9),
  click(6, 3.5, 'Run'),
  move(7.5, 7.95),
  click(8, 8, 'Open'),
  { kind: 'step-end', t: 20, stepId: 's1' },
]);

describe('planCueFixes', () => {
  it('speeds up the wait before a late action and freezes before the next to keep it on its word', () => {
    const { ops, cues } = planCueFixes(events, busyIntervals(events));
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ stepId: 's1', word: 'Run', late: 2.5, left: expect.any(Number) });
    expect(cues[0]!.rate).toBeGreaterThan(1);
    expect(cues[0]!.rate).toBeLessThanOrEqual(MAX_CUE_SPEED);
    expect(cues[0]!.left).toBeLessThan(0.05);
    const own = ops.get('s1')!;
    expect(own.filter((o) => o.kind === 'speed').every((o) => o.kind === 'speed' && o.to <= 5.5)).toBe(true);
    expect(own.find((o) => o.kind === 'hold')).toMatchObject({ duration: expect.closeTo(2.5, 1) });
  });

  it('reports an action with no wait before it as staying late', () => {
    const tight = RecorderEvent.array().parse([
      { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
      move(0.2, 1.9),
      click(2, 1, 'Run'),
    ]);
    const { ops, cues } = planCueFixes(tight, busyIntervals(tight));
    expect(cues).toEqual([expect.objectContaining({ word: 'Run', rate: null, left: 1 })]);
    expect(ops.size).toBe(0);
  });

  it('caps the speed-up and says how late the action still is', () => {
    const slow = RecorderEvent.array().parse([
      { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
      move(2.5, 2.9),
      click(3, 0.5, 'Run'),
    ]);
    const [c] = planCueFixes(slow, busyIntervals(slow)).cues;
    expect(c!.rate).toBe(MAX_CUE_SPEED);
    expect(c!.left).toBeGreaterThan(0.5);
  });
});

describe('fitTiming with late actions', () => {
  it('puts every cued action of a paced take on its word', () => {
    const r = fitTiming(timeline(), events);
    const tm = buildTimeMap(r.timeline);
    const out = (t: number) => tm.toOutput('take-1', t)[0]!;
    const start = out(0);
    expect(out(6) - start).toBeCloseTo(3.5, 1);
    expect(out(8) - start).toBeCloseTo(8, 1);
    expect(() => parseTimeline(JSON.parse(JSON.stringify(r.timeline)))).not.toThrow();
  });

  it('leaves a late action as recorded when a cut falls in its wait', () => {
    const tl = timeline();
    const cut = parseTimeline({
      ...tl,
      scenes: [
        {
          id: 'sc-1',
          kind: 'recording',
          take: 'take-1',
          segments: [
            { kind: 'src', from: 0, to: 2 },
            { kind: 'src', from: 2.5, to: 20 },
          ],
        },
      ],
    });
    const r = fitTiming(cut, events);
    const tm = buildTimeMap(r.timeline);
    const segs = r.timeline.scenes[0]!.kind === 'recording' ? r.timeline.scenes[0]!.segments : [];
    // The speed-ups that cross the cut are dropped; the rest of the fit still runs.
    expect(segs.every((s) => s.kind !== 'speed' || s.from >= 2.5 || s.to <= 2)).toBe(true);
    expect(tm.duration).toBeGreaterThan(0);
  });
});
