import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import type { RecorderEvent } from '@studio/core';
import { createBIProject } from '../fixtures/biProject';
import { launchVSCode, type Progress, type Viewport } from '../launch/vscode';
import { getProduct, readAppBundle } from '../products';
import {
  StepFailedError,
  Tut,
  webview,
  type LiveAction,
  type StepFailure,
  type TargetFrame,
  type TutMode,
} from '../tut';
import { startScreencast, type ScreencastFrame } from '../screencast';

/**
 * A hand-written sample tutorial against WSO2 Integrator, used to exercise the recorder
 * helpers until the agent writes scripts (Phase 3). `broken` swaps in a wrong locator to
 * demonstrate failure reports.
 */
export async function biOverviewSample(tut: Tut, page: Page, broken = false): Promise<void> {
  await tut.step('s1', 'Show the Explorer', async () => {
    await tut.click(page.getByRole('tab', { name: /^Explorer/ }), { description: 'Explorer tab' });
  });
  await tut.step('s2', 'Open the WSO2 Integrator view', async () => {
    await tut.click(page.getByRole('tab', { name: 'WSO2 Integrator' }), {
      description: 'WSO2 Integrator tab',
    });
  });
  await tut.step('s3', 'Open the integration', async () => {
    await tut.click(page.locator('.monaco-list-row', { hasText: 'Greeting Service' }).first(), {
      description: 'Greeting Service in the project tree',
    });
  });
  await tut.step('s4', 'Describe what to build', async () => {
    await tut.type(
      webview(page).getByPlaceholder(/Describe what you want/i),
      'Create a REST API that returns a greeting',
      {
        description: 'Copilot prompt',
      },
    );
    await tut.hold(800);
  });
  await tut.step('s5', 'Choose "Add Artifact manually"', async () => {
    const button = broken
      ? webview(page).getByRole('button', { name: 'Add Artefact by hand' })
      : webview(page).getByRole('button', { name: /Add Artifact manually/i });
    await tut.click(button, { description: 'Add Artifact manually button' });
    await tut.hold(800);
  });
}

export interface SampleRunResult {
  passed: boolean;
  mode: TutMode;
  viewport: Viewport;
  events: RecorderEvent[];
  failure: StepFailure | null;
  /** The window at each click/type target, with the logged box. */
  targetFrames: TargetFrame[];
  /** PNG of the final frame. */
  screenshot: Buffer;
  durationMs: number;
}

export async function runSample(opts: {
  mode: TutMode;
  broken?: boolean;
  eventsFile?: string;
  onEvent?: (e: RecorderEvent) => void;
  onAction?: (a: LiveAction) => void;
  /** Live preview frames while the sample runs. */
  onFrame?: (f: ScreencastFrame) => void;
  onProgress?: Progress;
}): Promise<SampleRunResult> {
  const started = Date.now();
  const progress = opts.onProgress ?? (() => {});
  const product = getProduct('wso2-integrator');
  if (product.type !== 'vscode-app') throw new Error('the sample needs the installed WSO2 Integrator app');

  const base = await mkdtemp(path.join(os.tmpdir(), 'studio-sample-'));
  const fixture = path.join(base, 'greeting-project');
  await createBIProject(fixture, {
    title: 'Greeting Project',
    integrations: [{ name: 'greeting_service', title: 'Greeting Service' }],
  });
  const session = await launchVSCode({
    fixture,
    extensions: [],
    executable: readAppBundle(product.appPath).executable,
    onProgress: progress,
  });
  let stopScreencast: (() => Promise<void>) | null = null;
  try {
    const { page } = session;
    if (opts.onFrame) stopScreencast = await startScreencast(page, opts.onFrame);
    progress('Waiting for the project to load…');
    await page
      .locator('.monaco-list-row', { hasText: 'Greeting Service' })
      .first()
      .waitFor({ timeout: 45_000 });
    // The integration overview webview opens on its own; let it settle before step 1.
    await webview(page)
      .getByPlaceholder(/Describe what you want/i)
      .waitFor({ timeout: 30_000 })
      .catch(() => {});

    const tut = new Tut({
      page,
      mode: opts.mode,
      scale: session.viewport.scale,
      ...(opts.eventsFile ? { eventsFile: opts.eventsFile } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
      timeout: opts.mode === 'dry' ? 8_000 : 20_000,
      captureTargets: true,
      ...(opts.onAction ? { onAction: opts.onAction } : {}),
    });
    await tut.start({
      product: product.id,
      version: session.version,
      viewport: session.viewport,
    });
    progress(`Running the sample (${opts.mode})…`);
    let failure: StepFailure | null = null;
    try {
      await biOverviewSample(tut, page, opts.broken);
    } catch (e) {
      if (!(e instanceof StepFailedError)) throw e;
      failure = e.failure;
      progress(`Step ${failure.stepId} failed: ${failure.error}`);
    }
    await tut.finish();
    const screenshot = await page.screenshot();
    progress(failure ? 'Sample finished with a failure' : 'Sample passed');
    return {
      passed: !failure,
      mode: opts.mode,
      viewport: session.viewport,
      events: tut.events,
      failure,
      targetFrames: tut.targetFrames,
      screenshot,
      durationMs: Date.now() - started,
    };
  } finally {
    await stopScreencast?.();
    await session.close();
    await rm(base, { recursive: true, force: true });
  }
}
