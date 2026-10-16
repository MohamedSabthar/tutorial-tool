// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { RecorderEvent } from '@studio/core';
import { OverlayRenderer, RecordingContext } from '@studio/overlay-sdk';
import { fitSource, Stage } from '@studio/stage';
import { coreOverlays, pointerAt, resolveProps, zoomMove } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const events: RecorderEvent[] = [
  {
    kind: 'mouse',
    t: 1,
    points: [
      [1, 100, 100],
      [1.5, 300, 200],
    ],
  },
  {
    kind: 'click',
    t: 1.6,
    stepId: 's1',
    x: 300,
    y: 200,
    target: 'button',
    bbox: { x: 250, y: 180, w: 100, h: 40 },
  },
];

describe('core overlay helpers', () => {
  it('interpolates the pointer along recorded paths', () => {
    expect(pointerAt(events, 0.5)).toEqual({ x: 100, y: 100 });
    expect(pointerAt(events, 1.25)).toEqual({ x: 200, y: 150 });
    expect(pointerAt(events, 9)).toEqual({ x: 300, y: 200 });
  });

  it('fills defaults and validates props', () => {
    expect(resolveProps('core:Zoom', {})).toEqual({ zoom: 1.8, ease: 0.6 });
    expect(() => resolveProps('core:Zoom', { zoom: 9 })).toThrow();
    expect(zoomMove({ start: 1, end: 3, props: {} }, { x: 100, y: 100, w: 50, h: 20 }).to).toEqual({
      zoom: 1.8,
      focusX: 125,
      focusY: 110,
    });
  });
});

describe('every core overlay renders', () => {
  for (const [ref, mod] of Object.entries(coreOverlays)) {
    it(ref, () => {
      const host = document.createElement('div');
      const root = createRoot(host);
      const onError = vi.fn();
      const Comp = mod.default;
      const props = resolveProps(ref, ref === 'core:Captions' ? { text: 'Hello' } : {});
      act(() =>
        root.render(
          <Stage t={1.7} mode="export">
            <RecordingContext.Provider
              value={{
                events,
                fit: fitSource({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }),
                sourceTime: (t) => t,
              }}
            >
              <OverlayRenderer
                id="x"
                start={1}
                end={4}
                anchor={{ x: 400, y: 300, w: 200, h: 60 }}
                onError={onError}
              >
                <Comp props={props} duration={3} />
              </OverlayRenderer>
            </RecordingContext.Provider>
          </Stage>,
        ),
      );
      expect(onError).not.toHaveBeenCalled();
      if (ref !== 'core:Zoom')
        expect(host.querySelector('[data-stage-surface]')!.innerHTML.length).toBeGreaterThan(80);
      act(() => root.unmount());
    });
  }
});
