import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Frame, Page } from 'playwright';
import type { CaptureAction, CaptureFrame } from '@studio/core';
import type { Progress } from '../launch/vscode';
import { startScreencast, type ScreencastFrame } from '../screencast';
import { launchFixture, waitForFixture, type ScriptFixture } from '../script';
import { toCaptureLocators } from './codegen';
import { BINDING, CAPTURE_SOURCE, FLUSH, type RawAction, type RawTarget } from './inject';
import { writeMarkedShot } from './marks';

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
    // The newest frame is the screen just before an action arrives: it becomes the marked shot.
    let lastFrame: ScreencastFrame | null = null;
    stopScreencast = await startScreencast(page, (f) => {
      lastFrame = f;
      opts.onFrame?.(f);
    });
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

    const viewport = { width: session.viewport.width, height: session.viewport.height };
    let marks: Promise<void> = Promise.resolve();
    /** Marks the frame from before the action: its target boxed, the pointer as a dot. */
    const markShot = (a: CaptureAction, frame: ScreencastFrame | null) => {
      const dir = opts.shotsDir;
      if (!dir || !frame) return;
      const box = 'bbox' in a ? a.bbox : null;
      const point = 'point' in a ? a.point : null;
      const name = `${a.id}-marked.jpg`;
      marks = marks
        .then(() => writeMarkedShot(frame.data, path.join(dir, name), { box, point, viewport }))
        .then(() => {
          // By id: a click may have become a drag (a new object) since.
          const cur = actions.find((x) => x.id === a.id);
          if (cur) cur.shot = name;
          if (!closing) opts.onChange?.([...actions]);
        })
        .catch(() => {});
    };

    await page.exposeBinding(BINDING, async (source, raw: RawAction) => {
      if (closing) return;
      const before = lastFrame;
      const d = depth(source.frame);
      // The webview host frame only forwards events; its content frame reports them.
      if (d === 1) return;
      const frame: CaptureFrame = d === 0 ? 'main' : 'webview';
      const off = frame === 'webview' ? await offsetOf(source.frame) : { x: 0, y: 0 };
      const pt = (p: { x: number; y: number }) => ({ x: p.x + off.x, y: p.y + off.y });
      const targetOf = (r: RawTarget) => ({
        frame,
        label: r.label,
        locators: toCaptureLocators(r.locators),
        bbox: r.bbox ? { ...r.bbox, ...pt(r.bbox) } : null,
      });
      const last = actions.at(-1);

      // Follow-ups that change the click just captured rather than add an action.
      if (raw.kind === 'dblclick') {
        const prev = actions.at(-2);
        if (last?.kind !== 'click') return;
        if (
          prev?.kind === 'click' &&
          prev.locators[0]?.code === last.locators[0]?.code &&
          last.t - prev.t < 1
        ) {
          actions.pop();
          prev.double = true;
        } else last.double = true;
        opts.onChange?.([...actions]);
        return;
      }
      if (raw.kind === 'dragend') {
        if (last?.kind !== 'click') return;
        actions[actions.length - 1] = {
          kind: 'drag',
          id: last.id,
          t: last.t,
          shot: last.shot,
          frame: last.frame,
          label: last.label,
          locators: last.locators,
          bbox: last.bbox,
          point: last.point,
          to: targetOf(raw.to),
          toPoint: pt(raw.point),
        };
        opts.onChange?.([...actions]);
        return;
      }

      const id = `a${next++}`;
      const t = Math.round((Date.now() - started) / 100) / 10;
      const base = { id, t, shot: null };
      let action: CaptureAction;
      switch (raw.kind) {
        case 'press':
          action = { kind: 'press', ...base, key: raw.key };
          break;
        case 'keys':
          action = { kind: 'keys', ...base, text: raw.text };
          break;
        case 'click':
          action = {
            kind: 'click',
            ...base,
            ...targetOf(raw),
            point: pt(raw.point),
            button: raw.button,
            double: false,
          };
          break;
        case 'hover':
          action = { kind: 'hover', ...base, ...targetOf(raw), point: pt(raw.point) };
          break;
        case 'scroll':
          action = {
            kind: 'scroll',
            ...base,
            ...targetOf(raw),
            point: pt(raw.point),
            dx: raw.dx,
            dy: raw.dy,
          };
          break;
        case 'type':
          action = {
            kind: 'type',
            ...base,
            ...targetOf(raw),
            text: raw.text,
            clear: raw.clear,
            insert: raw.insert,
            secret: raw.secret,
          };
          break;
      }
      actions.push(action);
      opts.onChange?.([...actions]);
      markShot(action, before);
      // What it led to; a hover or scroll shows its effect in the next action's shot.
      if (action.kind !== 'hover' && action.kind !== 'scroll') screenshot(id);
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
        await marks;
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
