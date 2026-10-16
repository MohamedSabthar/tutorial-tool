import { z } from 'zod';
import type { RecorderEvent } from '@studio/core';
import {
  DomLayer,
  theme,
  useOverlayTime,
  useRecording,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import { sourceToStage } from '@studio/stage';

type Mouse = Extract<RecorderEvent, { kind: 'mouse' }>;
type Click = Extract<RecorderEvent, { kind: 'click' }>;

/** Pointer position (source px) at source time `st`, from the recorded mouse paths. */
export function pointerAt(events: RecorderEvent[], st: number): { x: number; y: number } | null {
  let last: { x: number; y: number } | null = null;
  for (const e of events) {
    if (e.kind !== 'mouse') continue;
    const pts = (e as Mouse).points;
    for (let i = 0; i < pts.length; i++) {
      const [pt, x, y] = pts[i]!;
      if (pt > st) {
        if (!last) return { x, y };
        const prev = pts[i - 1];
        if (prev && prev[0] < st) {
          const u = (st - prev[0]) / (pt - prev[0]);
          return { x: prev[1] + (x - prev[1]) * u, y: prev[2] + (y - prev[2]) * u };
        }
        return last;
      }
      last = { x, y };
    }
  }
  return last;
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

const CursorProps = z.object({
  style: z.enum(['arrow', 'dot']).default('arrow'),
  /** Size in stage px. */
  size: z.number().min(12).max(96).default(34),
});
type CursorProps = z.infer<typeof CursorProps>;

export const cursorMeta: OverlayMeta = {
  name: 'Cursor',
  description:
    'The recorded mouse pointer, drawn from the take’s mouse paths (the product never shows a cursor itself).',
  props: CursorProps,
};

export function Cursor({ props }: OverlayProps<CursorProps>) {
  const rec = useRecording();
  const { global: t } = useOverlayTime();
  if (!rec) return null;
  const p = pointerAt(rec.events, rec.sourceTime(t));
  if (!p) return null;
  const s = sourceToStage({ x: p.x, y: p.y, w: 0, h: 0 }, rec.fit);
  const size = props.size ?? 34;
  return (
    <DomLayer follow>
      {props.style === 'dot' ? (
        <span
          style={{
            position: 'absolute',
            left: s.x - size / 4,
            top: s.y - size / 4,
            width: size / 2,
            height: size / 2,
            borderRadius: '50%',
            background: 'rgba(255,88,0,0.85)',
            boxShadow: '0 0 0 4px rgba(255,255,255,0.8)',
          }}
        />
      ) : (
        <svg
          width={size}
          height={size * 1.15}
          viewBox="0 0 24 28"
          style={{
            position: 'absolute',
            left: s.x - size * 0.08,
            top: s.y - size * 0.07,
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))',
          }}
        >
          <path
            d="M2 2l18 11-8 2-3 9z"
            fill={theme.color.white}
            stroke="#111111"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        </svg>
      )}
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// ClickRipple
// ---------------------------------------------------------------------------

const RippleProps = z.object({
  color: z.string().default(theme.color.orange),
  /** Seconds each ripple lasts. */
  length: z.number().min(0.2).max(2).default(0.6),
});
type RippleProps = z.infer<typeof RippleProps>;

export const clickRippleMeta: OverlayMeta = {
  name: 'ClickRipple',
  description: 'An expanding ring at every recorded click.',
  props: RippleProps,
};

export function ClickRipple({ props }: OverlayProps<RippleProps>) {
  const rec = useRecording();
  const { global: t } = useOverlayTime();
  if (!rec) return null;
  const st = rec.sourceTime(t);
  const length = props.length ?? 0.6;
  const active = rec.events.filter((e): e is Click => e.kind === 'click' && st >= e.t && st <= e.t + length);
  return (
    <DomLayer follow>
      {active.map((c, i) => {
        const u = (st - c.t) / length;
        const p = sourceToStage({ x: c.x, y: c.y, w: 0, h: 0 }, rec.fit);
        const r = 10 + 34 * (1 - Math.pow(1 - u, 3));
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: p.x - r,
              top: p.y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: '50%',
              border: `4px solid ${props.color ?? theme.color.orange}`,
              opacity: 1 - u,
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </DomLayer>
  );
}
