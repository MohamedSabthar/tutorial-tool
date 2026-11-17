import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClaudeSignIn, SetupItem } from '@studio/core';
import {
  Button,
  Glyph,
  LinkButton,
  Sheet,
  Shell,
  ShellHeader,
  ShellPanel,
  StatusPill,
  useToast,
} from '@studio/ui';
import { openLive, useEngine } from '../../engine';
import './settings.css';

/**
 * The first-run checklist and its status, refreshed on request and after each action. A sign-in
 * check made here (`checkSignIn`) updates the Claude row right away.
 */
export function useSetup() {
  const { client, state } = useEngine();
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [signIn, setSignIn] = useState<ClaudeSignIn | null>(null);
  const refresh = useCallback(async () => {
    if (!client) return;
    setItems(await client.call('setup.status', {}).catch(() => null));
  }, [client]);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('setup.status', {}).then(setItems, () => setItems(null));
  }, [client, state]);
  const checkSignIn = useCallback(async () => {
    if (!client) return;
    setSignIn(await client.call('agent.signInStatus', {}));
    await refresh();
  }, [client, refresh]);
  const merged = useMemo(
    () =>
      items && signIn
        ? items.map((i) =>
            i.id === 'claude'
              ? {
                  ...i,
                  ok: signIn.loggedIn,
                  detail: signIn.loggedIn
                    ? `Signed in${signIn.account ? ` as ${signIn.account}` : ''}.`
                    : (signIn.error ??
                      'Not signed in: run `claude auth login` in Terminal, then check again.'),
                }
              : i,
          )
        : items,
    [items, signIn],
  );
  return { items: merged, refresh, checkSignIn };
}
export type Setup = ReturnType<typeof useSetup>;

/** Plain names for the checklist rows (the engine's label is the fallback). */
const LABELS: Partial<Record<SetupItem['id'], string>> = {
  'claude-code': 'Claude Code',
  claude: 'Claude sign-in',
  elevenlabs: 'Voice-over key (ElevenLabs)',
  workspace: 'Workspace',
  ffmpeg: 'Video tools (ffmpeg)',
  product: 'Product to record',
  chromium: 'Browser for previews and export',
  firstTake: 'First recording',
};

const INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash';
const LOGIN = 'claude auth login';

/**
 * An item's text without the engine's backticks, and the Terminal commands in it, which are
 * shown as code rows with Copy.
 */
export function setupText(item: SetupItem): { text: string; commands: string[] } {
  if (!item.ok && item.id === 'claude-code')
    return { text: 'Install it in Terminal, then sign in:', commands: [INSTALL, LOGIN] };
  if (item.ok === false && item.id === 'claude' && /claude auth login/.test(item.detail))
    return { text: 'Not signed in. Run this in Terminal, then check again:', commands: [LOGIN] };
  if (item.ok && item.id === 'elevenlabs')
    return { text: 'Saved in the Keychain. Never shared with the agent.', commands: [] };
  if (item.ok && item.id === 'ffmpeg') return { text: 'Installed.', commands: [] };
  if (item.ok === false && item.id === 'firstTake')
    return { text: 'Record the sample tutorial to check that everything works.', commands: [] };
  if (item.ok === false && item.id === 'elevenlabs')
    return { text: 'Needed for the voice-over. Recording works without it.', commands: [] };
  const commands = [...item.detail.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const text = item.detail
    .replace(/`([^`]+)`/g, (_, c: string) => (commands.length ? 'the command below' : c))
    .replace(/\s+/g, ' ')
    .trim();
  return { text, commands };
}

/** A Terminal command with a Copy button. */
export function CodeRow({ command }: { command: string }) {
  const toast = useToast();
  const copy = () =>
    void navigator.clipboard.writeText(command).then(
      () => toast('Copied. Paste it in Terminal.'),
      () => toast('Couldn’t copy. Select the command and copy it.', { tone: 'error' }),
    );
  return (
    <div className="st-code">
      <code>{command}</code>
      <Button size="sm" onClick={copy} aria-label={`Copy ${command}`}>
        <Glyph name="copy" size={12} />
        Copy
      </Button>
    </div>
  );
}

const STATE_TEXT = (ok: boolean | null) => (ok ? 'Done' : ok === null ? 'Not checked' : 'To do');

/**
 * "Get started": what a new user needs before the first recording, each with the action that
 * fixes it. Shown on Projects until everything is done (compact), and always in Settings, where
 * the Claude sign-in is checked automatically on open.
 */
export function SetupChecklist({ compact = false, setup }: { compact?: boolean; setup?: Setup }) {
  const { client } = useEngine();
  const own = useSetup();
  const { items, refresh, checkSignIn } = setup ?? own;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);

  const act = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
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
    },
    [refresh],
  );

  // Settings checks the Claude sign-in once when it opens, if Claude Code is installed.
  const checked = useRef(false);
  useEffect(() => {
    if (compact || checked.current || !client || !items) return;
    const installed = items.find((i) => i.id === 'claude-code')?.ok;
    const signIn = items.find((i) => i.id === 'claude');
    if (!installed || !signIn) return;
    checked.current = true;
    void checkSignIn().catch(() => undefined);
  }, [compact, client, items, checkSignIn]);

  if (!items) return null;
  const done = items.filter((i) => i.ok).length;
  const action = (i: SetupItem) => {
    if (!client || i.ok) return null;
    switch (i.id) {
      case 'claude-code':
        return (
          <Button size="sm" disabled={busy === i.id} onClick={() => void act(i.id, async () => undefined)}>
            {busy === i.id ? 'Checking…' : 'Check again'}
          </Button>
        );
      case 'claude':
        return (
          <Button size="sm" disabled={busy === i.id} onClick={() => void act(i.id, checkSignIn)}>
            {busy === i.id ? 'Checking…' : 'Check again'}
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
        ) : (
          <Button size="sm" onClick={() => document.getElementById('st-key')?.focus()}>
            Add key
          </Button>
        );
      case 'firstTake':
        return (
          <Button size="sm" onClick={() => setConfirmDemo(true)}>
            Record the sample tutorial
          </Button>
        );
      default:
        return null;
    }
  };

  const rows = items.filter((i) => !compact || !i.ok);
  const allSet = done === items.length;
  const list = (
    <ol className="st-checks">
      {rows.map((i) => {
        const { text, commands } = setupText(i);
        const state = i.ok === null ? 'unknown' : i.ok ? 'ok' : 'todo';
        return (
          <li key={i.id} className="st-check">
            <span className="st-mark" data-state={state}>
              <span aria-hidden="true">{i.ok ? '✓' : i.ok === null ? '?' : '!'}</span>
              <span className="ui-sr-only">{STATE_TEXT(i.ok)}:</span>
            </span>
            <span className="st-check-text">
              <span className="st-check-name">{LABELS[i.id] ?? i.label}</span>
              <span className="st-muted">{busy === i.id && i.id === 'claude' ? 'Checking…' : text}</span>
              {commands.map((c) => (
                <CodeRow key={c} command={c} />
              ))}
            </span>
            {action(i)}
          </li>
        );
      })}
    </ol>
  );
  return (
    <Shell aria-labelledby="st-setup">
      <ShellHeader
        icon="check"
        title={<span id="st-setup">Get started</span>}
        aside={
          <StatusPill tone={done === items.length ? 'positive' : 'warning'}>
            {done === items.length ? 'All set' : `${done} of ${items.length} done`}
          </StatusPill>
        }
      />
      <ShellPanel className="st-panel">
        {allSet && !compact ? (
          // Everything is ready: the checks fold away so Accounts and the rest come first.
          <details className="st-allset">
            <summary>Everything is ready. Show the {items.length} checks</summary>
            {list}
          </details>
        ) : (
          list
        )}
        {compact && (
          <a className="st-more" href="#/settings">
            All setup steps and settings
          </a>
        )}
        {error && (
          <p className="st-error" role="alert">
            {error}
          </p>
        )}
      </ShellPanel>
      <Sheet
        open={confirmDemo}
        onClose={() => setConfirmDemo(false)}
        title="Record the sample tutorial?"
        subtitle="The agent records a short sample (about 3 minutes) to check that everything works. You'll watch it live."
        width={440}
      >
        <div className="st-sheet-actions">
          <Button variant="quiet" onClick={() => setConfirmDemo(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={() => {
              setConfirmDemo(false);
              if (!client) return;
              void client
                .call('project.record', { slug: 'demo-http', mode: 'record' })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              openLive('demo-http');
            }}
          >
            Record the sample
          </Button>
        </div>
      </Sheet>
    </Shell>
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
