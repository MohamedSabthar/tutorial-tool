import { useEffect, useState } from 'react';
import type { RpcResult } from '@studio/core';
import { Button, Chip, MonoBox, Panel } from '@studio/ui';
import { useEngine } from '../engine';
import { Page } from '../shell';

type Check = RpcResult<'recorder.launchCheck'>;

export function LauncherPage() {
  const { client, state } = useEngine();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<Check[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    return client.on('recorder.progress', (p) =>
      setLog((l) => [...l, `${new Date(p.at).toLocaleTimeString()}  ${p.message}`].slice(-40)),
    );
  }, [client]);

  async function run() {
    if (!client) return;
    setRunning(true);
    setError(null);
    setLog([]);
    try {
      const r = await client.call('recorder.launchCheck', { product: 'wso2-integrator' });
      setResults((prev) => [r, ...prev].slice(0, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const [latest, previous] = results;
  const sameLayout =
    latest && previous ? JSON.stringify(latest.activityBar) === JSON.stringify(previous.activityBar) : null;

  return (
    <Page
      title="Step 1.1 · VS Code launcher"
      intro="Launches your installed WSO2 Integrator app in a fresh, isolated profile: full screen with the title bar visible, Light Modern theme. It opens a valid BI project fixture (a workspace with one integration), because an empty folder makes WSO2 Integrator show a blocking project-type dialog. It then checks the activity bar, title bar, project detection and dialogs, takes a screenshot and closes."
    >
      <Panel
        title="Launch check"
        action={
          latest && (
            <Chip tone={latest.ok ? 'ok' : 'error'}>
              {latest.ok ? 'Passed' : `${latest.problems.length} problem(s)`}
            </Chip>
          )
        }
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={run} disabled={running || state !== 'open'}>
            {running ? 'Running… (WSO2 Integrator opens full screen)' : 'Launch WSO2 Integrator and check'}
          </Button>
          {sameLayout !== null && (
            <Chip tone={sameLayout ? 'ok' : 'error'}>
              {sameLayout ? 'Same layout as the previous run' : 'Layout differs from the previous run'}
            </Chip>
          )}
        </div>
        {error && <Chip tone="error">{error}</Chip>}
        {log.length > 0 && <MonoBox style={{ maxHeight: 180 }}>{log.join('\n')}</MonoBox>}
      </Panel>

      {latest && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          <Panel title="Frame" style={{ flex: '2 1 560px' }}>
            <img
              src={latest.screenshot.dataUrl}
              alt="WSO2 Integrator as launched for recording"
              style={{ width: '100%', borderRadius: 10, border: '1px solid var(--ui-gray-300)' }}
            />
            <span className="ui-mono" style={{ fontSize: 12, color: 'var(--ui-gray-600)' }}>
              {latest.screenshot.width}×{latest.screenshot.height} px
            </span>
          </Panel>
          <Panel title="Details" style={{ flex: '1 1 300px' }}>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: 0 }}>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Version</dt>
              <dd className="ui-mono" style={{ margin: 0 }}>
                {latest.vscodeVersion}
              </dd>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Window</dt>
              <dd className="ui-mono" style={{ margin: 0 }}>
                {latest.viewport.mode} · {latest.viewport.width}×{latest.viewport.height} @{' '}
                {latest.viewport.scale}×
              </dd>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Extension</dt>
              <dd style={{ margin: 0 }}>
                {latest.extensionEntry ? (
                  <Chip tone="ok">{latest.extensionEntry}</Chip>
                ) : (
                  <Chip tone="error">not found</Chip>
                )}
              </dd>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Title bar</dt>
              <dd className="ui-mono" style={{ margin: 0 }}>
                {latest.titleBar || '(hidden)'}
              </dd>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Project</dt>
              <dd style={{ margin: 0 }}>
                <Chip tone={latest.projectDetected ? 'ok' : 'error'}>
                  {latest.projectDetected ? 'detected (Greeting Service)' : 'not detected'}
                </Chip>
              </dd>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Dialogs</dt>
              <dd style={{ margin: 0 }}>
                <Chip tone={latest.dialogs.length ? 'error' : 'ok'}>
                  {latest.dialogs.length ? `${latest.dialogs.length} appeared` : 'none'}
                </Chip>
              </dd>
              <dt style={{ color: 'var(--ui-gray-600)' }}>Duration</dt>
              <dd className="ui-mono" style={{ margin: 0 }}>
                {(latest.durationMs / 1000).toFixed(1)} s
              </dd>
            </dl>
            <span className="ui-eyebrow">Activity bar</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {latest.activityBar.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {latest.problems.length > 0 && <MonoBox>{latest.problems.join('\n')}</MonoBox>}
          </Panel>
        </div>
      )}
    </Page>
  );
}
