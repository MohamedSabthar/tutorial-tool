import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createEngineClient, RpcError, TOKEN_HEADER, type EngineClient } from '@studio/core';
import { startEngine, type Engine } from '../src/server';
import { parseRange } from '../src/media';

let engine: Engine;
let client: EngineClient;
let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), 'studio-engine-'));
  engine = await startEngine({ workspace });
  client = createEngineClient({
    url: `ws://127.0.0.1:${engine.port}/rpc`,
    token: engine.token,
    WebSocket: WebSocket as never,
    reconnectMs: 0,
  });
});

afterAll(async () => {
  client.close();
  await engine.close();
  await rm(workspace, { recursive: true, force: true });
});

describe('engine RPC', () => {
  it('answers ping', async () => {
    const r = await client.call('ping', { sentAt: 42 });
    expect(r).toMatchObject({ sentAt: 42, workspace });
  });

  it('creates, lists and opens projects, and broadcasts changes', async () => {
    const changed = new Promise<string>((resolve) => client.on('project.changed', (d) => resolve(d.slug)));
    const p = await client.call('project.create', {
      title: 'Create an HTTP service!',
      product: 'wso2-integrator',
    });
    expect(p.slug).toBe('create-an-http-service');
    expect(await changed).toBe(p.slug);

    const again = await client.call('project.create', {
      title: 'Create an HTTP service',
      product: 'wso2-integrator',
    });
    expect(again.slug).toBe('create-an-http-service-2');

    const list = (await client.call('project.list', {})).map((x) => x.slug);
    expect(list).toEqual(expect.arrayContaining(['create-an-http-service', 'create-an-http-service-2']));
    // The seed reference project is added when the workspace is initialized.
    expect(list).toContain('demo-http');

    const opened = await client.call('project.open', { slug: p.slug });
    expect(opened.project.title).toBe('Create an HTTP service!');
    expect(opened.timeline.version).toBe(1);
  });

  it('validates params and reports unknown projects', async () => {
    await expect(client.call('project.create', { title: '' } as never)).rejects.toThrow(RpcError);
    await expect(client.call('project.open', { slug: 'missing' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('rejects WebSocket connections without the token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${engine.port}/rpc?token=wrong`);
    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('rejected'));
    });
    expect(result).toBe('rejected');
  });
});

describe('media route', () => {
  it('serves byte ranges with 206 and needs the token', async () => {
    const dir = path.join(workspace, 'projects', 'create-an-http-service', 'recordings');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'clip.mp4'), Buffer.from('0123456789'));
    const url = `${engine.url}/media/create-an-http-service/recordings/clip.mp4`;

    expect((await fetch(url)).status).toBe(401);

    const full = await fetch(url, { headers: { [TOKEN_HEADER]: engine.token } });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');

    const part = await fetch(`${url}?token=${engine.token}`, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
  });

  it('allows cross-origin reads (UI origin differs) and preflights without a token', async () => {
    const url = `${engine.url}/media/create-an-http-service/recordings/clip.mp4`;
    const pre = await fetch(url, {
      method: 'OPTIONS',
      headers: { origin: 'tauri://localhost', 'access-control-request-headers': 'range' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('range');
    const get = await fetch(`${url}?token=${engine.token}`, {
      headers: { origin: 'tauri://localhost', range: 'bytes=0-1' },
    });
    expect(get.headers.get('access-control-allow-origin')).toBe('*');
    expect(get.headers.get('access-control-expose-headers')).toContain('content-range');
  });

  it('blocks paths outside the project', async () => {
    const r = await fetch(`${engine.url}/media/create-an-http-service/..%2F..%2Fsecret`, {
      headers: { [TOKEN_HEADER]: engine.token },
    });
    expect([403, 404]).toContain(r.status);
  });

  it('parses ranges', () => {
    expect(parseRange('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=12-', 10)).toBe('invalid');
    expect(parseRange(undefined, 10)).toBeNull();
  });
});
