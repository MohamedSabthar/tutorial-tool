/**
 * Design tokens for code that can't use CSS variables (canvas drawing, timeline blocks,
 * overlay themes): the Choreo Labs video look. Mirrors `@studio/overlay-sdk`'s `theme`.
 *
 * The palette is from the Choreo Labs slide deck: midnight backgrounds, brand blue for large
 * graphics, orange for small accents (ticks, rules, highlights), Sora for text. The older names
 * (`navy`, `steel`, `gray*`) are kept and point at the new palette, so saved overlays still work.
 */
export const tokens = {
  color: {
    // Brand
    midnight: '#050A1C',
    blue: '#1F4FFF',
    blueLight: '#3D8BFF',
    blue100: '#E6ECFF',
    orange: '#FF4600',
    orangeBright: '#FF2E00',
    orange700: '#D93B00',
    orange100: '#FFE4D9',
    orangeInk: '#B83200',
    // Legacy names, mapped onto the Choreo Labs palette
    navy: '#050A1C',
    navy900: '#02050F',
    white: '#FFFFFF',
    gray50: '#F4F6FA',
    gray100: '#EDF0F5',
    gray300: '#D7DBE4',
    gray500: '#8992A5',
    gray600: '#5B6173',
    ink: '#0B1633',
    steel: '#5B6173',
    steel100: '#E8EBF2',
    steel300: '#AEB6C6',
    steelInk: '#3B4256',
    green: '#3FB27F',
    green100: '#E3F4EC',
    greenInk: '#1E6B47',
    red: '#E5383B',
    red100: '#FDE7E7',
    redInk: '#C0292A',
  },
  font: {
    sans: "'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: { sm: 6, md: 9, lg: 14, pill: 999 },
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  duration: { fast: 0.14, base: 0.24 },
} as const;

export type Tokens = typeof tokens;
