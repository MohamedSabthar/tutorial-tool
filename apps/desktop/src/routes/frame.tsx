import { useEffect, useState, type ReactNode } from 'react';
import type { LiveSession } from '@studio/core';
import { Glyph, IconCode, StatusPill, type NavKey } from '@studio/ui';
import { useEngine } from '../engine';
import { ProjectBar, type ProjectScreen } from './ProjectBar';

/** Changes the main window's screen (hash routes, so a reload keeps the screen). */
export const navigate = (route: string) => {
  window.location.hash = route;
};

/** The Live screen, for a project's run or whatever is running. */
export const liveRoute = (slug?: string | null) => (slug ? `/making/${slug}` : '/projects');

/** Where a tutorial's run is followed: the Studio once it's done, otherwise the Making screen. */
export const runRoute = (slug: string, status?: string) =>
  status === 'done' ? `/studio/${slug}` : `/making/${slug}`;

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

/** "Recording": while a run streams to Live, on every screen but Live itself. */
export function LiveChip() {
  const session = useLiveSession();
  if (!session) return null;
  return (
    <a className="app-live-chip" href={`#${liveRoute(session.slug)}`} title={`Watch ${session.title} live`}>
      <StatusPill tone={session.mode === 'record' ? 'negative' : 'brand'} busy>
        {session.mode === 'record' ? 'Recording' : 'Testing'} · watch
      </StatusPill>
    </a>
  );
}

/**
 * The engine connection, shown only when something is wrong: being connected is the normal state
 * and needs no badge. The dev hint (`pnpm engine`) only appears in development.
 */
export function EngineStatus() {
  const { state, error, info } = useEngine();
  if (state === 'open') return null;
  const text =
    state === 'connecting'
      ? 'Connecting…'
      : import.meta.env.DEV && info?.source === 'dev'
        ? 'Engine offline: run pnpm engine'
        : 'Reconnecting…';
  return (
    <StatusPill
      tone={state === 'connecting' ? 'neutral' : 'warning'}
      busy={state === 'connecting'}
      title={error ?? undefined}
    >
      {text}
    </StatusPill>
  );
}

/** Status at the right of every header: live run, engine problems, and (in dev) the developer pages. */
export function HeaderStatus({ live = true }: { live?: boolean }) {
  return (
    <>
      {live && <LiveChip />}
      <EngineStatus />
      {import.meta.env.DEV && (
        <a className="app-frame-dev" href="#/packages" aria-label="Developer pages" title="Developer pages">
          <IconCode size={14} />
        </a>
      )}
    </>
  );
}

export type TopNav = 'tutorials' | 'settings' | 'help';

/**
 * The app's top bar: the name, three text links (Tutorials, Settings, Help), an optional middle
 * (a tutorial's title) and actions on the right.
 */
export function TopBar({
  current,
  center,
  actions,
  status = true,
}: {
  current?: TopNav;
  center?: ReactNode;
  actions?: ReactNode;
  status?: boolean;
}) {
  const links: { key: TopNav; label: string; href: string }[] = [
    { key: 'tutorials', label: 'Tutorials', href: '#/projects' },
    { key: 'settings', label: 'Settings', href: '#/settings' },
    { key: 'help', label: 'Help', href: '#/guide' },
  ];
  return (
    <header className="app-top">
      <a className="app-top-brand" href="#/projects">
        <span className="app-top-mark" aria-hidden="true">
          <Glyph name="film" size={14} />
        </span>
        Tutorial Studio
      </a>
      <nav aria-label="Main" className="app-top-nav">
        {links.map((l) => (
          <a key={l.key} href={l.href} aria-current={current === l.key ? 'page' : undefined}>
            {l.label}
          </a>
        ))}
      </nav>
      <div className="app-top-center">{center}</div>
      {status && <HeaderStatus />}
      {actions}
    </header>
  );
}

/**
 * The shared screen frame: top bar, a body that scrolls on its own and an optional footer that
 * stays at the bottom of the window. Screens of one tutorial pass `slug` and `project` for the
 * project bar (kept until those screens are replaced by Making and the new Studio).
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
  /** The open project. */
  slug?: string;
  /** Shows the project bar for `slug`, with this screen marked. */
  project?: ProjectScreen;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const nav: TopNav | undefined =
    current === 'projects'
      ? 'tutorials'
      : current === 'settings'
        ? 'settings'
        : current === 'guide'
          ? 'help'
          : undefined;
  return (
    <div className="app-frame">
      <TopBar current={nav} />
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
