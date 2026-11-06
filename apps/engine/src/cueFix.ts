import type { LateCueFix, RecorderEvent } from '@studio/core';
import { CUE_TOLERANCE, lateCues } from './pace';

/** Fastest the wait before a late action is played to bring it onto its word. */
export const MAX_CUE_SPEED = 4;
/** Event-free stretches shorter than this aren't sped up to fix a late action. */
const MIN_CUE_IDLE = 0.5;

type Interval = [number, number];

/** A retiming of a paced take's voiced part, in take time. */
export type CueOp =
  { kind: 'speed'; from: number; to: number; rate: number } | { kind: 'hold'; at: number; duration: number };

export interface CueFixPlan {
  /** Per step: the speed-ups and freezes that put its actions back on their words. */
  ops: Map<string, CueOp[]>;
  /** Each late action and what the edit does with it. */
  cues: LateCueFix[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function idleIn(range: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = range[0];
  for (const [a, b] of busy) {
    if (b <= cur || a >= range[1]) continue;
    if (a > cur) out.push([cur, Math.min(a, range[1])]);
    cur = Math.max(cur, b);
  }
  if (cur < range[1]) out.push([cur, range[1]]);
  return out.filter(([a, b]) => b - a >= MIN_CUE_IDLE);
}

/**
 * How the edit brings a paced take's late actions onto their words. The recorder waits for each
 * cue's word, so an action can only land late, when the product kept the script waiting. Before
 * a late action, the event-free stretches since the previous action of its step (the wait) are
 * sped up, at most MAX_CUE_SPEED, until it lands on its word; the actions after it would then
 * come early, so a freeze before the next one gives the time back. `busy` is the take's busy
 * intervals (merged, in order), as the timing fit computes them.
 */
export function planCueFixes(events: RecorderEvent[], busy: Interval[]): CueFixPlan {
  const ops = new Map<string, CueOp[]>();
  const fixes = new Map<RecorderEvent, { rate: number | null; left: number }>();
  const starts = new Map<string, number>();
  const cued = new Map<string, Extract<RecorderEvent, { kind: 'click' | 'key' }>[]>();
  for (const e of events) {
    if (e.kind === 'step-start' && !starts.has(e.stepId)) starts.set(e.stepId, e.t);
    if ((e.kind === 'click' || e.kind === 'key') && e.cue)
      cued.set(e.stepId, [...(cued.get(e.stepId) ?? []), e]);
  }
  for (const [stepId, actions] of cued) {
    const own: CueOp[] = [];
    let prev = starts.get(stepId) ?? Math.min(...actions.map((a) => a.t)) - 1;
    // How much earlier than recorded the edit shows this point of the step.
    let shift = 0;
    for (const a of [...actions].sort((x, y) => x.t - y.t)) {
      const d = a.t - a.cue!.at;
      const target = d > CUE_TOLERANCE ? d : 0;
      const delta = target - shift;
      const idle = idleIn([prev, a.t], busy);
      let rate: number | null = null;
      if (delta > CUE_TOLERANCE) {
        const total = idle.reduce((n, [x, y]) => n + (y - x), 0);
        if (total > 0) {
          rate = r2(Math.min(MAX_CUE_SPEED, total > delta ? total / (total - delta) : MAX_CUE_SPEED));
          if (rate > 1) {
            for (const [x, y] of idle) own.push({ kind: 'speed', from: r3(x), to: r3(y), rate });
            shift += total - total / rate;
          } else rate = null;
        }
      } else if (delta < -CUE_TOLERANCE) {
        // An earlier action was brought forward: freeze in the gap so this one stays on its word.
        const at = idle[0]?.[0] ?? prev;
        own.push({ kind: 'hold', at: r3(at), duration: r3(-delta) });
        shift = target;
      }
      if (d > CUE_TOLERANCE) fixes.set(a, { rate, left: r2(Math.max(0, d - shift)) });
      prev = a.t;
    }
    if (own.length) ops.set(stepId, own);
  }
  // The late actions in take order, with what came before each (lateCues' view).
  const late = lateCues(events);
  const lateEvents = events.filter((e) => fixes.has(e));
  const cues: LateCueFix[] = late.map((c, i) => {
    const fix = fixes.get(lateEvents[i]!) ?? { rate: null, left: c.late };
    return { ...c, rate: fix.rate, left: fix.left };
  });
  return { ops, cues };
}

/** One line per late action for the gate and the stage summary. */
export function cueFixLine(c: LateCueFix): string {
  const head = `${c.stepId} · "${c.word}" landed ${c.late.toFixed(1)} s late, ${c.gap.toFixed(1)} s after ${c.after}`;
  if (c.rate === null) return `${head}: nothing to speed up before it, stays late`;
  return c.left > CUE_TOLERANCE
    ? `${head}: the wait before it plays ${c.rate}×, still ${c.left.toFixed(1)} s late`
    : `${head}: the wait before it plays ${c.rate}×, on its word`;
}
