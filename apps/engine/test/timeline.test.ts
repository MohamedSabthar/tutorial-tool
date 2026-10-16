import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  applyPatch,
  createEngineClient,
  parseTimeline,
  type EngineClient,
  type RpcEventData,
} from '@studio/core';
import { startEngine, type Engine } from '../src/server';

let engine: Engine;
let a: EngineClient;
let b: EngineClient;
let ws: string;
let slug: string;

const connect = () =>
  createEngineClient({
    url: `ws://127.0.0.1:${engine.port}/rpc`,
    token: engine.token,
    WebSocket: WebSocket as never,
    reconnectMs: 0,
  });

beforeAll(async () => {
  ws = await mkdtemp(path.join(os.tmpdir(), 'studio-tl-'));
  engine = await startEngine({ workspace: ws });
  a = connect();
  b = connect();
  slug = (await a.call('project.create', { title: 'Timeline test', product: 'wso2-integrator' })).slug;
});

afterAll(async () => {
  a.close();
  b.close();
  await engine.close();
  await rm(ws, { recursive: true, force: true });
});

const card = (id: string, start: number) => ({
  id,
  component: 'core:TitleCard',
  start,
  end: start + 3,
  props: {},
});

describe('timeline store', () => {
  it('applies patches, saves them, and keeps a second client in sync', async () => {
    let mirror = (await b.call('timeline.get', { slug })).timeline;
    const seen: RpcEventData<'timeline.changed'>[] = [];
    b.on('timeline.changed', (e) => {
      seen.push(e);
      mirror = applyPatch(mirror, e.patch);
    });
    const r = await a.call('timeline.patch', {
      slug,
      patch: [{ op: 'add', path: '/overlays/-', value: card('t1', 1) }],
    });
    expect(r.version).toBe(1);
    await new Promise((res) => setTimeout(res, 50));
    expect(seen[0]).toMatchObject({ version: 1, author: 'user', kind: 'patch' });
    expect(mirror).toEqual(r.timeline);
    const onDisk = parseTimeline(
      JSON.parse(await readFile(path.join(ws, 'projects', slug, 'tutorial.json'), 'utf8')),
    );
    expect(onDisk.overlays.map((o) => o.id)).toEqual(['t1']);
  });

  it('undoes a five-patch drag in one step and redoes it', async () => {
    for (const start of [1.2, 1.4, 1.6, 1.8, 2]) {
      await a.call('timeline.patch', {
        slug,
        group: 'drag-1',
        patch: [
          { op: 'replace', path: '/overlays/0/start', value: start },
          { op: 'replace', path: '/overlays/0/end', value: start + 3 },
        ],
      });
    }
    expect((await a.call('timeline.get', { slug })).timeline.overlays[0]!.start).toBe(2);
    const undone = await b.call('timeline.undo', { slug });
    expect(undone.timeline.overlays[0]!.start).toBe(1);
    const redone = await a.call('timeline.redo', { slug });
    expect(redone.timeline.overlays[0]!.start).toBe(2);
    expect(redone.canRedo).toBe(false);
  });

  it('rejects an invalid patch without changing anything', async () => {
    const before = await a.call('timeline.get', { slug });
    await expect(
      a.call('timeline.patch', { slug, patch: [{ op: 'replace', path: '/overlays/0/end', value: -5 }] }),
    ).rejects.toThrow(/invalid/);
    const after = await a.call('timeline.get', { slug });
    expect(after.version).toBe(before.version);
    expect(after.timeline).toEqual(before.timeline);
  });
});
