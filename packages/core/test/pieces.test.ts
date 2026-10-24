import { describe, expect, it } from 'vitest';
import {
  cutGaps,
  editPiece,
  editRange,
  pieceAt,
  sampleTimeline,
  splitPieceAt,
  voiceOverlaps,
  type Segment,
} from '../src';

const segs: Segment[] = [
  { kind: 'src', from: 0, to: 10 },
  { kind: 'speed', from: 10, to: 20, rate: 2 },
  { kind: 'src', from: 25, to: 30 },
];

describe('editPiece', () => {
  it('sets a speed and marks the piece as edited (1× is a plain piece)', () => {
    expect(editPiece(segs, 0, { op: 'speed', rate: 4 })[0]).toEqual({
      kind: 'speed',
      from: 0,
      to: 10,
      rate: 4,
      manual: true,
    });
    expect(editPiece(segs, 1, { op: 'speed', rate: 1 })[1]).toEqual({
      kind: 'src',
      from: 10,
      to: 20,
      manual: true,
    });
  });

  it('removes a piece, which leaves a cut that can be restored', () => {
    const cut = editPiece(segs, 1, { op: 'remove' });
    expect(cut).toHaveLength(2);
    expect(cutGaps(cut)).toEqual([{ after: 0, from: 10, to: 25 }]);
    const back = editPiece(cut, 0, { op: 'restoreCut' });
    expect(back[1]).toEqual({ kind: 'src', from: 10, to: 25 });
    expect(cutGaps(back)).toEqual([]);
  });

  it('freezes inside a piece by splitting it around the freeze', () => {
    const out = editPiece(segs, 0, { op: 'freeze', at: 4, duration: 2 });
    expect(out.slice(0, 3)).toEqual([
      { kind: 'src', from: 0, to: 4 },
      { kind: 'hold', at: 4, duration: 2, manual: true },
      { kind: 'src', from: 4, to: 10 },
    ]);
    expect(editPiece(out, 1, { op: 'duration', duration: 3.5 })[1]).toMatchObject({ duration: 3.5 });
    // Back to automatic drops a hand-made freeze.
    expect(editPiece(out, 1, { op: 'auto' })).toHaveLength(4);
  });

  it('hands a sped-up piece back to the fit as a plain piece', () => {
    expect(editPiece(segs, 1, { op: 'auto' })[1]).toEqual({ kind: 'src', from: 10, to: 20 });
  });

  it('refuses edits that do not fit the piece', () => {
    const held = editPiece(segs, 0, { op: 'freeze', at: 4, duration: 2 });
    expect(() => editPiece(held, 1, { op: 'speed', rate: 2 })).toThrow(/freeze/);
    expect(() => editPiece(segs, 0, { op: 'duration', duration: 2 })).toThrow(/freeze/);
    expect(() => editPiece(segs, 0, { op: 'freeze', at: 15, duration: 1 })).toThrow(/outside/);
    expect(() => editPiece(segs, 2, { op: 'restoreCut' })).toThrow(/Nothing/);
    expect(() => editPiece(segs, 9, { op: 'remove' })).toThrow(/no piece/);
  });
});

describe('editing in output time', () => {
  // sample: sc-1 shows take 0–20 s, a 2 s freeze, then take 20–30 s (output 0–32 s).
  const segsOf = (tl: ReturnType<typeof sampleTimeline>) =>
    tl.scenes[0]!.kind === 'recording' ? tl.scenes[0]!.segments : [];

  it('splits the piece at an output time, and leaves edges alone', () => {
    const tl = sampleTimeline();
    expect(segsOf(splitPieceAt(tl, 5)).slice(0, 2)).toEqual([
      { kind: 'src', from: 0, to: 5 },
      { kind: 'src', from: 5, to: 20 },
    ]);
    expect(splitPieceAt(tl, 20)).toBe(tl);
  });

  it('speeds up just the range, splitting at both ends', () => {
    const { timeline, pieces } = editRange(sampleTimeline(), 5, 15, { op: 'speed', rate: 4 });
    expect(pieces).toBe(1);
    expect(segsOf(timeline).slice(0, 3)).toEqual([
      { kind: 'src', from: 0, to: 5 },
      { kind: 'speed', from: 5, to: 15, rate: 4, manual: true },
      { kind: 'src', from: 15, to: 20 },
    ]);
  });

  it('removes a range across a freeze, leaving one cut', () => {
    const { timeline } = editRange(sampleTimeline(), 5, 25, { op: 'remove' });
    expect(segsOf(timeline)).toEqual([
      { kind: 'src', from: 0, to: 5 },
      { kind: 'src', from: 23, to: 30 },
    ]);
    expect(cutGaps(segsOf(timeline))).toEqual([{ after: 0, from: 5, to: 23 }]);
  });

  it('finds the piece and take time at an output time', () => {
    expect(pieceAt(sampleTimeline(), 25)).toEqual({ sceneId: 'sc-1', index: 2, takeTime: 23 });
    expect(() => editRange(sampleTimeline(), 8, 8, { op: 'remove' })).toThrow(/end after/);
  });
});

describe('voiceOverlaps', () => {
  const span = (id: string, start: number, end: number) => ({
    line: { id, owner: 's1', text: id, start: 0, duration: end - start, words: [] },
    start,
    end,
  });
  it('pairs lines that play over each other, ignoring a touch', () => {
    const m = voiceOverlaps([span('a', 0, 5), span('b', 4, 8), span('c', 8, 9), span('d', 8.5, 12)]);
    expect(m.get('a')).toEqual(['b']);
    expect(m.get('b')).toEqual(['a']);
    expect(m.get('c')).toEqual(['d']);
    expect(m.has('e')).toBe(false);
    expect(voiceOverlaps([span('a', 0, 5), span('b', 4.97, 6)]).size).toBe(0);
  });
});
