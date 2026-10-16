import { rm } from 'node:fs/promises';
import type { FrameLocator, Locator, Page } from 'playwright';
import type { Progress } from './launch/vscode';
import { startScreencast, type ScreencastFrame } from './screencast';
import { launchFixture, waitForFixture, type ScriptFixture, type ScriptModule } from './script';
import { StepFailedError, Tut, webview, type StepFailure } from './tut';

export interface ProbeMatch {
  visible: boolean;
  text: string;
  box: { x: number; y: number; w: number; h: number } | null;
}

export interface ProbeResult {
  probe: string;
  count: number;
  /** The first few matches. */
  matches: ProbeMatch[];
  error?: string;
}

export interface InspectSnapshot {
  /** PNG of the window. */
  screenshot: Buffer;
  ariaSnapshot: string;
  webviewAriaSnapshot: string;
}

export interface Inspector {
  page: Page;
  /** Steps of the script that completed while replaying. */
  completedSteps: string[];
  /** Set when replaying stopped early because a step failed. */
  failure: StepFailure | null;
  /** Runs Playwright statements with `page`, `webview()` and `tut` in scope. */
  run(code: string, timeoutMs?: number): Promise<{ ok: boolean; error?: string }>;
  probe(exprs: string[]): Promise<ProbeResult[]>;
  snapshot(): Promise<InspectSnapshot>;
  close(): Promise<void>;
}

export interface InspectOptions {
  product?: string;
  /** Replay the script's steps before this one (dry-run pace), then stop. "all" replays everything. */
  uptoStep?: string;
  onProgress?: Progress;
  onFrame?: (f: ScreencastFrame) => void;
}

class ReachedStep extends Error {}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

/** px → frame pixels, matching recorder events and step targets. */
async function boxOf(l: Locator, scale: number) {
  const b = await l.boundingBox({ timeout: 1000 }).catch(() => null);
  if (!b) return null;
  const r = (n: number) => Math.round(n * scale);
  return { x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height) };
}

/**
 * Opens the product on a script's fixture and keeps it open for research: replay the script up
 * to a step, run ad-hoc actions, probe candidate locators and read ARIA snapshots. Used by the
 * agent's `inspect_ui` tool when a script fails after a UI change.
 */
export async function openInspector(
  mod: { fixture: ScriptFixture; script?: ScriptModule['script'] },
  opts: InspectOptions = {},
): Promise<Inspector> {
  const progress = opts.onProgress ?? (() => {});
  const { base, session } = await launchFixture(mod.fixture, opts.product ?? 'wso2-integrator', progress);
  let stopScreencast: (() => Promise<void>) | null = null;
  try {
    const { page } = session;
    if (opts.onFrame) stopScreencast = await startScreencast(page, opts.onFrame);
    await waitForFixture(page, mod.fixture, progress);
    const tut = new Tut({ page, mode: 'dry', scale: session.viewport.scale, timeout: 10_000 });
    await tut.start({
      product: opts.product ?? 'wso2-integrator',
      version: session.version,
      viewport: session.viewport,
      fixture: mod.fixture.folder,
    });

    const completedSteps: string[] = [];
    let failure: StepFailure | null = null;
    if (opts.uptoStep && mod.script) {
      progress(
        opts.uptoStep === 'all' ? 'Replaying the script…' : `Replaying the script up to ${opts.uptoStep}…`,
      );
      const step = tut.step.bind(tut);
      tut.step = async (id, title, fn) => {
        if (id === opts.uptoStep) throw new ReachedStep();
        await step(id, title, fn);
        completedSteps.push(id);
      };
      try {
        await mod.script({ tut, page, webview: () => webview(page) });
      } catch (e) {
        if (e instanceof StepFailedError) failure = e.failure;
        else if (!(e instanceof ReachedStep)) throw e;
      }
      tut.step = step;
    }

    const scale = session.viewport.scale;
    return {
      page,
      completedSteps,
      failure,
      async run(code, timeoutMs = 30_000) {
        try {
          const fn = new AsyncFunction('page', 'webview', 'tut', code);
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            fn(page, () => webview(page), tut),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
            }),
          ]).finally(() => clearTimeout(timer));
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) };
        }
      },
      async probe(exprs) {
        const out: ProbeResult[] = [];
        for (const probe of exprs) {
          try {
            const make = new Function('page', 'webview', `return (${probe});`) as (
              p: Page,
              w: () => FrameLocator,
            ) => Locator;
            const l = make(page, () => webview(page));
            if (!l || typeof l.count !== 'function')
              throw new Error('the expression is not a Playwright locator');
            const count = await l.count();
            const matches: ProbeMatch[] = [];
            for (let i = 0; i < Math.min(count, 3); i++) {
              const m = l.nth(i);
              matches.push({
                visible: await m.isVisible().catch(() => false),
                text: ((await m.textContent({ timeout: 1000 }).catch(() => '')) ?? '').trim().slice(0, 120),
                box: await boxOf(m, scale),
              });
            }
            out.push({ probe, count, matches });
          } catch (e) {
            out.push({
              probe,
              count: 0,
              matches: [],
              error: (e instanceof Error ? e.message : String(e)).split('\n')[0]!,
            });
          }
        }
        return out;
      },
      async snapshot() {
        return {
          screenshot: await page.screenshot(),
          ariaSnapshot: await page
            .locator('body')
            .ariaSnapshot({ timeout: 5000 })
            .catch(() => ''),
          webviewAriaSnapshot: await webview(page)
            .locator('body')
            .ariaSnapshot({ timeout: 3000 })
            .catch(() => ''),
        };
      },
      async close() {
        await stopScreencast?.().catch(() => {});
        await session.close().catch(() => {});
        await rm(base, { recursive: true, force: true });
      },
    };
  } catch (e) {
    await stopScreencast?.().catch(() => {});
    await session.close().catch(() => {});
    await rm(base, { recursive: true, force: true });
    throw e;
  }
}
