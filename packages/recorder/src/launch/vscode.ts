import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  type ProgressReport,
} from '@vscode/test-electron';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { vscodeUserSettings } from './vscodeSettings';

const run = promisify(execFile);

/** The VS Code build every tutorial is recorded with. Bump deliberately; skills record it. */
export const PINNED_VSCODE = '1.140.0';

/**
 * How the product window is shown while recording.
 * - fullscreen (default): macOS "simple" full screen, no Space switch or animation. The
 *   in-window title bar stays visible, so the product name is on camera.
 * - window: a fixed content size, e.g. 1280×720 at 1.5× for exact 1920×1080 frames.
 * `scale` is the device scale factor: larger UI text reads better on video.
 */
export type DisplayMode =
  { mode: 'fullscreen'; scale: number } | { mode: 'window'; width: number; height: number; scale: number };

export const DEFAULT_DISPLAY: DisplayMode = { mode: 'fullscreen', scale: 1.5 };

/** The resolved window content size in CSS pixels; frames are width×scale by height×scale. */
export interface Viewport {
  mode: DisplayMode['mode'];
  width: number;
  height: number;
  scale: number;
}

export type Progress = (message: string) => void;

export interface VSCodeLaunchOptions {
  /** Folder opened in VS Code. */
  fixture: string;
  /** Marketplace ids (optionally `id@version`) or paths to .vsix files. */
  extensions: string[];
  /** Launch this executable (an installed VS Code-based app) instead of the pinned download. */
  executable?: string;
  version?: string;
  /** Downloads, extensions and temporary profiles live here. Default ~/.tutorial-studio. */
  cacheDir?: string;
  display?: DisplayMode;
  /** Extra user settings merged over the seeded defaults. */
  settings?: Record<string, unknown>;
  /** Record a video of the window into this directory (frame size: `videoSize`). */
  recordVideoDir?: string;
  videoSize?: { width: number; height: number };
  onProgress?: Progress;
}

export interface VSCodeSession {
  app: ElectronApplication;
  page: Page;
  version: string;
  viewport: Viewport;
  extensionsDir: string;
  /** Native OS dialogs the app opened (these never appear in page screenshots). */
  nativeDialogs(): Promise<NativeDialog[]>;
  close(): Promise<void>;
}

export interface NativeDialog {
  kind: string;
  message?: string;
  detail?: string;
  buttons?: string[];
}

export function defaultCacheDir(): string {
  return process.env.STUDIO_CACHE ?? path.join(os.homedir(), '.tutorial-studio');
}

/** Downloads (once) and returns the path of the pinned VS Code executable. */
export async function ensureVSCode(
  version = PINNED_VSCODE,
  cacheDir = defaultCacheDir(),
  onProgress: Progress = () => {},
): Promise<string> {
  let lastPct = -1;
  const cachePath = path.join(cacheDir, 'vscode');
  await mkdir(cachePath, { recursive: true });
  return downloadAndUnzipVSCode({
    version,
    cachePath,
    reporter: {
      report(r: ProgressReport) {
        if (r.stage === 'downloading') {
          const pct = r.totalBytes ? Math.floor((r.bytesSoFar / r.totalBytes) * 100) : 0;
          if (pct >= lastPct + 10) {
            lastPct = pct;
            onProgress(`Downloading VS Code ${version}: ${pct}%`);
          }
        } else if (r.stage === 'foundMatchingInstall') onProgress(`VS Code ${version} is cached`);
        else if (r.stage === 'newInstallComplete') onProgress(`VS Code ${version} downloaded`);
        else if (r.stage === 'retrying')
          onProgress(`Download failed, retrying (${r.attempt}/${r.totalAttempts})`);
      },
      error(err: unknown) {
        onProgress(`Download error: ${String(err)}`);
      },
    },
  });
}

/**
 * Installs extensions into an isolated extensions folder keyed by the extension list, so a
 * given product setup is installed once and reused by every recording.
 */
export async function ensureExtensions(
  executable: string,
  extensions: string[],
  cacheDir = defaultCacheDir(),
  onProgress: Progress = () => {},
): Promise<string> {
  const key = extensions
    .map((e) =>
      path
        .basename(e)
        .toLowerCase()
        .replace(/[^a-z0-9.@-]+/g, '_'),
    )
    .sort()
    .join('+');
  const dir = path.join(cacheDir, 'extensions', key || 'none');
  await mkdir(dir, { recursive: true });
  const installed = (await readdir(dir)).map((n) => n.toLowerCase());
  const cli = resolveCliPathFromVSCodeExecutablePath(executable);

  for (const ext of extensions) {
    const id = ext.endsWith('.vsix') ? null : ext.split('@')[0]!.toLowerCase();
    if (id && installed.some((n) => n.startsWith(id + '-'))) continue;
    onProgress(`Installing extension ${ext}…`);
    await run(cli, ['--extensions-dir', dir, '--install-extension', ext, '--force'], {
      env: cleanEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
  }
  return dir;
}

/** Launches a fresh VS Code profile with the extensions, sized for recording. */
export async function launchVSCode(opts: VSCodeLaunchOptions): Promise<VSCodeSession> {
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const display = opts.display ?? DEFAULT_DISPLAY;
  const progress = opts.onProgress ?? (() => {});

  const executable =
    opts.executable ?? (await ensureVSCode(opts.version ?? PINNED_VSCODE, cacheDir, progress));
  // An empty, isolated extensions folder still leaves an app's built-in extensions active.
  const extensionsDir = await ensureExtensions(executable, opts.extensions, cacheDir, progress);

  // A throwaway user profile per launch keeps every recording identical.
  await mkdir(path.join(cacheDir, 'profiles'), { recursive: true });
  await sweepStaleProfiles(path.join(cacheDir, 'profiles'));
  const userDataDir = await mkdtemp(path.join(cacheDir, 'profiles', 'p-'));
  await mkdir(path.join(userDataDir, 'User'), { recursive: true });
  await writeFile(
    path.join(userDataDir, 'User', 'settings.json'),
    JSON.stringify({ ...vscodeUserSettings, ...opts.settings }, null, 2),
  );

  progress('Starting VS Code…');
  const app = await _electron.launch({
    executablePath: executable,
    args: [
      opts.fixture,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--disable-updates',
      '--disable-crash-reporter',
      '--no-cached-data',
      `--force-device-scale-factor=${display.scale}`,
    ],
    env: cleanEnv(),
    ...(opts.recordVideoDir
      ? {
          recordVideo: {
            dir: opts.recordVideoDir,
            size: opts.videoSize ?? { width: 1920, height: 1080 },
          },
        }
      : {}),
  });

  try {
    // Log native message boxes from the main process before any window can open one.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __studioDialogs?: unknown[] };
      if (g.__studioDialogs) return;
      g.__studioDialogs = [];
      for (const name of ['showMessageBox', 'showMessageBoxSync'] as const) {
        const original = dialog[name].bind(dialog) as (...a: unknown[]) => unknown;
        (dialog as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
          const o = args.find((a) => a && typeof a === 'object' && 'message' in (a as object)) as
            { message?: string; detail?: string; buttons?: string[] } | undefined;
          g.__studioDialogs!.push({
            kind: name,
            message: o?.message,
            detail: o?.detail,
            buttons: o?.buttons,
          });
          return original(...args);
        };
      }
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, d) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (d.mode === 'window') {
        win.setContentSize(d.width, d.height);
        win.center();
      } else {
        win.setSimpleFullScreen(true);
      }
      win.focus();
    }, display);
    await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
    const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    const viewport = await waitForStableSize(app, display);
    progress(
      `${path.basename(executable)} ${version} is ready (${viewport.width}×${viewport.height} @ ${viewport.scale}×)`,
    );

    return {
      app,
      page,
      version,
      viewport,
      extensionsDir,
      nativeDialogs: () =>
        app.evaluate(
          () => (globalThis as unknown as { __studioDialogs?: NativeDialog[] }).__studioDialogs ?? [],
        ),
      async close() {
        await app.close().catch(() => {});
        // Electron may still be flushing files for a moment after close.
        await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(
          () => {},
        );
      },
    };
  } catch (e) {
    await app.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** Removes profiles left behind by crashed or stopped runs (older than 10 minutes). */
async function sweepStaleProfiles(dir: string): Promise<void> {
  const cutoff = Date.now() - 10 * 60_000;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, name);
    const st = await stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) await rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

/** Waits until the window stops resizing (full screen settles asynchronously). */
async function waitForStableSize(app: ElectronApplication, display: DisplayMode): Promise<Viewport> {
  let last = '';
  for (let i = 0; i < 30; i++) {
    const [w, h] = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getContentSize() ?? [0, 0],
    );
    const key = `${w}x${h}`;
    if (key === last && w! > 0) return { mode: display.mode, width: w!, height: h!, scale: display.scale };
    last = key;
    await new Promise((r) => setTimeout(r, 200));
  }
  const [w = 0, h = 0] = last.split('x').map(Number);
  return { mode: display.mode, width: w, height: h, scale: display.scale };
}

/**
 * Environment for child VS Code processes. Variables set when the engine itself runs inside
 * VS Code (or Electron) would otherwise route the launch to the running instance.
 */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('VSCODE_') || k === 'ELECTRON_RUN_AS_NODE' || k === 'ELECTRON_NO_ATTACH_CONSOLE')
      continue;
    env[k] = v;
  }
  return env;
}
