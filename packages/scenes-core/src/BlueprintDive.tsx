import {
  SAFE,
  SceneFrame,
  sceneType,
  scenePalette,
  theme,
  useOverlayTime,
  useSceneTiming,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import { ArchitectureProps, focusOrder } from './architecture';
import { clamp01, easeOut, stepTime, span } from './shared';

export const meta: OverlayMeta = {
  name: 'BlueprintDive',
  kind: 'scene',
  description:
    'A system map on a fine grid (boxes on a 12×6 grid, links with requests flowing along them). On each beat (or narration line) the camera dives into the next box in focus, which opens to show what is inside, with its detail below; it pulls back out at the end when there is time. Same props as DepthLayers.',
  props: ArchitectureProps,
  defaultDuration: 9,
};

const W = 1920 - 2 * SAFE;
const AREA = { top: 170, h: 600 };
/** Where the camera's look-at point sits on screen (content px), between the title and the note. */
const EYE = { x: W / 2, y: 440 };
const CELL = 40;

interface View {
  t: number;
  cx: number;
  cy: number;
  z: number;
}

export default function BlueprintDive({ props }: OverlayProps<ArchitectureProps>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const wire = props.theme === 'wso2-dark' ? theme.color.steelLight : theme.color.steel;
  const cw = W / 12;
  const ch = AREA.h / 6;
  const rect = (b: ArchitectureProps['boxes'][number]) => ({
    x: b.x * cw,
    y: AREA.top + b.y * ch,
    w: b.w * cw,
    h: b.h * ch,
  });
  const order = focusOrder(props);
  const n = order.length;
  // The first dive waits for the map to establish.
  const at = (k: number) => Math.max(stepTime(timing, k, n, duration), k === 0 ? 1.4 : 0);
  const last = n ? at(n - 1) : 0;
  const out = duration - last >= 2.4 ? duration - 0.9 : Infinity;

  const overview: Omit<View, 't'> = { cx: EYE.x, cy: EYE.y, z: 1 };
  const keys: View[] = [{ t: -Infinity, ...overview }];
  order.forEach((b, i) => {
    const r = rect(b);
    keys.push({ t: at(i), cx: r.x + r.w / 2, cy: r.y + r.h / 2, z: Math.min(2.3, 640 / r.h, 1500 / r.w) });
  });
  if (out < Infinity) keys.push({ t: out, ...overview });
  let a = keys[0]!;
  let b = keys[0]!;
  for (let i = 0; i < keys.length; i++)
    if (t >= keys[i]!.t - 0.9) {
      a = keys[Math.max(0, i - 1)]!;
      b = keys[i]!;
    }
  const u = span(t, b.t - 0.9, b.t);
  const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * u);
  const cx = a.cx + (b.cx - a.cx) * u;
  const cy = a.cy + (b.cy - a.cy) * u;

  // Which box the view is on (−1 on the map).
  let k = -1;
  for (let i = 0; i < n; i++) if (t >= at(i) - 0.45) k = i;
  if (t >= out - 0.2) k = -1;
  const focused = k >= 0 ? order[k] : undefined;
  const close = n ? span(t, at(0) - 0.9, at(0) - 0.45) * (1 - span(t, out - 0.3, out + 0.2)) : 0;
  const intro = easeOut(t, -0.4, 0.3);

  const centre = (id: string) => {
    const bx = props.boxes.find((x) => x.id === id);
    return bx ? rect(bx) : null;
  };

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          position: 'absolute',
          inset: -SAFE,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: SAFE,
            top: SAFE,
            width: W,
            height: 1080 - 2 * SAFE,
            transformOrigin: '0 0',
            transform: `translate(${EYE.x}px, ${EYE.y}px) scale(${z}) translate(${-cx}px, ${-cy}px)`,
          }}
        >
          <svg
            aria-hidden="true"
            width={3 * W}
            height={3 * 1080}
            viewBox={`${-W} ${-1080} ${3 * W} ${3 * 1080}`}
            style={{ position: 'absolute', left: -W, top: -1080, overflow: 'visible' }}
          >
            <g opacity={easeOut(t, -0.3, 0.5) * 0.7}>
              {Array.from({ length: Math.ceil((3 * W) / CELL) + 1 }, (_, i) => {
                const x = -W + i * CELL;
                return (
                  <line
                    key={`v${i}`}
                    x1={x}
                    y1={-1080}
                    x2={x}
                    y2={2160}
                    stroke={p.line}
                    strokeWidth={1}
                    opacity={i % 4 ? 0.3 : 0.75}
                  />
                );
              })}
              {Array.from({ length: Math.ceil((3 * 1080) / CELL) + 1 }, (_, i) => {
                const y = -1080 + i * CELL;
                return (
                  <line
                    key={`h${i}`}
                    x1={-W}
                    y1={y}
                    x2={2 * W}
                    y2={y}
                    stroke={p.line}
                    strokeWidth={1}
                    opacity={i % 4 ? 0.3 : 0.75}
                  />
                );
              })}
            </g>
            {props.links.map(([from, to], i) => {
              const ra = centre(from);
              const rb = centre(to);
              if (!ra || !rb) return null;
              const ax = ra.x + ra.w / 2;
              const ay = ra.y + ra.h / 2;
              const dx = rb.x + rb.w / 2 - ax;
              const dy = rb.y + rb.h / 2 - ay;
              // From edge to edge: where the centre-to-centre line leaves each box.
              const exit = (r: { w: number; h: number }) =>
                Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
              const s0 = exit(ra);
              const s1 = 1 - exit(rb);
              if (s1 <= s0) return null;
              const draw = easeOut(t, 0.3 + i * 0.2, 0.9 + i * 0.2);
              const ph = (t * 0.7 + i * 0.37) % 1;
              const s = s0 + (s1 - s0) * ph;
              return (
                <g key={`${from}-${to}`}>
                  <line
                    x1={ax + dx * s0}
                    y1={ay + dy * s0}
                    x2={ax + dx * s1}
                    y2={ay + dy * s1}
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - draw}
                    stroke={wire}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={ax + dx * s}
                    cy={ay + dy * s}
                    r={7}
                    fill={accent}
                    opacity={clamp01(t - 1) * Math.sin(Math.PI * ph)}
                  />
                </g>
              );
            })}
          </svg>
          {props.boxes.map((bx, i) => {
            const r = rect(bx);
            const on = focused?.id === bx.id;
            const fi = order.findIndex((o) => o.id === bx.id);
            const enter = easeOut(t, -0.3 + i * 0.12, 0.2 + i * 0.12);
            // How far the box has opened: its parts show as the camera arrives.
            const leave = fi >= 0 ? (fi + 1 < n ? at(fi + 1) : out) : -Infinity;
            const open =
              fi >= 0
                ? clamp01(easeOut(t, at(fi) - 0.45, at(fi) + 0.25) - span(t, leave - 0.8, leave - 0.3))
                : 0;
            const m = bx.inner.length;
            const rowH = m ? Math.min(72, (r.h - 96 - 14 * (m - 1)) / m) : 0;
            return (
              <div
                key={bx.id}
                style={{
                  position: 'absolute',
                  left: r.x + 6,
                  top: r.y + 6,
                  width: r.w - 12,
                  height: r.h - 12,
                  boxSizing: 'border-box',
                  borderRadius: 16,
                  border: `2.5px solid ${on ? accent : wire}`,
                  background: props.theme === 'wso2-dark' ? 'rgba(19,33,59,0.92)' : '#FFFFFF',
                  boxShadow: on ? '0 0 0 8px rgba(255,88,0,0.16)' : 'none',
                  opacity: enter * (close > 0 && !on ? 1 - 0.7 * close : 1),
                  transform: `translateY(${(1 - enter) * 20}px)`,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    textAlign: 'center',
                    padding: 12,
                    fontSize: sceneType.heading - 10,
                    fontWeight: 700,
                    opacity: 1 - clamp01(open * 3 - 1),
                  }}
                >
                  {bx.label}
                </span>
                <span
                  style={{
                    position: 'absolute',
                    left: 22,
                    right: 22,
                    top: 18,
                    fontSize: 24,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: clamp01(open * 3 - 2),
                  }}
                >
                  {bx.label}
                </span>
                {bx.inner.map((s, j) => {
                  const a =
                    clamp01(open * 2.5 - 1.5) * easeOut(t, at(fi) - 0.25 + j * 0.15, at(fi) + 0.2 + j * 0.15);
                  return (
                    <span
                      key={j}
                      style={{
                        position: 'absolute',
                        left: 22,
                        right: 22,
                        top: 70 + j * (rowH + 14),
                        height: rowH,
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 18px',
                        borderRadius: 12,
                        border: `1.5px solid ${wire}`,
                        fontSize: Math.min(24, rowH * 0.42),
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        opacity: a,
                        transform: `translateY(${(1 - a) * 14}px)`,
                      }}
                    >
                      {s}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          fontSize: sceneType.title + 8,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          opacity: intro * (1 - close),
          transform: `translateX(${(1 - intro) * 40}px)`,
        }}
      >
        {props.title}
        <span style={{ color: accent }}>.</span>
      </div>
      {order.map((bx, i) => {
        if (!bx.detail) return null;
        const next = i + 1 < n ? at(i + 1) : out;
        const nIn = easeOut(t, at(i), at(i) + 0.4);
        const nOut = easeOut(t, next - 0.6, next - 0.3);
        return (
          <div
            key={bx.id}
            style={{
              position: 'absolute',
              left: 0,
              top: 830,
              fontSize: sceneType.body + 6,
              color: p.muted,
              opacity: nIn * (1 - nOut),
              transform: `translateY(${(1 - nIn) * 18}px)`,
            }}
          >
            {bx.detail}
          </div>
        );
      })}
    </SceneFrame>
  );
}
