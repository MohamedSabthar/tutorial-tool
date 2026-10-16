import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createEngineClient, type EngineClient } from '@studio/core';
import { startEngine, type Engine } from '../src/server';
import { Workspace } from '../src/workspace';

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

  it('seeds the authoring, maintenance and product skills', async () => {
    const tree = await client.call('workspace.tree', {});
    for (const skill of [
      'tutorial-authoring',
      'skill-maintenance',
      'vscode-platform',
      'overlay-authoring',
      'explainer-authoring',
      'wso2-integrator',
    ])
      expect(tree).toContain(`.claude/skills/${skill}/SKILL.md`);
    const md = (await client.call('workspace.read', { path: 'CLAUDE.md' })).text;
    expect(md).toMatch(/## Conventions[\s\S]*## Learned lessons[\s\S]*## Gotchas/);
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

describe('workspace upgrades', () => {
  const OLD = `# Tutorial Studio workspace

## How you work here
- old text

## Learned lessons
<!-- The agent appends short, general lessons here after each tutorial. -->

## Gotchas
<!-- Product-agnostic pitfalls. -->
`;

  it('replaces an untouched old CLAUDE.md and adds new ignore rules, keeping edited files', async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'studio-up-')), 'ws');
    const ws = new Workspace(dir);
    await ws.init();
    await writeFile(path.join(dir, 'CLAUDE.md'), OLD);
    await writeFile(path.join(dir, '.gitignore'), 'projects/*/recordings/\n');
    await ws.ensure();
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toContain('skill-maintenance');
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toContain('projects/*/.studio/');

    const edited = OLD.replace(
      '<!-- The agent appends short, general lessons here after each tutorial. -->',
      '- Wait for toasts to close.',
    );
    await writeFile(path.join(dir, 'CLAUDE.md'), edited);
    await ws.ensure();
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(edited);
    await rm(path.dirname(dir), { recursive: true, force: true });
  });

  it("commits only the seed files it adds, never the agent's own edits", async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'studio-sweep-')), 'ws');
    const ws = new Workspace(dir);
    await ws.init();
    const skill = path.join(dir, '.claude/skills/wso2-integrator/pages/http-service.ts');
    const { execFileSync } = await import('node:child_process');
    // A skill the workspace lost (committed), so ensure() has a seed file to add back.
    await rm(path.join(dir, '.claude/skills/vscode-platform'), { recursive: true });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'drop'], {
      cwd: dir,
    });
    await writeFile(skill, (await readFile(skill, 'utf8')) + '// agent edit\n');
    await ws.ensure();
    const log = await ws.log(1);
    expect(log[0]?.subject).toBe('workspace: add seed knowledge');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    expect(status).toContain('.claude/skills/wso2-integrator/pages/http-service.ts');
    await rm(path.dirname(dir), { recursive: true, force: true });
  });
});
