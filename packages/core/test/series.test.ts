import { describe, expect, it } from 'vitest';
import { applySeriesEdit, nextPartId, partContext, Series } from '../src/series';

const base = () =>
  Series.parse({
    slug: 'first-integration',
    title: 'First integration',
    product: 'wso2-integrator',
    createdAt: '2026-11-02T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
  });

describe('series', () => {
  it('defaults a shared brief and no parts', () => {
    const s = base();
    expect(s.parts).toEqual([]);
    expect(s.brief).toMatchObject({ audience: 'developer', length: 'medium', style: 'steps' });
  });

  it('adds, edits, moves and removes parts', () => {
    let s = base();
    s = applySeriesEdit(s, { op: 'addPart', title: 'HTTP service' });
    s = applySeriesEdit(s, { op: 'addPart', title: 'Call an API' });
    s = applySeriesEdit(s, { op: 'addPart', title: 'MySQL' });
    expect(s.parts.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);

    s = applySeriesEdit(s, {
      op: 'editPart',
      id: 'p2',
      goal: 'Call a public API',
      objectives: ['Add a connection'],
    });
    expect(s.parts[1]).toMatchObject({
      title: 'Call an API',
      goal: 'Call a public API',
      objectives: ['Add a connection'],
    });

    s = applySeriesEdit(s, { op: 'movePart', id: 'p3', to: 0 });
    expect(s.parts.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);

    s = applySeriesEdit(s, { op: 'removePart', id: 'p1' });
    expect(s.parts.map((p) => p.id)).toEqual(['p3', 'p2']);
    // Ids are never reused, so a removed part's links can't point at a new one.
    expect(nextPartId(s.parts)).toBe('p4');
  });

  it("won't remove a part that has a project, or edit a missing one", () => {
    const s = applySeriesEdit(base(), { op: 'addPart', title: 'HTTP service' });
    const linked = { ...s, parts: [{ ...s.parts[0]!, project: 'http-service' }] };
    expect(() => applySeriesEdit(linked, { op: 'removePart', id: 'p1' })).toThrow(/project/);
    expect(() => applySeriesEdit(s, { op: 'editPart', id: 'p9', title: 'x' })).toThrow(/no part/);
  });

  it('gives a part its number and neighbours', () => {
    let s = base();
    for (const t of ['One', 'Two', 'Three']) s = applySeriesEdit(s, { op: 'addPart', title: t });
    const ctx = partContext(s, 'p2')!;
    expect(ctx).toMatchObject({ number: 2, total: 3 });
    expect(ctx.prev?.title).toBe('One');
    expect(ctx.next?.title).toBe('Three');
    expect(partContext(s, 'p1')!.prev).toBeNull();
    expect(partContext(s, 'nope')).toBeNull();
  });

  it('updates the title, notes and shared brief', () => {
    const s = applySeriesEdit(base(), {
      op: 'meta',
      title: 'Renamed',
      notes: 'Use greeting-project',
      brief: { style: 'demo' },
    });
    expect(s).toMatchObject({ title: 'Renamed', notes: 'Use greeting-project' });
    expect(s.brief.style).toBe('demo');
    expect(s.brief.audience).toBe('developer');
  });
});
