import { useCallback, useEffect, useState } from 'react';
import type { ClaudeSignIn, SetupItem } from '@studio/core';
import { Button, Chip, LinkButton, Panel } from '@studio/ui';
import { openLive, useEngine } from '../../engine';

/** The first-run checklist and its status, refreshed on request and after each action. */
export function useSetup() {
  const { client, state } = useEngine();
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const refresh = useCallback(async () => {
    if (!client) return;
    setItems(await client.call('setup.status', {}).catch(() => null));
  }, [client]);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('setup.status', {}).then(setItems, () => setItems(null));
  }, [client, state]);
  return { items, refresh };
}

/**
 * "Get started": what a new user needs before the first recording, each with the action that
 * fixes it. Shown on Projects until everything is done, and always in Settings.
 */
export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const { client } = useEngine();
  const { items, refresh } = useSetup();
  const [busy, setBusy] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<ClaudeSignIn | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!items) return null;
  const done = items.filter((i) => i.ok).length;
  const action = (i: SetupItem) => {
    if (!client || i.ok) return null;
    switch (i.id) {
      case 'claude':
        return (
          <Button
            size="sm"
            disabled={busy === i.id}
            onClick={() => void act(i.id, async () => setSignIn(await client.call('agent.signInStatus', {})))}
          >
            {busy === i.id ? 'Checking…' : 'Check sign-in'}
          </Button>
        );
      case 'workspace':
        return (
          <Button
            size="sm"
            disabled={busy === i.id}
            onClick={() => void act(i.id, () => client.call('workspace.init', {}))}
          >
            Set up workspace
          </Button>
        );
      case 'elevenlabs':
        return compact ? (
          <LinkButton size="sm" href="#/settings">
            Add key
          </LinkButton>
        ) : null;
      case 'firstTake':
        return (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              void client
                .call('project.record', { slug: 'demo-http', mode: 'record' })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              openLive('demo-http');
            }}
          >
            Record demo-http
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <Panel
      title="Get started"
      action={
        <Chip tone={done === items.length ? 'ok' : 'neutral'}>
          {done} of {items.length} done
        </Chip>
      }
    >
      <ol className="setup-list">
        {/* Compact (Projects): only what's left to do. */}
        {items
          .filter((i) => !compact || !i.ok)
          .map((i) => (
            <li key={i.id} className="setup-item">
              <span
                className={`setup-mark setup-${i.ok === null ? 'unknown' : i.ok ? 'ok' : 'todo'}`}
                aria-hidden="true"
              >
                {i.ok ? '✓' : i.ok === null ? '?' : '!'}
              </span>
              <span className="setup-text">
                <strong>{i.label}</strong>
                <span>
                  {i.id === 'claude' && signIn?.configDir ? `${i.detail} (${signIn.configDir})` : i.detail}
                </span>
              </span>
              {action(i)}
            </li>
          ))}
      </ol>
      {compact && (
        <a className="setup-more" href="#/settings">
          All setup steps and settings
        </a>
      )}
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** The checklist on Projects, only while something still needs doing. */
export function GetStarted() {
  const { items } = useSetup();
  if (!items?.some((i) => i.ok === false)) return null;
  return (
    <section className="projects-setup" aria-label="Get started">
      <SetupChecklist compact />
    </section>
  );
}
