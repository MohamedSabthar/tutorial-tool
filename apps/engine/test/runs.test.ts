import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@studio/core';
import { ProjectStore } from '../src/projects';
import { TimelineStore } from '../src/timeline';
import { RunManager } from '../src/runs';

function fakeAgent() {
  const fns = new Set<(e: AgentEvent) => void>();
  let cost = 1;
  return {
    session: {
      runId: 'agent-run-1',
      subscribe(fn: (e: AgentEvent) => void) {
        fns.add(fn);
        return () => fns.delete(fn);
      },
      async status() {
        return { status: { costUsd: cost } };
      },
    },
    emit(e: Partial<AgentEvent>) {
      if (e.kind === 'result') cost += 0.25;
      for (const fn of [...fns]) fn({ slug: 'p', seq: 1, at: 0, ...e } as AgentEvent);
    },
    cost: () => cost,
  };
}

describe('RunManager', { timeout: 30_000 }, () => {
  let ws: string;
  let store: ProjectStore;
  let timelines: TimelineStore;
  let slug: string;
  let agent: ReturnType<typeof fakeAgent>;
  let runs: RunManager;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ws, encoding: 'utf8' }).trim();
  const until = async (pred: () => Promise<boolean>) => {
    // Generous: git snapshots are slow while the whole suite runs in parallel.
    for (let i = 0; i < 1000 && !(await pred()); i++) await new Promise((r) => setTimeout(r, 10));
    expect(await pred()).toBe(true);
  };

  beforeEach(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'runs-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    store = new ProjectStore(ws);
    slug = (await store.create({ title: 'Runs', product: 'wso2-integrator' })).slug;
    await mkdir(path.join(store.dir(slug), 'overlays'), { recursive: true });
    await writeFile(path.join(store.dir(slug), 'overlays', 'Arrow.tsx'), 'export default () => null;\n');
    git('add', '-A');
    git('commit', '-qm', 'init');
    timelines = new TimelineStore(store, () => {});
    await timelines.patch(
      slug,
      [
        {
          op: 'add',
          path: '/annotations/-',
          value: {
            id: 'an-1',
            t: 1,
            shape: { kind: 'point', x: 1, y: 1 },
            comment: 'Arrow at Create',
            status: 'sent',
          },
        },
      ],
      { author: 'user' },
    );
    agent = fakeAgent();
    runs = new RunManager({
      workspace: ws,
      store,
      timelines,
      agents: { get: () => agent.session },
      emit: () => {},
    });
  });
  afterEach(() => rm(ws, { recursive: true, force: true }));

  it('snapshots a turn on runs/<slug>, summarises it, and reverts it exactly', async () => {
    const head = git('rev-parse', 'HEAD');
    const n = await runs.begin(slug, { prompt: 'Arrow at Create', annotationIds: ['an-1'] });
    // The agent edits a component and adds an overlay.
    const file = path.join(store.dir(slug), 'overlays', 'Arrow.tsx');
    await writeFile(file, 'export default function Arrow() {\n  return null;\n}\n');
    await timelines.patch(
      slug,
      [
        {
          op: 'add',
          path: '/overlays/-',
          value: { id: 'arrow-1', component: 'project:Arrow', start: 1, end: 3 },
        },
      ],
      { author: 'agent', group: 'agent-run-1' },
    );
    agent.emit({ kind: 'tool_use', id: 'u1', name: 'mcp__studio__check_overlay', summary: '', input: {} });
    agent.emit({
      kind: 'tool_result',
      id: 'u1',
      isError: false,
      text: '✓ project:Arrow passed every check.\nmore',
      images: 1,
    });
    agent.emit({
      kind: 'result',
      ok: true,
      subtype: 'success',
      turns: 3,
      durationMs: 4200,
      costUsd: 1.25,
      text: 'Added an arrow at Create.',
    });
    await until(async () => (await runs.get(slug, n)).status === 'review');

    const run = await runs.get(slug, n);
    expect(run).toMatchObject({
      summary: 'Added an arrow at Create.',
      checks: ['✓ project:Arrow passed every check.'],
      costUsd: 0.25,
    });
    expect(run.files).toEqual([{ path: `projects/${slug}/overlays/Arrow.tsx`, added: 3, removed: 1 }]);
    expect(run.timeline).toEqual(['Added overlay arrow-1 (project:Arrow) 1–3 s']);
    expect(await runs.diff(slug, n)).toContain('+export default function Arrow() {');
    // The user's branch and working tree are untouched.
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git('rev-list', '--count', `runs/${slug}`)).toBe('2');

    await runs.revert(slug, n);
    expect(await readFile(file, 'utf8')).toBe('export default () => null;\n');
    const { timeline, canUndo } = await timelines.get(slug);
    expect(timeline.overlays).toEqual([]);
    expect(timeline.annotations[0]!.status).toBe('open');
    expect(canUndo).toBe(true);
    expect((await runs.get(slug, n)).status).toBe('reverted');
  });

  it('accepting resolves the annotations; a turn that changes nothing is empty', async () => {
    const n = await runs.begin(slug, { prompt: 'x', annotationIds: ['an-1'] });
    await writeFile(path.join(store.dir(slug), 'overlays', 'Arrow.tsx'), 'export default () => 1;\n');
    agent.emit({
      kind: 'result',
      ok: true,
      subtype: 'success',
      turns: 1,
      durationMs: 1,
      costUsd: 1.25,
      text: 'done',
    });
    await until(async () => (await runs.get(slug, n)).status === 'review');
    await runs.accept(slug, n);
    expect((await timelines.get(slug)).timeline.annotations[0]!.status).toBe('resolved');

    const m = await runs.begin(slug, { prompt: 'just a question' });
    agent.emit({
      kind: 'result',
      ok: true,
      subtype: 'success',
      turns: 1,
      durationMs: 1,
      costUsd: 1.5,
      text: 'answer',
    });
    await until(async () => (await runs.get(slug, m)).status === 'empty');
  });
});
