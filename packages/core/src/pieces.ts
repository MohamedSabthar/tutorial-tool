import { z } from 'zod';
import type { Segment } from './schemas';

/**
 * Hand edits to the pieces (segments) of a recording scene: speed, remove, freeze, back to
 * automatic, restore a cut. Edited pieces are marked `manual` so the timing fit keeps them.
 * Pure functions on a scene's segments; the engine applies them and rebuilds what follows.
 */
export const PieceEdit = z.discriminatedUnion('op', [
  /** Play the piece at `rate` (1 = as recorded). */
  z.object({ op: z.literal('speed'), rate: z.number().min(0.25).max(16) }),
  /** Take the piece off camera: cut from the video. */
  z.object({ op: z.literal('remove') }),
  /** Freeze the frame at take time `at` inside the piece for `duration` seconds. */
  z.object({
    op: z.literal('freeze'),
    at: z.number().nonnegative(),
    duration: z.number().positive().max(60),
  }),
  /** A freeze's length. */
  z.object({ op: z.literal('duration'), duration: z.number().positive().max(60) }),
  /** Hand the piece back to the timing fit (a hand-made freeze is removed). */
  z.object({ op: z.literal('auto') }),
  /** Put back the recording cut out after this piece (up to the next piece). */
  z.object({ op: z.literal('restoreCut') }),
]);
export type PieceEdit = z.infer<typeof PieceEdit>;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EDGE = 0.05;

/** A stretch of the take cut out between two pieces: after piece `after`, take time [from, to). */
export interface CutGap {
  after: number;
  from: number;
  to: number;
}

/** The cuts between pieces (recording left out between one piece and the next). */
export function cutGaps(segments: Segment[]): CutGap[] {
  const gaps: CutGap[] = [];
  let last: { index: number; end: number } | null = null;
  segments.forEach((s, index) => {
    if (s.kind === 'hold') return;
    if (last && s.from > last.end + 1e-3) gaps.push({ after: last.index, from: last.end, to: s.from });
    last = { index, end: s.to };
  });
  return gaps;
}

/** Applies a hand edit to piece `index`; throws if it doesn't apply to that piece. */
export function editPiece(segments: Segment[], index: number, edit: PieceEdit): Segment[] {
  const s = segments[index];
  if (!s) throw new Error(`There is no piece ${index} in this scene.`);
  const replace = (...next: Segment[]) => [
    ...segments.slice(0, index),
    ...next,
    ...segments.slice(index + 1),
  ];

  switch (edit.op) {
    case 'speed': {
      if (s.kind === 'hold') throw new Error('A freeze has no speed: change its length instead.');
      const rate = r3(edit.rate);
      return replace(
        rate === 1
          ? { kind: 'src', from: s.from, to: s.to, manual: true }
          : { kind: 'speed', from: s.from, to: s.to, rate, manual: true },
      );
    }
    case 'remove':
      return replace();
    case 'freeze': {
      if (s.kind === 'hold') throw new Error('Freeze inside a recorded piece, not another freeze.');
      const hold: Segment = { kind: 'hold', at: r3(edit.at), duration: r3(edit.duration), manual: true };
      if (edit.at < s.from - EDGE || edit.at > s.to + EDGE)
        throw new Error('The freeze time is outside this piece.');
      if (edit.at <= s.from + EDGE) return replace({ ...hold, at: s.from }, s);
      if (edit.at >= s.to - EDGE) return replace(s, { ...hold, at: r3(Math.max(s.from, s.to - 1 / 30)) });
      return replace({ ...s, to: hold.at }, hold, { ...s, from: hold.at });
    }
    case 'duration':
      if (s.kind !== 'hold') throw new Error('Only a freeze has a length to set.');
      return replace({ ...s, duration: r3(edit.duration), manual: true });
    case 'auto':
      if (s.kind === 'hold') return s.manual ? replace() : segments;
      return replace({ kind: 'src', from: s.from, to: s.to });
    case 'restoreCut': {
      const gap = cutGaps(segments).find((g) => g.after === index);
      if (!gap) throw new Error('Nothing is cut out after this piece.');
      // Back in after any freeze that follows the piece.
      let at = index + 1;
      while (segments[at]?.kind === 'hold') at++;
      return [
        ...segments.slice(0, at),
        { kind: 'src', from: r3(gap.from), to: r3(gap.to) },
        ...segments.slice(at),
      ];
    }
  }
}
