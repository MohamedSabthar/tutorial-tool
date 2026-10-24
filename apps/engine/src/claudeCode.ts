import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Claude Code is installed by the user, not shipped with the app: the agent runs the `claude`
 * they installed and signed in with. This finds it when Settings doesn't name one.
 */

/** How to install it, for messages and the setup checklist. */
export const INSTALL_CLAUDE =
  'Install Claude Code (curl -fsSL https://claude.ai/install.sh | bash, or npm install -g @anthropic-ai/claude-code), then sign in with claude auth login.';

/** Where installers put `claude`, checked after the PATH (apps opened from Finder get a short PATH). */
function candidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.npm-global/bin/claude'),
    path.join(home, '.bun/bin/claude'),
  ];
}

async function executable(file: string): Promise<boolean> {
  try {
    await access(file, fsConstants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** `claude` on the PATH, via the shell's `command -v`. */
function onPath(): Promise<string | null> {
  return new Promise((resolve) =>
    execFile('/bin/sh', ['-c', 'command -v claude'], { timeout: 5000 }, (err, out) =>
      resolve(err ? null : out.trim().split('\n')[0] || null),
    ),
  );
}

/** The installed Claude Code executable, or null when it can't be found. */
export async function findClaude(): Promise<string | null> {
  const fromPath = await onPath();
  if (fromPath && (await executable(fromPath))) return fromPath;
  for (const file of candidates()) if (await executable(file)) return file;
  return null;
}
