import { useEffect, useState } from 'react';
import type { LiveSession, RpcEventData } from '@studio/core';
import { useEngine } from '../../engine';

export type LiveAction = RpcEventData<'live.action'>;

/** What the live view shows: the product's screen as the agent sees it, with its pointer. */
export interface LiveView {
  session: LiveSession | null;
  /** The newest screencast frame (a data URL). */
  frame: string | null;
  /** When the newest frame arrived (ms), so the view can tell frames are still coming. */
  frameAt: number;
  /** The recorder's pointer in frame pixels; `clickAt` restarts the click ring. */
  pointer: { x: number; y: number; clickAt: number } | null;
  /** The element the script is about to click or type into. */
  action: LiveAction | null;
}

export const NO_LIVE: LiveView = { session: null, frame: null, frameAt: 0, pointer: null, action: null };

/**
 * The live screencast of one tutorial's run (`live.session`, `live.frame`, `live.pointer`,
 * `live.action`). Frames of another tutorial's run are ignored.
 */
export function useLiveView(slug: string): LiveView {
  const { client, state } = useEngine();
  const [view, setView] = useState<LiveView>(NO_LIVE);

  useEffect(() => {
    if (!client || state !== 'open') return;
    let mine = false;
    void client.call('live.status', {}).then(
      (r) => {
        mine = r.session?.slug === slug;
        if (mine) setView((v) => ({ ...v, session: r.session }));
      },
      () => undefined,
    );
    const offs = [
      client.on('live.session', (s) => {
        mine = s.slug === slug;
        if (!mine) return;
        if (s.state === 'started' && !s.frame) setView({ ...NO_LIVE, session: s });
        else setView((v) => ({ ...v, session: s, ...(s.state === 'stopped' ? { action: null } : {}) }));
      }),
      client.on('live.frame', (f) => {
        if (mine) setView((v) => ({ ...v, frame: `data:image/jpeg;base64,${f.data}`, frameAt: Date.now() }));
      }),
      client.on('live.action', (a) => {
        if (mine) setView((v) => ({ ...v, action: a }));
      }),
      client.on('live.pointer', (p) => {
        if (mine)
          setView((v) => ({
            ...v,
            pointer: { x: p.x, y: p.y, clickAt: p.click ? Date.now() : (v.pointer?.clickAt ?? 0) },
          }));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client, state, slug]);

  return view;
}
