import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createEngineClient, type EngineClient } from '@studio/core';
import { startEngine, type Engine } from '../src/server';

let engine: Engine;
let client: EngineClient;
let root: string;

beforeAll(async () => {
  root = path.join(await mkdtemp(path.join(os.tmpdir(), 'studio-ws-')), 'workspace');
  engine = await startEngine({ workspace: root });
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
  await rm(path.dirname(root), { recursive: true, force: true });
});

describe('workspace', () => {
  it('starts uninitialized', async () => {
    expect(await client.call('workspace.status', {})).toMatchObject({ initialized: false, commits: 0 });
  });

  it('initializes the knowledge base as its own git repo with one commit', async () => {
    const status = await client.call('workspace.init', {});
    expect(status).toMatchObject({ initialized: true, commits: 1 });
    const tree = await client.call('workspace.tree', {});
    for (const f of [
      'CLAUDE.md',
      '.claude/settings.json',
      '.claude/skills/',
      'overlays/',
      'scenes/',
      'theme/wso2.ts',
      'products.json',
      'projects/',
      '.gitignore',
    ])
      expect(tree).toContain(f);
    const settings = JSON.parse(
      (await client.call('workspace.read', { path: '.claude/settings.json' })).text,
    );
    expect(settings.permissions.deny).toContain('Bash(git push:*)');
  });

  it('is idempotent', async () => {
    expect(await client.call('workspace.init', {})).toMatchObject({ commits: 1 });
  });

  it('commits each new project with its brief', async () => {
    const p = await client.call('project.create', { title: 'Demo tutorial', product: 'wso2-integrator' });
    const log = await client.call('workspace.log', {});
    expect(log[0]?.subject).toBe(`project: create ${p.slug}`);
    const brief = await client.call('workspace.read', { path: `projects/${p.slug}/CLAUDE.md` });
    expect(brief.text).toMatch(/^# Demo tutorial/);
  });

  it('refuses to read outside the workspace or binary files', async () => {
    await expect(client.call('workspace.read', { path: '../secret.md' })).rejects.toThrow(/outside/);
    await expect(client.call('workspace.read', { path: 'video.mp4' })).rejects.toThrow(/text files/);
  });
});
