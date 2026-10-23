import { ffmpeg } from './encode';

/** An audio file placed at an output time (seconds). It plays to its end. */
export interface AudioClip {
  file: string;
  start: number;
}

export interface MixOptions {
  /** Output length in seconds (the video's). */
  duration: number;
  /** Integrated loudness target. */
  lufs?: number;
  /** Normalise to `lufs` (default true). */
  normalize?: boolean;
  signal?: AbortSignal;
}

const RATE = 48_000;

/** The ffmpeg inputs and filter graph that lay the clips on one track, `duration` long, at 48 kHz. */
export function mixGraph(clips: AudioClip[], duration: number): { inputs: string[]; graph: string } {
  const dur = duration.toFixed(6);
  if (!clips.length)
    return {
      inputs: ['-f', 'lavfi', '-t', dur, '-i', `anullsrc=r=${RATE}:cl=mono`],
      graph: `[0:a]atrim=0:${dur}[mix]`,
    };
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  // Sample-exact placement: resample first, then delay by whole samples.
  const placed = clips.map(
    (c, i) =>
      `[${i}:a]aresample=${RATE},aformat=channel_layouts=mono,adelay=delays=${Math.round(Math.max(0, c.start) * RATE)}S:all=1[a${i}]`,
  );
  const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad,atrim=0:${dur}[mix]`;
  return { inputs, graph: [...placed, mix].join(';') };
}

/**
 * Mixes the voice-over into one AAC track (`out`, .m4a) normalised to −16 LUFS: a measuring
 * pass, then a linear loudnorm pass with those measurements (linear keeps the timing and the
 * dynamics of the narration intact).
 */
export async function mixAudio(clips: AudioClip[], out: string, opts: MixOptions): Promise<void> {
  const lufs = opts.lufs ?? -16;
  const { inputs, graph } = mixGraph(clips, opts.duration);
  const target = `I=${lufs}:TP=-1.5:LRA=11`;
  const normalize = (opts.normalize ?? true) && clips.length > 0;
  let norm = `loudnorm=${target}`;
  if (normalize) {
    const log = await ffmpeg(
      [
        ...inputs,
        '-filter_complex',
        `${graph};[mix]loudnorm=${target}:print_format=json[out]`,
        '-map',
        '[out]',
        '-f',
        'null',
        '-',
      ],
      opts.signal,
    );
    const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(log);
    if (m) {
      const j = JSON.parse(m[0]) as Record<string, string>;
      // Silence measures -inf; skip the second pass's measurements then.
      if (Number.isFinite(Number(j.input_i)))
        norm = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    }
  }
  await ffmpeg(
    [
      '-v',
      'error',
      '-y',
      ...inputs,
      '-filter_complex',
      `${graph};[mix]${normalize ? `${norm},` : ''}aresample=${RATE},atrim=0:${opts.duration.toFixed(6)}[out]`,
      '-map',
      '[out]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      out,
    ],
    opts.signal,
  );
}
