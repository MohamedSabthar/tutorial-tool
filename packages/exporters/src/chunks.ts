import { cpus } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  /** Frames rendered so far, of `total` (including reused ones). */
  frames: number;
  /** Frames reused from an earlier, cancelled export with the same inputs. */
  resumed: number;
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
  /** Scratch folder for chunks (removed once the export is done). */
  work: string;
  /**
   * Fingerprint of everything that affects the frames (timeline, settings, components). With
   * it, a cancelled or failed export keeps its finished chunks, and the next export with the
   * same fingerprint reuses them.
   */
  key?: string;
  /** Output size when it differs from the rendered frames. */
  size?: { width: number; height: number };
  /** A fresh export-mode render host per worker. */
  host: () => RenderHost;
  /** Voice-over clips at their output times. */
  audio: AudioClip[];
  /** Normalise the mix's loudness (default true; off without a voice-over). */
  normalize?: boolean;
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

interface Manifest {
  key: string;
  chunks: FrameRange[];
}

const chunkFile = (work: string, k: number) => path.join(work, `chunk-${String(k).padStart(3, '0')}.mp4`);
const doneFile = (work: string, k: number) => `${chunkFile(work, k)}.done`;

/** The chunk plan for an export: a few chunks per worker. */
function chunkPlan(total: number, fps: number, workers: number): FrameRange[] {
  // Frames differ in cost (explainers draw more than recordings): small chunks taken from a
  // queue keep every worker busy to the end.
  return planChunks(total, fps, workers * 4);
}

async function readManifest(work: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(path.join(work, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** Frames a new export with this fingerprint would reuse from an unfinished one in `work`. */
export async function resumableFrames(work: string, key: string): Promise<number> {
  const m = await readManifest(work);
  if (m?.key !== key) return 0;
  return m.chunks.reduce(
    (n, c, k) =>
      n + (existsSync(doneFile(work, k)) && existsSync(chunkFile(work, k)) ? c.to - c.from + 1 : 0),
    0,
  );
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
  // Resume: reuse the finished chunks of an unfinished export with the same inputs.
  const old = o.key ? await readManifest(o.work) : null;
  const chunks = old && old.key === o.key ? old.chunks : chunkPlan(total, o.fps, workers);
  const reuse = new Set<number>();
  if (old && old.key === o.key) {
    for (const k of chunks.keys())
      if (existsSync(doneFile(o.work, k)) && existsSync(chunkFile(o.work, k))) reuse.add(k);
  } else {
    await rm(o.work, { recursive: true, force: true });
  }
  await mkdir(o.work, { recursive: true });
  await mkdir(path.dirname(o.out), { recursive: true });
  if (o.key) await writeFile(path.join(o.work, 'manifest.json'), JSON.stringify({ key: o.key, chunks }));

  const resumed = [...reuse].reduce((n, k) => n + chunks[k]!.to - chunks[k]!.from + 1, 0);
  let frames = resumed;
  let phase: ExportPhase = 'render';
  const progress = (latest?: ExportProgress['latest']) =>
    o.onProgress?.({
      phase,
      frames,
      resumed,
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
    const files = chunks.map((_, k) => chunkFile(o.work, k));
    const todo = [...chunks.keys()].filter((k) => !reuse.has(k));
    const audioFile = path.join(o.work, 'audio.m4a');
    const audio = mixAudio(o.audio, audioFile, {
      duration: total / o.fps,
      normalize: o.normalize ?? true,
      signal: o.signal,
    });
    audio.catch(() => {});
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(workers, todo.length) }, async () => {
        const host = o.host();
        hosts.push(host);
        try {
          for (let k = todo[next++]; k !== undefined; k = todo[next++]) {
            if (o.signal?.aborted) throw new Error('export cancelled');
            const enc = await FrameEncoder.start(files[k]!, {
              ...o.encode,
              fps: o.fps,
              ...(o.size ? { size: o.size } : {}),
            });
            encoders.push(enc);
            await renderFrames(host, o.slug, chunks[k]!, async (index, png) => {
              if (o.signal?.aborted) throw new Error('export cancelled');
              await enc.write(png);
              frames++;
              progress({ index, png });
            });
            await enc.finish();
            if (o.key) await writeFile(doneFile(o.work, k), '');
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
    await rm(o.work, { recursive: true, force: true }).catch(() => {});
    return { file: o.out, frames: total, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    abort();
    // Keep finished chunks for a resume (only with a fingerprint to match them by).
    if (!o.key) await rm(o.work, { recursive: true, force: true }).catch(() => {});
    throw o.signal?.aborted ? new Error('export cancelled') : e;
  } finally {
    o.signal?.removeEventListener('abort', abort);
  }
}
