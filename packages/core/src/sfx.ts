import type { RecorderEvent, Timeline } from './schemas';
import { buildTimeMap } from './timemap';

export type SfxKind = 'click';

/** A sound at an output time. `variant` picks one of a few takes of it, so repeats don't sound copied. */
export interface SfxCue {
  t: number;
  kind: SfxKind;
  variant: number;
}

export const SFX_VARIANTS = 4;

/**
 * The click sounds a timeline's recording makes, in output time: one for each mouse click.
 * Moments cut out of the video make no sound. (Typing and key presses are silent.)
 */
export function sfxCues(tl: Timeline, eventsByTake: Record<string, RecorderEvent[]>): SfxCue[] {
  const tm = buildTimeMap(tl);
  const cues: SfxCue[] = [];
  let n = 0;
  for (const [take, events] of Object.entries(eventsByTake))
    for (const e of events) {
      if (e.kind !== 'click') continue;
      const out = tm.toOutput(take, e.t)[0];
      if (out !== undefined)
        cues.push({ t: Math.round(out * 1000) / 1000, kind: 'click', variant: n++ % SFX_VARIANTS });
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
 * quieter release: each a few milliseconds of high-passed, fast-decaying noise with a short tone
 * in it. Variants shift the pitch and timing a little.
 */
export function synthSfx(_kind: SfxKind, variant: number, rate: number): Float32Array {
  const rand = rng(101 + variant);
  const len = Math.round(0.12 * rate);
  const out = new Float32Array(len);
  const burst = (at: number, gain: number, tau: number, tone: number) => {
    const start = Math.round(at * rate);
    let lp = 0;
    for (let i = start; i < len; i++) {
      const s = (i - start) / rate;
      const env = Math.exp(-s / tau);
      if (env < 1e-4) break;
      const noise = rand() * 2 - 1;
      // High-pass: the noise minus its low end, for a crisp click.
      lp += 0.12 * (noise - lp);
      out[i]! += gain * env * (0.75 * (noise - lp) + 0.25 * Math.sin(2 * Math.PI * tone * s));
    }
  };
  const jitter = 0.94 + rand() * 0.12;
  burst(0, 0.55, 0.0012, 3200 * jitter);
  burst(0.07 + rand() * 0.02, 0.3, 0.001, 3600 * jitter);
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
