import type { Caption } from '@studio/core';

/** hh:mm:ss + separator + mmm. */
function stamp(seconds: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** Cues in time order, without empty ones, each ending before the next starts. */
function clean(captions: Caption[]): Caption[] {
  const cues = captions
    .filter((c) => c.text.trim() && c.end > c.start)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c }));
  for (let i = 0; i < cues.length - 1; i++) cues[i]!.end = Math.min(cues[i]!.end, cues[i + 1]!.start);
  return cues.filter((c) => c.end > c.start);
}

/** SubRip captions. */
export function toSrt(captions: Caption[]): string {
  return clean(captions)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text.trim()}\n`)
    .join('\n');
}

/** WebVTT captions ("-->" can't appear in cue text, so it is spelled out). */
export function toVtt(captions: Caption[]): string {
  const cues = clean(captions).map(
    (c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text.trim().replace(/-->/g, '→')}\n`,
  );
  return ['WEBVTT', '', ...cues].join('\n');
}

/** Problems with a WebVTT file (empty when valid): header, timestamps, order. */
export function validateVtt(vtt: string): string[] {
  const problems: string[] = [];
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\n+/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(blocks[0]!.split('\n')[0]!)) problems.push('missing the WEBVTT header');
  const time = /^(\d{2,}:)?\d{2}:\d{2}\.\d{3}$/;
  const secs = (s: string) => s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
  let last = -1;
  for (const [i, block] of blocks.slice(1).entries()) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const timing = lines.find((l) => l.includes('-->'));
    if (!timing) {
      problems.push(`cue ${i + 1}: no timing line`);
      continue;
    }
    const [a, b] = timing.split('-->').map((s) => s.trim().split(/\s+/)[0]!);
    if (!time.test(a!) || !time.test(b!)) {
      problems.push(`cue ${i + 1}: bad timestamp "${timing}"`);
      continue;
    }
    if (secs(b!) <= secs(a!)) problems.push(`cue ${i + 1}: ends before it starts`);
    if (secs(a!) < last) problems.push(`cue ${i + 1}: out of order`);
    last = secs(a!);
    if (lines.indexOf(timing) === lines.length - 1) problems.push(`cue ${i + 1}: no text`);
  }
  return problems;
}
