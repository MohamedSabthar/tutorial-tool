import {
  SAFE,
  SceneFrame,
  scenePalette,
  theme,
  useOverlayTime,
  useSceneTiming,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';
import { ConceptProps } from './concepts';
import { clamp01, easeOut, pop, stepTime, span } from './shared';

export const meta: OverlayMeta = {
  name: 'TermSpotlight',
  kind: 'scene',
  description:
    'One big term at a time: on each beat (or narration line) a term rises into the spotlight with its meaning and an underline, and the one before shrinks into a numbered index strip below. Up to four terms. Same props as CardDeck.',
  props: ConceptProps,
  defaultDuration: 8,
};

const W = 1920 - 2 * SAFE;
const HERO_Y = 190;
const MAX_SIZE = 168;
const STRIP_Y = 760;
const SMALL = 40;

export default function TermSpotlight({ props }: OverlayProps<ConceptProps>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const terms = props.cards;
  const n = terms.length;
  const at = (k: number) => stepTime(timing, k, n, duration);
  const slotW = W / n;
  // Long terms get smaller so they stay on one line.
  const size = (s: string) => Math.min(MAX_SIZE, (W * 0.95) / Math.max(1, s.length * 0.6));
  const title = easeOut(t, -0.4, 0.3);

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          fontSize: 34,
          fontWeight: 600,
          color: p.muted,
          opacity: title,
          transform: `translateX(${(1 - title) * 30}px)`,
        }}
      >
        {props.title}
      </div>
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: STRIP_Y - 30,
          width: W,
          height: 2,
          background: p.line,
          transformOrigin: '0 50%',
          transform: `scaleX(${n > 1 ? span(t, at(1) - 0.9, at(1) - 0.3) : 0})`,
        }}
      />
      {terms.map((c, i) => {
        const b = at(i);
        const next = i + 1 < n ? at(i + 1) : Infinity;
        const fs = size(c.title);
        // In: rises into the spotlight once the term before has left it. Out: shrinks into its slot.
        const inP =
          i === 0 ? pop(t, Math.min(b, 0.3) - 0.6, Math.min(b, 0.3), 1.5) : pop(t, b + 0.1, b + 0.7, 1.5);
        const tuck = span(t, next - 0.55, next + 0.05);
        const creep = (t - b) * 3;
        const x = creep * (1 - tuck) + (i * slotW + 74) * tuck;
        const y = (HERO_Y + (1 - Math.min(1, inP)) * 60) * (1 - tuck) + (STRIP_Y - 4) * tuck;
        const s = 1 + (SMALL / fs - 1) * tuck;
        const dIn = i === 0 ? easeOut(t, b + 0.2, b + 0.6) : easeOut(t, b + 0.6, b + 1.0);
        const dOut = easeOut(t, next - 0.8, next - 0.6);
        const draw = (i === 0 ? easeOut(t, b, b + 0.4) : easeOut(t, b + 0.5, b + 0.9)) * (1 - dOut);
        return (
          <div key={i}>
            <span
              style={{
                position: 'absolute',
                left: i * slotW,
                top: STRIP_Y,
                padding: '6px 16px',
                borderRadius: 999,
                fontFamily: theme.font.mono,
                fontSize: 22,
                color: accent,
                background: 'rgba(255,88,0,0.16)',
                opacity: easeOut(t, next - 0.1, next + 0.3),
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transformOrigin: '0 0',
                whiteSpace: 'nowrap',
                fontSize: fs,
                lineHeight: 1.05,
                fontWeight: 800,
                letterSpacing: '-0.035em',
                opacity: clamp01(inP) * (1 - 0.15 * tuck),
                transform: `translate(${x}px, ${y}px) scale(${s})`,
              }}
            >
              {c.title}
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -14,
                  height: 8,
                  borderRadius: 4,
                  background: accent,
                  transformOrigin: '0 50%',
                  transform: `scaleX(${draw})`,
                }}
              />
            </div>
            {c.text && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: HERO_Y + fs * 1.05 + 50,
                  width: 1200,
                  fontSize: 40,
                  lineHeight: 1.35,
                  color: p.muted,
                  opacity: dIn * (1 - dOut),
                  transform: `translateY(${(1 - dIn) * 24 - 16 * dOut}px)`,
                }}
              >
                {c.text}
              </div>
            )}
          </div>
        );
      })}
    </SceneFrame>
  );
}
