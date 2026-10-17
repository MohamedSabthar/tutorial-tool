import path from 'node:path';
import { buildTimeMap, RpcError, voiceSpans, type ExportState } from '@studio/core';
import { exportVideo, RenderHost, type ExportProgress } from '@studio/exporters/node';
import type { ProjectStore } from './projects';
import type { TimelineStore } from './timeline';
import { resolveUiUrl } from './ui';

/** How often progress is broadcast while rendering. */
const PROGRESS_MS = 250;

/**
 * Export jobs, one per project at a time: renders the saved timeline through export-mode render
 * hosts (GPU required), mixes the voice-over and writes `output/<slug>.mp4`.
 */
export class Exporter {
  private jobs = new Map<string, { state: ExportState; abort: AbortController; done: Promise<void> }>();

  constructor(
    private deps: {
      store: ProjectStore;
      timelines: TimelineStore;
      engine: () => { port: number; token: string };
      emit: (state: ExportState) => void;
      /** Parallel workers (default: CPU cores / 2). */
      workers?: number;
    },
  ) {}

  status(slug: string): ExportState | null {
    return this.jobs.get(slug)?.state ?? null;
  }

  async start(slug: string, fps: number): Promise<ExportState> {
    if (this.jobs.get(slug)?.state.state === 'running')
      throw new RpcError('an export of this tutorial is already running', 'bad_request');
    const { timeline } = await this.deps.timelines.get(slug);
    const tm = buildTimeMap(timeline);
    if (tm.duration <= 0) throw new RpcError('the timeline is empty', 'bad_request');
    const dir = this.deps.store.dir(slug);
    const audio = voiceSpans(timeline, tm).flatMap((s) =>
      s.line.audio ? [{ file: path.join(dir, s.line.audio), start: s.start }] : [],
    );
    const rel = `output/${slug}.mp4`;
    const state: ExportState = {
      slug,
      state: 'running',
      phase: 'render',
      fps,
      frames: 0,
      total: Math.max(1, Math.round(tm.duration * fps)),
      progress: 0,
      startedAt: new Date().toISOString(),
      seconds: null,
      file: null,
      error: null,
    };
    const abort = new AbortController();
    const engine = this.deps.engine;
    let last = 0;
    const update = (p: Partial<ExportState>, force = false) => {
      Object.assign(state, p);
      const now = performance.now();
      if (force || now - last >= PROGRESS_MS) {
        last = now;
        this.deps.emit({ ...state });
      }
    };
    const done = exportVideo({
      slug,
      duration: tm.duration,
      fps,
      out: path.join(dir, rel),
      work: path.join(dir, 'output', '.export'),
      host: () =>
        new RenderHost({
          engine,
          uiUrl: () => resolveUiUrl(`http://127.0.0.1:${engine().port}`),
          exportMode: true,
          requireGpu: true,
        }),
      audio,
      ...(this.deps.workers ? { workers: this.deps.workers } : {}),
      signal: abort.signal,
      onProgress: (p: ExportProgress) =>
        update(
          { phase: p.phase, frames: p.frames, total: p.total, progress: p.progress },
          p.phase !== 'render' || p.frames === p.total,
        ),
    }).then(
      (r) => update({ state: 'done', phase: 'done', progress: 1, seconds: r.seconds, file: rel }, true),
      (e: unknown) =>
        update(
          abort.signal.aborted
            ? { state: 'cancelled' }
            : { state: 'failed', error: e instanceof Error ? e.message : String(e) },
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
