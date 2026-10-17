import { describe, expect, it } from 'vitest';
import { coreTransitions, DEFAULT_MORPH_TARGET } from '../src/index';

const stage = { width: 1920, height: 1080 };
const target = DEFAULT_MORPH_TARGET(stage);
const ctx = (from: 'recording' | 'explainer', to: 'recording' | 'explainer') => ({ from, to, target, stage });

describe('transitions', () => {
  it('crossfade brings the incoming scene from transparent to opaque', () => {
    const f = coreTransitions['core:Crossfade']!.frame;
    expect(f(0, ctx('recording', 'explainer')).to.opacity).toBe(0);
    expect(f(1, ctx('recording', 'explainer')).to.opacity).toBe(1);
  });

  it('FreezeMorph shrinks the recording into the target and grows it back out', () => {
    const f = coreTransitions['core:FreezeMorph']!.frame;
    const start = f(0, ctx('recording', 'explainer'));
    expect(start.top).toBe('from');
    expect(start.from.transform).toBe('translate(0px, 0px) scale(1)');
    const mid = f(0.75, ctx('recording', 'explainer'));
    const [x, y, k] = String(mid.from.transform).match(/-?[\d.]+/g)!.map(Number);
    expect(x).toBeCloseTo(target.x, 6);
    expect(y).toBeCloseTo(target.y, 6);
    expect(k).toBeCloseTo(target.w / 1920, 6);
    expect(f(1, ctx('recording', 'explainer')).from.opacity).toBe(0);
    const back = f(1, ctx('explainer', 'recording'));
    expect(back.top).toBe('to');
    expect(back.to.transform).toBe('translate(0px, 0px) scale(1)');
    expect(back.from.opacity).toBe(0);
    expect(coreTransitions['core:FreezeMorph']!.meta.freezes).toBe(true);
  });

  it('is a pure function of progress', () => {
    for (const m of Object.values(coreTransitions))
      expect(JSON.stringify(m.frame(0.37, ctx('explainer', 'explainer')))).toBe(
        JSON.stringify(m.frame(0.37, ctx('explainer', 'explainer'))),
      );
  });
});
