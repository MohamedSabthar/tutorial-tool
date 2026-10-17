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

const Props = z.object({
  title: z.string().default('Three ideas'),
  eyebrow: z.string().default(''),
  cards: z
    .array(z.object({ title: z.string(), text: z.string().default('') }))
    .min(1)
    .max(4)
    .default([
      { title: 'Service', text: 'Groups resources under one base path.' },
      { title: 'Resource', text: 'One method and path, like GET /hello.' },
      { title: 'Listener', text: 'Accepts requests on a port.' },
    ]),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'ConceptCards',
  kind: 'scene',
  description:
    'Up to four cards that appear one per beat (or narration line), the newest highlighted. Good for defining terms side by side.',
  props: Props,
  defaultDuration: 8,
};

export default function ConceptCards({ props }: OverlayProps<Props>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const n = props.cards.length;
  const k = activeStep(timing, n, duration, t);
  const intro = tween(t, 0, 0.6);
  const gap = 36;
  const w = (1752 - gap * (n - 1)) / n;
  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div style={{ fontSize: sceneType.title, fontWeight: 700, letterSpacing: '-0.02em', opacity: intro }}>
        {props.title}
        <span style={{ color: p.accent }}>.</span>
      </div>
      {props.cards.map((c, i) => {
        const a = stepTime(timing, i, n, duration);
        const u = tween(t, a - 0.15, a + 0.35);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: i * (w + gap),
              top: 300,
              width: w,
              minHeight: 420,
              boxSizing: 'border-box',
              padding: 40,
              borderRadius: 18,
              background: p.panel,
              border: `3px solid ${i === k ? p.accent : p.line}`,
              opacity: u,
              transform: `translateY(${(1 - u) * 40}px)`,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            <span style={{ fontSize: sceneType.heading, fontWeight: 700 }}>{c.title}</span>
            <span style={{ width: 48, height: 3, background: p.accent }} />
            <span style={{ fontSize: sceneType.body, lineHeight: 1.4, color: p.muted }}>{c.text}</span>
          </div>
        );
      })}
    </SceneFrame>
  );
}
