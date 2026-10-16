import { z } from 'zod';
import { Project, Rect, RecorderEvent, Take, Timeline } from './schemas';
import { TimelinePatch } from './patch';
import { AgentEvent, AgentStatus } from './agent';
import { PipelineGates, PipelineState } from './pipeline';

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

const TimelineState = z.object({
  version: z.number(),
  timeline: Timeline,
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

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
  'recorder.launchCheck': {
    params: z.object({ product: z.string().default('wso2-integrator') }),
    result: z.object({
      ok: z.boolean(),
      product: z.string(),
      vscodeVersion: z.string(),
      viewport: z.object({
        mode: z.enum(['fullscreen', 'window']),
        width: z.number(),
        height: z.number(),
        scale: z.number(),
      }),
      activityBar: z.array(z.string()),
      extensionEntry: z.string().nullable(),
      titleBar: z.string(),
      projectDetected: z.boolean(),
      dialogs: z.array(z.string()),
      screenshot: z.object({ width: z.number(), height: z.number(), dataUrl: z.string() }),
      durationMs: z.number(),
      problems: z.array(z.string()),
    }),
  },
  'recorder.runSample': {
    params: z.object({ mode: z.enum(['dry', 'record']), broken: z.boolean().default(false) }),
    result: z.object({
      passed: z.boolean(),
      mode: z.enum(['dry', 'record']),
      viewport: z.object({ mode: z.string(), width: z.number(), height: z.number(), scale: z.number() }),
      eventsFile: z.string(),
      events: z.array(RecorderEvent),
      targetFrames: z.array(
        z.object({ stepId: z.string(), target: z.string(), bbox: Rect, dataUrl: z.string() }),
      ),
      failure: z
        .object({
          stepId: z.string(),
          title: z.string(),
          error: z.string(),
          dataUrl: z.string(),
          ariaSnapshot: z.string(),
          webviewAriaSnapshot: z.string(),
        })
        .nullable(),
      durationMs: z.number(),
    }),
  },
  'recorder.recordSampleTake': {
    params: z.object({}),
    result: z.object({
      slug: z.string(),
      /** Path of the take folder under the project, e.g. recordings/take-3. */
      takePath: z.string(),
      take: Take,
      codec: z.string(),
      frames: z.number(),
      events: z.array(RecorderEvent),
    }),
  },
  'project.record': {
    params: z.object({ slug: z.string(), mode: z.enum(['dry', 'record']) }),
    result: z.object({
      passed: z.boolean(),
      slug: z.string(),
      takePath: z.string().nullable(),
      take: Take.nullable(),
      codec: z.string().nullable(),
      steps: z.array(
        z.object({ id: z.string(), title: z.string(), start: z.number(), end: z.number().nullable() }),
      ),
      failure: z
        .object({ stepId: z.string(), title: z.string(), error: z.string(), dataUrl: z.string() })
        .nullable(),
      durationMs: z.number(),
    }),
  },
  'recorder.stop': { params: z.object({}), result: z.object({ stopping: z.boolean() }) },
  'overlays.info': { params: z.object({}), result: z.object({ url: z.string() }) },
  'overlays.list': {
    params: z.object({ slug: z.string().optional() }),
    result: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['overlay', 'scene']),
        scope: z.enum(['workspace', 'project']),
        path: z.string(),
        mtime: z.number(),
      }),
    ),
  },
  'overlays.writeSample': {
    params: z.object({ slug: z.string() }),
    result: z.object({ id: z.string(), path: z.string(), absolutePath: z.string() }),
  },
  'workspace.openInEditor': {
    params: z.object({ path: z.string() }),
    result: z.object({ opened: z.boolean() }),
  },
  'timeline.get': { params: z.object({ slug: z.string() }), result: TimelineState },
  'timeline.patch': {
    params: z.object({
      slug: z.string(),
      patch: z.unknown(),
      author: z.enum(['user', 'agent', 'auto']).default('user'),
      /** Patches with the same group (one drag, one agent run) undo as one step. */
      group: z.string().nullable().default(null),
      label: z.string().optional(),
    }),
    result: TimelineState,
  },
  'timeline.undo': { params: z.object({ slug: z.string() }), result: TimelineState },
  /** Re-derives scenes and steps from the latest take (keeps overlays). */
  'timeline.rebuildFromTake': { params: z.object({ slug: z.string() }), result: TimelineState },
  'timeline.redo': { params: z.object({ slug: z.string() }), result: TimelineState },
  /** The project's agent session and its recent conversation (for a window opened later). */
  'agent.status': {
    params: z.object({ slug: z.string(), history: z.number().int().min(0).max(1000).default(200) }),
    result: z.object({ status: AgentStatus, history: z.array(AgentEvent) }),
  },
  /** Queues a message into the session, starting or resuming it if needed. */
  'agent.send': {
    params: z.object({ slug: z.string(), text: z.string().min(1).max(20000) }),
    result: z.object({ queued: z.boolean() }),
  },
  /** Stops the current turn (Pause). The session stays alive for the next message. */
  'agent.interrupt': {
    params: z.object({ slug: z.string() }),
    result: z.object({ interrupted: z.boolean() }),
  },
  /** Ends the session and forgets its id, so the next message starts a fresh conversation. */
  'agent.reset': { params: z.object({ slug: z.string() }), result: AgentStatus },
  'pipeline.get': { params: z.object({ slug: z.string() }), result: PipelineState },
  /** Starts (or restarts) the pipeline from the brief in the project's CLAUDE.md. */
  'pipeline.start': {
    params: z.object({ slug: z.string(), gates: PipelineGates.partial().optional() }),
    result: PipelineState,
  },
  /** Approves the waiting gate; the pipeline continues. */
  'pipeline.approve': { params: z.object({ slug: z.string() }), result: PipelineState },
  /** Sends feedback for the waiting gate; the agent revises and the gate opens again. */
  'pipeline.revise': {
    params: z.object({ slug: z.string(), feedback: z.string().min(1).max(4000) }),
    result: PipelineState,
  },
  'pipeline.stop': { params: z.object({ slug: z.string() }), result: PipelineState },
  /** Answers a tool permission request raised by `canUseTool`. */
  'agent.permission': {
    params: z.object({
      slug: z.string(),
      requestId: z.string(),
      allow: z.boolean(),
      message: z.string().optional(),
    }),
    result: z.object({ resolved: z.boolean() }),
  },
} as const;

export type RpcMethod = keyof typeof rpcMethods;
export type RpcParams<M extends RpcMethod> = z.input<(typeof rpcMethods)[M]['params']>;
export type RpcResult<M extends RpcMethod> = z.output<(typeof rpcMethods)[M]['result']>;

export const rpcEvents = {
  'project.changed': z.object({ slug: z.string() }),
  'workspace.changed': z.object({ head: z.string().nullable() }),
  'recorder.progress': z.object({ message: z.string(), at: z.number() }),
  'recorder.event': RecorderEvent,
  'timeline.changed': z.object({
    slug: z.string(),
    version: z.number(),
    patch: TimelinePatch,
    author: z.enum(['user', 'agent', 'auto']),
    kind: z.enum(['patch', 'undo', 'redo']),
    canUndo: z.boolean(),
    canRedo: z.boolean(),
  }),
  'overlays.changed': z.object({
    id: z.string().nullable(),
    path: z.string(),
    event: z.enum(['add', 'change', 'unlink']),
    version: z.number(),
  }),
  'live.frame': z.object({ data: z.string(), width: z.number(), height: z.number(), timestamp: z.number() }),
  'live.action': z.object({
    stepId: z.string(),
    kind: z.enum(['click', 'type']),
    label: z.string(),
    bbox: Rect,
  }),
  'live.stage': z.object({
    stage: z.enum(['fixture', 'launch', 'load', 'run', 'encode', 'done', 'failed', 'stopped']),
    at: z.number(),
  }),
  'agent.event': AgentEvent,
  'agent.state': AgentStatus,
  'pipeline.changed': PipelineState,
  'live.session': z.object({
    state: z.enum(['started', 'stopped']),
    title: z.string(),
    mode: z.enum(['dry', 'record']),
    frame: z.object({ width: z.number(), height: z.number() }).nullable(),
  }),
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
