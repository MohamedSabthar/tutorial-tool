import { useEffect, useState } from 'react';
import { currentWindowLabel, openLiveWindow, useEngine } from '../engine';
import { Page } from '../shell';

export function DesktopPage() {
  const { info, state, latencyMs, error } = useEngine();
  const [label, setLabel] = useState('…');
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    currentWindowLabel().then(setLabel, () => setLabel('unknown'));
  }, []);

  const rows: [string, string][] = [
    ['This window', label],
    [
      'Engine source',
      info ? (info.source === 'tauri' ? 'started by the Tauri shell' : 'dev engine (pnpm engine)') : '…',
    ],
    ['Engine port', info ? String(info.port) : '…'],
    ['Session token', info ? `${info.token.slice(0, 6)}… (${info.token.length} chars)` : '…'],
    ['Connection', state],
    ['Latency', latencyMs === null ? '…' : `${latencyMs.toFixed(1)} ms (pinged every 5 s)`],
  ];

  return (
    <Page
      title="Step 0.4 · Desktop shell"
      intro="The Tauri shell now starts the engine sidecar itself, passes its port and token to each window, and stops it when the app quits. Open the Live window to check that a second window connects on its own."
    >
      <section className="panel panel-pad" aria-label="Engine status">
        <h2 className="panel-title">Engine</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px 16px', margin: 0 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--gray-600)' }}>{k}</dt>
              <dd className="mono" style={{ margin: 0, color: 'var(--navy)' }}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {error && (
          <p role="alert" className="chip chip-err" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>

      <section className="panel panel-pad" aria-label="Windows">
        <h2 className="panel-title">Windows</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--gray-600)' }}>
          Live opens as its own window (or focuses it if it is already open). It shows its own engine
          connection.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => openLiveWindow().catch((e: unknown) => setOpenError(String(e)))}
        >
          Open Live window
        </button>
        {openError && (
          <p role="alert" className="chip chip-err" style={{ marginTop: 12 }}>
            {openError}
          </p>
        )}
      </section>
    </Page>
  );
}
