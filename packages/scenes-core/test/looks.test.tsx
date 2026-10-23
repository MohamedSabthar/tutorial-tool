import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OverlayContext } from '@studio/overlay-sdk';
import type * as StageModule from '@studio/stage';

const clock = vi.hoisted(() => ({ t: 0 }));
vi.mock('@studio/stage', async (original) => ({
  ...(await original<typeof StageModule>()),
  useStageTime: () => ({ t: clock.t, fps: 30, width: 1920, height: 1080, mode: 'preview' as const }),
}));

const { coreScenes, looksFor } = await import('../src/index');

/** Renders a built-in scene with its default props at scene time t (a 9 s scene). */
function frame(id: string, t: number, props: Record<string, unknown> = {}): string {
  const mod = coreScenes[id]!;
  clock.t = t;
  return renderToStaticMarkup(
    createElement(
      OverlayContext.Provider,
      { value: { id: 'sc-1', start: 0, end: 9, anchor: null } },
      createElement(mod.default, { props: mod.meta.props!.parse(props) } as never),
    ),
  );
}

const LOOKS = ['core:BlueprintFlow', 'core:LayeredPanels', 'core:CodeTrace'];

describe('explainer looks', () => {
  it('render the same frame for the same time, across the scene', () => {
    for (const id of LOOKS)
      for (const t of [0, 0.4, 1.3, 2.9, 4.5, 6.2, 8.1, 9]) expect(frame(id, t)).toBe(frame(id, t));
  });

  it('bring in the reply at the end, and only when there is one', () => {
    for (const id of LOOKS) {
      expect(frame(id, 2)).not.toContain('Hello, World!</span>');
      expect(frame(id, 8.9)).toMatch(/Hello, World!<\/(span|div)>/);
      expect(frame(id, 8.9, { reply: '' })).not.toMatch(/Hello, World!<\/(span|div)>/);
    }
  });

  it('light the request part of the current step', () => {
    // Default timing spreads 4 stops over 9 s: the third (/greeting) is current at 5.7 s.
    expect(frame('core:BlueprintFlow', 5.7)).toContain('color:#FF5800">/greeting</span>');
  });

  it('type the code before tracing it', () => {
    const early = frame('core:CodeTrace', 0.8);
    expect(early).not.toContain('Hello, World!&quot;');
    expect(frame('core:CodeTrace', 6)).toContain('&quot;Hello, World!&quot;');
  });

  it('switch only between looks that share props', () => {
    expect(looksFor('core:DiagramFlow').map((l) => l.id)).toEqual([
      'core:DiagramFlow',
      'core:BlueprintFlow',
      'core:LayeredPanels',
    ]);
    expect(looksFor('core:CodeTrace').map((l) => l.id)).toEqual(['core:CodeWalkthrough', 'core:CodeTrace']);
    expect(looksFor('core:ConceptCards')).toEqual([]);
    // Flow content written for one look renders in the others.
    const props = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', part: '/b' },
      ],
    };
    for (const l of looksFor('core:DiagramFlow')) expect(frame(l.id, 5, props)).toContain('>B<');
  });
});
