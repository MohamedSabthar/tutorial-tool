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
  'record',
  'post',
  'retro',
]);
export type PipelineStage = z.infer<typeof PipelineStage>;

export const PIPELINE_STAGES: { stage: PipelineStage; label: string }[] = [
  { stage: 'plan', label: 'Plan the steps' },
  { stage: 'storyboard_gate', label: 'Storyboard review' },
  { stage: 'script', label: 'Write the script' },
  { stage: 'dry_run', label: 'Dry run' },
  { stage: 'repair', label: 'Repair' },
  { stage: 'record', label: 'Record the take' },
  { stage: 'post', label: 'Post-production' },
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
  kind: z.enum(['storyboard', 'help']),
  title: z.string(),
  text: z.string(),
});
export type Gate = z.infer<typeof Gate>;

export const PipelineGates = z.object({
  /** Stop after planning so the user can review the steps before anything runs. */
  storyboard: z.boolean().default(true),
});

export const PipelineState = z.object({
  slug: z.string(),
  status: PipelineStatus,
  stage: PipelineStage.nullable(),
  runId: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  gates: PipelineGates.default({ storyboard: true }),
  gate: Gate.nullable(),
  plan: Plan.nullable(),
  history: z.array(StageRecord).default([]),
  repairAttempts: z.number().int().default(0),
  maxRepairs: z.number().int().default(3),
  /** Agent cost when this run started, so the UI can show the run's own cost. */
  costAtStart: z.number().default(0),
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
