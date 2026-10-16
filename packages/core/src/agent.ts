import { z } from 'zod';

/**
 * The agent's message stream, normalised for the UI. The engine turns each Agent SDK
 * message into zero or more of these, numbers them per project (`seq`) and keeps a log so a
 * window opened later can replay the conversation.
 */
const base = { slug: z.string(), seq: z.number().int(), at: z.number() };

export const AgentEvent = z.discriminatedUnion('kind', [
  /** The session started (or resumed): what Claude Code loaded. */
  z.object({
    ...base,
    kind: z.literal('init'),
    sessionId: z.string(),
    model: z.string(),
    cwd: z.string(),
    tools: z.array(z.string()),
    skills: z.array(z.string()),
    mcpServers: z.array(z.object({ name: z.string(), status: z.string() })),
    permissionMode: z.string(),
    resumed: z.boolean(),
  }),
  /** Something the user (or the pipeline) sent into the session. */
  z.object({ ...base, kind: z.literal('user'), text: z.string(), source: z.enum(['user', 'pipeline']) }),
  z.object({ ...base, kind: z.literal('text'), text: z.string() }),
  z.object({ ...base, kind: z.literal('thinking'), text: z.string() }),
  z.object({
    ...base,
    kind: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    /** Short human summary of the input (a path, a command, a pattern). */
    summary: z.string(),
    input: z.unknown(),
  }),
  z.object({
    ...base,
    kind: z.literal('tool_result'),
    id: z.string(),
    isError: z.boolean(),
    /** Text content, truncated; images are counted, not inlined. */
    text: z.string(),
    images: z.number().int(),
  }),
  /** One turn finished. Cost is the session's running total. */
  z.object({
    ...base,
    kind: z.literal('result'),
    ok: z.boolean(),
    subtype: z.string(),
    turns: z.number(),
    durationMs: z.number(),
    costUsd: z.number(),
    text: z.string(),
  }),
  /** A tool call that the permission rules did not decide; waits for the user. */
  z.object({
    ...base,
    kind: z.literal('permission'),
    requestId: z.string(),
    tool: z.string(),
    summary: z.string(),
    input: z.unknown(),
    reason: z.string().nullable(),
  }),
  z.object({
    ...base,
    kind: z.literal('permission_resolved'),
    requestId: z.string(),
    allowed: z.boolean(),
  }),
  z.object({ ...base, kind: z.literal('status'), text: z.string() }),
  z.object({ ...base, kind: z.literal('error'), text: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventKind = AgentEvent['kind'];

/** Distributes Omit over the union so each event keeps its own fields. */
export type AgentEventInput = AgentEvent extends infer E
  ? E extends AgentEvent
    ? Omit<E, 'slug' | 'seq' | 'at'>
    : never
  : never;

export const AgentState = z.enum(['idle', 'starting', 'busy', 'interrupting', 'error']);
export type AgentState = z.infer<typeof AgentState>;

export const AgentStatus = z.object({
  slug: z.string(),
  state: AgentState,
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  costUsd: z.number(),
  /** Tool calls waiting for the user's decision. */
  pending: z.array(z.string()),
});
export type AgentStatus = z.infer<typeof AgentStatus>;
