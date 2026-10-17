import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTimeMap,
  RecorderEvent,
  RpcError,
  voiceSpans,
  type Segment,
  type Step,
  type Timeline,
  type TimelinePatch,
  type VoiceLine,
} from '@studio/core';
import type { ProjectStore } from './projects';
import type { Author, TimelineStore } from './timeline';
import { LEAD_IN } from './vo';
import { withAutoOverlays } from './autoOverlays';
import { withCaptions } from './captions';

/** Fastest an idle stretch is played. */
export const MAX_SPEED = 1.5;
/** Minimum gap between a click and the next line starting. */
export const CLICK_GAP = 0.6;
/** Silence left after a line before the next step's action. */
export const TAIL = 0.35;
/** Event-free stretches shorter than this are left alone. */
const MIN_IDLE = 1.2;
const FRAME = 1 / 30;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const snap = (n: number) => Math.round(n / FRAME) * FRAME;

type Interval = [number, number];

export interface StepFit {
  stepId: string;
  /** Output seconds of the step's action before fitting (after cuts). */
  action: number;
  /** Seconds the step needs: lead-in + voice + tail (0 without a voice line). */
  needed: number;
  hold: number;
  /** Speed applied to idle stretches (1 = none). */
  speed: number;
  /** Seconds the voice still runs past the step (should be 0). */
  overrun: number;
}

export interface FitResult {
  timeline: Timeline;
  steps: StepFit[];
  before: number;
  after: number;
}

/** Merges overlapping intervals. */
function merge(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `range` minus `busy`. */
function subtract(range: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = range[0];
  for (const [a, b] of merge(busy)) {
    if (b <= cur || a >= range[1]) continue;
    if (a > cur) out.push([cur, Math.min(a, range[1])]);
    cur = Math.max(cur, b);
  }
  if (cur < range[1]) out.push([cur, range[1]]);
  return out;
}

/** Take-time intervals where something happens on screen (pointer, clicks, typing, keys). */
export function busyIntervals(events: RecorderEvent[]): Interval[] {
  const busy: Interval[] = [];
  for (const e of events) {
    if (e.kind === 'mouse' && e.points.length) busy.push([e.points[0]![0] - 0.1, e.points.at(-1)![0] + 0.2]);
    else if (e.kind === 'click' || e.kind === 'key') busy.push([e.t - 0.2, e.t + 0.6]);
    else if (e.kind === 'type') busy.push([e.t - 0.2, e.t + e.text.length / 14 + 0.6]);
    else if (e.kind === 'step-start') busy.push([e.t, e.t + 0.3]);
  }
  return merge(busy);
}

/** Seconds since the last click/type/key before take time `t` (Infinity if none). */
function sinceLastAction(events: RecorderEvent[], t: number): number {
  let last = -Infinity;
  for (const e of events)
    if ((e.kind === 'click' || e.kind === 'key' || e.kind === 'type') && e.t <= t) last = Math.max(last, e.t);
  return t - last;
}

/**
 * Fits the recording to the voice-over, step by step: a step whose line runs longer than its
 * action gets a freeze at its end; a step whose action runs longer gets its idle stretches sped
 * up (at most 1.5×). Lines start at least CLICK_GAP after the previous click. Cuts the user made
 * (the source ranges the scene shows) are kept; earlier holds and speed changes are recomputed.
 */
export function fitTiming(tl: Timeline, events: RecorderEvent[]): FitResult {
  const before = buildTimeMap(tl).duration;
  const lineOf = new Map<string, VoiceLine>();
  for (const v of tl.voice) lineOf.set(v.owner, v);
  const busy = busyIntervals(events);
  const fits: StepFit[] = [];
  const leadIns = new Map<string, number>();

  const scenes = tl.scenes.map((scene) => {
    if (scene.kind !== 'recording') return scene;
    const kept = merge(
      scene.segments.filter((s) => s.kind !== 'hold').map((s) => [s.from, s.to] as Interval),
    );
    const steps = tl.steps.filter((s) => s.take === scene.take).sort((a, b) => a.from - b.from);
    const ownerAt = (t: number): Step | undefined => steps.find((s) => t >= s.from && t < s.to);

    // Pieces of kept source, split at step boundaries.
    const cuts = [...new Set(steps.flatMap((s) => [s.from, s.to]))];
    const pieces: { range: Interval; step: Step | undefined }[] = [];
    for (const [a, b] of kept) {
      const inner = cuts.filter((c) => c > a && c < b).sort((x, y) => x - y);
      let from = a;
      for (const c of [...inner, b]) {
        pieces.push({ range: [from, c], step: ownerAt(from) });
        from = c;
      }
    }

    const segments: Segment[] = [];
    let i = 0;
    while (i < pieces.length) {
      const step = pieces[i]!.step;
      if (!step) {
        const [from, to] = pieces[i]!.range;
        segments.push({ kind: 'src', from: r3(from), to: r3(to) });
        i++;
        continue;
      }
      const own: Interval[] = [];
      while (i < pieces.length && pieces[i]!.step === step) own.push(pieces[i++]!.range);
      const action = own.reduce((n, [a, b]) => n + (b - a), 0);
      const line = lineOf.get(step.id);
      const leadIn = Math.max(LEAD_IN, CLICK_GAP - sinceLastAction(events, own[0]![0]));
      leadIns.set(step.id, r3(leadIn));
      const needed = line ? leadIn + line.duration + TAIL : 0;

      // Speed up idle stretches when the action is clearly longer than the voice.
      let speed = 1;
      const idle = own.flatMap((r) => subtract(r, busy)).filter(([a, b]) => b - a >= MIN_IDLE);
      const idleTotal = idle.reduce((n, [a, b]) => n + (b - a), 0);
      const excess = line ? action - needed : 0;
      if (excess > 0.5 && idleTotal > 0) {
        const saved = Math.min(excess, idleTotal * (1 - 1 / MAX_SPEED));
        speed = Math.round((idleTotal / (idleTotal - saved)) * 100) / 100;
      }
      for (const r of own) {
        const parts = speed > 1 ? splitIdle(r, idle) : [{ range: r, idle: false }];
        for (const p of parts) {
          const [from, to] = p.range;
          if (to - from < 1e-3) continue;
          segments.push(
            p.idle
              ? { kind: 'speed', from: r3(from), to: r3(to), rate: speed }
              : { kind: 'src', from: r3(from), to: r3(to) },
          );
        }
      }
      const fitted = action - (speed > 1 ? idleTotal * (1 - 1 / speed) : 0);
      const hold = line && needed > fitted ? snap(needed - fitted + FRAME / 2) : 0;
      if (hold > 0)
        segments.push({
          kind: 'hold',
          at: r3(Math.max(own.at(-1)![1] - FRAME, own.at(-1)![0])),
          duration: r3(hold),
        });
      fits.push({
        stepId: step.id,
        action: r3(action),
        needed: r3(needed),
        hold: r3(hold),
        speed,
        overrun: 0,
      });
    }
    return { ...scene, segments: compact(segments) };
  });

  const voice = tl.voice.map((v) => (leadIns.has(v.owner) ? { ...v, start: leadIns.get(v.owner)! } : v));
  const timeline: Timeline = { ...tl, scenes, voice };

  // Check: each line ends before the next step's action starts.
  const tm = buildTimeMap(timeline);
  const spans = voiceSpans(timeline, tm);
  const starts = tl.steps.map((s) => ({ id: s.id, at: tm.toOutput(s.take, s.from)[0] ?? Infinity }));
  for (const f of fits) {
    const span = spans.find((s) => s.line.owner === f.stepId);
    const own = starts.find((s) => s.id === f.stepId)?.at ?? 0;
    const next = Math.min(...starts.filter((s) => s.at > own).map((s) => s.at), tm.duration);
    if (span) f.overrun = r3(Math.max(0, span.end - next));
  }
  return { timeline, steps: fits, before: r3(before), after: r3(tm.duration) };
}

/** Joins back-to-back pieces of the same kind and rate (step boundaries split them). */
function compact(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out.at(-1);
    if (
      last &&
      last.kind !== 'hold' &&
      s.kind === last.kind &&
      Math.abs(s.from - last.to) < 1e-3 &&
      (s.kind === 'src' || (last.kind === 'speed' && s.rate === last.rate))
    )
      out[out.length - 1] = { ...last, to: s.to };
    else out.push(s);
  }
  return out;
}

/** Splits a range into idle and active parts. */
function splitIdle(range: Interval, idle: Interval[]): { range: Interval; idle: boolean }[] {
  const out: { range: Interval; idle: boolean }[] = [];
  let cur = range[0];
  for (const [a, b] of idle) {
    if (b <= range[0] || a >= range[1]) continue;
    const s = Math.max(a, range[0]);
    const e = Math.min(b, range[1]);
    if (s > cur) out.push({ range: [cur, s], idle: false });
    out.push({ range: [s, e], idle: true });
    cur = e;
  }
  if (cur < range[1]) out.push({ range: [cur, range[1]], idle: false });
  return out;
}

/** Loads a take's events and applies the fit as one patch. */
export class TimingFit {
  constructor(private deps: { store: ProjectStore; timelines: TimelineStore }) {}

  async fit(slug: string, opts: { author?: Author; group?: string | null } = {}) {
    const { timeline } = await this.deps.timelines.get(slug);
    const take = timeline.takes.at(-1);
    if (!take) throw new RpcError('There is no take to fit yet.', 'bad_request');
    if (!timeline.voice.length) throw new RpcError('There is no voice-over to fit to yet.', 'bad_request');
    const events = await readEvents(this.deps.store.dir(slug), take.events);
    const r = fitTiming(timeline, events);
    // Automatic overlays are in output time: rebuild them for the new timing.
    const { project } = await this.deps.store.open(slug);
    const captioned = withCaptions(r.timeline);
    const overlays = withAutoOverlays(captioned, events, { title: project.title }).overlays;
    const patch: TimelinePatch = [
      ...r.timeline.scenes.flatMap((s, i) =>
        s.kind === 'recording'
          ? [{ op: 'replace' as const, path: `/scenes/${i}/segments`, value: s.segments }]
          : [],
      ),
      { op: 'replace', path: '/voice', value: r.timeline.voice },
      { op: 'replace', path: '/captions', value: captioned.captions },
      { op: 'replace', path: '/overlays', value: overlays },
    ];
    await this.deps.timelines.patch(slug, patch, {
      author: opts.author ?? 'user',
      group: opts.group ?? null,
      label: 'Fit timing',
    });
    return { steps: r.steps, before: r.before, after: r.after };
  }
}

export async function readEvents(projectDir: string, rel: string): Promise<RecorderEvent[]> {
  const text = await readFile(path.join(projectDir, rel), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => RecorderEvent.parse(JSON.parse(l)));
}
