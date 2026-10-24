import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Sizes the preview panel to its video, so the stage fills the panel edge to edge instead
 * of leaving bands beside it. The panel's height is set by the layout; its width becomes the
 * stage area's height × the video's aspect, plus the panel's own padding and border. Returns
 * a ref for the stage area and the panel's max width (undefined until measured or when off).
 */
export function usePlayerFit(aspect: number, enabled: boolean) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [maxWidth, setMaxWidth] = useState<number>();

  useLayoutEffect(() => {
    const fit = fitRef.current;
    const panel = fit?.parentElement;
    if (!enabled || !fit || !panel) {
      setMaxWidth(undefined);
      return;
    }
    const measure = () => {
      const chrome = panel.offsetWidth - fit.clientWidth;
      // Round up: a fraction of a pixel too wide is invisible, too narrow leaves a band below.
      setMaxWidth(Math.ceil(fit.clientHeight * aspect + chrome));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(fit);
    return () => ro.disconnect();
  }, [aspect, enabled]);

  return { fitRef, maxWidth };
}
