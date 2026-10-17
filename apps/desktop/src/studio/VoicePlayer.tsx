import { useEffect, useRef } from 'react';
import type { VoiceLine } from '@studio/core';

/** The picture follows the audio when they are further apart than this (seconds). */
const SYNC = 0.04;
/** Further apart than this is a scrub: the audio follows the playhead instead. */
const JUMP = 0.5;
/** After the `playing` event, trust `currentTime` once this long has passed (ms). */
const SETTLE_MS = 100;
/** At most one correction of the playhead this often (ms). */
const SYNC_EVERY_MS = 250;

/**
 * Plays the voice-over with the preview. Every voiced line has its own preloaded <audio>, kept
 * cued at its start (seeking a paused element is silent), so a line starts the moment the
 * playhead reaches it. While a line plays, the audio is the master clock: if the picture drifts
 * from it, the playhead is moved to the audio (`onSync`) rather than seeking the audio, which
 * WebKit turns into an audible break or silence. Only a real jump (a scrub while playing)
 * seeks the audio. Audio takes a moment to start after `play()` (~0.2 s in WebKit): that
 * latency is measured (play() to the `playing` event) and lines are started that much early.
 * The playback rate is applied to the audio too. Lines play to their natural end. Export mixes the audio itself; this is only for listening while editing.
 */
export function VoicePlayer({
  spans,
  t,
  playing,
  rate = 1,
  media,
  onSync,
}: {
  spans: { line: VoiceLine; start: number; end: number }[];
  t: number;
  playing: boolean;
  rate?: number;
  media: (rel: string) => string | null;
  /** Moves the playhead to `t` (the audio's position) without pausing. */
  onSync?: (t: number) => void;
}) {
  const els = useRef(new Map<string, HTMLAudioElement>());
  /** When each line's audio actually began playing (its `playing` event), for SETTLE_MS. */
  const started = useRef(new Map<string, number>());
  /** When play() was last called per line, to measure the start latency. */
  const asked = useRef(new Map<string, number>());
  /** Seconds from play() to sound, learned from the lines played so far. */
  const latency = useRef(0.2);
  const lastSync = useRef(0);
  const voiced = spans.flatMap((s) => {
    const src = s.line.audio ? media(s.line.audio) : null;
    return src ? [{ ...s, src }] : [];
  });

  useEffect(() => {
    const now = performance.now();
    let master: { start: number; el: HTMLAudioElement } | null = null;
    for (const s of voiced) {
      const id = s.line.id;
      const el = els.current.get(id);
      if (!el) continue;
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const len = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : s.end - s.start;
      const at = t - s.start;
      // A line is due a little before its start, so its sound begins on time.
      const lead = latency.current * rate;
      const inside = at >= -lead && at < len && !(el.ended && at > len - 0.3);
      const cue = (to: number) => {
        if (el.readyState >= 1 && Math.abs(el.currentTime - to) > 0.05) el.currentTime = to;
      };
      if (!playing || !inside) {
        if (!el.paused) el.pause();
        started.current.delete(id);
        cue(inside ? Math.max(0, at) : 0); // ready for the next start
        continue;
      }
      if (el.paused) {
        // Mid-line (after a pause or scrub), start where the sound will be once it is audible.
        cue(at > 0 ? at + lead : 0);
        void el.play().catch(() => {});
        asked.current.set(id, now);
        started.current.delete(id);
        continue;
      }
      const since = started.current.get(id);
      if (since === undefined) continue; // not audible yet
      if (Math.abs(s.start + el.currentTime - t) > JUMP) {
        el.currentTime = Math.max(0, at); // a scrub while playing
        continue;
      }
      // The line that started last leads the clock.
      if (now - since > SETTLE_MS && (!master || s.start > master.start)) master = { start: s.start, el };
    }
    if (master && onSync && now - lastSync.current > SYNC_EVERY_MS) {
      const audioT = master.start + master.el.currentTime;
      if (Math.abs(audioT - t) > SYNC) {
        lastSync.current = now;
        onSync(audioT);
      }
    }
  });

  return (
    <>
      {voiced.map((s) => (
        <audio
          key={s.line.id}
          ref={(el) => {
            if (el) els.current.set(s.line.id, el);
            else els.current.delete(s.line.id);
          }}
          src={s.src}
          onPlaying={() => {
            const now = performance.now();
            started.current.set(s.line.id, now);
            const at = asked.current.get(s.line.id);
            if (at !== undefined) {
              // Keep a running estimate of the start latency.
              const measured = Math.min(0.5, Math.max(0, (now - at) / 1000));
              latency.current = latency.current * 0.6 + measured * 0.4;
              asked.current.delete(s.line.id);
            }
          }}
          preload="auto"
          hidden
          aria-hidden="true"
        />
      ))}
    </>
  );
}
