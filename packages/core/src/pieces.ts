import { z } from 'zod';
import type { Segment, Timeline } from './schemas';
import { buildTimeMap } from './timemap';

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
  /** Move the piece's start and/or end in the take (drag its edges): trims or extends it. */
  z.object({
    op: z.literal('trim'),
    from: z.number().nonnegative().optional(),
    to: z.number().nonnegative().optional(),
  }),
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

/** Shortest piece a trim may leave (seconds of take). */
const MIN_PIECE = 0.1;

/**
 * Applies a hand edit to piece `index`; throws if it doesn't apply to that piece. A trim stays
 * clear of the neighbouring pieces and inside the take (`takeDuration`, when known).
 */
export function editPiece(
  segments: Segment[],
  index: number,
  edit: PieceEdit,
  opts: { takeDuration?: number } = {},
): Segment[] {
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
    case 'trim': {
      if (s.kind === 'hold') throw new Error('A freeze has no edges to trim: change its length instead.');
      const from = r3(edit.from ?? s.from);
      const to = r3(edit.to ?? s.to);
      if (to - from < MIN_PIECE) throw new Error('That leaves the piece too short.');
      const prev = segments.slice(0, index).findLast((x) => x.kind !== 'hold');
      const next = segments.slice(index + 1).find((x) => x.kind !== 'hold');
      if (prev && from < prev.to - 1e-3) throw new Error('The piece would overlap the one before it.');
      if (next && to > next.from + 1e-3) throw new Error('The piece would overlap the one after it.');
      if (opts.takeDuration !== undefined && to > opts.takeDuration + 1e-3)
        throw new Error('The piece would run past the end of the recording.');
      return replace({ ...s, from, to, manual: true });
    }
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

/**
 * Splits the recording piece showing at output time `t`, so a piece starts there. Returns the
 * timeline unchanged when `t` is already a piece edge or not in a recording.
 */
export function splitPieceAt(tl: Timeline, t: number): Timeline {
  const span = buildTimeMap(tl).segments.find((g) => g.start + EDGE < t && t < g.end - EDGE);
  if (!span) return tl;
  const si = tl.scenes.findIndex((s) => s.id === span.sceneId);
  const scene = tl.scenes[si];
  if (!scene || scene.kind !== 'recording') return tl;
  const s = span.segment;
  const local = t - span.start;
  let parts: [Segment, Segment];
  if (s.kind === 'hold') {
    parts = [
      { ...s, duration: r3(local) },
      { ...s, duration: r3(s.duration - local) },
    ];
  } else {
    const cut = r3(s.from + local * (s.kind === 'speed' ? s.rate : 1));
    parts = [
      { ...s, to: cut },
      { ...s, from: cut },
    ];
  }
  const segments = [
    ...scene.segments.slice(0, span.index),
    ...parts,
    ...scene.segments.slice(span.index + 1),
  ];
  return { ...tl, scenes: tl.scenes.map((x, i) => (i === si ? { ...scene, segments } : x)) };
}

/**
 * Applies an edit (speed, remove, auto) to everything shown in output time [from, to): pieces
 * are split at both ends first. Freezes inside the range are removed with `remove` and handed
 * back with `auto`; a speed leaves them as they are.
 */
export function editRange(
  tl: Timeline,
  from: number,
  to: number,
  edit: Extract<PieceEdit, { op: 'speed' | 'remove' | 'auto' }>,
): { timeline: Timeline; pieces: number } {
  if (!(to > from)) throw new Error('The range must end after it starts.');
  const split = splitPieceAt(splitPieceAt(tl, from), to);
  const inside = buildTimeMap(split).segments.filter(
    (g) => g.start >= from - EDGE && g.end <= to + EDGE && g.end > g.start,
  );
  if (!inside.length) throw new Error('No recording is shown in that range.');
  let out = split;
  // Last first, so earlier indexes stay valid when pieces are removed.
  for (const g of [...inside].reverse()) {
    if (edit.op === 'speed' && g.segment.kind === 'hold') continue;
    const si = out.scenes.findIndex((s) => s.id === g.sceneId);
    const scene = out.scenes[si];
    if (!scene || scene.kind !== 'recording') continue;
    const segments = editPiece(scene.segments, g.index, edit);
    out = { ...out, scenes: out.scenes.map((x, i) => (i === si ? { ...scene, segments } : x)) };
  }
  return { timeline: out, pieces: inside.length };
}

/** The recording piece at output time `t`: its scene, index and the take time shown there. */
export function pieceAt(
  tl: Timeline,
  t: number,
): { sceneId: string; index: number; takeTime: number } | null {
  const pos = buildTimeMap(tl).toSource(t);
  if (!pos || pos.kind !== 'recording') return null;
  return { sceneId: pos.sceneId, index: pos.segment, takeTime: pos.takeTime };
}
