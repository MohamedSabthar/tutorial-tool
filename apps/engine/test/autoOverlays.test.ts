import { describe, expect, it } from 'vitest';
import { parseTimeline, RecorderEvent } from '@studio/core';
import { fitSource, sourceToStage, STAGE_SIZE } from '@studio/stage';
import { autoOverlays, withAutoOverlays, zoomFor } from '../src/autoOverlays';
import { claimAutoOverlays } from '../src/timeline';

const take = {
  id: 'take-1',
  video: 'v.mp4',
  events: 'e.jsonl',
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 30,
};
const box = (x: number) => ({ x, y: 100, w: 120, h: 30 });
const events = RecorderEvent.array().parse([
  { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
  {
    kind: 'mouse',
    t: 1,
    points: [
      [1, 0, 0],
      [1.5, 100, 100],
    ],
  },
  { kind: 'click', t: 2, stepId: 's1', x: 50, y: 110, target: 'a', bbox: box(0) },
  { kind: 'click', t: 3.5, stepId: 's1', x: 190, y: 110, target: 'b', bbox: box(140) },
  { kind: 'mask', t: 4, label: 'path', bbox: { x: 600, y: 0, w: 300, h: 20 } },
  { kind: 'step-start', t: 10, stepId: 's2', title: 'Two' },
  { kind: 'type', t: 12, stepId: 's2', text: '/greeting', target: 'path', bbox: box(800) },
  { kind: 'click', t: 20, stepId: 's2', x: 1000, y: 110, target: 'c', bbox: box(1000) },
]);
const tl = (segments: unknown[] = [{ kind: 'src', from: 0, to: 30 }], overlays: unknown[] = []) =>
  parseTimeline({
    version: 1,
    takes: [take],
    scenes: [{ id: 'sc-1', kind: 'recording', take: 'take-1', segments }],
    steps: [
      { id: 's1', title: 'One', take: 'take-1', from: 0, to: 10 },
      { id: 's2', title: 'Two', take: 'take-1', from: 10, to: 30 },
    ],
    overlays,
  });

describe('autoOverlays', () => {
  it('adds the pointer, one zoom per cluster of actions, blurs and a title card', () => {
    const list = autoOverlays(tl(), events, { title: 'HTTP service' });
    expect(list.every((o) => o.author === 'auto' && o.id.startsWith('auto-'))).toBe(true);
    expect(list.map((o) => o.component)).toEqual([
      'core:Cursor',
      'core:ClickRipple',
      'core:Zoom',
      'core:Zoom',
      'core:Zoom',
      'core:Blur',
    ]);
    const zooms = list.filter((o) => o.component === 'core:Zoom');
    // Clicks at 2 and 3.5 s share a zoom framing both targets.
    const r = sourceToStage({ x: 0, y: 100, w: 260, h: 30 }, fitSource(take, STAGE_SIZE));
    expect(zooms[0]).toMatchObject({ start: 1, end: 4.7 });
    expect(zooms[0]!.rect!.x).toBeCloseTo(r.x, 2);
    expect(zooms[0]!.rect!.w).toBeCloseTo(r.w, 2);
    // Typing keeps the zoom for the typing time.
    expect(zooms[1]!.end).toBeCloseTo(12 + 9 / 14 + 1.2, 2);
    expect(list.find((o) => o.component === 'core:Blur')).toMatchObject({ start: 4, end: 30 });
    // The first click (2 s) leaves no room for a title card that would cover it.
    expect(list.some((o) => o.component === 'core:TitleCard')).toBe(false);
    const later = events.map((e) => ('stepId' in e && e.kind !== 'step-start' ? { ...e, t: e.t + 4 } : e));
    const title = autoOverlays(tl(), later, { title: 'HTTP service' }).find(
      (o) => o.component === 'core:TitleCard',
    )!;
    expect(title).toMatchObject({ start: 0.2, end: 3.2, props: { title: 'HTTP service' } });
  });

  it('follows the timeline timing and skips actions that were cut', () => {
    const cut = tl([
      { kind: 'src', from: 0, to: 5 },
      { kind: 'hold', at: 4.9, duration: 2 },
      { kind: 'src', from: 15, to: 30 },
    ]);
    const zooms = autoOverlays(cut, events).filter((o) => o.component === 'core:Zoom');
    expect(zooms).toHaveLength(2); // typing at 12 s was cut
    expect(zooms[1]!.start).toBeCloseTo(20 - 15 + 7 - 1, 3);
  });

  it('adds a "skipped" badge where the recording jumps after a cut, not for tiny cuts', () => {
    // Take 5–15 s is cut; a 2 s freeze sits before the jump, so it shows at output 7 s.
    const cut = tl([
      { kind: 'src', from: 0, to: 5 },
      { kind: 'hold', at: 4.9, duration: 2 },
      { kind: 'src', from: 15, to: 29.5 },
      { kind: 'src', from: 29.9, to: 30 },
    ]);
    const skips = autoOverlays(cut, events).filter((o) => o.component === 'core:Skip');
    expect(skips).toHaveLength(1); // the 0.4 s cut near the end gets none
    expect(skips[0]).toMatchObject({ start: 7, end: 8.6, props: { seconds: 10 } });
  });

  it('replaces only automatic overlays and keeps ones the user edited', () => {
    const first = withAutoOverlays(
      tl([{ kind: 'src', from: 0, to: 30 }], [{ id: 'mine', component: 'core:Callout', start: 1, end: 2 }]),
      events,
    );
    const zoom = first.overlays.findIndex((o) => o.id === 'auto-zoom-1');
    const claimed = claimAutoOverlays(first, [
      { op: 'replace', path: `/overlays/${zoom}/props/zoom`, value: 1.4 },
    ]);
    expect(claimed.at(-1)).toEqual({ op: 'replace', path: `/overlays/${zoom}/author`, value: 'user' });
    const edited = {
      ...first,
      overlays: first.overlays.map((o, i) =>
        i === zoom ? { ...o, author: 'user' as const, props: { zoom: 1.4 } } : o,
      ),
    };
    const again = withAutoOverlays(edited, events);
    expect(again.overlays.filter((o) => o.id === 'auto-zoom-1')).toEqual([
      expect.objectContaining({ author: 'user', props: { zoom: 1.4 } }),
    ]);
    expect(again.overlays.some((o) => o.id === 'mine')).toBe(true);
    expect(again.overlays.length).toBe(first.overlays.length);
    // Adding or removing overlays doesn't claim anything (indexes may shift).
    expect(claimAutoOverlays(first, [{ op: 'remove', path: '/overlays/0' }])).toHaveLength(1);
  });

  it('gives far-apart targets their own shots that meet, so the camera glides between them', () => {
    const far = RecorderEvent.array().parse([
      { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
      { kind: 'click', t: 2, stepId: 's1', x: 50, y: 110, target: 'a', bbox: box(0) },
      { kind: 'click', t: 3.5, stepId: 's1', x: 1500, y: 110, target: 'b', bbox: box(1450) },
    ]);
    const zooms = autoOverlays(tl(), far).filter((o) => o.component === 'core:Zoom');
    expect(zooms).toHaveLength(2);
    expect(zooms[0]!.end).toBeCloseTo(zooms[1]!.start, 3);
  });

  it('sizes zooms to the target', () => {
    expect(zoomFor({ x: 0, y: 0, w: 2000, h: 900 })).toBe(1.25);
    expect(zoomFor({ x: 0, y: 0, w: 60, h: 20 })).toBe(1.55);
  });
});
