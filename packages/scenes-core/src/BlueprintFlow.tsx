import {
  SAFE,
  SceneFrame,
  sceneType,
  scenePalette,
  theme,
  tween,
  useOverlayTime,
  useSceneTiming,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import { FlowProps, flowOrder } from './flow';
import { activeStep, afterSteps, clamp01, easeOut, pop, stepTime } from './shared';

export const meta: OverlayMeta = {
  name: 'BlueprintFlow',
  kind: 'scene',
  description:
    'Blueprint look for a request flow: fine lines draw the stops on a grid, then a glowing request hops to each stop on its beat (or narration line) while the request builds up from the parts each stop reads. A closing reply lands on the next beat. Same props as DiagramFlow and LayeredPanels.',
  props: FlowProps,
  defaultDuration: 9,
};

/** The content area inside the frame's safe margin. */
const W = 1920 - 2 * SAFE;
const H = 1080 - 2 * SAFE;
const NODE_H = 170;
const NODE_Y = 330;
const MID = NODE_Y + NODE_H / 2;
const CELL = 60;

export default function BlueprintFlow({ props }: OverlayProps<FlowProps>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const stops = flowOrder(props);
  const n = stops.length;
  const gapMin = 64;
  const nodeW = Math.min(360, (W - (n - 1) * gapMin) / n);
  const gap = n > 1 ? (W - n * nodeW) / (n - 1) : 0;
  const x = (i: number) => i * (nodeW + gap);
  const at = (k: number) => stepTime(timing, k, n, duration);
  const k = activeStep(timing, n, duration, t);
  const replyAt = afterSteps(timing, n, duration);
  const wire = props.theme === 'wso2-dark' ? theme.color.steelLight : theme.color.steel;

  // The request waits on the wire out of each stop from its beat and runs along it to the next
  // stop's edge just before that beat (it never sits on a stop's text).
  const pos = (s: number): { x: number; y: number } | null => {
    if (k < 0 || s < at(0)) return null;
    for (let i = 0; i < n - 1; i++) {
      const next = at(i + 1);
      if (s < next) {
        const travel = Math.min(0.9, Math.max(0.3, (next - at(i)) * 0.6));
        const u = tween(s, next - travel, next);
        const a = x(i) + nodeW;
        return { x: a + (x(i + 1) - a) * u, y: MID };
      }
    }
    return { x: x(n - 1), y: MID };
  };
  const head = pos(t);
  const trail = [0.09, 0.06, 0.03, 0].map((lag) => pos(t - lag));
  const seen = clamp01((t - at(0)) * 4);

  // The request text: the parts of the stops reached so far, the latest one lit.
  const parts = stops.slice(0, k + 1).filter((s) => s.part);
  const showParts = stops.some((s) => s.part);
  const current = k >= 0 ? stops[k] : undefined;
  const done = props.reply !== '' && t >= replyAt;

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <svg
        aria-hidden="true"
        viewBox="0 0 1920 1080"
        style={{ position: 'absolute', left: -SAFE, top: -SAFE, width: 1920, height: 1080 }}
      >
        <g opacity={easeOut(t, 0, 0.8) * 0.7}>
          {Array.from({ length: 1920 / CELL + 1 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={i * CELL}
              y1={0}
              x2={i * CELL}
              y2={1080}
              stroke={p.line}
              strokeWidth={1}
              opacity={i % 4 ? 0.35 : 0.8}
            />
          ))}
          {Array.from({ length: 1080 / CELL + 1 }, (_, i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={i * CELL}
              x2={1920}
              y2={i * CELL}
              stroke={p.line}
              strokeWidth={1}
              opacity={i % 4 ? 0.35 : 0.8}
            />
          ))}
        </g>
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: `${W / 2}px ${H / 2}px`,
          transform: `scale(${1 + 0.035 * tween(t, 0, Math.max(duration, 1))})`,
        }}
      >
        <div
          style={{
            fontSize: sceneType.title + 8,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            opacity: easeOut(t, 0, 0.6),
            transform: `translateX(${(1 - easeOut(t, 0, 0.6)) * 40}px)`,
          }}
        >
          {props.title}
          <span style={{ color: accent }}>.</span>
        </div>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${W} ${H}`}
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'visible' }}
        >
          {stops.slice(0, -1).map((s, i) => (
            <line
              key={`w-${s.id}`}
              x1={x(i) + nodeW}
              y1={MID}
              x2={x(i + 1)}
              y2={MID}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - easeOut(t, 1.2 + i * 0.2, 1.8 + i * 0.2)}
              stroke={k > i ? accent : wire}
              strokeWidth={k > i ? 3.5 : 2.5}
              strokeLinecap="round"
            />
          ))}
          {stops.map((s, i) => {
            const lit = k >= i;
            const glow = lit ? 1 - 0.5 * easeOut(t, at(i), at(i) + 0.8) : 0;
            const text = easeOut(t, 0.9 + i * 0.25, 1.4 + i * 0.25);
            return (
              <g key={s.id}>
                <rect
                  x={x(i)}
                  y={NODE_Y}
                  width={nodeW}
                  height={NODE_H}
                  rx={18}
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - easeOut(t, 0.4 + i * 0.25, 1.2 + i * 0.25)}
                  stroke={lit ? accent : wire}
                  strokeWidth={2.5 + glow * 3}
                  fill={lit ? `rgba(255,88,0,${(0.06 + glow * 0.1).toFixed(3)})` : 'none'}
                />
                <text
                  x={x(i) + 40}
                  y={NODE_Y + 72}
                  fill={p.ink}
                  opacity={text}
                  style={{ fontFamily: theme.font.sans, fontSize: 30, fontWeight: 600 }}
                >
                  {s.label}
                </text>
                {s.part && (
                  <text
                    x={x(i) + 40}
                    y={NODE_Y + 120}
                    fill={p.muted}
                    opacity={text}
                    style={{ fontFamily: theme.font.mono, fontSize: 22 }}
                  >
                    {s.part}
                  </text>
                )}
              </g>
            );
          })}
          {head && (
            <circle
              cx={head.x}
              cy={head.y}
              r={30}
              fill={accent}
              opacity={(0.16 + 0.06 * Math.sin(t * 5)) * seen}
            />
          )}
          {trail.map((d, i) =>
            d ? (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={8 + i * 2}
                fill={accent}
                opacity={(1 - (3 - i) * 0.24) * seen}
              />
            ) : null,
          )}
        </svg>
        <div style={{ position: 'absolute', left: 0, top: 610, width: W }}>
          <div
            style={{
              fontFamily: theme.font.mono,
              fontSize: 44,
              fontWeight: 500,
              whiteSpace: 'pre',
              minHeight: 56,
              opacity: easeOut(t, at(0), at(0) + 0.4),
            }}
          >
            {showParts
              ? parts.map((s, i) => (
                  <span key={s.id} style={{ color: i === parts.length - 1 && !done ? accent : p.ink }}>
                    {s.part}
                  </span>
                ))
              : props.request}
          </div>
          {current?.detail && !done && (
            <div
              key={current.id}
              style={{
                marginTop: 18,
                fontSize: sceneType.body + 2,
                color: p.muted,
                opacity: easeOut(t, at(k), at(k) + 0.4),
                transform: `translateY(${(1 - easeOut(t, at(k), at(k) + 0.4)) * 10}px)`,
              }}
            >
              {current.detail}
            </div>
          )}
          {done && (
            <span
              style={{
                display: 'inline-block',
                marginTop: 18,
                padding: '8px 20px',
                borderRadius: 999,
                fontFamily: theme.font.mono,
                fontSize: 28,
                color: accent,
                background: 'rgba(255,88,0,0.16)',
                opacity: clamp01(pop(t, replyAt, replyAt + 0.5)),
                transform: `scale(${0.6 + 0.4 * pop(t, replyAt, replyAt + 0.5)})`,
                transformOrigin: 'left center',
              }}
            >
              {props.reply}
            </span>
          )}
        </div>
      </div>
    </SceneFrame>
  );
}
