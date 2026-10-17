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
    // Not voiced yet: as long as the two narration lines take to read (8 + 4 words), plus a tail.
    expect(buildTimeMap(tl).scenes[1]!.end - buildTimeMap(tl).scenes[1]!.start).toBeCloseTo(6.3, 6);
    tl.voice.push({ id: 'v1', owner: 'sc-2', text: 'x', start: 0, duration: 12, words: [] });
    expect(buildTimeMap(tl).scenes[1]!.end - buildTimeMap(tl).scenes[1]!.start).toBeCloseTo(12.8, 6);
    sc.narration = [];
    tl.voice = [];
    expect(buildTimeMap(tl).scenes[1]!.end - buildTimeMap(tl).scenes[1]!.start).toBe(5);
  });
});

import { deriveFromTake, withTake } from '../src/index';

describe('derive from take', () => {
  const take = {
    id: 'take-1',
    video: 'v.mp4',
    events: 'e.jsonl',
    width: 2268,
    height: 1472,
    fps: 30,
    duration: 20,
  };
  const events = RecorderEvent.array().parse([
    { kind: 'marker', t: 0, name: 'start' },
    { kind: 'step-start', t: 1, stepId: 's1', title: 'One' },
    { kind: 'click', t: 2, stepId: 's1', x: 1, y: 2, target: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
    { kind: 'step-end', t: 4, stepId: 's1' },
    { kind: 'step-start', t: 4, stepId: 's2', title: 'Two' },
    { kind: 'step-end', t: 9, stepId: 's2' },
  ]);

  it('makes one recording scene and steps with primary boxes', () => {
    const { scenes, steps } = deriveFromTake(take, events);
    expect(scenes).toHaveLength(1);
    expect(steps.map((s) => [s.id, s.from, s.to, !!s.bbox])).toEqual([
      ['s1', 1, 4, true],
      ['s2', 4, 9, false],
    ]);
  });

  it('keeps overlays and drops anchors to missing steps', () => {
    const tl = parseTimeline({
      version: 1,
      steps: [{ id: 'old', title: 'x', take: 'take-1', from: 0, to: 1 }],
      overlays: [{ id: 'o', component: 'core:Box', start: 0, end: 1, anchor: { stepId: 'old' } }],
    });
    const next = parseTimeline(withTake(tl, take, events));
    expect(next.overlays[0]!.anchor).toBeUndefined();
    expect(next.takes.map((t) => t.id)).toEqual(['take-1']);
  });

  it('adds the pointer overlays once per take, keeping other overlays', () => {
    const first = parseTimeline(withTake(parseTimeline({ version: 1 }), take, events));
    const auto = first.overlays.filter((o) => o.author === 'auto').map((o) => [o.component, o.start, o.end]);
    expect(auto).toEqual([
      ['core:Cursor', 0, 20],
      ['core:ClickRipple', 0, 20],
    ]);
    const second = parseTimeline(withTake(first, { ...take, id: 'take-2', duration: 30 }, events));
    expect(second.overlays.filter((o) => o.component === 'core:Cursor').map((o) => o.end)).toEqual([30]);
    const noMouse = events.filter((e) => e.kind !== 'click');
    expect(withTake(parseTimeline({ version: 1 }), take, noMouse).overlays).toEqual([]);
  });
});

import { CAPTION_RULES, cuesFromVoice, mergeCaptions, wrapCaption } from '../src/index';

describe('captions', () => {
  const words = (text: string, start = 0, perWord = 0.4) =>
    text
      .split(' ')
      .map((w, i) => ({ w, start: start + i * perWord, end: start + i * perWord + perWord - 0.05 }));
  const line = (id: string, text: string, perWord = 0.4) => ({
    id,
    owner: 's1',
    text,
    start: 0,
    duration: text.split(' ').length * perWord,
    words: words(text, 0, perWord),
  });

  it('wraps into at most two balanced 42-character lines', () => {
    expect(wrapCaption('Short line.')).toBe('Short line.');
    expect(wrapCaption('Set the base path to /greeting so clients reach your service')).toBe(
      'Set the base path to /greeting\nso clients reach your service',
    );
    expect(wrapCaption('x'.repeat(90))).toBeNull();
  });

  it('packs words into cues within the limits, ending cues at sentence ends', () => {
    const text =
      'Open the integration overview. From here you add every artifact your integration needs, starting with an HTTP service that listens on port 9090.';
    const cues = cuesFromVoice([{ line: line('vo-s1', text), start: 10 }]);
    expect(cues[0]!.text).toBe('Open the integration overview.');
    expect(cues[0]!.start).toBe(10);
    for (const c of cues) {
      const lines = c.text.split('\n');
      expect(lines.length).toBeLessThanOrEqual(CAPTION_RULES.maxLines);
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(42);
      expect(c.end - c.start).toBeLessThanOrEqual(6.001);
      expect(c.end - c.start).toBeGreaterThanOrEqual(0.999);
    }
    expect(cues.map((c) => c.text.replace('\n', ' ')).join(' ')).toBe(text);
  });

  it('keeps hand-edited cues and drops generated cues that overlap them', () => {
    const gen = [
      { id: 'cap-1', start: 0, end: 2, text: 'a' },
      { id: 'cap-2', start: 2, end: 4, text: 'b' },
    ];
    const merged = mergeCaptions(gen, [{ id: 'cap-2', start: 2.5, end: 3.5, text: 'B!', edited: true }]);
    expect(merged.map((c) => [c.id, c.text])).toEqual([
      ['cap-1', 'a'],
      ['cap-2', 'B!'],
    ]);
  });
});

import {
  insertExplainerScene,
  removeExplainerScene,
  buildTimeMap as tmFor,
  voiceSpans as spansFor,
} from '../src/index';

describe('explainer scenes in the timeline', () => {
  const base = () =>
    parseTimeline({
      version: 1,
      takes: [
        { id: 'take-1', video: 'v.mp4', events: 'e.jsonl', width: 1000, height: 600, fps: 30, duration: 30 },
      ],
      scenes: [
        { id: 'sc-1', kind: 'recording', take: 'take-1', segments: [{ kind: 'src', from: 0, to: 30 }] },
      ],
      steps: [
        { id: 's1', title: 'One', take: 'take-1', from: 0, to: 9 },
        { id: 's2', title: 'Two', take: 'take-1', from: 9, to: 30 },
      ],
      overlays: [
        { id: 'early', component: 'core:Callout', start: 2, end: 4 },
        { id: 'late', component: 'core:Callout', start: 12, end: 14 },
      ],
      captions: [{ id: 'cap-1', start: 15, end: 17, text: 'Later' }],
      voice: [{ id: 'vo-s2', owner: 's2', text: 'x', start: 0.25, duration: 2, words: [] }],
      annotations: [
        { id: 'an-1', t: 20, shape: { kind: 'point', x: 1, y: 1 }, comment: 'c', status: 'open' },
      ],
    });
  const explainer = {
    kind: 'explainer' as const,
    component: 'project:Hello',
    props: {},
    narration: [],
    beats: [],
    duration: 5,
    estimatedDuration: 5,
  };

  it('splits the recording at the insert point and moves later items with their content', () => {
    const { timeline: tl, sceneId } = insertExplainerScene(base(), 9, explainer);
    expect(tl.scenes.map((s) => [s.id, s.kind])).toEqual([
      ['sc-1', 'recording'],
      [sceneId, 'explainer'],
      ['sc-3', 'recording'],
    ]);
    const tm = tmFor(tl);
    expect(tm.duration).toBe(35);
    expect(tm.activeAt(10)[0]!.position).toMatchObject({ kind: 'explainer', sceneId });
    expect(tm.toOutput('take-1', 9)).toEqual([14]);
    expect(tl.overlays.map((o) => [o.id, o.start, o.end])).toEqual([
      ['early', 2, 4],
      ['late', 17, 19],
    ]);
    expect(tl.captions[0]).toMatchObject({ start: 20, end: 22 });
    expect(tl.annotations[0]!.t).toBe(25);
    expect(spansFor(tl, tm)[0]!.start).toBe(14.25);
  });

  it('removing the scene restores the timeline exactly', () => {
    const before = base();
    const { timeline, sceneId } = insertExplainerScene(before, 9, explainer);
    expect(removeExplainerScene(timeline, sceneId)).toEqual(before);
  });

  it('inserts between scenes without splitting at a boundary', () => {
    const { timeline: tl } = insertExplainerScene(base(), 30, explainer);
    expect(tl.scenes.map((s) => s.kind)).toEqual(['recording', 'explainer']);
  });
});

import { outputRemapper, remapOutputItems, resolveBeats } from '../src/index';

describe('explainer beats', () => {
  const scene = (narration: string[], beats: { id: string; at: string | number }[] = []) =>
    ({
      id: 'sc-x',
      kind: 'explainer',
      component: 'project:RequestFlow',
      props: {},
      narration,
      beats,
      duration: 'auto',
      estimatedDuration: 6,
    }) as never;

  it('places default beats on narration lines and re-times them when a line changes', () => {
    const lines = ['A client sends a request.', 'The listener receives it.', 'The resource answers.'];
    const a = resolveBeats(scene(lines), [], ['client', 'listener', 'resource']);
    expect(a.order).toEqual(['client', 'listener', 'resource']);
    expect(a.beats.client).toBe(0.4);
    const longer = resolveBeats(
      scene(['A client somewhere on the network sends a request.', ...lines.slice(1)]),
      [],
      ['client', 'listener', 'resource'],
    );
    expect(longer.beats.client).toBe(0.4);
    expect(longer.beats.listener! - a.beats.listener!).toBeCloseTo(4 / 2.5, 6); // four more words
    expect(longer.beats.resource! - a.beats.resource!).toBeCloseTo(4 / 2.5, 6);
  });

  it('resolves word cues and uses the voice-over when there is one', () => {
    const sc = scene(
      ['A client sends a request.', 'The listener matches /greeting.'],
      [
        { id: 'match', at: 'word:matches' },
        { id: 'fixed', at: 7 },
      ],
    );
    const voice = [
      { id: 'v0', owner: 'sc-x', text: 'A client sends a request.', start: 0.4, duration: 2, words: [] },
      {
        id: 'v1',
        owner: 'sc-x',
        text: 'The listener matches /greeting.',
        start: 2.7,
        duration: 2,
        words: [
          { w: 'The', start: 0, end: 0.2 },
          { w: 'listener', start: 0.25, end: 0.8 },
          { w: 'matches', start: 0.9, end: 1.3 },
          { w: '/greeting.', start: 1.35, end: 2 },
        ],
      },
    ];
    const t = resolveBeats(sc, voice);
    expect(t.beats).toEqual({ match: 3.6, fixed: 7 });
    expect(t.lines.map((l) => l.start)).toEqual([0.4, 2.7]);
  });
});

describe('output remapping', () => {
  it('keeps items on their content when an explainer gets longer', () => {
    const before = parseTimeline({
      version: 1,
      takes: [
        { id: 'take-1', video: 'v.mp4', events: 'e.jsonl', width: 1000, height: 600, fps: 30, duration: 30 },
      ],
      scenes: [
        { id: 'sc-1', kind: 'recording', take: 'take-1', segments: [{ kind: 'src', from: 0, to: 10 }] },
        { id: 'sc-2', kind: 'explainer', component: 'project:X', duration: 5 },
        { id: 'sc-3', kind: 'recording', take: 'take-1', segments: [{ kind: 'src', from: 10, to: 30 }] },
      ],
      overlays: [
        { id: 'a', component: 'core:Callout', start: 2, end: 4 },
        { id: 'in', component: 'core:Callout', start: 11, end: 12 },
        { id: 'b', component: 'core:Callout', start: 20, end: 22 },
      ],
      annotations: [{ id: 'n', t: 25, shape: { kind: 'point', x: 1, y: 1 }, comment: '', status: 'open' }],
    });
    const after = {
      ...before,
      scenes: before.scenes.map((s) => (s.kind === 'explainer' ? { ...s, duration: 8 } : s)),
    };
    const moved = remapOutputItems(after, outputRemapper(before, after));
    expect(moved.overlays.map((o) => [o.id, o.start, o.end])).toEqual([
      ['a', 2, 4],
      ['in', 11, 12],
      ['b', 23, 25],
    ]);
    expect(moved.annotations[0]!.t).toBe(28);
  });
});
