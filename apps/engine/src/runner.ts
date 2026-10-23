import path from 'node:path';
import type { RecorderEvent } from '@studio/core';
import { RpcError, type LiveSession, type RpcEvent, type RpcEventData } from '@studio/core';
import { loadScript, openInspector, type Inspector, type ScriptFixture } from '@studio/recorder/node';
import type { ProjectStore } from './projects';
import { runProjectScript, type ProjectRunResult, type RunMode } from './recording';
import type { Workspace } from './workspace';

type Broadcast = <E extends RpcEvent>(event: E, data: RpcEventData<E>) => void;

/** The fixture `inspect_ui` uses when a project has no script yet (same as the reference tutorial). */
export const DEFAULT_FIXTURE: ScriptFixture = {
  kind: 'bi',
  folder: 'greeting-project',
  title: 'Greeting Project',
  integrations: [{ name: 'greeting_service', title: 'Greeting Service' }],
};

const INSPECT_IDLE_MS = 5 * 60_000;

/**
 * Owns the product window: one recorder run or inspector at a time (each launches its own
 * WSO2 Integrator), streamed to the Live window. Used by the RPC handlers and the agent tools.
 */
export class Runner {
  private busyWith: string | null = null;
  private abort: AbortController | null = null;
  private inspector: { slug: string; inspector: Inspector; timer: NodeJS.Timeout } | null = null;

  constructor(
    private store: ProjectStore,
    private workspace: Workspace,
    private broadcast: Broadcast,
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
    return this.exclusive(
      title,
      mode === 'record' ? 'record' : 'dry',
      (cb) => runProjectScript(this.store, this.workspace, slug, mode, cb, opts),
      slug,
    );
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
    const title = `Inspecting ${(await this.store.open(slug)).project.title}`;
    this.busyWith = title;
    const cb = this.liveCallbacks(title, 'dry', slug);
    try {
      cb.onStage('launch');
      const inspector = await openInspector(mod ?? { fixture: DEFAULT_FIXTURE }, {
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

  async close(): Promise<void> {
    this.stop();
    await this.closeInspector().catch(() => {});
  }
}
