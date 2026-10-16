import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEngine } from './server';

/**
 * Sidecar entry point. Prints `READY <port> <token>` on stdout once listening; the Tauri
 * shell parses that line. Options (flags or env):
 *   --workspace <dir>  STUDIO_WORKSPACE  (default: <repo>/workspace)
 *   --port <n>         STUDIO_PORT       (default: random free port)
 *   --token <t>        STUDIO_TOKEN      (default: random)
 * STUDIO_PARENT_PID makes the engine exit when that process is gone.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workspace = path.resolve(
  arg('workspace') ?? process.env.STUDIO_WORKSPACE ?? path.join(repoRoot, 'workspace'),
);
const port = Number(arg('port') ?? process.env.STUDIO_PORT ?? 0);
const token = arg('token') ?? process.env.STUDIO_TOKEN;

// In dev the engine restarts on code changes; the previous instance may still be releasing
// the port for a moment.
async function start() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await startEngine({ workspace, port, ...(token ? { token } : {}) });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
const engine = await start();
process.stdout.write(`READY ${engine.port} ${engine.token}\n`);
process.stderr.write(`engine: listening on ${engine.url}, workspace ${workspace}\n`);

const shutdown = () => {
  engine.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Never outlive the app: exit when the parent (Tauri) closes our stdin, or, under a dev
// watcher that owns stdin, when the app's process disappears.
if (process.env.STUDIO_EXIT_ON_STDIN_END !== '0') {
  process.stdin.on('end', shutdown);
  process.stdin.resume();
}
const parentPid = Number(process.env.STUDIO_PARENT_PID);
if (parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      // The app is gone. Under a dev watcher, stop the watcher too so it can't respawn us.
      if (process.ppid !== parentPid && process.ppid > 1) {
        try {
          process.kill(process.ppid, 'SIGTERM');
        } catch {
          /* already gone */
        }
      }
      shutdown();
    }
  }, 2000).unref();
}
