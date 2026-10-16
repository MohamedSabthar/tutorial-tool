import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  buildTimeMap,
  invertPatch,
  parseTimeline,
  PatchError,
  RecorderEvent,
  sampleTimeline,
  TimelineError,
  type TimelinePatch,
} from '../src/index';

describe('schemas', () => {
  it('fills defaults for an empty timeline', () => {
    const tl = parseTimeline({ version: 1 });
    expect(tl.size).toEqual({ w: 1920, h: 1080 });
    expect(tl.overlays).toEqual([]);
  });

  it('rejects unknown takes, bad component refs and non-adjacent transitions', () => {
    const base = sampleTimeline();
    expect(() => parseTimeline({ ...base, scenes: [{ ...base.scenes[0], take: 'nope' }] })).toThrow(
      /unknown take "nope"/,
    );
    expect(() => parseTimeline({ ...base, overlays: [{ ...base.overlays[0], component: 'Zoom' }] })).toThrow(
      /component refs look like/,
    );
    expect(() =>
      parseTimeline({
        ...base,
        transitions: [{ id: 't', between: ['sc-1', 'sc-3'], component: 'core:Crossfade', duration: 1 }],
      }),
    ).toThrow(/adjacent scenes/);
  });

  it('parses recorder events', () => {
    const e = RecorderEvent.parse({
      kind: 'click',
      t: 1.2,
      stepId: 's1',
      x: 10,
      y: 20,
      target: 'button',
      bbox: { x: 0, y: 0, w: 5, h: 5 },
    });
    expect(e.kind).toBe('click');
  });
});

describe('patches', () => {
  const cases: [string, TimelinePatch][] = [
    ['replace a field', [{ op: 'replace', path: '/overlays/0/end', value: 4 }]],
    [
      'add to an array',
      [{ op: 'add', path: '/overlays/-', value: { id: 'ov-3', component: 'core:Box', start: 1, end: 2 } }],
    ],
    [
      'insert mid-array',
      [{ op: 'add', path: '/overlays/0', value: { id: 'ov-0', component: 'core:Box', start: 1, end: 2 } }],
    ],
    ['remove', [{ op: 'remove', path: '/overlays/1' }]],
    ['add an object key', [{ op: 'add', path: '/overlays/0/rect', value: { x: 1, y: 2, w: 3, h: 4 } }]],
    ['overwrite an object key with add', [{ op: 'add', path: '/overlays/0/props', value: { text: 'New' } }]],
    ['move within an array', [{ op: 'move', from: '/overlays/1', path: '/overlays/0' }]],
    [
      'five-op drag',
      [
        { op: 'replace', path: '/overlays/0/start', value: 0.5 },
        { op: 'replace', path: '/overlays/0/end', value: 3.5 },
        { op: 'replace', path: '/overlays/0/start', value: 1 },
        { op: 'replace', path: '/overlays/0/end', value: 4 },
        { op: 'test', path: '/overlays/0/end', value: 4 },
      ],
    ],
  ];

  for (const [name, patch] of cases) {
    it(`round-trips: ${name}`, () => {
      const before = sampleTimeline();
      const after = applyPatch(before, patch);
      expect(after).not.toEqual(before);
      const undo = invertPatch(before, patch);
      expect(applyPatch(after, undo)).toEqual(before);
    });
  }

  it('never mutates its input', () => {
    const before = sampleTimeline();
    const snapshot = structuredClone(before);
    applyPatch(before, [{ op: 'replace', path: '/overlays/0/end', value: 9 }]);
    expect(before).toEqual(snapshot);
  });

  it('rejects bad paths with the op index', () => {
    expect(() =>
      applyPatch(sampleTimeline(), [{ op: 'replace', path: '/overlays/9/end', value: 1 }]),
    ).toThrow(PatchError);
    expect(() =>
      applyPatch(sampleTimeline(), [{ op: 'replace', path: '/overlays/9/end', value: 1 }]),
    ).toThrow(/op 0/);
  });

  it('rejects patches that make the timeline invalid, with a readable reason', () => {
    const run = () => applyPatch(sampleTimeline(), [{ op: 'replace', path: '/overlays/0/end', value: -1 }]);
    expect(run).toThrow(TimelineError);
    expect(run).toThrow(/overlays\.0\.end/);
  });

  it('fails a test op', () => {
    expect(() => applyPatch(sampleTimeline(), [{ op: 'test', path: '/overlays/0/end', value: 99 }])).toThrow(
      /test failed/,
    );
  });
});

describe('time map', () => {
  const tm = buildTimeMap(sampleTimeline());

  it('lays out scenes with transition overlaps', () => {
    expect(tm.scenes.map((s) => [s.sceneId, s.start, s.end])).toEqual([
      ['sc-1', 0, 32],
      ['sc-2', 31, 41],
      ['sc-3', 40, 60],
    ]);
    expect(tm.duration).toBe(60);
  });

  it('maps plain source time', () => {
    expect(tm.toSource(5)).toMatchObject({ sceneId: 'sc-1', kind: 'recording', takeTime: 5, segment: 0 });
  });

  it('freezes during a hold', () => {
    expect(tm.toSource(20.5)).toMatchObject({ takeTime: 20, segment: 1 });
    expect(tm.toSource(21.9)).toMatchObject({ takeTime: 20, segment: 1 });
    expect(tm.toSource(23)).toMatchObject({ takeTime: 21, segment: 2 });
  });

  it('shows two scenes during a transition, weighted', () => {
    const active = tm.activeAt(31.5);
    expect(active.map((a) => a.position.sceneId)).toEqual(['sc-1', 'sc-2']);
    expect(active[1]!.weight).toBeCloseTo(0.5);
    expect(active[0]!.transitionId).toBe('tr-1');
    expect(tm.toSource(31.5)).toMatchObject({ sceneId: 'sc-2', kind: 'explainer', local: 0.5 });
  });

  it('maps an explainer inserted between recording segments', () => {
    expect(tm.toSource(36)).toEqual({ sceneId: 'sc-2', kind: 'explainer', local: 5 });
  });

  it('applies speed segments', () => {
    // sc-3 starts at 40: src 30..40 is 10 s, then 40..60 at 2x takes 10 s.
    expect(tm.toSource(55)).toMatchObject({ sceneId: 'sc-3', takeTime: 50, segment: 1 });
  });

  it('maps take time back to output time', () => {
    expect(tm.toOutput('take-1', 5)).toEqual([5]);
    expect(tm.toOutput('take-1', 25)).toEqual([27]);
    expect(tm.toOutput('take-1', 50)).toEqual([55]);
  });

  it('uses voice-over length for auto explainers', () => {
    const tl = sampleTimeline();
    const sc = tl.scenes[1]!;
    if (sc.kind !== 'explainer') throw new Error('expected explainer');
    sc.duration = 'auto';
    expect(buildTimeMap(tl).scenes[1]!.end - buildTimeMap(tl).scenes[1]!.start).toBe(5);
    tl.voice.push({ id: 'v1', owner: 'sc-2', text: 'x', start: 0, duration: 12, words: [] });
    expect(buildTimeMap(tl).scenes[1]!.end - buildTimeMap(tl).scenes[1]!.start).toBe(12);
  });
});
