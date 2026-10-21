import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FrameLocator, Page } from 'playwright';
import type { Pace, RecorderEvent, Take } from '@studio/core';
import { createBIProject, type BIIntegration } from './fixtures/biProject';
import { signedInProfile } from './launch/signin';
import { launchVSCode, type Progress, type Viewport } from './launch/vscode';
import { getProduct, readAppBundle } from './products';
import { encodeTake, ScreenRecorder } from './record';
import { startScreencast, type ScreencastFrame } from './screencast';
import {
  StepFailedError,
  Tut,
  webview,
  type LiveAction,
  type StepFailure,
  type TargetFrame,
  type TutMode,
} from './tut';

/**
 * Tutorial scripts (`script.spec.ts`) export a fixture and a default function:
 *
 *   export const fixture: ScriptFixture = { kind: 'bi', folder: 'greeting-project', … };
 *   const script: TutorialScript = async ({ tut, page, webview }) => { await tut.step(…) };
 *   export default script;
 *
 * Page objects in the product skill take the same context, so scripts stay short.
 */
export interface ScriptContext {
  tut: Tut;
  page: Page;
  /** The active VS Code webview's content frame (WSO2 Integrator's visual editors). */
  webview: () => FrameLocator;
}

export type TutorialScript = (ctx: ScriptContext) => Promise<void>;

export interface ScriptFixture {
  kind: 'bi';
  /** Folder name, shown in the title bar ("greeting-project — WSO2 Integrator"). */
  folder: string;
  title: string;
  integrations: BIIntegration[];
  /** Text visible in the product once the project has loaded. */
  readyText?: string;
}

export interface ScriptModule {
  fixture: ScriptFixture;
  script: TutorialScript;
}

/**
 * Imports a script.spec.ts. The script and the files it imports relatively (the skill's page
 * objects) are bundled into a fresh module on every call: Node caches ES modules for the life
 * of the process, so a plain import would keep running page objects the agent has since fixed.
 * Package imports stay external.
 */
export async function loadScript(file: string): Promise<ScriptModule> {
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    write: false,
    sourcemap: 'inline',
    logLevel: 'silent',
  }).catch((e: unknown) => {
    const errors = (e as { errors?: { text: string; location?: { file: string; line: number } | null }[] })
      .errors;
    throw new Error(
      errors?.length
        ? errors
            .map((x) => `${x.location ? `${x.location.file}:${x.location.line}: ` : ''}${x.text}`)
            .join('\n')
        : String(e),
    );
  });
  // Inside this package so package imports in the bundle resolve (playwright, @studio/*). The
  // packaged app's code is read-only, so it uses STUDIO_CACHE (scripts only import types).
  const cache = process.env.STUDIO_CACHE
    ? path.join(process.env.STUDIO_CACHE, 'scripts')
    : fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(path.join(cache, 'script-'));
  const bundled = path.join(dir, 'script.mjs');
  await writeFile(bundled, out.outputFiles[0]!.contents);
  try {
    const mod = (await import(pathToFileURL(bundled).href)) as {
      default?: TutorialScript;
      fixture?: ScriptFixture;
    };
    if (typeof mod.default !== 'function')
      throw new Error(`${file} has no default export (the tutorial script)`);
    if (!mod.fixture) throw new Error(`${file} does not export a fixture`);
    return { script: mod.default, fixture: mod.fixture };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Pipeline stages of a run, for the Live window's stepper. */
export type RunStage = 'fixture' | 'launch' | 'load' | 'run' | 'encode' | 'done' | 'failed' | 'stopped';

export interface RunOptions {
  product?: string;
  mode: TutMode;
  /** Record mode: write video.mp4 + events.jsonl here. */
  takeDir?: string;
  takeId?: string;
  /** Dry runs: where to write events.jsonl (optional). */
  eventsFile?: string;
  captureTargets?: boolean;
  /** Voice-first recording: pace steps and cues to this voiced narration (dry runs check the cues). */
  pace?: Pace;
  /** Keep a JPEG of the window at the end of each step here (`<step id>.jpg`). */
  stepShotsDir?: string;
  onEvent?: (e: RecorderEvent) => void;
  onAction?: (a: LiveAction) => void;
  onPointer?: (p: { x: number; y: number; click: boolean }) => void;
  onFrame?: (f: ScreencastFrame) => void;
  onProgress?: Progress;
  onStage?: (stage: RunStage) => void;
  /** Aborting closes the product window; the run ends with a "stopped" failure. */
  signal?: AbortSignal;
}

export interface RunResult {
  passed: boolean;
  mode: TutMode;
  viewport: Viewport;
  events: RecorderEvent[];
  failure: StepFailure | null;
  targetFrames: TargetFrame[];
  take: Take | null;
  screenshot: Buffer;
  durationMs: number;
}

/**
 * Creates a fresh copy of the fixture in a temp folder and opens the product on it, signed in
 * when the user has saved a sign-in profile for the product.
 */
export async function launchFixture(
  fixture: ScriptFixture,
  productId: string,
  progress: Progress,
  onLaunch: () => void = () => {},
) {
  const product = getProduct(productId);
  const profile = signedInProfile(product.id);
  const base = await mkdtemp(path.join(os.tmpdir(), 'studio-run-'));
  const fixtureDir = path.join(base, fixture.folder);
  progress(`Creating the ${fixture.title} fixture…`);
  await createBIProject(fixtureDir, { title: fixture.title, integrations: fixture.integrations });
  onLaunch();
  try {
    const session =
      product.type === 'vscode-app'
        ? await launchVSCode({
            fixture: fixtureDir,
            extensions: [],
            executable: readAppBundle(product.appPath).executable,
            onProgress: progress,
            ...(profile ? { profile } : {}),
          })
        : await launchVSCode({
            fixture: fixtureDir,
            extensions: product.extensions,
            onProgress: progress,
            ...(profile ? { profile } : {}),
          });
    return { base, session };
  } catch (e) {
    await rm(base, { recursive: true, force: true });
    throw e;
  }
}

/** Waits until the product shows the fixture project, then lets the first screen settle. */
export async function waitForFixture(page: Page, fixture: ScriptFixture, progress: Progress) {
  progress('Waiting for the project to load…');
  const ready = fixture.readyText ?? fixture.integrations[0]?.title ?? fixture.title;
  await page.locator('.monaco-list-row', { hasText: ready }).first().waitFor({ timeout: 45_000 });
  // The integration overview opens on its own; let it settle so step 1 starts on a stable screen.
  await page.waitForTimeout(1500);
}

/** Launches the product on a fresh copy of the fixture, runs the script, and records a take. */
export async function runTutorial(mod: ScriptModule, opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const progress = opts.onProgress ?? (() => {});
  const stage = opts.onStage ?? (() => {});
  const product = getProduct(opts.product ?? 'wso2-integrator');
  stage('fixture');

  const { base, session } = await launchFixture(mod.fixture, product.id, progress, () => stage('launch'));
  const recording = opts.mode === 'record' && !!opts.takeDir;
  let stopped = false;
  const onAbort = () => {
    stopped = true;
    progress('Stopping…');
    void session.app.close().catch(() => {});
  };
  if (opts.signal?.aborted) onAbort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let recorder: ScreenRecorder | null = null;
  let stopScreencast: (() => Promise<void>) | null = null;
  try {
    const { page } = session;
    const frame = {
      width: Math.round(session.viewport.width * session.viewport.scale),
      height: Math.round(session.viewport.height * session.viewport.scale),
    };
    // Chromium runs one screencast per target: while recording, the recorder also feeds the live view.
    if (recording)
      recorder = await ScreenRecorder.start(page, {
        dir: opts.takeDir!,
        ...frame,
        ...(opts.onFrame ? { onLiveFrame: opts.onFrame } : {}),
      });
    else if (opts.onFrame) stopScreencast = await startScreencast(page, opts.onFrame);

    stage('load');
    await waitForFixture(page, mod.fixture, progress);

    const eventsFile = recording ? path.join(opts.takeDir!, 'events.jsonl') : opts.eventsFile;
    const tut = new Tut({
      page,
      mode: opts.mode,
      scale: session.viewport.scale,
      ...(eventsFile ? { eventsFile } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
      ...(opts.onAction ? { onAction: opts.onAction } : {}),
      ...(opts.onPointer ? { onPointer: opts.onPointer } : {}),
      timeout: opts.mode === 'dry' ? 10_000 : 20_000,
      captureTargets: opts.captureTargets ?? false,
      ...(opts.pace ? { pace: opts.pace } : {}),
      ...(opts.stepShotsDir
        ? {
            onStepDone: async (stepId: string) => {
              // Let the step's last change settle before the still.
              await page.waitForTimeout(400);
              await page.screenshot({
                path: path.join(opts.stepShotsDir!, `${stepId}.jpg`),
                type: 'jpeg',
                quality: 75,
              });
            },
          }
        : {}),
    });
    await tut.start({
      product: product.id,
      version: session.version,
      viewport: session.viewport,
      fixture: mod.fixture.folder,
      ...(opts.pace ? { paced: true } : {}),
    });
    stage('run');
    progress(`Running the script (${opts.mode})…`);
    let failure: StepFailure | null = null;
    try {
      await mod.script({ tut, page, webview: () => webview(page) });
    } catch (e) {
      if (!(e instanceof StepFailedError)) throw e;
      failure = stopped ? { ...e.failure, error: 'Stopped by user' } : e.failure;
      progress(stopped ? 'Stopped' : `Step ${failure.stepId} failed: ${failure.error}`);
    }
    const tEnd = await tut.finish();
    const screenshot = stopped ? Buffer.alloc(0) : await page.screenshot();

    let take: Take | null = null;
    if (recorder) {
      const frames = await recorder.stop();
      recorder = null;
      if (!failure) {
        stage('encode');
        progress(`Encoding the take (${frames.length} frames)…`);
        take = await encodeTake({
          frames,
          t0: tut.epoch,
          t1: tut.epoch + tEnd + 0.5,
          dir: opts.takeDir!,
          id: opts.takeId ?? path.basename(opts.takeDir!),
        });
        progress(`Take saved: ${take.width}×${take.height}, ${take.fps} fps, ${take.duration.toFixed(1)} s`);
      }
    }
    stage(stopped ? 'stopped' : failure ? 'failed' : 'done');
    progress(stopped ? 'Stopped by user' : failure ? 'Finished with a failure' : 'Passed');
    return {
      passed: !failure,
      mode: opts.mode,
      viewport: session.viewport,
      events: tut.events,
      failure,
      targetFrames: tut.targetFrames,
      take,
      screenshot,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    if (stopped) throw new Error('Stopped by user', { cause: e });
    stage('failed');
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    await recorder?.stop();
    await stopScreencast?.();
    await session.close();
    await rm(base, { recursive: true, force: true });
  }
}
