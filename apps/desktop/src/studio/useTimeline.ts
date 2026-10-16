import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyPatch, type RpcResult, type Timeline, type TimelinePatch } from '@studio/core';
import { useEngine } from '../engine';

type State = RpcResult<'timeline.get'>;

/**
 * A window's copy of a project's timeline. The engine is the source of truth: local patches
 * apply optimistically, every window applies broadcast patches in version order, and any gap
 * or rejection reloads from the engine.
 */
export function useTimeline(slug: string) {
  const { client, state: conn } = useEngine();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The latest state for event handlers (kept in sync after each render).
  const ref = useRef<State | null>(null);
  // While our own patches are in flight we skip broadcasts: the engine broadcasts our change
  // before replying, and the reply carries the authoritative timeline anyway.
  const pending = useRef(0);
  useLayoutEffect(() => {
    ref.current = state;
  }, [state]);

  const reload = useCallback(async () => {
    if (!client) return;
    try {
      setState(await client.call('timeline.get', { slug }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, slug]);

  useEffect(() => {
    if (!client || conn !== 'open') return;
    void Promise.resolve().then(reload);
    const offs = [
      client.on('timeline.changed', (e) => {
        if (e.slug !== slug) return;
        const cur = ref.current;
        if (!cur || e.version <= cur.version) return; // already applied
        if (pending.current > 0) return; // ours (or interleaved): the reply settles it
        if (e.version !== cur.version + 1) return void reload();
        try {
          setState({
            version: e.version,
            timeline: applyPatch(cur.timeline, e.patch),
            canUndo: e.canUndo,
            canRedo: e.canRedo,
          });
        } catch {
          void reload();
        }
      }),
      client.on('project.changed', (e) => {
        if (e.slug === slug) void reload();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client, conn, slug, reload]);

  const patch = useCallback(
    async (p: TimelinePatch, opts: { group?: string; label?: string } = {}) => {
      if (!client) return;
      const cur = ref.current;
      if (cur) {
        // Optimistic: show it right away; the engine's answer (or a reload) settles it.
        try {
          const optimistic: Timeline = applyPatch(cur.timeline, p);
          ref.current = { ...cur, timeline: optimistic };
          setState(ref.current);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
      }
      pending.current++;
      try {
        const next = await client.call('timeline.patch', {
          slug,
          patch: p,
          group: opts.group ?? null,
          ...(opts.label ? { label: opts.label } : {}),
        });
        // A later version may already be here (another window's change applied after ours).
        if (!ref.current || next.version >= ref.current.version) {
          ref.current = next;
          setState(next);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        await reload();
      } finally {
        pending.current--;
      }
    },
    [client, slug, reload],
  );

  const undo = useCallback(
    async () => client && setState(await client.call('timeline.undo', { slug })),
    [client, slug],
  );
  const redo = useCallback(
    async () => client && setState(await client.call('timeline.redo', { slug })),
    [client, slug],
  );

  return {
    timeline: state?.timeline ?? null,
    version: state?.version ?? 0,
    canUndo: !!state?.canUndo,
    canRedo: !!state?.canRedo,
    patch,
    undo,
    redo,
    error,
    setError,
  };
}
