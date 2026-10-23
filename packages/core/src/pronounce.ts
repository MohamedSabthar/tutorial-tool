import { z } from 'zod';
import { cueToken } from './pace';
import type { TimedWord } from './voice';

/** How a term is spoken: `WSO2` → `W S O two`, `/greeting` → `slash greeting`. */
export const Pronunciation = z.object({
  /** As written in the narration (one or more words; case and surrounding punctuation are ignored). */
  term: z.string().trim().min(1),
  /** What the voice says instead. */
  say: z.string().trim().min(1),
});
export type Pronunciation = z.infer<typeof Pronunciation>;

/** The workspace's `pronunciations.json`. */
export const PronunciationsFile = z.object({ pronunciations: z.array(Pronunciation).default([]) });

/** Text for the voice, and for each written word the range of spoken words that say it. */
export interface Speakable {
  spoken: string;
  /** spans[i] = [first, end) spoken-word indices for written word i. */
  spans: [number, number][];
  written: string[];
}

/**
 * Applies the pronunciations to narration, word by word (longest term first). Punctuation
 * around a matched term is kept, so pauses and sentence ends stay where they were.
 */
export function speakable(text: string, rules: Pronunciation[]): Speakable {
  const written = text.trim().split(/\s+/).filter(Boolean);
  const terms = rules
    .map((r) => ({ tokens: r.term.split(/\s+/).map(cueToken).filter(Boolean), say: r.say.split(/\s+/) }))
    .filter((r) => r.tokens.length)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  const spoken: string[] = [];
  const spans: [number, number][] = [];
  for (let i = 0; i < written.length;) {
    const rule = terms.find((r) => r.tokens.every((t, j) => cueToken(written[i + j] ?? '') === t));
    if (!rule) {
      spans.push([spoken.length, spoken.length + 1]);
      spoken.push(written[i]!);
      i++;
      continue;
    }
    const first = written[i]!;
    const last = written[i + rule.tokens.length - 1]!;
    // Keep the punctuation before the first and after the last written word.
    const lead = /^[^\p{L}\p{N}/]*/u.exec(first)![0];
    const trail = /[^\p{L}\p{N}]*$/u.exec(last)![0];
    const start = spoken.length;
    rule.say.forEach((w, j) =>
      spoken.push(`${j === 0 ? lead : ''}${w}${j === rule.say.length - 1 ? trail : ''}`),
    );
    for (let j = 0; j < rule.tokens.length; j++) spans.push([start, spoken.length]);
    i += rule.tokens.length;
  }
  // Nothing replaced: send the text as written (the same request, and cache entry, as before).
  const changed = spoken.length !== written.length || spoken.some((w, i) => w !== written[i]);
  return { spoken: changed ? spoken.join(' ') : text.trim(), spans, written };
}

/**
 * Word timings for the written text from the timings of the spoken text (ElevenLabs aligns
 * what it was sent). A term spoken as several words gets their span; written words that share
 * one spoken phrase (a multi-word term) share its time.
 */
export function writtenWords(s: Speakable, spokenWords: TimedWord[]): TimedWord[] {
  const count = s.spoken.split(/\s+/).filter(Boolean).length;
  if (spokenWords.length !== count) return spokenWords;
  return s.written.map((w, i) => {
    const [a, b] = s.spans[i]!;
    return { w, start: spokenWords[a]!.start, end: spokenWords[b - 1]!.end };
  });
}
