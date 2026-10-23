import type { ReactNode } from 'react';
import { z } from 'zod';
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
import { afterSteps, clamp01, easeOut, pop, stepTime } from './shared';

const Props = z.object({
  title: z.string().default('The URL, read by your code'),
  eyebrow: z.string().default(''),
  code: z
    .string()
    .default(
      'service /greeting on new http:Listener(9090) {\n    resource function get hello() returns string {\n        return "Hello, World!";\n    }\n}',
    ),
  /** The request whose parts the steps explain. */
  request: z.string().default('localhost:9090/greeting/hello'),
  /** One per beat: 1-based inclusive line range, a note and the part of the request it reads. */
  steps: z
    .array(
      z.object({
        lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
        note: z.string(),
        part: z.string().default(''),
      }),
    )
    .min(1)
    .max(6)
    .default([
      { lines: [1, 1], note: ':9090 → the listener', part: ':9090' },
      { lines: [1, 1], note: '/greeting → the service', part: '/greeting' },
      { lines: [2, 2], note: 'hello → the resource', part: '/hello' },
    ]),
  /** Shown once the steps are done; empty for none. */
  reply: z.string().default('200 · Hello, World!'),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'CodeTrace',
  kind: 'scene',
  description:
    'Trace-and-code look: the code types itself out, then on each beat (or narration line) a highlight moves to the lines that handle the next part of the request, that part lights up in the request beside it and a note appears. A closing reply pops in on the next beat. Same props as CodeWalkthrough plus request, part and reply.',
  props: Props,
  defaultDuration: 9,
};

const LINE = 60;
const PAD = 40;
const CODE_W = 1000;
const SIDE_X = 1070;
const KEYWORDS =
  /\b(service|on|new|resource|function|get|post|put|delete|returns|return|string|int|boolean|json|error|import|public|type|record|check|if|else|var|final|isolated|remote|client)\b/g;

/** Keystroke times: steady typing with a fixed, per-character jitter (pure, no randomness). */
function typingTimes(chars: number, start: number, end: number): number[] {
  const dt = (end - start) / Math.max(chars, 1);
  return Array.from({ length: chars }, (_, i) => {
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    return start + (i + 0.35 * jitter) * dt;
  });
}

/** Code with keywords and strings coloured. */
function Painted({ src, keyword, string }: { src: string; keyword: string; string: string }) {
  const out: ReactNode[] = [];
  const re = new RegExp(`("[^"\\n]*"?)|${KEYWORDS.source}`, 'g');
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) out.push(src.slice(last, m.index));
    out.push(
      <span key={m.index} style={{ color: m[1] ? string : keyword }}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(src.slice(last));
  return <>{out}</>;
}

export default function CodeTrace({ props }: OverlayProps<Props>) {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const p = scenePalette(props.theme);
  const accent = p.accent;
  const dark = props.theme === 'wso2-dark';
  const lines = props.code.split('\n');
  const n = props.steps.length;
  const at = (k: number) => stepTime(timing, k, n, duration);
  const replyAt = afterSteps(timing, n, duration);
  const done = props.reply !== '' && t >= replyAt;

  // Typing: about 45 characters a second, at most 40% of the scene.
  const chars = props.code.length;
  const typeStart = 0.5;
  const typeEnd = typeStart + Math.min(chars / 45, Math.max(1, duration * 0.4));
  const times = typingTimes(chars, typeStart, typeEnd);
  const typed = times.filter((x) => x <= t).length;
  const lineEnd: number[] = [];
  let idx = 0;
  for (const l of lines) {
    idx += l.length;
    lineEnd.push((times[Math.min(idx, chars) - 1] ?? typeStart) + 0.2);
    idx += 1;
  }
  // A step shows once its beat has come and its lines are typed.
  const shownAt = (j: number) =>
    Math.max(at(j), lineEnd[Math.min(props.steps[j]!.lines[1], lines.length) - 1] ?? 0);
  let k = -1;
  for (let j = 0; j < n; j++) if (t >= shownAt(j) - 1e-6) k = j;

  // The highlight glides between line ranges.
  const range = (j: number) => props.steps[Math.max(0, j)]!.lines;
  const cur = range(k);
  const prev = range(k - 1);
  const u = k >= 0 ? easeOut(t, shownAt(k), shownAt(k) + 0.35) : 0;
  const top = PAD + (prev[0] + (cur[0] - prev[0]) * u - 1) * LINE;
  const height = (prev[1] - prev[0] + (cur[1] - cur[0] - (prev[1] - prev[0])) * u + 1) * LINE;

  // Which characters of the request each step lights.
  const owner: number[] = Array.from({ length: props.request.length }, () => -1);
  props.steps.forEach((s, j) => {
    const i = s.part ? props.request.indexOf(s.part) : -1;
    if (i >= 0) for (let c = i; c < i + s.part.length; c++) owner[c] = j;
  });
  const runs: { text: string; owner: number }[] = [];
  for (const [c, ch] of [...props.request].entries()) {
    const last = runs.at(-1);
    if (last && last.owner === owner[c]) last.text += ch;
    else runs.push({ text: ch, owner: owner[c]! });
  }

  const intro = easeOut(t, 0, 0.6);
  const caret = typed < chars && Math.floor(t / 0.53) % 2 === 0;
  const visible = props.code.slice(0, typed);
  const r = pop(t, replyAt, replyAt + 0.5, 1.6);

  return (
    <SceneFrame theme={props.theme} {...(props.eyebrow ? { eyebrow: props.eyebrow } : {})}>
      <div
        style={{
          fontSize: sceneType.title + 4,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          opacity: intro,
          transform: `translateX(${(1 - intro) * 40}px)`,
        }}
      >
        {props.title}
        <span style={{ color: accent }}>.</span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 230,
          width: CODE_W,
          height: lines.length * LINE + 2 * PAD,
          borderRadius: 22,
          background: dark ? 'rgba(12,21,38,0.85)' : '#FFFFFF',
          border: `1.5px solid ${p.line}`,
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          opacity: intro,
        }}
      >
        {k >= 0 && (
          <span
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top,
              height,
              background: 'rgba(255,88,0,0.14)',
              borderLeft: `5px solid ${accent}`,
            }}
          />
        )}
        <pre
          style={{
            position: 'relative',
            margin: 0,
            padding: `${PAD}px 40px`,
            fontFamily: theme.font.mono,
            fontSize: 30,
            lineHeight: `${LINE}px`,
            whiteSpace: 'pre',
            color: dark ? '#E7E7E7' : theme.color.ink,
          }}
        >
          <Painted
            src={visible}
            keyword={dark ? theme.color.steelLight : theme.color.steel}
            string={accent}
          />
          {caret && <span style={{ color: accent }}>▍</span>}
        </pre>
      </div>
      <div style={{ position: 'absolute', left: SIDE_X, top: 250, right: 0 }}>
        <div
          style={{
            fontFamily: theme.font.mono,
            fontSize: 38,
            fontWeight: 500,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            opacity: easeOut(t, 0.2, 0.7),
          }}
        >
          {runs.map((run, i) => {
            const reached = run.owner < 0 || done || (k >= 0 && run.owner <= k);
            const lit = run.owner >= 0 && run.owner === k && !done;
            return (
              <span key={i} style={{ color: lit ? accent : p.ink, opacity: reached ? 1 : 0.45 }}>
                {run.text}
              </span>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 30 }}>
          {props.steps.map((s, j) => {
            const a = easeOut(t, shownAt(j), shownAt(j) + 0.45);
            const now = j === k && !done;
            return (
              <div
                key={j}
                style={{
                  fontSize: 32,
                  lineHeight: 1.3,
                  color: now ? p.ink : p.muted,
                  opacity: a * (now ? 1 : 0.75),
                  transform: `translateX(${(1 - a) * 26}px)`,
                }}
              >
                {s.note}
              </div>
            );
          })}
        </div>
        {done && (
          <span
            style={{
              display: 'inline-block',
              marginTop: 30,
              padding: '10px 22px',
              borderRadius: 999,
              fontFamily: theme.font.mono,
              fontSize: 28,
              color: accent,
              background: 'rgba(255,88,0,0.16)',
              opacity: clamp01(r),
              transform: `scale(${0.6 + 0.4 * r})`,
              transformOrigin: 'left center',
            }}
          >
            {props.reply}
          </span>
        )}
      </div>
    </SceneFrame>
  );
}
