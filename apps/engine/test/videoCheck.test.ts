import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseTimeline, RecorderEvent } from '@studio/core';
import { checkVideo } from '../src/videoCheck';

// A real 64×36 PNG, so the contact sheet (ffmpeg) can be made.
const png = execFileSync('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=gray:s=64x36',
  '-frames:v',
  '1',
  '-f',
  'image2pipe',
  '-vcodec',
  'png',
  '-',
]);

const take = {
  id: 'take-1',
  video: 'v.mp4',
  events: 'e.jsonl',
  width: 64,
  height: 36,
  fps: 30,
  duration: 20,
};
const bbox = { x: 0, y: 0, w: 10, h: 10 };

describe('checkVideo', () => {
  it('finds voice overlaps, unreadable captions, late clicks and leftovers, and renders every step and click', async () => {
    const timeline = parseTimeline({
      version: 1,
      takes: [take],
      scenes: [{ id: 'sc', kind: 'recording', take: 'take-1', segments: [{ kind: 'src', from: 0, to: 20 }] }],
      steps: [
        { id: 's1', title: 'One', take: 'take-1', from: 0, to: 10, narration: 'Open it.' },
        { id: 's2', title: 'Two', take: 'take-1', from: 10, to: 20, narration: 'Then save.' },
      ],
      voice: [
        { id: 'vo-s1', owner: 's1', text: 'Open it.', start: 0.25, duration: 11 },
        { id: 'vo-s2', owner: 's2', text: 'Then save.', start: 0.25, duration: 2 },
      ],
      captions: [
        {
          id: 'c1',
          start: 1,
          end: 1.3,
          text: 'This caption line is far too long to read comfortably on screen',
        },
      ],
    });
    const events = RecorderEvent.array().parse([
      {
        kind: 'click',
        t: 2.4,
        stepId: 's1',
        x: 1,
        y: 1,
        target: 'Create',
        bbox,
        cue: { word: 'Open', at: 2 },
      },
      { kind: 'marker', t: 10, name: 'onscreen', data: { stepId: 's1', items: ['dialog: Save changes?'] } },
      { kind: 'key', t: 12, stepId: 's2', key: 'Enter' },
    ]);
    const rendered: number[] = [];
    const r = await checkVideo({
      slug: 'x',
      timeline,
      events,
      stage: {
        render: async (_slug, times) =>
          (rendered.push(...times), times.map((t) => ({ t, png, errors: {} }))) as never,
      },
    });
    expect(r.issues).toEqual([
      expect.stringMatching(/^s1: its voice runs 1\.25 s into the next step/),
      expect.stringMatching(/^s2: 7\.8 s with no voice after its line \(0:12\.25–0:20\.00\)/),
      's1: "Open" late by 400 ms',
      'left on screen at step end: s1: dialog: Save changes?',
      expect.stringMatching(/^caption at 0:01.00 is too long/),
      expect.stringMatching(/^caption at 0:01.00 is on screen for only 0.30 s/),
    ]);
    expect(r.frames.map((f) => f.label)).toEqual([
      's1 start',
      's1 click Create',
      's1 end',
      's2 start',
      's2 key Enter',
      's2 end',
    ]);
    expect(rendered).toHaveLength(6);
    expect(r.sheets).toHaveLength(1);
  });

  it('flags a long fast-forward after a line, but not the silence it replaced', async () => {
    const timeline = parseTimeline({
      version: 1,
      takes: [{ ...take, duration: 40 }],
      scenes: [
        {
          id: 'sc',
          kind: 'recording',
          take: 'take-1',
          segments: [
            { kind: 'src', from: 0, to: 13 },
            { kind: 'speed', from: 13, to: 40, rate: 2 },
          ],
        },
      ],
      steps: [
        { id: 's1', title: 'One', take: 'take-1', from: 0, to: 10, narration: 'Open it.' },
        { id: 's2', title: 'Two', take: 'take-1', from: 10, to: 40, narration: 'Add the rest.' },
      ],
      voice: [
        { id: 'vo-s1', owner: 's1', text: 'Open it.', start: 0.25, duration: 9 },
        { id: 'vo-s2', owner: 's2', text: 'Add the rest.', start: 0.25, duration: 2 },
      ],
    });
    const r = await checkVideo({
      slug: 'x',
      timeline,
      events: [],
      stage: { render: async (_slug, times) => times.map((t) => ({ t, png, errors: {} })) as never },
    });
    expect(r.issues).toEqual([expect.stringMatching(/^s2: 13\.5 s fast-forwarded after its line/)]);
  });
});
