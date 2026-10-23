import type { RecorderEvent, Timeline } from './schemas';
import { buildTimeMap } from './timemap';

export type SfxKind = 'click' | 'key';

/** A sound at an output time. `variant` picks one of a few takes of it, so repeats don't sound copied. */
export interface SfxCue {
  t: number;
  kind: SfxKind;
  variant: number;
}

export const SFX_VARIANTS = 4;
/** Typing ticks are left out where the take plays faster than this (they'd be a buzz). */
const TYPE_MAX_RATE = 1.5;
/** The recorder's typing pace (characters a second) and its longer pauses (see human.ts). */
const TYPE_CPS = 14;

/**
 * The click and typing sounds a timeline's recording makes, in output time: a click for each
 * click, a key sound for each key press and for each character typed (at the recorder's typing
 * pace). Moments cut out of the video make no sound; typing inside a fast-forward is left out.
 */
export function sfxCues(tl: Timeline, eventsByTake: Record<string, RecorderEvent[]>): SfxCue[] {
  const tm = buildTimeMap(tl);
  const rateAt = (out: number) => {
    const seg = tm.segments.find((s) => out >= s.start && out < s.end)?.segment;
    return seg?.kind === 'speed' ? seg.rate : 1;
  };
  const cues: SfxCue[] = [];
  let n = 0;
  const add = (take: string, t: number, kind: SfxKind, typing = false) => {
    const out = tm.toOutput(take, t)[0];
    if (out === undefined) return;
    if (typing && rateAt(out) > TYPE_MAX_RATE) return;
    cues.push({ t: Math.round(out * 1000) / 1000, kind, variant: n++ % SFX_VARIANTS });
  };
  for (const [take, events] of Object.entries(eventsByTake)) {
    for (const e of events) {
      if (e.kind === 'click') add(take, e.t, 'click');
      else if (e.kind === 'key') add(take, e.t, 'key');
      else if (e.kind === 'type') {
        // The event marks where typing starts; each character follows at the recorder's pace.
        let at = e.t;
        for (const ch of e.text) {
          add(take, at, 'key', true);
          at += (ch === ' ' ? 1.4 : /[./:_-]/.test(ch) ? 1.25 : 1) / TYPE_CPS;
        }
      }
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}

/** A small seeded PRNG (mulberry32), so every render of a sound is the same. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One sound as mono samples at `rate`. A click is a mouse button's press and, 70–90 ms later, a
 * quieter release: each a few milliseconds of bright, fast-decaying noise with a short tone in
 * it. A key is a softer, darker tick over a low thump. Variants shift the pitch and timing a
 * little.
 */
export function synthSfx(kind: SfxKind, variant: number, rate: number): Float32Array {
  const rand = rng(kind === 'click' ? 101 + variant : 201 + variant);
  const len = Math.round((kind === 'click' ? 0.12 : 0.06) * rate);
  const out = new Float32Array(len);
  // `bright` high-passes the noise (a crisp click); otherwise it is low-passed (a soft tick).
  const burst = (at: number, gain: number, tau: number, tone: number, bright: boolean) => {
    const start = Math.round(at * rate);
    const a = bright ? 0.12 : 0.3;
    let lp = 0;
    for (let i = start; i < len; i++) {
      const s = (i - start) / rate;
      const env = Math.exp(-s / tau);
      if (env < 1e-4) break;
      const noise = rand() * 2 - 1;
      lp += a * (noise - lp);
      const shaped = bright ? noise - lp : lp;
      out[i]! += gain * env * (0.75 * shaped + 0.25 * Math.sin(2 * Math.PI * tone * s));
    }
  };
  const jitter = 0.94 + rand() * 0.12;
  if (kind === 'click') {
    burst(0, 0.55, 0.0012, 3200 * jitter, true);
    burst(0.07 + rand() * 0.02, 0.3, 0.001, 3600 * jitter, true);
  } else {
    burst(0, 0.32, 0.0025, 1400 * jitter, false);
    // The low thump of the key bottoming out.
    for (let i = 0; i < len; i++) {
      const s = i / rate;
      out[i]! += 0.18 * Math.exp(-s / 0.008) * Math.sin(2 * Math.PI * 170 * jitter * s);
    }
  }
  return out;
}

/** All the cues laid on one mono track `duration` seconds long, scaled by `volume`. */
export function renderSfxTrack(cues: SfxCue[], duration: number, rate: number, volume: number): Float32Array {
  const track = new Float32Array(Math.max(1, Math.ceil(duration * rate)));
  const cache = new Map<string, Float32Array>();
  for (const c of cues) {
    const key = `${c.kind}${c.variant}`;
    let s = cache.get(key);
    if (!s) cache.set(key, (s = synthSfx(c.kind, c.variant, rate)));
    const at = Math.round(c.t * rate);
    for (let i = 0; i < s.length && at + i < track.length; i++) track[at + i]! += s[i]! * volume;
  }
  return track;
}

/** A 16-bit PCM mono WAV file of `samples`. */
export function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, Math.round(x * 32767), true);
  }
  return new Uint8Array(buf);
}
