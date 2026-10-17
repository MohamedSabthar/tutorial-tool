import { z } from 'zod';

/**
 * An agent run: one turn from a user message or annotations that changed something, with git
 * snapshots of the project before and after, so it can be reviewed and reverted.
 */
export const RunStatus = z.enum(['running', 'review', 'accepted', 'reopened', 'reverted', 'empty']);
export type RunStatus = z.infer<typeof RunStatus>;

export const Run = z.object({
  n: z.number().int().positive(),
  /** The session's undo group for this turn's timeline patches. */
  runId: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  prompt: z.string(),
  annotationIds: z.array(z.string()).default([]),
  /** Snapshot commits on the workspace branch runs/<slug>. */
  before: z.string(),
  after: z.string().nullable(),
  summary: z.string().default(''),
  costUsd: z.number().default(0),
  durationMs: z.number().default(0),
  /** First lines of each check_overlay result in the turn ("✓ …" / "✗ …"). */
  checks: z.array(z.string()).default([]),
  files: z.array(z.object({ path: z.string(), added: z.number(), removed: z.number() })).default([]),
  /** Readable timeline changes ("Added overlay callout-1 (core:Callout) 6.7–9.6 s"). */
  timeline: z.array(z.string()).default([]),
  status: RunStatus,
  /** Annotation id → project-relative PNG paths rendered at its time before and after the run. */
  frames: z
    .record(z.string(), z.object({ before: z.string().optional(), after: z.string().optional() }))
    .default({}),
  /** Why frames are missing, if they are. */
  framesNote: z.string().optional(),
});
export type Run = z.infer<typeof Run>;
