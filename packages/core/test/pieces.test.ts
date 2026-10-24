import { describe, expect, it } from 'vitest';
import { cutGaps, editPiece, type Segment } from '../src';

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
