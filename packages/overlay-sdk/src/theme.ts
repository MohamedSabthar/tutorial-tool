/**
 * Choreo Labs brand and motion tokens for overlays and explainer scenes. Use these instead of
 * literal values so every tutorial looks consistent.
 *
 * From the Choreo Labs slide deck: midnight backgrounds, brand blue for large graphics, orange
 * for small accents (ticks, rules, on-screen highlights), Sora for text. The older names
 * (`navy`, `steel`, `gray*`) are kept and point at the new palette, so saved overlays still work.
 */
export const theme = {
  color: {
    // Brand
    midnight: '#050A1C',
    blue: '#1F4FFF',
    blueLight: '#3D8BFF',
    orange: '#FF4600',
    orangeBright: '#FF2E00',
    orange100: '#FFE4D9',
    // Legacy names, mapped onto the Choreo Labs palette
    navy: '#050A1C',
    navy900: '#02050F',
    white: '#FFFFFF',
    gray50: '#F4F6FA',
    gray300: '#D7DBE4',
    gray600: '#5B6173',
    ink: '#0B1633',
    steel: '#5B6173',
    steelLight: '#AEB6C6',
  },
  font: {
    sans: "'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: 14,
  shadow: '0 22px 60px rgba(2, 5, 15, 0.4)',
  /** GSAP ease names. */
  ease: { out: 'power3.out', in: 'power2.in', inOut: 'power2.inOut', pop: 'back.out(1.6)' },
  /** Seconds. */
  duration: { fast: 0.14, base: 0.24, enter: 0.3, exit: 0.2 },
  gradient: {
    edge: 'linear-gradient(0deg, #FF2E00 0%, #FF4600 20%, rgba(255,70,0,0) 66%)',
    /** Midnight with a faint dot grid and a soft blue glow (choreolabs.com). */
    dark: 'radial-gradient(55% 65% at 74% 42%, rgba(31,79,255,0.2) 0%, rgba(31,79,255,0) 70%), radial-gradient(rgba(255,255,255,0.07) 1.3px, rgba(255,255,255,0) 1.8px) 0 0 / 30px 30px, #050A1C',
  },
} as const;

export type Theme = typeof theme;
