import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { getProduct, readAppBundle } from '../products';
import {
  cleanEnv,
  defaultCacheDir,
  ensureExtensions,
  ensureVSCode,
  PINNED_VSCODE,
  type Progress,
} from './vscode';

/**
 * Signed-in product profiles. Recordings start from a throwaway profile so every take is the
 * same; products that need an account (WSO2 sign-in, AI features) would then start signed out.
 * The user signs in once in a window opened on `~/.tutorial-studio/signin/<product>`, and every
 * launch after that starts from a fresh copy of it (without its caches).
 */
export function signInDir(productId: string, cacheDir = defaultCacheDir()): string {
  return path.join(cacheDir, 'signin', productId);
}

export interface SignInStatus {
  product: string;
  /** A profile exists (the user has opened the sign-in window at least once). */
  saved: boolean;
  /** When the profile last changed (ms), or null. */
  updatedAt: number | null;
  /** The sign-in window is open: launches wait until it's closed. */
  open: boolean;
}

/** Open sign-in windows by product. */
const windows = new Map<string, ChildProcess>();

export async function signInStatus(productId: string, cacheDir = defaultCacheDir()): Promise<SignInStatus> {
  const dir = signInDir(productId, cacheDir);
  const s = await stat(path.join(dir, 'User')).catch(() => null);
  return {
    product: productId,
    saved: !!s,
    updatedAt: s ? Math.round(s.mtimeMs) : null,
    open: windows.has(productId),
  };
}

/** The profile to launch `productId` from, or undefined. Throws while its sign-in window is open. */
export function signedInProfile(productId: string, cacheDir = defaultCacheDir()): string | undefined {
  if (windows.has(productId))
    throw new Error(
      'Close the product window you opened to sign in first: recordings start from that profile.',
    );
  const dir = signInDir(productId, cacheDir);
  return existsSync(path.join(dir, 'User')) ? dir : undefined;
}

/**
 * Opens the product on its sign-in profile, as an ordinary window (not under automation), so
 * the user can sign in. Resolves once it has started; `closed` resolves when the user quits it.
 */
export async function openSignIn(
  productId: string,
  opts: { cacheDir?: string; onProgress?: Progress } = {},
): Promise<{ closed: Promise<void> }> {
  if (windows.has(productId)) throw new Error('The sign-in window is already open.');
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const progress = opts.onProgress ?? (() => {});
  const product = getProduct(productId);
  const executable =
    product.type === 'vscode-app'
      ? readAppBundle(product.appPath).executable
      : await ensureVSCode(PINNED_VSCODE, cacheDir, progress);
  // The same extensions folder recordings use, so the extension's sign-in carries over.
  const extensionsDir = await ensureExtensions(
    executable,
    product.type === 'vscode-app' ? [] : product.extensions,
    cacheDir,
    progress,
  );
  const dir = signInDir(productId, cacheDir);
  await mkdir(dir, { recursive: true });
  progress(`Opening ${product.name} to sign in…`);
  const child = spawn(
    executable,
    [
      `--user-data-dir=${dir}`,
      `--extensions-dir=${extensionsDir}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      '--new-window',
    ],
    { env: cleanEnv(), stdio: 'ignore' },
  );
  windows.set(productId, child);
  const closed = new Promise<void>((resolve) =>
    child.once('exit', () => {
      windows.delete(productId);
      resolve();
    }),
  );
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', (e) => {
      windows.delete(productId);
      reject(e);
    });
  });
  return { closed };
}

/** Forgets the signed-in profile (the next launches start signed out). */
export async function signOut(productId: string, cacheDir = defaultCacheDir()): Promise<void> {
  if (windows.has(productId)) throw new Error('Close the sign-in window first.');
  await rm(signInDir(productId, cacheDir), { recursive: true, force: true });
}
