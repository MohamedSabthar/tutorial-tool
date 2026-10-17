import type { z } from 'zod';
import type { ComponentType } from 'react';

/**
 * What an overlay (or explainer scene) module exports:
 *
 *   export const meta: OverlayMeta = { name: 'CodeCallout', description: '…', props: z.object({ … }) };
 *   export default function CodeCallout({ props, duration }: OverlayProps<Props>) { … }
 */
export interface OverlayMeta<P extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** Validates instance props, and drives the inspector form. */
  props: P;
  kind?: 'overlay' | 'scene';
  /**
   * Scenes: the beat names the component animates on, in order. Without explicit beats in the
   * timeline, beat i fires at the start of narration line i.
   */
  beats?: string[];
  /** Seconds, used when the instance is first created. */
  defaultDuration?: number;
}

export interface OverlayProps<P = Record<string, unknown>> {
  props: P;
  /** Instance length in seconds. */
  duration: number;
}

export interface OverlayModule<P = Record<string, unknown>> {
  meta: OverlayMeta;
  default: ComponentType<OverlayProps<P>>;
}
