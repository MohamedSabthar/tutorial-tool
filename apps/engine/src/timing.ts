import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTimeMap,
  cutGaps,
  editPiece,
  editRange,
  findSilences,
  pieceAt,
  outputRemapper,
  segmentDuration,
  remapOutputItems,
  RecorderEvent,
  RpcError,
  voiceSpans,
  type PieceEdit,
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

/** Fastest unnarrated action (clicking, typing) is played after a line ends; it shows a badge. */
export const MAX_SPEED = 4;
/** Seconds of silence kept at normal speed after a line before fast-forwarding starts. */
export const GRACE = 1;
/** A product wait after a line is fast-forwarded down to about this long. */
export const WAIT_KEEP = 0.8;
/** Fastest a product wait is played (a static screen; the export reads frames at any speed). */
export const MAX_WAIT_SPEED = 16;
/** Unnarrated action shorter than this after a line plays as recorded. */
const MIN_FF = 3;
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
  /** Fastest speed applied after the line (1 = none). */
  speed: number;
  /** Output seconds saved by fast-forwarding what runs on after the line. */
  saved: number;
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
 * Fits the recording to the voice-over, step by step. A step whose line runs longer than its
 * action gets a freeze at its end. A step whose action runs on after its line keeps the voiced
 * part as recorded (in a paced take its clicks land on their words) and GRACE seconds more, then
 * fast-forwards the rest: product waits down to about WAIT_KEEP seconds each, unnarrated action
 * at 2–4× (the automatic overlays badge it). Lines start at least CLICK_GAP after the previous
 * click. Cuts the user made (the source ranges the scene shows) are kept; earlier holds and speed
 * changes are recomputed, except on pieces edited by hand (`manual`), which stay as they are and
 * count towards their step's time.
 */
export function fitTiming(tl: Timeline, events: RecorderEvent[]): FitResult {
  const before = buildTimeMap(tl).duration;
  const linesOf = new Map<string, VoiceLine[]>();
  for (const v of tl.voice) linesOf.set(v.owner, [...(linesOf.get(v.owner) ?? []), v]);
  const busy = busyIntervals(events);
  const fits: StepFit[] = [];
  const leadIns = new Map<string, number>();

  const scenes = tl.scenes.map((scene) => {
    if (scene.kind !== 'recording') return scene;
    const kept = merge(
      scene.segments.flatMap((s) => (s.kind === 'hold' || s.manual ? [] : [[s.from, s.to] as Interval])),
    );
    const steps = tl.steps.filter((s) => s.take === scene.take).sort((a, b) => a.from - b.from);
    const ownerAt = (t: number): Step | undefined => steps.find((s) => t >= s.from && t < s.to);

    // Pieces of kept source, split at step boundaries. Hand-edited pieces come along as they are
    // (`fixed`); a hand-made freeze is a piece of no source length at its frame.
    const freezes = scene.segments.flatMap((s) => (s.kind === 'hold' && s.manual ? [s.at] : []));
    const cuts = [...new Set([...steps.flatMap((s) => [s.from, s.to]), ...freezes])];
    type Piece = { range: Interval; step: Step | undefined; fixed?: Segment };
    const pieces: Piece[] = [];
    const add = (a: number, b: number, fixed?: Segment) => {
      const inner = cuts.filter((c) => c > a && c < b).sort((x, y) => x - y);
      let from = a;
      for (const c of [...inner, b]) {
        const piece: Piece = { range: [from, c], step: ownerAt(from) };
        if (fixed) piece.fixed = { ...fixed, from: r3(from), to: r3(c) } as Segment;
        pieces.push(piece);
        from = c;
      }
    };
    for (const [a, b] of kept) add(a, b);
    for (const seg of scene.segments) {
      if (!seg.manual) continue;
      if (seg.kind === 'hold') {
        const step = ownerAt(seg.at) ?? steps.find((s) => Math.abs(s.to - seg.at) < 0.1);
        pieces.push({ range: [seg.at, seg.at], step, fixed: seg });
      } else add(seg.from, seg.to, seg);
    }
    // In take order; a freeze comes before the piece that starts on its frame.
    pieces.sort(
      (x, y) =>
        x.range[0] - y.range[0] || (x.fixed?.kind === 'hold' ? -1 : 0) - (y.fixed?.kind === 'hold' ? -1 : 0),
    );

    const segments: Segment[] = [];
    let i = 0;
    while (i < pieces.length) {
      const step = pieces[i]!.step;
      if (!step) {
        const { range, fixed } = pieces[i]!;
        segments.push(fixed ?? { kind: 'src', from: r3(range[0]), to: r3(range[1]) });
        i++;
        continue;
      }
      const own: Piece[] = [];
      while (i < pieces.length && pieces[i]!.step === step) own.push(pieces[i++]!);
      const action = own.reduce((n, { range: [a, b] }) => n + (b - a), 0);
      const lines = linesOf.get(step.id) ?? [];
      const line = lines.length > 0;
      const leadIn = Math.max(LEAD_IN, CLICK_GAP - sinceLastAction(events, own[0]!.range[0]));
      leadIns.set(step.id, r3(leadIn));
      // The step lasts until its last line ends: the generated line starts after the lead-in,
      // hand-placed lines where they were put.
      const needed = line
        ? Math.max(...lines.map((v) => (v.manual ? v.start : leadIn) + v.duration)) + TAIL
        : 0;

      // What runs on after the line (and a moment of grace) is fast-forwarded.
      const voiced = line ? needed + GRACE : Infinity;
      const kept: Interval[] = [];
      const after: Interval[] = [];
      const fixed: { range: Interval; segment: Segment }[] = [];
      let elapsed = 0;
      for (const piece of own) {
        const [a, b] = piece.range;
        if (piece.fixed) {
          fixed.push({ range: piece.range, segment: piece.fixed });
          elapsed += segmentDuration(piece.fixed);
          continue;
        }
        const split = Math.min(b, Math.max(a, a + (voiced - elapsed)));
        if (split > a) kept.push([a, split]);
        if (b > split) after.push([split, b]);
        elapsed += b - a;
      }
      const waits = after.flatMap((r) => subtract(r, busy)).filter(([a, b]) => b - a >= MIN_IDLE);
      const waitTotal = waits.reduce((n, [a, b]) => n + (b - a), 0);
      const unvoiced = after.reduce((n, [a, b]) => n + (b - a), 0) - waitTotal;
      const speed =
        unvoiced >= MIN_FF ? Math.round(Math.min(MAX_SPEED, Math.max(2, unvoiced / 8)) * 100) / 100 : 1;
      // A wait plays at least as fast as the action around it, so short pauses don't drag.
      const waitRate = (len: number) => {
        const rate = Math.max(speed, len > WAIT_KEEP * 1.5 ? len / WAIT_KEEP : 1);
        return Math.round(Math.min(MAX_WAIT_SPEED, rate) * 100) / 100;
      };
      const toSegment = ([from, to]: Interval, rate: number): Segment =>
        rate > 1
          ? { kind: 'speed', from: r3(from), to: r3(to), rate }
          : { kind: 'src', from: r3(from), to: r3(to) };
      const parts = [
        ...kept.map((range) => ({ range, segment: toSegment(range, 1) })),
        ...after.flatMap((r) =>
          splitIdle(r, waits).map((p) => ({
            range: p.range,
            segment: toSegment(p.range, p.idle ? waitRate(p.range[1] - p.range[0]) : speed),
          })),
        ),
        ...fixed,
      ]
        .filter(({ range: [a, b], segment }) => segment.kind === 'hold' || b - a >= 1e-3)
        .sort(
          (x, y) =>
            x.range[0] - y.range[0] ||
            (x.segment.kind === 'hold' ? -1 : 0) - (y.segment.kind === 'hold' ? -1 : 0),
        );
      let fitted = 0;
      for (const { segment } of parts) {
        fitted += segmentDuration(segment);
        segments.push(segment);
      }
      const last = [...own].reverse().find(({ range: [a, b] }) => b > a)?.range ?? own.at(-1)!.range;
      const hold = line && needed > fitted ? snap(needed - fitted + FRAME / 2) : 0;
      if (hold > 0)
        segments.push({
          kind: 'hold',
          at: r3(Math.max(last[1] - FRAME, last[0])),
          duration: r3(hold),
        });
      fits.push({
        stepId: step.id,
        action: r3(action),
        needed: r3(needed),
        hold: r3(hold),
        speed,
        saved: r3(action - fitted),
        overrun: 0,
      });
    }
    return { ...scene, segments: compact(segments) };
  });

  const voice = tl.voice.map((v) =>
    leadIns.has(v.owner) && !v.manual ? { ...v, start: leadIns.get(v.owner)! } : v,
  );
  const timeline: Timeline = { ...tl, scenes, voice };

  // Check: each line ends before the next step's action starts.
  const tm = buildTimeMap(timeline);
  const spans = voiceSpans(timeline, tm);
  const starts = tl.steps.map((s) => ({ id: s.id, at: tm.toOutput(s.take, s.from)[0] ?? Infinity }));
  for (const f of fits) {
    const ends = spans.filter((s) => s.line.owner === f.stepId).map((s) => s.end);
    const own = starts.find((s) => s.id === f.stepId)?.at ?? 0;
    const next = Math.min(...starts.filter((s) => s.at > own).map((s) => s.at), tm.duration);
    if (ends.length) f.overrun = r3(Math.max(0, Math.max(...ends) - next));
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
      !s.manual === !last.manual &&
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

/**
 * Saves new scene timing as one patch, with what depends on it: user overlays, captions and
 * annotations follow their moments; automatic overlays are rebuilt from the take's events.
 */
async function saveTiming(
  deps: { store: ProjectStore; timelines: TimelineStore },
  slug: string,
  before: Timeline,
  after: Timeline,
  events: RecorderEvent[],
  opts: { author?: Author; group?: string | null; label: string },
) {
  const { project } = await deps.store.open(slug);
  const captioned = withCaptions(remapOutputItems(after, outputRemapper(before, after)));
  const overlays = withAutoOverlays(captioned, events, { title: project.title }).overlays;
  const patch: TimelinePatch = [
    ...after.scenes.flatMap((s, i) =>
      s.kind === 'recording'
        ? [{ op: 'replace' as const, path: `/scenes/${i}/segments`, value: s.segments }]
        : [],
    ),
    { op: 'replace', path: '/voice', value: after.voice },
    { op: 'replace', path: '/captions', value: captioned.captions },
    { op: 'replace', path: '/annotations', value: captioned.annotations },
    { op: 'replace', path: '/overlays', value: overlays },
  ];
  await deps.timelines.patch(slug, patch, {
    author: opts.author ?? 'user',
    group: opts.group ?? null,
    label: opts.label,
  });
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
    await saveTiming(this.deps, slug, timeline, r.timeline, events, { ...opts, label: 'Fit timing' });
    return { steps: r.steps, before: r.before, after: r.after };
  }

  /**
   * A hand edit to one piece of a recording scene (speed, remove, freeze, back to automatic,
   * restore a cut). The piece is marked so later fits keep it.
   */
  async editPiece(
    slug: string,
    p: { sceneId: string; index: number; edit: PieceEdit },
    opts: { author?: Author; group?: string | null } = {},
  ) {
    const { timeline } = await this.deps.timelines.get(slug);
    const si = timeline.scenes.findIndex((s) => s.id === p.sceneId);
    const scene = timeline.scenes[si];
    if (!scene || scene.kind !== 'recording')
      throw new RpcError(`There is no recording scene ${p.sceneId}.`, 'bad_request');
    const take = timeline.takes.find((t) => t.id === scene.take);
    let segments: Segment[];
    try {
      segments = editPiece(scene.segments, p.index, p.edit, { takeDuration: take?.duration });
    } catch (e) {
      throw new RpcError(e instanceof Error ? e.message : String(e), 'bad_request');
    }
    if (!segments.some((s) => s.kind !== 'hold'))
      throw new RpcError('That would cut the whole recording out of the scene.', 'bad_request');
    const after: Timeline = {
      ...timeline,
      scenes: timeline.scenes.map((s, i) => (i === si ? { ...scene, segments } : s)),
    };
    const events = take ? await readEvents(this.deps.store.dir(slug), take.events) : [];
    await saveTiming(this.deps, slug, timeline, after, events, { ...opts, label: PIECE_LABEL[p.edit.op] });
    return { segments };
  }
}

/** Edits in output time, for the agent (it reads times from get_timeline, not piece indexes). */
export class RecordingEdits {
  constructor(
    private fit: TimingFit,
    private deps: { store: ProjectStore; timelines: TimelineStore },
  ) {}

  /** Speed, remove or hand back to the fit everything shown in output time [from, to). */
  async editRange(
    slug: string,
    p: { from: number; to: number; edit: Extract<PieceEdit, { op: 'speed' | 'remove' | 'auto' }> },
    opts: { author?: Author; group?: string | null } = {},
  ) {
    const { timeline } = await this.deps.timelines.get(slug);
    let r: ReturnType<typeof editRange>;
    try {
      r = editRange(timeline, p.from, p.to, p.edit);
    } catch (e) {
      throw new RpcError(e instanceof Error ? e.message : String(e), 'bad_request');
    }
    if (!r.timeline.scenes.some((s) => s.kind !== 'recording' || s.segments.some((g) => g.kind !== 'hold')))
      throw new RpcError('That would cut the whole recording out.', 'bad_request');
    const take = timeline.takes.at(-1);
    const events = take ? await readEvents(this.deps.store.dir(slug), take.events) : [];
    await saveTiming(this.deps, slug, timeline, r.timeline, events, {
      ...opts,
      label: PIECE_LABEL[p.edit.op],
    });
    return { pieces: r.pieces, duration: r3(buildTimeMap(r.timeline).duration) };
  }

  /** Freezes the frame shown at output time `at` for `seconds`. */
  async freezeAt(
    slug: string,
    p: { at: number; seconds: number },
    opts: { author?: Author; group?: string | null } = {},
  ) {
    const { timeline } = await this.deps.timelines.get(slug);
    const here = pieceAt(timeline, p.at);
    if (!here) throw new RpcError('No recording is shown at that time.', 'bad_request');
    return this.fit.editPiece(
      slug,
      {
        sceneId: here.sceneId,
        index: here.index,
        edit: { op: 'freeze', at: here.takeTime, duration: p.seconds },
      },
      opts,
    );
  }

  /** Puts back the recording cut out nearest output time `at` (within a second). */
  async restoreCutAt(slug: string, p: { at: number }, opts: { author?: Author; group?: string | null } = {}) {
    const { timeline } = await this.deps.timelines.get(slug);
    const cut = cutsOf(timeline)
      .filter((c) => Math.abs(c.at - p.at) <= 1)
      .sort((a, b) => Math.abs(a.at - p.at) - Math.abs(b.at - p.at))[0];
    if (!cut) throw new RpcError('There is no cut within a second of that time.', 'bad_request');
    return this.fit.editPiece(
      slug,
      { sceneId: cut.sceneId, index: cut.after, edit: { op: 'restoreCut' } },
      opts,
    );
  }
}

/** Every cut between recording pieces, with the output time where it falls. */
export function cutsOf(tl: Timeline) {
  const tm = buildTimeMap(tl);
  return tl.scenes.flatMap((sc) =>
    sc.kind !== 'recording'
      ? []
      : cutGaps(sc.segments).flatMap((g) => {
          const span = tm.segments.find((x) => x.sceneId === sc.id && x.index === g.after);
          return span ? [{ sceneId: sc.id, after: g.after, at: r3(span.end), from: g.from, to: g.to }] : [];
        }),
  );
}

const PIECE_LABEL: Record<PieceEdit['op'], string> = {
  speed: 'Change speed',
  remove: 'Remove piece',
  freeze: 'Add freeze',
  duration: 'Change freeze',
  auto: 'Automatic timing',
  restoreCut: 'Restore cut',
  trim: 'Trim piece',
};

/** The unvoiced stretches of a project's video (see findSilences), from its latest take's events. */
export async function projectSilences(
  deps: { store: ProjectStore; timelines: TimelineStore },
  slug: string,
  opts: { min?: number } = {},
) {
  const { timeline } = await deps.timelines.get(slug);
  const take = timeline.takes.at(-1);
  const events = take ? await readEvents(deps.store.dir(slug), take.events).catch(() => []) : [];
  return findSilences(timeline, events, opts);
}

export async function readEvents(projectDir: string, rel: string): Promise<RecorderEvent[]> {
  const text = await readFile(path.join(projectDir, rel), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => RecorderEvent.parse(JSON.parse(l)));
}
