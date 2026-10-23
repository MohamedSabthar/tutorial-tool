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
import { ConceptProps } from './concepts';
import { activeStep, clamp01, easeOut, pop, stepTime } from './shared';

export const meta: OverlayMeta = {
  name: 'CardDeck',
  kind: 'scene',
  description:
    'Concept cards dealt from a stack: on each beat (or narration line) the next card arcs out to its place in a row and flips face up, the newest lifted. Up to four terms with a line each. Same props as TermSpotlight.',
  props: ConceptProps,
  defaultDuration: 8,
};

const W = 1920 - 2 * SAFE;
const TOP = 230;
const CARD_H = 540;
const GAP = 48;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export default function CardDeck({ props }: OverlayProps<ConceptProps>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const cards = props.cards;
  const n = cards.length;
  const at = (k: number) => stepTime(timing, k, n, duration);
  const k = activeStep(timing, n, duration, t);
  const cardW = Math.min(500, (W - GAP * (n - 1)) / n);
  const left = (W - (n * cardW + (n - 1) * GAP)) / 2;
  const intro = easeOut(t, -0.4, 0.4);
  const face = props.theme === 'wso2-dark' ? '#24344F' : '#FFFFFF';

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          fontSize: sceneType.title + 8,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          opacity: intro,
          transform: `translateX(${(1 - intro) * 40}px)`,
        }}
      >
        {props.title}
        <span style={{ color: accent }}>.</span>
      </div>
      {cards.map((c, i) => {
        const b = at(i);
        // Dealt on an arc from the stack to its place, just before its beat.
        const deal = ease(clamp01((t - (b - 0.75)) / 0.75));
        const sx = W / 2 - cardW / 2 + (n - 1 - i) * 6;
        const sy = TOP + 200 + (n - 1 - i) * 6;
        const tx = left + i * (cardW + GAP);
        const tilt = n > 1 ? (i / (n - 1) - 0.5) * 6 : 0;
        const x = sx + (tx - sx) * deal;
        const y = sy + (TOP - sy) * deal - Math.sin(Math.PI * deal) * 90;
        const rot =
          (-6 + i * 4) * (1 - deal) + tilt * deal + Math.sin(Math.PI * deal) * 8 * (i - (n - 1) / 2);
        const enter = easeOut(t, -0.5 + (n - 1 - i) * 0.12, 0 + (n - 1 - i) * 0.12);
        // The flip: the back narrows to nothing, then the face opens out with a small overshoot.
        const backW = 1 - ease(clamp01((t - (b - 0.05)) / 0.2));
        const shown = t >= b + 0.15;
        const frontW = shown ? pop(t, b + 0.15, b + 0.5, 1.6) : 0;
        const now = i === k;
        const lift = now ? easeOut(t, b + 0.3, b + 0.7) : 0;
        const settle = i < k ? easeOut(t, at(k) + 0.2, at(k) + 0.6) : 0;
        const breathe = 1 + 0.006 * Math.sin((t + i * 0.9) * 2);
        const sides = { position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: 22 } as const;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: cardW,
              height: CARD_H,
              opacity: enter,
              zIndex: t < b - 0.75 ? 10 - i : now ? 20 : 10 + i,
              transform: `translate(${x}px, ${y - 18 * lift}px) rotate(${rot}deg) scale(${breathe * (1 + 0.03 * lift)})`,
            }}
          >
            {backW > 0.001 && (
              <div
                style={{
                  ...sides,
                  display: 'grid',
                  placeItems: 'center',
                  background: accent,
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
                  transform: `scaleX(${backW})`,
                }}
              >
                <span
                  style={{
                    fontFamily: theme.font.mono,
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: '0.2em',
                    color: '#FFFFFF',
                  }}
                >
                  WSO2
                </span>
              </div>
            )}
            {shown && (
              <div
                style={{
                  ...sides,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18,
                  padding: '40px 42px',
                  background: face,
                  border: `2px solid ${now ? accent : p.line}`,
                  boxShadow: now ? '0 34px 80px rgba(0,0,0,0.45)' : '0 24px 60px rgba(0,0,0,0.3)',
                  opacity: 1 - 0.4 * settle,
                  transform: `scaleX(${frontW})`,
                }}
              >
                <span
                  style={{
                    alignSelf: 'flex-start',
                    padding: '6px 16px',
                    borderRadius: 999,
                    fontFamily: theme.font.mono,
                    fontSize: 22,
                    color: accent,
                    background: 'rgba(255,88,0,0.16)',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</span>
                <span style={{ width: 56, height: 4, borderRadius: 2, background: accent }} />
                <span style={{ fontSize: 28, lineHeight: 1.35, color: p.muted }}>{c.text}</span>
              </div>
            )}
          </div>
        );
      })}
    </SceneFrame>
  );
}
