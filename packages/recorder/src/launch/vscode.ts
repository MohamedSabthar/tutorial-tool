import { execFile } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
 * - window (default): a fixed 16:9 content size, so the take fills the video frame. 1440×810
 *   at 2× gives 2880×1620 frames: sharp at 1080p and under zooms, and it fits a laptop screen.
 * - fullscreen: macOS "simple" full screen at the screen's own shape (letterboxed in 16:9).
 * `scale` is the device scale factor: larger UI text reads better on video.
 */
export type DisplayMode =
  { mode: 'fullscreen'; scale: number } | { mode: 'window'; width: number; height: number; scale: number };

export const DEFAULT_DISPLAY: DisplayMode = { mode: 'window', width: 1440, height: 810, scale: 2 };

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
  /** A signed-in profile (see signin.ts) to start from instead of an empty one. */
  profile?: string;
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

/**
 * The isolated extensions folder for an installed VS Code-based app. Some apps (WSO2 Agent
 * Builder) list built-in extensions in product.json without bundling them: the user installs
 * them into the app's own extensions folder (`~/<dataFolderName>/extensions`). Those are copied
 * here, so the product loads its UI without the user's other extensions.
 */
export async function ensureAppExtensions(
  executable: string,
  cacheDir = defaultCacheDir(),
  onProgress: Progress = () => {},
  home = os.homedir(),
): Promise<string> {
  const app = path.resolve(executable, '..', '..', 'Resources', 'app');
  const product = JSON.parse(await readFile(path.join(app, 'product.json'), 'utf8')) as {
    dataFolderName?: string;
    builtInExtensions?: { name: string }[];
  };
  const bundled = new Set<string>();
  for (const name of await readdir(path.join(app, 'extensions')).catch(() => [])) {
    const pkg = path.join(app, 'extensions', name, 'package.json');
    if (!existsSync(pkg)) continue;
    const j = JSON.parse(await readFile(pkg, 'utf8')) as { publisher?: string; name?: string };
    bundled.add(`${j.publisher}.${j.name}`.toLowerCase());
  }
  const missing = (product.builtInExtensions ?? [])
    .map((e) => e.name.toLowerCase())
    .filter((id) => !bundled.has(id));
  if (!missing.length) return ensureExtensions(executable, [], cacheDir, onProgress);

  const appName = path.basename(path.resolve(executable, '..', '..', '..'), '.app');
  const source = path.join(home, product.dataFolderName ?? '.vscode', 'extensions');
  type Entry = { identifier: { id: string }; version: string; relativeLocation: string; metadata?: unknown };
  const installed = JSON.parse(
    await readFile(path.join(source, 'extensions.json'), 'utf8').catch(() => '[]'),
  ) as Entry[];
  const found = missing.map((id) => installed.find((e) => e.identifier.id.toLowerCase() === id));
  const absent = missing.filter((_, i) => !found[i]);
  if (absent.length)
    throw new Error(
      `${appName} needs ${absent.join(', ')}, which ${absent.length > 1 ? "aren't" : "isn't"} in the app or in ${source}. Install ${absent.length > 1 ? 'them' : 'it'} in ${appName} first.`,
    );

  const dir = path.join(
    cacheDir,
    'extensions',
    `app-${(product.dataFolderName ?? appName).replace(/^\.+/, '').replace(/[^a-zA-Z0-9.-]+/g, '_')}`,
  );
  await mkdir(dir, { recursive: true });
  const keep = new Set(found.map((e) => e!.relativeLocation));
  for (const name of await readdir(dir))
    if (name !== 'extensions.json' && !keep.has(name))
      await rm(path.join(dir, name), { recursive: true, force: true });
  for (const e of found) {
    if (existsSync(path.join(dir, e!.relativeLocation))) continue;
    onProgress(`Copying ${e!.identifier.id} ${e!.version} from ${appName}…`);
    await cp(path.join(source, e!.relativeLocation), path.join(dir, e!.relativeLocation), {
      recursive: true,
    });
  }
  const entries = found.map((e) => {
    const p = path.join(dir, e!.relativeLocation);
    return { ...e!, location: { $mid: 1, path: p, scheme: 'file' } };
  });
  await writeFile(path.join(dir, 'extensions.json'), JSON.stringify(entries));
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
  const extensionsDir = opts.executable
    ? await ensureAppExtensions(executable, cacheDir, progress)
    : await ensureExtensions(executable, opts.extensions, cacheDir, progress);

  // A throwaway user profile per launch keeps every recording identical.
  await mkdir(path.join(cacheDir, 'profiles'), { recursive: true });
  await sweepStaleProfiles(path.join(cacheDir, 'profiles'));
  const userDataDir = await mkdtemp(path.join(cacheDir, 'profiles', 'p-'));
  // A copy of the signed-in profile keeps the login; the settings below still replace its own.
  if (opts.profile) await copyProfile(opts.profile, userDataDir);
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
        // A window macOS sees as covered stops painting, and the take would freeze: keep it on
        // top and rendering at full rate while it records.
        win.setAlwaysOnTop(true, 'floating');
        win.webContents.setBackgroundThrottling(false);
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
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('VSCODE_') || k === 'ELECTRON_RUN_AS_NODE' || k === 'ELECTRON_NO_ATTACH_CONSOLE')
      continue;
    env[k] = v;
  }
  return env;
}

/** Caches, logs and per-folder state: not needed to stay signed in, and rebuilt on launch. */
const SKIP = new Set([
  'Cache',
  'CachedData',
  'CachedExtensionVSIXs',
  'CachedProfilesData',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'logs',
  'Backups',
  path.join('User', 'workspaceStorage'),
  path.join('User', 'History'),
]);

/** Copies a signed-in profile into a new launch's profile folder. */
export async function copyProfile(from: string, to: string): Promise<void> {
  await cp(from, to, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(from, src);
      if (SKIP.has(rel) || /(^|\/)(Singleton\w*|.*\.lock|LOCK)$/.test(rel)) return false;
      // Only folders and files: a running instance leaves IPC sockets (`*.sock`) behind.
      const st = lstatSync(src, { throwIfNoEntry: false });
      return !!st && (st.isDirectory() || st.isFile());
    },
  });
}
