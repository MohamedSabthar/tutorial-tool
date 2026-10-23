import { useEffect, useMemo, useRef } from 'react';
import { SFX_VARIANTS, synthSfx, type SfxCue, type SfxKind } from '@studio/core';

/** Sounds are scheduled this far ahead of the playhead (seconds of output). */
const AHEAD = 4;
/** A playhead further than this from where the schedule expects it is a seek: reschedule. */
const JUMP = 0.3;

/**
 * Plays the click sounds with the preview. Web Audio schedules each sound at its
 * output time, a few seconds ahead of the playhead; a pause, seek or speed change cancels what
 * is scheduled and starts again from the playhead. Export mixes the same sounds itself.
 */
export function SfxPlayer({
  cues,
  t,
  playing,
  rate = 1,
  volume,
}: {
  cues: SfxCue[];
  t: number;
  playing: boolean;
  rate?: number;
  volume: number;
}) {
  const ctx = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const scheduled = useRef<AudioBufferSourceNode[]>([]);
  /** Where the schedule started: output time, audio-clock time, rate, and how far it reaches. */
  const plan = useRef<{ t0: number; c0: number; rate: number; until: number; next: number } | null>(null);
  const sorted = useMemo(() => [...cues].sort((a, b) => a.t - b.t), [cues]);

  const stop = () => {
    for (const s of scheduled.current) {
      try {
        s.stop();
      } catch {
        // Already ended.
      }
    }
    scheduled.current = [];
    plan.current = null;
  };

  useEffect(
    () => () => {
      stop();
      void ctx.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (!playing || !sorted.length) {
      stop();
      return;
    }
    const ac = (ctx.current ??= new AudioContext());
    if (ac.state === 'suspended') void ac.resume();
    const buffer = (kind: SfxKind, variant: number) => {
      const key = `${kind}${variant % SFX_VARIANTS}`;
      let b = buffers.current.get(key);
      if (!b) {
        const samples = synthSfx(kind, variant % SFX_VARIANTS, ac.sampleRate);
        b = ac.createBuffer(1, samples.length, ac.sampleRate);
        b.getChannelData(0).set(samples);
        buffers.current.set(key, b);
      }
      return b;
    };
    // Where the current schedule expects the playhead to be now.
    const p = plan.current;
    const expected = p ? p.t0 + (ac.currentTime - p.c0) * p.rate : null;
    if (!p || p.rate !== rate || expected === null || Math.abs(expected - t) > JUMP) {
      stop();
      plan.current = { t0: t, c0: ac.currentTime, rate, until: t, next: sorted.findIndex((c) => c.t >= t) };
    }
    const cur = plan.current!;
    if (cur.next < 0 || t + AHEAD <= cur.until) return;
    // Schedule the next stretch.
    const gain = ac.createGain();
    gain.gain.value = volume;
    gain.connect(ac.destination);
    const end = t + AHEAD * 2;
    while (cur.next < sorted.length && sorted[cur.next]!.t < end) {
      const c = sorted[cur.next++]!;
      const at = cur.c0 + (c.t - cur.t0) / cur.rate;
      if (at < ac.currentTime) continue;
      const src = ac.createBufferSource();
      src.buffer = buffer(c.kind, c.variant);
      src.playbackRate.value = 1;
      src.connect(gain);
      src.start(at);
      scheduled.current.push(src);
    }
    if (cur.next >= sorted.length) cur.next = -1;
    cur.until = end;
    // Drop finished sources now and then.
    if (scheduled.current.length > 400) scheduled.current = scheduled.current.slice(-200);
  });

  return null;
}
