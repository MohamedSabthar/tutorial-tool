import type { CSSProperties, ReactNode } from 'react';

/** Backdrop behind explainer scenes that don't paint their own (SceneFrame does). */
export const EXPLAINER_BACKDROP =
  'radial-gradient(55% 65% at 74% 42%, rgba(31,79,255,0.2) 0%, rgba(31,79,255,0) 70%), radial-gradient(rgba(255,255,255,0.07) 1.3px, rgba(255,255,255,0) 1.8px) 0 0 / 30px 30px, #050A1C';

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
