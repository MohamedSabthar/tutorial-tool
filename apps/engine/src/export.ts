import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildTimeMap,
  EXPORT_RESOLUTIONS,
  renderSfxTrack,
  RpcError,
  sfxCues,
  voiceSpans,
  wavBytes,
  type ExportPlan,
  type ExportSettings,
  type ExportState,
  type Timeline,
} from '@studio/core';
import {
  exportVideo,
  hardwareEncoder,
  RenderHost,
  resumableFrames,
  type ExportProgress,
} from '@studio/exporters/node';
import type { DocWriter } from './docs';
import type { ProjectStore } from './projects';
import type { TimelineStore } from './timeline';
import { readEvents } from './timing';
import { resolveUiUrl } from './ui';

/** How often progress is broadcast while rendering. */
const PROGRESS_MS = 250;
/** How often a preview of the newest frame is sent. */
const FRAME_MS = 600;
const BITRATE = 12_000_000;
const AUDIO_BITRATE = 192_000;

/**
 * Export jobs, one per project at a time: renders the saved timeline through export-mode render
 * hosts (GPU required), mixes the voice-over and writes `output/<slug>.mp4`, then the captions,
 * the Markdown doc and the script. A cancelled export keeps its finished chunks: the next one
 * with the same timeline, settings and components picks up from there.
 */
export class Exporter {
  private jobs = new Map<string, { state: ExportState; abort: AbortController; done: Promise<void> }>();

  constructor(
    private deps: {
      store: ProjectStore;
      timelines: TimelineStore;
      docs: Pick<DocWriter, 'write'>;
      workspace: string;
      engine: () => { port: number; token: string };
      emit: (state: ExportState) => void;
      frame: (f: { slug: string; index: number; data: string }) => void;
      /** Parallel workers (default: CPU cores / 2). */
      workers?: number;
    },
  ) {}

  status(slug: string): ExportState | null {
    return this.jobs.get(slug)?.state ?? null;
  }

  /** The click and typing sounds as one WAV in the export's work folder, or null without any. */
  private async sfxTrack(slug: string, timeline: Timeline, duration: number): Promise<string | null> {
    const dir = this.deps.store.dir(slug);
    const eventsByTake: Record<string, Awaited<ReturnType<typeof readEvents>>> = {};
    for (const take of timeline.takes)
      eventsByTake[take.id] = await readEvents(dir, take.events).catch(() => []);
    const cues = sfxCues(timeline, eventsByTake);
    if (!cues.length) return null;
    const rate = 48_000;
    const file = path.join(this.work(slug), 'sfx.wav');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, wavBytes(renderSfxTrack(cues, duration, rate, timeline.sfx.volume), rate));
    return file;
  }

  private work(slug: string) {
    return path.join(this.deps.store.dir(slug), 'output', '.export');
  }

  /** Everything that changes the frames: a resume reuses chunks only when this matches. */
  private async key(slug: string, timeline: Timeline, settings: ExportSettings): Promise<string> {
    const dirs = [
      path.join(this.deps.workspace, 'overlays'),
      path.join(this.deps.workspace, 'scenes'),
      path.join(this.deps.store.dir(slug), 'overlays'),
      path.join(this.deps.store.dir(slug), 'scenes'),
    ];
    const components: string[] = [];
    for (const d of dirs) {
      for (const f of await readdir(d).catch(() => [] as string[])) {
        if (!/\.tsx?$/.test(f)) continue;
        const st = await stat(path.join(d, f)).catch(() => null);
        if (st) components.push(`${d}/${f}:${st.mtimeMs}:${st.size}`);
      }
    }
    return createHash('sha256')
      .update(JSON.stringify({ timeline, fps: settings.fps, resolution: settings.resolution, components }))
      .digest('hex')
      .slice(0, 24);
  }

  async plan(slug: string, settings: ExportSettings): Promise<ExportPlan> {
    const { timeline } = await this.deps.timelines.get(slug);
    const tm = buildTimeMap(timeline);
    const size = EXPORT_RESOLUTIONS[settings.resolution];
    const running = this.jobs.get(slug)?.state.state === 'running';
    return {
      duration: tm.duration,
      frames: Math.max(1, Math.round(tm.duration * settings.fps)),
      width: size.width,
      height: size.height,
      encoder: (await hardwareEncoder()) ? 'h264_videotoolbox' : 'libx264',
      bitrate: BITRATE,
      maxBytes: Math.round(((BITRATE + AUDIO_BITRATE) * tm.duration) / 8),
      scenes: {
        recorded: timeline.scenes.filter((s) => s.kind === 'recording').length,
        explainers: timeline.scenes.filter((s) => s.kind === 'explainer').length,
      },
      steps: timeline.steps.length,
      voiced: timeline.voice.some((v) => v.audio),
      hasScript: existsSync(path.join(this.deps.store.dir(slug), 'script.spec.ts')),
      resumable: running
        ? 0
        : await resumableFrames(this.work(slug), await this.key(slug, timeline, settings)),
    };
  }

  async start(slug: string, settings: ExportSettings): Promise<ExportState> {
    if (this.jobs.get(slug)?.state.state === 'running')
      throw new RpcError('an export of this tutorial is already running', 'bad_request');
    const { outputs } = settings;
    if (!outputs.video && !outputs.captions && !outputs.doc && !outputs.script)
      throw new RpcError('choose at least one output', 'bad_request');
    const { timeline } = await this.deps.timelines.get(slug);
    const tm = buildTimeMap(timeline);
    if (outputs.video && tm.duration <= 0) throw new RpcError('the timeline is empty', 'bad_request');
    const dir = this.deps.store.dir(slug);
    const audio = voiceSpans(timeline, tm).flatMap((s) =>
      s.line.audio ? [{ file: path.join(dir, s.line.audio), start: s.start }] : [],
    );
    // Without a voice-over the mix isn't normalised: clicks alone would be raised to speech loudness.
    const normalize = audio.length > 0;
    if (outputs.video && timeline.sfx.enabled) {
      const sfx = await this.sfxTrack(slug, timeline, tm.duration).catch(() => null);
      if (sfx) audio.push({ file: sfx, start: 0 });
    }
    const rel = `output/${slug}.mp4`;
    const total = Math.max(1, Math.round(tm.duration * settings.fps));
    const state: ExportState = {
      slug,
      state: 'running',
      phase: outputs.video ? 'render' : 'docs',
      detail: null,
      settings,
      fps: settings.fps,
      frames: 0,
      total: outputs.video ? total : 0,
      resumed: 0,
      progress: 0,
      startedAt: new Date().toISOString(),
      seconds: null,
      file: null,
      error: null,
      outputs: [],
      notes: [],
    };
    const abort = new AbortController();
    const engine = this.deps.engine;
    let last = 0;
    let lastFrame = 0;
    const update = (p: Partial<ExportState>, force = false) => {
      Object.assign(state, p);
      const now = performance.now();
      if (force || now - last >= PROGRESS_MS) {
        last = now;
        this.deps.emit({ ...state });
      }
    };
    const preview = (latest: NonNullable<ExportProgress['latest']>) => {
      const now = performance.now();
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      void toPreview(latest.png).then(
        (jpg) => this.deps.frame({ slug, index: latest.index, data: jpg.toString('base64') }),
        () => {},
      );
    };
    // The video is 96% of the job when there is one; the written outputs are the rest.
    const videoShare = outputs.video ? 0.96 : 0;
    const size = EXPORT_RESOLUTIONS[settings.resolution];
    const video = outputs.video
      ? exportVideo({
          slug,
          duration: tm.duration,
          fps: settings.fps,
          out: path.join(dir, rel),
          work: this.work(slug),
          key: await this.key(slug, timeline, settings),
          host: () =>
            new RenderHost({
              engine,
              uiUrl: () => resolveUiUrl(`http://127.0.0.1:${engine().port}`),
              exportMode: true,
              requireGpu: true,
              // 4K renders the stage at 2 device pixels per stage pixel; 720p scales 1080p down.
              ...(settings.resolution === '4k' ? { scale: 2 } : {}),
            }),
          ...(settings.resolution === '720p' ? { size } : {}),
          audio,
          normalize,
          ...(this.deps.workers ? { workers: this.deps.workers } : {}),
          signal: abort.signal,
          onProgress: (p: ExportProgress) => {
            if (p.latest) preview(p.latest);
            if (p.phase === 'done') return;
            update(
              {
                phase: p.phase,
                frames: p.frames,
                total: p.total,
                resumed: p.resumed,
                progress: p.progress * videoShare,
              },
              p.phase !== 'render' || p.frames === p.total,
            );
          },
        })
      : Promise.resolve(null);
    const done = video
      .then(async (r) => {
        if (r) update({ file: rel }, true);
        const written = outputs.captions || outputs.doc || outputs.script;
        const doc = written
          ? await this.deps.docs.write(slug, {
              captions: outputs.captions,
              doc: outputs.doc,
              script: outputs.script,
              signal: abort.signal,
              onStep: (detail) =>
                update({ phase: 'docs', detail, progress: Math.max(state.progress, videoShare) }, true),
            })
          : { files: [], notes: [] };
        if (abort.signal.aborted) throw new Error('export cancelled');
        return { video: r, doc };
      })
      .then(
        (r) =>
          update(
            {
              state: 'done',
              phase: 'done',
              detail: null,
              progress: 1,
              seconds: (Date.now() - Date.parse(state.startedAt)) / 1000,
              outputs: [...(r.video ? [rel] : []), ...r.doc.files],
              notes: r.doc.notes,
            },
            true,
          ),
        (e: unknown) =>
          update(
            abort.signal.aborted
              ? { state: 'cancelled', detail: null }
              : { state: 'failed', detail: null, error: e instanceof Error ? e.message : String(e) },
            true,
          ),
      );
    this.jobs.set(slug, { state, abort, done });
    this.deps.emit({ ...state });
    return { ...state };
  }

  async cancel(slug: string): Promise<boolean> {
    const job = this.jobs.get(slug);
    if (!job || job.state.state !== 'running') return false;
    job.abort.abort();
    await job.done;
    return true;
  }

  /** Waits for a project's export to finish (tests). */
  async settled(slug: string): Promise<ExportState | null> {
    await this.jobs.get(slug)?.done;
    return this.status(slug);
  }

  async close() {
    for (const slug of this.jobs.keys()) await this.cancel(slug);
  }
}

/** A 960 px JPEG of a frame, for the Export screen's preview. */
function toPreview(png: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'png_pipe',
        '-i',
        '-',
        '-vf',
        'scale=960:-2',
        '-q:v',
        '5',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        '-',
      ],
      { encoding: 'buffer', maxBuffer: 16 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr) || err.message)) : resolve(stdout)),
    );
    child.stdin?.end(png);
  });
}
