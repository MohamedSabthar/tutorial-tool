import { useCallback, useEffect, useState } from 'react';
import type { AgentEvent, AgentStatus } from '@studio/core';
import { useEngine } from '../engine';

/**
 * A project's agent session as seen from a window: status plus the conversation so far
 * (replayed from the engine's log, then extended by `agent.event` broadcasts).
 */
export function useAgent(slug: string) {
  const { client, state: conn } = useEngine();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || conn !== 'open') return;
    let live = true;
    // Broadcasts that arrive while the history loads are merged by seq.
    const merge = (incoming: AgentEvent[]) =>
      setEvents((cur) => {
        const last = cur.at(-1)?.seq ?? 0;
        const fresh = incoming.filter((e) => e.seq > last);
        return fresh.length ? [...cur, ...fresh] : cur;
      });
    void Promise.resolve().then(async () => {
      try {
        const r = await client.call('agent.status', { slug, history: 300 });
        if (!live) return;
        setStatus(r.status);
        setEvents((cur) => {
          const first = cur[0]?.seq ?? Infinity;
          return [...r.history.filter((e) => e.seq < first), ...cur];
        });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    });
    const offs = [
      client.on('agent.event', (e) => {
        if (e.slug === slug) merge([e]);
      }),
      client.on('agent.state', (s) => {
        if (s.slug === slug) setStatus(s);
      }),
    ];
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, [client, conn, slug]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    status,
    events,
    error,
    send: (text: string) => run(() => client!.call('agent.send', { slug, text })),
    interrupt: () => run(() => client!.call('agent.interrupt', { slug })),
    reset: () =>
      run(async () => {
        setStatus(await client!.call('agent.reset', { slug }));
      }),
    answer: (requestId: string, allow: boolean) =>
      run(() => client!.call('agent.permission', { slug, requestId, allow })),
    ready: !!client && conn === 'open',
  };
}
