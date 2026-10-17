import { useEffect, useRef } from 'react';
import type { VoiceLine } from '@studio/core';

/**
 * Re-seek only on a real jump (scrubbing while playing). Every seek is an audible break in
 * WebKit, and the audio and the preview clock run at the same rate, so small drift is left alone.
 */
const JUMP = 1;

/**
 * Plays the voice-over with the preview: the line under the playhead plays natively while the
 * player runs, and nothing plays while paused. It seeks when a line starts (or playback starts)
 * and afterwards only when the playhead jumps by more than a second. Seeking to correct small
 * drift (as the video does) breaks or silences audio in WebKit, whose clock lags after a seek.
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
    if (!playing) {
      if (!el.paused) el.pause();
      st.wasPlaying = false;
      return;
    }
    if (!active || !src) {
      // Past the end of a line: let it finish on its own (it starts a little late, so stopping
      // at the span's end would clip its last words); the next line takes over when it starts.
      st.line = el.paused ? null : st.line;
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
    } else if (Math.abs(el.currentTime - at) > JUMP && now - st.lastSeek > 500) {
      seek(at); // the playhead jumped (a scrub while playing)
    }
    st.wasPlaying = true;
    if (el.paused) void el.play().catch(() => {});
  }, [playing, active, src, t]);

  return <audio ref={audio} preload="auto" hidden aria-hidden="true" />;
}
