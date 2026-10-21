import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { AgentEvent, type AgentEventInput, type AgentState, type AgentStatus } from '@studio/core';
import { AsyncQueue } from './queue';
import { normalize, summarizeInput } from './events';

export interface AgentSettings {
  /** Claude Code model id or alias. Undefined lets Claude Code choose. */
  model?: string;
  permissionMode: PermissionMode;
  /** Extra pre-approved tools on top of the workspace `.claude/settings.json` rules. */
  allowedTools: string[];
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  model: 'claude-opus-5-5',
  permissionMode: 'default',
  allowedTools: [],
};

export interface AgentHost {
  /** `workspace/projects/<slug>`, the session's working directory. */
  projectDir(slug: string): string;
  /** The workspace root: skills, shared overlays and CLAUDE.md the agent reads and updates. */
  workspaceDir: string;
  /** In-process MCP servers for this project (the `studio` tools). */
  mcpServers(slug: string): Record<string, McpServerConfig>;
  /** Skill names the session may use (the workspace's `.claude/skills/*`). */
  skills(): Promise<string[]>;
  emit(event: AgentEvent): void;
  state(status: AgentStatus): void;
  settings?: Partial<AgentSettings>;
  /** The project's own permission mode (from its brief), read when a session starts. */
  permissionMode?(slug: string): Promise<PermissionMode | undefined>;
  /** Which Claude Code to run and which login it uses (Settings), read when a session starts. */
  claude?(): Promise<ClaudeChoice>;
  /** Replaces the SDK's `query` in tests. */
  query?: typeof query;
}

/** The Claude Code executable (null: the SDK's own) and config dir (null: inherited). */
export interface ClaudeChoice {
  executable: string | null;
  configDir: string | null;
}

/** The agent's environment with a chosen CLAUDE_CONFIG_DIR. */
export function claudeEnv(choice: ClaudeChoice | null): Record<string, string | undefined> {
  const env = agentEnv();
  if (choice?.configDir) env.CLAUDE_CONFIG_DIR = choice.configDir;
  return env;
}

/** Variables an outer Claude Code session sets that must not leak into ours. */
const OUTER_SESSION_ENV =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_\w+|SSE_PORT))$/;

/** The engine's own service keys: the agent never sees them. */
const ENGINE_SECRETS = /^(ELEVENLABS_\w+|XI_API_KEY)$/;

export function agentEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env))
    if (!OUTER_SESSION_ENV.test(k) && !ENGINE_SECRETS.test(k)) out[k] = v;
  return out;
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * Whether a file-editing tool call stays inside the workspace and away from files that control
 * the agent itself (its permission settings) or hold secrets. Claude Code asks before editing
 * anything under `.claude/` and before creating files, but skills and scripts are exactly what
 * this agent maintains, so the host approves those.
 */
export function workspaceFileAllowed(
  workspace: string,
  tool: string,
  input: Record<string, unknown>,
): boolean {
  if (!FILE_TOOLS.has(tool)) return false;
  const file = input.file_path ?? input.notebook_path;
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const rel = path.relative(path.resolve(workspace), path.resolve(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  if (parts.includes('.git')) return false;
  if (parts[0] === '.claude' && parts[1] !== 'skills') return false;
  if (parts.some((p) => p === '.env' || p.startsWith('.env.'))) return false;
  return true;
}

const READ_ONLY = new Set(
  'cat ls head tail grep egrep fgrep rg find wc sort uniq cut tr echo printf pwd cd file stat tree basename dirname realpath du diff jq column nl true'.split(
    ' ',
  ),
);
const GIT_READ_ONLY = new Set(['log', 'show', 'diff', 'status', 'ls-files', 'grep', 'rev-parse', 'blame']);

/**
 * Read-only shell commands that stay inside the workspace (e.g. `cd <skill>; cat components/*.md; ls`)
 * run without asking. Anything that writes, substitutes commands, runs other programs or touches
 * a path outside the workspace still goes to the user.
 */
export function readOnlyBashAllowed(workspace: string, cwd: string, command: string): boolean {
  const root = path.resolve(workspace);
  const inside = (p: string) => {
    const rel = path.relative(root, p);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const text = command.replace(/\s2>\s*\/dev\/null/g, ' ').replace(/\s2>&1/g, ' ');
  if (/[<>`]|\$\(|\$\{|(^|[^&])&([^&]|$)/.test(text)) return false;
  let dir = path.resolve(cwd);
  for (const segment of text.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const [prog, ...args] = words;
    if (!prog || !READ_ONLY.has(prog)) {
      if (prog !== 'git' && prog !== 'sed') return false;
    }
    // sed only as a printer: `sed -n '10,80p' file`.
    if (prog === 'sed' && !(args[0] === '-n' && /^['"]?[\d,$]*p['"]?$/.test(args[1] ?? ''))) return false;
    if (prog === 'find' && args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)$/.test(a)))
      return false;
    if (prog === 'git') {
      const sub = args.find((a) => !a.startsWith('-') && args[args.indexOf(a) - 1] !== '-C');
      if (!sub || !GIT_READ_ONLY.has(sub)) return false;
    }
    for (const raw of args) {
      const a = raw.replace(/^['"]|['"]$/g, '');
      if (a.startsWith('~')) return false;
      if (a.startsWith('/') || a.startsWith('.') || a.includes('/')) {
        if (a.startsWith('-')) continue;
        if (!inside(path.resolve(dir, a.replace(/[*?[].*$/, '') || '.'))) return false;
      }
    }
    if (prog === 'cd') {
      const target = args[0]?.replace(/^['"]|['"]$/g, '');
      if (!target) return false;
      dir = path.resolve(dir, target);
      if (!inside(dir)) return false;
    }
  }
  return inside(dir);
}

interface Stored {
  sessionId: string | null;
  costUsd: number;
}

const HISTORY_CAP = 1000;

/**
 * One long-lived headless Claude Code session for a project. Messages go into a queue the
 * SDK reads as its streaming prompt; the SDK's messages come back as `agent.event`s. If the
 * session ends or throws, the next message starts it again with `resume`, so a crash, an
 * app restart or a reset never loses the conversation silently.
 */
export class AgentSession {
  private queue: AsyncQueue<SDKUserMessage> | null = null;
  private q: Query | null = null;
  private loop: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private stateValue: AgentState = 'idle';
  private stored: Stored = { sessionId: null, costUsd: 0 };
  private model: string | null = null;
  private seq = 0;
  private history: AgentEvent[] = [];
  private loaded: Promise<void>;
  /** Log appends, chained so lines land in order. */
  private writes: Promise<void> = Promise.resolve();
  private permissions = new Map<string, (r: PermissionResult) => void>();
  private settings: AgentSettings;
  private run = 'agent-0';
  private listeners = new Set<(e: AgentEvent) => void>();
  /** Bumped by reset so a dying loop doesn't overwrite the fresh state. */
  private generation = 0;

  constructor(
    readonly slug: string,
    private host: AgentHost,
  ) {
    this.settings = { ...DEFAULT_AGENT_SETTINGS, ...host.settings };
    this.loaded = this.load();
  }

  private get dir() {
    return path.join(this.host.projectDir(this.slug), '.studio');
  }

  private async load() {
    try {
      const s = JSON.parse(await readFile(path.join(this.dir, 'agent.json'), 'utf8')) as Partial<Stored>;
      this.stored = { sessionId: s.sessionId ?? null, costUsd: s.costUsd ?? 0 };
    } catch {
      // No session yet.
    }
    try {
      const lines = (await readFile(path.join(this.dir, 'agent-log.jsonl'), 'utf8')).split('\n');
      for (const l of lines.slice(-HISTORY_CAP - 1)) {
        if (!l) continue;
        const e = AgentEvent.safeParse(JSON.parse(l));
        if (e.success) this.history.push(e.data);
      }
      this.seq = this.history.at(-1)?.seq ?? 0;
    } catch {
      // No log yet.
    }
  }

  private async save() {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, 'agent.json');
    await writeFile(`${file}.tmp`, JSON.stringify(this.stored, null, 2) + '\n');
    await rename(`${file}.tmp`, file);
  }

  async status(history = 0): Promise<{ status: AgentStatus; history: AgentEvent[] }> {
    await this.loaded;
    return { status: this.snapshot(), history: history ? this.history.slice(-history) : [] };
  }

  private snapshot(): AgentStatus {
    return {
      slug: this.slug,
      state: this.stateValue,
      sessionId: this.stored.sessionId,
      model: this.model,
      costUsd: this.stored.costUsd,
      pending: [...this.permissions.keys()],
    };
  }

  private setState(s: AgentState) {
    this.stateValue = s;
    this.host.state(this.snapshot());
  }

  private emit(e: AgentEventInput) {
    const event = { ...e, slug: this.slug, seq: ++this.seq, at: Date.now() } as AgentEvent;
    this.history.push(event);
    if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
    this.host.emit(event);
    for (const fn of this.listeners) fn(event);
    const line = JSON.stringify(event) + '\n';
    this.writes = this.writes
      .then(() => mkdir(this.dir, { recursive: true }))
      .then(() => appendFile(path.join(this.dir, 'agent-log.jsonl'), line))
      .catch(() => {});
  }

  /** Calls `fn` for every event of this session; returns the unsubscribe function. */
  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Undo group for the agent's edits since the last message it was sent. */
  get runId(): string {
    return this.run;
  }

  /** Queues a message, starting (or resuming) the session first if it isn't running. */
  async send(
    text: string,
    source: 'user' | 'pipeline' = 'user',
    images: { data: string; mediaType: 'image/jpeg' | 'image/png' }[] = [],
  ): Promise<void> {
    await this.loaded;
    if (!this.queue || this.queue.isClosed)
      await (this.starting ??= this.start().finally(() => (this.starting = null)));
    this.emit({
      kind: 'user',
      text: images.length
        ? `${text}\n\n[${images.length} image${images.length === 1 ? '' : 's'} attached]`
        : text,
      source,
    });
    this.run = `agent-${this.slug}-${this.seq}`;
    this.queue!.push({
      type: 'user',
      message: {
        role: 'user',
        content: images.length
          ? [
              { type: 'text', text },
              ...images.map((im) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: im.mediaType, data: im.data },
              })),
            ]
          : text,
      },
      parent_tool_use_id: null,
    });
    if (this.stateValue === 'idle') this.setState('busy');
  }

  private async start() {
    const skills = await this.host.skills().catch(() => []);
    const claude = (await this.host.claude?.().catch(() => null)) ?? null;
    const queue = new AsyncQueue<SDKUserMessage>();
    const resume = this.stored.sessionId ?? undefined;
    const permissionMode =
      (await this.host.permissionMode?.(this.slug).catch(() => undefined)) ?? this.settings.permissionMode;
    const options: Options = {
      cwd: this.host.projectDir(this.slug),
      // The skills and shared libraries live above the project folder; the permission rules
      // in the workspace settings still decide what may be read or changed there.
      additionalDirectories: [this.host.workspaceDir],
      // Only the workspace's own settings, CLAUDE.md files and skills: never the user's
      // personal ~/.claude configuration.
      settingSources: ['project'],
      // Nor the user's claude.ai connectors, other MCP configs or Claude Code's bundled
      // skills: the session sees the studio tools and the workspace skills only.
      strictMcpConfig: true,
      settings: { disableClaudeAiConnectors: true, disableBundledSkills: true },
      skills,
      ...(this.settings.model ? { model: this.settings.model } : {}),
      permissionMode,
      allowedTools: this.settings.allowedTools,
      mcpServers: this.host.mcpServers(this.slug),
      canUseTool: this.canUseTool,
      env: claudeEnv(claude),
      ...(claude?.executable ? { pathToClaudeCodeExecutable: claude.executable } : {}),
      ...(resume ? { resume } : {}),
      stderr: (data: string) => {
        const line = data.trim();
        if (line) console.error(`[agent ${this.slug}] ${line}`);
      },
    };
    const run = this.host.query ?? query;
    const q = run({ prompt: queue, options });
    this.queue = queue;
    this.q = q;
    this.setState('starting');
    const gen = this.generation;
    this.loop = this.consume(q, queue, gen, !!resume, new Set(skills));
  }

  private async consume(
    q: Query,
    queue: AsyncQueue<SDKUserMessage>,
    gen: number,
    resumed: boolean,
    skills: Set<string>,
  ) {
    let initShown = false;
    try {
      for await (const m of q) {
        if (gen !== this.generation) break;
        let events;
        try {
          events = normalize(m, resumed);
        } catch (e) {
          events = [{ kind: 'error' as const, text: `Could not read an agent message: ${String(e)}` }];
        }
        for (const e of events) {
          if (e.kind === 'init') {
            // init lists every skill Claude Code discovered; the session can use only these.
            e.skills = e.skills.filter((n) => skills.has(n));
            this.model = e.model;
            const changed = this.stored.sessionId !== e.sessionId;
            if (changed) {
              this.stored.sessionId = e.sessionId;
              await this.save();
            }
            // Claude Code repeats init at the start of every turn; show it once per start.
            if (initShown && !changed) continue;
            initShown = true;
          }
          this.emit(e);
          if (e.kind === 'result') {
            this.stored.costUsd = e.costUsd;
            await this.save();
          }
        }
        // A result ends a turn; anything else means a turn is running (queued messages
        // start the next one without another send).
        if (m.type === 'result') this.setState('idle');
        else if (this.stateValue === 'idle' || this.stateValue === 'starting') this.setState('busy');
      }
      if (gen === this.generation) this.emit({ kind: 'status', text: 'Session ended' });
    } catch (e) {
      if (gen !== this.generation) return;
      const text = e instanceof Error ? e.message : String(e);
      // A resume of a session Claude Code no longer has would fail forever; start fresh.
      if (resumed && /no conversation found|session.*not found/i.test(text)) {
        this.stored.sessionId = null;
        await this.save();
        this.emit({
          kind: 'error',
          text: `Could not resume the previous session (${text}). Starting a new one.`,
        });
      } else this.emit({ kind: 'error', text: `The agent session stopped: ${text}` });
    } finally {
      if (gen === this.generation) {
        queue.close();
        this.queue = null;
        this.q = null;
        this.denyPending('The session ended');
        this.setState('idle');
      }
    }
  }

  private canUseTool: CanUseTool = (toolName, input, opts) => {
    // Our own in-process tools are always allowed.
    if (opts.mcpServer?.source === 'sdk' && opts.mcpServer.name === 'studio')
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    if (workspaceFileAllowed(this.host.workspaceDir, toolName, input))
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    if (
      toolName === 'Bash' &&
      typeof input.command === 'string' &&
      readOnlyBashAllowed(this.host.workspaceDir, this.host.projectDir(this.slug), input.command)
    )
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    const requestId = randomUUID();
    this.emit({
      kind: 'permission',
      requestId,
      tool: toolName,
      summary: summarizeInput(toolName, input),
      input,
      reason:
        opts.decisionReason ?? (opts.blockedPath ? `path outside the project: ${opts.blockedPath}` : null),
    });
    return new Promise<PermissionResult>((resolve) => {
      const done = (r: PermissionResult) => {
        if (!this.permissions.delete(requestId)) return;
        this.emit({ kind: 'permission_resolved', requestId, allowed: r.behavior === 'allow' });
        this.host.state(this.snapshot());
        resolve(r);
      };
      this.permissions.set(requestId, done);
      this.host.state(this.snapshot());
      opts.signal.addEventListener('abort', () => done({ behavior: 'deny', message: 'Cancelled' }), {
        once: true,
      });
    }).then((r) => (r.behavior === 'allow' ? { ...r, updatedInput: r.updatedInput ?? input } : r));
  };

  /** Switches a running session's permission mode (the next start reads it from the host). */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.q || !this.queue || this.queue.isClosed) return;
    await this.q.setPermissionMode(mode);
    this.emit({
      kind: 'status',
      text: mode === 'auto' ? 'Auto mode on' : 'Auto mode off: every tool call is checked',
    });
  }

  answerPermission(requestId: string, allow: boolean, message?: string): boolean {
    const done = this.permissions.get(requestId);
    if (!done) return false;
    done(
      allow
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: message || 'The user declined this tool call.' },
    );
    return true;
  }

  private denyPending(message: string) {
    for (const done of [...this.permissions.values()]) done({ behavior: 'deny', message });
  }

  /** Stops the current turn. The session stays open for the next message. */
  async interrupt(): Promise<boolean> {
    if (!this.q || this.stateValue === 'idle') return false;
    this.setState('interrupting');
    this.denyPending('Interrupted by the user');
    try {
      await this.q.interrupt();
      this.emit({ kind: 'status', text: 'Interrupted' });
    } catch (e) {
      this.emit({ kind: 'error', text: `Interrupt failed: ${String(e)}` });
    }
    if (this.stateValue === 'interrupting') this.setState('idle');
    return true;
  }

  /** Closes the session and forgets its id: the next message starts a new conversation. */
  async reset(): Promise<AgentStatus> {
    await this.loaded;
    await this.close();
    this.stored = { sessionId: null, costUsd: 0 };
    this.model = null;
    await this.save();
    this.emit({ kind: 'status', text: 'Started a new conversation' });
    this.setState('idle');
    return this.snapshot();
  }

  async close(): Promise<void> {
    this.generation++;
    this.denyPending('The session was closed');
    this.queue?.close();
    try {
      this.q?.close();
    } catch {
      // Already closed.
    }
    this.queue = null;
    this.q = null;
    await this.loop?.catch(() => {});
    this.loop = null;
    await this.writes;
    this.stateValue = 'idle';
  }
}

/** Sessions by project slug, created on first use. */
export class AgentManager {
  private sessions = new Map<string, AgentSession>();
  constructor(private host: AgentHost) {}

  get(slug: string): AgentSession {
    let s = this.sessions.get(slug);
    if (!s) {
      // Validates the slug before anything touches the disk.
      this.host.projectDir(slug);
      s = new AgentSession(slug, this.host);
      this.sessions.set(slug, s);
    }
    return s;
  }

  /** Ends and forgets a project's session (its project is being deleted). */
  async remove(slug: string): Promise<void> {
    const s = this.sessions.get(slug);
    this.sessions.delete(slug);
    await s?.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.close()));
  }
}
