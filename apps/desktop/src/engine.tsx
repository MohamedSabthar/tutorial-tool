import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createEngineClient, type ConnectionState, type EngineClient } from '@studio/core';
import { Chip } from '@studio/ui';

/**
 * One engine connection per window. Inside Tauri the Rust shell starts the engine and
 * `get_engine` returns its port and token; in a plain browser (`pnpm dev:web`) we fall back
 * to the dev engine started with `pnpm engine`.
 */
export interface EngineInfo {
  port: number;
  token: string;
  source: 'tauri' | 'dev';
}

export const DEV_ENGINE = { port: 4317, token: 'dev-token' } as const;

export const isTauri = () => '__TAURI_INTERNALS__' in window;

export async function resolveEngine(): Promise<EngineInfo> {
  // The engine's headless renderer opens #/render/<slug>?engine=<port>&token=<token>.
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const port = Number(q.get('engine'));
  if (port && q.get('token')) return { port, token: q.get('token')!, source: 'dev' };
  if (!isTauri()) return { ...DEV_ENGINE, source: 'dev' };
  const { invoke } = await import('@tauri-apps/api/core');
  const info = await invoke<{ port: number; token: string }>('get_engine');
  return { ...info, source: 'tauri' };
}

export async function openLiveWindow(): Promise<void> {
  if (!isTauri()) {
    window.open(`${window.location.pathname}#/live`, '_blank');
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_live_window');
}

/** Opens another Studio window on a route (a browser tab outside Tauri). */
export async function openStudioWindow(label: string, route: string): Promise<void> {
  if (!isTauri()) {
    window.open(`${window.location.pathname}#${route}`, '_blank');
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_studio_window', { label, route });
}

export async function currentWindowLabel(): Promise<string> {
  if (!isTauri()) return 'browser';
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  return getCurrentWebviewWindow().label;
}

interface EngineContextValue {
  client: EngineClient | null;
  info: EngineInfo | null;
  state: ConnectionState;
  latencyMs: number | null;
  error: string | null;
}

const EngineContext = createContext<EngineContextValue>({
  client: null,
  info: null,
  state: 'connecting',
  latencyMs: null,
  error: null,
});

export function EngineProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<EngineContextValue>({
    client: null,
    info: null,
    state: 'connecting',
    latencyMs: null,
    error: null,
  });

  useEffect(() => {
    let client: EngineClient | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const ping = async () => {
      if (!client || client.state() !== 'open') return;
      try {
        const r = await client.call('ping', { sentAt: performance.now() });
        if (!cancelled) setValue((v) => ({ ...v, latencyMs: performance.now() - r.sentAt }));
      } catch {
        /* reported through the connection state */
      }
    };

    resolveEngine().then(
      (info) => {
        if (cancelled) return;
        client = createEngineClient({ url: `ws://127.0.0.1:${info.port}/rpc`, token: info.token });
        client.onState((state) => {
          setValue((v) => ({ ...v, state }));
          if (state === 'open') void ping();
        });
        setValue((v) => ({ ...v, client, info, error: null }));
        timer = setInterval(ping, 5000);
      },
      (e: unknown) => {
        if (!cancelled) setValue((v) => ({ ...v, state: 'closed', error: String(e) }));
      },
    );

    return () => {
      cancelled = true;
      clearInterval(timer);
      client?.close();
    };
  }, []);

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export const useEngine = () => useContext(EngineContext);

export function EngineChip() {
  const { state, latencyMs, error, info } = useEngine();
  const text =
    state === 'open'
      ? `Engine connected · ping ${latencyMs === null ? '…' : `${latencyMs.toFixed(0)} ms`}`
      : state === 'connecting'
        ? 'Connecting to engine…'
        : info?.source === 'dev'
          ? 'Engine offline · run `pnpm engine`'
          : 'Engine offline';
  return (
    <Chip
      tone={state === 'open' ? 'ok' : state === 'connecting' ? 'neutral' : 'error'}
      mono
      title={error ?? undefined}
    >
      {text}
    </Chip>
  );
}
