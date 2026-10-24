import type { RecorderEvent, Timeline } from './schemas';
import { buildTimeMap } from './timemap';
import { ownerStart, voiceSpans } from './voice';

/** Stretches with no voice at least this long (output seconds) are reported. */
export const SILENCE_MIN = 2;

/** An output-time stretch with no voice: what plays there, so the agent can decide what to do. */
export interface Silence {
  start: number;
  end: number;
  seconds: number;
  /** The step (or explainer scene) showing at its start. */
  owner: { id: string; title: string } | null;
  /** Fastest playback speed in the stretch (1 = as recorded), and whether it has freezes. */
  rate: number;
  freezes: boolean;
  /** Pieces in it were edited by hand (leave them unless the user asked). */
  manual: boolean;
  /** Clicks, typing and key presses shown in it, at their output times. */
  actions: { at: number; what: string }[];
  /** Nothing happens on screen: a wait or a pause. */
  idle: boolean;
  /** Most of its actions use controls already used earlier: a repeated flow. */
  repeats: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const describe = (e: RecorderEvent): string | null =>
  e.kind === 'click'
    ? `click ${e.target}`
    : e.kind === 'type'
      ? `type "${e.text.length > 40 ? `${e.text.slice(0, 40)}…` : e.text}" into ${e.target}`
      : e.kind === 'key'
        ? `press ${e.key}`
        : null;

/**
 * Stretches of the video with no voice-over, at least `min` seconds long, with what the
 * recording shows in each. Recorder events come from the latest take.
 */
export function findSilences(tl: Timeline, events: RecorderEvent[], opts: { min?: number } = {}): Silence[] {
  const min = opts.min ?? SILENCE_MIN;
  const tm = buildTimeMap(tl);
  const take = tl.takes.at(-1);

  // Output intervals covered by voice, merged.
  const voiced: [number, number][] = [];
  for (const s of voiceSpans(tl, tm)) {
    const last = voiced.at(-1);
    if (last && s.start <= last[1]) last[1] = Math.max(last[1], s.end);
    else voiced.push([s.start, s.end]);
  }
  const gaps: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of voiced) {
    if (a - cur >= min) gaps.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (tm.duration - cur >= min) gaps.push([cur, tm.duration]);

  // Actions in output time (first time each is shown), in order.
  const actions = take
    ? events.flatMap((e) => {
        const what = describe(e);
        const at = what ? tm.toOutput(take.id, e.t)[0] : undefined;
        return what && at !== undefined
          ? [{ at, what, target: e.kind === 'key' ? `key ${e.key}` : 'target' in e ? e.target : what }]
          : [];
      })
    : [];
  actions.sort((a, b) => a.at - b.at);

  const owners = [
    ...tl.steps.map((s) => ({ id: s.id, title: s.title })),
    ...tl.scenes.flatMap((s) => (s.kind === 'explainer' ? [{ id: s.id, title: 'Explainer' }] : [])),
  ].flatMap((o) => {
    const start = ownerStart(tl, tm, o.id);
    return start === null ? [] : [{ ...o, start }];
  });

  return gaps.map(([start, end]) => {
    const owner = owners.filter((o) => o.start <= start + 1e-3).sort((a, b) => b.start - a.start)[0] ?? null;
    const pieces = tm.segments.filter((g) => g.end > start && g.start < end);
    const inside = actions.filter((a) => a.at >= start && a.at < end);
    const before = new Set(actions.filter((a) => a.at < start).map((a) => a.target));
    const seen = inside.filter((a) => before.has(a.target)).length;
    return {
      start: r2(start),
      end: r2(end),
      seconds: r2(end - start),
      owner: owner ? { id: owner.id, title: owner.title } : null,
      rate: Math.max(1, ...pieces.map((g) => (g.segment.kind === 'speed' ? g.segment.rate : 1))),
      freezes: pieces.some((g) => g.segment.kind === 'hold'),
      manual: pieces.some((g) => !!g.segment.manual),
      actions: inside.map((a) => ({ at: r2(a.at), what: a.what })),
      idle: inside.length === 0,
      repeats: inside.length >= 3 && seen / inside.length >= 0.6,
    };
  });
}
