import { z } from 'zod';
import {
  SceneFrame,
  sceneType,
  scenePalette,
  tween,
  useOverlayTime,
  useSceneTiming,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import { activeStep, stepTime } from './shared';

const Box = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().default(''),
  /** Position and size on a 12×6 grid. */
  x: z.number().min(0).max(12),
  y: z.number().min(0).max(6),
  w: z.number().min(1).max(12),
  h: z.number().min(1).max(6),
});

const Props = z.object({
  title: z.string().default('Where it fits'),
  eyebrow: z.string().default(''),
  boxes: z
    .array(Box)
    .min(1)
    .max(10)
    .default([
      {
        id: 'clients',
        label: 'Clients',
        detail: 'Apps and services that call your API',
        x: 0,
        y: 2,
        w: 2,
        h: 2,
      },
      {
        id: 'integrator',
        label: 'WSO2 Integrator',
        detail: 'Your HTTP service runs here',
        x: 4,
        y: 1,
        w: 4,
        h: 4,
      },
      { id: 'backends', label: 'Back ends', detail: 'Databases and other services', x: 10, y: 2, w: 2, h: 2 },
    ]),
  /** Box ids to zoom into, one per beat (or narration line). */
  focus: z.array(z.string()).default(['clients', 'integrator', 'backends']),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'ArchitectureZoom',
  kind: 'scene',
  description:
    'An architecture diagram of labelled boxes; on each beat (or narration line) the view zooms into one box and shows its detail.',
  props: Props,
  defaultDuration: 9,
};

const AREA = { w: 1752, h: 720, top: 160 };

export default function ArchitectureZoom({ props }: OverlayProps<Props>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const cell = { w: AREA.w / 12, h: AREA.h / 6 };
  const n = props.focus.length;
  const k = activeStep(timing, n, duration, t);
  const intro = tween(t, 0, 0.6);
  const view = (id: string | undefined) => {
    const b = props.boxes.find((x) => x.id === id);
    if (!b) return { z: 1, cx: AREA.w / 2, cy: AREA.h / 2 };
    const z = Math.min(2.2, Math.min(AREA.w / (b.w * cell.w * 1.6), AREA.h / (b.h * cell.h * 1.6)));
    return { z, cx: (b.x + b.w / 2) * cell.w, cy: (b.y + b.h / 2) * cell.h };
  };
  const a = view(props.focus[k - 1]);
  const b = view(props.focus[k]);
  const u =
    k >= 0 ? tween(t, stepTime(timing, k, n, duration) - 0.2, stepTime(timing, k, n, duration) + 0.6) : 0;
  const zoom = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * u);
  const cx = a.cx + (b.cx - a.cx) * u;
  const cy = a.cy + (b.cy - a.cy) * u;
  const focused = props.boxes.find((x) => x.id === props.focus[k]);
  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div style={{ fontSize: sceneType.title, fontWeight: 700, letterSpacing: '-0.02em', opacity: intro }}>
        {props.title}
        <span style={{ color: p.accent }}>.</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: AREA.top,
          width: AREA.w,
          height: AREA.h,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: AREA.w,
            height: AREA.h,
            transformOrigin: '0 0',
            transform: `translate(${AREA.w / 2}px, ${AREA.h / 2}px) scale(${zoom}) translate(${-cx}px, ${-cy}px)`,
          }}
        >
          {props.boxes.map((bx, i) => {
            const on = bx.id === props.focus[k];
            const enter = tween(t, 0.2 + i * 0.1, 0.7 + i * 0.1);
            return (
              <div
                key={bx.id}
                style={{
                  position: 'absolute',
                  left: bx.x * cell.w + 8,
                  top: bx.y * cell.h + 8,
                  width: bx.w * cell.w - 16,
                  height: bx.h * cell.h - 16,
                  boxSizing: 'border-box',
                  borderRadius: 16,
                  border: `3px solid ${on ? p.accent : p.line}`,
                  background: p.panel,
                  display: 'grid',
                  placeItems: 'center',
                  textAlign: 'center',
                  padding: 12,
                  fontSize: sceneType.heading - 8,
                  fontWeight: 600,
                  opacity: enter,
                }}
              >
                {bx.label}
              </div>
            );
          })}
        </div>
      </div>
      {focused?.detail && (
        <div
          key={focused.id}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 40,
            textAlign: 'center',
            fontSize: sceneType.body + 2,
            color: p.muted,
            opacity: tween(t, stepTime(timing, k, n, duration) + 0.2, stepTime(timing, k, n, duration) + 0.6),
          }}
        >
          {focused.detail}
        </div>
      )}
    </SceneFrame>
  );
}
