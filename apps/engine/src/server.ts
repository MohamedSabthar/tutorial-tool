import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  RpcError,
  RpcRequest,
  rpcMethods,
  TOKEN_HEADER,
  TOKEN_QUERY,
  type RpcEvent,
  type RpcEventData,
  type RpcMethod,
  type RpcReply,
  type RpcResult,
  formatIssues,
} from '@studio/core';
import { ProjectStore } from './projects';
import { registerMedia } from './media';
import { Workspace } from './workspace';

export const ENGINE_VERSION = '0.0.1';

export interface EngineOptions {
  workspace: string;
  /** 0 picks a free port. */
  port?: number;
  /** Generated when omitted. */
  token?: string;
  logger?: boolean;
}

export interface Engine {
  port: number;
  token: string;
  url: string;
  app: FastifyInstance;
  broadcast<E extends RpcEvent>(event: E, data: RpcEventData<E>): void;
  close(): Promise<void>;
}

type Handlers = { [M in RpcMethod]: (params: never) => Promise<RpcResult<M>> };

export async function startEngine(opts: EngineOptions): Promise<Engine> {
  const token = opts.token ?? randomBytes(24).toString('hex');
  await mkdir(opts.workspace, { recursive: true });
  const store = new ProjectStore(opts.workspace);
  const workspace = new Workspace(opts.workspace);
  const app = Fastify({ logger: opts.logger ?? false });

  const tokenOk = (candidate: unknown) => {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // Everything except /health needs the session token (header, or query for <video>/WS).
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const q = (req.query as Record<string, unknown> | undefined)?.[TOKEN_QUERY];
    if (!tokenOk(req.headers[TOKEN_HEADER]) && !tokenOk(q))
      return reply.code(401).send({ error: 'unauthorized' });
  });
  app.get('/health', async () => ({ ok: true, version: ENGINE_VERSION }));
  registerMedia(app, store);

  const handlers: Handlers = {
    ping: async ({ sentAt }: { sentAt: number }) => ({
      sentAt,
      engineVersion: ENGINE_VERSION,
      workspace: opts.workspace,
    }),
    'project.list': async () => store.list(),
    'project.create': async (p: { title: string; product: string }) => {
      await workspace.ensure();
      const project = await store.create(p);
      const head = await workspace.commit(`project: create ${project.slug}`);
      broadcast('project.changed', { slug: project.slug });
      broadcast('workspace.changed', { head });
      return project;
    },
    'project.open': async ({ slug }: { slug: string }) => store.open(slug),
    'workspace.status': async () => workspace.status(),
    'workspace.init': async () => {
      const status = await workspace.init();
      broadcast('workspace.changed', { head: status.head });
      return status;
    },
    'workspace.tree': async () => workspace.tree(),
    'workspace.read': async ({ path: rel }: { path: string }) => ({
      path: rel,
      text: await workspace.read(rel),
    }),
    'workspace.log': async ({ limit }: { limit: number }) => workspace.log(limit),
  };

  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (u.pathname !== '/rpc' || !tokenOk(u.searchParams.get(TOKEN_QUERY))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws: WebSocket) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', async (raw) => {
      let id = -1;
      try {
        const req = RpcRequest.parse(JSON.parse(String(raw)));
        id = req.id;
        const method = req.method as RpcMethod;
        const def = rpcMethods[method];
        if (!def) throw new RpcError(`unknown method "${req.method}"`, 'unknown_method');
        const params = def.params.safeParse(req.params ?? {});
        if (!params.success) throw new RpcError(formatIssues(params.error), 'bad_request');
        const result = await (handlers[method] as (p: unknown) => Promise<unknown>)(params.data);
        send(ws, { id, result });
      } catch (e) {
        const err =
          e instanceof RpcError ? e : new RpcError(e instanceof Error ? e.message : String(e), 'internal');
        send(ws, { id, error: { message: err.message, code: err.code } });
      }
    });
  });

  function send(ws: WebSocket, msg: RpcReply) {
    ws.send(JSON.stringify(msg));
  }

  function broadcast<E extends RpcEvent>(event: E, data: RpcEventData<E>) {
    const text = JSON.stringify({ event, data });
    for (const ws of sockets) ws.send(text);
  }

  await app.listen({ host: '127.0.0.1', port: opts.port ?? 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}`,
    app,
    broadcast,
    async close() {
      for (const ws of sockets) ws.terminate();
      wss.close();
      await app.close();
    },
  };
}
