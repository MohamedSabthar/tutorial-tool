import { useEffect, useState } from 'react';
import { currentWindowLabel, EngineChip, useEngine } from '../engine';
import mark from '../mark-wso2-orange.png';

/** The Live window. Filled in by steps 1.3 (screencast) and 1.6 (layout). */
export function LiveShell() {
  const { info } = useEngine();
  const [label, setLabel] = useState('…');
  useEffect(() => {
    currentWindowLabel().then(setLabel, () => setLabel('unknown'));
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <span aria-hidden="true" className="edge-accent" />
      <header className="app-header">
        <img src={mark} alt="WSO2" width={24} height={24} />
        <span style={{ fontWeight: 700, color: 'var(--navy)', letterSpacing: '-0.02em' }}>
          Tutorial Studio · Live
        </span>
        <span style={{ flex: 1 }} />
        <EngineChip />
      </header>
      <main
        style={{ flex: 1, background: 'var(--gray-50)', display: 'grid', placeItems: 'center', padding: 32 }}
      >
        <div className="panel panel-pad" style={{ maxWidth: 520, textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 24, color: 'var(--navy)', letterSpacing: '-0.02em' }}>
            Live window<span style={{ color: 'var(--orange)' }}>.</span>
          </h1>
          <p style={{ color: 'var(--gray-600)', lineHeight: 1.5 }}>
            The agent&apos;s recording will stream here. This window has its own engine connection.
          </p>
          <p className="mono" style={{ fontSize: 12, margin: 0 }}>
            window: {label} · engine port: {info?.port ?? '…'}
          </p>
        </div>
      </main>
    </div>
  );
}
