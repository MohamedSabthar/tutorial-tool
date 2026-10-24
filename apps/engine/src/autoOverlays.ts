import {
  buildTimeMap,
  cutGaps,
  pointerOverlayInstances,
  type OverlayInstance,
  type Rect,
  type RecorderEvent,
  type Timeline,
} from '@studio/core';
import { clampCamera, fitSource, sourceToStage, STAGE_SIZE, type Fit } from '@studio/stage';

/** Actions closer than this (take seconds, same step) share one zoom. */
const CLUSTER_GAP = 3;
// The camera starts moving this long before the first action, so it has settled when it happens.
const ZOOM_IN = 1.0;
const ZOOM_OUT = 1.2;
const TYPE_CPS = 14;
/** Played at least this fast, a stretch shows the fast-forward badge. */
const FF_RATE = 2;
/** Speeds above this are product waits skipped over, shown without a number. */
const FF_ACTION_MAX = 4;
/** Fast-forwarded stretches closer than this (output seconds) share one badge. */
const FF_JOIN = 0.6;
/** A badge shorter than this would only flash, so none is shown. */
const FF_MIN = 1.2;
/** Cuts shorter than this (seconds of take) get no "skipped" badge. */
const SKIP_MIN = 1;
/** How long the "skipped" badge shows after a cut. */
const SKIP_SHOW = 1.6;

type Action = Extract<RecorderEvent, { kind: 'click' | 'type' }>;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function union(boxes: Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Whether a box sits close enough to a group of boxes to share one shot with them. */
function near(group: Rect[], box: Rect): boolean {
  const u = union([...group, box]);
  const w = Math.max(box.w, ...group.map((b) => b.w));
  const h = Math.max(box.h, ...group.map((b) => b.h));
  return u.w <= 2.5 * w && u.h <= 2.5 * h;
}

/**
 * Whether `box` (source px) is comfortably visible in the shot framing `shot` (source px): the
 * zoomed, clamped view keeps a 10% margin around it.
 */
function inView(shot: Rect, box: Rect, fit: Fit): boolean {
  const s = sourceToStage(shot, fit);
  const b = sourceToStage(box, fit);
  const cam = clampCamera(
    { zoom: zoomFor(s), focusX: s.x + s.w / 2, focusY: s.y + s.h / 2 },
    fit.rect,
    STAGE_SIZE,
  );
  const halfW = (STAGE_SIZE.width / 2 / cam.zoom) * 0.9;
  const halfH = (STAGE_SIZE.height / 2 / cam.zoom) * 0.9;
  return (
    b.x >= cam.focusX - halfW &&
    b.x + b.w <= cam.focusX + halfW &&
    b.y >= cam.focusY - halfH &&
    b.y + b.h <= cam.focusY + halfH
  );
}

/** Zoom that keeps the target comfortably inside the frame, with context around it: 1.25×–1.55×. */
export function zoomFor(stageBox: Rect): number {
  const fill = Math.min(
    (STAGE_SIZE.width * 0.5) / Math.max(stageBox.w, 1),
    (STAGE_SIZE.height * 0.5) / Math.max(stageBox.h, 1),
  );
  return Math.round(Math.min(1.55, Math.max(1.25, fill)) * 100) / 100;
}

export interface AutoOptions {
  /** Tutorial title for the opening TitleCard (none when empty). */
  title?: string;
  subtitle?: string;
}

/**
 * The default edit, derived from the recorder's events: the pointer (Cursor + ClickRipple),
 * a short Zoom on each cluster of clicks and typing, a Blur over every `tut.mask` area, a
 * FastForward badge wherever the timing fit plays the take faster, and a TitleCard on the first
 * step. Times are output times of the current timeline, so this runs
 * again whenever the timeline's timing changes (take registered, timing fit).
 */
export function autoOverlays(
  tl: Timeline,
  events: RecorderEvent[],
  opts: AutoOptions = {},
): OverlayInstance[] {
  const take = tl.takes.at(-1);
  if (!take) return [];
  const tm = buildTimeMap(tl);
  const fit = fitSource(take, STAGE_SIZE);
  const out = (t: number) => tm.toOutput(take.id, t)[0];
  const stage = (b: Rect) => {
    const s = sourceToStage(b, fit);
    return { x: r3(s.x), y: r3(s.y), w: r3(s.w), h: r3(s.h) };
  };
  const result: OverlayInstance[] = events.some((e) => e.kind === 'mouse' || e.kind === 'click')
    ? pointerOverlayInstances(tm.duration)
    : [];

  // Zooms on clusters of actions.
  const actions = events.filter((e): e is Action => e.kind === 'click' || e.kind === 'type');
  const clusters: Action[][] = [];
  for (const a of actions) {
    const cur = clusters.at(-1);
    const last = cur?.at(-1);
    const lastEnd = last ? last.t + (last.kind === 'type' ? last.text.length / TYPE_CPS : 0) : -Infinity;
    if (
      cur &&
      last &&
      last.stepId === a.stepId &&
      a.t - lastEnd < CLUSTER_GAP &&
      near(
        cur.map((x) => x.bbox),
        a.bbox,
      )
    )
      cur.push(a);
    else clusters.push([a]);
  }
  const zooms: { start: number; end: number; box: Rect }[] = [];
  for (const c of clusters) {
    const first = c[0]!;
    const last = c.at(-1)!;
    const s = out(first.t);
    const e = out(last.t + (last.kind === 'type' ? last.text.length / TYPE_CPS : 0));
    if (s === undefined || e === undefined) continue; // cut out of the video
    const z = {
      start: Math.max(0, s - ZOOM_IN),
      end: Math.min(tm.duration, e + ZOOM_OUT),
      box: union(c.map((a) => a.bbox)),
    };
    const prev = zooms.at(-1);
    if (prev && z.start < prev.end + 1.5 && inView(prev.box, z.box, fit)) {
      // The next target is already on screen in this shot: hold it instead of moving.
      prev.end = Math.max(prev.end, z.end);
      continue;
    }
    if (prev && z.start < prev.end + 0.3) {
      if (near([prev.box], z.box)) {
        // Targets side by side: one shot framing both.
        prev.end = Math.max(prev.end, z.end);
        prev.box = union([prev.box, z.box]);
        continue;
      }
      // Targets apart: separate shots that meet, so the camera glides from one to the next.
      prev.end = Math.max(prev.start + 0.8, Math.min(prev.end, z.start));
    }
    zooms.push(z);
  }
  zooms.forEach((z, i) => {
    if (z.end - z.start < 0.5) return;
    const rect = stage(z.box);
    result.push({
      id: `auto-zoom-${i + 1}`,
      component: 'core:Zoom',
      start: r3(z.start),
      end: r3(z.end),
      layer: 5,
      rect,
      props: { zoom: zoomFor(rect), ease: 0.9 },
      author: 'auto',
    });
  });

  // Blur every masked area from the moment it was marked.
  events
    .filter((e): e is Extract<RecorderEvent, { kind: 'mask' }> => e.kind === 'mask')
    .forEach((m, i) => {
      const s = out(m.t) ?? 0;
      if (tm.duration - s < 0.1) return;
      result.push({
        id: `auto-blur-${i + 1}`,
        component: 'core:Blur',
        start: r3(s),
        end: r3(tm.duration),
        layer: 80,
        rect: stage(m.bbox),
        props: {},
        author: 'auto',
      });
    });

  // A badge over every stretch the timing fit fast-forwards.
  const ff: { start: number; end: number; rate: number }[] = [];
  for (const s of tm.segments) {
    if (s.segment.kind !== 'speed' || s.segment.rate < FF_RATE) continue;
    const rate = s.segment.rate <= FF_ACTION_MAX ? s.segment.rate : 0;
    const prev = ff.at(-1);
    if (prev && s.start - prev.end < FF_JOIN) {
      prev.end = s.end;
      prev.rate = Math.max(prev.rate, rate);
    } else ff.push({ start: s.start, end: s.end, rate });
  }
  ff.filter((f) => f.end - f.start >= FF_MIN).forEach((f, i) => {
    result.push({
      id: `auto-ff-${i + 1}`,
      component: 'core:FastForward',
      start: r3(f.start),
      end: r3(f.end),
      layer: 75,
      props: { rate: Math.round(f.rate * 10) / 10 },
      author: 'auto',
    });
  });

  // A "skipped" badge just after every cut, so a jump reads as an edit, not a glitch.
  for (const sc of tl.scenes) {
    if (sc.kind !== 'recording') continue;
    for (const gap of cutGaps(sc.segments)) {
      // The jump shows where the next recorded piece starts (after any freeze in between).
      const next = sc.segments.findIndex((g, i) => i > gap.after && g.kind !== 'hold');
      const span = tm.segments.find((g) => g.sceneId === sc.id && g.index === next);
      if (!span || gap.to - gap.from < SKIP_MIN) continue;
      const end = Math.min(span.start + SKIP_SHOW, tm.duration);
      if (end - span.start < 0.3) continue;
      result.push({
        id: `auto-skip-${sc.id}-${gap.after}`,
        component: 'core:Skip',
        start: r3(span.start),
        end: r3(end),
        layer: 75,
        props: { seconds: r3(gap.to - gap.from) },
        author: 'auto',
      });
    }
  }

  // Captions show the captions track's cue at each moment.
  if (tl.captions.length)
    result.push({
      id: 'auto-captions',
      component: 'core:Captions',
      start: 0,
      end: r3(tm.duration),
      layer: 70,
      props: {},
      author: 'auto',
    });

  // A title card over the start of the first step, gone before the first action so it never
  // covers what is being clicked.
  const firstStep = tl.steps[0];
  const titleAt = firstStep ? out(firstStep.from) : undefined;
  const firstAction = actions.map((a) => out(a.t)).find((t) => t !== undefined);
  const titleEnd = Math.min(tm.duration, (titleAt ?? 0) + 3.2, (firstAction ?? Infinity) - ZOOM_IN);
  if (opts.title && titleAt !== undefined && titleEnd - titleAt >= 1.5) {
    result.push({
      id: 'auto-title',
      component: 'core:TitleCard',
      start: r3(titleAt + 0.2),
      end: r3(titleEnd),
      layer: 60,
      props: { title: opts.title, ...(opts.subtitle ? { subtitle: opts.subtitle } : {}) },
      author: 'auto',
    });
  }
  return result;
}

/**
 * Replaces the timeline's automatic overlays (author "auto", id "auto-…") with fresh ones. An
 * automatic overlay the user edited keeps its id but became theirs; its fresh twin is skipped.
 */
export function withAutoOverlays(tl: Timeline, events: RecorderEvent[], opts: AutoOptions = {}): Timeline {
  const kept = tl.overlays.filter((o) => !(o.author === 'auto' && o.id.startsWith('auto-')));
  const taken = new Set(kept.map((o) => o.id));
  return { ...tl, overlays: [...kept, ...autoOverlays(tl, events, opts).filter((o) => !taken.has(o.id))] };
}
