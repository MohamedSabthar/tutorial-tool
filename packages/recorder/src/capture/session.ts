import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Frame, Page } from 'playwright';
import type { CaptureAction, CaptureFrame } from '@studio/core';
import type { Progress } from '../launch/vscode';
import { startScreencast, type ScreencastFrame } from '../screencast';
import { launchFixture, waitForFixture, type ScriptFixture } from '../script';
import { toCaptureLocators } from './codegen';
import { BINDING, CAPTURE_SOURCE, FLUSH, type RawAction } from './inject';

export interface CaptureOptions {
  product?: string;
  /** Open this saved project folder instead of building the fixture (a series part's start). */
  startFrom?: string;
  /** Saves a screenshot after each action here as `<id>.png`. */
  shotsDir?: string;
  onProgress?: Progress;
  onFrame?: (f: ScreencastFrame) => void;
  /** Called with all actions so far, after each new one. */
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

/** How deep a frame is: 0 the workbench, 1 a webview's host, 2 its content (`#active-frame`). */
function depth(frame: Frame): number {
  let d = 0;
  for (let f = frame.parentFrame(); f; f = f.parentFrame()) d++;
  return d;
}

/** Where a frame's content sits in the window (CSS px), to put webview boxes in window space. */
async function offsetOf(frame: Frame): Promise<{ x: number; y: number }> {
  const el = await frame.frameElement().catch(() => null);
  const box = await el?.boundingBox().catch(() => null);
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}

/**
 * Opens the product on a fixture and captures what the user does in it: clicks, typing and key
 * presses, each with candidate locators for its target. The window stays usable (not pinned on
 * top) so the user can switch back to Studio to finish.
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
  let stopScreencast: (() => Promise<void>) | null = null;
  let closing = false;
  const cleanup = async () => {
    closing = true;
    await stopScreencast?.().catch(() => {});
    await session.close().catch(() => {});
    await rm(base, { recursive: true, force: true });
  };
  try {
    const { page } = session;
    await session.app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false))
      .catch(() => {});
    if (opts.onFrame) stopScreencast = await startScreencast(page, opts.onFrame);
    await waitForFixture(page, fixture, progress);
    if (opts.shotsDir) await mkdir(opts.shotsDir, { recursive: true });

    const actions: CaptureAction[] = [];
    const started = Date.now();
    let next = 1;
    let shots: Promise<void> = Promise.resolve();

    const screenshot = (id: string) => {
      const dir = opts.shotsDir;
      if (!dir) return;
      // After the UI has reacted, so the shot shows what the action led to.
      shots = shots
        .then(() => new Promise((r) => setTimeout(r, 500)))
        .then(async () => {
          if (closing || page.isClosed()) return;
          await writeFile(path.join(dir, `${id}.png`), await page.screenshot({ timeout: 3000 }));
        })
        .catch(() => {});
    };

    await page.exposeBinding(BINDING, async (source, raw: RawAction) => {
      if (closing) return;
      const d = depth(source.frame);
      // The webview host frame only forwards events; its content frame reports them.
      if (d === 1) return;
      const frame: CaptureFrame = d === 0 ? 'main' : 'webview';
      const id = `a${next++}`;
      const t = Math.round((Date.now() - started) / 100) / 10;
      let action: CaptureAction;
      if (raw.kind === 'press') action = { kind: 'press', id, t, key: raw.key };
      else {
        const off = frame === 'webview' ? await offsetOf(source.frame) : { x: 0, y: 0 };
        const target = {
          frame,
          label: raw.label,
          locators: toCaptureLocators(raw.locators),
          bbox: raw.bbox ? { ...raw.bbox, x: raw.bbox.x + off.x, y: raw.bbox.y + off.y } : null,
        };
        action =
          raw.kind === 'click'
            ? { kind: 'click', id, t, ...target, button: raw.button }
            : {
                kind: 'type',
                id,
                t,
                ...target,
                text: raw.text,
                clear: raw.clear,
                insert: raw.insert,
                secret: raw.secret,
              };
      }
      actions.push(action);
      opts.onChange?.([...actions]);
      screenshot(id);
    });
    await page.addInitScript(CAPTURE_SOURCE);
    const install = (f: Frame) => void f.evaluate(CAPTURE_SOURCE).catch(() => {});
    for (const f of page.frames()) install(f);
    page.on('framenavigated', install);
    page.on('close', () => {
      if (!closing) opts.onClosed?.();
    });
    progress('Capturing: use the product as you want the tutorial to go.');

    return {
      page,
      get actions() {
        return actions;
      },
      remove(ids) {
        const drop = new Set(ids);
        for (let i = actions.length - 1; i >= 0; i--) if (drop.has(actions[i]!.id)) actions.splice(i, 1);
        opts.onChange?.([...actions]);
        return [...actions];
      },
      async finish() {
        if (!page.isClosed())
          await Promise.all(
            page.frames().map((f) =>
              f
                .evaluate((name) => {
                  const fn = (window as unknown as Record<string, unknown>)[name];
                  if (typeof fn === 'function') (fn as () => void)();
                }, FLUSH)
                .catch(() => {}),
            ),
          );
        // Let the flushed typing reach the binding.
        await new Promise((r) => setTimeout(r, 200));
        await shots;
        await cleanup();
        return [...actions];
      },
      close: cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
