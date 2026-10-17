import { useEffect, useState, type ReactNode } from 'react';
import { AppHeader, EdgeAccent, type NavKey } from '@studio/ui';
import { EngineChip, useEngine } from '../engine';

/** Changes the main window's screen (hash routes, so a reload keeps the screen). */
export const navigate = (route: string) => {
  window.location.hash = route;
};

/** The workspace path from the engine, shown at the right of the header. */
function useWorkspacePath() {
  const { client, state } = useEngine();
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('ping', { sentAt: 0 }).then(
      (r) => setPath(r.workspace),
      () => undefined,
    );
  }, [client, state]);
  return path;
}

/** Header, edge accent and scrolling body shared by Projects, Brief and Storyboard. */
export function AppFrame({
  current,
  slug,
  banner,
  footer,
  children,
}: {
  current?: NavKey;
  /** The open project, so the Studio icon goes to it. */
  slug?: string;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const workspace = useWorkspacePath();
  return (
    <div className="app-frame">
      <EdgeAccent />
      <AppHeader
        {...(current ? { current } : {})}
        hrefs={{
          projects: '#/projects',
          ...(slug ? { studio: `#/studio/${slug}` } : {}),
          library: '#/gallery',
          settings: '#/workspace',
        }}
        actions={
          <>
            {workspace && (
              <span className="ui-mono app-frame-path" title={workspace}>
                {workspace.replace(/^\/Users\/[^/]+/, '~')}
              </span>
            )}
            <EngineChip />
            <a className="app-frame-dev" href="#/packages">
              Developer pages
            </a>
          </>
        }
      />
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
