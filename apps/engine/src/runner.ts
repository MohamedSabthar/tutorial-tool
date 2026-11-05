import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CaptureAction, type CaptureStatus, type RecorderEvent } from '@studio/core';
import { RpcError, type LiveSession, type RpcEvent, type RpcEventData } from '@studio/core';
import {
  captureToScript,
  defaultFixture,
  loadScript,
  openCapture,
  openInspector,
  type CaptureSession,
  type Inspector,
  type ScriptFixture,
} from '@studio/recorder/node';
import type { SeriesStarts } from './seriesStarts';
import type { ProjectStore } from './projects';
import { runProjectScript, type ProjectRunResult, type RunMode } from './recording';
import type { Workspace } from './workspace';

type Broadcast = <E extends RpcEvent>(event: E, data: RpcEventData<E>) => void;

const INSPECT_IDLE_MS = 5 * 60_000;

/**
 * Owns the product window: one recorder run or inspector at a time (each launches its own
 * WSO2 Integrator), streamed to the Live window. Used by the RPC handlers and the agent tools.
 */
export class Runner {
  private busyWith: string | null = null;
  private abort: AbortController | null = null;
  private inspector: { slug: string; inspector: Inspector; timer: NodeJS.Timeout } | null = null;
  /** Feed mode: the open capture. It holds the product window until finished or discarded. */
  private capture: {
    slug: string;
    title: string;
    fixture: ScriptFixture;
    status: CaptureStatus;
    session: CaptureSession | null;
  } | null = null;

  constructor(
    private store: ProjectStore,
    private workspace: Workspace,
    private broadcast: Broadcast,
    /** Series parts start from an earlier part's end state and save their own. */
    private starts?: SeriesStarts,
    /** A series part's recording saved its end state. */
    private onPartRecorded?: (project: string) => void,
  ) {}

  get busy(): boolean {
    return this.busyWith !== null;
  }

  /** Runs `fn` holding the product window, streaming progress to Live. */
  async exclusive<T>(
    title: string,
    mode: 'dry' | 'record',
    fn: (cb: ReturnType<Runner['liveCallbacks']>) => Promise<T>,
    slug: string | null = null,
  ): Promise<T> {
    if (this.busyWith) throw new RpcError(`the recorder is busy (${this.busyWith})`, 'bad_request');
    await this.closeInspector();
    this.busyWith = title;
    try {
      return await fn(this.liveCallbacks(title, mode, slug));
    } finally {
      this.busyWith = null;
      this.abort = null;
      this.emitSession({ state: 'stopped', title, mode, frame: null, slug });
    }
  }

  /** Holds the product window without streaming to Live (quick checks). */
  async withLock<T>(title: string, fn: () => Promise<T>): Promise<T> {
    if (this.busyWith) throw new RpcError(`the recorder is busy (${this.busyWith})`, 'bad_request');
    await this.closeInspector();
    this.busyWith = title;
    try {
      return await fn();
    } finally {
      this.busyWith = null;
    }
  }

  stop(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  /** The run streaming to Live now, or null. */
  session: LiveSession | null = null;

  private emitSession(s: LiveSession) {
    this.session = s.state === 'started' ? s : null;
    this.broadcast('live.session', s);
  }

  /** Callbacks that stream a run to Live. */
  liveCallbacks(title: string, mode: 'dry' | 'record', slug: string | null = null) {
    this.abort = new AbortController();
    const broadcast = this.broadcast;
    this.emitSession({ state: 'started', title, mode, frame: null, slug });
    return {
      signal: this.abort.signal,
      onEvent: (e: RecorderEvent) => {
        broadcast('recorder.event', e);
        const vp =
          e.kind === 'marker' && e.name === 'start'
            ? (e.data?.viewport as { width: number; height: number; scale: number } | undefined)
            : undefined;
        if (vp)
          this.emitSession({
            state: 'started',
            title,
            mode,
            frame: { width: vp.width * vp.scale, height: vp.height * vp.scale },
            slug,
          });
      },
      onAction: (a: RpcEventData<'live.action'>) => broadcast('live.action', a),
      onPointer: (p: RpcEventData<'live.pointer'>) => broadcast('live.pointer', p),
      onFrame: (f: RpcEventData<'live.frame'>) => broadcast('live.frame', f),
      onStage: (stage: RpcEventData<'live.stage'>['stage']) =>
        broadcast('live.stage', { stage, at: Date.now() }),
      onProgress: (message: string) => broadcast('recorder.progress', { message, at: Date.now() }),
    };
  }

  /** Runs a project's script.spec.ts (dry run, or record a new take). */
  async runProject(slug: string, mode: RunMode, opts: { until?: string } = {}): Promise<ProjectRunResult> {
    const title = (await this.store.open(slug).catch(() => null))?.project.title ?? slug;
    const start = (await this.starts?.forRun(slug)) ?? null;
    const result = await this.exclusive(
      title,
      mode === 'record' ? 'record' : 'dry',
      (cb) =>
        runProjectScript(this.store, this.workspace, slug, mode, cb, {
          ...opts,
          startFrom: start?.startFrom ?? null,
          saveEndState: start?.saveEndState ?? null,
        }),
      slug,
    );
    if (start && mode === 'record' && result.passed && result.take) {
      await start.recorded();
      this.onPartRecorded?.(slug);
    }
    return result;
  }

  /**
   * The project's open inspector, or a new one. A new one is opened when asked to replay up to
   * a step, when `restart` is set, or when none is open for this project.
   */
  async inspect(
    slug: string,
    opts: { uptoStep?: string; restart?: boolean },
  ): Promise<{ inspector: Inspector; fresh: boolean }> {
    const open = this.inspector;
    if (open && open.slug === slug && !opts.uptoStep && !opts.restart) {
      this.touch();
      return { inspector: open.inspector, fresh: false };
    }
    if (this.busyWith) throw new RpcError(`the recorder is busy (${this.busyWith})`, 'bad_request');
    await this.closeInspector();
    const scriptFile = path.join(this.store.dir(slug), 'script.spec.ts');
    const mod = await loadScript(scriptFile).catch(() => null);
    if (opts.uptoStep && !mod)
      throw new RpcError('this project has no loadable script.spec.ts to replay', 'bad_request');
    const { project } = await this.store.open(slug);
    const title = `Inspecting ${project.title}`;
    this.busyWith = title;
    const cb = this.liveCallbacks(title, 'dry', slug);
    try {
      cb.onStage('launch');
      const startFrom = (await this.starts?.forRun(slug))?.startFrom;
      const inspector = await openInspector(mod ?? { fixture: defaultFixture(project.product) }, {
        product: project.product,
        ...(startFrom ? { startFrom } : {}),
        ...(opts.uptoStep ? { uptoStep: opts.uptoStep } : {}),
        onProgress: cb.onProgress,
        onFrame: cb.onFrame,
      });
      cb.onStage('run');
      this.inspector = {
        slug,
        inspector,
        timer: setTimeout(() => void this.closeInspector(), INSPECT_IDLE_MS),
      };
      return { inspector, fresh: true };
    } catch (e) {
      cb.onStage('failed');
      this.emitSession({ state: 'stopped', title, mode: 'dry', frame: null, slug: null });
      throw e;
    } finally {
      // The inspector keeps the window, but runs may take it over (they close it first).
      this.busyWith = null;
      this.abort = null;
    }
  }

  private touch() {
    if (!this.inspector) return;
    clearTimeout(this.inspector.timer);
    this.inspector.timer = setTimeout(() => void this.closeInspector(), INSPECT_IDLE_MS);
  }

  async closeInspector(): Promise<boolean> {
    const open = this.inspector;
    if (!open) return false;
    this.inspector = null;
    clearTimeout(open.timer);
    await open.inspector.close();
    this.broadcast('live.stage', { stage: 'done', at: Date.now() });
    this.emitSession({ state: 'stopped', title: 'Inspector', mode: 'dry', frame: null, slug: null });
    return true;
  }

  // ---- Feed mode: capture -----------------------------------------------------------------

  /** The project has a capture open (launching or capturing). */
  capturing(slug: string): boolean {
    const c = this.capture;
    return c?.slug === slug && (c.status.state === 'launching' || c.status.state === 'capturing');
  }

  /** Where a project's capture lives: trace.json, draft.spec.ts and shots/. */
  captureDir(slug: string): string {
    return path.join(this.store.dir(slug), '.studio', 'capture');
  }

  private setCapture(patch: Partial<CaptureStatus>) {
    const c = this.capture;
    if (!c) return;
    const was = c.status.state;
    c.status = { ...c.status, ...patch };
    this.broadcast('capture.changed', c.status);
    // The Projects card shows "Capturing" while it lasts.
    if (c.status.state !== was) this.broadcast('project.changed', { slug: c.slug });
  }

  /** The project's capture: the open one, or what the last finished capture saved. */
  async captureStatus(slug: string): Promise<CaptureStatus> {
    if (this.capture?.slug === slug) return this.capture.status;
    const actions = await readFile(path.join(this.captureDir(slug), 'trace.json'), 'utf8')
      // Parsed, so captures saved before a field existed get its default.
      .then((t) => CaptureAction.array().parse((JSON.parse(t) as { actions: unknown }).actions))
      .catch(() => [] as CaptureAction[]);
    return { slug, state: 'idle', message: null, actions };
  }

  /**
   * Opens the product on the project's fixture (or a series part's start) and captures what
   * the user does. Returns once the window is up; actions arrive as `capture.changed`.
   */
  async startCapture(slug: string): Promise<CaptureStatus> {
    if (this.capture?.slug === slug && this.capture.status.state !== 'ended') return this.capture.status;
    if (this.capture) await this.discardCapture(this.capture.slug);
    if (this.busyWith) throw new RpcError(`the recorder is busy (${this.busyWith})`, 'bad_request');
    await this.closeInspector();
    const { project } = await this.store.open(slug);
    const fixture = await this.captureFixture(slug, project.product);
    const title = `Capturing ${project.title}`;
    const dir = this.captureDir(slug);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    this.busyWith = title;
    this.capture = {
      slug,
      title,
      fixture,
      session: null,
      status: { slug, state: 'launching', message: 'Opening the product…', actions: [] },
    };
    this.broadcast('capture.changed', this.capture.status);
    const cb = this.liveCallbacks(title, 'dry', slug);
    try {
      cb.onStage('launch');
      const startFrom = (await this.starts?.forRun(slug))?.startFrom;
      const session = await openCapture(fixture, {
        product: project.product,
        ...(startFrom ? { startFrom } : {}),
        shotsDir: path.join(dir, 'shots'),
        onProgress: (message) => {
          cb.onProgress(message);
          if (this.capture?.slug === slug && this.capture.status.state === 'launching')
            this.setCapture({ message });
        },
        onFrame: cb.onFrame,
        onChange: (actions) => {
          if (this.capture?.slug === slug) this.setCapture({ actions });
        },
        onClosed: () => {
          if (this.capture?.slug !== slug) return;
          this.setCapture({ state: 'ended', message: 'The product window was closed.' });
          this.capture.session = null;
          this.releaseCapture();
        },
      });
      if (this.capture?.slug !== slug) {
        // Discarded while it opened.
        await session.close();
        throw new RpcError('the capture was cancelled', 'bad_request');
      }
      this.capture.session = session;
      cb.onStage('run');
      this.setCapture({
        state: 'capturing',
        message: `${project.title} is open: click through the tutorial, then come back and press Finish.`,
      });
      return this.capture.status;
    } catch (e) {
      cb.onStage('failed');
      if (this.capture?.slug === slug) this.capture = null;
      this.releaseCapture();
      this.broadcast('capture.changed', {
        slug,
        state: 'idle',
        message: e instanceof Error ? e.message : String(e),
        actions: [],
      });
      throw e;
    }
  }

  /**
   * What a capture starts from: the project's own script's fixture, else the one the newest
   * script for the same product uses (what the agent found works for it), else the product's
   * default. A product added in products.json without `fixture` would otherwise open an empty
   * folder, which a Ballerina-based product rejects.
   */
  private async captureFixture(slug: string, product: string): Promise<ScriptFixture> {
    const own = await loadScript(path.join(this.store.dir(slug), 'script.spec.ts')).catch(() => null);
    if (own) return own.fixture;
    const others = await Promise.all(
      (await this.store.list())
        .filter((p) => p.product === product && p.slug !== slug)
        .map(async (p) => {
          const file = path.join(this.store.dir(p.slug), 'script.spec.ts');
          const s = await stat(file).catch(() => null);
          return s ? { file, at: s.mtimeMs } : null;
        }),
    );
    const newest = others.filter((o) => o !== null).sort((a, b) => b.at - a.at);
    for (const o of newest.slice(0, 5)) {
      const mod = await loadScript(o.file).catch(() => null);
      if (mod) return mod.fixture;
    }
    return defaultFixture(product);
  }

  private releaseCapture() {
    if (this.busyWith?.startsWith('Capturing')) this.busyWith = null;
    this.abort = null;
    this.emitSession({ state: 'stopped', title: 'Capture', mode: 'dry', frame: null, slug: null });
  }

  /** Drops captured actions: from the open capture, or from the saved one (its trace and draft). */
  async removeCaptured(slug: string, ids: string[]): Promise<CaptureStatus> {
    const c = this.capture;
    if (c?.slug !== slug) return this.removeSaved(slug, ids);
    if (c.session) c.session.remove(ids);
    else {
      const drop = new Set(ids);
      this.setCapture({ actions: c.status.actions.filter((a) => !drop.has(a.id)) });
    }
    return c.status;
  }

  private async removeSaved(slug: string, ids: string[]): Promise<CaptureStatus> {
    const dir = this.captureDir(slug);
    const text = await readFile(path.join(dir, 'trace.json'), 'utf8').catch(() => null);
    if (!text) throw new RpcError('this project has no captured demo', 'not_found');
    const trace = JSON.parse(text) as { capturedAt: string; fixture: ScriptFixture; actions: unknown };
    const drop = new Set(ids);
    const actions = CaptureAction.array()
      .parse(trace.actions)
      .filter((a) => !drop.has(a.id));
    await this.saveCapture(slug, trace.fixture, actions, trace.capturedAt);
    const status: CaptureStatus = { slug, state: 'idle', message: null, actions };
    this.broadcast('capture.changed', status);
    return status;
  }

  /** Writes the capture's trace.json and the draft script generated from it. */
  private async saveCapture(
    slug: string,
    fixture: ScriptFixture,
    actions: CaptureAction[],
    capturedAt: string,
  ) {
    const { project } = await this.store.open(slug);
    const dir = this.captureDir(slug);
    await writeFile(
      path.join(dir, 'trace.json'),
      `${JSON.stringify({ capturedAt, fixture, actions }, null, 2)}\n`,
    );
    await writeFile(
      path.join(dir, 'draft.spec.ts'),
      captureToScript(actions, fixture, { title: project.title, capturedAt }),
    );
  }

  /** Closes the product and saves the capture and a draft script from it. */
  async finishCapture(slug: string): Promise<{ status: CaptureStatus; scriptPath: string }> {
    const c = this.capture;
    if (c?.slug !== slug) throw new RpcError('no capture is open for this project', 'bad_request');
    const actions = c.session ? await c.session.finish() : c.status.actions;
    c.session = null;
    this.capture = null;
    this.releaseCapture();
    await this.saveCapture(slug, c.fixture, actions, new Date().toISOString().slice(0, 10));
    const status: CaptureStatus = {
      slug,
      state: 'idle',
      message: `Saved ${actions.length} action${actions.length === 1 ? '' : 's'}.`,
      actions,
    };
    this.broadcast('capture.changed', status);
    this.broadcast('project.changed', { slug });
    return { status, scriptPath: '.studio/capture/draft.spec.ts' };
  }

  async discardCapture(slug: string): Promise<CaptureStatus> {
    const c = this.capture;
    const status: CaptureStatus = { slug, state: 'idle', message: null, actions: [] };
    if (c?.slug === slug) {
      this.capture = null;
      await c.session?.close().catch(() => {});
      this.releaseCapture();
      await rm(this.captureDir(slug), { recursive: true, force: true });
    }
    this.broadcast('capture.changed', status);
    this.broadcast('project.changed', { slug });
    return status;
  }

  async close(): Promise<void> {
    this.stop();
    await this.closeInspector().catch(() => {});
    await this.capture?.session?.close().catch(() => {});
    this.capture = null;
  }
}
