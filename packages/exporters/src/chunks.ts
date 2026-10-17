import { cpus } from 'node:os';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mixAudio, type AudioClip } from './audio';
import { ffmpeg, FrameEncoder, type EncodeOptions } from './encode';
import { renderFrames, type FrameRange } from './frames';
import type { RenderHost } from './host';

export type ExportPhase = 'render' | 'audio' | 'concat' | 'mux' | 'done';

/** Overall progress when each phase after rendering starts. */
const AFTER: Record<Exclude<ExportPhase, 'render'>, number> = {
  audio: 0.94,
  concat: 0.96,
  mux: 0.98,
  done: 1,
};

export interface ExportProgress {
  phase: ExportPhase;
  /** Frames rendered so far, of `total`. */
  frames: number;
  total: number;
  /** 0–1 over the whole export (rendering is most of it). */
  progress: number;
  /** The frame index each worker last finished (for a preview of the newest frame). */
  latest?: { index: number; png: Buffer };
}

export interface ExportVideoOptions {
  slug: string;
  /** Output length in seconds. */
  duration: number;
  fps: number;
  /** The finished MP4. */
  out: string;
  /** Scratch folder for chunks (removed afterwards). */
  work: string;
  /** A fresh export-mode render host per worker. */
  host: () => RenderHost;
  /** Voice-over clips at their output times. */
  audio: AudioClip[];
  /** Parallel workers (each a Chromium and an encoder); default CPU cores / 2. */
  workers?: number;
  encode?: Omit<EncodeOptions, 'fps'>;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

/** Splits frames 0…total-1 into up to `n` contiguous ranges of at least `min` frames. */
export function planChunks(total: number, fps: number, n: number, min = 60): FrameRange[] {
  const count = Math.max(1, Math.min(n, Math.floor(total / min) || 1));
  const out: FrameRange[] = [];
  for (let k = 0; k < count; k++) {
    const from = Math.round((total * k) / count);
    const to = Math.round((total * (k + 1)) / count) - 1;
    if (to >= from) out.push({ from, to, fps });
  }
  return out;
}

/**
 * Renders the tutorial to an MP4: frames are split into chunks rendered by parallel workers
 * (each pipes PNGs into its own H.264 encoder), the voice-over is mixed meanwhile, then the
 * chunks are joined without re-encoding and the audio is muxed in.
 */
export async function exportVideo(
  o: ExportVideoOptions,
): Promise<{ file: string; frames: number; seconds: number }> {
  const t0 = performance.now();
  const total = Math.max(1, Math.round(o.duration * o.fps));
  const workers = o.workers ?? Math.max(1, Math.floor(cpus().length / 2));
  // A few chunks per worker, taken from a queue: frames differ in cost (explainers draw more
  // than recordings), so equal shares would leave one worker finishing alone.
  const chunks = planChunks(total, o.fps, workers * 4);
  await rm(o.work, { recursive: true, force: true });
  await mkdir(o.work, { recursive: true });
  await mkdir(path.dirname(o.out), { recursive: true });

  let frames = 0;
  let phase: ExportPhase = 'render';
  const progress = (latest?: ExportProgress['latest']) =>
    o.onProgress?.({
      phase,
      frames,
      total,
      progress: phase === 'render' ? (frames / total) * 0.94 : AFTER[phase],
      ...(latest ? { latest } : {}),
    });

  const hosts: RenderHost[] = [];
  const encoders: FrameEncoder[] = [];
  const abort = () => {
    for (const e of encoders) e.kill();
    for (const h of hosts) void h.close();
  };
  o.signal?.addEventListener('abort', abort, { once: true });
  try {
    progress();
    const files = chunks.map((_, k) => path.join(o.work, `chunk-${String(k).padStart(3, '0')}.mp4`));
    const audioFile = path.join(o.work, 'audio.m4a');
    const audio = mixAudio(o.audio, audioFile, { duration: total / o.fps, signal: o.signal });
    audio.catch(() => {});
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, chunks.length) }, async () => {
        const host = o.host();
        hosts.push(host);
        try {
          for (let k = next++; k < chunks.length; k = next++) {
            if (o.signal?.aborted) throw new Error('export cancelled');
            const enc = await FrameEncoder.start(files[k]!, { ...o.encode, fps: o.fps });
            encoders.push(enc);
            await renderFrames(host, o.slug, chunks[k]!, async (index, png) => {
              if (o.signal?.aborted) throw new Error('export cancelled');
              await enc.write(png);
              frames++;
              progress({ index, png });
            });
            await enc.finish();
          }
        } finally {
          await host.close();
        }
      }),
    );
    if (o.signal?.aborted) throw new Error('export cancelled');

    phase = 'audio';
    progress();
    await audio;

    phase = 'concat';
    progress();
    const list = path.join(o.work, 'chunks.txt');
    await writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const video = path.join(o.work, 'video.mp4');
    await ffmpeg(
      ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video],
      o.signal,
    );

    phase = 'mux';
    progress();
    const muxed = path.join(o.work, 'final.mp4');
    await ffmpeg(
      [
        '-v',
        'error',
        '-y',
        '-i',
        video,
        '-i',
        audioFile,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        muxed,
      ],
      o.signal,
    );
    // Replace the previous export only once the new one is complete.
    await rename(muxed, o.out);

    phase = 'done';
    progress();
    return { file: o.out, frames: total, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    abort();
    throw o.signal?.aborted ? new Error('export cancelled') : e;
  } finally {
    o.signal?.removeEventListener('abort', abort);
    await rm(o.work, { recursive: true, force: true }).catch(() => {});
  }
}
