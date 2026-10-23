import {
  SceneFrame,
  sceneType,
  scenePalette,
  theme,
  useOverlayTime,
  useSceneTiming,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import { FlowProps, flowOrder } from './flow';
import { activeStep, afterSteps, clamp01, easeOut, pop, stepTime } from './shared';

export const meta: OverlayMeta = {
  name: 'LayeredPanels',
  kind: 'scene',
  description:
    'Layered-panels look for a request flow: one translucent panel per stop slides in and stacks in depth; on each beat (or narration line) the request reaches the next stop, its panel lifts forward and the stop lights on a rail beside the request. A closing reply lands on the next beat. Same props as BlueprintFlow.',
  props: FlowProps,
  defaultDuration: 9,
};

const LEFT_W = 600;
const STACK_X = 720;
const STACK_TOP = 110;
const STACK_BOTTOM = 820;
const PANEL_W = 740;
const PANEL_H = 230;

export default function LayeredPanels({ props }: OverlayProps<FlowProps>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const stops = flowOrder(props);
  const n = stops.length;
  const at = (k: number) => stepTime(timing, k, n, duration);
  const k = activeStep(timing, n, duration, t);
  const replyAt = afterSteps(timing, n, duration);
  const done = props.reply !== '' && t >= replyAt;
  const dx = n > 1 ? Math.min(90, 260 / (n - 1)) : 0;
  const dy = n > 1 ? Math.min(170, (STACK_BOTTOM - STACK_TOP - PANEL_H) / (n - 1)) : 0;
  const card = props.theme === 'wso2-dark' ? 'rgba(36,52,80,0.94)' : 'rgba(255,255,255,0.96)';
  const title = easeOut(t, 0, 0.6);
  const req = easeOut(t, 0.5, 1.0);

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          width: LEFT_W,
          fontSize: sceneType.title + 4,
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: '-0.02em',
          opacity: title,
          transform: `translateX(${(1 - title) * 40}px)`,
        }}
      >
        {props.title}
        <span style={{ color: accent }}>.</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 330,
          width: LEFT_W,
          opacity: req,
          transform: `translateX(${(1 - req) * -30}px)`,
        }}
      >
        <div style={{ fontFamily: theme.font.mono, fontSize: 34, fontWeight: 500, marginBottom: 18 }}>
          {props.request}
        </div>
        {stops.map((s, i) => {
          const on = k >= i;
          const grow = on ? pop(t, at(i), at(i) + 0.35, 1.8) : 1;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 18, height: 58 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  border: `2px solid ${on ? accent : theme.color.steel}`,
                  background: on ? accent : 'transparent',
                  transform: `scale(${grow})`,
                }}
              />
              <span style={{ fontSize: 28, opacity: on ? 1 : 0.5 }}>{s.label}</span>
            </div>
          );
        })}
      </div>
      {stops.map((s, i) => {
        const enter = clamp01(pop(t, 0.4 + i * 0.25, 1.2 + i * 0.25, 1.5));
        const slide = 1 - pop(t, 0.4 + i * 0.25, 1.2 + i * 0.25, 1.5);
        const active = k === i && !done;
        const leave = i + 1 < n ? at(i + 1) : done ? replyAt : Infinity;
        const lift = active ? easeOut(t, at(i), at(i) + 0.45) * (1 - easeOut(t, leave - 0.3, leave)) : 0;
        const breathe = 1 + 0.006 * Math.sin((t + i) * 2.1);
        const dim = k >= 0 && !active && !(done && i === n - 1);
        return (
          <div
            key={s.id}
            style={{
              position: 'absolute',
              left: STACK_X + i * dx,
              top: STACK_TOP + i * dy,
              width: PANEL_W,
              height: PANEL_H,
              boxSizing: 'border-box',
              padding: '30px 36px',
              borderRadius: 22,
              background: card,
              border: `2px solid ${active || (done && i === n - 1) ? accent : p.line}`,
              boxShadow: active ? '0 30px 70px rgba(0,0,0,0.45)' : '0 22px 56px rgba(0,0,0,0.3)',
              zIndex: active ? 10 : i,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              opacity: enter * (dim ? 0.55 : 1),
              transform: `translate(${slide * 700}px, ${-22 * lift}px) scale(${breathe * (1 + 0.035 * lift)})`,
            }}
          >
            <span
              style={{
                alignSelf: 'flex-start',
                padding: '5px 14px',
                borderRadius: 999,
                fontFamily: theme.font.mono,
                fontSize: 20,
                color: accent,
                background: 'rgba(255,88,0,0.16)',
              }}
            >
              {s.part || `Stop ${i + 1}`}
            </span>
            <span style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.01em' }}>{s.label}</span>
            {s.detail && <span style={{ fontSize: 25, color: p.muted }}>{s.detail}</span>}
          </div>
        );
      })}
      {done && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 780,
            width: LEFT_W,
            boxSizing: 'border-box',
            padding: '22px 30px',
            borderRadius: 22,
            background: card,
            border: `2px solid ${accent}`,
            fontSize: 32,
            fontWeight: 700,
            opacity: easeOut(t, replyAt, replyAt + 0.5),
            transform: `translateY(${(1 - easeOut(t, replyAt, replyAt + 0.5)) * 26}px)`,
          }}
        >
          {props.reply}
        </div>
      )}
    </SceneFrame>
  );
}
