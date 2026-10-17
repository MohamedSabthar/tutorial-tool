import { useEffect, useRef } from 'react';
import type { VoiceLine } from '@studio/core';

/** Correct only real drift, and not more often than this: WebKit's audio clock is coarse. */
const DRIFT = 0.3;
const RESYNC_MS = 1000;

/**
 * Plays the voice-over with the preview: the line under the playhead plays natively while the
 * player runs, and nothing plays while paused. It seeks when a line starts (or playback starts)
 * and afterwards only corrects drift over 0.3 s, at most once a second. Seeking on every frame
 * (as the video does) keeps restarting audio in WebKit, whose `currentTime` lags after a seek.
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
  /** The line the element is set up for, and when it last sought. */
  const state = useRef<{ line: string | null; lastSeek: number; wasPlaying: boolean }>({
    line: null,
    lastSeek: 0,
    wasPlaying: false,
  });
  const active = spans.find((s) => s.line.audio && t >= s.start && t < s.end) ?? null;
  const src = active?.line.audio ? media(active.line.audio) : null;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const st = state.current;
    if (!playing || !active || !src) {
      if (!el.paused) el.pause();
      st.wasPlaying = false;
      if (!active) st.line = null;
      return;
    }
    const at = Math.max(0, t - active.start);
    const now = performance.now();
    const seek = (to: number) => {
      st.lastSeek = now;
      // WebKit ignores seeks before metadata arrives: seek once it has loaded.
      if (el.readyState >= 1) el.currentTime = to;
      else el.addEventListener('loadedmetadata', () => (el.currentTime = to), { once: true });
    };
    if (st.line !== active.line.id || el.getAttribute('src') !== src) {
      // A new line: load it and start from where the playhead is.
      st.line = active.line.id;
      el.setAttribute('src', src);
      el.load();
      seek(at);
    } else if (!st.wasPlaying) {
      seek(at); // playback (re)started, possibly after a scrub
    } else {
      const drift = Math.abs(el.currentTime - at);
      // A jump (scrubbing while playing) right away; small drift only now and then.
      if ((drift > 1 && now - st.lastSeek > 300) || (drift > DRIFT && now - st.lastSeek > RESYNC_MS))
        seek(at);
    }
    st.wasPlaying = true;
    if (el.paused) void el.play().catch(() => {});
  }, [playing, active, src, t]);

  return <audio ref={audio} preload="auto" hidden aria-hidden="true" />;
}
