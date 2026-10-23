import { z } from 'zod';

/** A step's length on camera, estimated from a dry run (see the engine's stepTiming). */
export const StepTiming = z.object({
  id: z.string(),
  title: z.string(),
  /** Seconds the step will take when recorded: product time measured in the dry run plus pacing. */
  recorded: z.number(),
  /** Clicks, typed fields and key presses. */
  actions: z.number(),
  /** Product waits of 2 s or more, in order: what came before, and how long. */
  waits: z.array(z.object({ after: z.string(), seconds: z.number() })),
});
export type StepTiming = z.infer<typeof StepTiming>;

/** `.studio/timing.json`: the step timings of the latest passing dry run. */
export const TimingFile = z.object({ at: z.number(), steps: z.array(StepTiming) });
export type TimingFile = z.infer<typeof TimingFile>;
