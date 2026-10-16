/**
 * WSO2 brand and motion tokens for overlays and explainer scenes. Use these instead of
 * literal values so every tutorial looks consistent.
 */
export const theme = {
  color: {
    orange: '#FF5800',
    orangeBright: '#FF3900',
    orange100: '#FFE6D9',
    navy: '#13213B',
    navy900: '#0C1526',
    white: '#FFFFFF',
    gray50: '#F3F3F3',
    gray300: '#D7D7D7',
    gray600: '#555555',
    ink: '#252525',
    steel: '#4F7AA3',
    steelLight: '#A9C6DD',
  },
  font: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: 14,
  shadow: '0 22px 60px rgba(6, 12, 24, 0.35)',
  /** GSAP ease names. */
  ease: { out: 'power3.out', in: 'power2.in', inOut: 'power2.inOut', pop: 'back.out(1.6)' },
  /** Seconds. */
  duration: { fast: 0.14, base: 0.24, enter: 0.3, exit: 0.2 },
  gradient: {
    edge: 'linear-gradient(0deg, #FF3900 0%, #FF5800 20%, rgba(255,88,0,0) 66%)',
    dark: 'radial-gradient(125% 95% at 50% 0%, #2B3E5E 0%, #18283F 40%, #0B1424 100%)',
  },
} as const;

export type Theme = typeof theme;
