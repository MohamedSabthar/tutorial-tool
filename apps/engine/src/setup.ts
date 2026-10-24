import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClaudeSignIn, SetupItem } from '@studio/core';
import { claudeEnv, type ClaudeChoice } from './agent/session';
import { findClaude, INSTALL_CLAUDE } from './claudeCode';
import type { ProjectStore } from './projects';
import type { ProductsRegistry } from './productsFile';
import { browserStatus } from './runtime';
import type { TtsService } from './tts';
import type { Workspace } from './workspace';

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<{ code: number; out: string }>((resolve) =>
    execFile(cmd, args, { env, timeout: 20_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    ),
  );

/** The last sign-in check this session (the checklist shows it; null until the user checks). */
let lastSignIn: ClaudeSignIn | null = null;

/**
 * `claude auth status`, run with the agent's environment, so it reports the login the agent
 * will use (its CLAUDE_CONFIG_DIR). Reading it may touch the login keychain item, so it only
 * runs when the user asks.
 */
export async function claudeSignIn(choice: ClaudeChoice | null = null): Promise<ClaudeSignIn> {
  const env = claudeEnv(choice) as NodeJS.ProcessEnv;
  const executable = choice?.executable ?? (await findClaude());
  if (!executable)
    return (lastSignIn = {
      loggedIn: false,
      method: null,
      account: null,
      configDir: null,
      error: INSTALL_CLAUDE,
    });
  const { code, out } = await run(executable, ['auth', 'status'], env);
  try {
    const s = JSON.parse(out.slice(out.indexOf('{'))) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      orgName?: string;
      configDirectory?: string;
    };
    lastSignIn = {
      loggedIn: !!s.loggedIn,
      method: s.authMethod && s.authMethod !== 'none' ? s.authMethod : null,
      account: s.email ? `${s.email}${s.orgName ? ` (${s.orgName})` : ''}` : null,
      configDir: s.configDirectory ?? null,
      error: null,
    };
  } catch {
    lastSignIn = {
      loggedIn: false,
      method: null,
      account: null,
      configDir: null,
      error: out.trim().slice(0, 300) || `claude exited ${code}`,
    };
  }
  return lastSignIn;
}

/** The first-run checklist: what a new user still has to do before the first recording. */
export async function setupStatus(deps: {
  store: ProjectStore;
  workspace: Workspace;
  tts: Pick<TtsService, 'status'>;
  products: ProductsRegistry;
}): Promise<SetupItem[]> {
  const [tts, ws, ffmpeg, projects, claude] = await Promise.all([
    deps.tts.status(),
    deps.workspace.status(),
    run('ffmpeg', ['-version']),
    deps.store.list().catch(() => []),
    deps.store.readSettings().then(
      (s) => s.claudeExecutable ?? findClaude(),
      () => findClaude(),
    ),
  ]);
  const takes = await Promise.all(
    projects.map((p) =>
      readFile(path.join(deps.store.dir(p.slug), 'tutorial.json'), 'utf8').then(
        (t) => ((JSON.parse(t) as { takes?: unknown[] }).takes?.length ?? 0) > 0,
        () => false,
      ),
    ),
  );
  const apps = deps.products.list().filter((p) => p.launch === 'app');
  const installed = apps.filter((p) => p.available);
  const chromium = browserStatus();
  return [
    {
      id: 'claude-code',
      label: 'Claude Code installed',
      ok: !!claude,
      detail: claude ? claude : INSTALL_CLAUDE,
    },
    {
      id: 'claude',
      label: 'Claude sign-in for the agent',
      ok: lastSignIn ? lastSignIn.loggedIn : null,
      detail: lastSignIn
        ? lastSignIn.loggedIn
          ? `Signed in${lastSignIn.account ? ` as ${lastSignIn.account}` : ''}.`
          : (lastSignIn.error ?? 'Not signed in: run `claude auth login` in Terminal, then check again.')
        : 'Not checked yet.',
    },
    {
      id: 'elevenlabs',
      label: 'ElevenLabs API key',
      ok: tts.configured,
      detail: tts.configured ? `Saved (${tts.source}).` : 'Needed for the voice-over. Add it in Settings.',
    },
    {
      id: 'workspace',
      label: 'Workspace',
      ok: ws.initialized,
      detail: ws.initialized ? ws.path : `Not set up yet: ${ws.path}`,
    },
    {
      id: 'ffmpeg',
      label: 'ffmpeg',
      ok: ffmpeg.code === 0,
      detail:
        ffmpeg.code === 0
          ? (ffmpeg.out.split('\n')[0] ?? 'Found.')
          : 'Not found: install it with `brew install ffmpeg`, then restart the app.',
    },
    {
      id: 'product',
      label: 'Product to record',
      ok: installed.length > 0 || apps.length === 0,
      detail: installed.length
        ? installed.map((p) => p.name).join(', ')
        : `Install ${apps.map((p) => p.name).join(' or ')} (or use the VS Code extension product).`,
    },
    {
      id: 'chromium',
      label: 'Chromium for previews and export',
      ok: chromium.installed,
      detail: chromium.installed
        ? 'Downloaded.'
        : chromium.installing
          ? `Downloading… ${chromium.progress ?? ''}`.trim()
          : (chromium.error ?? 'Downloads on first use.'),
    },
    {
      id: 'firstTake',
      label: 'First recording',
      ok: takes.some(Boolean),
      detail: takes.some(Boolean)
        ? 'Done.'
        : 'Record the reference tutorial (demo-http) to check that everything works.',
    },
  ];
}
