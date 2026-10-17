import {
  buildTimeMap,
  type ExplainerScene,
  type VoiceLine,
  type OverlayInstance,
  type RecorderEvent,
  type Timeline,
  type TimeMap,
} from '@studio/core';
import { fitSource, sourceToStage, type Fit } from '@studio/stage';
import { coreTransitions } from '@studio/scenes-core';
import { STAGE, type HostInstance } from './StageHost';

export interface StepSpan {
  id: string;
  title: string;
  /** Output time. */
  start: number;
  end: number;
}

/** An explainer scene visible at some output time. */
export interface ExplainerSpan {
  id: string;
  component: string;
  props: Record<string, unknown>;
  /** Output time span of the scene. */
  start: number;
  end: number;
  scene: ExplainerScene;
  /** Voice lines narrating the scene (scene-local starts). */
  voice: VoiceLine[];
}

/** A transition in progress between two scenes. */
export interface LayerTransition {
  id: string;
  component: string;
  /** 0 → 1 across the overlap. */
  u: number;
  from: { sceneId: string; kind: 'recording' | 'explainer' };
  to: { sceneId: string; kind: 'recording' | 'explainer' };
}

/** Transitions that hold the recorded frame while they play. */
const FREEZING = new Set(
  Object.entries(coreTransitions)
    .filter(([, m]) => m.meta.freezes)
    .map(([id]) => id),
);

export interface Resolved {
  tm: TimeMap;
  fit: Fit | null;
  steps: StepSpan[];
  instances: HostInstance[];
  /** Output → take time for the recording scene. */
  sourceTime: (t: number) => number;
  /** True when output time t shows moving video (not a hold or an explainer). */
  videoRuns: (t: number) => boolean;
  /** What output time t shows: the recording's weight, the explainers, and a transition between them. */
  layersAt: (t: number) => {
    recording: number;
    explainers: (ExplainerSpan & { weight: number })[];
    transition: LayerTransition | null;
  };
}

/**
 * Everything the Studio renders, derived from the timeline: the time map, steps in output
 * time, and overlay instances with anchors resolved to stage px.
 */
export function resolveTimeline(tl: Timeline, _events: RecorderEvent[]): Resolved {
  const tm = buildTimeMap(tl);
  const take = tl.takes.at(-1) ?? null;
  const fit = take ? fitSource(take, STAGE) : null;
  const firstOut = (takeId: string, st: number) => tm.toOutput(takeId, st)[0];
  const steps: StepSpan[] = tl.steps.map((s) => {
    const start = firstOut(s.take, s.from) ?? 0;
    const end = firstOut(s.take, Math.max(s.from, s.to - 0.001)) ?? start;
    return { id: s.id, title: s.title, start, end: Math.max(end, start) };
  });
  const stepBox = new Map(tl.steps.map((s) => [s.id, s.bbox]));
  // Captions off: their overlays aren't drawn (the cues stay for SRT/VTT).
  const shown = tl.showCaptions ? tl.overlays : tl.overlays.filter((o) => o.component !== 'core:Captions');
  const instances: HostInstance[] = shown.map((o: OverlayInstance) => {
    const box = o.anchor ? stepBox.get(o.anchor.stepId) : undefined;
    const anchor = o.rect ?? (box && fit ? sourceToStage(box, fit) : null);
    return { id: o.id, component: o.component, start: o.start, end: o.end, props: o.props, anchor };
  });
  /**
   * The recording position at t. During a freezing transition (FreezeMorph) the recording holds
   * the frame at the transition's edge: the last frame shown before it cuts away, or the first
   * frame it comes back to.
   */
  const recordingAt = (t: number) => {
    const active = tm.activeAt(t);
    const rec = [...active].reverse().find((a) => a.position.kind === 'recording');
    if (!rec || rec.position.kind !== 'recording') return null;
    const tr = rec.transitionId ? tl.transitions.find((x) => x.id === rec.transitionId) : undefined;
    if (tr && FREEZING.has(tr.component)) {
      const incoming = tm.scenes.find((x) => x.sceneId === tr.between[1]);
      if (incoming) {
        const edge = tm
          .activeAt(incoming.start + 1e-4)
          .find((a) => a.position.sceneId === rec.position.sceneId);
        if (edge?.position.kind === 'recording') return { pos: edge.position, frozen: true };
      }
    }
    return { pos: rec.position, frozen: false };
  };
  const sourceTime = (t: number) => recordingAt(t)?.pos.takeTime ?? 0;
  const videoRuns = (t: number) => {
    const r = recordingAt(t);
    if (!r || r.frozen) return false;
    const seg = tm.segments.find((g) => g.sceneId === r.pos.sceneId && g.index === r.pos.segment);
    return seg?.segment.kind !== 'hold';
  };
  const explainers = new Map<string, ExplainerSpan>();
  for (const sc of tl.scenes) {
    if (sc.kind !== 'explainer') continue;
    const span = tm.scenes.find((x) => x.sceneId === sc.id);
    if (span)
      explainers.set(sc.id, {
        id: sc.id,
        component: sc.component,
        props: sc.props,
        start: span.start,
        end: span.end,
        scene: sc,
        voice: tl.voice.filter((v) => v.owner === sc.id),
      });
  }
  const layersAt = (t: number) => {
    let recording = 0;
    const out: (ExplainerSpan & { weight: number })[] = [];
    for (const a of tm.activeAt(t)) {
      if (a.position.kind === 'recording') recording += a.weight;
      else {
        const e = explainers.get(a.position.sceneId);
        if (e) out.push({ ...e, weight: a.weight });
      }
    }
    // Before the first scene or with no scenes at all, the recording shows.
    if (!tm.scenes.length) recording = 1;
    // A transition between the two active scenes, with its progress.
    let transition: LayerTransition | null = null;
    const pair = tm.activeAt(t);
    if (pair.length === 2 && pair[1]!.transitionId) {
      const tr = tl.transitions.find((x) => x.id === pair[1]!.transitionId);
      if (tr)
        transition = {
          id: tr.id,
          component: tr.component,
          u: pair[1]!.weight,
          from: { sceneId: pair[0]!.position.sceneId, kind: pair[0]!.position.kind },
          to: { sceneId: pair[1]!.position.sceneId, kind: pair[1]!.position.kind },
        };
    }
    return { recording, explainers: out, transition };
  };
  return { tm, fit, steps, instances, sourceTime, videoRuns, layersAt };
}

/** The step that contains output time t. */
export function stepAt(steps: StepSpan[], t: number): StepSpan | undefined {
  return steps.find((s) => t >= s.start && t < s.end) ?? steps.filter((s) => s.start <= t).at(-1);
}
