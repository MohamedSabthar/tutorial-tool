import { z } from 'zod';
import { captionAt } from '@studio/core';
import {
  DomLayer,
  theme,
  useCaptions,
  useGsap,
  useOverlayTime,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';

/** Screen-space overlays: they ignore the camera (titles, keys, captions, free labels). */

// ---------------------------------------------------------------------------
// TitleCard
// ---------------------------------------------------------------------------

const TitleCardProps = z.object({
  title: z.string().default('Title'),
  subtitle: z.string().default(''),
  placement: z.enum(['lower-third', 'center']).default('lower-third'),
});
type TitleCardProps = z.infer<typeof TitleCardProps>;

export const titleCardMeta: OverlayMeta = {
  name: 'TitleCard',
  description: 'A WSO2-styled title with an orange rule, as a lower third or centred.',
  props: TitleCardProps,
  defaultDuration: 3,
};

export function TitleCard({ props, duration }: OverlayProps<TitleCardProps>) {
  const scope = useGsap((tl) => {
    tl.from('.panel', { autoAlpha: 0, x: -40, duration: 0.45, ease: theme.ease.out })
      .from('.rule', { width: 0, duration: 0.4, ease: theme.ease.out }, 0.2)
      .from('.sub', { autoAlpha: 0, y: 8, duration: 0.3 }, 0.35)
      .to(
        '.panel',
        { autoAlpha: 0, x: -20, duration: theme.duration.exit, ease: theme.ease.in },
        duration - theme.duration.exit,
      );
  }, []);
  const center = props.placement === 'center';
  return (
    <DomLayer>
      <div ref={scope}>
        <div
          className="panel"
          style={{
            position: 'absolute',
            ...(center
              ? { left: 0, right: 0, top: 380, textAlign: 'center' as const }
              : { left: 96, bottom: 120 }),
            fontFamily: theme.font.sans,
          }}
        >
          <div
            style={{
              display: 'inline-block',
              background: 'rgba(12,21,38,0.88)',
              padding: '24px 36px 26px',
              borderRadius: theme.radius,
              boxShadow: theme.shadow,
              textAlign: 'left',
            }}
          >
            <div
              style={{ fontSize: 56, fontWeight: 700, color: theme.color.white, letterSpacing: '-0.02em' }}
            >
              {props.title}
              <span style={{ color: theme.color.orange }}>.</span>
            </div>
            <div
              className="rule"
              style={{ width: 72, height: 4, background: theme.color.orange, margin: '12px 0 10px' }}
            />
            {props.subtitle && (
              <div className="sub" style={{ fontSize: 26, color: theme.color.steelLight }}>
                {props.subtitle}
              </div>
            )}
          </div>
        </div>
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// TextLabel
// ---------------------------------------------------------------------------

const TextLabelProps = z.object({
  text: z.string().default('Label'),
  x: z.number().default(96),
  y: z.number().default(96),
  tone: z.enum(['dark', 'light', 'orange']).default('dark'),
});
type TextLabelProps = z.infer<typeof TextLabelProps>;

export const textLabelMeta: OverlayMeta = {
  name: 'TextLabel',
  description: 'A short label at a fixed stage position.',
  props: TextLabelProps,
  defaultDuration: 2,
};

export function TextLabel({ props, duration }: OverlayProps<TextLabelProps>) {
  const scope = useGsap((tl) => {
    tl.from('.label', { autoAlpha: 0, y: 8, duration: theme.duration.enter, ease: theme.ease.out }).to(
      '.label',
      { autoAlpha: 0, duration: theme.duration.exit },
      duration - theme.duration.exit,
    );
  }, []);
  const tones = {
    dark: { bg: 'rgba(12,21,38,0.86)', fg: theme.color.white },
    light: { bg: theme.color.white, fg: theme.color.navy },
    orange: { bg: theme.color.orange, fg: theme.color.white },
  };
  const tone = tones[props.tone ?? 'dark'];
  return (
    <DomLayer>
      <div ref={scope}>
        <span
          className="label"
          style={{
            position: 'absolute',
            left: props.x ?? 96,
            top: props.y ?? 96,
            fontFamily: theme.font.sans,
            fontSize: 28,
            fontWeight: 600,
            padding: '8px 16px',
            borderRadius: 10,
            background: tone.bg,
            color: tone.fg,
            boxShadow: theme.shadow,
          }}
        >
          {props.text}
        </span>
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Keystroke
// ---------------------------------------------------------------------------

const KeystrokeProps = z.object({
  keys: z.array(z.string()).default(['⌘', 'S']),
});
type KeystrokeProps = z.infer<typeof KeystrokeProps>;

export const keystrokeMeta: OverlayMeta = {
  name: 'Keystroke',
  description: 'Keyboard shortcut badges at the bottom of the frame.',
  props: KeystrokeProps,
  defaultDuration: 1.5,
};

export function Keystroke({ props, duration }: OverlayProps<KeystrokeProps>) {
  const scope = useGsap((tl) => {
    tl.from('.keys', { autoAlpha: 0, y: 20, duration: theme.duration.enter, ease: theme.ease.pop }).to(
      '.keys',
      { autoAlpha: 0, duration: theme.duration.exit },
      duration - theme.duration.exit,
    );
  }, []);
  return (
    <DomLayer>
      <div ref={scope}>
        <div
          className="keys"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 150,
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          {(props.keys ?? []).map((k, i) => (
            <span
              key={i}
              style={{
                minWidth: 64,
                textAlign: 'center',
                fontFamily: theme.font.sans,
                fontSize: 34,
                fontWeight: 600,
                color: theme.color.navy,
                background: theme.color.white,
                border: `2px solid ${theme.color.gray300}`,
                borderBottomWidth: 6,
                borderRadius: 14,
                padding: '10px 18px',
                boxShadow: theme.shadow,
              }}
            >
              {k}
            </span>
          ))}
        </div>
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

const CaptionsProps = z.object({
  text: z.string().default(''),
});
type CaptionsProps = z.infer<typeof CaptionsProps>;

export const captionsMeta: OverlayMeta = {
  name: 'Captions',
  description:
    'Captions at the bottom of the frame: the captions track’s cue at each moment, or a fixed text when set.',
  props: CaptionsProps,
  defaultDuration: 3,
};

export function Captions({ props }: OverlayProps<CaptionsProps>) {
  const cues = useCaptions();
  const { global: t } = useOverlayTime();
  const text = props.text || captionAt(cues, t)?.text || '';
  if (!text) return null;
  return (
    <DomLayer>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 64,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            maxWidth: 1300,
            textAlign: 'center',
            fontFamily: theme.font.sans,
            fontSize: 38,
            lineHeight: 1.3,
            color: theme.color.white,
            background: 'rgba(12,21,38,0.86)',
            padding: '10px 24px',
            borderRadius: 12,
            whiteSpace: 'pre-line',
          }}
        >
          {text}
        </span>
      </div>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// FastForward
// ---------------------------------------------------------------------------

const FastForwardProps = z.object({
  /** The playback speed shown; 0 shows the badge without a number (a product wait skipped). */
  rate: z.number().min(0).default(4),
});
type FastForwardProps = z.infer<typeof FastForwardProps>;

export const fastForwardMeta: OverlayMeta = {
  name: 'FastForward',
  description:
    'A small fast-forward badge at the top right, for stretches played faster than recorded (the timing fit adds one wherever it speeds up action after a line).',
  props: FastForwardProps,
  defaultDuration: 3,
};

export function FastForward({ props }: OverlayProps<FastForwardProps>) {
  const { t, duration } = useOverlayTime();
  // In and out over 0.2 s, from time alone.
  const a = Math.min(1, t / 0.2, (duration - t) / 0.2);
  const rate = props.rate ?? 4;
  return (
    <DomLayer>
      <span
        aria-label={rate ? `Playing at ${rate} times speed` : 'Fast-forward'}
        style={{
          position: 'absolute',
          right: 64,
          top: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 18px',
          borderRadius: 999,
          fontFamily: theme.font.sans,
          fontSize: 26,
          fontWeight: 700,
          color: theme.color.white,
          background: 'rgba(12,21,38,0.82)',
          boxShadow: theme.shadow,
          opacity: Math.max(0, a),
          transform: `translateY(${(1 - Math.max(0, a)) * -8}px)`,
        }}
      >
        <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true">
          <path d="M0 0 L12 9 L0 18 Z M13 0 L25 9 L13 18 Z" fill={theme.color.orange} />
        </svg>
        {rate ? `${Number.isInteger(rate) ? rate : rate.toFixed(1)}×` : 'Fast-forward'}
      </span>
    </DomLayer>
  );
}

// ---------------------------------------------------------------------------
// Skip
// ---------------------------------------------------------------------------

const SkipProps = z.object({
  /** Seconds of recording cut out at this point; 0 shows the badge without a number. */
  seconds: z.number().min(0).default(0),
});
type SkipProps = z.infer<typeof SkipProps>;

export const skipMeta: OverlayMeta = {
  name: 'Skip',
  description:
    'A short "skipped ahead" badge at the top right, just after a cut, so a jump in the recording reads as an edit rather than a glitch (added automatically at every cut).',
  props: SkipProps,
  defaultDuration: 1.6,
};

/** "Skipped ahead" badge, shown for a moment after a cut; fades from time alone. */
export function Skip({ props }: OverlayProps<SkipProps>) {
  const { t, duration } = useOverlayTime();
  const a = Math.max(0, Math.min(1, t / 0.15, (duration - t) / 0.3));
  const s = props.seconds ?? 0;
  const label = s >= 1 ? `${Math.round(s)} s skipped` : 'Skipped ahead';
  return (
    <DomLayer>
      <span
        aria-label={label}
        style={{
          position: 'absolute',
          right: 64,
          top: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 18px',
          borderRadius: 999,
          fontFamily: theme.font.sans,
          fontSize: 26,
          fontWeight: 700,
          color: theme.color.white,
          background: 'rgba(12,21,38,0.82)',
          boxShadow: theme.shadow,
          opacity: a,
          transform: `translateY(${(1 - a) * -8}px)`,
        }}
      >
        <svg width="24" height="18" viewBox="0 0 24 18" aria-hidden="true">
          <path d="M0 0 L12 9 L0 18 Z" fill={theme.color.orange} />
          <rect x="15" y="0" width="4" height="18" rx="1" fill={theme.color.orange} />
        </svg>
        {label}
      </span>
    </DomLayer>
  );
}
