import { rm } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { CaptureAction } from '@studio/core';
import type { Progress } from '../launch/vscode';
import type { ScreencastFrame } from '../screencast';
import { launchFixture, waitForFixture, type ScriptFixture } from '../script';
import { attachCapture, type AttachedCapture } from './attach';

export interface CaptureOptions {
  product?: string;
  /** Open this saved project folder instead of building the fixture (a series part's start). */
  startFrom?: string;
  /** Saves the marked shot before each action and the shot after it here. */
  shotsDir?: string;
  onProgress?: Progress;
  onFrame?: (f: ScreencastFrame) => void;
  /** Called with all actions so far, after each change. */
  onChange?: (actions: CaptureAction[]) => void;
  /** The user closed the product window. */
  onClosed?: () => void;
}

export interface CaptureSession {
  page: Page;
  readonly actions: CaptureAction[];
  remove(ids: string[]): CaptureAction[];
  /** Sends any typing still in progress, then closes the product. */
  finish(): Promise<CaptureAction[]>;
  close(): Promise<void>;
}

/**
 * Opens the product on a fixture and captures what the user does in it (attachCapture). The
 * window stays usable (not pinned on top) so the user can switch back to Studio to finish.
 */
export async function openCapture(
  fixture: ScriptFixture,
  opts: CaptureOptions = {},
): Promise<CaptureSession> {
  const progress = opts.onProgress ?? (() => {});
  const { base, session } = await launchFixture(
    fixture,
    opts.product ?? 'wso2-integrator',
    progress,
    undefined,
    opts.startFrom,
  );
  let capture: AttachedCapture | null = null;
  const cleanup = async () => {
    await capture?.stop().catch(() => {});
    await session.close().catch(() => {});
    await rm(base, { recursive: true, force: true });
  };
  try {
    const { page } = session;
    await session.app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false))
      .catch(() => {});
    capture = await attachCapture(page, {
      viewport: { width: session.viewport.width, height: session.viewport.height },
      ...(opts.shotsDir ? { shotsDir: opts.shotsDir } : {}),
      ...(opts.onFrame ? { onFrame: opts.onFrame } : {}),
      ...(opts.onChange ? { onChange: opts.onChange } : {}),
      ...(opts.onClosed ? { onClosed: opts.onClosed } : {}),
    });
    await waitForFixture(page, fixture, progress);
    // Anything clicked while the project loaded isn't part of the tutorial.
    if (capture.actions.length) capture.remove(capture.actions.map((a) => a.id));
    progress('Capturing: use the product as you want the tutorial to go.');
    const c = capture;
    return {
      page,
      get actions() {
        return c.actions;
      },
      remove: (ids) => c.remove(ids),
      async finish() {
        const actions = await c.flush();
        await cleanup();
        return actions;
      },
      close: cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
