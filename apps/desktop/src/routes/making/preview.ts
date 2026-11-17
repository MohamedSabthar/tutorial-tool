import type {
  AgentEvent,
  Gate,
  PipelineProgress,
  PipelineStage,
  PipelineState,
  Plan,
  StageRecord,
} from '@studio/core';
import type { MakingModel } from './model';

/**
 * Dev-only sample runs for the Making screen (`#/making/<slug>?preview=<state>`), so every state
 * can be looked at without running a pipeline. The tutorial's title and pictures stay real.
 */
export const PREVIEW_STATES = [
  'planning',
  'testing',
  'permission',
  'script',
  'steps',
  'cues',
  'help',
  'knowledge',
  'recording',
  'failed',
  'stopped',
  'done',
] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export const isPreviewState = (s: string | null): s is PreviewState =>
  !!s && (PREVIEW_STATES as readonly string[]).includes(s);

const MIN = 60_000;

const PLAN: Plan = {
  summary: 'Build a math tutor chat agent in WSO2 Integrator and test it in Agent Chat.',
  steps: [
    {
      id: 's1',
      title: 'Open the Chat Agent Service form',
      action: 'Click Add Artifact, then Chat Agent Service under AI Integration.',
      narration:
        'You start from an empty integration. Click Add Artifact, then pick Chat Agent Service under AI Integration.',
    },
    {
      id: 's2',
      title: 'Give the agent a math tutor role',
      action: 'Type the role and the instructions.',
      narration:
        'Name the service math-tutor and give the agent its role: a patient tutor that explains every step of the answer.',
    },
    {
      id: 's3',
      title: 'Create the chat agent',
      action: 'Click Create.',
      narration: 'Click Create. The agent, its model and an empty tool list appear on the canvas.',
    },
    {
      id: 's4',
      title: 'Add a sum tool',
      action: 'Add a custom tool with two float parameters.',
      narration:
        'Now give it something to do. Add a tool called sum that takes two numbers and returns their total.',
    },
    {
      id: 's5',
      title: 'Turn on tracing and run it',
      action: 'Turn tracing on and run the integration.',
      narration: 'Turn on tracing so you can see each call, then run the integration.',
    },
    {
      id: 's6',
      title: 'Ask the tutor a question',
      action: 'Ask what 12 plus 8 is in Agent Chat.',
      narration:
        'Ask it what twelve plus eight is. It calls the sum tool and explains the answer step by step.',
    },
  ],
  explainers: [
    { after: 's3', idea: 'How a chat agent works: the model decides, the tools act, the loop repeats.' },
  ],
};

const rec = (
  stage: PipelineStage,
  start: number,
  mins: number,
  ok: boolean | null,
  summary = '',
): StageRecord => ({
  stage,
  startedAt: start,
  endedAt: ok === null ? null : start + mins * MIN,
  ok,
  summary,
});

/** History up to (not including) a stage, timed back from now. */
function historyBefore(stage: PipelineStage, now: number, paced = true): StageRecord[] {
  const all: [PipelineStage, number, boolean, string][] = [
    ['plan', 4.2, true, 'Saved a 6-step plan with 1 explainer from the wso2-integrator skill.'],
    ['script', 2.6, true, 'Wrote script.spec.ts for s1–s6 from the skill’s page objects.'],
    ['dry_run', 3.4, false, 's4: locator.waitFor: Timeout 15000ms exceeded.'],
    ['repair', 2.1, true, 'The + button moved into the agent menu; the script now opens the menu first.'],
    ['dry_run', 3.1, true, '6 steps passed'],
    ['narrate', 2.4, true, 'Wrote narration for s1–s6, sized to the dry-run times.'],
    ['voice', 0.8, true, 'Voiced 6 lines (74.2 s) to pace the take'],
    ['align', 1.6, true, 'Fitted the cues to the word timings.'],
    ['dry_run', 2.9, true, '6 steps passed, cues checked'],
    ['record', 5.8, true, 'Recorded take-1 (96.4 s) · 14 of 17 cues on time'],
    ['post', 3.2, true, 'Final narration on the steps · added the explainer after s3.'],
    ['qa', 1.7, true, 'Checked all 38 frames; nothing to fix.'],
    ['retro', 0.6, true, 'Added two lessons to the product skill.'],
  ];
  const order = all.map((a) => a[0]);
  // The first occurrence of `stage` after the plan (dry_run's first run is the failing one).
  let end = stage === 'storyboard_gate' ? 1 : order.indexOf(stage, stage === 'dry_run' ? 4 : 0);
  if (end < 0) end = all.length;
  const take = all.slice(0, end).filter(([s]) => paced || (s !== 'voice' && s !== 'align'));
  const total = take.reduce((n, a) => n + a[1], 0) + 1.5;
  let t = now - total * MIN;
  return take.map(([s, mins, ok, summary]) => {
    const r = rec(s, t, mins, ok, summary);
    t += mins * MIN + 3000;
    return r;
  });
}

function state(over: Partial<PipelineState>, now: number): PipelineState {
  const history = over.history ?? [];
  return {
    slug: 'preview',
    status: 'running',
    stage: 'plan',
    runId: 'preview',
    startedAt: history[0]?.startedAt ?? now - 40_000,
    endedAt: null,
    gates: { storyboard: false, narration: true, lateCues: 'ask' },
    entry: 'plan',
    gate: null,
    plan: PLAN,
    history,
    repairAttempts: 0,
    paced: true,
    maxRepairs: 1,
    costAtStart: 3.1,
    resumeOnStart: false,
    autoResumed: null,
    error: null,
    ...over,
  };
}

/** Running at `stage`, started `minsAgo` ago, after everything before it. */
function running(
  stage: PipelineStage,
  minsAgo: number,
  now: number,
  over: Partial<PipelineState> = {},
): PipelineState {
  const history = [...historyBefore(stage, now - minsAgo * MIN), rec(stage, now - minsAgo * MIN, 0, null)];
  return state({ stage, history, ...over }, now);
}

function waiting(
  stage: PipelineStage,
  gate: Gate,
  now: number,
  over: Partial<PipelineState> = {},
): PipelineState {
  return state(
    {
      status: 'waiting',
      stage,
      gate,
      history: [...historyBefore(stage, now), rec(stage, now - 0.4 * MIN, 0, null)],
      ...over,
    },
    now,
  );
}

let seq = 0;
const ev = (e: Record<string, unknown>, at: number) =>
  ({ slug: 'preview', seq: ++seq, at, ...e }) as AgentEvent;

/** Agent events spread over the history: a session, tool calls, turn costs. */
function events(st: PipelineState, extra: AgentEvent[] = []): AgentEvent[] {
  seq = 0;
  const out: AgentEvent[] = [];
  const t0 = st.history[0]?.startedAt ?? st.startedAt ?? 0;
  out.push(
    ev(
      {
        kind: 'init',
        sessionId: '7f3c2a91-5d0e-4c8b-9a77-2e1f0b6d4c11',
        model: 'claude-opus',
        cwd: '/workspace',
        tools: [],
        skills: [],
        mcpServers: [],
        permissionMode: 'default',
        resumed: false,
      },
      t0 + 500,
    ),
  );
  const tools: Record<string, [string, string][]> = {
    plan: [
      ['Read', 'skills/wso2-integrator/SKILL.md'],
      ['mcp__studio__inspect_ui', 'Add Artifact catalogue'],
      ['mcp__studio__save_plan', '6 steps · 1 explainer'],
    ],
    script: [['Write', 'script.spec.ts']],
    dry_run: [['mcp__studio__run_script', 'dry run · s1–s6']],
    repair: [
      ['mcp__studio__inspect_ui', 'agent view · tools menu'],
      ['Edit', 'script.spec.ts'],
    ],
    narrate: [['mcp__studio__save_plan', 'narration for s1–s6']],
    post: [
      ['mcp__studio__fit_timing', 'voice-over · 6 lines'],
      ['mcp__studio__add_scene', 'explainer after s3'],
    ],
    qa: [['mcp__studio__check_video', '38 frames']],
  };
  let cost = st.costAtStart;
  for (const r of st.history) {
    const list = tools[r.stage] ?? [];
    const end = r.endedAt ?? Date.now();
    list.forEach(([name, summary], i) =>
      out.push(
        ev(
          { kind: 'tool_use', id: `t${seq}`, name, summary, input: {} },
          r.startedAt + ((end - r.startedAt) * (i + 1)) / (list.length + 2),
        ),
      ),
    );
    if (r.endedAt) {
      cost += 0.18;
      out.push(
        ev(
          {
            kind: 'result',
            ok: true,
            subtype: 'success',
            turns: 4,
            durationMs: end - r.startedAt,
            costUsd: cost,
            text: '',
          },
          end - 200,
        ),
      );
    }
  }
  return [...out, ...extra].sort((a, b) => a.at - b.at);
}

const SAMPLE_FRAME = '.studio/shots/s3.jpg';

/** The base model with the sample run for `kind` laid over it. */
export function previewModel(base: MakingModel, kind: PreviewState, now = Date.now()): MakingModel {
  let st: PipelineState;
  let progress: PipelineProgress | null = null;
  let extra: AgentEvent[] = [];
  let pending: MakingModel['pending'] = [];
  let live = base.live;
  const frame = (mode: 'dry' | 'record') => ({
    session: {
      state: 'started' as const,
      title: base.title,
      mode,
      frame: { width: 1600, height: 1000 },
      slug: base.slug,
    },
    frame: base.media(SAMPLE_FRAME),
    frameAt: now,
    pointer: { x: 620, y: 410, clickAt: 0 },
    action: {
      stepId: 's3',
      kind: 'click' as const,
      label: 'Create',
      bbox: { x: 560, y: 380, w: 120, h: 40 },
    },
  });

  switch (kind) {
    case 'planning':
      st = running('plan', 1.2, now, { plan: null });
      progress = null;
      break;
    case 'testing':
      st = running('dry_run', 1.8, now);
      progress = {
        slug: base.slug,
        stage: 'dry_run',
        message: 'Trying step 3 of 6: Create the chat agent',
        items: PLAN.steps.map((s, i) => ({
          id: s.id,
          label: s.title,
          detail: '',
          state: i < 2 ? 'done' : i === 2 ? 'active' : 'pending',
        })),
      };
      live = frame('dry');
      break;
    case 'permission':
      st = running('repair', 0.9, now);
      live = frame('dry');
      pending = [
        {
          slug: base.slug,
          seq: 900,
          at: now - 20_000,
          kind: 'permission',
          requestId: 'req-1',
          tool: 'Bash',
          summary: 'npm install mathjs',
          input: { command: 'npm install mathjs' },
          reason: 'Step 4 calls an external math library; it installs it before testing the step.',
        },
      ];
      extra = [pending[0]!];
      break;
    case 'script':
      st = waiting(
        'narrate',
        {
          stage: 'narrate',
          kind: 'narration',
          title: 'Review the narration before the voice-over',
          text: '6 lines, about 74 s of speech.',
        },
        now,
      );
      break;
    case 'steps':
      st = waiting(
        'storyboard_gate',
        {
          stage: 'storyboard_gate',
          kind: 'storyboard',
          title: 'Review the storyboard',
          text: '6 steps planned.',
        },
        now,
        {
          gates: { storyboard: true, narration: true, lateCues: 'ask' },
          plan: { ...PLAN, steps: PLAN.steps.map((s) => ({ ...s, narration: '' })) },
        },
      );
      break;
    case 'cues':
      st = waiting(
        'record',
        {
          stage: 'record',
          kind: 'cues',
          title: '3 clicks landed after their words',
          text: '',
          choices: [
            { id: 'edit', label: 'Fix in the edit' },
            { id: 'retake', label: 'Record again' },
          ],
          remember: true,
          cues: [
            { stepId: 's2', word: 'role', late: 1.4, after: 'the step start', gap: 3.2, rate: 1.8, left: 0 },
            { stepId: 's4', word: 'sum', late: 0.9, after: 'Add Tool', gap: 2.1, rate: 1.6, left: 0.05 },
            { stepId: 's5', word: 'run', late: 2.6, after: 'Tracing', gap: 0.4, rate: null, left: 2.6 },
          ],
        },
        now,
      );
      break;
    case 'help':
      st = waiting(
        'repair',
        {
          stage: 'repair',
          kind: 'help',
          title: 'The agent needs your help at s4',
          text: 'The dry run failed at s4: locator.waitFor: Timeout 15000ms exceeded.\n\nAfter 1 repair, the agent says: the + button is no longer in the agent view. It may need a newer build of the product.\n\nReply with a suggestion and the agent tries again with it, or choose Try again to let it try once more on its own.',
        },
        now,
      );
      live = { ...frame('dry'), session: { ...frame('dry').session, state: 'stopped' } };
      break;
    case 'knowledge':
      st = waiting(
        'retro',
        {
          stage: 'retro',
          kind: 'knowledge',
          title: 'Review what the agent learned',
          text: 'Added two lessons: the + button for tools now lives in the agent menu, and takes run about 30% longer than the dry run.',
          diff: '--- a/skills/wso2-integrator/SKILL.md\n+++ b/skills/wso2-integrator/SKILL.md\n@@ -41,6 +41,8 @@\n ## Agents\n+- Tools: the + button moved into the agent menu (Add New Tool / MCP Server).\n+- Takes run 25–35% longer than the dry run; plan the length on the take.\n',
        },
        now,
      );
      break;
    case 'recording':
      st = running('record', 2.3, now);
      progress = {
        slug: base.slug,
        stage: 'record',
        message: 'Recording step 4 of 6, in time with the voice-over',
        items: PLAN.steps.map((s, i) => ({
          id: s.id,
          label: s.title,
          detail: i < 3 ? 'on time' : '',
          state: i < 3 ? 'done' : i === 3 ? 'active' : 'pending',
        })),
      };
      live = frame('record');
      break;
    case 'failed':
      st = state(
        {
          status: 'failed',
          stage: 'dry_run',
          endedAt: now - 30_000,
          history: [
            ...historyBefore('dry_run', now),
            rec('dry_run', now - 3 * MIN, 2.5, false, 's4: locator.waitFor: Timeout 15000ms exceeded.'),
          ],
          error:
            "s4: locator.waitFor: Timeout 15000ms exceeded.\n  waiting for getByRole('button', { name: 'Add New Tool' })",
        },
        now,
      );
      break;
    case 'stopped':
      st = state(
        {
          status: 'stopped',
          stage: 'record',
          endedAt: now - 30_000,
          history: [
            ...historyBefore('record', now),
            rec('record', now - 2 * MIN, 1.5, false, 'Stopped by user'),
          ],
          error: 'Stopped by user',
        },
        now,
      );
      break;
    case 'done': {
      const history = historyBefore('retro' as PipelineStage, now).concat(
        rec('retro', now - 1.2 * MIN, 0.6, true, 'Added two lessons.'),
      );
      st = state({ status: 'done', stage: null, endedAt: now - 30_000, history }, now);
      break;
    }
  }
  st = { ...st, slug: base.slug };
  const cost = st.costAtStart + 0.18 * st.history.filter((h) => h.endedAt).length;
  return {
    ...base,
    preview: true,
    state: st,
    progress,
    events: events(st, extra),
    agent: {
      slug: base.slug,
      state: st.status === 'running' ? 'busy' : 'idle',
      sessionId: '7f3c2a91-5d0e-4c8b-9a77-2e1f0b6d4c11',
      model: 'claude-opus',
      costUsd: cost,
      pending: pending.map((p) => p.requestId),
    },
    pending,
    live,
    duration: kind === 'done' ? (base.duration ?? 214) : base.duration,
    autoMode: kind === 'permission' ? false : base.autoMode,
    ready: true,
  };
}
