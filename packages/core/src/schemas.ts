import { z } from 'zod';

/** Seconds, always >= 0. All timeline times are in seconds. */
export const Seconds = z.number().nonnegative();

export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'ids use letters, digits, "_" and "-" only');

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type Rect = z.infer<typeof Rect>;

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

/** A component reference: `core:Zoom`, `workspace:CodeCallout`, `project:RequestFlow`. */
export const ComponentRef = z
  .string()
  .regex(/^(core|workspace|project):[A-Za-z][A-Za-z0-9]*$/, 'component refs look like "core:Zoom"');

// ---------------------------------------------------------------------------
// Takes and segments
// ---------------------------------------------------------------------------

export const Take = z.object({
  id: Id,
  video: z.string().min(1),
  events: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: Seconds,
});
export type Take = z.infer<typeof Take>;

/** Plays take time [from, to) at normal speed. */
export const SrcSegment = z.object({ kind: z.literal('src'), from: Seconds, to: Seconds });
/** Freezes the frame at take time `at` for `duration` seconds. */
export const HoldSegment = z.object({ kind: z.literal('hold'), at: Seconds, duration: Seconds });
/** Plays take time [from, to) at `rate` (1.5 = 50% faster). */
export const SpeedSegment = z.object({
  kind: z.literal('speed'),
  from: Seconds,
  to: Seconds,
  rate: z.number().min(0.25).max(4),
});

export const Segment = z
  .discriminatedUnion('kind', [SrcSegment, HoldSegment, SpeedSegment])
  .refine((s) => s.kind === 'hold' || s.to > s.from, { message: 'segment "to" must be after "from"' });
export type Segment = z.infer<typeof Segment>;

// ---------------------------------------------------------------------------
// Scenes and transitions
// ---------------------------------------------------------------------------

/** When an explainer beat fires: a voice line index, a narration word, or a fixed time. */
export const BeatCue = z.union([
  z.string().regex(/^vo:\d+$/, 'voice cues look like "vo:0"'),
  z.string().regex(/^word:\S+$/, 'word cues look like "word:matches"'),
  Seconds,
]);

export const Beat = z.object({ id: Id, at: BeatCue });
export type Beat = z.infer<typeof Beat>;

export const RecordingScene = z.object({
  id: Id,
  kind: z.literal('recording'),
  take: Id,
  segments: z.array(Segment).min(1),
});

export const ExplainerScene = z.object({
  id: Id,
  kind: z.literal('explainer'),
  component: ComponentRef,
  props: z.record(z.string(), z.unknown()).default({}),
  narration: z.array(z.string()).default([]),
  beats: z.array(Beat).default([]),
  /** Fixed length, or "auto" to follow its voice-over. */
  duration: z.union([Seconds, z.literal('auto')]),
  /** Used while duration is "auto" and no voice-over exists yet. */
  estimatedDuration: Seconds.default(5),
});

export const Scene = z.discriminatedUnion('kind', [RecordingScene, ExplainerScene]);
export type Scene = z.infer<typeof Scene>;
export type RecordingScene = z.infer<typeof RecordingScene>;
export type ExplainerScene = z.infer<typeof ExplainerScene>;

/** Overlaps the end of scene `between[0]` with the start of `between[1]`. */
export const Transition = z.object({
  id: Id,
  between: z.tuple([Id, Id]),
  component: ComponentRef,
  duration: z.number().positive(),
});
export type Transition = z.infer<typeof Transition>;

// ---------------------------------------------------------------------------
// Steps, overlays, voice, captions, annotations
// ---------------------------------------------------------------------------

export const Step = z.object({
  id: Id,
  title: z.string().min(1),
  /** Source range in the take, so steps survive retiming. */
  take: Id,
  from: Seconds,
  to: Seconds,
  narration: z.string().default(''),
  /** Bounding box of the step's primary target in take pixels. */
  bbox: Rect.optional(),
});
export type Step = z.infer<typeof Step>;

export const Anchor = z.object({ stepId: Id, target: z.string().default('primary') });
export type Anchor = z.infer<typeof Anchor>;

export const OverlayInstance = z
  .object({
    id: Id,
    component: ComponentRef,
    start: Seconds,
    end: Seconds,
    layer: z.number().int().default(10),
    anchor: Anchor.optional(),
    rect: Rect.optional(),
    props: z.record(z.string(), z.unknown()).default({}),
    author: z.enum(['user', 'agent', 'auto']).default('user'),
  })
  .refine((o) => o.end > o.start, { message: 'overlay "end" must be after "start"' });
export type OverlayInstance = z.infer<typeof OverlayInstance>;

export const Word = z.object({ w: z.string(), start: Seconds, end: Seconds });

export const VoiceLine = z.object({
  id: Id,
  /** The step or explainer scene this line narrates. */
  owner: Id,
  text: z.string(),
  audio: z.string().optional(),
  start: Seconds,
  duration: Seconds,
  words: z.array(Word).default([]),
});
export type VoiceLine = z.infer<typeof VoiceLine>;

export const Caption = z.object({
  id: Id,
  start: Seconds,
  end: Seconds,
  /** One or two lines, separated by "\n". */
  text: z.string(),
  /** Edited by hand: rebuilding the captions keeps it. */
  edited: z.boolean().optional(),
});
export type Caption = z.infer<typeof Caption>;

export const Annotation = z.object({
  id: Id,
  t: Seconds,
  shape: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('point'), x: z.number(), y: z.number() }),
    z.object({ kind: z.literal('rect'), x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ]),
  comment: z.string(),
  status: z.enum(['open', 'sent', 'resolved']).default('open'),
  runId: z.string().optional(),
});
export type Annotation = z.infer<typeof Annotation>;

// ---------------------------------------------------------------------------
// Timeline and project
// ---------------------------------------------------------------------------

export const Timeline = z
  .object({
    version: z.literal(1),
    fps: z.number().positive().default(30),
    size: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .default({ w: 1920, h: 1080 }),
    takes: z.array(Take).default([]),
    scenes: z.array(Scene).default([]),
    transitions: z.array(Transition).default([]),
    steps: z.array(Step).default([]),
    overlays: z.array(OverlayInstance).default([]),
    voice: z.array(VoiceLine).default([]),
    captions: z.array(Caption).default([]),
    annotations: z.array(Annotation).default([]),
  })
  .superRefine((tl, ctx) => {
    const unique = (items: { id: string }[], what: string) => {
      const seen = new Set<string>();
      for (const it of items) {
        if (seen.has(it.id)) ctx.addIssue({ code: 'custom', message: `duplicate ${what} id "${it.id}"` });
        seen.add(it.id);
      }
    };
    unique(tl.takes, 'take');
    unique(tl.scenes, 'scene');
    unique(tl.overlays, 'overlay');
    unique(tl.steps, 'step');

    const takeIds = new Set(tl.takes.map((t) => t.id));
    for (const s of tl.scenes) {
      if (s.kind === 'recording' && !takeIds.has(s.take))
        ctx.addIssue({ code: 'custom', message: `scene "${s.id}" uses unknown take "${s.take}"` });
    }
    const sceneOrder = tl.scenes.map((s) => s.id);
    for (const tr of tl.transitions) {
      const a = sceneOrder.indexOf(tr.between[0]);
      const b = sceneOrder.indexOf(tr.between[1]);
      if (a < 0 || b < 0 || b !== a + 1)
        ctx.addIssue({
          code: 'custom',
          message: `transition "${tr.id}" must join two adjacent scenes (got ${tr.between.join(' → ')})`,
        });
    }
    const stepIds = new Set(tl.steps.map((s) => s.id));
    for (const o of tl.overlays) {
      if (o.anchor && !stepIds.has(o.anchor.stepId))
        ctx.addIssue({
          code: 'custom',
          message: `overlay "${o.id}" anchors to unknown step "${o.anchor.stepId}"`,
        });
    }
  });
export type Timeline = z.infer<typeof Timeline>;

export const ProjectStatus = z.enum(['draft', 'storyboard', 'recording', 'edit', 'exported']);

export const Project = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'slugs use lowercase letters, digits and "-"'),
  title: z.string().min(1),
  product: z.string().min(1),
  status: ProjectStatus.default('draft'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

// ---------------------------------------------------------------------------
// Recorder events (one JSON object per line in events.jsonl)
// ---------------------------------------------------------------------------

const ev = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({ kind: z.literal(kind), t: Seconds, ...shape });

/**
 * Recorder events. `t` is seconds since the run started. Coordinates and boxes are in
 * frame pixels (CSS pixels × device scale), so they line up with the recorded video.
 */
export const RecorderEvent = z.discriminatedUnion('kind', [
  ev('marker', { name: z.string(), data: z.record(z.string(), z.unknown()).optional() }),
  ev('step-start', { stepId: Id, title: z.string() }),
  ev('step-end', { stepId: Id }),
  ev('mouse', { points: z.array(z.tuple([Seconds, z.number(), z.number()])) }),
  ev('click', { stepId: Id, x: z.number(), y: z.number(), target: z.string(), bbox: Rect }),
  ev('type', { stepId: Id, text: z.string(), target: z.string(), bbox: Rect }),
  ev('key', { stepId: Id, key: z.string() }),
  ev('mask', { label: z.string(), bbox: Rect }),
  ev('hold', { stepId: Id, duration: Seconds }),
]);
export type RecorderEvent = z.infer<typeof RecorderEvent>;

/** Parses a timeline, filling defaults. Throws a readable error on failure. */
export function parseTimeline(input: unknown): Timeline {
  const r = Timeline.safeParse(input);
  if (!r.success) throw new TimelineError(formatIssues(r.error));
  return r.data;
}

export class TimelineError extends Error {
  override name = 'TimelineError';
}

export function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('\n');
}
