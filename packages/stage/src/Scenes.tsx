import type { CSSProperties, ReactNode } from 'react';

/** Backdrop behind explainer scenes that don't paint their own (SceneFrame does). */
export const EXPLAINER_BACKDROP =
  'radial-gradient(125% 95% at 50% 0%, #14225A 0%, #0A1232 40%, #050A1C 100%)';

/**
 * An explainer scene on the stage: full frame, in screen space (the recording camera doesn't
 * apply), above the recording and below overlays. `weight` < 1 while a transition blends it
 * with its neighbour.
 */
export function ExplainerLayer({
  weight,
  style,
  children,
}: {
  weight: number;
  /** A transition's styles (transform, opacity) while one is playing. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (weight <= 0) return null;
  return (
    <div
      data-explainer=""
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: EXPLAINER_BACKDROP,
        opacity: Math.min(1, weight),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
