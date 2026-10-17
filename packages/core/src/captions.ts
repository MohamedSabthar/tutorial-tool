import type { Caption, VoiceLine } from './schemas';

/** Broadcast-style caption limits. */
export const CAPTION_RULES = { maxLineChars: 42, maxLines: 2, minSeconds: 1, maxSeconds: 6 } as const;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Wraps text into at most two lines of at most 42 characters, as balanced as the words allow.
 * Returns null when it doesn't fit.
 */
export function wrapCaption(text: string, max: number = CAPTION_RULES.maxLineChars): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const words = t.split(' ');
  let best: string | null = null;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length > max || b.length > max) continue;
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      best = `${a}\n${b}`;
      bestDiff = diff;
    }
  }
  return best;
}

interface TimedWord {
  w: string;
  start: number;
  end: number;
}

/** Words of a placed voice line in output time (spread evenly when there is no alignment). */
function wordsOf(line: VoiceLine, start: number): TimedWord[] {
  if (line.words.length)
    return line.words.map((w) => ({ w: w.w, start: start + w.start, end: start + w.end }));
  const words = line.text.trim().split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
  let at = start;
  return words.map((w) => {
    const d = (line.duration * (w.length + 1)) / total;
    const out = { w, start: at, end: at + d };
    at += d;
    return out;
  });
}

/**
 * Caption cues from the voice-over, in output time: words are packed into cues of at most two
 * 42-character lines and 6 s, preferring to end a cue at the end of a sentence; cues shorter
 * than 1 s are stretched into the following gap.
 */
export function cuesFromVoice(spans: { line: VoiceLine; start: number }[]): Caption[] {
  const cues: { start: number; end: number; words: string[] }[] = [];
  for (const { line, start } of [...spans].sort((a, b) => a.start - b.start)) {
    let cur: { start: number; end: number; words: string[] } | null = null;
    for (const w of wordsOf(line, start)) {
      if (cur) {
        const text = [...cur.words, w.w].join(' ');
        const fits = wrapCaption(text) !== null && w.end - cur.start <= CAPTION_RULES.maxSeconds;
        const sentenceDone =
          /[.!?:;]$/.test(cur.words.at(-1)!) && cur.end - cur.start >= CAPTION_RULES.minSeconds;
        if (fits && !sentenceDone) {
          cur.words.push(w.w);
          cur.end = w.end;
          continue;
        }
        cues.push(cur);
      }
      cur = { start: w.start, end: w.end, words: [w.w] };
    }
    if (cur) cues.push(cur);
  }
  return cues.map((c, i) => {
    const next = cues[i + 1]?.start ?? Infinity;
    const end = Math.max(c.end, Math.min(c.start + CAPTION_RULES.minSeconds, next));
    return {
      id: `cap-${i + 1}`,
      start: r3(c.start),
      end: r3(end),
      text: wrapCaption(c.words.join(' ')) ?? c.words.join(' '),
    };
  });
}

/** The cue shown at output time t. */
export function captionAt(captions: Caption[], t: number): Caption | undefined {
  return captions.find((c) => t >= c.start && t < c.end);
}

/**
 * New generated cues merged with hand-edited ones: edited cues stay, and generated cues that
 * overlap them are dropped.
 */
export function mergeCaptions(generated: Caption[], current: Caption[]): Caption[] {
  const edited = current.filter((c) => c.edited);
  const fresh = generated.filter((g) => !edited.some((e) => g.start < e.end && e.start < g.end));
  const all = [...edited, ...fresh].sort((a, b) => a.start - b.start);
  const used = new Set(edited.map((e) => e.id));
  let n = 0;
  return all.map((c) => {
    if (c.edited) return c;
    let id: string;
    do id = `cap-${++n}`;
    while (used.has(id));
    used.add(id);
    return { ...c, id };
  });
}
