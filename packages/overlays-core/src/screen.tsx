import { z } from 'zod';
import { DomLayer, theme, useGsap, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';

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
  description: 'A caption line at the bottom of the frame (fed from the captions track in step 4.5).',
  props: CaptionsProps,
  defaultDuration: 3,
};

export function Captions({ props }: OverlayProps<CaptionsProps>) {
  if (!props.text) return null;
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
          }}
        >
          {props.text}
        </span>
      </div>
    </DomLayer>
  );
}
