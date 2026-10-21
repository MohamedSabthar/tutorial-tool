import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, PipelineStage, PipelineState } from '@studio/core';
import { ProjectStore } from '../src/projects';
import { PipelineManager, type PipelineDeps } from '../src/pipeline/machine';
import type { ProjectRunResult } from '../src/recording';

const PLAN = {
  summary: 'Create a service',
  steps: [
    { id: 's1', title: 'Open the catalogue' },
    { id: 's2', title: 'Create the service' },
  ],
};

/** What the fake agent session reports as spent so far. */
let agentCost = 0;

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
      return { status: { costUsd: agentCost } };
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
      knowledgeDiff: async () => '',
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
        else if (stage === 'retro') done(p, 'retro');
      },
      [true, true],
      git,
    );
    await p.start(slug, { storyboard: false, narration: false });
    await until(() => last().status === 'done');
    expect(commits).toEqual(['http-service: Resource Path renamed [null]']);
    expect(last().history.find((h) => h.stage === 'script')?.summary).toContain('abc1234');
  });

  it('shows the retrospective diff at a knowledge gate and commits it on approval', async () => {
    const commits: string[] = [];
    let diff = '';
    const git = {
      head: async () => 'h0',
      skillCommitsSince: async () => [],
      commitSkills: async () => null,
      knowledgeDiff: async () => diff,
      commitKnowledge: async (message: string) => {
        commits.push(message);
        diff = '';
        return { hash: 'def5678', subject: message };
      },
      discardKnowledge: async () => {},
    };
    const { p, sent } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'post-production') done(p, 'post');
        else if (stage === 'retro') {
          diff = '+- Wait for toasts to close before clicking.';
          p.stageDone(slug, 'retro', true, 'Added one lesson.', 'wait for toasts before clicking');
        }
      },
      [true, true],
      git,
    );
    await p.start(slug, { storyboard: false, narration: false });
    await until(() => last().status === 'waiting');
    expect(last().gate).toMatchObject({
      kind: 'knowledge',
      stage: 'retro',
      diff: expect.stringContaining('toasts'),
    });
    expect(sent.find((t) => t.startsWith('[Pipeline · retro]'))).toContain('script: ok');
    await p.approve(slug);
    await until(() => last().status === 'done');
    expect(commits).toEqual(['lessons: wait for toasts before clicking']);
    expect(last().history.at(-1)?.summary).toContain('def5678');
  });

  function make(
    react: (p: PipelineManager, stage: string, text: string) => Promise<void> | void,
    runs: boolean[],
    git?: unknown,
    extra: Partial<PipelineDeps> = {},
    handlesQa = false,
  ) {
    const queue = [...runs];
    const modes: string[] = [];
    const ref: { p?: PipelineManager } = {};
    // Final QA: the fake agent finds nothing (tests of it answer it themselves).
    const { agents, sent } = fakeAgents((stage, text) =>
      stage === 'qa' && !handlesQa
        ? void ref.p!.stageDone(slug, 'qa', true, 'qa done')
        : react(ref.p!, stage, text),
    );
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
      ...extra,
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
        else if (stage === 'retro') done(p, 'retro');
      },
      [false, true, true],
    );
    await p.start(slug, { storyboard: true });
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
      ['qa', true],
      ['retro', true],
    ]);
    expect(sent.find((t) => t.includes('repair, attempt 1 of 3'))).toContain('Resource Path was not visible');
    expect((await store.open(slug)).project.status).toBe('edit');
  });

  it('narrates, voices and checks the cues before a paced recording, then skips the post agent', async () => {
    const calls: string[] = [];
    let narration: unknown;
    const { p, sent, modes } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'narrate') {
          await p.savePlan(slug, {
            ...PLAN,
            steps: PLAN.steps.map((s) => ({ ...s, narration: `Final ${s.id}.` })),
          });
          done(p, 'narrate');
        } else if (stage === 'post-production') done(p, 'post');
        else if (stage === 'retro') done(p, 'retro');
      },
      [true, true, true],
      undefined,
      {
        pace: {
          blocker: async () => null,
          voice: async (_slug, plan) => {
            calls.push(`voice ${plan.steps.map((s) => s.narration).join(' ')}`);
            return 'Voiced 2 lines (3.0 s) to pace the take';
          },
          clear: async () => void calls.push('clear'),
        },
        voiceover: async (_slug, _group, n) => {
          narration = n;
          return 'Voice-over: 2 lines, 3.0 s.';
        },
      },
    );
    await p.start(slug, { storyboard: false, narration: false });
    await until(() => last().status === 'done');
    expect(modes).toEqual(['dry', 'dry', 'record']);
    expect(calls).toEqual(['clear', 'voice Final s1. Final s2.']);
    expect(last().history.map((h) => h.stage)).toEqual([
      'plan',
      'script',
      'dry_run',
      'narrate',
      'voice',
      'dry_run',
      'record',
      'post',
      'qa',
      'retro',
    ]);
    expect(last().history[5]!.summary).toBe('2 steps passed, cues checked');
    expect(last().history[6]!.summary).toContain('no cues');
    expect(sent.some((t) => t.startsWith('[Pipeline · post-production]'))).toBe(false);
    expect(narration).toMatchObject({ steps: [{ narration: 'Final s1.' }, { narration: 'Final s2.' }] });
    expect(last().paced).toBe(true);
  });

  it('aligns the script to the word timings after the voice-over, and re-records a drifted take once', async () => {
    const sent: string[] = [];
    const modes: string[] = [];
    const bbox = { x: 0, y: 0, w: 1, h: 1 };
    const click = (t: number, at: number) => ({
      kind: 'click',
      t,
      stepId: 's1',
      x: 0,
      y: 0,
      target: 'a',
      bbox,
      cue: { word: 'Open', at },
    });
    let records = 0;
    const { p } = make(
      async (p, stage, text) => {
        sent.push(text.split('\n')[0]!);
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (['script', 'narrate', 'align'].includes(stage)) done(p, stage as PipelineStage);
        else if (stage === 'post-production') done(p, 'post');
        else if (stage === 'retro') done(p, 'retro');
      },
      [],
      undefined,
      {
        pace: {
          blocker: async () => null,
          voice: async () => 'Voiced',
          clear: async () => {},
          read: async () => ({
            leadIn: 0.25,
            clickGap: 0.6,
            tail: 0.35,
            steps: {
              s1: {
                text: 'Open it.',
                duration: 1,
                words: [
                  { w: 'Open', start: 0, end: 0.4 },
                  { w: 'it.', start: 0.45, end: 0.9 },
                ],
              },
            },
          }),
        },
        runProject: async (_slug, mode) => {
          modes.push(mode);
          // The first take misses its cue by 0.4 s; the second lands on it.
          const events =
            mode === 'record'
              ? [click(++records === 1 ? 1.4 : 1.02, 1), { kind: 'step-end' }]
              : [{ kind: 'step-end' }];
          return { passed: true, events, failure: null, take: null } as never;
        },
      },
    );
    await p.start(slug, { storyboard: false, narration: false });
    await until(() => last().status === 'done');
    expect(modes).toEqual(['dry', 'dry', 'record', 'record']);
    const align = sent.find((t) => t.startsWith('[Pipeline · align]'));
    expect(align).toBeDefined();
    expect(
      last()
        .history.filter((h) => h.stage === 'record')
        .map((h) => h.summary),
    ).toEqual([expect.stringContaining('0 of 1 cues on time'), expect.stringContaining('1 cue on time')]);
  });

  it('stops for the narration review: edits make the agent re-match cues, feedback revises', async () => {
    const sentStages: string[] = [];
    const { p } = make(
      async (p, stage) => {
        sentStages.push(stage);
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'narrate' || stage === 'narrate revision' || stage === 'narrate cues') {
          if (stage === 'narrate')
            await p.savePlan(slug, {
              ...PLAN,
              steps: PLAN.steps.map((x) => ({ ...x, narration: `Line ${x.id}.` })),
            });
          done(p, 'narrate');
        } else if (stage === 'post-production') done(p, 'post');
        else if (stage === 'retro') done(p, 'retro');
      },
      [true, true, true],
      undefined,
      {
        pace: { blocker: async () => null, voice: async () => 'Voiced', clear: async () => {} },
        voiceover: async () => null,
      },
    );
    await p.start(slug, { storyboard: false });
    await until(() => last().status === 'waiting');
    expect(last().gate).toMatchObject({ stage: 'narrate', kind: 'narration' });
    expect(last().gate!.text).toMatch(/^2 lines/);

    await p.revise(slug, 'Shorter, please.');
    await until(() => sentStages.includes('narrate revision') && last().status === 'waiting');

    await p.editPlan(slug, [{ op: 'step', id: 's2', field: 'narration', value: 'My own words.' }]);
    await p.approve(slug);
    await until(() => last().status === 'done');
    expect(sentStages.filter((x) => x.startsWith('narrate'))).toEqual([
      'narrate',
      'narrate revision',
      'narrate cues',
    ]);
    expect(last().history.map((h) => h.stage)).toContain('voice');
  });

  it('voices a paced take before the agent adds explainers, then voices the explainers', async () => {
    const order: string[] = [];
    const { p } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, { ...PLAN, explainers: [{ after: 's1', idea: 'How routing works' }] });
          done(p, 'plan');
        } else if (stage === 'script' || stage === 'narrate') done(p, stage);
        else if (stage === 'post-production') {
          order.push('agent');
          done(p, 'post');
        } else if (stage === 'retro') done(p, 'retro');
      },
      [true, true, true],
      undefined,
      {
        pace: { blocker: async () => null, voice: async () => 'Voiced', clear: async () => {} },
        voiceover: async () => {
          order.push('voice');
          return null;
        },
      },
    );
    await p.start(slug, { storyboard: false, narration: false });
    await until(() => last().status === 'done');
    expect(order).toEqual(['voice', 'agent', 'voice']);
  });

  it('pauses at a help gate once the run passes its cost limit, then finishes when approved', async () => {
    agentCost = 0;
    const { p, sent } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, PLAN);
          agentCost = 3; // planning spent more than the limit
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'post-production') done(p, 'post');
        else if (stage === 'retro') done(p, 'retro');
      },
      [true, true],
      undefined,
      { costLimit: async () => 2 },
    );
    await p.start(slug, { storyboard: false, narration: false });
    await until(() => last().status === 'waiting');
    expect(last().gate).toMatchObject({
      stage: 'script',
      kind: 'help',
      title: 'This run reached its cost limit',
    });
    expect(last().gate!.text).toContain('$3.00');
    expect(sent.some((t) => t.startsWith('[Pipeline · script]'))).toBe(false);
    await p.approve(slug);
    await until(() => last().status === 'done');
    agentCost = 0;
  });

  it('records without pacing when the project has no voice, or voicing fails', async () => {
    for (const failVoice of [false, true]) {
      states = [];
      const { p, sent, modes } = make(
        async (p, stage) => {
          if (stage === 'plan') {
            await p.savePlan(slug, PLAN);
            done(p, 'plan');
          } else if (stage === 'script' || stage === 'narrate') done(p, stage);
          else if (stage === 'post-production') done(p, 'post');
          else if (stage === 'retro') done(p, 'retro');
        },
        [true, true],
        undefined,
        {
          pace: {
            blocker: async () => (failVoice ? null : 'No voice chosen in the brief.'),
            voice: async () => {
              throw new Error('ElevenLabs returned 401');
            },
            clear: async () => {},
          },
        },
      );
      await p.start(slug, { storyboard: false, narration: false });
      await until(() => last().status === 'done');
      expect(modes).toEqual(['dry', 'record']);
      const history = last().history;
      if (failVoice)
        expect(history.find((h) => h.stage === 'voice')).toMatchObject({
          ok: false,
          summary: 'ElevenLabs returned 401 · recording without pacing',
        });
      else
        expect(history.find((h) => h.stage === 'dry_run')!.summary).toContain('without voice-first pacing');
      expect(last().paced).toBe(false);
      expect(sent.some((t) => t.startsWith('[Pipeline · post-production]'))).toBe(true);
    }
  });

  it('sends revisions back to the agent and reopens the gate', async () => {
    const { p, sent } = make(async (p, stage) => {
      if (stage === 'plan' || stage === 'plan revision') {
        await p.savePlan(slug, PLAN);
        done(p, 'plan');
      }
    }, []);
    await p.start(slug, { storyboard: true });
    await until(() => last().status === 'waiting');
    await p.revise(slug, 'Add a step that tests the endpoint');
    await until(() => last().status === 'waiting' && last().gate?.title === 'Review the revised storyboard');
    expect(sent.some((t) => t.includes('Add a step that tests the endpoint'))).toBe(true);
    await p.stop(slug);
    await until(() => last().status === 'stopped');
  });

  it('edits the plan only during the storyboard review, and passes the edits to post-production', async () => {
    await store.saveBrief(slug, { ...(await store.readBrief(slug)), explainers: false });
    const { p, sent } = make(
      async (p, stage) => {
        if (stage === 'plan') {
          await p.savePlan(slug, { ...PLAN, explainers: [{ after: 's1', idea: 'Request flow' }] });
          done(p, 'plan');
        } else if (stage === 'script') done(p, 'script');
        else if (stage === 'post-production') done(p, 'post');
        else if (stage === 'retro') done(p, 'retro');
      },
      [true, true],
    );
    await expect(
      p.editPlan(slug, [{ op: 'step', id: 's1', field: 'narration', value: 'x' }]),
    ).rejects.toThrow(/storyboard or narration review/);
    await p.start(slug, { storyboard: true });
    await until(() => last().status === 'waiting');
    expect(sent[0]).toContain("Don't propose explainers");
    await p.editPlan(slug, [
      { op: 'step', id: 's2', field: 'narration', value: 'Click Create to finish.' },
      { op: 'explainer', index: 0, idea: 'How a request reaches the service' },
    ]);
    expect(last().plan?.steps[1]?.narration).toBe('Click Create to finish.');
    expect(last().plan?.explainers[0]?.idea).toBe('How a request reaches the service');
    await expect(p.editPlan(slug, [{ op: 'step', id: 's9', field: 'title', value: 'x' }])).rejects.toThrow(
      /no step/,
    );
    await p.approve(slug);
    await until(() => last().status === 'done');
    expect(sent.find((t) => t.includes('[Pipeline · post-production]'))).toContain(
      's2 Create the service: Click Create to finish.',
    );
  });

  it('nudges once when a turn ends without stage_done, then asks the user for help', async () => {
    const { p, sent } = make(() => {}, []);
    await p.start(slug, { storyboard: true });
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
    await p.start(slug, { storyboard: false, narration: false });
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
    await p.start(slug, { storyboard: true });
    await until(() => last().status === 'waiting');
    await p.stop(slug);
  });
});
