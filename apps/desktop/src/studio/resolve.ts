import {
  buildTimeMap,
  type OverlayInstance,
  type RecorderEvent,
  type Timeline,
  type TimeMap,
} from '@studio/core';
import { fitSource, sourceToStage, type Fit } from '@studio/stage';
import { STAGE, type HostInstance } from './StageHost';

export interface StepSpan {
  id: string;
  title: string;
  /** Output time. */
  start: number;
  end: number;
}

export interface Resolved {
  tm: TimeMap;
  fit: Fit | null;
  steps: StepSpan[];
  instances: HostInstance[];
  /** Output → take time for the recording scene. */
  sourceTime: (t: number) => number;
  /** True when output time t shows moving video (not a hold or an explainer). */
  videoRuns: (t: number) => boolean;
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
  const instances: HostInstance[] = tl.overlays.map((o: OverlayInstance) => {
    const box = o.anchor ? stepBox.get(o.anchor.stepId) : undefined;
    const anchor = o.rect ?? (box && fit ? sourceToStage(box, fit) : null);
    return { id: o.id, component: o.component, start: o.start, end: o.end, props: o.props, anchor };
  });
  const sourceTime = (t: number) => {
    const pos = tm.toSource(t);
    return pos && pos.kind === 'recording' ? pos.takeTime : 0;
  };
  const videoRuns = (t: number) => {
    const pos = tm.toSource(t);
    if (!pos || pos.kind !== 'recording') return false;
    const seg = tm.segments.find((g) => g.sceneId === pos.sceneId && g.index === pos.segment);
    return seg?.segment.kind !== 'hold';
  };
  return { tm, fit, steps, instances, sourceTime, videoRuns };
}

/** The step that contains output time t. */
export function stepAt(steps: StepSpan[], t: number): StepSpan | undefined {
  return steps.find((s) => t >= s.start && t < s.end) ?? steps.filter((s) => s.start <= t).at(-1);
}
