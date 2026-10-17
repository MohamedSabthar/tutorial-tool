import { z } from 'zod';
import {
  DomLayer,
  theme,
  useAnchor,
  useGsap,
  useOverlayTime,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import type { CameraMove } from '@studio/stage';
import type { Rect } from '@studio/core';

/**
 * Overlays anchored to a recorded element. They read the element's box with useAnchor()
 * and draw in a camera-following DomLayer, so they stay attached during zooms.
 */

// ---------------------------------------------------------------------------
// Zoom (drives the camera; renders nothing)
// ---------------------------------------------------------------------------

const ZoomProps = z.object({
  zoom: z.number().min(1).max(4).default(1.8),
  /** Seconds to ease in and out. */
  ease: z.number().min(0.1).max(2).default(0.9),
});
type ZoomProps = z.infer<typeof ZoomProps>;

export const zoomMeta: OverlayMeta = {
  name: 'Zoom',
  description: 'Zooms the camera onto the anchored element for the instance’s duration, then back out.',
  props: ZoomProps,
  defaultDuration: 2.5,
};

/** The camera move a Zoom instance contributes (the host collects these). */
export function zoomMove(
  instance: { start: number; end: number; props: Partial<ZoomProps> },
  anchor: Rect,
): CameraMove {
  return {
    start: instance.start,
    end: instance.end,
    ease: instance.props.ease ?? 0.9,
    to: {
      zoom: instance.props.zoom ?? 1.8,
      focusX: anchor.x + anchor.w / 2,
      focusY: anchor.y + anchor.h / 2,
    },
  };
}

export function Zoom(_: OverlayProps<ZoomProps>) {
  return null;
}

// ---------------------------------------------------------------------------
// Highlight (spotlight)
// ---------------------------------------------------------------------------

const HighlightProps = z.object({
  /** How dark the surroundings get (0–1). */
  dim: z.number().min(0).max(0.9).default(0.55),
  padding: z.number().min(0).max(60).default(10),
});
type HighlightProps = z.infer<typeof HighlightProps>;

export const highlightMeta: OverlayMeta = {
  name: 'Highlight',
  description: 'Dims everything except the anchored element (spotlight).',
  props: HighlightProps,
  defaultDuration: 2.5,
};

export function Highlight({ props, duration }: OverlayProps<HighlightProps>) {
  const a = useAnchor();
  const scope = useGsap((tl) => {
    tl.from('.hole', { opacity: 0, duration: theme.duration.enter, ease: theme.ease.out }).to(
      '.hole',
      { opacity: 0, duration: theme.duration.exit },
      duration - theme.duration.exit,
    );
  }, []);
  if (!a) return null;
  const pad = props.padding ?? 10;
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div
          className="hole"
          style={{
            position: 'absolute',
            left: a.x - pad,
            top: a.y - pad,
            width: a.w + pad * 2,
            height: a.h + pad * 2,
            borderRadius: 10,
            boxShadow: `0 0 0 4000px rgba(12,21,38,${props.dim ?? 0.55})`,
          }}
        />
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Box
// ---------------------------------------------------------------------------

const BoxProps = z.object({
  color: z.string().default(theme.color.orange),
  width: z.number().min(1).max(12).default(4),
  padding: z.number().min(0).max(40).default(6),
});
type BoxProps = z.infer<typeof BoxProps>;

export const boxMeta: OverlayMeta = {
  name: 'Box',
  description: 'An outline around the anchored element that pops in.',
  props: BoxProps,
  defaultDuration: 2,
};

export function Box({ props, duration }: OverlayProps<BoxProps>) {
  const a = useAnchor();
  const scope = useGsap((tl) => {
    tl.from('.box', { opacity: 0, scale: 1.15, duration: theme.duration.enter, ease: theme.ease.pop }).to(
      '.box',
      { opacity: 0, duration: theme.duration.exit },
      duration - theme.duration.exit,
    );
  }, []);
  if (!a) return null;
  const pad = props.padding ?? 6;
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div
          className="box"
          style={{
            position: 'absolute',
            left: a.x - pad,
            top: a.y - pad,
            width: a.w + pad * 2,
            height: a.h + pad * 2,
            border: `${props.width ?? 4}px solid ${props.color ?? theme.color.orange}`,
            borderRadius: 10,
            boxSizing: 'border-box',
          }}
        />
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Arrow
// ---------------------------------------------------------------------------

const ArrowProps = z.object({
  from: z.enum(['left', 'right', 'top', 'bottom']).default('left'),
  label: z.string().default(''),
  color: z.string().default(theme.color.orange),
});
type ArrowProps = z.infer<typeof ArrowProps>;

export const arrowMeta: OverlayMeta = {
  name: 'Arrow',
  description: 'An arrow pointing at the anchored element from one side, with an optional label.',
  props: ArrowProps,
  defaultDuration: 2.5,
};

export function Arrow({ props, duration }: OverlayProps<ArrowProps>) {
  const a = useAnchor();
  const { t } = useOverlayTime();
  const scope = useGsap((tl) => {
    tl.from('.arrow', { opacity: 0, duration: theme.duration.enter, ease: theme.ease.out }).to(
      '.arrow',
      { opacity: 0, duration: theme.duration.exit },
      duration - theme.duration.exit,
    );
  }, []);
  if (!a) return null;
  const len = 120;
  const from = props.from ?? 'left';
  const bob = Math.sin(t * Math.PI * 2 * 1.2) * 8;
  const tip =
    from === 'left'
      ? { x: a.x - 10 - bob, y: a.y + a.h / 2, rot: 0 }
      : from === 'right'
        ? { x: a.x + a.w + 10 + bob, y: a.y + a.h / 2, rot: 180 }
        : from === 'top'
          ? { x: a.x + a.w / 2, y: a.y - 10 - bob, rot: 90 }
          : { x: a.x + a.w / 2, y: a.y + a.h + 10 + bob, rot: -90 };
  const color = props.color ?? theme.color.orange;
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div
          className="arrow"
          style={{
            position: 'absolute',
            left: tip.x,
            top: tip.y,
            transform: `rotate(${tip.rot}deg)`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            width={len}
            height={40}
            viewBox={`0 0 ${len} 40`}
            style={{ position: 'absolute', left: -len, top: -20, overflow: 'visible' }}
          >
            <path d={`M4 20 H${len - 18}`} stroke={color} strokeWidth={7} strokeLinecap="round" />
            <path d={`M${len - 26} 6 L${len} 20 L${len - 26} 34 Z`} fill={color} />
          </svg>
          {props.label && (
            <span
              style={{
                position: 'absolute',
                right: len + 12,
                top: -18,
                whiteSpace: 'nowrap',
                fontFamily: theme.font.sans,
                fontWeight: 700,
                fontSize: 24,
                color: theme.color.white,
                background: color,
                padding: '4px 12px',
                borderRadius: 8,
                transform: `rotate(${-tip.rot}deg)`,
              }}
            >
              {props.label}
            </span>
          )}
        </div>
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

const CalloutProps = z.object({
  title: z.string().default('Title'),
  text: z.string().default(''),
  side: z.enum(['right', 'left', 'top', 'bottom']).default('right'),
  width: z.number().min(200).max(800).default(400),
});
type CalloutProps = z.infer<typeof CalloutProps>;

export const calloutMeta: OverlayMeta = {
  name: 'Callout',
  description: 'A white card with a title and text next to the anchored element.',
  props: CalloutProps,
  defaultDuration: 3,
};

export function Callout({ props, duration }: OverlayProps<CalloutProps>) {
  const a = useAnchor();
  const scope = useGsap((tl) => {
    tl.from('.card', {
      autoAlpha: 0,
      scale: 0.9,
      y: 10,
      duration: theme.duration.enter,
      ease: theme.ease.pop,
    })
      .from('.rule', { width: 0, duration: 0.3, ease: theme.ease.out }, 0.15)
      .to('.card', { autoAlpha: 0, duration: theme.duration.exit }, duration - theme.duration.exit);
  }, []);
  if (!a) return null;
  const w = props.width ?? 400;
  const gap = 24;
  const side = props.side ?? 'right';
  const pos =
    side === 'right'
      ? { left: a.x + a.w + gap, top: a.y + a.h / 2 - 60 }
      : side === 'left'
        ? { left: a.x - gap - w, top: a.y + a.h / 2 - 60 }
        : side === 'top'
          ? { left: a.x + a.w / 2 - w / 2, top: a.y - gap - 130 }
          : { left: a.x + a.w / 2 - w / 2, top: a.y + a.h + gap };
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div
          className="card"
          style={{
            position: 'absolute',
            ...pos,
            width: w,
            background: theme.color.white,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            padding: '18px 22px',
            fontFamily: theme.font.sans,
            color: theme.color.navy,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{props.title}</div>
          <div
            className="rule"
            style={{ width: 48, height: 3, background: theme.color.orange, margin: '8px 0 10px' }}
          />
          {props.text && (
            <div style={{ fontSize: 20, lineHeight: 1.4, color: theme.color.ink }}>{props.text}</div>
          )}
        </div>
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Blur
// ---------------------------------------------------------------------------

const BlurProps = z.object({
  amount: z.number().min(2).max(40).default(14),
  padding: z.number().min(0).max(30).default(4),
});
type BlurProps = z.infer<typeof BlurProps>;

export const blurMeta: OverlayMeta = {
  name: 'Blur',
  description: 'Blurs the anchored area (secrets, emails, machine-specific paths).',
  props: BlurProps,
};

export function Blur({ props }: OverlayProps<BlurProps>) {
  const a = useAnchor();
  if (!a) return null;
  const pad = props.padding ?? 4;
  const filter = `blur(${props.amount ?? 14}px)`;
  return (
    <DomLayer follow>
      <div
        style={{
          position: 'absolute',
          left: a.x - pad,
          top: a.y - pad,
          width: a.w + pad * 2,
          height: a.h + pad * 2,
          borderRadius: 6,
          backdropFilter: filter,
          WebkitBackdropFilter: filter,
          background: 'rgba(255,255,255,0.08)',
        }}
      />
    </DomLayer>
  );
}
