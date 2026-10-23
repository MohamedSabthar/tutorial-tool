/** Each step's cue words and total hold time, read from a script.spec.ts. */
export type ScriptOutline = Record<string, { cues: string[]; holdMs: number }>;

const STEP = /tut\.step\(\s*(['"`])([^'"`]+)\1/g;
const CUE = /(?:tut\.cue\(\s*|\bcue:\s*)(['"`])((?:(?!\1).)+)\1/g;
const HOLD = /tut\.hold\(\s*(\d+)/g;

/** A rough outline, good enough to say what an agent changed (not a parser). */
export function scriptOutline(text: string): ScriptOutline {
  const out: ScriptOutline = {};
  const starts = [...text.matchAll(STEP)].map((m) => ({ id: m[2]!, at: m.index }));
  starts.forEach((s, i) => {
    const body = text.slice(s.at, starts[i + 1]?.at ?? text.length);
    out[s.id] = {
      cues: [...body.matchAll(CUE)].map((m) => m[2]!),
      holdMs: [...body.matchAll(HOLD)].reduce((n, m) => n + Number(m[1]), 0),
    };
  });
  return out;
}

/** What changed between two outlines, e.g. "s3 cues Create, Save → Create, Run; s2 holds +1.2 s". */
export function outlineChanges(before: ScriptOutline, after: ScriptOutline): string | null {
  const parts: string[] = [];
  for (const [id, a] of Object.entries(after)) {
    const b = before[id] ?? { cues: [], holdMs: 0 };
    if (a.cues.join('\u0000') !== b.cues.join('\u0000'))
      parts.push(`${id} cues ${b.cues.join(', ') || 'none'} → ${a.cues.join(', ') || 'none'}`);
    const dh = (a.holdMs - b.holdMs) / 1000;
    if (Math.abs(dh) >= 0.1) parts.push(`${id} holds ${dh > 0 ? '+' : ''}${dh.toFixed(1)} s`);
  }
  return parts.length ? parts.join('; ') : null;
}
