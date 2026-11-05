import { z } from 'zod';

/**
 * Feed mode: the user demonstrates the tutorial in the product window and we capture what they
 * do. Each action carries candidate Playwright locators for its target, best first, so a draft
 * script can be generated without the agent researching the UI.
 */

/** Which frame the target is in: the workbench, or the active webview (the visual editors). */
export const CaptureFrame = z.enum(['main', 'webview']);
export type CaptureFrame = z.infer<typeof CaptureFrame>;

/**
 * A locator for the target, as code relative to its frame, e.g.
 * `getByRole('button', { name: 'Add Agent', exact: true })`, and how many elements it matched
 * when the action happened.
 */
export const CaptureLocator = z.object({ code: z.string(), count: z.number().int() });
export type CaptureLocator = z.infer<typeof CaptureLocator>;

const CaptureBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const Point = z.object({ x: z.number(), y: z.number() });

const base = {
  /** Unique within the capture, e.g. "a7". */
  id: z.string(),
  /** Seconds since the capture started. */
  t: z.number(),
  /**
   * The screen just before the action with its target boxed and the pointer marked, under
   * `.studio/capture/shots/` (e.g. "a7-marked.jpg"). Null when no frame was available.
   */
  shot: z.string().nullable().default(null),
};

const target = {
  frame: CaptureFrame,
  /** Short human label: role and name, e.g. 'button "Add Agent"'. */
  label: z.string(),
  locators: z.array(CaptureLocator),
  /** CSS pixels in the window. */
  bbox: CaptureBox.nullable(),
};

/** Where the pointer was (CSS pixels in the window). */
const at = { point: Point.nullable().default(null) };

export const CaptureTarget = z.object(target);
export type CaptureTarget = z.infer<typeof CaptureTarget>;

export const CaptureAction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    ...base,
    ...target,
    ...at,
    button: z.enum(['left', 'right']),
    double: z.boolean().default(false),
  }),
  /** The pointer rested on the target (hover menus, tooltips, buttons that show only on hover). */
  z.object({ kind: z.literal('hover'), ...base, ...target, ...at }),
  /** A scroll gesture over the target (the scrolled container), in CSS pixels. */
  z.object({ kind: z.literal('scroll'), ...base, ...target, ...at, dx: z.number(), dy: z.number() }),
  /** Pressed on the target, moved and released on `to`. */
  z.object({ kind: z.literal('drag'), ...base, ...target, ...at, to: CaptureTarget, toPoint: Point.nullable() }),
  /** Keys typed outside a text field (keyboard navigation, type-to-search in a list or tree). */
  z.object({ kind: z.literal('keys'), ...base, text: z.string() }),
  z.object({
    kind: z.literal('type'),
    ...base,
    ...target,
    /** The text typed. Password fields hold a placeholder instead; the value is never captured. */
    text: z.string(),
    /** The field had other text first that the user replaced. */
    clear: z.boolean(),
    /** A code editor (Monaco): enter the text in one go so auto-closing brackets don't garble it. */
    insert: z.boolean(),
    secret: z.boolean(),
  }),
  z.object({ kind: z.literal('press'), ...base, key: z.string() }),
]);
export type CaptureAction = z.infer<typeof CaptureAction>;

/** Stands in for a password field's value in a capture. */
export const CAPTURE_SECRET = '«secret»';

export const CaptureStatus = z.object({
  slug: z.string(),
  /** idle: nothing open · launching · capturing: the product is open and listening · ended: the window closed. */
  state: z.enum(['idle', 'launching', 'capturing', 'ended']),
  message: z.string().nullable(),
  actions: z.array(CaptureAction),
});
export type CaptureStatus = z.infer<typeof CaptureStatus>;

/**
 * Actions the agent decides about rather than replays as they are: the pointer resting,
 * scrolls and drags (often incidental), and targets found only by a CSS path or position.
 */
export function needsReview(a: CaptureAction): boolean {
  if (a.kind === 'hover' || a.kind === 'scroll' || a.kind === 'drag') return true;
  if (a.kind === 'press' || a.kind === 'keys') return false;
  const best = a.locators[0];
  return !best || best.count > 1 || /^locator\(|\.nth\(/.test(best.code);
}

/** One line per action, for lists and for the agent. */
export function describeAction(a: CaptureAction): string {
  switch (a.kind) {
    case 'click':
      return `${a.button === 'right' ? 'Right-click' : a.double ? 'Double-click' : 'Click'} ${a.label}`;
    case 'hover':
      return `Hover over ${a.label}`;
    case 'scroll':
      return `Scroll ${a.label} ${Math.abs(a.dy) >= Math.abs(a.dx) ? (a.dy > 0 ? 'down' : 'up') : a.dx > 0 ? 'right' : 'left'} ${Math.round(Math.max(Math.abs(a.dx), Math.abs(a.dy)))} px`;
    case 'drag':
      return `Drag ${a.label} to ${a.to.label}`;
    case 'keys':
      return `Type keys "${a.text}"`;
    case 'type':
      return `Type "${a.text}" into ${a.label}`;
    case 'press':
      return `Press ${a.key}`;
  }
}
