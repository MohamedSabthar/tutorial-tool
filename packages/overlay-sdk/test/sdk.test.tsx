// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stage } from '@studio/stage';
import { OverlayRenderer, theme, useGsap, useOverlayTime } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderAt(t: number, node: React.ReactNode) {
  act(() =>
    root.render(
      <Stage t={t} mode="export">
        {node}
      </Stage>,
    ),
  );
}

function Clock() {
  const { t, progress } = useOverlayTime();
  return <span data-testid="clock">{`${t.toFixed(2)}|${progress.toFixed(2)}`}</span>;
}

function Card() {
  const scope = useGsap((tl) => {
    tl.from('.card', { opacity: 0, x: -100, duration: 1, ease: theme.ease.out }).to(
      '.card',
      { x: 200, duration: 1, ease: 'none' },
      1,
    );
  });
  return (
    <div ref={scope}>
      <div className="card">hello</div>
    </div>
  );
}

const style = () => host.querySelector<HTMLElement>('.card')?.getAttribute('style') ?? '(hidden)';

describe('overlay instances', () => {
  it('renders only inside [start, end] with clamped local time', () => {
    const overlay = (
      <OverlayRenderer id="ov" start={2} end={6}>
        <Clock />
      </OverlayRenderer>
    );
    renderAt(1, overlay);
    expect(host.textContent).toBe('');
    renderAt(3, overlay);
    expect(host.textContent).toBe('1.00|0.25');
    renderAt(6, overlay);
    expect(host.textContent).toBe('4.00|1.00');
  });

  it('isolates a throwing overlay and reports it', () => {
    const onError = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken(): React.ReactNode {
      throw new Error('boom');
    }
    renderAt(
      1,
      <>
        <OverlayRenderer id="bad" start={0} end={5} onError={onError}>
          <Broken />
        </OverlayRenderer>
        <OverlayRenderer id="good" start={0} end={5}>
          <Clock />
        </OverlayRenderer>
      </>,
    );
    expect(onError).toHaveBeenCalledWith('bad', expect.any(Error));
    expect(host.textContent).toBe('1.00|0.20');
    spy.mockRestore();
  });
});

describe('useGsap', () => {
  const overlay = (
    <OverlayRenderer id="card" start={1} end={4}>
      <Card />
    </OverlayRenderer>
  );

  it('is a pure function of time: same styles forward, backward and after rebuild', () => {
    const times = [1.2, 1.6, 2.4, 3.5];
    const forward = times.map((t) => {
      renderAt(t, overlay);
      return style();
    });
    const backward = [...times].reverse().map((t) => {
      renderAt(t, overlay);
      return style();
    });
    expect(backward.reverse()).toEqual(forward);
    expect(new Set(forward).size).toBe(4);
    // Matches the timeline math: x goes -100 → 0 (out ease) over local 0–1 s, then 0 → 200 linearly.
    renderAt(2.5, overlay); // local 1.5 s
    expect(style()).toMatch(/translate(3d)?\(100px/);
    renderAt(3.5, overlay); // local 2.5 s, past the end
    expect(style()).toMatch(/translate(3d)?\(200px/);
  });
});
