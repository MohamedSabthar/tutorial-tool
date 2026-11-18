import type { CSSProperties, ReactNode } from 'react';
import { z } from 'zod';
import { ChoreoLogo } from '../brand';
import { theme } from '../theme';

/** Type sizes on the 1920×1080 stage for explainer scenes. */
export const sceneType = { display: 76, title: 56, heading: 40, body: 30, caption: 22, small: 18 } as const;

/** Safe margin inside the frame, in stage px. */
export const SAFE = 84;

/**
 * The Choreo Labs look (from choreolabs.com): flat midnight with a faint dot grid and a soft blue
 * glow, hairline cards, blue for structure and "lit" things, orange for what happens right now.
 */
const DOTS_DARK = 'radial-gradient(rgba(255,255,255,0.07) 1.3px, rgba(255,255,255,0) 1.8px) 0 0 / 30px 30px';
const DOTS_LIGHT = 'radial-gradient(rgba(11,22,51,0.09) 1.3px, rgba(11,22,51,0) 1.8px) 0 0 / 30px 30px';
const THEMES = {
  'choreo-dark': {
    background: `radial-gradient(55% 65% at 74% 42%, rgba(31,79,255,0.2) 0%, rgba(31,79,255,0) 70%), ${DOTS_DARK}, #050A1C`,
    ink: '#FFFFFF',
    /** Body text. */
    muted: '#AEB6C6',
    /** Labels and things not in play yet. */
    dim: '#5A6072',
    /** Card fill and hairline border. */
    panel: 'rgba(255,255,255,0.03)',
    line: 'rgba(255,255,255,0.1)',
    /** Diagram nodes and wires at rest: dark tiles with a faint blue edge. */
    node: '#0A1230',
    nodeLine: 'rgba(61,139,255,0.35)',
    wire: 'rgba(61,139,255,0.4)',
    /** A lit card or row: blue gradient with a blue edge. */
    litFill: 'linear-gradient(90deg, rgba(31,79,255,0.1), rgba(31,79,255,0.28) 55%, rgba(31,79,255,0.06))',
    litLine: 'rgba(61,110,255,0.75)',
    /** Numbers and lit text on this backdrop. */
    number: '#3D8BFF',
  },
  'choreo-light': {
    background: `radial-gradient(55% 65% at 74% 42%, rgba(31,79,255,0.08) 0%, rgba(31,79,255,0) 70%), ${DOTS_LIGHT}, #F4F6FA`,
    ink: '#0B1633',
    muted: '#5A6072',
    dim: '#8A93A6',
    panel: '#FFFFFF',
    line: '#D7DBE4',
    node: '#FFFFFF',
    nodeLine: 'rgba(31,79,255,0.3)',
    wire: 'rgba(31,79,255,0.35)',
    litFill: 'linear-gradient(90deg, rgba(31,79,255,0.05), rgba(31,79,255,0.14) 55%, rgba(31,79,255,0.03))',
    litLine: 'rgba(31,79,255,0.7)',
    number: '#1F4FFF',
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
  /** Structure and things already covered: lines, lit borders, highlights in text. */
  accent: theme.color.blue,
  /** What the narration is about right now: the moving request, the current node, rules. */
  signal: theme.color.orange,
  /** Glow around the current item (box-shadow). */
  signalGlow: '0 0 0 1.5px #FF4600, 0 0 40px rgba(255,70,0,0.35)',
  /**
   * The card the narration is on now (choreolabs.com's highlighted "The Model" card): keep the
   * blue lit fill, add an orange edge and an orange glow underneath.
   */
  nowBorder: 'rgba(255,70,0,0.85)',
  nowShadow: '0 36px 70px -34px rgba(255,70,0,0.75), 0 26px 60px rgba(0,0,0,0.35)',
  /** A closing result (the reply): an orange pill with midnight text, like the site's CTA. */
  resultFill: theme.color.orange,
  resultInk: '#050A1C',
});

/**
 * The short orange rule that sits above a heading (choreolabs.com section headers). Put it as
 * the first child of the title block; the title animates it with its own opacity and slide.
 */
export function SceneRule({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: 54,
        height: 4,
        marginBottom: 26,
        background: theme.color.orange,
        ...style,
      }}
    />
  );
}

/** Headline type for scene titles: Sora 600, tight, as on choreolabs.com. */
export const sceneTitleStyle = { fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.05 } as const;

/** Small uppercase label above a heading or a group. */
export const sceneEyebrowStyle = {
  fontSize: 20,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
} as const;

/**
 * The frame every explainer scene sits in: midnight (or light) backdrop with a dot grid and a soft
 * blue glow, 84 px safe area (children are laid out inside it), an optional eyebrow and the
 * Choreo Labs logo.
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
      {eyebrow && (
        <span
          style={{
            position: 'absolute',
            left: SAFE,
            top: SAFE - 54,
            ...sceneEyebrowStyle,
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
