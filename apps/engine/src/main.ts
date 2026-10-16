import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEngine } from './server';

/**
 * Sidecar entry point. Prints `READY <port> <token>` on stdout once listening; the Tauri
 * shell parses that line. Options (flags or env):
 *   --workspace <dir>  STUDIO_WORKSPACE  (default: <repo>/workspace)
 *   --port <n>         STUDIO_PORT       (default: random free port)
 *   --token <t>        STUDIO_TOKEN      (default: random)
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

const engine = await startEngine({ workspace, port, ...(token ? { token } : {}) });
process.stdout.write(`READY ${engine.port} ${engine.token}\n`);
process.stderr.write(`engine: listening on ${engine.url}, workspace ${workspace}\n`);

const shutdown = () => {
  engine.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Exit when the parent (Tauri) closes our stdin.
process.stdin.on('end', shutdown);
process.stdin.resume();
