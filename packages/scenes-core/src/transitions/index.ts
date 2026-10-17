import type { CSSProperties } from 'react';
import type { Rect } from '@studio/core';

/**
 * Scene transitions. A transition is a pure function of its progress u (0 → 1 across the
 * overlap of two scenes) giving the outgoing and incoming layers' styles and which is on top,
 * so a frame depends only on time (as for overlays).
 */
export interface TransitionContext {
  from: 'recording' | 'explainer';
  to: 'recording' | 'explainer';
  /** Where the recorded frame sits in the explainer's layout (stage px), for FreezeMorph. */
  target: Rect;
  stage: { width: number; height: number };
}

export interface TransitionFrame {
  from: CSSProperties;
  to: CSSProperties;
  top: 'from' | 'to';
}

export interface TransitionModule {
  meta: { name: string; description: string; defaultDuration: number; freezes?: boolean };
  frame: (u: number, ctx: TransitionContext) => TransitionFrame;
}

const ease = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
const span = (u: number, a: number, b: number) => ease((u - a) / (b - a));

/** The transform that puts the full stage into `r` (scale about the top-left corner). */
function into(r: Rect, stage: { width: number; height: number }, k: number): CSSProperties {
  const s = 1 + (r.w / stage.width - 1) * k;
  return {
    transformOrigin: '0 0',
    transform: `translate(${r.x * k}px, ${r.y * k}px) scale(${s})`,
    borderRadius: 18 * k,
    overflow: 'hidden',
  };
}

export const Crossfade: TransitionModule = {
  meta: {
    name: 'Crossfade',
    description: 'The next scene fades in over the previous one.',
    defaultDuration: 0.6,
  },
  frame: (u) => ({ from: {}, to: { opacity: ease(u) }, top: 'to' }),
};

export const Push: TransitionModule = {
  meta: {
    name: 'Push',
    description: 'The next scene slides in from the right, pushing the previous one out.',
    defaultDuration: 0.7,
  },
  frame: (u) => {
    const k = ease(u);
    return {
      from: { transform: `translateX(${-100 * k}%)` },
      to: { transform: `translateX(${100 * (1 - k)}%)` },
      top: 'to',
    };
  },
};

export const ZoomThrough: TransitionModule = {
  meta: {
    name: 'ZoomThrough',
    description: 'The camera pushes into the previous scene while the next one settles in.',
    defaultDuration: 0.8,
  },
  frame: (u) => ({
    from: {
      transformOrigin: '50% 50%',
      transform: `scale(${1 + 0.6 * ease(u)})`,
      opacity: 1 - span(u, 0.35, 0.9),
    },
    to: {
      transformOrigin: '50% 50%',
      transform: `scale(${0.88 + 0.12 * span(u, 0.3, 1)})`,
      opacity: span(u, 0.3, 0.85),
    },
    top: 'to',
  }),
};

/**
 * Into an explainer: the recording freezes and shrinks into the scene's target box while the
 * scene appears around it, then the frame fades into the layout. Out of an explainer: the reverse,
 * the box grows back into the (frozen) recording, which then plays on.
 */
export const FreezeMorph: TransitionModule = {
  meta: {
    name: 'FreezeMorph',
    description: 'The recorded frame freezes and morphs into the explainer (and back out again).',
    defaultDuration: 1.0,
    freezes: true,
  },
  frame: (u, ctx) => {
    if (ctx.from === 'recording' && ctx.to === 'explainer') {
      const k = span(u, 0, 0.75);
      return {
        from: { ...into(ctx.target, ctx.stage, k), opacity: 1 - span(u, 0.7, 1) },
        to: { opacity: span(u, 0.1, 0.55) },
        top: 'from',
      };
    }
    if (ctx.from === 'explainer' && ctx.to === 'recording') {
      const k = 1 - span(u, 0.25, 1);
      return {
        from: { opacity: 1 - span(u, 0.45, 0.9) },
        to: { ...into(ctx.target, ctx.stage, k), opacity: span(u, 0, 0.3) },
        top: 'to',
      };
    }
    return Crossfade.frame(u, ctx);
  },
};

/** Built-in transitions by component id. */
export const coreTransitions: Record<string, TransitionModule> = {
  'core:Crossfade': Crossfade,
  'core:Push': Push,
  'core:ZoomThrough': ZoomThrough,
  'core:FreezeMorph': FreezeMorph,
};

/** Where the recording lands in an explainer by default: a centred box at 42% of the stage. */
export const DEFAULT_MORPH_TARGET = (stage: { width: number; height: number }): Rect => {
  const w = stage.width * 0.42;
  const h = stage.height * 0.42;
  return { x: (stage.width - w) / 2, y: (stage.height - h) / 2, w, h };
};
