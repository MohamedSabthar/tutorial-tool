import type { ReactNode } from 'react';

/** Backdrop behind explainer scenes that don't paint their own (SceneFrame does). */
export const EXPLAINER_BACKDROP =
  'radial-gradient(125% 95% at 50% 0%, #2B3E5E 0%, #18283F 40%, #0B1424 100%)';

/**
 * An explainer scene on the stage: full frame, in screen space (the recording camera doesn't
 * apply), above the recording and below overlays. `weight` < 1 while a transition blends it
 * with its neighbour.
 */
export function ExplainerLayer({ weight, children }: { weight: number; children: ReactNode }) {
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
      }}
    >
      {children}
    </div>
  );
}
