import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportSettings, sampleTimeline } from '@studio/core';
import { Exporter } from '../src/export';
import { ProjectStore } from '../src/projects';
import { TimelineStore } from '../src/timeline';

describe('Exporter.plan', () => {
  let ws: string;
  let store: ProjectStore;
  let exporter: Exporter;
  let slug: string;

  beforeEach(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'export-plan-'));
    store = new ProjectStore(ws);
    slug = (await store.create({ title: 'Plan', product: 'wso2-integrator' })).slug;
    await writeFile(path.join(store.dir(slug), 'tutorial.json'), JSON.stringify(sampleTimeline()));
    exporter = new Exporter({
      store,
      timelines: new TimelineStore(store, () => {}),
      docs: { write: async () => ({ files: [], notes: [] }) } as never,
      workspace: ws,
      engine: () => ({ port: 0, token: '' }),
      emit: () => {},
      frame: () => {},
    });
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it('says where the export goes and what it replaces', async () => {
    const settings = ExportSettings.parse({});
    const first = await exporter.plan(slug, settings);
    expect(first.folder).toBe(path.join(store.dir(slug), 'output'));
    expect(first.previous).toEqual([]);

    const out = path.join(store.dir(slug), 'output');
    await mkdir(path.join(out, '.export'), { recursive: true });
    await writeFile(path.join(out, `${slug}.mp4`), '');
    await writeFile(path.join(out, 'captions.srt'), '');
    expect((await exporter.plan(slug, settings)).previous).toEqual([
      'output/captions.srt',
      `output/${slug}.mp4`,
    ]);
  });
});
