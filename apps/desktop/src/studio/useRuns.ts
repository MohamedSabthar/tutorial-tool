import { useCallback, useEffect, useState } from 'react';
import type { Run } from '@studio/core';
import { useEngine } from '../engine';

/** A project's agent runs (those that changed something), kept current. */
export function useRuns(slug: string) {
  const { client, state } = useEngine();
  const [runs, setRuns] = useState<Run[]>([]);
  const load = useCallback(async () => {
    if (!client) return;
    setRuns(await client.call('runs.list', { slug }).catch(() => []));
  }, [client, slug]);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void Promise.resolve().then(load);
    return client.on('runs.changed', (e) => {
      if (e.slug === slug) void load();
    });
  }, [client, state, slug, load]);
  return { runs, reload: load };
}
