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
/** Developer tools: angle brackets. */
export const IconCode = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
  </Svg>
);
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
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
export const IconPointer = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l14 7.5-6.2 1.7L10 18.5z" />
  </Svg>
);
export const IconText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  </Svg>
);
export const IconZoom = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4M11 8.5v5M8.5 11h5" />
  </Svg>
);
/** Blur: a droplet with soft dots. */
export const IconBlur = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11z" />
    <path d="M9.5 14h.01M12 16.5h.01M14.5 14h.01M12 11.5h.01" strokeWidth={2.4} />
  </Svg>
);

// Pipeline stages ------------------------------------------------------------------------------

/** Research and plan: a map folded in three. */
export const IconPlan = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);
/** A review the user answers: an eye. */
export const IconReview = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);
/** Write the script: a page with brackets. */
export const IconScript = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M10 13l-2 2 2 2M14 13l2 2-2 2" />
  </Svg>
);
/** Dry run: a play mark in a dashed circle (a rehearsal). */
export const IconDryRun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2.5" />
    <path d="M10 8.5v7l5.5-3.5z" />
  </Svg>
);
/** Repair: a wrench. */
export const IconRepair = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3.5 17.5a1.4 1.4 0 0 0 2 2l5.7-5.7a4 4 0 0 0 5.3-5.3l-2.4 2.4-2-2z" />
  </Svg>
);
/** Narration: lines of text with a quote mark. */
export const IconNarrate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M4 10h16M4 14h16M4 18h9" />
    <path d="M18 4v4" />
  </Svg>
);
/** Voice-over: a microphone. */
export const IconVoice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);
/** Align to the voice: a waveform with a marker through it. */
export const IconAlign = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h2M7 9v6M10 6v12M17 8v8M20 11v2" />
    <path d="M13.5 3v18" strokeDasharray="2 2" />
  </Svg>
);
/** Record: a filled dot in a ring. */
export const IconRecord = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  </Svg>
);
/** Post-production: scissors. */
export const IconPost = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M8 7.5L20 18M8 16.5L20 6" />
  </Svg>
);
/** Final QA: a shield with a tick. */
export const IconQa = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);
/** Retrospective: an open book. */
export const IconRetro = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z" />
    <path d="M12 6v13.5" />
  </Svg>
);
/** Disclosure chevron (points right; rotate it when open). */
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IconFullscreen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconExitFullscreen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Svg>
);
