import {
  cutGaps,
  type AgentEvent,
  type OverlayInstance,
  type Segment,
  type Step,
  type Timeline,
} from '@studio/core';
import { tokens, type GlyphName } from '@studio/ui';
import type { StepSpan } from '../resolve';

/** m:ss, or m:ss.t with tenths. */
export const mmss = (t: number, tenths = false) => {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return tenths
    ? `${m}:${rest.toFixed(1).padStart(4, '0')}`
    : `${m}:${String(Math.floor(rest)).padStart(2, '0')}`;
};

/** Overlays the pipeline draws by itself and the user doesn't edit as "things on screen". */
const PLUMBING = new Set([
  'core:Cursor',
  'core:ClickRipple',
  'core:Captions',
  'core:Zoom',
  'core:FastForward',
  'core:Skip',
]);
/** Zooms you add yourself count as on screen; the automatic ones follow the clicks (Camera). */
export const isOnScreen = (o: Pick<OverlayInstance, 'component' | 'author'>) =>
  !PLUMBING.has(o.component) || (o.component === 'core:Zoom' && o.author !== 'auto');

/** What an overlay is called in the step panel and on the timeline. */
const NAMES: Record<string, string> = {
  'core:Arrow': 'Arrow',
  'core:TextLabel': 'Label',
  'core:Box': 'Box',
  'core:Blur': 'Hidden area',
  'core:Callout': 'Callout',
  'core:TitleCard': 'Title',
  'core:Highlight': 'Highlight',
  'core:Keystroke': 'Keys',
  'core:Zoom': 'Zoom',
};
export function overlayName(o: Pick<OverlayInstance, 'component'>, metaName?: string): string {
  return NAMES[o.component] ?? metaName ?? o.component.split(':')[1] ?? o.component;
}
export function overlayIcon(o: Pick<OverlayInstance, 'component'>): GlyphName {
  switch (o.component) {
    case 'core:Arrow':
      return 'arrow';
    case 'core:Box':
    case 'core:Highlight':
      return 'box';
    case 'core:Blur':
      return 'hide';
    case 'core:Zoom':
      return 'expand';
    case 'core:Callout':
    case 'core:TextLabel':
    case 'core:Keystroke':
    case 'core:TitleCard':
      return 'label';
    default:
      return o.component.startsWith('core:') ? 'label' : 'spark';
  }
}
/** The family an overlay belongs to, for its tint on the timeline. */
export function overlayFamily(
  o: Pick<OverlayInstance, 'component'>,
): 'point' | 'spot' | 'text' | 'hide' | 'zoom' | 'own' {
  switch (o.component) {
    case 'core:Arrow':
    case 'core:Box':
    case 'core:Callout':
      return 'point';
    case 'core:Highlight':
      return 'spot';
    case 'core:Blur':
      return 'hide';
    case 'core:Zoom':
      return 'zoom';
    default:
      return o.component.startsWith('core:') ? 'text' : 'own';
  }
}
/** A block's short name on the timeline: "Zoom 2×", "Arrow", "Label · Click Create". */
export function overlayShort(o: OverlayInstance, metaName?: string): string {
  const name = overlayName(o, metaName);
  if (o.component === 'core:Zoom') {
    const z = (o.props as Record<string, unknown>).zoom;
    return typeof z === 'number' ? `${name} ${Math.round(z * 10) / 10}×` : name;
  }
  const words = overlayText(o);
  return words ? `${name} · ${words}` : name;
}
/** The overlay's own words, if it has any. */
export function overlayText(o: OverlayInstance): string {
  const p = o.props as Record<string, unknown>;
  if (Array.isArray(p.keys)) return p.keys.join(' + ');
  const v = p.title ?? p.text ?? p.label;
  return typeof v === 'string' ? v : '';
}
/** The words an overlay's editor shows, in order (the first gets the `ed-ovt-<id>` field). */
export function textFields(component: string): { key: string; label: string; keys?: boolean }[] {
  switch (component) {
    case 'core:Arrow':
      return [{ key: 'label', label: 'Text' }];
    case 'core:TextLabel':
      return [{ key: 'text', label: 'Text' }];
    case 'core:Callout':
      return [
        { key: 'title', label: 'Title' },
        { key: 'text', label: 'Text' },
      ];
    case 'core:TitleCard':
      return [
        { key: 'title', label: 'Title' },
        { key: 'subtitle', label: 'Subtitle' },
      ];
    case 'core:Keystroke':
      return [{ key: 'keys', label: 'Keys', keys: true }];
    default:
      return [];
  }
}
/** "⌘ S", "Ctrl + Shift + P" → ["⌘", "S"], ["Ctrl", "Shift", "P"]. */
export const parseKeys = (v: string) =>
  v
    .split(/\s*\+\s*|\s+/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 6);

/** The fixed video colours (the video keeps the Choreo Labs look). */
export const VIDEO_COLORS: { value: string; name: string }[] = [
  { value: tokens.color.orange, name: 'Orange' },
  { value: tokens.color.blue, name: 'Blue' },
  { value: tokens.color.midnight, name: 'Midnight' },
  { value: tokens.color.steel, name: 'Slate' },
  { value: tokens.color.white, name: 'White' },
];
/** TextLabel has tones rather than colours. */
export const LABEL_TONES: { value: 'dark' | 'light' | 'orange'; name: string; swatch: string }[] = [
  { value: 'orange', name: 'Orange', swatch: tokens.color.orange },
  { value: 'dark', name: 'Midnight', swatch: tokens.color.midnight },
  { value: 'light', name: 'White', swatch: tokens.color.white },
];

/** Overlays shown during a step (output time), excluding the automatic plumbing. */
export function overlaysIn(tl: Timeline, span: Pick<StepSpan, 'start' | 'end'>): OverlayInstance[] {
  return tl.overlays.filter((o) => isOnScreen(o) && o.start < span.end - 0.01 && o.end > span.start + 0.01);
}

export type Pace = { kind: 'normal' } | { kind: 'fast'; rate: number } | { kind: 'skip' };

/** The recorded pieces that show part of a step (take time overlap), per recording scene. */
function piecesOf(tl: Timeline, step: Step) {
  const out: { sceneId: string; index: number; seg: Exclude<Segment, { kind: 'hold' }> }[] = [];
  for (const sc of tl.scenes) {
    if (sc.kind !== 'recording' || sc.take !== step.take) continue;
    sc.segments.forEach((seg, index) => {
      if (seg.kind === 'hold') return;
      const overlap = Math.min(seg.to, step.to) - Math.max(seg.from, step.from);
      if (overlap > 0.05) out.push({ sceneId: sc.id, index, seg });
    });
  }
  return out;
}

/**
 * A step's pace, read from the pieces of the recording that show it: none left (cut) is Skip,
 * all sped up by hand is Faster, anything else (including the timing fit's own speed-ups) is
 * Normal.
 */
export function stepPace(tl: Timeline, step: Step): Pace {
  const pieces = piecesOf(tl, step);
  if (!pieces.length) return { kind: 'skip' };
  const fast = pieces.every((p) => p.seg.kind === 'speed' && p.seg.manual && p.seg.rate > 1.2);
  if (fast) {
    const rates = pieces.map((p) => (p.seg.kind === 'speed' ? p.seg.rate : 1));
    return { kind: 'fast', rate: Math.round(Math.min(...rates) * 10) / 10 };
  }
  return { kind: 'normal' };
}

/** The cuts that took a step out (scene and the piece each cut follows), to put it back. */
export function cutsOver(tl: Timeline, step: Step): { sceneId: string; after: number }[] {
  const out: { sceneId: string; after: number }[] = [];
  for (const sc of tl.scenes) {
    if (sc.kind !== 'recording' || sc.take !== step.take) continue;
    for (const g of cutGaps(sc.segments))
      if (Math.min(g.to, step.to) - Math.max(g.from, step.from) > 0.05)
        out.push({ sceneId: sc.id, after: g.after });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The agent's activity in plain words
// ---------------------------------------------------------------------------

const TOOL_WORDS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Bash: 'Running a command',
  Grep: 'Searching',
  Glob: 'Looking for files',
  WebFetch: 'Reading a web page',
  WebSearch: 'Searching the web',
  TodoWrite: 'Planning',
  Task: 'Working on a sub-task',
  Skill: 'Using a skill',
};

/** "mcp__studio__add_overlay" → "Add overlay"; Read → "Reading …". */
export function toolPhrase(name: string, summary = ''): string {
  const short = name.replace(/^mcp__[^_]+__/, '');
  const verb = TOOL_WORDS[short];
  const file = summary.split('/').pop() ?? summary;
  if (verb) return verb === 'Running a command' || !file ? verb : `${verb} ${file}`.slice(0, 80);
  const words = short
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The current turn's events: everything after the last message sent into the session. */
export function currentTurn(events: AgentEvent[]): AgentEvent[] {
  let i = events.length - 1;
  while (i >= 0 && events[i]!.kind !== 'user') i--;
  return i >= 0 ? events.slice(i) : events;
}

/** What the agent is doing now, the steps it finished, and when the turn started. */
export function agentActivity(events: AgentEvent[]) {
  const turn = currentTurn(events);
  const done = new Set(
    turn.filter((e) => e.kind === 'tool_result').map((e) => (e.kind === 'tool_result' ? e.id : '')),
  );
  const uses = turn.filter((e): e is Extract<AgentEvent, { kind: 'tool_use' }> => e.kind === 'tool_use');
  const open = [...uses].reverse().find((u) => !done.has(u.id));
  const lastStatus = [...turn].reverse().find((e) => e.kind === 'status' || e.kind === 'text');
  const label = open
    ? toolPhrase(open.name, open.summary)
    : lastStatus && lastStatus.kind === 'status'
      ? lastStatus.text
      : 'Thinking';
  const steps = uses.filter((u) => done.has(u.id)).map((u) => toolPhrase(u.name, u.summary));
  const first = turn[0];
  const prompt = first?.kind === 'user' ? first.text : '';
  return { label, steps, since: first?.at ?? Date.now(), prompt, last: open ?? uses.at(-1) ?? null };
}

/**
 * Which step the agent is working on, if its words or tool input say: an anchor or step id,
 * an output time, or "step N" in the message.
 */
export function agentTarget(
  activity: ReturnType<typeof agentActivity>,
  steps: StepSpan[],
): { stepId: string | null } {
  const input = (activity.last?.input ?? {}) as Record<string, unknown>;
  const anchor = input.anchor as { stepId?: unknown } | undefined;
  const id =
    typeof input.stepId === 'string'
      ? input.stepId
      : typeof anchor?.stepId === 'string'
        ? anchor.stepId
        : null;
  if (id && steps.some((s) => s.id === id)) return { stepId: id };
  const at = [input.at, input.from, input.start].find((v): v is number => typeof v === 'number');
  if (at !== undefined) {
    const s = steps.find((x) => at >= x.start && at < x.end);
    if (s) return { stepId: s.id };
  }
  const m = /\bstep\s+(\d+)/i.exec(activity.prompt);
  if (m) {
    const s = steps[Number(m[1]) - 1];
    if (s) return { stepId: s.id };
  }
  return { stepId: null };
}
