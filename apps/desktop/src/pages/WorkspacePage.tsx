import { useCallback, useEffect, useState } from 'react';
import type { RpcResult } from '@studio/core';
import { Button, Chip, Field, Input, MonoBox, Panel } from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';

type Status = RpcResult<'workspace.status'>;
type Commit = RpcResult<'workspace.log'>[number];

export function WorkspacePage() {
  const { client, state } = useEngine();
  const [status, setStatus] = useState<Status | null>(null);
  const [tree, setTree] = useState<string[]>([]);
  const [log, setLog] = useState<Commit[]>([]);
  const [file, setFile] = useState<{ path: string; text: string } | null>(null);
  const [title, setTitle] = useState('Create an HTTP service');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const s = await client.call('workspace.status', {});
      setStatus(s);
      setTree(await client.call('workspace.tree', {}));
      setLog(await client.call('workspace.log', { limit: 20 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    if (state !== 'open' || !client) return;
    // Load once connected (deferred so the effect only subscribes), then on every change.
    void Promise.resolve().then(refresh);
    return client.on('workspace.changed', () => void refresh());
  }, [state, client, refresh]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const open = (p: string) =>
    act(async () => {
      if (!client || p.endsWith('/')) return;
      setFile(await client.call('workspace.read', { path: p }));
    });

  return (
    <Page
      title="Step 0.6 · Workspace"
      intro="The workspace is the agent's knowledge base and its own git repository: the common CLAUDE.md, skills, the shared overlay and scene libraries, and one folder per tutorial. Initialize it, create a project, and watch each change become a commit."
    >
      <Panel
        title="Status"
        action={
          status && (
            <Chip tone={status.initialized ? 'ok' : 'active'}>
              {status.initialized
                ? `initialized · ${status.commits} commits · HEAD ${status.head}`
                : 'not initialized'}
            </Chip>
          )
        }
      >
        <div className="ui-mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
          {status?.path ?? '…'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <Button
            variant={status?.initialized ? 'secondary' : 'primary'}
            disabled={busy || state !== 'open'}
            onClick={() => act(async () => client && (await client.call('workspace.init', {})))}
          >
            {status?.initialized ? 'Re-run initialize (keeps files)' : 'Initialize workspace'}
          </Button>
          <div style={{ flex: '1 1 320px' }}>
            <Field label="New project">
              {(id) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    id={id}
                    style={{ flex: 1 }}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <Button
                    variant="primary"
                    disabled={busy || state !== 'open' || !title.trim()}
                    onClick={() =>
                      act(async () => {
                        if (!client) return;
                        const p = await client.call('project.create', { title, product: 'wso2-integrator' });
                        setFile(
                          await client.call('workspace.read', { path: `projects/${p.slug}/CLAUDE.md` }),
                        );
                      })
                    }
                  >
                    Create project
                  </Button>
                </div>
              )}
            </Field>
          </div>
        </div>
        {error && (
          <p role="alert" style={{ margin: 0 }}>
            <Chip tone="error">{error}</Chip>
          </p>
        )}
      </Panel>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <Panel title="Files" style={{ flex: '1 1 300px' }}>
          {tree.length === 0 && <span style={{ color: 'var(--ui-gray-600)' }}>Nothing here yet.</span>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 420, overflow: 'auto' }}>
            {tree.map((p) => {
              const depth = p.replace(/\/$/, '').split('/').length - 1;
              const name = p.replace(/\/$/, '').split('/').pop() + (p.endsWith('/') ? '/' : '');
              return (
                <li key={p} style={{ paddingLeft: depth * 14 }}>
                  {p.endsWith('/') ? (
                    <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
                      {name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => open(p)}
                      className="ui-mono"
                      style={{
                        fontSize: 12,
                        background: file?.path === p ? 'var(--ui-orange-100)' : 'transparent',
                        border: 0,
                        padding: '2px 6px',
                        borderRadius: 6,
                        color: 'var(--ui-navy)',
                        cursor: 'pointer',
                      }}
                    >
                      {name}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title={file ? file.path : 'File'} style={{ flex: '2 1 420px' }}>
          <MonoBox style={{ maxHeight: 420, margin: 0 }}>
            {file?.text ?? 'Select a file on the left.'}
          </MonoBox>
        </Panel>

        <Panel title="Commits" style={{ flex: '1 1 300px' }}>
          {log.length === 0 && <span style={{ color: 'var(--ui-gray-600)' }}>No commits yet.</span>}
          <ol
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {log.map((c) => (
              <li key={c.hash} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: 'var(--ui-navy)', fontWeight: 600 }}>{c.subject}</span>
                <span className="ui-mono" style={{ fontSize: 11, color: 'var(--ui-gray-600)' }}>
                  {c.hash} · {new Date(c.date).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </Page>
  );
}
