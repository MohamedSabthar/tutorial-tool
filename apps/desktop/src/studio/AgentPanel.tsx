import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, AgentState } from '@studio/core';
import { Button, Chip, Panel, TextArea, type ChipTone } from '@studio/ui';
import { useAgent } from './useAgent';

const STATE: Record<AgentState, { label: string; tone: ChipTone }> = {
  idle: { label: 'Idle', tone: 'neutral' },
  starting: { label: 'Starting', tone: 'info' },
  busy: { label: 'Working', tone: 'active' },
  interrupting: { label: 'Stopping', tone: 'info' },
  error: { label: 'Error', tone: 'error' },
};

const STOPPED: Record<string, string> = {
  error_during_execution: 'Stopped',
  error_max_turns: 'Stopped at the turn limit',
  error_max_budget_usd: 'Stopped at the budget limit',
};

const SUGGESTION = 'Which skills and CLAUDE.md files can you see?';

const mono: React.CSSProperties = { fontFamily: 'var(--ui-mono)', fontSize: 11 };

/** **bold** and `code` inside one line of agent text. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={i} style={{ ...mono, background: 'var(--ui-gray-100)', borderRadius: 4, padding: '0 3px' }}>
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** Just enough Markdown for chat replies: paragraphs, bullets, bold and inline code. */
function Markdown({ text }: { text: string }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.45, color: 'var(--ui-navy)' }}
    >
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-*] (.*)$/.exec(line);
        if (bullet)
          return (
            <div key={i} style={{ display: 'flex', gap: 6, paddingLeft: 4 }}>
              <span aria-hidden="true">•</span>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{inline(bullet[1]!)}</span>
            </div>
          );
        return line.trim() ? (
          <div key={i} style={{ overflowWrap: 'anywhere' }}>
            {inline(line.replace(/^#+\s*/, ''))}
          </div>
        ) : null;
      })}
    </div>
  );
}

/** Strips the `mcp__studio__` prefix so studio tools read as plain names. */
const toolName = (n: string) => n.replace(/^mcp__studio__/, 'studio · ');

function Line({
  e,
  results,
  pending,
  answer,
}: {
  e: AgentEvent;
  results: Map<string, Extract<AgentEvent, { kind: 'tool_result' }>>;
  pending: Set<string>;
  answer: (id: string, allow: boolean) => void;
}) {
  switch (e.kind) {
    case 'user':
      return (
        <div
          style={{
            alignSelf: 'flex-end',
            maxWidth: '92%',
            background: 'var(--ui-navy)',
            color: 'var(--ui-white)',
            borderRadius: 10,
            padding: '6px 10px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {e.text}
        </div>
      );
    case 'text':
      return <Markdown text={e.text} />;
    case 'thinking':
      return null;
    case 'tool_use': {
      const r = results.get(e.id);
      return (
        <div
          title={r?.text || e.summary}
          style={{
            ...mono,
            display: 'flex',
            gap: 6,
            alignItems: 'baseline',
            color: 'var(--ui-gray-600)',
            minWidth: 0,
          }}
        >
          <span style={{ color: r ? (r.isError ? 'var(--ui-red)' : 'var(--ui-steel)') : 'var(--ui-orange)' }}>
            {r ? (r.isError ? '✕' : '✓') : '…'}
          </span>
          <span style={{ color: 'var(--ui-navy)', whiteSpace: 'nowrap' }}>{toolName(e.name)}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.summary}
          </span>
        </div>
      );
    }
    case 'permission': {
      const open = pending.has(e.requestId);
      return (
        <div
          style={{
            border: `1px solid ${open ? 'var(--ui-orange)' : 'var(--ui-gray-300)'}`,
            borderRadius: 10,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--ui-navy)' }}>
            <strong>{toolName(e.tool)}</strong> needs your approval
          </span>
          <code style={{ ...mono, wordBreak: 'break-all' }}>{e.summary}</code>
          {e.reason && <span style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>{e.reason}</span>}
          {open && (
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant="primary" onClick={() => answer(e.requestId, true)}>
                Allow
              </Button>
              <Button size="sm" onClick={() => answer(e.requestId, false)}>
                Deny
              </Button>
            </div>
          )}
        </div>
      );
    }
    case 'permission_resolved':
      return <span style={{ ...mono, color: 'var(--ui-gray-600)' }}>{e.allowed ? 'Allowed' : 'Denied'}</span>;
    case 'result':
      return (
        <span style={{ ...mono, color: e.ok ? 'var(--ui-gray-600)' : 'var(--ui-red)' }}>
          {e.ok ? 'Done' : (STOPPED[e.subtype] ?? `Stopped (${e.subtype})`)} · {e.turns} turns ·{' '}
          {(e.durationMs / 1000).toFixed(1)} s · ${e.costUsd.toFixed(2)} total
        </span>
      );
    case 'init':
      return (
        <span style={{ ...mono, color: 'var(--ui-gray-600)' }}>
          {e.resumed ? 'Resumed' : 'Started'} session {e.sessionId.slice(0, 8)} · {e.model} · skills:{' '}
          {e.skills.join(', ') || 'none'}
        </span>
      );
    case 'status':
      return <span style={{ ...mono, color: 'var(--ui-gray-600)' }}>{e.text}</span>;
    case 'error':
      return <span style={{ ...mono, color: 'var(--ui-red)', whiteSpace: 'pre-wrap' }}>{e.text}</span>;
    default:
      return null;
  }
}

/**
 * The Studio's agent box: chat with the project's headless Claude Code session. Tool calls
 * show inline; calls the permission rules didn't decide wait here for Allow or Deny.
 */
export function AgentPanel({ slug }: { slug: string }) {
  const agent = useAgent(slug);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const { results, shown } = useMemo(() => {
    const results = new Map<string, Extract<AgentEvent, { kind: 'tool_result' }>>();
    for (const e of agent.events) if (e.kind === 'tool_result') results.set(e.id, e);
    const shown = agent.events.filter((e) => e.kind !== 'tool_result' && e.kind !== 'thinking');
    return { results, shown };
  }, [agent.events]);
  const pending = useMemo(() => new Set(agent.status?.pending ?? []), [agent.status]);
  const state = agent.status?.state ?? 'idle';
  const working = state !== 'idle' && state !== 'error';

  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void agent.send(text);
  };

  return (
    <Panel title="Agent" action={<Chip tone={STATE[state].tone}>{STATE[state].label}</Chip>}>
      <div
        ref={list}
        aria-label="Agent conversation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: 380,
          minHeight: 80,
          overflowY: 'auto',
          fontSize: 12,
          paddingRight: 2,
        }}
      >
        {shown.length === 0 && (
          <span style={{ color: 'var(--ui-gray-600)' }}>
            Ask the project’s agent anything. It works in this tutorial’s folder with the workspace skills.
          </span>
        )}
        {shown.map((e) => (
          <Line key={e.seq} e={e} results={results} pending={pending} answer={agent.answer} />
        ))}
      </div>
      {agent.error && <Chip tone="error">{agent.error}</Chip>}
      <TextArea
        aria-label="Message the agent"
        rows={3}
        value={draft}
        placeholder={SUGGESTION}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button
          size="sm"
          variant="primary"
          disabled={!agent.ready || !draft.trim()}
          onClick={submit}
          title={working ? 'Queued after the current turn' : undefined}
        >
          Send
        </Button>
        {!draft && shown.length === 0 && (
          <Button size="sm" disabled={!agent.ready} onClick={() => void agent.send(SUGGESTION)}>
            Ask the suggestion
          </Button>
        )}
        <Button size="sm" disabled={!working} onClick={() => void agent.interrupt()}>
          Pause
        </Button>
        <span style={{ flex: 1 }} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void agent.reset()}
          disabled={!agent.ready || working}
          title="End this conversation; the next message starts a new session"
        >
          New
        </Button>
      </div>
      <span style={{ ...mono, color: 'var(--ui-gray-600)' }}>
        {agent.status?.sessionId ? `session ${agent.status.sessionId.slice(0, 8)}` : 'no session yet'}
        {agent.status?.costUsd ? ` · $${agent.status.costUsd.toFixed(2)}` : ''}
      </span>
    </Panel>
  );
}
