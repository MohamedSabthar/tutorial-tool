import type { TimeMap } from './timemap';
import type { Timeline, VoiceLine } from './schemas';

export interface CharAlignment {
  chars: string[];
  starts: number[];
  ends: number[];
}

export interface TimedWord {
  w: string;
  start: number;
  end: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Words (split on whitespace, punctuation kept) with times from per-character timings. */
export function wordsFromAlignment(a: CharAlignment, offset = 0): TimedWord[] {
  const out: TimedWord[] = [];
  let cur: TimedWord | null = null;
  a.chars.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (cur) out.push(cur);
      cur = null;
      return;
    }
    const start = (a.starts[i] ?? 0) + offset;
    const end = (a.ends[i] ?? start) + offset;
    if (cur) {
      cur.w += c;
      cur.end = end;
    } else cur = { w: c, start, end };
  });
  if (cur) out.push(cur);
  return out.map((w) => ({ w: w.w, start: r3(w.start), end: r3(Math.max(w.end, w.start)) }));
}

/**
 * Output time where a voice line's owner begins. `VoiceLine.start` is relative to it: a step's
 * first shown frame, or an explainer scene's start.
 */
export function ownerStart(tl: Pick<Timeline, 'steps'>, tm: TimeMap, owner: string): number | null {
  const step = tl.steps.find((s) => s.id === owner);
  if (step) {
    const times = tm.toOutput(step.take, step.from);
    if (times.length) return times[0]!;
    // The step's first frame was cut: start at the first segment that shows any of it.
    const seg = tm.segments.find(
      (s) =>
        s.segment.kind !== 'hold' &&
        'from' in s.segment &&
        s.segment.to > step.from &&
        s.segment.from < step.to,
    );
    return seg ? seg.start : null;
  }
  return tm.scenes.find((s) => s.sceneId === owner)?.start ?? null;
}

/** Each voice line's span in output time (lines whose owner is gone are left out). */
export function voiceSpans(
  tl: Pick<Timeline, 'steps' | 'voice'>,
  tm: TimeMap,
): { line: VoiceLine; start: number; end: number }[] {
  const out: { line: VoiceLine; start: number; end: number }[] = [];
  for (const line of tl.voice) {
    const base = ownerStart(tl, tm, line.owner);
    if (base === null) continue;
    out.push({ line, start: base + line.start, end: base + line.start + line.duration });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Voice lines that play over each other by more than this (seconds) count as overlapping. */
export const OVERLAP_TOLERANCE = 0.05;

/** For each voice line that plays over another, the ids of the lines it overlaps. */
export function voiceOverlaps(
  spans: { line: VoiceLine; start: number; end: number }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (a: string, b: string) => out.set(a, [...(out.get(a) ?? []), b]);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length && sorted[j]!.start < sorted[i]!.end - OVERLAP_TOLERANCE; j++) {
      add(sorted[i]!.line.id, sorted[j]!.line.id);
      add(sorted[j]!.line.id, sorted[i]!.line.id);
    }
  return out;
}
