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
import { ArchitectureProps, focusOrder } from './architecture';
import { clamp01, easeOut, pop, stepTime, span } from './shared';

export const meta: OverlayMeta = {
  name: 'DepthLayers',
  kind: 'scene',
  description:
    'The system as stacked see-through layers at an angle, one per box in focus (up to five). On each beat (or narration line) the next layer turns face-on with what is inside it and its detail beside it, then tilts back; at the end, when there is time, a request drops through every layer. Same props as BlueprintDive (the grid positions are not used).',
  props: ArchitectureProps,
  defaultDuration: 9,
};

const LEFT_W = 560;
const PW = 640;
const PH = 320;
const CX = 1120;
const TOP_Y = 220;
const BOTTOM_Y = 680;
const FACE = { x: 1110, y: 450 };

export default function DepthLayers({ props }: OverlayProps<ArchitectureProps>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const layers = focusOrder(props).slice(0, 5);
  const n = layers.length;
  const at = (k: number) => Math.max(stepTime(timing, k, n, duration), k === 0 ? 1.0 : 0);
  const last = n ? at(n - 1) : 0;
  const back = duration - last >= 2.4 ? duration - 1.0 : Infinity;
  const cy = (i: number) => (n > 1 ? TOP_Y + ((BOTTOM_Y - TOP_Y) * i) / (n - 1) : (TOP_Y + BOTTOM_Y) / 2);
  let k = -1;
  for (let i = 0; i < n; i++) if (t >= at(i) - 0.3) k = i;
  if (t >= back - 0.3) k = -1;
  const spread = n ? span(t, at(0) - 0.6, at(0)) * (1 - span(t, back - 0.5, back)) : 0;
  const title = easeOut(t, -0.4, 0.3);
  // After the tour: a request drops through every layer.
  const drop = clamp01((t - (back + 0.1)) / 0.65);
  const dropY = cy(0) - 120 + (cy(n - 1) + 120 - (cy(0) - 120)) * span(drop, 0, 1);
  const dropOn = t >= back + 0.1 ? 1 - easeOut(t, back + 0.75, back + 0.85) : 0;

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 200,
          width: LEFT_W,
          fontSize: sceneType.title + 8,
          lineHeight: 1.05,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          opacity: title,
          transform: `translateX(${(1 - title) * 40}px)`,
        }}
      >
        {props.title}
        <span style={{ color: accent }}>.</span>
      </div>
      {layers.map((l, i) => {
        if (!l.detail) return null;
        const next = i + 1 < n ? at(i + 1) : back;
        const nIn = easeOut(t, at(i), at(i) + 0.4);
        const nOut = easeOut(t, next - 0.5, next - 0.25);
        return (
          <div
            key={`note-${l.id}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 420,
              width: LEFT_W,
              fontSize: sceneType.body + 6,
              lineHeight: 1.3,
              color: p.muted,
              opacity: nIn * (1 - nOut),
              transform: `translateY(${(1 - nIn) * 18}px)`,
            }}
          >
            {l.detail}
          </div>
        );
      })}
      {layers.map((l, i) => {
        // Each layer comes face-on while it is explained, then tilts back into the stack.
        const b = at(i);
        const next = i + 1 < n ? at(i + 1) : back;
        const face = span(t, b - 0.55, b) * (1 - span(t, next - 0.55, next));
        const enter = pop(t, -0.4 + i * 0.15, 0.2 + i * 0.15, 1.4);
        const f = 1 - face;
        const away = k >= 0 && i !== k ? (i < k ? -1 : 1) * 60 * spread : 0;
        const y = (cy(i) + away + (1 - clamp01(enter)) * -80) * f + FACE.y * face;
        const x = CX * f + FACE.x * face;
        const s = (1 + 0.12 * face) * (1 + 0.006 * Math.sin((t + i) * 2));
        const dim = k >= 0 && i !== k ? 1 - 0.68 * spread : 1;
        return (
          <div
            key={l.id}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: PW,
              height: PH,
              boxSizing: 'border-box',
              padding: '30px 36px',
              borderRadius: 22,
              background:
                props.theme === 'wso2-dark'
                  ? `rgba(36,52,80,${(0.9 + 0.1 * face).toFixed(3)})`
                  : `rgba(255,255,255,${(0.94 + 0.06 * face).toFixed(3)})`,
              border: `2px solid ${i === k ? accent : p.line}`,
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              transformOrigin: '0 0',
              zIndex: i === k ? 10 : n - i,
              opacity: clamp01(enter) * dim,
              transform: `translate(${x}px, ${y}px) scale(${s}) rotate(${-30 * f}deg) skewX(${30 * f}deg) scaleY(${1 - 0.14 * f}) translate(${-PW / 2}px, ${-PH / 2}px)`,
            }}
          >
            <span
              style={{
                fontFamily: theme.font.mono,
                fontSize: 20,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: p.muted,
              }}
            >
              Layer {i + 1}
            </span>
            <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.01em' }}>{l.label}</span>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 'auto' }}>
              {l.inner.map((c, j) => {
                const a = easeOut(t, b - 0.1 + j * 0.12, b + 0.3 + j * 0.12) * face;
                return (
                  <span
                    key={j}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 999,
                      fontFamily: theme.font.mono,
                      fontSize: 22,
                      color: accent,
                      background: 'rgba(255,88,0,0.16)',
                      opacity: 0.5 + 0.5 * a,
                      transform: `translateY(${-4 * a}px)`,
                    }}
                  >
                    {c}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      {dropOn > 0 && (
        <svg
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            overflow: 'visible',
            zIndex: 20,
          }}
        >
          <circle cx={CX} cy={dropY} r={30} fill={accent} opacity={0.2 * dropOn} />
          <circle cx={CX} cy={dropY} r={11} fill={accent} opacity={dropOn} />
        </svg>
      )}
    </SceneFrame>
  );
}
