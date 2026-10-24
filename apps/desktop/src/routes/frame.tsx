import { useEffect, useState, type ReactNode } from 'react';
import type { LiveSession } from '@studio/core';
import { AppHeader, Chip, EdgeAccent, IconCode, type NavKey } from '@studio/ui';
import { EngineChip, useEngine } from '../engine';
import { ProjectBar, type ProjectScreen } from './ProjectBar';

/** Changes the main window's screen (hash routes, so a reload keeps the screen). */
export const navigate = (route: string) => {
  window.location.hash = route;
};

/** The Live screen, for a project's run or whatever is running. */
export const liveRoute = (slug?: string | null) => (slug ? `/live/${slug}` : '/live');

/** Header links shared by every screen: the Studio and Live icons follow the open project. */
export const appHrefs = (slug?: string | null): Partial<Record<NavKey, string>> => ({
  projects: '#/projects',
  ...(slug ? { studio: `#/studio/${slug}` } : {}),
  live: `#${liveRoute(slug)}`,
  settings: '#/settings',
  guide: '#/guide',
});

/** The run streaming to Live right now, if any. */
export function useLiveSession(): LiveSession | null {
  const { client, state } = useEngine();
  const [session, setSession] = useState<LiveSession | null>(null);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('live.status', {}).then(
      (r) => setSession(r.session),
      () => undefined,
    );
    return client.on('live.session', (s) => setSession(s.state === 'started' ? s : null));
  }, [client, state]);
  return session;
}

/** "● Recording": while a run streams to Live, on every screen but Live itself. */
export function LiveChip() {
  const session = useLiveSession();
  if (!session) return null;
  return (
    <a className="app-live-chip" href={`#${liveRoute(session.slug)}`} title={`Watch ${session.title} live`}>
      <Chip tone={session.mode === 'record' ? 'error' : 'info'} dot>
        {session.mode === 'record' ? 'Recording' : 'Dry run'} · watch live
      </Chip>
    </a>
  );
}

/** Status at the right of every header: live run, engine, and (in dev) the developer pages. */
export function HeaderStatus({ live = true }: { live?: boolean }) {
  return (
    <>
      {live && <LiveChip />}
      <EngineChip />
      {import.meta.env.DEV && (
        <a className="app-frame-dev" href="#/packages" aria-label="Developer pages" title="Developer pages">
          <IconCode size={14} />
        </a>
      )}
    </>
  );
}

/**
 * The shared screen frame: header, edge accent, a body that scrolls on its own and an optional
 * footer that stays at the bottom of the window.
 */
export function AppFrame({
  current,
  slug,
  project,
  banner,
  footer,
  children,
}: {
  current?: NavKey;
  /** The open project, so the Studio and Live icons go to it. */
  slug?: string;
  /** Shows the project bar for `slug`, with this screen marked. */
  project?: ProjectScreen;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-frame">
      <EdgeAccent />
      <AppHeader {...(current ? { current } : {})} hrefs={appHrefs(slug)} actions={<HeaderStatus />} />
      {slug && project && <ProjectBar slug={slug} current={project} />}
      {banner}
      <div className="app-frame-body">{children}</div>
      {footer && <footer className="app-frame-footer">{footer}</footer>}
    </div>
  );
}

export const formatDuration = (s: number | null) => {
  if (s === null) return '—';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
