import { useEffect, useRef } from 'react';
import type { AgentEvent } from '@studio/core';
import { Glyph, Spinner } from '@studio/ui';
import { currentTurn, toolPhrase } from './model';

type Row =
  | { kind: 'you'; key: string; text: string }
  | { kind: 'say'; key: string; text: string }
  | { kind: 'think'; key: string; text: string }
  | { kind: 'tool'; key: string; text: string; detail: string; state: 'running' | 'ok' | 'failed'; result: string }
  | { kind: 'note'; key: string; text: string };

/** The current request as a list of plain rows: what was asked, what the agent says and does. */
export function streamRows(events: AgentEvent[]): Row[] {
  const turn = currentTurn(events);
  const results = new Map<string, Extract<AgentEvent, { kind: 'tool_result' }>>();
  for (const e of turn) if (e.kind === 'tool_result') results.set(e.id, e);
  const rows: Row[] = [];
  turn.forEach((e, i) => {
    const key = `${i}-${e.kind}`;
    if (e.kind === 'user') rows.push({ kind: 'you', key, text: e.source === 'pipeline' ? 'The pipeline asked it to carry on' : e.text });
    else if (e.kind === 'text' && e.text.trim()) rows.push({ kind: 'say', key, text: e.text.trim() });
    else if (e.kind === 'thinking' && e.text.trim()) {
      // Thinking is shown as one quiet line, the latest only (it can be long).
      const last = rows.at(-1);
      const line = e.text.trim().split('\n').find((l) => l.trim()) ?? '';
      if (last?.kind === 'think') last.text = line;
      else rows.push({ kind: 'think', key, text: line });
    } else if (e.kind === 'tool_use') {
      const r = results.get(e.id);
      rows.push({
        kind: 'tool',
        key,
        text: toolPhrase(e.name, e.summary),
        detail: `${e.name.replace(/^mcp__[^_]+__/, '')}${e.summary ? ` · ${e.summary}` : ''}`,
        state: !r ? 'running' : r.isError ? 'failed' : 'ok',
        result: r ? r.text.slice(0, 600) : '',
      });
    } else if (e.kind === 'status' && e.text.trim()) rows.push({ kind: 'note', key, text: e.text.trim() });
    else if (e.kind === 'error' && e.text.trim()) rows.push({ kind: 'note', key, text: `Problem: ${e.text.trim()}` });
  });
  return rows;
}

/**
 * The live stream of what the agent is doing for the current request: the request, its
 * messages, each action in plain words (with the exact tool and its result under Details), and
 * its latest thought. Scrolls to the newest row as they arrive.
 */
export function AgentStream({ events, pending }: { events: AgentEvent[]; pending?: string | null }) {
  const rows = streamRows(events);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLOListElement>(null);
  const lastText = rows.at(-1)?.text;
  useEffect(() => {
    const el = box.current;
    // Follow new rows, unless the user scrolled up to read.
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) end.current?.scrollIntoView({ block: 'end' });
  }, [rows.length, lastText]);
  return (
    <ol className="ed-stream" ref={box} aria-label="What the agent is doing" aria-live="polite">
      {pending && (
        <li className="ed-stream-row" data-kind="note">
          <Spinner />
          <span>{pending}</span>
        </li>
      )}
      {rows.map((r) => (
        <li key={r.key} className="ed-stream-row" data-kind={r.kind} data-state={r.kind === 'tool' ? r.state : undefined}>
          {r.kind === 'you' ? (
            <>
              <span className="ed-stream-who">You</span>
              <span className="ed-stream-text">{r.text}</span>
            </>
          ) : r.kind === 'say' ? (
            <>
              <span className="ed-stream-who ed-stream-agent">
                <Glyph name="spark" size={11} />
              </span>
              <span className="ed-stream-text">{r.text}</span>
            </>
          ) : r.kind === 'think' ? (
            <>
              <span className="ed-stream-icon" aria-hidden="true">
                <Glyph name="dots" size={12} />
              </span>
              <span className="ed-stream-think">Thinking: {r.text}</span>
            </>
          ) : r.kind === 'tool' ? (
            <>
              <span className="ed-stream-icon" aria-hidden="true">
                {r.state === 'running' ? <Spinner /> : <Glyph name={r.state === 'ok' ? 'check' : 'x'} size={12} />}
              </span>
              <details className="ed-stream-tool">
                <summary>
                  {r.text}
                  <span className="ui-sr-only">, {r.state === 'running' ? 'in progress' : r.state === 'ok' ? 'done' : 'failed'}</span>
                </summary>
                <code>{r.detail}</code>
                {r.result && <pre>{r.result}</pre>}
              </details>
            </>
          ) : (
            <>
              <span className="ed-stream-icon" aria-hidden="true">
                <Glyph name="clock" size={12} />
              </span>
              <span className="ed-stream-think">{r.text}</span>
            </>
          )}
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}
