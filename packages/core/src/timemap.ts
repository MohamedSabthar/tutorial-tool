import { resolveBeats, sceneNarrationLength } from './beats';
import type { ExplainerScene, Scene, Segment, Timeline, Transition } from './schemas';

/**
 * Maps between output time (the exported video) and source time (scene-local time,
 * and take time for recording scenes).
 *
 * Layout: scenes play in order. A transition between scenes A and B overlaps the last
 * `duration` seconds of A with the first `duration` seconds of B, so it shortens the
 * total by that amount.
 */
export interface SceneSpan {
  sceneId: string;
  kind: Scene['kind'];
  start: number;
  end: number;
}

export interface SegmentSpan {
  sceneId: string;
  index: number;
  segment: Segment;
  start: number;
  end: number;
}

export type SourcePosition =
  | { sceneId: string; kind: 'recording'; local: number; take: string; takeTime: number; segment: number }
  | { sceneId: string; kind: 'explainer'; local: number };

export interface ActiveScene {
  position: SourcePosition;
  /** 0..1 progress through the transition when two scenes overlap; 1 when fully visible. */
  weight: number;
  transitionId?: string;
}

export interface TimeMap {
  duration: number;
  scenes: SceneSpan[];
  segments: SegmentSpan[];
  /** The scene(s) visible at output time t (two during a transition). */
  activeAt(t: number): ActiveScene[];
  /** The primary scene at t (the incoming scene during a transition). */
  toSource(t: number): SourcePosition | undefined;
  /** Every output time at which take time `takeTime` of take `take` is shown. Holds count once, at their start. */
  toOutput(take: string, takeTime: number): number[];
}

export function segmentDuration(s: Segment): number {
  switch (s.kind) {
    case 'src':
      return s.to - s.from;
    case 'hold':
      return s.duration;
    case 'speed':
      return (s.to - s.from) / s.rate;
  }
}

export function sceneDuration(scene: Scene, voiceSeconds?: number): number {
  if (scene.kind === 'recording') return scene.segments.reduce((sum, s) => sum + segmentDuration(s), 0);
  return explainerDuration(scene, voiceSeconds);
}

/** Pause after an explainer's last line before the next scene. */
const EXPLAINER_TAIL = 0.8;

/**
 * An "auto" explainer lasts as long as its voice-over (plus a short tail); before it is voiced,
 * as long as its narration takes to read at a normal pace; with neither, its estimate.
 */
function explainerDuration(scene: ExplainerScene, voiceSeconds?: number): number {
  if (scene.duration !== 'auto') return scene.duration;
  if (voiceSeconds && voiceSeconds > 0) return voiceSeconds + EXPLAINER_TAIL;
  const narrated = sceneNarrationLength(resolveBeats(scene, []), EXPLAINER_TAIL);
  return narrated > 0 ? narrated : scene.estimatedDuration;
}

function takeTimeInSegment(s: Segment, local: number): number {
  switch (s.kind) {
    case 'src':
      return s.from + local;
    case 'hold':
      return s.at;
    case 'speed':
      return s.from + local * s.rate;
  }
}

export function buildTimeMap(tl: Pick<Timeline, 'scenes' | 'transitions' | 'voice'>): TimeMap {
  const voiceByOwner = new Map<string, number>();
  for (const v of tl.voice) {
    const end = v.start + v.duration;
    voiceByOwner.set(v.owner, Math.max(voiceByOwner.get(v.owner) ?? 0, end));
  }

  const transitionAfter = new Map<string, Transition>();
  for (const tr of tl.transitions) transitionAfter.set(tr.between[0], tr);

  const scenes: SceneSpan[] = [];
  const segments: SegmentSpan[] = [];
  let cursor = 0;
  tl.scenes.forEach((scene, i) => {
    const prev = tl.scenes[i - 1];
    const overlap = prev ? (transitionAfter.get(prev.id)?.duration ?? 0) : 0;
    const start = Math.max(0, cursor - overlap);
    const dur = sceneDuration(scene, voiceByOwner.get(scene.id));
    scenes.push({ sceneId: scene.id, kind: scene.kind, start, end: start + dur });
    if (scene.kind === 'recording') {
      let segCursor = start;
      scene.segments.forEach((segment, index) => {
        const d = segmentDuration(segment);
        segments.push({ sceneId: scene.id, index, segment, start: segCursor, end: segCursor + d });
        segCursor += d;
      });
    }
    cursor = start + dur;
  });
  const duration = cursor;
  const sceneById = new Map(tl.scenes.map((s) => [s.id, s]));

  function positionIn(span: SceneSpan, t: number): SourcePosition {
    const scene = sceneById.get(span.sceneId)!;
    const local = Math.min(Math.max(t - span.start, 0), span.end - span.start);
    if (scene.kind === 'explainer') return { sceneId: scene.id, kind: 'explainer', local };
    const segs = segments.filter((s) => s.sceneId === scene.id);
    const abs = span.start + local;
    const seg = segs.find((s) => abs >= s.start && abs < s.end) ?? segs[segs.length - 1]!;
    return {
      sceneId: scene.id,
      kind: 'recording',
      local,
      take: scene.take,
      segment: seg.index,
      takeTime: takeTimeInSegment(seg.segment, Math.min(abs - seg.start, seg.end - seg.start)),
    };
  }

  function activeAt(t: number): ActiveScene[] {
    if (scenes.length === 0) return [];
    const tc = Math.min(Math.max(t, 0), duration);
    const hits = scenes.filter(
      (s) => tc >= s.start && (tc < s.end || (s === scenes[scenes.length - 1] && tc === s.end)),
    );
    if (hits.length === 2) {
      const [a, b] = hits as [SceneSpan, SceneSpan];
      const tr = transitionAfter.get(a.sceneId);
      const w = tr ? (tc - b.start) / tr.duration : 1;
      return [
        { position: positionIn(a, tc), weight: 1 - w, transitionId: tr?.id },
        { position: positionIn(b, tc), weight: w, transitionId: tr?.id },
      ];
    }
    return hits.map((h) => ({ position: positionIn(h, tc), weight: 1 }));
  }

  function toSource(t: number): SourcePosition | undefined {
    const active = activeAt(t);
    return active[active.length - 1]?.position;
  }

  function toOutput(take: string, takeTime: number): number[] {
    const out: number[] = [];
    for (const s of segments) {
      const scene = sceneById.get(s.sceneId);
      if (!scene || scene.kind !== 'recording' || scene.take !== take) continue;
      const seg = s.segment;
      if (seg.kind === 'hold') continue;
      if (takeTime >= seg.from && takeTime < seg.to) {
        const rate = seg.kind === 'speed' ? seg.rate : 1;
        out.push(s.start + (takeTime - seg.from) / rate);
      }
    }
    return out;
  }

  return { duration, scenes, segments, activeAt, toSource, toOutput };
}
