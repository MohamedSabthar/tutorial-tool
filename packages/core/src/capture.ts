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

const base = {
  /** Unique within the capture, e.g. "a7". */
  id: z.string(),
  /** Seconds since the capture started. */
  t: z.number(),
};

const target = {
  frame: CaptureFrame,
  /** Short human label: role and name, e.g. 'button "Add Agent"'. */
  label: z.string(),
  locators: z.array(CaptureLocator),
  /** CSS pixels in the window. */
  bbox: CaptureBox.nullable(),
};

export const CaptureAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), ...base, ...target, button: z.enum(['left', 'right']) }),
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

/** One line per action, for lists and for the agent. */
export function describeAction(a: CaptureAction): string {
  switch (a.kind) {
    case 'click':
      return `${a.button === 'right' ? 'Right-click' : 'Click'} ${a.label}`;
    case 'type':
      return `Type "${a.text}" into ${a.label}`;
    case 'press':
      return `Press ${a.key}`;
  }
}
