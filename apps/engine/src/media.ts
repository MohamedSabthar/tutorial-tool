import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ProjectStore } from './projects';

const types: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * GET /media/<slug>/<path>: serves project files with HTTP range support, so <video>
 * can seek. Paths are confined to the project folder.
 */
export function registerMedia(app: FastifyInstance, store: ProjectStore): void {
  app.get<{ Params: { slug: string; '*': string } }>('/media/:slug/*', async (req, reply) => {
    let root: string;
    try {
      root = store.dir(req.params.slug);
    } catch {
      return reply.code(400).send({ error: 'invalid project slug' });
    }
    const file = path.resolve(root, req.params['*']);
    if (file !== root && !file.startsWith(root + path.sep))
      return reply.code(403).send({ error: 'outside project' });

    let size: number;
    try {
      const st = await stat(file);
      if (!st.isFile()) return reply.code(404).send({ error: 'not found' });
      size = st.size;
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }

    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream');

    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      reply.header('content-range', `bytes */${size}`);
      return reply.code(416).send();
    }
    if (range) {
      reply.code(206);
      reply.header('content-range', `bytes ${range.start}-${range.end}/${size}`);
      reply.header('content-length', range.end - range.start + 1);
      return reply.send(createReadStream(file, range));
    }
    reply.header('content-length', size);
    return reply.send(createReadStream(file));
  });
}

export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}
