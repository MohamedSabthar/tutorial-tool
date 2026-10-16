/**
 * Design tokens for code that can't use CSS variables (canvas drawing, timeline blocks,
 * overlay themes). Values match `styles.css`.
 */
export const tokens = {
  color: {
    orange: '#FF5800',
    orangeBright: '#FF3900',
    orange700: '#D94A00',
    orange100: '#FFE6D9',
    orangeInk: '#B84300',
    navy: '#13213B',
    navy900: '#0C1526',
    white: '#FFFFFF',
    gray50: '#F3F3F3',
    gray100: '#F0F0F0',
    gray300: '#D7D7D7',
    gray500: '#8A8A8A',
    gray600: '#555555',
    ink: '#252525',
    steel: '#4F7AA3',
    steel100: '#E4EEF6',
    steel300: '#A9C6DD',
    steelInk: '#2F5A80',
    green: '#3FB27F',
    green100: '#E3F4EC',
    greenInk: '#1E6B47',
    red: '#E5383B',
    red100: '#FDE7E7',
    redInk: '#C0292A',
  },
  font: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: { sm: 6, md: 9, lg: 14, pill: 999 },
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  duration: { fast: 0.14, base: 0.24 },
} as const;

export type Tokens = typeof tokens;
