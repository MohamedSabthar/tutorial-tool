import { Component, useContext, type ErrorInfo, type ReactNode } from 'react';
import type { Rect } from '@studio/core';
import { DomLayer, TunnelIn, useStageTime } from '@studio/stage';
import { OverlayContext, type OverlayInstanceContext } from './context';

/**
 * 3D content for the stage's shared R3F scene. Coordinates are three.js units with the
 * origin at the stage centre and y up; use `stageToScene` to convert stage px.
 */
export function ThreeLayer({ children }: { children: ReactNode }) {
  const ctx = useContext(OverlayContext);
  // Children render inside the canvas, so carry the overlay context with them.
  return (
    <TunnelIn>
      <OverlayContext.Provider value={ctx}>{children}</OverlayContext.Provider>
    </TunnelIn>
  );
}

/** Stage px (y down, origin top-left) → scene units (y up, origin at the stage centre). */
export function useStageToScene() {
  const { width, height } = useStageTime();
  return (x: number, y: number): [number, number] => [x - width / 2, -(y - height / 2)];
}

export { DomLayer };

/** Renders one overlay instance: provides its context, hides it outside [start, end], and isolates errors. */
export function OverlayRenderer({
  id,
  start,
  end,
  anchor,
  onError,
  children,
}: {
  id: string;
  start: number;
  end: number;
  anchor?: Rect | null;
  onError?: (id: string, error: Error) => void;
  children: ReactNode;
}) {
  const { t } = useStageTime();
  if (t < start || t > end) return null;
  const value: OverlayInstanceContext = { id, start, end, anchor: anchor ?? null };
  return (
    <OverlayBoundary id={id} onError={onError}>
      <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
    </OverlayBoundary>
  );
}

interface BoundaryProps {
  id: string;
  onError?: ((id: string, error: Error) => void) | undefined;
  children: ReactNode;
}

/** A broken overlay renders nothing and reports its error; the rest of the stage keeps working. */
export class OverlayBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(this.props.id, error);
    console.error(`overlay ${this.props.id} failed`, error, info.componentStack);
  }

  override componentDidUpdate(prev: BoundaryProps) {
    // A new component (e.g. after hot reload) gets another chance.
    if (prev.children !== this.props.children && this.state.error) this.setState({ error: null });
  }

  override render() {
    return this.state.error ? null : this.props.children;
  }
}
