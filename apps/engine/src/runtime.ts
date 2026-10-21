import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * First-run downloads of the packaged app. The app sets PLAYWRIGHT_BROWSERS_PATH (under
 * ~/.tutorial-studio); Chromium for the render host is downloaded there the first time it's
 * needed. In dev (no PLAYWRIGHT_BROWSERS_PATH) Playwright's own cache is used, as installed by
 * `npx playwright install`.
 */
export interface BrowserStatus {
  installed: boolean;
  installing: boolean;
  error: string | null;
  /** The last line of download progress. */
  progress: string | null;
}

const status: BrowserStatus = { installed: false, installing: false, error: null, progress: null };
let installing: Promise<void> | null = null;

export function chromiumInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export function browserStatus(): BrowserStatus {
  return { ...status, installed: chromiumInstalled() };
}

/** Downloads Chromium if it's missing; concurrent callers share one download. */
export function ensureChromium(log: (line: string) => void = () => {}): Promise<void> {
  if (chromiumInstalled()) return Promise.resolve();
  installing ??= new Promise<void>((resolve, reject) => {
    status.installing = true;
    status.error = null;
    const cli = path.join(
      path.dirname(createRequire(import.meta.url).resolve('playwright/package.json')),
      'cli.js',
    );
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (b: Buffer) => {
      for (const line of b.toString().split(/[\r\n]+/)) {
        const l = line.trim();
        if (!l) continue;
        status.progress = l;
        log(l);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 && chromiumInstalled()
        ? resolve()
        : reject(new Error(`Chromium download failed (${status.progress ?? `exit ${code}`})`)),
    );
  })
    .catch((e: unknown) => {
      status.error = e instanceof Error ? e.message : String(e);
      throw e;
    })
    .finally(() => {
      status.installing = false;
      installing = null;
    });
  return installing;
}
