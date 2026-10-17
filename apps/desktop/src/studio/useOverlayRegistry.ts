import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OverlayModule } from '@studio/overlay-sdk';
import { coreOverlays } from '@studio/overlays-core';
import { coreScenes } from '@studio/scenes-core';
import { useEngine } from '../engine';

export interface LoadedOverlay {
  id: string;
  path: string;
  version: number;
  loadedAt: number;
  error: string | null;
}

/**
 * Core overlays plus every workspace/project overlay served by the engine. A file change
 * re-imports that overlay (cache-busted), keeping the rest of the preview as it is.
 */
export function useOverlayRegistry(slug: string) {
  const { client, state } = useEngine();
  const [base, setBase] = useState<string | null>(null);
  const [modules, setModules] = useState<Record<string, OverlayModule>>({});
  const [status, setStatus] = useState<Record<string, LoadedOverlay>>({});

  const load = useCallback(async (url: string, id: string, rel: string, version: number) => {
    try {
      const mod = (await import(
        /* @vite-ignore */ `${url}/${rel}?v=${version}-${Date.now()}`
      )) as OverlayModule;
      if (typeof mod.default !== 'function')
        throw new Error('the module has no default export (the component)');
      setModules((m) => ({ ...m, [id]: mod }));
      setStatus((s) => ({ ...s, [id]: { id, path: rel, version, loadedAt: Date.now(), error: null } }));
    } catch (e) {
      // A failed dynamic import only says "Failed to fetch"; Vite's response has the real error.
      let message = e instanceof Error ? e.message : String(e);
      try {
        const res = await fetch(`${url}/${rel}?v=${version}-err-${Date.now()}`);
        if (!res.ok) {
          const body = await res.text();
          const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
          message = (m ? JSON.parse(`"${m[1]}"`) : body).replace(/\s+/g, ' ').slice(0, 400);
        }
      } catch {
        /* keep the original message */
      }
      setStatus((s) => ({ ...s, [id]: { id, path: rel, version, loadedAt: Date.now(), error: message } }));
    }
  }, []);

  useEffect(() => {
    if (!client || state !== 'open') return;
    let cancelled = false;
    void (async () => {
      const { url } = await client.call('overlays.info', {});
      if (cancelled) return;
      setBase(url);
      const list = await client.call('overlays.list', { slug });
      await Promise.all(list.map((e) => load(url, e.id, e.path, 0)));
    })();
    const off = client.on('overlays.changed', (c) => {
      if (!c.id || !base) return;
      if (c.event === 'unlink') {
        setModules(({ [c.id!]: _gone, ...rest }) => rest);
        setStatus(({ [c.id!]: _gone, ...rest }) => rest);
      } else void load(base, c.id, c.path, c.version);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [client, state, slug, load, base]);

  const registry = useMemo(() => ({ ...coreOverlays, ...coreScenes, ...modules }), [modules]);
  const reportError = useCallback((id: string, error: Error) => {
    setStatus((s) => (s[id] ? { ...s, [id]: { ...s[id]!, error: error.message } } : s));
  }, []);
  return { registry, status, reportError, ready: base !== null };
}
