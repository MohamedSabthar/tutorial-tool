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
import { FlowProps } from './flow';
import { activeStep, stepTime } from './shared';

const Props = FlowProps;
type Props = FlowProps;

export const meta: OverlayMeta = {
  name: 'DiagramFlow',
  kind: 'scene',
  description:
    'Boxes in a row with a packet travelling between them: one hop per beat (or per narration line), each box lighting up with its detail as it is reached. Good for request flows and pipelines. Same props as BlueprintFlow and LayeredPanels (it shows labels and details only).',
  props: Props,
  defaultDuration: 8,
};

const W = 1920 - 168;
const NODE_W = 280;
const NODE_H = 170;

export default function DiagramFlow({ props }: OverlayProps<Props>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const nodes = props.nodes;
  const flow = (props.flow.length ? props.flow : nodes.map((n) => n.id)).filter((id) =>
    nodes.some((n) => n.id === id),
  );
  const steps = flow.length;
  const gap = (W - nodes.length * NODE_W) / Math.max(nodes.length - 1, 1);
  const x = (id: string) => nodes.findIndex((n) => n.id === id) * (NODE_W + gap);
  const y = 430;
  const at = (k: number) => stepTime(timing, k, steps, duration);
  const k = activeStep(timing, steps, duration, t);
  const intro = tween(t, 0, 0.6);

  // The packet: at the first node from its beat, then hopping, arriving at each later beat.
  let packet: { x: number; o: number } | null = null;
  if (k >= 0) {
    const nextK = k + 1;
    const leave = nextK < steps ? at(nextK) - 0.7 : Infinity;
    const u = nextK < steps ? tween(t, leave, at(nextK)) : 0;
    const from = x(flow[k]!) + NODE_W / 2;
    const to = nextK < steps ? x(flow[nextK]!) + NODE_W / 2 : from;
    packet = { x: from + (to - from) * u, o: tween(t, at(0) - 0.2, at(0) + 0.2) };
  }
  const current = k >= 0 ? nodes.find((n) => n.id === flow[k]) : undefined;

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          fontSize: sceneType.title,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          opacity: intro,
          transform: `translateY(${(1 - intro) * 16}px)`,
        }}
      >
        {props.title}
        <span style={{ color: p.accent }}>.</span>
      </div>
      {/* edges */}
      {nodes.slice(1).map((n, i) => {
        const a = x(nodes[i]!.id) + NODE_W;
        const lit = flow.indexOf(n.id) >= 0 && k >= flow.indexOf(n.id);
        return (
          <div
            key={`e-${n.id}`}
            style={{
              position: 'absolute',
              left: a + 12,
              top: y + NODE_H / 2 - 2,
              width: gap - 24,
              height: 4,
              borderRadius: 2,
              background: lit ? p.accent : p.line,
              opacity: intro,
            }}
          >
            <span
              style={{
                position: 'absolute',
                right: -2,
                top: -8,
                borderLeft: `14px solid ${lit ? p.accent : p.line}`,
                borderTop: '10px solid transparent',
                borderBottom: '10px solid transparent',
              }}
            />
          </div>
        );
      })}
      {/* nodes */}
      {nodes.map((n, i) => {
        const order = flow.indexOf(n.id);
        const reached = order >= 0 && k >= order;
        const pop = order >= 0 ? tween(t, at(order) - 0.1, at(order) + 0.25) : 0;
        const enter = tween(t, 0.15 + i * 0.12, 0.6 + i * 0.12);
        return (
          <div
            key={n.id}
            style={{
              position: 'absolute',
              left: x(n.id),
              top: y,
              width: NODE_W,
              height: NODE_H,
              borderRadius: 18,
              boxSizing: 'border-box',
              border: `3px solid ${reached ? p.accent : p.line}`,
              background: p.panel,
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              padding: 16,
              fontSize: sceneType.heading - 6,
              fontWeight: 600,
              opacity: enter * (reached ? 1 : 0.55),
              transform: `translateY(${(1 - enter) * 20}px) scale(${1 + 0.06 * pop * (1 - tween(t, at(order) + 0.25, at(order) + 0.6))})`,
              boxShadow: reached ? '0 0 0 10px rgba(255,88,0,0.14)' : 'none',
            }}
          >
            {n.label}
          </div>
        );
      })}
      {packet && (
        <span
          style={{
            position: 'absolute',
            left: packet.x - 14,
            top: y - 44,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: p.accent,
            opacity: packet.o,
            boxShadow: '0 0 24px rgba(255,88,0,0.8)',
          }}
        />
      )}
      {current?.detail && (
        <div
          key={current.id}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: y + NODE_H + 90,
            textAlign: 'center',
            fontSize: sceneType.body + 4,
            color: p.muted,
            opacity: tween(t, at(k), at(k) + 0.35),
          }}
        >
          {current.detail}
        </div>
      )}
    </SceneFrame>
  );
}
