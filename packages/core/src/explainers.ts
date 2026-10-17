import { z } from 'zod';

/** One beat of an explainer storyboard: what is said and what is shown. */
export const StoryboardBeat = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'beat ids are lowercase words, e.g. "listener"'),
  narration: z.string().min(1).max(300),
  /** What is on screen during the beat, in a sentence. */
  visual: z.string().max(300).default(''),
});
export type StoryboardBeat = z.infer<typeof StoryboardBeat>;

export const Storyboard = z.object({
  title: z.string().min(1).max(120),
  /** How the scene will be built, e.g. "core:DiagramFlow with four nodes". */
  approach: z.string().max(400).default(''),
  beats: z.array(StoryboardBeat).min(1).max(8),
});
export type Storyboard = z.infer<typeof Storyboard>;

/**
 * An explainer being made with the agent: inserted (placeholder scene), storyboarded (beats with
 * rough frames, waiting for the user), built (scene, voice-over, transitions), done.
 */
export const ExplainerJob = z.object({
  /** The explainer scene's id in the timeline. */
  sceneId: z.string(),
  brief: z.string(),
  status: z.enum(['storyboarding', 'review', 'building', 'done', 'cancelled']),
  storyboard: Storyboard.nullable().default(null),
  /** Beat id → project-relative PNG of a rough frame (from check_scene). */
  frames: z.record(z.string(), z.string()).default({}),
  feedback: z.string().default(''),
  summary: z.string().default(''),
  createdAt: z.number(),
});
export type ExplainerJob = z.infer<typeof ExplainerJob>;
