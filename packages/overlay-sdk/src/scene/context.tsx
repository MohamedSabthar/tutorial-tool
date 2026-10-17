import { createContext, useContext } from 'react';
import type { SceneTiming } from '@studio/core';
import { useOverlayTime } from '../context';

/** The explainer scene being rendered: its beats and narration words (scene-local seconds). */
export const SceneContext = createContext<SceneTiming | null>(null);

const EMPTY: SceneTiming = { beats: {}, order: [], words: [], lines: [] };

/** The scene's timing; empty outside an explainer scene. */
export function useSceneTiming(): SceneTiming {
  return useContext(SceneContext) ?? EMPTY;
}

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Seconds into the scene where beat `id` fires (0 if the scene has no such beat). */
export function beatTime(timing: SceneTiming, id: string): number {
  return timing.beats[id] ?? 0;
}

/** Seconds into the scene where the narration says `word` (its nth occurrence, from 0). */
export function wordTime(timing: SceneTiming, word: string, nth = 0): number {
  const target = norm(word);
  return timing.words.filter((w) => norm(w.w) === target)[nth]?.start ?? 0;
}

export interface BeatState {
  /** The beat that fired most recently (null before the first). */
  current: string | null;
  /** Its position in time order (−1 before the first). */
  index: number;
  /** 0..1 from the current beat to the next one (or the scene's end). */
  progress: number;
  /** Seconds since the current beat. */
  since: number;
  /** Beat ids in time order. */
  order: string[];
  /** Seconds into the scene for a beat id. */
  at: (id: string) => number;
  /** Seconds into the scene for a narration word. */
  word: (w: string, nth?: number) => number;
  /** Whether beat `id` has fired. */
  reached: (id: string) => boolean;
}

/**
 * Which beat the scene is on. Beats come from the voice-over (or the narration text before it
 * is voiced), so the animation re-times itself when the narration changes.
 */
export function useBeat(): BeatState {
  const timing = useSceneTiming();
  const { t, duration } = useOverlayTime();
  const order = timing.order;
  let index = -1;
  for (let i = 0; i < order.length; i++) if (t >= timing.beats[order[i]!]! - 1e-6) index = i;
  const start = index >= 0 ? timing.beats[order[index]!]! : 0;
  const next = index + 1 < order.length ? timing.beats[order[index + 1]!]! : duration;
  return {
    current: index >= 0 ? order[index]! : null,
    index,
    progress: next > start ? Math.min(1, Math.max(0, (t - start) / (next - start))) : 1,
    since: Math.max(0, t - start),
    order,
    at: (id) => beatTime(timing, id),
    word: (w, nth) => wordTime(timing, w, nth),
    reached: (id) => id in timing.beats && t >= timing.beats[id]! - 1e-6,
  };
}

/** 0..1 for t between a and b, eased (cubic in-out). Pure, for computing styles from time. */
export function tween(t: number, a: number, b: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
