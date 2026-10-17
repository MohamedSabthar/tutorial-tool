import type { CSSProperties, ReactNode } from 'react';
import { theme } from '../theme';

/** Type sizes on the 1920×1080 stage for explainer scenes. */
export const sceneType = { display: 76, title: 56, heading: 40, body: 30, caption: 22, small: 18 } as const;

/** Safe margin inside the frame, in stage px. */
export const SAFE = 84;

const THEMES = {
  'wso2-dark': {
    background: 'radial-gradient(125% 95% at 50% 0%, #2B3E5E 0%, #18283F 40%, #0B1424 100%)',
    ink: '#FFFFFF',
    muted: '#A9C6DD',
    panel: 'rgba(255,255,255,0.06)',
    line: 'rgba(255,255,255,0.18)',
  },
  'wso2-light': {
    background: 'radial-gradient(120% 120% at 15% 0%, #FFFFFF 0%, #F3F3F3 45%, #E4EEF6 100%)',
    ink: '#13213B',
    muted: '#555555',
    panel: '#FFFFFF',
    line: '#D7D7D7',
  },
} as const;
export type SceneTheme = keyof typeof THEMES;

/** Colours of a scene theme, for content drawn inside the frame. */
export const scenePalette = (name: SceneTheme = 'wso2-dark') => ({
  ...THEMES[name],
  accent: theme.color.orange,
});

/**
 * The frame every explainer scene sits in: brand backdrop, orange left-edge accent, 84 px safe
 * area (children are laid out inside it), an optional eyebrow title and the footer mark.
 */
export function SceneFrame({
  theme: name = 'wso2-dark',
  eyebrow,
  footer,
  children,
  style,
}: {
  theme?: SceneTheme;
  /** Small uppercase label at the top left (e.g. the tutorial or section name). */
  eyebrow?: string;
  /** Footer text at the bottom left. */
  footer?: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const p = THEMES[name];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: p.background,
        color: p.ink,
        fontFamily: theme.font.sans,
        overflow: 'hidden',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          background: 'linear-gradient(0deg, #FF3900 0%, #FF5800 20%, rgba(255,88,0,0) 66%)',
        }}
      />
      {eyebrow && (
        <span
          style={{
            position: 'absolute',
            left: SAFE,
            top: SAFE - 36,
            fontSize: sceneType.small,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: p.muted,
          }}
        >
          {eyebrow}
        </span>
      )}
      <div style={{ position: 'absolute', inset: SAFE }}>{children}</div>
      <div
        style={{
          position: 'absolute',
          left: SAFE,
          right: SAFE,
          bottom: 30,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: sceneType.small,
          color: p.muted,
        }}
      >
        <span>{footer}</span>
        <span style={{ fontWeight: 800, letterSpacing: '-0.02em', color: theme.color.orange, fontSize: 22 }}>
          WSO2
        </span>
      </div>
    </div>
  );
}
