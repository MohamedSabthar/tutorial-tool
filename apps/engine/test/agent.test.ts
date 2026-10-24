import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentStatus } from '@studio/core';
import { AsyncQueue } from '../src/agent/queue';
import { normalize } from '../src/agent/events';
import { AgentSession, agentEnv, readOnlyBashAllowed, workspaceFileAllowed } from '../src/agent/session';

const init = (sessionId: string) =>
  ({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-opus-5-5',
    cwd: '/w/projects/demo',
    tools: ['Read', 'mcp__studio__get_project'],
    skills: ['wso2-integrator', 'synced-personal'],
    mcp_servers: [{ name: 'studio', status: 'connected' }],
    permissionMode: 'default',
  }) as unknown as SDKMessage;

const assistant = (content: unknown[]) =>
  ({ type: 'assistant', parent_tool_use_id: null, message: { content } }) as unknown as SDKMessage;

const result = (cost: number) =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    duration_ms: 10,
    total_cost_usd: cost,
    result: 'done',
  }) as unknown as SDKMessage;

describe('AsyncQueue', () => {
  it('delivers pushed items in order, waits when empty and ends on close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const seen: number[] = [];
    const reader = (async () => {
      for await (const n of q) seen.push(n);
    })();
    await Promise.resolve();
    q.push(2);
    q.close();
    expect(q.push(3)).toBe(false);
    await reader;
    expect(seen).toEqual([1, 2]);
  });
});

describe('normalize', () => {
  it('splits assistant messages into text, thinking and tool calls', () => {
    const out = normalize(
      assistant([
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: 'Looking.' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/CLAUDE.md' } },
      ]),
      false,
    );
    expect(out.map((e) => e.kind)).toEqual(['thinking', 'text', 'tool_use']);
    expect(out[2]).toMatchObject({ name: 'Read', summary: '/w/CLAUDE.md' });
  });

  it('reads tool results and counts images', () => {
    const [r] = normalize(
      {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              is_error: true,
              content: [{ type: 'text', text: 'nope' }, { type: 'image' }],
            },
          ],
        },
      } as unknown as SDKMessage,
      false,
    );
    expect(r).toEqual({ kind: 'tool_result', id: 't1', isError: true, text: 'nope', images: 1 });
  });

  it('ignores subagent frames and unknown message types', () => {
    expect(
      normalize(
        { ...assistant([{ type: 'text', text: 'x' }]), parent_tool_use_id: 'p' } as SDKMessage,
        false,
      ),
    ).toEqual([]);
    expect(normalize({ type: 'something_new' } as unknown as SDKMessage, false)).toEqual([]);
  });
});

describe('agentEnv', () => {
  it('drops the outer Claude Code session variables but keeps config and credentials', () => {
    const env = agentEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 'x',
      CLAUDE_CONFIG_DIR: '/c',
      ANTHROPIC_API_KEY: 'k',
      ELEVENLABS_API_KEY: 'never-for-the-agent',
      PATH: '/bin',
    });
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'PATH']);
  });
});

describe('workspaceFileAllowed', () => {
  const ws = '/w';
  const ok = (tool: string, file: string) => workspaceFileAllowed(ws, tool, { file_path: file });
  it('approves edits to skills, scripts and overlays inside the workspace', () => {
    expect(ok('Edit', '/w/.claude/skills/wso2-integrator/pages/http-service.ts')).toBe(true);
    expect(ok('Write', '/w/projects/demo/script.spec.ts')).toBe(true);
    expect(ok('Write', '/w/overlays/Badge.tsx')).toBe(true);
    expect(ok('MultiEdit', '/w/CLAUDE.md')).toBe(true);
  });
  it('leaves everything else to the permission rules and the user', () => {
    expect(ok('Edit', '/w/.claude/settings.json')).toBe(false);
    expect(ok('Write', '/w/.claude/settings.local.json')).toBe(false);
    expect(ok('Edit', '/w/projects/demo/.env')).toBe(false);
    expect(ok('Edit', '/w/.git/config')).toBe(false);
    expect(ok('Edit', '/w/../etc/passwd')).toBe(false);
    expect(ok('Write', '/elsewhere/x.ts')).toBe(false);
    expect(ok('Bash', '/w/x')).toBe(false);
    expect(workspaceFileAllowed(ws, 'Edit', { file_path: 'relative.ts' })).toBe(false);
  });
});

/**
 * A scripted stand-in for the SDK's query(): for each prompt message it reads, it plays the
 * next reply from `turns`. A reply that is an Error is thrown from the generator.
 */
function fakeQuery(turns: (SDKMessage[] | Error)[], calls: Options[]) {
  return ({ prompt, options }: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => {
    calls.push(options!);
    let interrupted = false;
    async function* gen(): AsyncGenerator<SDKMessage, void> {
      for await (const msg of prompt as AsyncIterable<SDKUserMessage>) {
        void msg;
        const turn = turns.shift();
        if (!turn) return;
        if (turn instanceof Error) throw turn;
        for (const m of turn) {
          if (interrupted) break;
          yield m;
        }
        interrupted = false;
      }
    }
    const g = gen() as unknown as Query;
    g.interrupt = async () => {
      interrupted = true;
      return undefined;
    };
    g.close = () => void g.return(undefined);
    return g;
  };
}

const opts = () => ({ signal: new AbortController().signal, toolUseID: 'tu-1', requestId: 'rq-1' });

describe('AgentSession', () => {
  let dir: string;
  let events: AgentEvent[];
  let states: AgentStatus[];
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'agent-'));
    events = [];
    states = [];
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const host = (q: ReturnType<typeof fakeQuery>) => ({
    projectDir: () => dir,
    workspaceDir: dir,
    mcpServers: () => ({}),
    skills: async () => ['wso2-integrator'],
    emit: (e: AgentEvent) => events.push(e),
    state: (s: AgentStatus) => states.push(s),
    query: q as never,
  });
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(pred()).toBe(true);
  };

  it('runs a turn, stores the session id and resumes it after a restart', async () => {
    const calls: Options[] = [];
    const turns = [[init('s-1'), assistant([{ type: 'text', text: 'hi' }]), result(0.5)]];
    const a = new AgentSession('demo', host(fakeQuery(turns, calls)));
    await a.send('hello');
    await until(() => states.at(-1)?.state === 'idle' && events.some((e) => e.kind === 'result'));
    expect(calls[0]).toMatchObject({ cwd: dir, settingSources: ['project'], skills: ['wso2-integrator'] });
    expect(calls[0]!.resume).toBeUndefined();
    const initEvent = events.find((e) => e.kind === 'init');
    expect(initEvent).toMatchObject({ sessionId: 's-1', skills: ['wso2-integrator'], resumed: false });
    expect(states.at(-1)).toMatchObject({ state: 'idle', sessionId: 's-1', costUsd: 0.5 });
    expect(JSON.parse(await readFile(path.join(dir, '.studio', 'agent.json'), 'utf8'))).toEqual({
      sessionId: 's-1',
      costUsd: 0.5,
    });
    await a.close();

    // A new engine process: the session resumes and the history replays from the log.
    const calls2: Options[] = [];
    const b = new AgentSession(
      'demo',
      host(
        fakeQuery(
          [
            [init('s-1'), result(0.7)],
            [init('s-1'), result(0.8)],
          ],
          calls2,
        ),
      ),
    );
    const { status, history } = await b.status(50);
    expect(status.sessionId).toBe('s-1');
    expect(history.map((e) => e.kind)).toEqual(['user', 'init', 'text', 'result']);
    await b.send('again');
    await until(() => calls2.length === 1);
    expect(calls2[0]!.resume).toBe('s-1');
    await until(() => events.filter((e) => e.kind === 'result').length === 2);
    await b.send('and again');
    await until(() => events.filter((e) => e.kind === 'result').length === 3);
    // init repeats every turn; only the first one per start reaches the UI.
    expect(events.filter((e) => e.kind === 'init')).toHaveLength(2);
    await b.close();
  });

  it("starts in the project's permission mode, defaulting to manual approval", async () => {
    const calls: Options[] = [];
    const a = new AgentSession('demo', {
      ...host(fakeQuery([[init('s-6'), result(0)]], calls)),
      permissionMode: async () => 'auto' as const,
    });
    await a.send('hello');
    await until(() => events.some((e) => e.kind === 'result'));
    expect(calls[0]?.permissionMode).toBe('auto');
    await a.close();
    const calls2: Options[] = [];
    const b = new AgentSession('demo2', host(fakeQuery([[init('s-7'), result(0)]], calls2)));
    await b.send('hello');
    await until(() => calls2.length > 0);
    expect(calls2[0]?.permissionMode).toBe('default');
    await b.close();
  });

  it('runs the Claude Code and config folder chosen in Settings', async () => {
    const calls: Options[] = [];
    const a = new AgentSession('demo', {
      ...host(fakeQuery([[init('s-8'), result(0)]], calls)),
      claude: async () => ({ executable: '/opt/claude/bin/claude', configDir: '/Users/me/.claude-work' }),
    });
    await a.send('hello');
    await until(() => calls.length > 0);
    expect(calls[0]?.pathToClaudeCodeExecutable).toBe('/opt/claude/bin/claude');
    expect(calls[0]?.env?.CLAUDE_CONFIG_DIR).toBe('/Users/me/.claude-work');
    await a.close();
    // Claude Code isn't shipped with the app: with none installed, the session doesn't start.
    const calls2: Options[] = [];
    const b = new AgentSession('demo2', {
      ...host(fakeQuery([[init('s-9'), result(0)]], calls2)),
      claude: async () => ({ executable: null, configDir: null }),
    });
    await expect(b.send('hello')).rejects.toThrow(/Claude Code was not found.*install\.sh/);
    expect(calls2).toHaveLength(0);
    await b.close();
  });

  it('recovers when the generator throws: the next message starts the session again', async () => {
    const calls: Options[] = [];
    const a = new AgentSession(
      'demo',
      host(fakeQuery([new Error('boom'), [init('s-2'), result(0.1)]], calls)),
    );
    await a.send('first');
    await until(() => events.some((e) => e.kind === 'error'));
    expect(events.find((e) => e.kind === 'error')).toMatchObject({ text: expect.stringContaining('boom') });
    await until(() => states.at(-1)?.state === 'idle');
    await a.send('second');
    await until(() => events.some((e) => e.kind === 'result'));
    expect(calls).toHaveLength(2);
    await a.close();
  });

  it('surfaces unexpected tool calls and resolves them from the UI', async () => {
    const calls: Options[] = [];
    const a = new AgentSession('demo', host(fakeQuery([[init('s-3'), result(0)]], calls)));
    await a.send('go');
    await until(() => calls.length === 1);
    const ask = calls[0]!.canUseTool!('Bash', { command: 'ls ~' }, opts());
    await until(() => events.some((e) => e.kind === 'permission'));
    const req = events.find((e) => e.kind === 'permission') as Extract<AgentEvent, { kind: 'permission' }>;
    expect(req).toMatchObject({ tool: 'Bash', summary: 'ls ~' });
    expect((await a.status()).status.pending).toEqual([req.requestId]);
    expect(a.answerPermission(req.requestId, false, 'not now')).toBe(true);
    await expect(ask).resolves.toEqual({ behavior: 'deny', message: 'not now' });
    expect(a.answerPermission(req.requestId, true)).toBe(false);

    // The studio's own in-process tools never ask.
    await expect(
      calls[0]!.canUseTool!(
        'mcp__studio__get_project',
        {},
        { ...opts(), mcpServer: { name: 'studio', source: 'sdk' } },
      ),
    ).resolves.toMatchObject({ behavior: 'allow' });
    await a.close();
  });

  it('reset forgets the session so the next message starts fresh', async () => {
    const calls: Options[] = [];
    const a = new AgentSession(
      'demo',
      host(
        fakeQuery(
          [
            [init('s-4'), result(0.2)],
            [init('s-5'), result(0)],
          ],
          calls,
        ),
      ),
    );
    await a.send('one');
    await until(() => events.some((e) => e.kind === 'result'));
    const status = await a.reset();
    expect(status).toMatchObject({ sessionId: null, costUsd: 0, state: 'idle' });
    await a.send('two');
    await until(() => calls.length === 2);
    expect(calls[1]!.resume).toBeUndefined();
    await a.close();
  });
});

describe('readOnlyBashAllowed', () => {
  const ws = '/w';
  const ok = (cmd: string) => readOnlyBashAllowed(ws, '/w/projects/p', cmd);
  it('allows read-only commands inside the workspace', () => {
    expect(
      ok(
        'cd /w/.claude/skills/wso2-integrator; cat components/*.md; cat pages/*.ts | head -300; ls ../../../projects/',
      ),
    ).toBe(true);
    expect(ok("sed -n '1,80p' script.spec.ts && grep -rn Resource ../../.claude 2>/dev/null")).toBe(true);
    expect(ok('git log --oneline -5')).toBe(true);
    expect(ok('find . -name "*.md"')).toBe(true);
  });
  it('asks for anything that writes, runs programs or leaves the workspace', () => {
    expect(ok('cat /etc/passwd')).toBe(false);
    expect(ok('ls ~/Desktop')).toBe(false);
    expect(ok('cd ../../..; ls')).toBe(false);
    expect(ok('echo x > file')).toBe(false);
    expect(ok("sed -i 's/a/b/' f")).toBe(false);
    expect(ok('find . -delete')).toBe(false);
    expect(ok('cat $(which node)')).toBe(false);
    expect(ok('rm -rf x')).toBe(false);
    expect(ok('git commit -m x')).toBe(false);
    expect(ok('ls & rm x')).toBe(false);
  });
});
