import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { insertExplainerScene, removeExplainerScene, sampleTimeline } from '@studio/core';
import { ProjectStore } from '../src/projects';
import { TimelineStore } from '../src/timeline';
import { Explainers } from '../src/explainers';
import type { Catalog } from '../src/agent/catalog';

describe('Explainers', () => {
  let ws: string;
  let store: ProjectStore;
  let timelines: TimelineStore;
  let slug: string;
  let sent: string[];
  let ex: Explainers;
  const catalog: Catalog = {
    entries: [
      {
        id: 'core:BlueprintFlow',
        kind: 'scene',
        scope: 'core',
        name: 'BlueprintFlow',
        description: '',
        props: {},
      },
      {
        id: 'core:CardDeck',
        kind: 'scene',
        scope: 'core',
        name: 'CardDeck',
        description: '',
        props: {},
        beats: [],
      },
      { id: 'core:Callout', kind: 'overlay', scope: 'core', name: 'Callout', description: '', props: {} },
    ],
    schemas: new Map<string, z.ZodType>([
      ['core:BlueprintFlow', z.object({ title: z.string().default('x') }).strict()],
    ]),
  };

  beforeEach(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'explainers-'));
    store = new ProjectStore(ws);
    slug = (await store.create({ title: 'Ex', product: 'wso2-integrator' })).slug;
    const tl = sampleTimeline();
    tl.scenes = tl.scenes.filter((s) => s.kind === 'recording').slice(0, 1);
    tl.transitions = [];
    await writeFile(path.join(store.dir(slug), 'tutorial.json'), JSON.stringify(tl));
    timelines = new TimelineStore(store, () => {});
    sent = [];
    ex = new Explainers({
      store,
      timelines,
      catalog: async () => catalog,
      insertScene: async (s, at, component, props) => {
        const { timeline } = await timelines.get(s);
        const r = insertExplainerScene(timeline, at, {
          kind: 'explainer',
          component,
          props,
          narration: [],
          beats: [],
          duration: 'auto',
          estimatedDuration: 6,
        });
        await timelines.patch(s, [{ op: 'replace', path: '/scenes', value: r.timeline.scenes }], {
          author: 'user',
        });
        return r.sceneId;
      },
      removeScene: async (s, id) => {
        const { timeline } = await timelines.get(s);
        await timelines.patch(
          s,
          [{ op: 'replace', path: '/scenes', value: removeExplainerScene(timeline, id).scenes }],
          { author: 'user' },
        );
      },
      send: async (_s, text) => void sent.push(text),
      emit: () => {},
    });
  });
  afterEach(() => rm(ws, { recursive: true, force: true }));

  it('goes from a placeholder through a reviewed storyboard to a build request', async () => {
    const job = await ex.start(slug, 10, 'explain how a request reaches /greeting', true);
    expect(job.status).toBe('storyboarding');
    expect(sent[0]).toContain('[Explainer · storyboard]');
    expect(sent[0]).toContain(job.sceneId);
    let { timeline } = await timelines.get(slug);
    expect(timeline.scenes.find((s) => s.id === job.sceneId)).toMatchObject({
      kind: 'explainer',
      component: 'core:CardDeck',
    });

    await ex.saveStoryboard(slug, job.sceneId, {
      title: 'How a request reaches /greeting',
      approach: 'core:BlueprintFlow',
      beats: [
        { id: 'client', narration: 'A client sends a request.' },
        { id: 'listener', narration: 'The listener receives it.' },
      ],
    });
    ({ timeline } = await timelines.get(slug));
    const scene = timeline.scenes.find((s) => s.id === job.sceneId);
    expect(scene).toMatchObject({
      narration: ['A client sends a request.', 'The listener receives it.'],
      beats: [
        { id: 'client', at: 'vo:0' },
        { id: 'listener', at: 'vo:1' },
      ],
    });
    expect((await ex.get(slug, job.sceneId)).status).toBe('review');

    await expect(ex.setScene(slug, job.sceneId, { component: 'core:Nope' })).rejects.toThrow(
      /Available: core:BlueprintFlow, core:CardDeck/,
    );
    await expect(ex.setScene(slug, job.sceneId, { component: 'core:Callout' })).rejects.toThrow(
      /no scene component/,
    );
    await expect(
      ex.setScene(slug, job.sceneId, { component: 'core:BlueprintFlow', props: { bogus: 1 } }),
    ).rejects.toThrow(/props don't match/);
    expect(
      await ex.setScene(slug, job.sceneId, { component: 'core:BlueprintFlow', props: { title: 'Flow' } }),
    ).toContain('core:BlueprintFlow');

    await ex.editBeat(slug, job.sceneId, 'listener', 'The listener on port 9090 receives it.');
    ({ timeline } = await timelines.get(slug));
    expect((timeline.scenes.find((s) => s.id === job.sceneId) as { narration: string[] }).narration[1]).toBe(
      'The listener on port 9090 receives it.',
    );

    await ex.approve(slug, job.sceneId);
    expect(sent[1]).toContain('[Explainer · build]');
    expect(sent[1]).toContain('The listener on port 9090 receives it.');
    expect((await ex.get(slug, job.sceneId)).status).toBe('building');
    await ex.done(slug, job.sceneId, 'Built');
    expect((await ex.get(slug, job.sceneId)).status).toBe('done');
  });

  it('revising re-asks for a storyboard with the feedback; cancelling removes the scene', async () => {
    const job = await ex.start(slug, 10, 'explain listeners', false);
    expect(sent).toEqual([]);
    await ex.revise(slug, job.sceneId, 'Use three beats');
    expect(sent[0]).toContain('Use three beats');
    await ex.cancel(slug, job.sceneId);
    expect((await timelines.get(slug)).timeline.scenes.some((s) => s.id === job.sceneId)).toBe(false);
    expect((await ex.get(slug, job.sceneId)).status).toBe('cancelled');
  });
});
