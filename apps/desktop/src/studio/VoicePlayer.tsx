import { useEffect, useRef } from 'react';
import type { VoiceLine } from '@studio/core';

/**
 * Plays the voice-over with the preview: the line under the playhead plays natively while the
 * player runs (re-synced when it drifts more than 0.15 s), and nothing plays while paused.
 * Export mixes the audio itself (7.3); this is only for listening while editing.
 */
export function VoicePlayer({
  spans,
  t,
  playing,
  media,
}: {
  spans: { line: VoiceLine; start: number; end: number }[];
  t: number;
  playing: boolean;
  media: (rel: string) => string | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const active = spans.find((s) => s.line.audio && t >= s.start && t < s.end) ?? null;
  const src = active?.line.audio ? media(active.line.audio) : null;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (!playing || !active || !src) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    const at = t - active.start;
    if (Math.abs(el.currentTime - at) > 0.15) el.currentTime = at;
    if (el.paused) void el.play().catch(() => {});
  }, [playing, active, src, t]);

  return <audio ref={audio} preload="auto" hidden aria-hidden="true" />;
}
