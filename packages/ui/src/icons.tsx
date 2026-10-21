import type { SVGProps } from 'react';

/** Thin, rounded line icons (Lucide-style, 1.8px stroke), drawn in currentColor. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconProjects = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);
export const IconStudio = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 9.5v5l4.5-2.5z" />
  </Svg>
);
/** Live: a recording dot in a broadcast ring. */
export const IconLive = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" fill="currentColor" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
    <path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
  </Svg>
);
export const IconLibrary = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
);
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Svg>
);
export const IconPlay = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M7 4l13 8-13 8z" />
  </Svg>
);
export const IconPause = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="5" y="4" width="5" height="16" rx="1" />
    <rect x="14" y="4" width="5" height="16" rx="1" />
  </Svg>
);
export const IconStop = (p: IconProps) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </Svg>
);
export const IconPrev = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M6 5v14M19 5l-9 7 9 7z" />
  </Svg>
);
export const IconNext = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M18 5v14M5 5l9 7-9 7z" />
  </Svg>
);
export const IconArrowRight = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M5 12l5 5 9-10" />
  </Svg>
);
export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="10" r="3" />
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
  </Svg>
);
export const IconRegion = (p: IconProps) => (
  <Svg {...p} strokeDasharray="3 2">
    <rect x="4" y="5" width="16" height="14" rx="2" />
  </Svg>
);
