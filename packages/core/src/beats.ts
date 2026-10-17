import type { ExplainerScene, VoiceLine } from './schemas';
import type { TimedWord } from './voice';

/** Speaking rate used to estimate timings before the narration is voiced. */
const WORDS_PER_SECOND = 2.5;
/** Gap between consecutive narration lines of a scene (estimated and voiced). */
export const SCENE_LINE_GAP = 0.3;
/** Silence before the first line of a scene. */
export const SCENE_LEAD_IN = 0.4;

export interface SceneTiming {
  /** Beat id → seconds from the scene's start. */
  beats: Record<string, number>;
  /** Beat ids in time order. */
  order: string[];
  /** Every narration word, scene-local. */
  words: TimedWord[];
  /** Each narration line's span, scene-local. */
  lines: { start: number; end: number; text: string }[];
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Narration lines with estimated word timings (no voice-over yet). */
function estimate(narration: string[]): { start: number; end: number; text: string; words: TimedWord[] }[] {
  let at = SCENE_LEAD_IN;
  return narration.map((text) => {
    const ws = text.trim().split(/\s+/).filter(Boolean);
    const start = at;
    const words = ws.map((w, i) => ({
      w,
      start: start + i / WORDS_PER_SECOND,
      end: start + (i + 0.85) / WORDS_PER_SECOND,
    }));
    const end = start + Math.max(ws.length, 1) / WORDS_PER_SECOND;
    at = end + SCENE_LINE_GAP;
    return { start, end, text, words };
  });
}

/**
 * Resolves an explainer's beats to scene-local seconds. Cues: `vo:N` (start of narration line
 * N), `word:x` (the first narration word x, in order, after the previous beat), or a fixed time.
 * Voice lines owned by the scene give the timings; without them, timings are estimated from the
 * narration text, so editing a line moves the beats either way. Scenes without explicit beats
 * get `defaults` (the component's declared beat names) on lines 0, 1, 2…
 */
export function resolveBeats(
  scene: ExplainerScene,
  voice: VoiceLine[],
  defaults: string[] = [],
): SceneTiming {
  const own = voice.filter((v) => v.owner === scene.id).sort((a, b) => a.start - b.start);
  const lines = own.length
    ? own.map((v) => ({
        start: v.start,
        end: v.start + v.duration,
        text: v.text,
        words: v.words.length
          ? v.words.map((w) => ({ w: w.w, start: v.start + w.start, end: v.start + w.end }))
          : v.text
              .split(/\s+/)
              .filter(Boolean)
              .map((w, i, all) => ({
                w,
                start: v.start + (v.duration * i) / all.length,
                end: v.start + (v.duration * (i + 1)) / all.length,
              })),
      }))
    : estimate(scene.narration);
  const words = lines.flatMap((l) => l.words);
  const cues = scene.beats.length ? scene.beats : defaults.map((id, i) => ({ id, at: `vo:${i}` as const }));
  const beats: Record<string, number> = {};
  let after = 0;
  for (const b of cues) {
    let at: number | undefined;
    if (typeof b.at === 'number') at = b.at;
    else if (b.at.startsWith('vo:')) at = lines[Number(b.at.slice(3))]?.start;
    else {
      const target = norm(b.at.slice(5));
      at = (
        words.find((w) => w.start >= after - 1e-6 && norm(w.w) === target) ??
        words.find((w) => norm(w.w) === target)
      )?.start;
    }
    // A cue that doesn't resolve (line or word missing) lands just after the previous beat.
    const t = Math.round((at ?? after + 1) * 1000) / 1000;
    beats[b.id] = t;
    after = t;
  }
  const order = Object.keys(beats).sort((a, b) => beats[a]! - beats[b]!);
  return { beats, order, words, lines: lines.map(({ start, end, text }) => ({ start, end, text })) };
}

/** A scene's natural length from its narration timing (last line end plus a short tail). */
export function sceneNarrationLength(timing: SceneTiming, tail = 0.8): number {
  const end = timing.lines.at(-1)?.end ?? 0;
  return end > 0 ? Math.round((end + tail) * 1000) / 1000 : 0;
}
