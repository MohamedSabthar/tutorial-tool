import { useEffect, useState } from 'react';
import type { ProductConfig, ProductInfo, RpcResult } from '@studio/core';
import { Button, Chip, Field, Input, Panel, Segmented, Select, Switch, Title } from '@studio/ui';
import { isTauri, useEngine } from '../../engine';
import { AppFrame } from '../frame';
import { SetupChecklist } from './SetupChecklist';

type Settings = RpcResult<'settings.get'>;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Settings: keys, defaults for new tutorials, the workspace, and the products to record. */
export function SettingsScreen() {
  return (
    <AppFrame current="settings">
      <div className="settings">
        <Title size={34}>Settings</Title>
        <div className="settings-grid">
          <div className="settings-col">
            <SetupChecklist />
            <KeysPanel />
            <DefaultsPanel />
          </div>
          <div className="settings-col">
            <WorkspacePanel />
            <ProductsPanel />
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

/** The ElevenLabs key (kept in the Keychain by the engine) and the agent's Claude sign-in. */
function KeysPanel() {
  const { client, state } = useEngine();
  const [tts, setTts] = useState<RpcResult<'tts.status'> | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('tts.status', {}).then(setTts, () => undefined);
  }, [client, state]);

  const save = async () => {
    if (!client || !key.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      setTts(await client.call('tts.setKey', { apiKey: key.trim() }));
      setKey('');
      setNote({ text: 'Key checked with ElevenLabs and saved.', tone: 'ok' });
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!client) return;
    setTts(await client.call('tts.clearKey', {}));
    setNote(null);
  };

  return (
    <Panel title="Accounts">
      <div className="settings-row">
        <strong>ElevenLabs</strong>
        <Chip tone={tts?.configured ? 'ok' : 'neutral'}>
          {tts?.configured ? `Key saved (${tts.source})` : 'No key'}
        </Chip>
      </div>
      <Field
        label={tts?.configured ? 'Replace the API key' : 'API key'}
        hint="Checked with ElevenLabs before it's saved. It stays in the macOS Keychain and never reaches the agent."
      >
        {(id) => (
          <div className="settings-inline">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={key}
              placeholder="sk_…"
              onChange={(e) => setKey(e.target.value)}
            />
            <Button variant="primary" disabled={busy || !key.trim()} onClick={() => void save()}>
              {busy ? 'Checking…' : 'Save'}
            </Button>
            {tts?.configured && tts.source !== 'env' && (
              <Button variant="ghost" onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Field>
      {note && (
        <p className={note.tone === 'ok' ? 'settings-ok' : 'settings-error'} role="status">
          {note.text}
        </p>
      )}
      <div className="settings-row">
        <strong>Claude</strong>
        <span className="settings-hint">
          The agent uses this Mac's Claude Code sign-in. Check it under Get started; to sign in, run{' '}
          <code>claude auth login</code> in Terminal.
        </span>
      </div>
    </Panel>
  );
}

/** Defaults for new tutorials, and the cost limit for pipeline runs. */
function DefaultsPanel() {
  const { client, state } = useEngine();
  const [s, setS] = useState<Settings | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client || state !== 'open') return;
    void client.call('settings.get', {}).then((r) => {
      setS(r);
      setLimit(r.maxCostPerRun ? String(r.maxCostPerRun) : '');
    });
    void client.call('tts.status', {}).then(async (t) => {
      if (t.configured) setVoices(await client.call('voices.list', {}).catch(() => []));
    });
  }, [client, state]);

  const update = async (patch: Partial<Settings>) => {
    if (!client) return;
    setError(null);
    try {
      setS(await client.call('settings.update', patch));
    } catch (e) {
      setError(message(e));
    }
  };

  if (!s) return null;
  return (
    <Panel title="New tutorials">
      <Field
        label="Default voice"
        hint="Briefs start with it; choosing a voice in a brief makes it the default."
      >
        {(id) => (
          <Select
            id={id}
            value={s.defaultVoice ?? ''}
            disabled={!voices.length}
            onChange={(e) => void update({ defaultVoice: e.target.value || null })}
          >
            <option value="">{voices.length ? 'None' : 'Add an ElevenLabs key to list voices'}</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Switch
        label="Auto mode: approve safe tool calls without asking"
        checked={s.autoMode}
        onChange={(v) => void update({ autoMode: v })}
      />
      <Field
        label="Cost limit per pipeline run (USD)"
        hint="The run pauses and asks before going over it. Leave empty for no limit."
      >
        {(id) => (
          <div className="settings-inline">
            <Input
              id={id}
              inputMode="decimal"
              value={limit}
              placeholder="No limit"
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => {
                const n = Number(limit);
                void update({ maxCostPerRun: limit.trim() && n > 0 ? n : null });
              }}
            />
          </div>
        )}
      </Field>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** Where the workspace is; the packaged app can move to another folder (it restarts). */
function WorkspacePanel() {
  const { client, state } = useEngine();
  const [s, setS] = useState<Settings | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('settings.get', {}).then(setS, () => undefined);
  }, [client, state]);

  const move = async () => {
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_workspace', { path: path.trim() });
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <Panel title="Workspace">
      <p className="settings-hint">
        The agent's knowledge base: skills, shared overlays and scenes, and every tutorial project. It's a git
        repository.
      </p>
      <code className="settings-path">{s?.workspace ?? '…'}</code>
      {s?.packaged && isTauri() ? (
        <Field
          label="Use another folder"
          hint="The app restarts on it. A new folder is set up on first open."
        >
          {(id) => (
            <div className="settings-inline">
              <Input
                id={id}
                value={path}
                placeholder="/Users/you/Tutorial Studio"
                onChange={(e) => setPath(e.target.value)}
              />
              <Button disabled={!path.trim()} onClick={() => void move()}>
                Use and restart
              </Button>
            </div>
          )}
        </Field>
      ) : (
        <p className="settings-hint">Development builds use the repo's workspace folder.</p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** products.json: the products tutorials can be made for and how each is launched. */
function ProductsPanel() {
  const { client, state } = useEngine();
  const [list, setList] = useState<ProductInfo[] | null>(null);
  const [draft, setDraft] = useState<ProductConfig[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    if (client && state === 'open') void client.call('products.list', {}).then(setList, () => undefined);
  }, [client, state]);

  const editing = draft !== null;
  const start = () =>
    setDraft(
      (list ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.launch === 'app' && p.app ? { app: p.app } : {}),
        ...(p.launch === 'vscode' ? { extensions: p.extensions } : {}),
        skill: p.skill,
      })),
    );
  const change = (i: number, patch: Partial<ProductConfig>) =>
    setDraft((d) => d && d.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const save = async () => {
    if (!client || !draft) return;
    setBusy(true);
    setNote(null);
    try {
      setList(await client.call('products.save', { products: draft }));
      setDraft(null);
      setNote({ text: 'Saved to products.json and committed.', tone: 'ok' });
    } catch (e) {
      setNote({ text: message(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Products"
      action={
        editing ? null : (
          <Button size="sm" onClick={start} disabled={!list}>
            Edit
          </Button>
        )
      }
    >
      <p className="settings-hint">
        Each product is either an installed app with its extensions built in, or the pinned VS Code with
        marketplace extensions. Saved in the workspace's <code>products.json</code>.
      </p>
      {!editing &&
        list?.map((p) => (
          <div key={p.id} className="product-row">
            <div className="product-head">
              <strong>{p.name}</strong>
              <span className="ui-mono settings-hint">{p.id}</span>
              <span style={{ flex: 1 }} />
              {p.launch === 'app' ? (
                <Chip tone={p.available ? 'ok' : 'error'}>{p.available ? 'Installed' : 'Not installed'}</Chip>
              ) : (
                <Chip tone="info">VS Code</Chip>
              )}
            </div>
            <span className="ui-mono settings-hint">
              {p.launch === 'app' ? p.app : p.extensions.join(', ')} · skill {p.skill}
            </span>
          </div>
        ))}
      {editing &&
        draft.map((p, i) => {
          const builtIn = list?.find((x) => x.id === p.id)?.builtIn ?? false;
          const launch = p.app !== undefined ? 'App' : 'VS Code';
          return (
            <fieldset key={i} className="product-edit">
              <legend>{p.name || 'New product'}</legend>
              <div className="settings-inline">
                <Field label="Name">
                  {(id) => (
                    <Input id={id} value={p.name} onChange={(e) => change(i, { name: e.target.value })} />
                  )}
                </Field>
                <Field label="Id">
                  {(id) => (
                    <Input
                      id={id}
                      value={p.id}
                      disabled={builtIn}
                      onChange={(e) => change(i, { id: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Segmented
                label="Launch"
                options={['App', 'VS Code'] as const}
                value={launch}
                onChange={(v) =>
                  change(
                    i,
                    v === 'App'
                      ? { app: p.app ?? '', extensions: undefined }
                      : { app: undefined, extensions: p.extensions ?? [] },
                  )
                }
              />
              {launch === 'App' ? (
                <Field label="App bundle" hint="e.g. /Applications/WSO2 Integrator.app">
                  {(id) => (
                    <Input id={id} value={p.app ?? ''} onChange={(e) => change(i, { app: e.target.value })} />
                  )}
                </Field>
              ) : (
                <Field
                  label="Extensions"
                  hint="Marketplace ids, comma separated, e.g. WSO2.wso2-integrator@1.0.1"
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={(p.extensions ?? []).join(', ')}
                      onChange={(e) =>
                        change(i, {
                          extensions: e.target.value
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  )}
                </Field>
              )}
              <Field label="Skill" hint="The workspace skill with this product's page objects.">
                {(id) => (
                  <Input
                    id={id}
                    value={p.skill ?? ''}
                    onChange={(e) => change(i, { skill: e.target.value })}
                  />
                )}
              </Field>
              {!builtIn && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft((d) => d && d.filter((_, j) => j !== i))}
                >
                  Remove product
                </Button>
              )}
            </fieldset>
          );
        })}
      {editing && (
        <div className="settings-inline">
          <Button
            size="sm"
            onClick={() => setDraft((d) => [...(d ?? []), { id: '', name: '', extensions: [] }])}
          >
            Add product
          </Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      )}
      {note && (
        <p className={note.tone === 'ok' ? 'settings-ok' : 'settings-error'} role="status">
          {note.text}
        </p>
      )}
    </Panel>
  );
}
