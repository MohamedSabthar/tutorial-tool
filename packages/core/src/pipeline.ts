import { z } from 'zod';

/**
 * The production pipeline of one tutorial. The engine runs it as a stage machine; agent stages
 * end when the agent calls `stage_done`, engine stages (dry run, record) when the run finishes,
 * and gates when the user approves or asks for a revision.
 */
export const PipelineStage = z.enum([
  'plan',
  'storyboard_gate',
  'script',
  'dry_run',
  'repair',
  'narrate',
  'voice',
  'align',
  'record',
  'post',
  'qa',
  'retro',
]);
export type PipelineStage = z.infer<typeof PipelineStage>;

export const PIPELINE_STAGES: { stage: PipelineStage; label: string }[] = [
  { stage: 'plan', label: 'Research and plan' },
  { stage: 'storyboard_gate', label: 'Plan review' },
  { stage: 'script', label: 'Write the script' },
  { stage: 'dry_run', label: 'Dry run' },
  { stage: 'repair', label: 'Repair' },
  { stage: 'narrate', label: 'Narration and storyboard review' },
  { stage: 'voice', label: 'Voice-over' },
  { stage: 'align', label: 'Align to the voice' },
  { stage: 'record', label: 'Record the take' },
  { stage: 'post', label: 'Post-production' },
  { stage: 'qa', label: 'Final QA' },
  { stage: 'retro', label: 'Retrospective' },
];

export const PlanStep = z.object({
  id: z.string().regex(/^s\d+$/, 'step ids are s1, s2, …'),
  title: z.string().min(1).max(120),
  /** What happens on screen, one or two sentences. */
  action: z.string().max(400).default(''),
  /** Draft narration for the step. */
  narration: z.string().max(600).default(''),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const ProposedExplainer = z.object({
  /** Step id it follows (or "start"). */
  after: z.string(),
  idea: z.string().min(1).max(400),
});

export const Plan = z.object({
  summary: z.string().max(600).default(''),
  steps: z.array(PlanStep).min(1).max(20),
  explainers: z.array(ProposedExplainer).max(5).default([]),
});
export type Plan = z.infer<typeof Plan>;

export const PipelineStatus = z.enum(['idle', 'running', 'waiting', 'done', 'failed', 'stopped']);
export type PipelineStatus = z.infer<typeof PipelineStatus>;

export const StageRecord = z.object({
  stage: PipelineStage,
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  ok: z.boolean().nullable(),
  summary: z.string().default(''),
});
export type StageRecord = z.infer<typeof StageRecord>;

export const Gate = z.object({
  /** The stage that is waiting. */
  stage: PipelineStage,
  kind: z.enum(['storyboard', 'narration', 'help', 'knowledge']),
  title: z.string(),
  text: z.string(),
  /** For knowledge gates: the uncommitted changes to CLAUDE.md and skills (unified diff). */
  diff: z.string().optional(),
  /** Project-relative picture for the user (a failed run's screenshot). */
  image: z.string().optional(),
});
export type Gate = z.infer<typeof Gate>;

/** What a running stage is working through, item by item (lines being voiced, post steps). */
export const ProgressItem = z.object({
  id: z.string(),
  label: z.string(),
  /** A short result or state, e.g. "6.2 s · cached". */
  detail: z.string().default(''),
  state: z.enum(['pending', 'active', 'done', 'failed']),
  /** Project-relative audio to play back (a voiced line). */
  audio: z.string().optional(),
  /** Project-relative picture shown with it (a step still, a failure screenshot, a QA sheet). */
  image: z.string().optional(),
});
export type ProgressItem = z.infer<typeof ProgressItem>;

export const PipelineProgress = z.object({
  slug: z.string(),
  stage: PipelineStage,
  /** One plain sentence on what is happening now, e.g. "Voicing line 3 of 6". */
  message: z.string(),
  items: z.array(ProgressItem).default([]),
  /** Changes when the pictures do, so windows don't show a cached one. */
  version: z.number().optional(),
});
export type PipelineProgress = z.infer<typeof PipelineProgress>;

export const PipelineGates = z.object({
  /** Stop after planning so the user can review the steps before the script (optional, off by default). */
  storyboard: z.boolean().default(false),
  /** Stop after the final narration so the user can review and tune it before the voice-over. */
  narration: z.boolean().default(true),
});

export const PipelineState = z.object({
  slug: z.string(),
  status: PipelineStatus,
  stage: PipelineStage.nullable(),
  runId: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  gates: PipelineGates.default({ storyboard: false, narration: true }),
  gate: Gate.nullable(),
  plan: Plan.nullable(),
  history: z.array(StageRecord).default([]),
  repairAttempts: z.number().int().default(0),
  /** The script has its final narration and cues, and pace.json is voiced: record paced to it. */
  paced: z.boolean().default(false),
  maxRepairs: z.number().int().default(1),
  /** Agent cost when this run started, so the UI can show the run's own cost. */
  costAtStart: z.number().default(0),
  /** The engine was reloaded mid-stage (dev): the next engine resumes the run by itself. */
  resumeOnStart: z.boolean().default(false),
  /** The last automatic resume after a reload: which stage, and when (so reloads can't loop it). */
  autoResumed: z.object({ stage: PipelineStage, at: z.number() }).nullable().default(null),
  error: z.string().nullable(),
});
export type PipelineState = z.infer<typeof PipelineState>;

export function idlePipeline(slug: string): PipelineState {
  return PipelineState.parse({
    slug,
    status: 'idle',
    stage: null,
    runId: null,
    startedAt: null,
    endedAt: null,
    gate: null,
    plan: null,
    error: null,
  });
}
