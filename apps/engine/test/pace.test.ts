import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecorderEvent } from '@studio/core';
import { ProjectStore } from '../src/projects';
import { clearPace, cueDrift, driftLine, lateCueLines, lateCues, readPace, voicePace } from '../src/pace';

/** Fake TTS: 0.1 s per character, aligned per character. */
const tts = (requests: unknown[]) => ({
  synthesize: async (_slug: string, input: { text: string }) => {
    requests.push(input);
    const chars = [...input.text];
    return {
      audio: `audio/${input.text.length}.mp3`,
      audioPath: '',
      duration: chars.length * 0.1,
      cached: false,
      alignment: { chars, starts: chars.map((_, i) => i * 0.1), ends: chars.map((_, i) => i * 0.1 + 0.1) },
    };
  },
});

describe('voice-first pace', () => {
  let ws: string;
  let store: ProjectStore;
  let slug: string;
  beforeEach(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'pace-'));
    store = new ProjectStore(ws);
    slug = (await store.create({ title: 'Pace', product: 'wso2-integrator' })).slug;
    await store.saveBrief(slug, { ...(await store.readBrief(slug)), voice: 'voice-1' });
  });
  afterEach(() => rm(ws, { recursive: true, force: true }));

  it('voices the narrated steps with their neighbours, as the post voice-over does, and saves pace.json', async () => {
    const requests: unknown[] = [];
    const progress: string[] = [];
    const r = await voicePace(
      { store, tts: tts(requests) as never },
      slug,
      [
        { id: 's1', narration: ' Open it. ' },
        { id: 's2', narration: '' },
        { id: 's3', narration: 'Click Save.' },
      ],
      (l) =>
        progress.push(
          `${l.stepId} ${l.index + 1}/${l.total}${l.done ? ` ${l.done.seconds.toFixed(1)}` : ''}`,
        ),
    );
    expect(r.lines).toBe(2);
    // Each line reports when it starts and when it is voiced.
    expect(progress).toEqual(['s1 1/2', 's1 1/2 0.8', 's3 2/2', 's3 2/2 1.1']);
    expect(requests).toEqual([
      { text: 'Open it.', voiceId: 'voice-1', nextText: 'Click Save.' },
      { text: 'Click Save.', voiceId: 'voice-1', previousText: 'Open it.' },
    ]);
    const pace = await readPace(store.dir(slug));
    expect(Object.keys(pace!.steps)).toEqual(['s1', 's3']);
    expect(pace!.steps.s3!.words.map((w) => [w.w, w.start])).toEqual([
      ['Click', 0],
      ['Save.', 0.6],
    ]);
    expect(pace).toMatchObject({ leadIn: 0.25, clickGap: 0.6, tail: 0.35 });
    await clearPace(store.dir(slug));
    expect(await readPace(store.dir(slug))).toBeNull();
  });

  it('speaks terms from the pronunciations but keeps the written words for cues', async () => {
    const requests: { text: string; nextText?: string }[] = [];
    await voicePace(
      {
        store,
        tts: tts(requests) as never,
        pronunciations: async () => [{ term: 'WSO2', say: 'W S O two' }],
      },
      slug,
      [
        { id: 's1', narration: 'Open WSO2 now.' },
        { id: 's2', narration: 'Close WSO2.' },
      ],
    );
    expect(requests[0]).toMatchObject({ text: 'Open W S O two now.', nextText: 'Close W S O two.' });
    const pace = await readPace(store.dir(slug));
    expect(pace!.steps.s1!.text).toBe('Open WSO2 now.');
    expect(pace!.steps.s1!.words.map((w) => w.w)).toEqual(['Open', 'WSO2', 'now.']);
  });

  it('reports how far cued actions landed from their words', () => {
    const bbox = { x: 0, y: 0, w: 1, h: 1 };
    const events = RecorderEvent.array().parse([
      { kind: 'click', t: 1.02, stepId: 's1', x: 0, y: 0, target: 'a', bbox, cue: { word: 'a', at: 1 } },
      { kind: 'click', t: 3.4, stepId: 's1', x: 0, y: 0, target: 'b', bbox, cue: { word: 'b', at: 3 } },
      { kind: 'key', t: 5, stepId: 's1', key: 'Enter' },
    ]);
    expect(cueDrift(events)).toEqual({ cues: 2, off: 1, maxOff: 0.4 });
    expect(driftLine(cueDrift(events))).toBe('1 of 2 cues on time (max 400 ms off)');
    expect(driftLine(cueDrift(events.slice(0, 1)))).toBe('1 cue on time (max 20 ms off)');
  });

  it('reports late cues with what kept them waiting', () => {
    const bbox = { x: 0, y: 0, w: 1, h: 1 };
    const events = RecorderEvent.array().parse([
      { kind: 'step-start', t: 0, stepId: 's1', title: 'One' },
      {
        kind: 'click',
        t: 1,
        stepId: 's1',
        x: 0,
        y: 0,
        target: 'Create',
        bbox,
        cue: { word: 'Create', at: 1 },
      },
      // The service took 6 s to start: its click is 2.5 s past "Run".
      { kind: 'click', t: 7, stepId: 's1', x: 0, y: 0, target: 'Run', bbox, cue: { word: 'Run', at: 4.5 } },
      { kind: 'step-start', t: 8, stepId: 's2', title: 'Two' },
      { kind: 'key', t: 9.3, stepId: 's2', key: 'Enter', cue: { word: 'send', at: 9 } },
    ]);
    const late = lateCues(events);
    expect(late).toEqual([
      { stepId: 's1', word: 'Run', late: 2.5, after: 'clicking Create', gap: 6 },
      { stepId: 's2', word: 'send', late: 0.3, after: 'the step start', gap: 1.3 },
    ]);
    expect(lateCueLines(late)).toBe(
      '- s1: "Run" landed 2.5 s after the word, 6.0 s after clicking Create\n- s2: "send" landed 0.3 s after the word, 1.3 s after the step start',
    );
  });
});
