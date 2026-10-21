import { z } from 'zod';
import { Seconds, Word } from './schemas';

/**
 * Voice-first recording: the step voice-over is generated before the take, and the recorder
 * paces the script to it. Each step lasts at least its line, and an action with a cue (a word
 * of the step's narration) lands as that word is spoken. Written to `projects/<slug>/pace.json`.
 */
export const StepPace = z.object({
  /** The narration that was voiced, to tell when the pace is out of date. */
  text: z.string(),
  /** Seconds of the line. */
  duration: Seconds,
  /** Word times relative to the line's start (ElevenLabs alignment). */
  words: z.array(Word),
});
export type StepPace = z.infer<typeof StepPace>;

export const Pace = z.object({
  /** Seconds of a step shown before its line starts. */
  leadIn: Seconds,
  /** Lines start at least this long after the previous click, key or typing. */
  clickGap: Seconds,
  /** Silence after a line before the next step starts. */
  tail: Seconds,
  steps: z.record(z.string(), StepPace),
});
export type Pace = z.infer<typeof Pace>;

/** A word reduced for matching: lower case, without surrounding punctuation ("/greeting," → "/greeting"). */
export function cueToken(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}/]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Index of the first word of `cue` (a word or phrase of the narration) at or after word `from`,
 * or -1. Matching ignores case and surrounding punctuation.
 */
export function findCue(words: { w: string }[], cue: string, from = 0): number {
  const want = cue.split(/\s+/).map(cueToken).filter(Boolean);
  if (!want.length) return -1;
  const have = words.map((x) => cueToken(x.w));
  for (let i = Math.max(0, from); i + want.length <= have.length; i++)
    if (want.every((w, j) => have[i + j] === w)) return i;
  return -1;
}

/** Seconds from a step's start to its line's start: the lead-in, or longer right after an action. */
export function lineDelay(pace: Pick<Pace, 'leadIn' | 'clickGap'>, sinceLastAction: number): number {
  return Math.max(pace.leadIn, pace.clickGap - sinceLastAction);
}
