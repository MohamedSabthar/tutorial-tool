import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, PipelineStage, PipelineState } from '@studio/core';
import { ProjectStore } from '../src/projects';
import { PipelineManager } from '../src/pipeline/machine';
import type { ProjectRunResult } from '../src/recording';

const PLAN = {
  summary: 'Create a service',
  steps: [
    { id: 's1', title: 'Open the catalogue' },
    { id: 's2', title: 'Create the service' },
  ],
};

/**
 * A fake agent: for each pipeline message it runs `react(stage, text)`, which may call the
 * pipeline (save_plan / stage_done), then ends its turn with a result event.
 */
function fakeAgents(react: (stage: string, text: string) => Promise<void> | void) {
  const listeners = new Set<(e: AgentEvent) => void>();
  const sent: string[] = [];
  let seq = 0;
  const session = {
    subscribe(fn: (e: AgentEvent) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async send(text: string) {
      sent.push(text);
      const stage = /\[Pipeline(?: · ([a-z -]+?))?(?:,|\])/.exec(text)?.[1] ?? 'nudge';
      setTimeout(async () => {
        await react(stage, text);
        const e = {
          kind: 'result',
          slug: 'x',
          seq: ++seq,
          at: 0,
          ok: true,
          subtype: 'success',
          turns: 1,
          durationMs: 1,
          costUsd: 0,
          text: '',
        } as AgentEvent;
        for (const fn of [...listeners]) fn(e);
      }, 1);
    },
    async status() {
      return { status: { costUsd: 0 } };
    },
    async interrupt() {
      return true;
    },
  };
  return { agents: { get: () => session } as never, sent };
}

const run = (passed: boolean, stepId = 's2'): ProjectRunResult =>
  ({
    passed,
    events: passed ? [{ kind: 'step-end' }, { kind: 'step-end' }] : [],
    failure: passed ? null : { stepId, error: 'Resource Path was not visible', errorDetail: 'call log' },
    take: null,
  }) as never;

describe('PipelineManager', () => {
  let ws: string;
  let store: ProjectStore;
  let slug: string;
  let states: PipelineState[];
  beforeEach(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'pipe-'));
    store = new ProjectStore(ws);
    slug = (await store.create({ title: 'Pipe', product: 'wso2-integrator' })).slug;
    states = [];
  });
  afterEach(() => rm(ws, { recursive: true, force: true }));

  const until = async (pred: () => boolean, ms = 3000) => {
    for (let i = 0; i < ms / 5 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
    if (!pred()) console.log(JSON.stringify(states.at(-1), null, 1));
    expect(pred()).toBe(true);
  };
  const last = () => states.at(-1)!;

  it("commits skill changes after an agent stage with the agent's knowledge line", async () => {
    const commits: string[] = [];
    let dirty = false;
    const git = {
      head: async () => 'h0',
      skillCommitsSince: async () => [],
      commitSkills: async (summary: string, version: string | null) => {
        if (!dirty) return null;
        dirty = false;
        commits.push(`${summary} [${version}]`);
        return { hash: 'abc1234', subject: `skills(wso2-integrator): ${summary}` };
      },
    };
    const { p } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (stage === 'script') {
          dirty = true;
          p.stageDone(slug, 'script', true, 'Script written', 'http-service: Resource Path renamed');
        } else if (stage === 'post-production') done(p, 'post');
      },
      [true, true],
      git,
    );
    await p.start(slug, { storyboard: false });
    await until(() => last().status === 'done');
    expect(commits).toEqual(['http-service: Resource Path renamed [null]']);
    expect(last().history.find((h) => h.stage === 'script')?.summary).toContain('abc1234');
  });

  function make(
    react: (p: PipelineManager, stage: string, text: string) => Promise<void> | void,
    runs: boolean[],
    git?: unknown,
  ) {
    const queue = [...runs];
    const modes: string[] = [];
    const ref: { p?: PipelineManager } = {};
    const { agents, sent } = fakeAgents((stage, text) => react(ref.p!, stage, text));
    const p = (ref.p = new PipelineManager({
      store,
      agents,
      runProject: async (_slug, mode) => {
        modes.push(mode);
        return run(queue.shift() ?? true);
      },
      stopRun: () => {},
      onTake: () => {},
      emit: (s) => states.push(s),
      ...(git ? { git: git as never } : {}),
    }));
    return { p, sent, modes };
  }

  const done = (p: PipelineManager, stage: PipelineStage) => p.stageDone(slug, stage, true, `${stage} done`);

  it('plans, waits at the storyboard gate, then scripts, repairs, records and finishes', async () => {
    const { p, sent, modes } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'repair') done(p, 'repair');
        else if (stage === 'post-production') done(p, 'post');
      },
      [false, true, true],
    );
    await p.start(slug);
    await until(() => last().status === 'waiting');
    expect(last()).toMatchObject({ stage: 'storyboard_gate', gate: { kind: 'storyboard' } });
    expect(last().plan?.steps).toHaveLength(2);
    expect((await store.open(slug)).project.status).toBe('storyboard');

    await p.approve(slug);
    await until(() => last().status === 'done');
    expect(modes).toEqual(['dry', 'dry', 'record']);
    expect(last().history.map((h) => [h.stage, h.ok])).toEqual([
      ['plan', true],
      ['storyboard_gate', true],
      ['script', true],
      ['dry_run', false],
      ['repair', true],
      ['dry_run', true],
      ['record', true],
      ['post', true],
      ['retro', true],
    ]);
    expect(sent.find((t) => t.includes('repair, attempt 1 of 3'))).toContain('Resource Path was not visible');
    expect((await store.open(slug)).project.status).toBe('edit');
  });

  it('sends revisions back to the agent and reopens the gate', async () => {
    const { p, sent } = make(async (p, stage) => {
      if (stage === 'plan' || stage === 'plan revision') {
        await p.savePlan(slug, PLAN);
        done(p, 'plan');
      }
    }, []);
    await p.start(slug);
    await until(() => last().status === 'waiting');
    await p.revise(slug, 'Add a step that tests the endpoint');
    await until(() => last().status === 'waiting' && last().gate?.title === 'Review the revised storyboard');
    expect(sent.some((t) => t.includes('Add a step that tests the endpoint'))).toBe(true);
    await p.stop(slug);
    await until(() => last().status === 'stopped');
  });

  it('nudges once when a turn ends without stage_done, then asks the user for help', async () => {
    const { p, sent } = make(() => {}, []);
    await p.start(slug);
    await until(() => last().status === 'waiting');
    expect(sent.filter((t) => t.includes('still waiting'))).toHaveLength(1);
    expect(last().gate).toMatchObject({ kind: 'help', stage: 'plan' });
    await p.stop(slug);
    await until(() => last().status === 'stopped');
  });

  it('escalates after the repair cap with a help gate', async () => {
    const { p } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'repair') done(p, 'repair');
      },
      [false, false, false, false],
    );
    await p.start(slug, { storyboard: false });
    await until(() => last().status === 'waiting');
    expect(last().gate).toMatchObject({
      kind: 'help',
      stage: 'repair',
      title: 'Agent needs help at step s2',
    });
    expect(last().history.filter((h) => h.stage === 'repair')).toHaveLength(3);
    expect(p.stageDone(slug, 'plan', true, 'x')).toMatch(/No pipeline stage is waiting/);
    await p.stop(slug);
  });

  it('rejects stage_done for the wrong stage and invalid plans', async () => {
    const { p } = make(async (p, stage) => {
      if (stage === 'plan') {
        expect(p.stageDone(slug, 'script', true, 'x')).toMatch(/waiting for the "plan" stage/);
        await expect(p.savePlan(slug, { steps: [{ id: 'one', title: 'x' }] })).rejects.toThrow();
        await p.savePlan(slug, PLAN);
        done(p, 'plan');
      }
    }, []);
    await p.start(slug);
    await until(() => last().status === 'waiting');
    await p.stop(slug);
  });
});
