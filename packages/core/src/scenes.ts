import { buildTimeMap, sceneDuration } from './timemap';
import type { ExplainerScene, RecordingScene, Scene, Segment, Timeline } from './schemas';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A scene id not used yet (`sc-<n>`). */
export function nextSceneId(tl: Pick<Timeline, 'scenes'>): string {
  const used = new Set(tl.scenes.map((s) => s.id));
  for (let n = tl.scenes.length + 1; ; n++) if (!used.has(`sc-${n}`)) return `sc-${n}`;
}

/** Splits a segment at `local` seconds of output into it. */
function splitSegment(s: Segment, local: number): [Segment, Segment] | null {
  if (s.kind === 'hold') {
    if (local <= 0 || local >= s.duration) return null;
    return [
      { kind: 'hold', at: s.at, duration: r3(local) },
      { kind: 'hold', at: s.at, duration: r3(s.duration - local) },
    ];
  }
  const rate = s.kind === 'speed' ? s.rate : 1;
  const cut = r3(s.from + local * rate);
  if (cut <= s.from || cut >= s.to) return null;
  return [
    { ...s, to: cut },
    { ...s, from: cut },
  ];
}

/** Shifts output-time items (user overlays, captions, annotations) at or after `at` by `by`. */
function shiftAfter(tl: Timeline, at: number, by: number): Timeline {
  const move = (t: number) => (t >= at - 1e-6 ? r3(Math.max(0, t + by)) : t);
  return {
    ...tl,
    overlays: tl.overlays.map((o) =>
      o.start >= at - 1e-6
        ? { ...o, start: move(o.start), end: move(o.end) }
        : o.end > at && by > 0
          ? { ...o, end: r3(o.end + by) }
          : o,
    ),
    captions: tl.captions.map((c) =>
      c.start >= at - 1e-6 ? { ...c, start: move(c.start), end: move(c.end) } : c,
    ),
    annotations: tl.annotations.map((a) => (a.t >= at - 1e-6 ? { ...a, t: move(a.t) } : a)),
  };
}

/**
 * Inserts an explainer scene at output time `at`. Inside a recording scene, that scene is split
 * in two at `at` (a transition after it moves to the second half). Overlays, captions and
 * annotations from `at` on move later by the scene's length, so they stay on the same content;
 * voice lines follow their owners already.
 */
export function insertExplainerScene(
  tl: Timeline,
  at: number,
  scene: Omit<ExplainerScene, 'id'> & { id?: string },
): { timeline: Timeline; sceneId: string } {
  const tm = buildTimeMap(tl);
  const id = scene.id ?? nextSceneId(tl);
  const explainer: ExplainerScene = { ...scene, id } as ExplainerScene;
  const scenes: Scene[] = [];
  let transitions = tl.transitions;
  let inserted = false;
  for (const s of tl.scenes) {
    const span = tm.scenes.find((x) => x.sceneId === s.id)!;
    if (inserted || at > span.end + 1e-6) {
      scenes.push(s);
      continue;
    }
    if (at <= span.start + 1e-6) {
      scenes.push(explainer, s);
      inserted = true;
      continue;
    }
    if (s.kind !== 'recording' || at >= span.end - 1e-6) {
      scenes.push(s);
      if (at >= span.end - 1e-6) {
        scenes.push(explainer);
        inserted = true;
      }
      continue;
    }
    // Split the recording scene at `at`.
    const first: Segment[] = [];
    const second: Segment[] = [];
    for (const g of tm.segments.filter((x) => x.sceneId === s.id)) {
      if (g.end <= at + 1e-6) first.push(g.segment);
      else if (g.start >= at - 1e-6) second.push(g.segment);
      else {
        const parts = splitSegment(g.segment, at - g.start);
        if (parts) {
          first.push(parts[0]);
          second.push(parts[1]);
        } else second.push(g.segment);
      }
    }
    if (!first.length || !second.length) {
      scenes.push(...(first.length ? [s, explainer] : [explainer, s]));
    } else {
      const a: RecordingScene = { ...s, segments: first };
      const b: RecordingScene = {
        ...s,
        id: nextSceneId({ scenes: [...tl.scenes, explainer] }),
        segments: second,
      };
      transitions = transitions.map((tr) =>
        tr.between[0] === s.id ? { ...tr, between: [b.id, tr.between[1]] } : tr,
      );
      scenes.push(a, explainer, b);
    }
    inserted = true;
  }
  if (!inserted) scenes.push(explainer);
  const len = sceneDuration(explainer);
  const shifted = shiftAfter({ ...tl, scenes, transitions }, at, len);
  return { timeline: shifted, sceneId: id };
}

/**
 * Removes an explainer scene (and its transitions). Neighbouring recording scenes of the same
 * take join again; overlays inside the scene go, and later ones move back by its length.
 */
export function removeExplainerScene(tl: Timeline, sceneId: string): Timeline {
  const scene = tl.scenes.find((s) => s.id === sceneId);
  if (!scene || scene.kind !== 'explainer') throw new Error(`no explainer scene "${sceneId}"`);
  const tm = buildTimeMap(tl);
  const span = tm.scenes.find((x) => x.sceneId === sceneId)!;
  const len = span.end - span.start;
  const i = tl.scenes.indexOf(scene);
  const prev = tl.scenes[i - 1];
  const next = tl.scenes[i + 1];
  let scenes = tl.scenes.filter((s) => s.id !== sceneId);
  let transitions = tl.transitions.filter((tr) => !tr.between.includes(sceneId));
  if (prev?.kind === 'recording' && next?.kind === 'recording' && prev.take === next.take) {
    // Join the two halves; the pieces either side of the old split point become one again.
    const last = prev.segments.at(-1)!;
    const first = next.segments[0]!;
    const joinable =
      last.kind !== 'hold' &&
      first.kind === last.kind &&
      Math.abs(first.from - last.to) < 1e-6 &&
      (last.kind === 'src' || (first.kind === 'speed' && first.rate === last.rate));
    const segments: Segment[] = joinable
      ? [
          ...prev.segments.slice(0, -1),
          { ...last, to: (first as { to: number }).to },
          ...next.segments.slice(1),
        ]
      : [...prev.segments, ...next.segments];
    const merged: RecordingScene = { ...prev, segments };
    scenes = scenes.filter((s) => s.id !== next.id).map((s) => (s.id === prev.id ? merged : s));
    transitions = transitions
      .filter((tr) => !(tr.between[0] === prev.id && tr.between[1] === next.id))
      .map((tr) => (tr.between[0] === next.id ? { ...tr, between: [prev.id, tr.between[1]] } : tr));
  }
  const inside = (t: number) => t >= span.start - 1e-6 && t < span.end - 1e-6;
  const kept = {
    ...tl,
    scenes,
    transitions,
    overlays: tl.overlays.filter((o) => !(inside(o.start) && o.end <= span.end + 1e-6)),
    captions: tl.captions.filter((c) => !inside(c.start)),
    voice: tl.voice.filter((v) => v.owner !== sceneId),
  };
  return shiftAfter(kept, span.end, -len);
}
