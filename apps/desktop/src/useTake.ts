import { useCallback, useEffect, useState } from 'react';
import { RecorderEvent, type Take } from '@studio/core';
import { useEngine } from './engine';

/** Loads a project's latest take and its events through the engine (dev pages). */
export function useLatestTake(slug: string) {
  const { client, state, info } = useEngine();
  const [take, setTake] = useState<Take | null>(null);
  const [events, setEvents] = useState<RecorderEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const media = useCallback(
    (rel: string) =>
      info
        ? `http://127.0.0.1:${info.port}/media/${slug}/${rel}?token=${encodeURIComponent(info.token)}`
        : null,
    [info, slug],
  );

  const reload = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const { timeline } = await client.call('project.open', { slug });
      const latest = timeline.takes[timeline.takes.length - 1];
      if (!latest) throw new Error('No take yet: record one on page 1.5 first.');
      const url = media(latest.events);
      const text = url ? await (await fetch(url)).text() : '';
      setEvents(
        text
          .split('\n')
          .filter(Boolean)
          .map((l) => RecorderEvent.parse(JSON.parse(l))),
      );
      setTake(latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, slug, media]);

  useEffect(() => {
    if (state === 'open') void Promise.resolve().then(reload);
  }, [state, reload]);

  return { take, events, error, reload, media };
}
