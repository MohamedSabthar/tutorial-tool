import { z } from 'zod';

/**
 * The tutorial brief the user fills in before the agent plans: saved as
 * `projects/<slug>/brief.json` and rendered into the project's CLAUDE.md for the agent.
 */
export const BRIEF_AUDIENCES = [
  {
    value: 'new',
    label: 'New to WSO2',
    text: 'People new to WSO2: explain each term the first time it appears.',
  },
  {
    value: 'developer',
    label: 'Developer',
    text: 'Developers who know HTTP and VS Code but not this product.',
  },
  {
    value: 'architect',
    label: 'Architect',
    text: 'Architects: favour the why and the big picture over each click.',
  },
] as const;
export const BRIEF_LENGTHS = [
  { value: 'short', label: '~1 min', text: 'About 1 minute.', seconds: [45, 75] },
  { value: 'medium', label: '2–3 min', text: '2–3 minutes.', seconds: [120, 180] },
  { value: 'long', label: '5+ min', text: '5 minutes or more.', seconds: [300, 480] },
] as const;
export const BRIEF_STYLES = [
  {
    value: 'steps',
    label: 'Step by step',
    text: 'Step by step: every action on screen, narrated as it happens.',
  },
  {
    value: 'concept',
    label: 'Concept first',
    text: 'Concept first: open with what it is and why, then do it.',
  },
  { value: 'demo', label: 'Quick demo', text: 'Quick demo: the shortest path to a working result.' },
] as const;
/** Starting points the recorder can build (script fixtures). */
export const BRIEF_WORKSPACES = [
  {
    value: 'bi-integration',
    label: 'Empty integration project',
    text: 'An empty BI project with one integration (the default fixture: greeting-project / greeting_service).',
  },
] as const;

type Values<T extends readonly { value: string }[]> = [T[number]['value'], ...T[number]['value'][]];
const values = <T extends readonly { value: string }[]>(list: T) => list.map((o) => o.value) as Values<T>;

export const BriefReference = z.discriminatedUnion('kind', [
  /** A file copied into the project's references/ folder. */
  z.object({ kind: z.literal('file'), name: z.string().min(1), path: z.string().min(1) }),
  z.object({ kind: z.literal('url'), url: z.url() }),
]);
export type BriefReference = z.infer<typeof BriefReference>;

export const BriefGates = z.object({
  /** Review the planned steps before the script is written (the storyboard review comes later). */
  storyboard: z.boolean().default(false),
  /** Review the final narration before the voice-over. */
  narration: z.boolean().default(true),
  recording: z.boolean().default(false),
  export: z.boolean().default(true),
});

export const Brief = z.object({
  goal: z.string().max(2000).default(''),
  workspace: z.enum(values(BRIEF_WORKSPACES)).default('bi-integration'),
  audience: z.enum(values(BRIEF_AUDIENCES)).default('developer'),
  length: z.enum(values(BRIEF_LENGTHS)).default('medium'),
  style: z.enum(values(BRIEF_STYLES)).default('steps'),
  /** ElevenLabs voice id; null until voices are available (4.1). */
  voice: z.string().nullable().default(null),
  explainers: z.boolean().default(true),
  /** Claude Code's auto mode: a safety classifier approves tool calls and asks only when unsure. */
  autoMode: z.boolean().default(true),
  gates: BriefGates.default({ storyboard: false, narration: true, recording: false, export: true }),
  notes: z.string().max(4000).default(''),
  references: z.array(BriefReference).max(30).default([]),
});
export type Brief = z.infer<typeof Brief>;

/** A project title from the goal: its first sentence, at most 60 characters. */
export function briefTitle(goal: string): string {
  const first =
    goal
      .trim()
      .split(/(?<=[.!?])\s|\n/)[0]
      ?.replace(/[.!?]+$/, '') ?? '';
  if (first.length <= 60) return first || 'Untitled tutorial';
  const cut = first.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

/** Edits to a saved plan from the storyboard (validated like timeline patches). */
export const PlanEdit = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('step'),
    id: z.string(),
    field: z.enum(['title', 'action', 'narration']),
    value: z.string().max(600),
  }),
  z.object({ op: z.literal('explainer'), index: z.number().int().min(0), idea: z.string().min(1).max(400) }),
]);
export type PlanEdit = z.infer<typeof PlanEdit>;

/** Rough spoken length of narration at ~150 words per minute. */
export const narrationSeconds = (text: string) => {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / 2.5;
};
