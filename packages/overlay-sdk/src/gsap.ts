import { useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';
import { gsap } from 'gsap';
import { TextPlugin } from 'gsap/TextPlugin';
import { useOverlayTime } from './context';

gsap.registerPlugin(TextPlugin);
// GSAP never runs on its own clock here: every timeline is paused and seeked to overlay time.
gsap.ticker.lagSmoothing(0);

export { gsap };

/**
 * A paused GSAP timeline, seeked to overlay-local time on every render, so animation is a
 * pure function of t (scrubbing and export match playback). Build tweens with positions in
 * seconds; selectors are scoped to the returned ref's element.
 *
 *   const scope = useGsap((tl) => {
 *     tl.from('.card', { autoAlpha: 0, y: 20, duration: 0.3, ease: theme.ease.out })
 *       .to('.code', { text: props.code, duration: 1.2, ease: 'none' }, 0.3);
 *   }, [props.code]);
 *   return <div ref={scope}>…</div>;
 */
export function useGsap<T extends HTMLElement = HTMLDivElement>(
  build: (tl: gsap.core.Timeline, ctx: { duration: number }) => void,
  deps: DependencyList = [],
): RefObject<T | null> {
  const scope = useRef<T>(null);
  const { t, duration } = useOverlayTime();
  const timeline = useRef<gsap.core.Timeline | null>(null);

  // (Re)build when deps change; declared first so it runs before the seek below.
  useLayoutEffect(() => {
    let tl: gsap.core.Timeline | null = null;
    const ctx = gsap.context(() => {
      tl = gsap.timeline({ paused: true });
      build(tl, { duration });
    }, scope.current ?? undefined);
    timeline.current = tl;
    (tl as gsap.core.Timeline | null)?.seek(t, true);
    return () => {
      ctx.revert();
      timeline.current = null;
    };
    // The caller controls rebuilds through deps; t is applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, ...deps]);

  useLayoutEffect(() => {
    timeline.current?.seek(t, true);
  }, [t]);

  return scope;
}
