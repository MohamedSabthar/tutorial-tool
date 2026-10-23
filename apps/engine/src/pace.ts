import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pace, RpcError, type Pronunciation, type RecorderEvent, type StepPace } from '@studio/core';
import { voiceLine } from './pronunciations';
import type { ProjectStore } from './projects';
import type { TtsService } from './tts';
import { CLICK_GAP, TAIL } from './timing';
import { LEAD_IN } from './vo';

/** The voiced narration a paced take is recorded against (voice-first recording). */
export const PACE_FILE = 'pace.json';

/** A cue this late or early counts as missed in the run summary. */
export const CUE_TOLERANCE = 0.15;

export async function readPace(projectDir: string): Promise<Pace | null> {
  const text = await readFile(path.join(projectDir, PACE_FILE), 'utf8').catch(() => null);
  if (text === null) return null;
  const r = Pace.safeParse(JSON.parse(text));
  return r.success ? r.data : null;
}

export async function clearPace(projectDir: string): Promise<void> {
  await rm(path.join(projectDir, PACE_FILE), { force: true });
}

/**
 * Voices each step's narration before recording and writes pace.json. The requests match the
 * ones the post-production voice-over makes for the same narration (text, voice, neighbours), so
 * those come from the cache and the recorded pace is the audio that ends up on the timeline.
 */
export async function voicePace(
  deps: {
    store: ProjectStore;
    tts: Pick<TtsService, 'synthesize'>;
    pronunciations?: () => Promise<Pronunciation[]>;
  },
  slug: string,
  steps: { id: string; narration: string }[],
): Promise<{ pace: Pace; lines: number; seconds: number }> {
  const voiceId = await deps.store.voiceFor(slug);
  if (!voiceId) throw new RpcError('Choose a voice in the brief first.', 'bad_request');
  const narrated = steps.filter((s) => s.narration.trim());
  const rules = (await deps.pronunciations?.().catch(() => [])) ?? [];
  const out: Record<string, StepPace> = {};
  let seconds = 0;
  for (const [i, step] of narrated.entries()) {
    const text = step.narration.trim();
    // Trimmed, as the steps get it (see the pipeline's voiceover), so the requests are the same.
    const prev = narrated[i - 1]?.narration.trim();
    const next = narrated[i + 1]?.narration.trim();
    const { words, ...req } = voiceLine(text, rules, { prev, next });
    const r = await deps.tts.synthesize(slug, { ...req, voiceId });
    out[step.id] = { text, duration: Math.round(r.duration * 1000) / 1000, words: words(r.alignment) };
    seconds += r.duration;
  }
  const pace = Pace.parse({ leadIn: LEAD_IN, clickGap: CLICK_GAP, tail: TAIL, steps: out });
  await writeFile(path.join(deps.store.dir(slug), PACE_FILE), JSON.stringify(pace, null, 2) + '\n');
  return { pace, lines: narrated.length, seconds: Math.round(seconds * 10) / 10 };
}

/** How close a paced take's actions came to their cue words. */
export function cueDrift(events: RecorderEvent[]): { cues: number; off: number; maxOff: number } {
  const offs = events.flatMap((e) =>
    (e.kind === 'click' || e.kind === 'key') && e.cue ? [Math.abs(e.t - e.cue.at)] : [],
  );
  return {
    cues: offs.length,
    off: offs.filter((d) => d > CUE_TOLERANCE).length,
    maxOff: Math.round(Math.max(0, ...offs) * 1000) / 1000,
  };
}

/** One line for a run summary, e.g. "9 cues on time (max 40 ms off)". */
export function driftLine(d: ReturnType<typeof cueDrift>): string {
  if (!d.cues) return 'no cues';
  const max = `max ${Math.round(d.maxOff * 1000)} ms off`;
  return d.off
    ? `${d.cues - d.off} of ${d.cues} cues on time (${max})`
    : `${d.cues} cue${d.cues === 1 ? '' : 's'} on time (${max})`;
}

/** What was left open on camera at the end of steps, e.g. "s2: quick pick", or null. */
export function leftoversLine(events: RecorderEvent[]): string | null {
  const items = events.flatMap((e) =>
    e.kind === 'marker' && e.name === 'onscreen'
      ? [`${String(e.data?.stepId)}: ${((e.data?.items as string[] | undefined) ?? []).join(', ')}`]
      : [],
  );
  return items.length ? `left on screen at step end: ${items.join('; ')}` : null;
}

export interface LateCue {
  stepId: string;
  word: string;
  /** Seconds after its word the action landed. */
  late: number;
  /** What happened just before: the previous action in the step (or the step start), and how long ago. */
  after: string;
  gap: number;
}

/**
 * The cued actions of a paced take that landed after their words, with what came before each:
 * a long gap after the previous action means the product kept the script waiting.
 */
export function lateCues(events: RecorderEvent[]): LateCue[] {
  const out: LateCue[] = [];
  let last: { t: number; label: string; stepId: string } | null = null;
  for (const e of events) {
    if (e.kind === 'step-start') last = { t: e.t, label: 'the step start', stepId: e.stepId };
    if (e.kind !== 'click' && e.kind !== 'key' && e.kind !== 'type') continue;
    const label =
      e.kind === 'click'
        ? `clicking ${e.target}`
        : e.kind === 'key'
          ? `pressing ${e.key}`
          : `typing into ${e.target}`;
    if (e.kind !== 'type' && e.cue && e.t - e.cue.at > CUE_TOLERANCE) {
      const prev = last && last.stepId === e.stepId ? last : null;
      out.push({
        stepId: e.stepId,
        word: e.cue.word,
        late: Math.round((e.t - e.cue.at) * 100) / 100,
        after: prev?.label ?? 'the step start',
        gap: prev ? Math.round((e.t - prev.t) * 10) / 10 : 0,
      });
    }
    last = { t: e.t, label, stepId: e.stepId };
  }
  return out;
}

/** One line per late cue, for the agent. */
export function lateCueLines(late: LateCue[]): string {
  return late
    .map(
      (c) =>
        `- ${c.stepId}: "${c.word}" landed ${c.late.toFixed(1)} s after the word, ${c.gap.toFixed(1)} s after ${c.after}`,
    )
    .join('\n');
}
