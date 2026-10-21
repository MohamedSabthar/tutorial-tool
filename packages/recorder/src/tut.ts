import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FrameLocator, Locator, Page } from 'playwright';
import { findCue, lineDelay, type Pace, type Rect, type RecorderEvent, type StepPace } from '@studio/core';
import { clickPoint, mousePath, moveDuration, rng, typingDelays, type Pt } from './human';

/**
 * The API generated tutorial scripts call. Every helper performs the action on screen at a
 * human pace (in record mode) and logs what happened to events.jsonl: steps, mouse paths,
 * clicks, typing and target boxes. The cursor is drawn later by the compositor from these
 * events, never injected into the product.
 *
 * Dry mode runs the same script fast, with no pauses, to validate it before recording.
 *
 * With a `pace` (voice-first recording), each step lasts at least its voice line, and an action
 * with a cue (`tut.cue(word)`, or the `cue` option) waits so that it lands as the word is spoken.
 * Dry runs only check that every cue is in its step's narration.
 */
export type TutMode = 'dry' | 'record';

export interface TutOptions {
  page: Page;
  mode: TutMode;
  /** Device scale factor: CSS pixels × scale = frame pixels. */
  scale: number;
  /** Where events.jsonl is written; omit to keep events in memory only. */
  eventsFile?: string;
  /** Called for every event as it happens (live view). */
  onEvent?: (e: RecorderEvent) => void;
  /** Typing speed in characters per second (record mode). */
  cps?: number;
  /** Seed for pointer paths and typing rhythm. */
  seed?: number;
  /** Per-action timeout in ms. */
  timeout?: number;
  /** Keep a screenshot of the window each time a click/type target is located (for review). */
  captureTargets?: boolean;
  /** Called when an action's target is located, before the action runs (live view). */
  onAction?: (a: LiveAction) => void;
  /** Called as the pointer moves and clicks, in frame pixels (live cursor). */
  onPointer?: (p: { x: number; y: number; click: boolean }) => void;
  /** The voiced narration to pace steps and cues to. */
  pace?: Pace;
}

export interface LiveAction {
  stepId: string;
  kind: 'click' | 'type';
  /** What the script is doing, e.g. `tut.type(Copilot prompt, "…")`. */
  label: string;
  /** Frame-pixel box of the target. */
  bbox: Rect;
}

export interface TargetFrame {
  stepId: string;
  target: string;
  /** Frame-pixel box of the target, as logged. */
  bbox: Rect;
  png: Buffer;
}

export interface StepFailure {
  stepId: string;
  title: string;
  error: string;
  /** The full error, including Playwright's call log (what it waited for and saw). */
  errorDetail: string;
  /** PNG of the window at the moment of failure. */
  screenshot: Buffer;
  /** Playwright ARIA snapshot of the window (YAML). */
  ariaSnapshot: string;
  /** ARIA snapshot of the active webview (WSO2 Integrator's visual editors), if any. */
  webviewAriaSnapshot: string;
}

export class StepFailedError extends Error {
  override name = 'StepFailedError';
  constructor(readonly failure: StepFailure) {
    super(`step "${failure.stepId}" (${failure.title}) failed: ${failure.error}`);
  }
}

type Target = Locator;

export class Tut {
  readonly events: RecorderEvent[] = [];
  readonly targetFrames: TargetFrame[] = [];
  private readonly started = performance.now();
  /** Wall-clock time (epoch seconds) of event time 0, on the same clock as screencast frames. */
  readonly epoch = Date.now() / 1000;
  private readonly random: () => number;
  private pointer: Pt;
  private current: { id: string; title: string } | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Text being typed while type() runs its click, so the live label says "type". */
  private typing: string | null = null;
  /** The current step's voice line (paced runs): when it starts, and the next word a cue may match. */
  private line: { pace: StepPace; start: number; next: number } | null = null;
  /** Set by cue(): the next click or key press waits for it. */
  private pendingCue: string | null = null;
  /** Event time of the latest click, typing or key press. */
  private lastAction = -Infinity;

  constructor(private readonly opts: TutOptions) {
    this.random = rng(opts.seed ?? 7);
    const vp = opts.page.viewportSize();
    this.pointer = { x: (vp?.width ?? 1200) / 2, y: (vp?.height ?? 800) / 2 };
  }

  get mode(): TutMode {
    return this.opts.mode;
  }

  /** Seconds since the run started. */
  now(): number {
    return Math.round(((performance.now() - this.started) / 1000) * 1000) / 1000;
  }

  /** Writes the header marker. Call once before the first step. */
  async start(meta: Record<string, unknown> = {}): Promise<void> {
    if (this.opts.eventsFile) {
      await mkdir(path.dirname(this.opts.eventsFile), { recursive: true });
      await writeFile(this.opts.eventsFile, '');
    }
    await this.emit({
      kind: 'marker',
      t: this.now(),
      name: 'start',
      data: { mode: this.opts.mode, scale: this.opts.scale, ...meta },
    });
  }

  /** Writes the end marker and returns event time at the end. */
  async finish(): Promise<number> {
    const t = this.now();
    await this.emit({ kind: 'marker', t, name: 'end' });
    await this.writing;
    return t;
  }

  /** A named tutorial step. Failures are reported with a screenshot and ARIA snapshot. */
  async step(id: string, title: string, fn: () => Promise<void>): Promise<void> {
    this.current = { id, title };
    const t0 = this.now();
    const pace = this.opts.pace;
    const line = pace?.steps[id];
    this.line =
      pace && line ? { pace: line, start: t0 + lineDelay(pace, t0 - this.lastAction), next: 0 } : null;
    this.pendingCue = null;
    await this.emit({ kind: 'step-start', t: t0, stepId: id, title });
    try {
      await fn();
      // The step lasts until its line has been spoken, plus a short tail.
      if (pace && this.line) await this.until(this.line.start + this.line.pace.duration + pace.tail);
    } catch (e) {
      if (e instanceof StepFailedError) throw e;
      const page = this.opts.page;
      const screenshot = await page.screenshot().catch(() => Buffer.alloc(0));
      const ariaSnapshot = await page
        .locator('body')
        .ariaSnapshot({ timeout: 5000 })
        .catch(() => '');
      const webviewAriaSnapshot = await webview(page)
        .locator('body')
        .ariaSnapshot({ timeout: 3000 })
        .catch(() => '');
      throw new StepFailedError({
        stepId: id,
        title,
        error: e instanceof Error ? e.message.split('\n')[0]! : String(e),
        errorDetail: (e instanceof Error ? e.message : String(e)).slice(0, 3000),
        screenshot,
        ariaSnapshot,
        webviewAriaSnapshot,
      });
    }
    await this.emit({ kind: 'step-end', t: this.now(), stepId: id });
    this.current = null;
    this.line = null;
  }

  /**
   * Makes the next click, typing or key press land on `word` (a word or short phrase of the
   * step's narration), e.g. before a page object call. Cues within a step follow the narration's
   * order. Without a pace it does nothing.
   */
  cue(word: string): void {
    this.stepId();
    this.planCue(word);
    this.pendingCue = word;
  }

  /** Moves to the target along a human path and clicks it. `cue` lands the click on that narration word. */
  async click(target: Target, opts: { description?: string; cue?: string } = {}): Promise<void> {
    const stepId = this.stepId();
    const cue = this.takeCue(opts.cue);
    const box = await this.boxOf(target, opts.description);
    this.opts.onAction?.({
      stepId,
      kind: this.typing === null ? 'click' : 'type',
      label:
        this.typing === null
          ? `tut.click(${opts.description ?? describe(target)})`
          : `tut.type(${opts.description ?? describe(target)}, "${this.typing}")`,
      bbox: this.rect(box),
    });
    if (this.opts.captureTargets)
      this.targetFrames.push({
        stepId,
        target: opts.description ?? describe(target),
        bbox: this.rect(box),
        png: await this.opts.page.screenshot(),
      });
    const p = clickPoint(box, this.random);
    // A cued click moves faster when its word comes soon, then waits on the target for it.
    let ms: number | undefined;
    if (cue) {
      ms = Math.max(MIN_MOVE_MS, Math.min(moveDuration(this.pointer, p), (cue.at - this.now()) * 1000));
      await this.until(cue.at - ms / 1000);
    }
    await this.moveTo(p, ms);
    if (cue) await this.until(cue.at);
    await this.opts.page.mouse.click(p.x, p.y);
    this.opts.onPointer?.({ x: this.px(p.x), y: this.px(p.y), click: true });
    await this.emit({
      kind: 'click',
      t: this.now(),
      stepId,
      x: this.px(p.x),
      y: this.px(p.y),
      target: opts.description ?? describe(target),
      bbox: this.rect(box),
      ...(cue ? { cue } : {}),
    });
    await this.pause(350);
  }

  /** Clicks the field, then types at a human pace. */
  /**
   * Clicks the field, then types at a human pace. `insert` enters the text in one go (for
   * code editors whose auto-closing brackets/quotes would garble key-by-key typing).
   */
  async type(
    target: Target,
    text: string,
    opts: { description?: string; clear?: boolean; insert?: boolean; cue?: string } = {},
  ): Promise<void> {
    const stepId = this.stepId();
    this.typing = text;
    try {
      await this.click(target, opts);
    } finally {
      this.typing = null;
    }
    const box = await this.boxOf(target, opts.description);
    if (opts.clear) {
      await this.opts.page.keyboard.press('Meta+A');
      await this.opts.page.keyboard.press('Backspace');
    }
    const t = this.now();
    if (this.opts.mode === 'dry' || opts.insert) await this.opts.page.keyboard.insertText(text);
    else {
      const delays = typingDelays(text, this.opts.cps ?? 14, this.random);
      for (const [i, ch] of [...text].entries()) {
        await this.opts.page.keyboard.type(ch);
        await sleep(delays[i]!);
      }
    }
    await this.emit({
      kind: 'type',
      t,
      stepId,
      text,
      target: opts.description ?? describe(target),
      bbox: this.rect(box),
    });
    await this.pause(300);
  }

  /** Presses a key or chord, e.g. "Enter" or "Meta+Shift+P". `cue` lands it on that narration word. */
  async press(key: string, opts: { cue?: string } = {}): Promise<void> {
    const stepId = this.stepId();
    const cue = this.takeCue(opts.cue);
    if (cue) await this.until(cue.at);
    await this.opts.page.keyboard.press(key);
    await this.emit({ kind: 'key', t: this.now(), stepId, key, ...(cue ? { cue } : {}) });
    await this.pause(250);
  }

  /** Holds still so the viewer can take something in (skipped in dry runs). */
  async hold(ms: number): Promise<void> {
    if (this.opts.mode === 'record') await sleep(ms);
    await this.emit({ kind: 'hold', t: this.now(), stepId: this.stepId(), duration: ms / 1000 });
  }

  /** Marks an area to blur in post (secrets, emails, machine-specific paths). */
  async mask(target: Target, label: string): Promise<void> {
    const box = await this.boxOf(target);
    await this.emit({ kind: 'mask', t: this.now(), label, bbox: this.rect(box) });
  }

  /** Waits until the target is visible, e.g. a view that loads slowly. */
  async waitFor(target: Target, timeout = this.opts.timeout ?? 20_000): Promise<void> {
    await target.first().waitFor({ state: 'visible', timeout });
  }

  // -------------------------------------------------------------------------

  private stepId(): string {
    if (!this.current) throw new Error('tut actions must run inside tut.step()');
    return this.current.id;
  }

  /** The action's cue (its own, or a pending tut.cue), planned in event time; null when unpaced. */
  private takeCue(own: string | undefined): { word: string; at: number } | null {
    const word = own ?? this.pendingCue;
    this.pendingCue = null;
    if (!word) return null;
    const planned = this.planCue(word);
    if (!planned || !this.line) return null;
    this.line.next = planned.index + 1;
    return { word, at: Math.round((this.line.start + planned.start) * 1000) / 1000 };
  }

  /** Finds a cue in the current step's line; throws when it isn't there. */
  private planCue(word: string): { index: number; start: number } | null {
    if (!this.line) return null;
    const { words, text } = this.line.pace;
    const index = findCue(words, word, this.line.next);
    if (index < 0)
      throw new Error(
        `cue "${word}" is not in the narration of step ${this.current?.id}${this.line.next ? ' after the previous cue' : ''}: "${text}"`,
      );
    return { index, start: words[index]!.start };
  }

  /** Record mode: waits until event time `t` (returns at once if it has passed). */
  private async until(t: number): Promise<void> {
    if (this.opts.mode !== 'record') return;
    const ms = (t - this.now()) * 1000;
    if (ms > 1) await sleep(ms);
  }

  private async boxOf(target: Target, description?: string) {
    const loc = target.first();
    const timeout = this.opts.timeout ?? 20_000;
    try {
      await loc.waitFor({ state: 'visible', timeout });
    } catch {
      throw new Error(
        `${description ?? describe(target)} was not visible within ${timeout / 1000} s (${describe(target)})`,
      );
    }
    await loc.scrollIntoViewIfNeeded({ timeout });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`${describe(target)} has no bounding box`);
    return box;
  }

  private async moveTo(p: Pt, durationMs?: number): Promise<void> {
    const mouse = this.opts.page.mouse;
    if (this.opts.mode === 'dry') {
      await mouse.move(p.x, p.y);
      this.opts.onPointer?.({ x: this.px(p.x), y: this.px(p.y), click: false });
      this.pointer = p;
      return;
    }
    const path = mousePath(this.pointer, p, this.random, durationMs);
    const t0 = this.now();
    const samples: [number, number, number][] = [];
    for (const [i, q] of path.entries()) {
      await mouse.move(q.x, q.y);
      if (i % 2 === 1 || i === path.length - 1)
        this.opts.onPointer?.({ x: this.px(q.x), y: this.px(q.y), click: false });
      samples.push([Math.round((t0 + (i * 16) / 1000) * 1000) / 1000, this.px(q.x), this.px(q.y)]);
      // On the clock, so the move takes its planned time however long each mouse.move takes.
      await this.until(t0 + ((i + 1) * 16) / 1000);
    }
    this.pointer = p;
    await this.emit({ kind: 'mouse', t: t0, points: samples });
  }

  private async pause(ms: number): Promise<void> {
    if (this.opts.mode === 'record') await sleep(ms);
  }

  private px(v: number): number {
    return Math.round(v * this.opts.scale * 10) / 10;
  }

  private rect(b: { x: number; y: number; width: number; height: number }): Rect {
    return { x: this.px(b.x), y: this.px(b.y), w: this.px(b.width), h: this.px(b.height) };
  }

  private async emit(e: RecorderEvent): Promise<void> {
    if (e.kind === 'click' || e.kind === 'type' || e.kind === 'key')
      this.lastAction = Math.max(this.lastAction, e.t);
    this.events.push(e);
    this.opts.onEvent?.(e);
    if (this.opts.eventsFile) {
      const file = this.opts.eventsFile;
      this.writing = this.writing.then(() => appendFile(file, JSON.stringify(e) + '\n'));
      await this.writing;
    }
  }
}

/** The active VS Code webview's content frame (WSO2 Integrator's visual editors live here). */
export function webview(page: Page): FrameLocator {
  return page.frameLocator('iframe.webview.ready').first().frameLocator('#active-frame');
}

function describe(target: Target): string {
  const s = String(target);
  return s.replace(/^Locator@/, '').slice(0, 200);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Shortest pointer move a cued click hurries to. */
const MIN_MOVE_MS = 150;
