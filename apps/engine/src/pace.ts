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
