import type { RecorderEvent } from './schemas';
import type { OverlayInstance, Scene, Step, Take, Timeline } from './schemas';

/**
 * Builds the recording scene and steps of a timeline from a take and its events:
 * one scene playing the whole take, and one step per `tut.step` with its source range and
 * the box of its first click/type target (the step's "primary" anchor).
 */
export function deriveFromTake(take: Take, events: RecorderEvent[]): { scenes: Scene[]; steps: Step[] } {
  const scene: Scene = {
    id: `sc-${take.id}`,
    kind: 'recording',
    take: take.id,
    segments: [{ kind: 'src', from: 0, to: take.duration }],
  };
  const steps: Step[] = [];
  for (const e of events) {
    if (e.kind !== 'step-start') continue;
    const end = events.find((x) => x.kind === 'step-end' && x.stepId === e.stepId)?.t ?? take.duration;
    const target = events.find(
      (x): x is Extract<RecorderEvent, { kind: 'click' | 'type' }> =>
        (x.kind === 'click' || x.kind === 'type') && x.stepId === e.stepId,
    );
    steps.push({
      id: e.stepId,
      title: e.title,
      take: take.id,
      from: Math.min(e.t, take.duration),
      to: Math.min(Math.max(end, e.t), take.duration),
      narration: '',
      ...(target ? { bbox: target.bbox } : {}),
    });
  }
  return { scenes: [scene], steps };
}

/** The pointer the video lacks: Cursor and ClickRipple over the whole take (author "auto"). */
export function pointerOverlays(take: Take, events: RecorderEvent[]): OverlayInstance[] {
  if (!events.some((e) => e.kind === 'mouse' || e.kind === 'click')) return [];
  return pointerOverlayInstances(take.duration);
}

/** Cursor and ClickRipple instances spanning `duration` seconds. */
export function pointerOverlayInstances(duration: number): OverlayInstance[] {
  if (duration <= 0) return [];
  const base = { start: 0, end: duration, props: {}, author: 'auto' as const };
  return [
    { ...base, id: 'auto-cursor', component: 'core:Cursor', layer: 90 },
    { ...base, id: 'auto-click-ripple', component: 'core:ClickRipple', layer: 89 },
  ];
}

const POINTER = new Set(['auto-cursor', 'auto-click-ripple']);

/**
 * Replaces the recording scene/steps of `tl` with ones derived from `take`. Overlays are kept,
 * except the automatic pointer overlays, which are recreated for the new take.
 */
export function withTake(tl: Timeline, take: Take, events: RecorderEvent[]): Timeline {
  const { scenes, steps } = deriveFromTake(take, events);
  const takes = [...tl.takes.filter((t) => t.id !== take.id), take];
  const stepIds = new Set(steps.map((s) => s.id));
  return {
    ...tl,
    takes,
    scenes,
    transitions: [],
    steps,
    // Anchors to steps that no longer exist would make the timeline invalid.
    overlays: [
      ...tl.overlays
        .filter((o) => !(o.author === 'auto' && POINTER.has(o.id)))
        .map((o) => (o.anchor && !stepIds.has(o.anchor.stepId) ? { ...o, anchor: undefined } : o)),
      ...pointerOverlays(take, events),
    ],
  };
}
