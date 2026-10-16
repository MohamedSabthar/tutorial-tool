import { useEffect, useState, type ReactNode } from 'react';
import { AppHeader, Chip, EdgeAccent, Eyebrow, Title } from '@studio/ui';
import { EngineChip } from './engine';

/**
 * Temporary developer shell: one page per implementation step so each step can be tested
 * in the UI. Replaced by the real Projects/Studio navigation in Phase 3.
 */
export interface DevRoute {
  path: string;
  step: string;
  label: string;
  render: () => ReactNode;
}

type Runtime = { kind: 'tauri'; version: string; tauri: string } | { kind: 'browser' } | { kind: 'loading' };

async function detectRuntime(): Promise<Runtime> {
  if (!('__TAURI_INTERNALS__' in window)) return { kind: 'browser' };
  const { getVersion, getTauriVersion } = await import('@tauri-apps/api/app');
  return { kind: 'tauri', version: await getVersion(), tauri: await getTauriVersion() };
}

export function useHashPath(): string {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function DevShell({ routes }: { routes: DevRoute[] }) {
  const path = useHashPath();
  const [runtime, setRuntime] = useState<Runtime>({ kind: 'loading' });
  useEffect(() => {
    detectRuntime().then(setRuntime, () => setRuntime({ kind: 'browser' }));
  }, []);
  const current = routes.find((r) => r.path === path) ?? routes[routes.length - 1]!;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <EdgeAccent />
      <AppHeader
        center={<Chip>Developer preview</Chip>}
        actions={
          <>
            <EngineChip />
            <RuntimeChip runtime={runtime} />
          </>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <nav aria-label="Implementation steps" className="dev-nav">
          <Eyebrow>Steps</Eyebrow>
          {routes.map((r) => (
            <a
              key={r.path}
              href={`#${r.path}`}
              aria-current={r === current ? 'page' : undefined}
              className={r === current ? 'dev-link active' : 'dev-link'}
            >
              <span className="mono" style={{ fontSize: 11 }}>
                {r.step}
              </span>
              {r.label}
            </a>
          ))}
        </nav>
        <main
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--gray-50)',
            padding: '28px 32px',
            overflow: 'auto',
          }}
        >
          {current.render()}
        </main>
      </div>
    </div>
  );
}

export function Page({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Title size={28}>{title}</Title>
        {intro && (
          <p style={{ color: 'var(--gray-600)', lineHeight: 1.5, maxWidth: 820, margin: '12px 0 0' }}>
            {intro}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

function RuntimeChip({ runtime }: { runtime: Runtime }) {
  const text =
    runtime.kind === 'tauri'
      ? `Tauri ${runtime.tauri} · app v${runtime.version}`
      : runtime.kind === 'browser'
        ? 'Browser (not inside Tauri)'
        : 'Detecting runtime…';
  return (
    <Chip tone={runtime.kind === 'tauri' ? 'ok' : 'neutral'} mono>
      {text}
    </Chip>
  );
}
