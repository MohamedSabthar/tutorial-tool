import { z } from 'zod';
import {
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
import { activeStep, stepTime } from './shared';

const Props = z.object({
  title: z.string().default('Reading the code'),
  eyebrow: z.string().default(''),
  code: z
    .string()
    .default(
      'service /greeting on new http:Listener(9090) {\n    resource function get hello() returns string {\n        return "Hello, World!";\n    }\n}',
    ),
  /** One highlight per beat: 1-based inclusive line range and a note. */
  steps: z
    .array(z.object({ lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]), note: z.string() }))
    .min(1)
    .max(6)
    .default([
      { lines: [1, 1], note: 'The service listens on port 9090 at /greeting.' },
      { lines: [2, 2], note: 'GET /greeting/hello runs this resource.' },
      { lines: [3, 3], note: 'It returns the greeting as text.' },
    ]),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'CodeWalkthrough',
  kind: 'scene',
  description:
    'A code listing with a highlight that moves through line ranges, one per beat (or narration line), each with a note beside it.',
  props: Props,
  defaultDuration: 9,
};

const LINE = 54;

export default function CodeWalkthrough({ props }: OverlayProps<Props>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const lines = props.code.split('\n');
  const n = props.steps.length;
  const k = activeStep(timing, n, duration, t);
  const intro = tween(t, 0, 0.6);
  // The highlight glides between ranges.
  const rangeAt = (i: number) => props.steps[Math.max(0, i)]!.lines;
  const cur = rangeAt(k);
  const prev = rangeAt(k - 1);
  const u =
    k >= 0 ? tween(t, stepTime(timing, k, n, duration) - 0.1, stepTime(timing, k, n, duration) + 0.35) : 0;
  const top = (prev[0] + (cur[0] - prev[0]) * u - 1) * LINE;
  const height = (prev[1] - prev[0] + (cur[1] - cur[0] - (prev[1] - prev[0])) * u + 1) * LINE;
  const note = k >= 0 ? props.steps[k]!.note : '';
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
          top: 220,
          width: 1100,
          borderRadius: 18,
          background: 'rgba(12,21,38,0.85)',
          padding: '32px 0',
          opacity: intro,
        }}
      >
        <div style={{ position: 'relative' }}>
          {k >= 0 && (
            <span
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top,
                height,
                background: 'rgba(255,88,0,0.18)',
                borderLeft: `6px solid ${p.accent}`,
              }}
            />
          )}
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                height: LINE,
                lineHeight: `${LINE}px`,
                padding: '0 40px',
                fontFamily: theme.font.mono,
                fontSize: 28,
                color: '#E7E7E7',
                whiteSpace: 'pre',
              }}
            >
              <span style={{ color: '#6B7A90', marginRight: 28 }}>{String(i + 1).padStart(2, ' ')}</span>
              {l}
            </div>
          ))}
        </div>
      </div>
      {note && (
        <div
          key={k}
          style={{
            position: 'absolute',
            left: 1160,
            right: 0,
            top: 220 + 32 + top,
            fontSize: sceneType.body + 2,
            lineHeight: 1.4,
            opacity: u,
            transform: `translateX(${(1 - u) * 20}px)`,
          }}
        >
          {note}
        </div>
      )}
    </SceneFrame>
  );
}
