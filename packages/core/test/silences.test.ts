import { describe, expect, it } from 'vitest';
import { findSilences, parseTimeline, RecorderEvent } from '../src';

const bbox = { x: 0, y: 0, w: 10, h: 10 };
const click = (t: number, target: string) => ({ kind: 'click', t, stepId: 's1', x: 1, y: 1, target, bbox });
const events = RecorderEvent.array().parse([
  click(1, 'button "Add"'),
  click(2, 'textbox "Name"'),
  // 10–20 s: the same three controls again, with no voice.
  click(11, 'button "Add"'),
  click(12, 'textbox "Name"'),
  { kind: 'type', t: 13, stepId: 's2', text: 'sum', target: 'textbox "Name"', bbox },
]);
const line = (owner: string, start: number, duration: number) => ({
  id: `vo-${owner}-${Math.round(start * 10)}`,
  owner,
  text: 'x',
  start,
  duration,
  words: [],
});
const tl = parseTimeline({
  version: 1,
  takes: [
    { id: 'take-1', video: 'v.mp4', events: 'e.jsonl', width: 100, height: 100, fps: 30, duration: 30 },
  ],
  scenes: [
    {
      id: 'sc-1',
      kind: 'recording',
      take: 'take-1',
      segments: [
        { kind: 'src', from: 0, to: 20 },
        { kind: 'speed', from: 20, to: 28, rate: 4, manual: true },
      ],
    },
  ],
  steps: [
    { id: 's1', title: 'Add a tool', take: 'take-1', from: 0, to: 10 },
    { id: 's2', title: 'Add the rest', take: 'take-1', from: 10, to: 28 },
  ],
  // s1 is voiced 0–9 s; s2 only at its very end.
  voice: [line('s1', 0, 9), line('s2', 10.5, 1)],
});

describe('findSilences', () => {
  it('lists unvoiced stretches with what plays there', () => {
    const s = findSilences(tl, events);
    // 9–20.5 s has no voice; the 0.5 s after s2's line at the end is too short to report.
    expect(s.map((x) => [x.start, x.end])).toEqual([[9, 20.5]]);
    expect(s[0]).toMatchObject({
      owner: { id: 's1', title: 'Add a tool' },
      rate: 4,
      manual: true,
      idle: false,
      repeats: true,
    });
    expect(s[0]!.actions.map((a) => a.what)).toEqual([
      'click button "Add"',
      'click textbox "Name"',
      'type "sum" into textbox "Name"',
    ]);
  });

  it('reports nothing shorter than the minimum', () => {
    expect(findSilences(tl, events, { min: 60 })).toEqual([]);
  });
});
