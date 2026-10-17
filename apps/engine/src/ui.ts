import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** The built app (pnpm --filter @studio/desktop build); STUDIO_UI_DIST overrides it. */
export const UI_DIST = process.env.STUDIO_UI_DIST ?? path.join(repo, 'apps', 'desktop', 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

/** Paths the UI routes serve without the session token (static app files only). */
export const isUiPath = (url: string) => url === '/' || url.startsWith('/?') || url.startsWith('/assets/');

/**
 * Serves the built app from the engine, so the render host (checks, review frames, export) works
 * without the Vite dev server (and in the packaged app).
 */
export function registerUi(app: FastifyInstance): void {
  const send = async (rel: string, reply: FastifyReply) => {
    const file = path.resolve(UI_DIST, rel);
    if (!file.startsWith(UI_DIST + path.sep)) return reply.code(403).send();
    const st = await stat(file).catch(() => null);
    if (!st?.isFile())
      return reply
        .code(404)
        .send({ error: 'not found (build the app: pnpm --filter @studio/desktop build)' });
    reply.header('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    reply.header('content-length', st.size);
    return reply.send(createReadStream(file));
  };
  app.get('/', async (_req, reply) => send('index.html', reply));
  app.get<{ Params: { '*': string } }>('/assets/*', async (req, reply) =>
    send(path.join('assets', req.params['*']), reply),
  );
}

/**
 * Where the render host loads the app from: STUDIO_UI_URL, else the Vite dev server when it is
 * running (fresh code while developing), else the built app served by this engine.
 */
export async function resolveUiUrl(engineUrl: string): Promise<string> {
  if (process.env.STUDIO_UI_URL) return process.env.STUDIO_UI_URL;
  const dev = 'http://localhost:1420';
  try {
    const res = await fetch(dev, { signal: AbortSignal.timeout(800) });
    if (res.ok) return dev;
  } catch {
    // Not running.
  }
  if (existsSync(path.join(UI_DIST, 'index.html'))) return engineUrl;
  throw new Error(
    'The app UI is not available: start it (pnpm dev) or build it (pnpm --filter @studio/desktop build).',
  );
}
