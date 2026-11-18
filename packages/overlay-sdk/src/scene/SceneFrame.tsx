import type { CSSProperties, ReactNode } from 'react';
import { z } from 'zod';
import { ChoreoLogo } from '../brand';
import { theme } from '../theme';

/** Type sizes on the 1920×1080 stage for explainer scenes. */
export const sceneType = { display: 76, title: 56, heading: 40, body: 30, caption: 22, small: 18 } as const;

/** Safe margin inside the frame, in stage px. */
export const SAFE = 84;

const THEMES = {
  'choreo-dark': {
    background: theme.gradient.dark,
    ink: '#FFFFFF',
    muted: '#AEB6C6',
    panel: 'rgba(255,255,255,0.06)',
    line: 'rgba(255,255,255,0.18)',
  },
  'choreo-light': {
    background: 'radial-gradient(120% 120% at 15% 0%, #FFFFFF 0%, #F4F6FA 45%, #E6ECFF 100%)',
    ink: '#0B1633',
    muted: '#5B6173',
    panel: '#FFFFFF',
    line: '#D7DBE4',
  },
} as const;
export type SceneTheme = keyof typeof THEMES;
/** Names saved before the Choreo Labs rebrand. */
type LegacySceneTheme = 'wso2-dark' | 'wso2-light';

/** Old theme names map to the new ones; anything else falls back to dark. */
export const resolveSceneTheme = (name: SceneTheme | LegacySceneTheme | undefined): SceneTheme =>
  name === 'choreo-light' || name === 'wso2-light' ? 'choreo-light' : 'choreo-dark';

/**
 * The `theme` prop of an explainer scene. Scenes saved before the rebrand say `wso2-dark` or
 * `wso2-light`; those still load (as the Choreo Labs equivalent).
 */
export const sceneThemeSchema = z
  .enum(['choreo-dark', 'choreo-light'])
  .default('choreo-dark')
  .catch((ctx) => resolveSceneTheme(ctx.input as LegacySceneTheme));

/** Colours of a scene theme, for content drawn inside the frame. */
export const scenePalette = (name: SceneTheme | LegacySceneTheme = 'choreo-dark') => ({
  ...THEMES[resolveSceneTheme(name)],
  accent: theme.color.blue,
});

/**
 * The frame every explainer scene sits in: brand backdrop, orange left-edge accent, 84 px safe
 * area (children are laid out inside it), an optional eyebrow title and the Choreo Labs logo.
 */
export function SceneFrame({
  theme: name = 'choreo-dark',
  eyebrow,
  footer,
  children,
  style,
}: {
  theme?: SceneTheme | LegacySceneTheme;
  /** Small uppercase label at the top left (e.g. the tutorial or section name). */
  eyebrow?: string;
  /** Footer text at the bottom left. */
  footer?: string;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const t = resolveSceneTheme(name);
  const p = THEMES[t];
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
          background: theme.gradient.edge,
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
        <ChoreoLogo height={26} color={t === 'choreo-dark' ? '#FFFFFF' : theme.color.ink} />
      </div>
    </div>
  );
}
