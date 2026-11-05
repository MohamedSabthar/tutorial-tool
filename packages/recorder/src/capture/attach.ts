import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Frame, Page } from 'playwright';
import type { CaptureAction, CaptureFrame } from '@studio/core';
import { startScreencast, type ScreencastFrame } from '../screencast';
import { toCaptureLocators } from './codegen';
import { BINDING, CAPTURE_SOURCE, FLUSH, type RawAction, type RawTarget } from './inject';
import { writeMarkedShot } from './marks';

export interface AttachOptions {
  /** The window's size in CSS pixels (for marking shots). */
  viewport: { width: number; height: number };
  /** Saves the marked shot before each action (`<id>-marked.jpg`) and the shot after it (`<id>.png`). */
  shotsDir?: string;
  onFrame?: (f: ScreencastFrame) => void;
  /** Called with all actions so far, after each change. */
  onChange?: (actions: CaptureAction[]) => void;
  /** The page was closed (the user closed the product window). */
  onClosed?: () => void;
}

export interface AttachedCapture {
  readonly actions: CaptureAction[];
  remove(ids: string[]): CaptureAction[];
  /** Sends typing and keys still in progress and waits for the shots; returns every action. */
  flush(): Promise<CaptureAction[]>;
  /** Stops listening (the page stays open). */
  stop(): Promise<void>;
}

/** How deep a frame is: 0 the workbench, 1 a webview's host, 2 its content (`#active-frame`). */
function depth(frame: Frame): number {
  let d = 0;
  for (let f = frame.parentFrame(); f; f = f.parentFrame()) d++;
  return d;
}

/** Where a frame's content sits in the window (CSS px), to put webview boxes in window space. */
async function offsetOf(frame: Frame): Promise<{ x: number; y: number }> {
  // The frame element's box is already in the window's coordinates, even for a nested frame.
  const el = await frame.frameElement().catch(() => null);
  const box = await el?.boundingBox().catch(() => null);
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}

/**
 * Captures what the user does in a page and its frames: clicks, typing, keys, hovers, scrolls
 * and drags, each with candidate locators for its target and a marked shot of the screen just
 * before it. The product launcher (openCapture) attaches it to the product window; tests attach
 * it to a plain browser page.
 */
export async function attachCapture(page: Page, opts: AttachOptions): Promise<AttachedCapture> {
  let closing = false;
  // The newest frame is the screen just before an action arrives: it becomes the marked shot.
  let lastFrame: ScreencastFrame | null = null;
  const stopScreencast = await startScreencast(page, (f) => {
    lastFrame = f;
    opts.onFrame?.(f);
  });
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

  const viewport = opts.viewport;
  let marks: Promise<void> = Promise.resolve();
  /** Marks the frame from before the action: its target boxed, the pointer as a dot. */
  const markShot = (a: CaptureAction, frame: ScreencastFrame | null) => {
    const dir = opts.shotsDir;
    if (!dir) return;
    const box = 'bbox' in a ? a.bbox : null;
    const point = 'point' in a ? a.point : null;
    const name = `${a.id}-marked.jpg`;
    // No frame yet when nothing has painted since the capture began: take one now (the action
    // may already show, but the target and the pointer are still marked).
    const data = frame
      ? Promise.resolve(frame.data)
      : page.screenshot({ type: 'jpeg', quality: 70, timeout: 3000 }).then((b) => b.toString('base64'));
    marks = marks
      .then(async () => writeMarkedShot(await data, path.join(dir, name), { box, point, viewport }))
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
    // Typing in one frame is sent when its field loses focus, which happens after the press
    // that moved focus to another frame: put it back before that click.
    const prevClick = actions.at(-1);
    if (
      action.kind === 'type' &&
      prevClick?.kind === 'click' &&
      prevClick.frame !== action.frame &&
      action.t - prevClick.t <= 0.5
    )
      actions.splice(actions.length - 1, 0, action);
    else actions.push(action);
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
  page.on('close', () => {
    if (!closing) opts.onClosed?.();
  });

  return {
    get actions() {
      return actions;
    },
    remove(ids) {
      const drop = new Set(ids);
      for (let i = actions.length - 1; i >= 0; i--) if (drop.has(actions[i]!.id)) actions.splice(i, 1);
      opts.onChange?.([...actions]);
      return [...actions];
    },
    async flush() {
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
      return [...actions];
    },
    async stop() {
      closing = true;
      await stopScreencast().catch(() => {});
    },
  };
}
