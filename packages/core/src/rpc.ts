import { z } from 'zod';
import { Project, Timeline } from './schemas';

/**
 * The engine's WebSocket protocol.
 *   request  { id, method, params }
 *   reply    { id, result } | { id, error: { message, code } }
 *   event    { event, data }
 * Every method is declared here with zod schemas for params and result, so the engine
 * validates input and the UI gets typed calls.
 */
export const NewProject = z.object({
  title: z.string().min(1).max(120),
  product: z.string().min(1).default('wso2-integrator'),
});

const WorkspaceStatus = z.object({
  path: z.string(),
  initialized: z.boolean(),
  head: z.string().nullable(),
  commits: z.number(),
});
const CommitInfo = z.object({ hash: z.string(), date: z.string(), subject: z.string() });

export const rpcMethods = {
  ping: {
    params: z.object({ sentAt: z.number() }),
    result: z.object({ sentAt: z.number(), engineVersion: z.string(), workspace: z.string() }),
  },
  'project.list': {
    params: z.object({}),
    result: z.array(Project),
  },
  'project.create': {
    params: NewProject,
    result: Project,
  },
  'project.open': {
    params: z.object({ slug: z.string() }),
    result: z.object({ project: Project, timeline: Timeline }),
  },
  'workspace.status': { params: z.object({}), result: WorkspaceStatus },
  'workspace.init': { params: z.object({}), result: WorkspaceStatus },
  'workspace.tree': { params: z.object({}), result: z.array(z.string()) },
  'workspace.read': {
    params: z.object({ path: z.string().min(1) }),
    result: z.object({ path: z.string(), text: z.string() }),
  },
  'workspace.log': {
    params: z.object({ limit: z.number().int().min(1).max(200).default(20) }),
    result: z.array(CommitInfo),
  },
} as const;

export type RpcMethod = keyof typeof rpcMethods;
export type RpcParams<M extends RpcMethod> = z.input<(typeof rpcMethods)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.output<(typeof rpcMethods)[M]['result']>;

export const rpcEvents = {
  'project.changed': z.object({ slug: z.string() }),
  'workspace.changed': z.object({ head: z.string().nullable() }),
} as const;
export type RpcEvent = keyof typeof rpcEvents;
export type RpcEventData<E extends RpcEvent> = z.output<(typeof rpcEvents)[E]>;

export const RpcRequest = z.object({ id: z.number().int(), method: z.string(), params: z.unknown() });
export type RpcRequest = z.infer<typeof RpcRequest>;

export interface RpcErrorBody {
  message: string;
  code: 'bad_request' | 'not_found' | 'unknown_method' | 'internal';
}

export type RpcReply = { id: number; result: unknown } | { id: number; error: RpcErrorBody };
export type RpcEventMessage = { event: string; data: unknown };

export class RpcError extends Error {
  override name = 'RpcError';
  constructor(
    message: string,
    readonly code: RpcErrorBody['code'] = 'internal',
  ) {
    super(message);
  }
}

/** Header (HTTP) or query parameter (WebSocket, media URLs) carrying the session token. */
export const TOKEN_HEADER = 'x-studio-token';
export const TOKEN_QUERY = 'token';

// ---------------------------------------------------------------------------
// Client (works in the browser and in Node with the `ws` package)
// ---------------------------------------------------------------------------

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
type SocketCtor = new (url: string) => SocketLike;

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface EngineClient {
  readonly url: string;
  state(): ConnectionState;
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  on<E extends RpcEvent>(event: E, fn: (data: RpcEventData<E>) => void): () => void;
  onState(fn: (s: ConnectionState) => void): () => void;
  close(): void;
}

export interface ClientOptions {
  /** e.g. ws://127.0.0.1:4317/rpc */
  url: string;
  token: string;
  WebSocket?: SocketCtor;
  /** Reconnect delay in ms; 0 disables reconnecting. */
  reconnectMs?: number;
}

export function createEngineClient(opts: ClientOptions): EngineClient {
  const Ctor: SocketCtor = opts.WebSocket ?? (globalThis as unknown as { WebSocket: SocketCtor }).WebSocket;
  const url = `${opts.url}?${TOKEN_QUERY}=${encodeURIComponent(opts.token)}`;
  const reconnectMs = opts.reconnectMs ?? 1000;
  let socket: SocketLike;
  let state: ConnectionState = 'connecting';
  let closedByUser = false;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const queue: string[] = [];
  const listeners = new Map<string, Set<(d: unknown) => void>>();
  const stateListeners = new Set<(s: ConnectionState) => void>();

  const setState = (s: ConnectionState) => {
    state = s;
    stateListeners.forEach((fn) => fn(s));
  };

  function connect() {
    setState('connecting');
    socket = new Ctor(url);
    socket.onopen = () => {
      setState('open');
      while (queue.length) socket.send(queue.shift()!);
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as RpcReply | RpcEventMessage;
      if ('event' in msg) {
        listeners.get(msg.event)?.forEach((fn) => fn(msg.data));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if ('error' in msg) p.reject(new RpcError(msg.error.message, msg.error.code));
      else p.resolve(msg.result);
    };
    socket.onclose = () => {
      setState('closed');
      for (const p of pending.values()) p.reject(new RpcError('connection closed'));
      pending.clear();
      if (!closedByUser && reconnectMs > 0) setTimeout(connect, reconnectMs);
    };
    socket.onerror = () => {
      /* onclose follows and handles it */
    };
  }
  connect();

  return {
    url: opts.url,
    state: () => state,
    call(method, params) {
      const id = nextId++;
      const text = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        if (state === 'open') socket.send(text);
        else queue.push(text);
      });
    },
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn as (d: unknown) => void);
      return () => set.delete(fn as (d: unknown) => void);
    },
    onState(fn) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    close() {
      closedByUser = true;
      socket.close();
    },
  };
}
