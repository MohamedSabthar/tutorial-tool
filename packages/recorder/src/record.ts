import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from 'playwright';
import type { Take } from '@studio/core';
import type { ScreencastFrame } from './screencast';

const run = promisify(execFile);

/**
 * Records the product window from the CDP screencast at full resolution. Each frame carries
 * Chromium's wall-clock timestamp; the tut run logs its start on the same clock, so video
 * time 0 is exactly event time 0, with no marker-frame detection.
 *
 * Frames are written as JPEGs while recording and encoded afterwards to a constant-frame-
 * rate H.264 MP4 with a short GOP, so the editor can seek to any frame.
 */
export interface RecordedFrame {
  file: string;
  /** Seconds since the Unix epoch. */
  ts: number;
}

export interface ScreenRecorderOptions {
  /** Take folder: frames/ and video.mp4 are written here. */
  dir: string;
  /** Frame size to capture (frame pixels). */
  width: number;
  height: number;
  quality?: number;
  /** Also forward frames for the live view, at most this many per second (0 disables). */
  liveFps?: number;
  onLiveFrame?: (f: ScreencastFrame) => void;
}

export class ScreenRecorder {
  readonly frames: RecordedFrame[] = [];
  private writes: Promise<unknown>[] = [];
  private stopped = false;
  private lastLive = 0;

  private constructor(
    private readonly opts: ScreenRecorderOptions,
    private readonly stopCdp: () => Promise<void>,
  ) {}

  static async start(page: Page, opts: ScreenRecorderOptions): Promise<ScreenRecorder> {
    const framesDir = path.join(opts.dir, 'frames');
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    let rec: ScreenRecorder | null = null;
    const pending: Parameters<typeof onFrame>[0][] = [];
    function onFrame(ev: {
      data: string;
      sessionId: number;
      metadata: { timestamp?: number; deviceWidth: number; deviceHeight: number };
    }) {
      void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      if (rec) rec.accept(ev.data, ev.metadata.timestamp ?? Date.now() / 1000);
      else pending.push(ev);
    }
    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: opts.quality ?? 90,
      maxWidth: opts.width,
      maxHeight: opts.height,
      everyNthFrame: 1,
    });
    rec = new ScreenRecorder(opts, async () => {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
    });
    for (const ev of pending) rec.accept(ev.data, ev.metadata.timestamp ?? Date.now() / 1000);
    return rec;
  }

  private accept(data: string, ts: number): void {
    if (this.stopped) return;
    const file = path.join(this.opts.dir, 'frames', `${String(this.frames.length + 1).padStart(6, '0')}.jpg`);
    this.frames.push({ file, ts });
    this.writes.push(writeFile(file, Buffer.from(data, 'base64')));
    const liveFps = this.opts.liveFps ?? 15;
    if (this.opts.onLiveFrame && liveFps > 0 && ts - this.lastLive >= 1 / liveFps) {
      this.lastLive = ts;
      this.opts.onLiveFrame({ data, width: this.opts.width, height: this.opts.height, timestamp: ts });
    }
  }

  async stop(): Promise<RecordedFrame[]> {
    this.stopped = true;
    await this.stopCdp();
    await Promise.all(this.writes);
    return this.frames;
  }
}

export interface EncodeOptions {
  frames: RecordedFrame[];
  /** Epoch seconds of event time 0 (the tut start marker). */
  t0: number;
  /** Epoch seconds where the take ends. */
  t1: number;
  dir: string;
  id: string;
  fps?: number;
  /** Keep the JPEG frames after encoding (default: delete). */
  keepFrames?: boolean;
}

/**
 * Builds an ffconcat timeline from timestamped frames (each frame shown until the next
 * one arrives, the latest frame before t0 shown from t0), then encodes CFR H.264.
 */
export function concatList(frames: RecordedFrame[], t0: number, t1: number, dir: string): string {
  const sorted = [...frames].sort((a, b) => a.ts - b.ts);
  let startIdx = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i]!.ts <= t0) startIdx = i;
  const used = sorted.slice(startIdx).filter((f) => f.ts < t1);
  if (used.length === 0) throw new Error('no frames were captured during the take');
  const lines = ['ffconcat version 1.0'];
  used.forEach((f, i) => {
    const from = Math.max(f.ts, t0);
    const to = Math.min(i + 1 < used.length ? used[i + 1]!.ts : t1, t1);
    const dur = Math.max(to - from, 0.001);
    lines.push(`file '${path.relative(dir, f.file)}'`, `duration ${dur.toFixed(6)}`);
  });
  // ffconcat ignores the last duration unless the last file is listed again.
  lines.push(`file '${path.relative(dir, used[used.length - 1]!.file)}'`);
  return lines.join('\n') + '\n';
}

export async function encodeTake(opts: EncodeOptions): Promise<Take> {
  const fps = opts.fps ?? 30;
  const list = path.join(opts.dir, 'frames.ffconcat');
  await writeFile(list, concatList(opts.frames, opts.t0, opts.t1, opts.dir));
  const video = path.join(opts.dir, 'video.mp4');
  await run(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      `fps=${fps},crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-g',
      String(Math.round(fps / 2)),
      '-keyint_min',
      String(Math.round(fps / 2)),
      '-movflags',
      '+faststart',
      video,
    ],
    { cwd: opts.dir, maxBuffer: 10 * 1024 * 1024 },
  );
  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '1',
    '-i',
    video,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    path.join(opts.dir, 'poster.jpg'),
  ]);
  const info = await probe(video);
  if (!opts.keepFrames) await rm(path.join(opts.dir, 'frames'), { recursive: true, force: true });
  await rm(list, { force: true });
  return {
    id: opts.id,
    video: 'video.mp4',
    events: 'events.jsonl',
    width: info.width,
    height: info.height,
    fps: info.fps,
    duration: info.duration,
  };
}

export interface ProbeInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
  codec: string;
  frames: number;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_packets',
    '-show_entries',
    'stream=width,height,r_frame_rate,avg_frame_rate,codec_name,nb_read_packets:format=duration',
    '-of',
    'json',
    file,
  ]);
  const j = JSON.parse(stdout) as {
    streams: {
      width: number;
      height: number;
      r_frame_rate: string;
      codec_name: string;
      nb_read_packets: string;
    }[];
    format: { duration: string };
  };
  const s = j.streams[0]!;
  const [n, d] = s.r_frame_rate.split('/').map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: d ? n! / d : n!,
    duration: Number(j.format.duration),
    codec: s.codec_name,
    frames: Number(s.nb_read_packets),
  };
}
